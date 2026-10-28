//! Shared durable-file boundary for coherent local snapshots and bounded reads.
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::{OnceLock, RwLock},
};

fn barrier() -> &'static RwLock<()> {
    static BARRIER: OnceLock<RwLock<()>> = OnceLock::new();
    BARRIER.get_or_init(|| RwLock::new(()))
}

/// The callback may only read durable files. Never wait for capture/storage state here.
pub fn snapshot<T>(read: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = barrier()
        .write()
        .map_err(|_| "Profile snapshot unavailable")?;
    read()
}

pub fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit {
        return Err(format!("{} exceeds its {limit}-byte limit", path.display()));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("{} exceeds its {limit}-byte limit", path.display()));
    }
    Ok(bytes)
}

/// Sync the complete replacement before the rename. A failed write preserves the old file.
pub fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _guard = barrier()
        .read()
        .map_err(|_| "Profile storage unavailable")?;
    let temp = path.with_extension("pending");
    let mut file = File::create(&temp).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
        }
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 9) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

/// Preserve a replaced native record outside the active library. Missing source
/// files are already retired (or were never saved), making retries idempotent.
pub fn archive(source: &Path, destination: &Path) -> Result<(), String> {
    let _guard = barrier().read().map_err(|_| "Profile storage unavailable")?;
    match fs::metadata(source) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    if destination.try_exists().map_err(|e| e.to_string())? {
        return Err("Archived startup record already exists; both copies preserved".into());
    }
    fs::create_dir_all(destination.parent().ok_or("Invalid archive path")?)
        .map_err(|e| e.to_string())?;
    fs::rename(source, destination).map_err(|e| e.to_string())
}

#[cfg(test)]
mod archive_tests {
    use super::*;

    #[test]
    fn retiring_a_record_is_retryable_and_never_overwrites_an_existing_copy() {
        let root = std::env::temp_dir().join(format!("aion-retired-log-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("fight.json");
        let destination = root.join("superseded/fight.json");
        fs::write(&source, b"first recording").unwrap();
        archive(&source, &destination).unwrap();
        archive(&source, &destination).unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read(&destination).unwrap(), b"first recording");
        fs::write(&source, b"another recording").unwrap();
        assert!(archive(&source, &destination).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"another recording");
        assert_eq!(fs::read(&destination).unwrap(), b"first recording");
        fs::remove_dir_all(root).unwrap();
    }
}

pub fn remove(path: &Path) -> Result<(), String> {
    let _guard = barrier()
        .read()
        .map_err(|_| "Profile storage unavailable")?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    atomic_bytes(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
}

/// Startup only: keep unreadable bytes under a unique sibling name before defaults are used.
pub fn preserve_invalid(path: &Path) -> Result<std::path::PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let name = path
        .file_name()
        .ok_or("Invalid state path")?
        .to_string_lossy();
    let target = path.with_file_name(format!("{name}.invalid-{stamp}"));
    if target.try_exists().map_err(|e| e.to_string())? {
        return Err("Preserved state already exists".into());
    }
    fs::rename(path, &target).map_err(|e| format!("Could not preserve {}: {e}", path.display()))?;
    Ok(target)
}

pub fn load_preserving<T>(
    path: &Path,
    limit: u64,
    decode: impl FnOnce(&[u8]) -> Result<T, String>,
) -> Result<(Option<T>, Option<String>), String> {
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok((None, None));
    }
    match read_bounded(path, limit).and_then(|bytes| decode(&bytes)) {
        Ok(value) => Ok((Some(value), None)),
        Err(error) => {
            let preserved = preserve_invalid(path)?;
            Ok((
                None,
                Some(format!(
                    "Invalid saved state: {error}. Original preserved at {}",
                    preserved.display()
                )),
            ))
        }
    }
}
