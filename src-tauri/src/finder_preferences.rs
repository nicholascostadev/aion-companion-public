//! One durable set of Explore choices for the workspace and its in-game window.
//! Partial updates merge under one lock; disk commits precede state and event publication.
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

const FILE: &str = "finder-preferences.json";
const MAX_BYTES: u64 = 16_384;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAPS: [&str; 3] = [
    "World/World_L/World_L_A",
    "World/World_D/World_D_A",
    "Intersever/Abyss/Abyss_Reshanta_A",
];

#[derive(Clone, Debug, PartialEq)]
struct Preferences {
    revision: u64,
    chosen_map: Option<String>,
    visibility: Visibility,
    cube_layers: CubeLayers,
    hidden_resources: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct Visibility {
    cubes: bool,
    gathering: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct CubeLayers {
    nearby: bool,
    earlier: bool,
    possible: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            revision: 0,
            chosen_map: None,
            visibility: Visibility {
                cubes: true,
                gathering: true,
            },
            cube_layers: CubeLayers {
                nearby: true,
                earlier: true,
                possible: true,
            },
            hidden_resources: Vec::new(),
        }
    }
}

impl Preferences {
    fn value(&self) -> Value {
        json!({
            "revision":self.revision,
            "chosen_map":self.chosen_map,
            "visibility":{"cubes":self.visibility.cubes,"gathering":self.visibility.gathering},
            "cube_layers":{"nearby":self.cube_layers.nearby,"earlier":self.cube_layers.earlier,"possible":self.cube_layers.possible},
            "hidden_resources":self.hidden_resources,
        })
    }

    fn patched(&self, patch: &Value) -> Result<Self, String> {
        let patch = patch
            .as_object()
            .ok_or("Expected an Explore preferences patch")?;
        let mut next = self.clone();
        for (key, value) in patch {
            match key.as_str() {
                "chosen_map" => {
                    next.chosen_map = if value.is_null() {
                        None
                    } else {
                        let map = value
                            .as_str()
                            .filter(|v| MAPS.contains(v))
                            .ok_or("Unknown Explore map")?;
                        Some(map.to_string())
                    };
                }
                "visibility" | "cube_layers" => {
                    let flags = value.as_object().ok_or("Expected Explore layer flags")?;
                    for (flag, value) in flags {
                        let on = value.as_bool().ok_or("Expected a boolean layer choice")?;
                        match (key.as_str(), flag.as_str()) {
                            ("visibility", "cubes") => next.visibility.cubes = on,
                            ("visibility", "gathering") => next.visibility.gathering = on,
                            ("cube_layers", "nearby") => next.cube_layers.nearby = on,
                            ("cube_layers", "earlier") => next.cube_layers.earlier = on,
                            ("cube_layers", "possible") => next.cube_layers.possible = on,
                            _ => return Err("Unknown Explore layer choice".into()),
                        }
                    }
                }
                "hidden_resources" => {
                    let resources = value
                        .as_array()
                        .filter(|v| v.len() <= 128)
                        .ok_or("Expected at most 128 hidden resources")?;
                    let mut keys = Vec::with_capacity(resources.len());
                    for resource in resources {
                        let key = resource
                            .as_str()
                            .filter(|v| {
                                v.strip_prefix("item:").is_some_and(|id| {
                                    !id.is_empty()
                                        && id.len() <= 20
                                        && id.bytes().all(|b| b.is_ascii_digit())
                                })
                            })
                            .ok_or("Invalid gathering resource key")?;
                        keys.push(key.to_string());
                    }
                    keys.sort();
                    keys.dedup();
                    next.hidden_resources = keys;
                }
                _ => return Err("Unknown Explore preference".into()),
            }
        }
        Ok(next)
    }
}

struct Store {
    path: PathBuf,
    preferences: Preferences,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let read = || -> Option<Preferences> {
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .ok()?
                .take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            if bytes.len() as u64 > MAX_BYTES {
                return None;
            }
            let disk: Value = serde_json::from_slice(&bytes).ok()?;
            if disk["version"].as_u64()? != 1 {
                return None;
            }
            let mut patch = disk["preferences"].as_object()?.clone();
            let revision = patch
                .remove("revision")?
                .as_u64()
                .filter(|r| *r <= MAX_REVISION)?;
            let mut preferences = Preferences::default().patched(&Value::Object(patch)).ok()?;
            preferences.revision = revision;
            Some(preferences)
        };
        Self {
            preferences: read().unwrap_or_default(),
            path,
        }
    }

    fn update(&mut self, patch: &Value) -> Result<bool, String> {
        let mut next = self.preferences.patched(patch)?;
        if next == self.preferences {
            return Ok(false);
        }
        next.revision = next
            .revision
            .checked_add(1)
            .filter(|r| *r <= MAX_REVISION)
            .ok_or("Explore preference revision exhausted")?;
        write(&self.path, &next)?;
        self.preferences = next;
        Ok(true)
    }
}

