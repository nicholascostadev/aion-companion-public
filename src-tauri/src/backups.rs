//! Native backup commands. Restore is staged, then applied before capture on the next process.
use crate::backup_store::{self as store, Archive};
use companion_capture::{persistence, LiveCapture};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct BackupsState {
    busy: AtomicBool,
    preview: Mutex<Option<(String, Archive)>>,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
fn enter(state: &BackupsState) -> Result<Busy<'_>, String> {
    if state.busy.swap(true, Ordering::AcqRel) {
        return Err("A backup operation is already running".into());
    }
    Ok(Busy(&state.busy))
}
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
pub fn channel() -> &'static str {
    if crate::build_info::DEVELOPMENT {
        "development"
    } else {
        "stable"
    }
}

#[tauri::command]
pub async fn backups_status(app: AppHandle) -> Result<Value, String> {
    crate::background::run(move || {
        let root = root(&app)?;
        Ok(json!({"channel":channel(),"limits":store::limits(),"pending_restore":store::pending(&root),"last_recovery":store::last_result(&root)}))
    }).await
}

#[tauri::command]
pub async fn backups_plan(options: Value, app: AppHandle) -> Result<Value, String> {
    crate::background::run(move || store::plan(&root(&app)?, &options)).await
}

#[tauri::command]
pub async fn backups_export(options: Value, app: AppHandle) -> Result<Option<Value>, String> {
    crate::background::run(move || {
        let state = app.state::<BackupsState>();
        let _busy = enter(&state)?;
        let Some(path) = crate::backup_dialog::choose_save(&app)? else {
            return Ok(None);
        };
        let root = root(&app)?;
        // Never let a chosen export replace the running profile's files or recovery journal.
        if path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .is_some_and(|p| root.canonicalize().is_ok_and(|r| p.starts_with(r)))
        {
            return Err(
                "Choose a backup destination outside the active application data folder".into(),
            );
        }
        app.state::<LiveCapture>().flush_profile()?;
        let archive = store::capture(&root, &options, channel(), env!("CARGO_PKG_VERSION"))?;
        store::export(&path, &archive).map(Some)
    })
    .await
}

#[tauri::command]
pub async fn backups_preview(app: AppHandle) -> Result<Option<Value>, String> {
    crate::background::run(move || {
        let state = app.state::<BackupsState>();
        let _busy = enter(&state)?;
        *state
            .preview
            .lock()
            .map_err(|_| "Backup preview unavailable")? = None;
        let Some(path) = crate::backup_dialog::choose_open(&app)? else {
            return Ok(None);
        };
        let bytes = persistence::read_bounded(&path, store::ARCHIVE_BYTES)?;
        let archive = store::decode(&bytes, channel())?;
        validate_hotkeys(&archive)?;
        let token = store::digest(
            format!(
                "{}:{}:{}",
                store::digest(&bytes),
                store::now(),
                std::process::id()
            )
            .as_bytes(),
        );
        let result = store::preview(&root(&app)?, &archive, &token)?;
        *state
            .preview
            .lock()
            .map_err(|_| "Backup preview unavailable")? = Some((token, archive));
        Ok(Some(result))
    })
    .await
}

