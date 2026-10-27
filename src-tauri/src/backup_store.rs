//! This app's native backup format and restart-only recovery transaction.
//! No archive paths are trusted: every destination is selected from the native allowlist.
use companion_capture::{persistence, state_validation};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub const ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
pub const TOTAL_BYTES: u64 = 64 * 1024 * 1024;
pub const FILE_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_FILES: usize = 1000;
const RECOVERY: &str = "recovery";

pub fn limits() -> Value {
    json!({"archive_bytes":ARCHIVE_BYTES,"total_bytes":TOTAL_BYTES,"file_bytes":FILE_BYTES,"files":MAX_FILES})
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn fields(value: &Value, names: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("Expected a native backup object")?;
    if object.len() != names.len() || names.iter().any(|name| !object.contains_key(*name)) {
        return Err("Native backup fields do not match the supported schema".into());
    }
    Ok(())
}

pub fn allowed(path: &str) -> bool {
    if ["offline/settings.json", "offline/pets.json"].contains(&path) {
        return true;
    }
    let Some(id) = path
        .strip_prefix("offline/logs/")
        .and_then(|s| s.strip_suffix(".json"))
    else {
        return false;
    };
    let upper = id.to_ascii_uppercase();
    state_validation::valid_log_id(id)
        && ![
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&upper.as_str())
}

fn reparse(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                return Ok(meta.file_attributes() & 0x400 != 0);
            }
            #[cfg(not(windows))]
            {
                Ok(meta.file_type().is_symlink())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn destination(root: &Path, relative: &str, recovery: bool) -> Result<PathBuf, String> {
    // Recovery may need to roll back a transaction staged before Checklist was retired.
    if !allowed(relative)
        && !(recovery && ["offline/index.json", "checklist.json"].contains(&relative))
    {
        return Err("Unsupported backup destination".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        if reparse(&path)? {
            return Err("Backup paths cannot traverse a link or junction".into());
        }
    }
    Ok(path)
}

fn selected(options: &Value, key: &str) -> Result<bool, String> {
    options[key]
        .as_bool()
        .ok_or_else(|| format!("Invalid backup option: {key}"))
}

fn paths(root: &Path, options: &Value) -> Result<Vec<String>, String> {
    fields(options, &["settings", "pets", "logs"])?;
    let mut paths = Vec::new();
    for (key, path) in [
        ("settings", "offline/settings.json"),
        ("pets", "offline/pets.json"),
    ] {
        if selected(options, key)?
            && destination(root, path, false)?
                .try_exists()
                .map_err(|e| e.to_string())?
        {
            paths.push(path.to_string());
        }
    }
    if selected(options, "logs")? {
        let dir = root.join("offline/logs");
        if reparse(&root.join("offline"))? || reparse(&dir)? {
            return Err("Log directory cannot be a link or junction".into());
        }
        if dir.try_exists().map_err(|e| e.to_string())? {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.ends_with(".json") {
                    continue;
                }
                let path = format!("offline/logs/{name}");
                if !allowed(&path) {
                    return Err(format!("Unsupported saved log name: {name}"));
                }
                destination(root, &path, false)?;
                paths.push(path);
                if paths.len() > 10000 {
                    return Err("Too many saved files to estimate; export logs separately".into());
                }
            }
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn plan(root: &Path, options: &Value) -> Result<Value, String> {
    persistence::snapshot(|| {
        let mut total = 0u64;
        let mut files = Vec::new();
        for relative in paths(root, options)? {
            let size = fs::metadata(destination(root, &relative, false)?)
                .map_err(|e| e.to_string())?
                .len();
            total = total.checked_add(size).ok_or("Backup size overflow")?;
            files.push(json!({"path":relative,"bytes":size}));
        }
        Ok(json!({"files":files,"total_bytes":total}))
    })
}

#[derive(Clone)]
pub struct Archive {
    pub files: BTreeMap<String, Vec<u8>>,
    pub value: Value,
}

pub fn capture(
    root: &Path,
    options: &Value,
    channel: &str,
    version: &str,
) -> Result<Archive, String> {
    // Keep the writer pause to bounded file copies only. Hashing/decoding happen afterwards.
    let files = persistence::snapshot(|| {
        let mut files = BTreeMap::new();
        let mut total = 0u64;
        let paths = paths(root, options)?;
        if paths.len() > MAX_FILES {
            return Err("Too many files for one backup; export logs separately".into());
        }
        for relative in paths {
            let bytes =
                persistence::read_bounded(&destination(root, &relative, false)?, FILE_BYTES)?;
            total = total
                .checked_add(bytes.len() as u64)
                .ok_or("Backup size overflow")?;
            if total > TOTAL_BYTES {
                return Err("Selected data exceeds 64 MiB".into());
            }
            files.insert(relative, bytes);
        }
        if files.is_empty() {
            return Err("There is no saved data in the selected categories".into());
        }
        Ok(files)
    })?;
    let mut entries = Vec::new();
    for (path, bytes) in &files {
        state_validation::file(path, bytes).map_err(|e| format!("{path}: {e}"))?;
        let contents = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
        entries.push(
            json!({"path":path,"bytes":bytes.len(),"sha256":digest(bytes),"contents":contents}),
        );
    }
    Ok(Archive {
        files,
        value: json!({"kind":"aion-companion-backup","schema_version":1,"channel":channel,"created_ms":now(),"app_version":version,"entries":entries}),
    })
}

pub fn decode(bytes: &[u8], channel: &str) -> Result<Archive, String> {
    if bytes.len() as u64 > ARCHIVE_BYTES {
        return Err("Backup exceeds 128 MiB".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    fields(
        &value,
        &[
            "kind",
            "schema_version",
            "channel",
            "created_ms",
            "app_version",
            "entries",
        ],
    )?;
    if value["kind"] != "aion-companion-backup" || value["schema_version"] != 1 {
        return Err("Unsupported native backup kind or schema version".into());
    }
    if value["channel"] != channel {
        return Err("Stable and development backups must stay in their own channel".into());
    }
    if value["created_ms"]
        .as_u64()
        .is_none_or(|n| n == 0 || n > 8_640_000_000_000_000)
        || value["app_version"]
            .as_str()
            .is_none_or(|s| semver::Version::parse(s).is_err())
    {
        return Err("Invalid backup metadata".into());
    }
    let entries = value["entries"]
        .as_array()
        .ok_or("Missing backup entries")?;
    if entries.is_empty() || entries.len() > MAX_FILES {
        return Err("Invalid backup file count".into());
    }
    let mut files = BTreeMap::new();
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for entry in entries {
        fields(entry, &["path", "bytes", "sha256", "contents"])?;
        let path = entry["path"].as_str().ok_or("Invalid backup path")?;
        if (!allowed(path) && path != "checklist.json") || !names.insert(path.to_ascii_lowercase())
        {
            return Err("Unsupported or duplicate backup path".into());
        }
        let contents = entry["contents"]
            .as_str()
            .ok_or("Backup contents must be native JSON text")?
            .as_bytes();
        total = total
            .checked_add(contents.len() as u64)
            .ok_or("Backup size overflow")?;
        if contents.len() as u64 > FILE_BYTES
            || total > TOTAL_BYTES
            || entry["bytes"].as_u64() != Some(contents.len() as u64)
            || entry["sha256"].as_str() != Some(&digest(contents))
        {
            return Err("Backup size or integrity check failed".into());
        }
        // Old schema-1 backups may contain retired progress. Check integrity above,
        // but never restore it or let it prevent restoring supported native files.
        if path == "checklist.json" {
            continue;
        }
        state_validation::file(path, contents).map_err(|e| format!("{path}: {e}"))?;
        files.insert(path.to_string(), contents.to_vec());
    }
    if files.is_empty() {
        return Err("Backup contains no supported data to restore".into());
    }
    Ok(Archive { files, value })
}

pub fn preview(root: &Path, archive: &Archive, token: &str) -> Result<Value, String> {
    let files = archive.files.iter().map(|(path, bytes)| Ok(json!({"path":path,"bytes":bytes.len(),"will_replace":destination(root,path,false)?.try_exists().map_err(|e|e.to_string())?}))).collect::<Result<Vec<_>,String>>()?;
    Ok(
        json!({"token":token,"created_ms":archive.value["created_ms"],"app_version":archive.value["app_version"],"channel":archive.value["channel"],"files":files,"total_bytes":archive.files.values().map(|b|b.len() as u64).sum::<u64>()}),
    )
}

pub fn space(path: &Path, required: u64) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let text: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut free = 0;
        if unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                text.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if free < required {
            return Err("Not enough free space for a safe backup or restore".into());
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (path, required);
    }
    Ok(())
}

pub fn export(path: &Path, archive: &Archive) -> Result<Value, String> {
    if !path.file_name().is_some_and(|n| {
        n.to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(".aion-backup.json")
    }) || reparse(path)?
    {
        return Err("Choose an .aion-backup.json file without links".into());
    }
    let parent = path.parent().ok_or("Backup destination has no folder")?;
    let bytes = serde_json::to_vec(&archive.value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > ARCHIVE_BYTES {
        return Err("Serialized backup exceeds 128 MiB".into());
    }
    space(parent, bytes.len() as u64 + 1024 * 1024)?;
    let temp = parent.join(format!(".aion-backup-{}-{}.tmp", std::process::id(), now()));
    let mut created = false;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        created = true;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        Ok(
            json!({"path":path.to_string_lossy(),"files":archive.files.len(),"total_bytes":archive.files.values().map(|b|b.len()as u64).sum::<u64>(),"archive_bytes":bytes.len()}),
        )
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn recovery_dir(root: &Path) -> Result<PathBuf, String> {
    let path = root.join(RECOVERY);
    if reparse(&path)? {
        return Err("Recovery directory cannot be a link or junction".into());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn tx_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("Invalid recovery transaction identity".into());
    }
    let path = recovery_dir(root)?.join(id);
    if reparse(&path)? {
        return Err("Recovery transaction cannot be a link or junction".into());
    }
    Ok(path)
}

pub fn pending(root: &Path) -> bool {
    root.join(RECOVERY).join("pending.json").exists()
}

pub fn stage(root: &Path, archive: &Archive, channel: &str, id: &str) -> Result<(), String> {
    if pending(root) {
        return Err("A restore is already staged; restart before staging another".into());
    }
    let bytes = serde_json::to_vec(&archive.value).map_err(|e| e.to_string())?;
    decode(&bytes, channel)?;
    let dir = tx_path(root, id)?;
    if dir.try_exists().map_err(|e| e.to_string())? {
        return Err("Recovery transaction already exists".into());
    }
    space(root, required_space(root, archive, bytes.len() as u64)?)?;
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    persistence::atomic_bytes(&dir.join("incoming.json"), &bytes)?;
    persistence::write_json(
        &recovery_dir(root)?.join("pending.json"),
        &json!({"schema_version":1,"id":id}),
    )
}

pub fn cancel_staged(root: &Path) -> Result<(), String> {
    persistence::remove(&recovery_dir(root)?.join("pending.json"))
}

#[derive(Clone)]
pub struct Recovery {
    dir: PathBuf,
    journal: Value,
}

fn journal_paths(archive: &Archive) -> Vec<String> {
    let mut paths: Vec<String> = archive.files.keys().cloned().collect();
    if paths.iter().any(|p| p.starts_with("offline/logs/")) {
        paths.push("offline/index.json".into());
    }
    paths
}

fn required_space(root: &Path, archive: &Archive, archive_bytes: u64) -> Result<u64, String> {
    let mut originals = 0u64;
    for path in journal_paths(archive) {
        let path = destination(root, &path, true)?;
        if path.try_exists().map_err(|e| e.to_string())? {
            let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
            if size > FILE_BYTES {
                return Err("An existing file is too large to preserve safely for rollback".into());
            }
            originals = originals
                .checked_add(size)
                .ok_or("Rollback size overflow")?;
            if originals > TOTAL_BYTES + FILE_BYTES {
                return Err("Existing rollback data exceeds supported limits".into());
            }
        }
    }
    Ok(archive_bytes
        + originals
        + archive.files.values().map(|b| b.len() as u64).sum::<u64>()
        + FILE_BYTES
        + 1024 * 1024)
}

fn rollback(root: &Path, recovery: &Recovery) -> Result<(), String> {
    let entries = recovery.journal["entries"]
        .as_array()
        .ok_or("Invalid recovery journal")?;
    if entries.is_empty() || entries.len() > MAX_FILES + 1 {
        return Err("Invalid recovery journal size".into());
    }
    // Validate the entire rollback before the first mutation; corrupt rollback is never guessed.
    let mut originals = Vec::new();
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for entry in entries {
        fields(entry, &["path", "existed", "sha256"])?;
        let path = entry["path"].as_str().ok_or("Invalid rollback path")?;
        let target = destination(root, path, true)?;
        if !seen.insert(path.to_ascii_lowercase()) {
            return Err("Duplicate rollback path".into());
        }
        let existed = entry["existed"]
            .as_bool()
            .ok_or("Invalid rollback existence state")?;
        let bytes = if existed {
            let source = destination(&recovery.dir.join("rollback"), path, true)?;
            let bytes = persistence::read_bounded(&source, FILE_BYTES)?;
            total += bytes.len() as u64;
            if total > TOTAL_BYTES + FILE_BYTES {
                return Err("Rollback exceeds supported size limits".into());
            }
            if entry["sha256"].as_str() != Some(&digest(&bytes)) {
                return Err("Rollback integrity check failed".into());
            }
            Some(bytes)
        } else {
            if !entry["sha256"].is_null() {
                return Err("Invalid missing rollback digest".into());
            }
            None
        };
        originals.push((target, bytes));
    }
    for (target, bytes) in originals {
        match bytes {
            Some(bytes) => {
                fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
                persistence::atomic_bytes(&target, &bytes)?;
            }
            None => persistence::remove(&target)?,
        }
    }
    Ok(())
}

fn result(root: &Path, phase: &str, message: &str) -> Result<(), String> {
    persistence::write_json(
        &recovery_dir(root)?.join("result.json"),
        &json!({"phase":phase,"message":message}),
    )
}

pub fn last_result(root: &Path) -> Option<Value> {
    persistence::read_bounded(&root.join(RECOVERY).join("result.json"), 16 * 1024)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}

/// Before any durable state is loaded. An interrupted application rolls back, never resumes.
pub fn begin(root: &Path, channel: &str) -> Result<Option<Recovery>, String> {
    match begin_with(root, channel, &mut persistence::atomic_bytes) {
        Ok(recovery) => Ok(recovery),
        Err(error) => {
            // Before a journal exists no profile file has been replaced. Cancel that
            // attempt so a damaged incoming file or a space/preparation error cannot
            // trap the original profile in an endless failed-start loop.
            let pointer: Value = serde_json::from_slice(&persistence::read_bounded(
                &recovery_dir(root)?.join("pending.json"),
                4096,
            )?)
            .map_err(|_| error.clone())?;
            fields(&pointer, &["schema_version", "id"])?;
            if pointer["schema_version"] != 1 {
                return Err(error);
            }
            let dir = tx_path(root, pointer["id"].as_str().ok_or_else(|| error.clone())?)?;
            if dir
                .join("journal.json")
                .try_exists()
                .map_err(|e| e.to_string())?
            {
                return Err(error);
            }
            result(
                root,
                "failed",
                &format!("Restore could not be prepared; current files were not replaced: {error}"),
            )?;
            cancel_staged(root)?;
            Ok(None)
        }
    }
}

fn begin_with(
    root: &Path,
    channel: &str,
    write: &mut impl FnMut(&Path, &[u8]) -> Result<(), String>,
) -> Result<Option<Recovery>, String> {
    let pending_path = recovery_dir(root)?.join("pending.json");
    if !pending_path.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let pointer: Value = serde_json::from_slice(&persistence::read_bounded(&pending_path, 4096)?)
        .map_err(|e| e.to_string())?;
    fields(&pointer, &["schema_version", "id"])?;
    if pointer["schema_version"] != 1 {
        return Err("Unsupported recovery pointer version; files preserved".into());
    }
    let dir = tx_path(
        root,
        pointer["id"]
            .as_str()
            .ok_or("Missing recovery transaction")?,
    )?;
    let journal_path = dir.join("journal.json");
    if journal_path.exists() {
        let journal: Value =
            serde_json::from_slice(&persistence::read_bounded(&journal_path, 1024 * 1024)?)
                .map_err(|e| e.to_string())?;
        fields(&journal, &["schema_version", "phase", "entries"])?;
        if journal["schema_version"] != 1 {
            return Err("Unsupported recovery journal version".into());
        }
        let recovery = Recovery { dir, journal };
        match recovery.journal["phase"].as_str() {
            Some("committed") => {
                cancel_staged(root)?;
                return Ok(None);
            }
            Some("prepared" | "applied") => {
                rollback(root, &recovery)?;
                result(
                    root,
                    "rolled_back",
                    "An interrupted restore was rolled back. Original files were preserved.",
                )?;
                cancel_staged(root)?;
                return Ok(None);
            }
            _ => return Err("Unknown recovery phase; files preserved".into()),
        }
    }
    let incoming = persistence::read_bounded(&dir.join("incoming.json"), ARCHIVE_BYTES)?;
    let archive = match decode(&incoming, channel) {
        Ok(archive) => archive,
        Err(error) => {
            result(
                root,
                "failed",
                &format!("Staged backup was invalid; current data was not changed: {error}"),
            )?;
            cancel_staged(root)?;
            return Ok(None);
        }
    };
    space(root, required_space(root, &archive, incoming.len() as u64)?)?;
    let mut entries = Vec::new();
    let rollback_dir = dir.join("rollback");
    if reparse(&rollback_dir)? {
        return Err("Rollback directory cannot be a link or junction".into());
    }
    fs::create_dir_all(&rollback_dir).map_err(|e| e.to_string())?;
    for path in journal_paths(&archive) {
        let target = destination(root, &path, true)?;
        let existed = target.try_exists().map_err(|e| e.to_string())?;
        let checksum = if existed {
            let bytes = persistence::read_bounded(&target, FILE_BYTES)?;
            let copy = destination(&rollback_dir, &path, true)?;
            fs::create_dir_all(copy.parent().unwrap()).map_err(|e| e.to_string())?;
            persistence::atomic_bytes(&copy, &bytes)?;
            Some(digest(&bytes))
        } else {
            None
        };
        entries.push(json!({"path":path,"existed":existed,"sha256":checksum}));
    }
    let mut recovery = Recovery {
        dir,
        journal: json!({"schema_version":1,"phase":"prepared","entries":entries}),
    };
    persistence::write_json(&journal_path, &recovery.journal)?;
    let apply = (|| {
        for (path, bytes) in &archive.files {
            let target = destination(root, path, false)?;
            fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            write(&target, bytes)?;
        }
        if archive.files.keys().any(|p| p.starts_with("offline/logs/")) {
            persistence::remove(&destination(root, "offline/index.json", true)?)?;
        }
        recovery.journal["phase"] = "applied".into();
        persistence::write_json(&journal_path, &recovery.journal)
    })();
    if let Err(error) = apply {
        rollback(root, &recovery).map_err(|rollback| {
            format!(
                "Restore failed: {error}; rollback failed: {rollback}. Recovery files preserved."
            )
        })?;
        result(
            root,
            "rolled_back",
            &format!("Restore failed and original files were restored: {error}"),
        )?;
        cancel_staged(root)?;
        return Ok(None);
    }
    Ok(Some(recovery))
}

pub fn finish(root: &Path, recovery: &Recovery, success: bool) -> Result<(), String> {
    if success {
        let mut journal = recovery.journal.clone();
        journal["phase"] = "committed".into();
        persistence::write_json(&recovery.dir.join("journal.json"), &journal)?;
        result(root,"restored","The selected native files were restored. A rollback copy is retained in the recovery folder.")?;
    } else {
        rollback(root, recovery)?;
        result(
            root,
            "rolled_back",
            "Startup could not complete after restore. Original selected files were restored.",
        )?;
    }
    cancel_staged(root)
}

#[cfg(test)]
#[path = "backup_store_tests.rs"]
mod tests;