fn write(path: &Path, preferences: &Preferences) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec(&json!({"version":1,"preferences":preferences.value()}))
        .map_err(|e| e.to_string())?;
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

struct FinderPreferences(Mutex<Store>);

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE);
    app.manage(FinderPreferences(Mutex::new(Store::load(path))));
    Ok(())
}

#[tauri::command]
pub async fn finder_preferences(app: AppHandle) -> Result<Value, String> {
    crate::background::run(move || {
        let state = app.state::<FinderPreferences>();
        let store = state.0.lock().map_err(|_| "Explore choices unavailable")?;
        Ok(store.preferences.value())
    })
    .await
}

#[tauri::command]
pub async fn finder_preferences_update(app: AppHandle, patch: Value) -> Result<Value, String> {
    crate::background::run(move || {
        let (preferences, changed) = {
            let state = app.state::<FinderPreferences>();
            let mut store = state.0.lock().map_err(|_| "Explore choices unavailable")?;
            let changed = store.update(&patch)?;
            (store.preferences.value(), changed)
        };
        if changed {
            // A committed save remains a success even if a window misses this notification.
            if let Err(error) = app.emit("finder-preferences-changed", &preferences) {
                companion_capture::diagnostics::record(
                    "warn",
                    "finder-preferences",
                    &error.to_string(),
                );
            }
        }
        Ok(preferences)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("aion-explore-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn partial_choices_merge_and_survive_reload_without_resetting_other_fields() {
        let folder = folder("reload");
        let path = folder.join(FILE);
        let mut store = Store::load(path.clone());
        assert!(!folder.exists());
        store
            .update(&json!({"visibility":{"cubes":false},"cube_layers":{"earlier":false}}))
            .unwrap();
        store.update(&json!({"visibility":{"gathering":false},"hidden_resources":["item:200","item:100","item:100"]})).unwrap();
        store.update(&json!({"chosen_map":MAPS[0]})).unwrap();
        let loaded = Store::load(path.clone());
        assert_eq!(loaded.preferences, store.preferences);
        assert!(!loaded.preferences.visibility.cubes && !loaded.preferences.visibility.gathering);
        assert!(!loaded.preferences.cube_layers.earlier);
        assert_eq!(
            loaded.preferences.hidden_resources,
            ["item:100", "item:200"]
        );
        assert_eq!(loaded.preferences.revision, 3);
        assert!(!store
            .update(&json!({"hidden_resources":["item:100","item:200"]}))
            .unwrap());
        store.update(&json!({"chosen_map":null})).unwrap();
        assert_eq!(store.preferences.chosen_map, None);
        assert_eq!(store.preferences.revision, 4);
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn rejected_patches_never_mutate_or_write() {
        let folder = folder("invalid");
        let mut store = Store::load(folder.join(FILE));
        for patch in [
            json!(null),
            json!({"revision":99}),
            json!({"chosen_map":"unknown"}),
            json!({"visibility":{"cubes":false,"future":true}}),
            json!({"cube_layers":{"nearby":1}}),
            json!({"hidden_resources":["env:100"]}),
            json!({"hidden_resources":vec!["item:1";129]}),
        ] {
            assert!(store.update(&patch).is_err());
            assert_eq!(store.preferences, Preferences::default());
        }
        assert!(!folder.exists());
    }

    #[test]
    fn failed_persistence_keeps_previous_choices_and_revision() {
        let folder = folder("failed");
        let path = folder.join(FILE);
        let mut store = Store::load(path.clone());
        fs::create_dir_all(&path).unwrap();
        assert!(store
            .update(&json!({"visibility":{"cubes":false}}))
            .is_err());
        assert_eq!(store.preferences, Preferences::default());
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn missing_corrupt_oversize_or_future_files_use_defaults_without_writing() {
        let folder = folder("invalid-file");
        let path = folder.join(FILE);
        fs::create_dir_all(&folder).unwrap();
        for bytes in [
            b"{broken".to_vec(),
            vec![b' '; MAX_BYTES as usize + 1],
            br#"{"version":2}"#.to_vec(),
        ] {
            fs::write(&path, &bytes).unwrap();
            assert_eq!(
                Store::load(path.clone()).preferences,
                Preferences::default()
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let _ = fs::remove_dir_all(folder);
    }
}