fn validate_hotkeys(archive: &Archive) -> Result<(), String> {
    use tauri_plugin_global_shortcut::Shortcut;
    if let Some(bytes) = archive.files.get("offline/settings.json") {
        let settings = companion_capture::state_validation::settings(bytes)?;
        let mut shortcuts = Vec::new();
        for key in [
            "toggle_overlay",
            "toggle_lock",
            "reset",
            "copy_summary",
            "compact_strip",
        ] {
            if let Some(text) = settings["hotkeys"][key].as_str().filter(|s| !s.is_empty()) {
                let key = text
                    .parse::<Shortcut>()
                    .map_err(|e| format!("Invalid backup shortcut: {e}"))?;
                if shortcuts.contains(&key) {
                    return Err("Backup shortcuts must be unique".into());
                }
                shortcuts.push(key);
            }
        }
        for preset in settings["presets"].as_array().unwrap() {
            if let Some(text) = preset["keybind"].as_str().filter(|s| !s.is_empty()) {
                let key = text
                    .parse::<Shortcut>()
                    .map_err(|e| format!("Invalid backup tracker shortcut: {e}"))?;
                if shortcuts.contains(&key) {
                    return Err("Backup shortcuts must be unique".into());
                }
                shortcuts.push(key);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn backups_cancel(app: AppHandle) -> Result<(), String> {
    let state = app.state::<BackupsState>();
    let _busy = enter(&state)?;
    *state
        .preview
        .lock()
        .map_err(|_| "Backup preview unavailable")? = None;
    Ok(())
}

#[tauri::command]
pub async fn backups_restore(token: String, app: AppHandle) -> Result<Value, String> {
    crate::background::run(move || {
        let state = app.state::<BackupsState>();
        let _busy = enter(&state)?;
        let preview = state
            .preview
            .lock()
            .map_err(|_| "Backup preview unavailable")?;
        let (expected, archive) = preview
            .as_ref()
            .ok_or("Select and validate a native backup first")?;
        if token != *expected {
            return Err("Backup preview changed; review it again before restoring".into());
        }
        validate_hotkeys(archive)?;
        let root = root(&app)?;
        // The new process waits for this PID to end before it can acquire the capture guard.
        let mut restart = restart_helper()?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let transaction = store::digest(format!("{expected}:{stamp}").as_bytes());
        if let Err(error) = store::stage(&root, archive, channel(), &transaction) {
            let _ = restart.kill();
            let _ = restart.wait();
            return Err(error);
        }
        drop(preview);
        if let Err(error) =
            crate::overlay::quit_and_save(app.clone(), "Restarting to restore a backup")
        {
            let _ = restart.kill();
            let _ = restart.wait();
            store::cancel_staged(&root)
                .map_err(|cancel| format!("{error}; could not cancel staged restore: {cancel}"))?;
            return Err(error);
        }
        Ok(json!({"restart_required":true}))
    })
    .await
}

fn restart_helper() -> Result<std::process::Child, String> {
    let mut command =
        std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    command
        .arg("--recovery-restart")
        .arg(std::process::id().to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|e| format!("Could not prepare recovery restart: {e}"))
}

/// Runs before acquiring the one-process capture guard, never after profile initialization.
pub fn await_previous_process() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let Some(index) = args.iter().position(|s| s == "--recovery-restart") else {
        return Ok(());
    };
    let pid: u32 = args
        .get(index + 1)
        .ok_or("Missing recovery parent PID")?
        .parse()
        .map_err(|_| "Invalid recovery parent PID")?;
    if pid == 0 || pid == std::process::id() {
        return Err("Invalid recovery parent process".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
                return Ok(());
            }
            return Err("Cannot wait for the previous application process".into());
        }
        let result = unsafe { WaitForSingleObject(process, 60_000) };
        unsafe { CloseHandle(process) };
        if result != WAIT_OBJECT_0 {
            return Err("Previous application did not finish; recovery was not started".into());
        }
    }
    #[cfg(not(windows))]
    {
        return Err("Automatic recovery restart is supported on Windows only".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn operations_are_serialized_and_a_failed_step_releases_the_slot() {
        let state = BackupsState::default();
        let slot = enter(&state).unwrap();
        assert!(enter(&state).is_err());
        drop(slot);
        assert!(enter(&state).is_ok());
    }
    #[test]
    fn backup_shortcuts_are_parsed_and_cannot_conflict() {
        let mut settings = companion_capture::state_validation::settings(b"{}").unwrap();
        settings["hotkeys"]["reset"] = settings["hotkeys"]["toggle_lock"].clone();
        let mut archive = Archive {
            files: std::collections::BTreeMap::new(),
            value: Value::Null,
        };
        archive.files.insert(
            "offline/settings.json".into(),
            serde_json::to_vec(&settings).unwrap(),
        );
        assert!(validate_hotkeys(&archive).is_err());
        settings["hotkeys"]["reset"] = "not a keyboard shortcut".into();
        archive.files.insert(
            "offline/settings.json".into(),
            serde_json::to_vec(&settings).unwrap(),
        );
        assert!(validate_hotkeys(&archive).is_err());
    }
}
