//! The lock choice of every lockable in-game window (DPS meter, pet radar, Timers), saved in `overlay-locks.json` under the window label. A window without a
//! saved choice is unlocked, so a first run, a missing or an unreadable file never leaves a
//! window click-through. Only the user's own lock and unlock actions are saved; a safety
//! unlock (missing hotkey, failed quit) changes the window but keeps the saved choice.
use serde_json::{Map, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const FILE: &str = "overlay-locks.json";

#[derive(Default)]
struct Store {
    path: Option<PathBuf>,
    locks: BTreeMap<String, bool>,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let locks = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value.as_object().cloned())
            .map(|object| {
                object
                    .into_iter()
                    .filter_map(|(label, locked)| Some((label, locked.as_bool()?)))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            path: Some(path),
            locks,
        }
    }

    fn locked(&self, label: &str) -> bool {
        self.locks.get(label).copied().unwrap_or(false)
    }

    /// Writes the whole record, then keeps the choice in memory only once it is on disk.
    fn set(&mut self, label: &str, locked: bool) -> Result<(), String> {
        if self.locks.get(label) == Some(&locked) {
            return Ok(());
        }
        let path = self.path.as_deref().ok_or("No profile folder")?;
        let mut next = self.locks.clone();
        next.insert(label.to_string(), locked);
        write(path, &next)?;
        self.locks = next;
        Ok(())
    }
}

/// Replaces the file atomically, so a crash mid-write keeps the previous choices.
fn write(path: &Path, locks: &BTreeMap<String, bool>) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    }
    let object: Map<String, Value> = locks
        .iter()
        .map(|(label, locked)| (label.clone(), Value::Bool(*locked)))
        .collect();
    let bytes = serde_json::to_vec(&object).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

pub struct OverlayLocks(Mutex<Store>);

/// Loads the saved choices. Call from app setup before any window module reads them.
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE);
    app.manage(OverlayLocks(Mutex::new(Store::load(path))));
    Ok(())
}

/// The saved choice for a window label; unlocked when none is saved or the store is missing.
pub fn saved(app: &AppHandle, label: &str) -> bool {
    app.try_state::<OverlayLocks>()
        .and_then(|state| state.0.lock().ok().map(|store| store.locked(label)))
        .unwrap_or(false)
}

/// Saves the user's choice for a window label.
pub fn save(app: &AppHandle, label: &str, locked: bool) -> Result<(), String> {
    let state = app
        .try_state::<OverlayLocks>()
        .ok_or("Lock settings are unavailable")?;
    let mut store = state.0.lock().map_err(|_| "Lock settings unavailable")?;
    store.set(label, locked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "aion-companion-locks-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn a_fresh_profile_leaves_every_window_unlocked() {
        let folder = folder("fresh");
        let store = Store::load(folder.join(FILE));
        for label in ["dps-overlay", "pet-radar", "timers-overlay"] {
            assert!(!store.locked(label));
        }
        assert!(!folder.exists(), "reading defaults never writes a file");
    }

    #[test]
    fn locked_and_unlocked_choices_survive_a_reload_per_window() {
        let folder = folder("reload");
        let path = folder.join(FILE);
        let mut store = Store::load(path.clone());
        store.set("pet-radar", true).unwrap();
        store.set("timers-overlay", true).unwrap();
        let mut reloaded = Store::load(path.clone());
        assert!(reloaded.locked("pet-radar"));
        assert!(reloaded.locked("timers-overlay"));
        assert!(!reloaded.locked("dps-overlay"));
        reloaded.set("pet-radar", false).unwrap();
        let again = Store::load(path.clone());
        assert!(!again.locked("pet-radar"));
        assert!(again.locked("timers-overlay"));
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn unreadable_or_foreign_values_fall_back_to_unlocked() {
        let folder = folder("corrupt");
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(FILE);
        fs::write(&path, b"{not json").unwrap();
        assert!(!Store::load(path.clone()).locked("dps-overlay"));
        fs::write(
            &path,
            br#"{"dps-overlay":"yes","pet-radar":true,"future":false}"#,
        )
        .unwrap();
        let mut store = Store::load(path.clone());
        assert!(!store.locked("dps-overlay"));
        assert!(store.locked("pet-radar"));
        store.set("dps-overlay", true).unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            saved,
            serde_json::json!({"dps-overlay":true,"pet-radar":true,"future":false})
        );
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_failed_write_keeps_the_previous_choice() {
        let folder = folder("failed");
        fs::create_dir_all(&folder).unwrap();
        // A folder where the file belongs makes the replace fail.
        let path = folder.join(FILE);
        fs::create_dir_all(&path).unwrap();
        let mut store = Store::load(path.clone());
        assert!(store.set("timers-overlay", true).is_err());
        assert!(!store.locked("timers-overlay"));
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(folder);
    }
}
