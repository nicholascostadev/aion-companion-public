//! Saved characters for the profile window: up to fifty exact name and Global server pairs,
//! newest first, kept in `profile-favorites.json`. Native owns the list; the window reads it
//! with its status and changes it only through `profile_favorite_set`. While character names
//! are hidden the list is neither shown nor changed (it stays on disk for later). A server's
//! name is kept only as an official sheet gave it (`ProfileApi::server_name`); otherwise the
//! window shows the numeric server id.
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const FILE: &str = "profile-favorites.json";
pub const MAX: usize = 50;
const MAX_BYTES: u64 = 32_768;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Favorite {
    server_id: u16,
    name: String,
    /// The official server name known when the character was saved.
    server_name: Option<String>,
    saved_ms: u64,
}

fn valid(server_id: u16, name: &str) -> bool {
    crate::profile_identity::region(server_id).is_some()
        && crate::profile_identity::valid_name(name)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Change {
    Unchanged,
    Saved,
    Removed,
}

struct Store {
    path: PathBuf,
    list: Vec<Favorite>,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let read = || -> Option<Vec<Favorite>> {
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
            let mut list: Vec<Favorite> = Vec::new();
            for entry in disk["favorites"].as_array()? {
                let server_id = entry["server_id"]
                    .as_u64()
                    .and_then(|v| u16::try_from(v).ok());
                let name = entry["name"].as_str();
                let (Some(server_id), Some(name)) = (server_id, name) else {
                    continue;
                };
                if valid(server_id, name)
                    && !list
                        .iter()
                        .any(|f| f.server_id == server_id && f.name == name)
                    && list.len() < MAX
                {
                    list.push(Favorite {
                        server_id,
                        name: name.to_string(),
                        server_name: entry["server_name"]
                            .as_str()
                            .and_then(crate::profile_identity::server_name),
                        saved_ms: entry["saved_ms"].as_u64().unwrap_or(0),
                    });
                }
            }
            Some(list)
        };
        Self {
            list: read().unwrap_or_default(),
            path,
        }
    }

    /// Saves or removes one exact character; a full list refuses a new one.
    fn set(
        &mut self,
        server_id: u16,
        name: &str,
        saved: bool,
        now_ms: u64,
        server_name: Option<String>,
    ) -> Result<Change, String> {
        if !valid(server_id, name) {
            return Err("This character has no official profile to save.".into());
        }
        let at = self
            .list
            .iter()
            .position(|f| f.server_id == server_id && f.name == name);
        let mut next = self.list.clone();
        let change = match (saved, at) {
            (true, Some(_)) | (false, None) => return Ok(Change::Unchanged),
            (true, None) => {
                if next.len() >= MAX {
                    return Err(format!(
                        "Up to {MAX} characters can be saved. Remove one first."
                    ));
                }
                next.insert(
                    0,
                    Favorite {
                        server_id,
                        name: name.to_string(),
                        server_name,
                        saved_ms: now_ms,
                    },
                );
                Change::Saved
            }
            (false, Some(i)) => {
                next.remove(i);
                Change::Removed
            }
        };
        write(&self.path, &next)?;
        self.list = next;
        Ok(change)
    }

    /// The list for the window; `known` names a server no saved entry recorded.
    fn value(&self, known: impl Fn(u16) -> Option<String>) -> Value {
        Value::Array(
            self.list
                .iter()
                .map(|f| {
                    json!({
                        "server_id": f.server_id,
                        "server_name": f.server_name.clone().or_else(|| known(f.server_id)),
                        "name": f.name,
                        "saved_ms": f.saved_ms,
                    })
                })
                .collect(),
        )
    }
}

fn write(path: &Path, list: &[Favorite]) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    }
    let entries: Vec<Value> = list
        .iter()
        .map(|f| {
            json!({"server_id":f.server_id,"server_name":f.server_name,"name":f.name,"saved_ms":f.saved_ms})
        })
        .collect();
    let bytes =
        serde_json::to_vec(&json!({"version":1,"favorites":entries})).map_err(|e| e.to_string())?;
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

pub struct ProfileFavorites(Mutex<Store>);

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE);
    app.manage(ProfileFavorites(Mutex::new(Store::load(path))));
    Ok(())
}

/// The saved characters for the window's status, or nothing while names are hidden.
pub fn listed(app: &AppHandle, hidden_names: bool) -> Value {
    if hidden_names {
        return json!([]);
    }
    let known = |id| {
        app.try_state::<crate::profile_api::ProfileApi>()
            .and_then(|api| api.server_name(id))
    };
    app.try_state::<ProfileFavorites>()
        .and_then(|state| state.0.lock().ok().map(|store| store.value(known)))
        .unwrap_or_else(|| json!([]))
}

pub fn set(app: &AppHandle, server_id: u16, name: &str, saved: bool) -> Result<Change, String> {
    let official = app
        .try_state::<crate::profile_api::ProfileApi>()
        .and_then(|api| api.server_name(server_id));
    let state = app.state::<ProfileFavorites>();
    let mut store = state.0.lock().map_err(|_| "Saved characters unavailable")?;
    store.set(
        server_id,
        name,
        saved,
        crate::profile_api::now_ms(),
        official,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("aion-favorites-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn saved_characters_survive_reload_newest_first_and_exactly_once() {
        let folder = folder("reload");
        let path = folder.join(FILE);
        let mut store = Store::load(path.clone());
        assert!(store.list.is_empty() && !folder.exists());
        assert_eq!(
            store
                .set(2403, "foxyyyynm", true, 1, Some("Triniel".into()))
                .unwrap(),
            Change::Saved
        );
        assert_eq!(
            store.set(1304, "Aahz", true, 2, None).unwrap(),
            Change::Saved
        );
        assert_eq!(
            store.set(1304, "Aahz", true, 3, None).unwrap(),
            Change::Unchanged
        );
        // Another server or another spelling is another character.
        assert_eq!(
            store.set(2404, "foxyyyynm", true, 4, None).unwrap(),
            Change::Saved
        );
        assert_eq!(
            store.set(2403, "FOXYYYYNM", true, 5, None).unwrap(),
            Change::Saved
        );
        let loaded = Store::load(path.clone());
        assert_eq!(loaded.list, store.list);
        let names: Vec<_> = loaded
            .list
            .iter()
            .map(|f| (f.server_id, f.name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                (2403, "FOXYYYYNM"),
                (2404, "foxyyyynm"),
                (1304, "Aahz"),
                (2403, "foxyyyynm")
            ]
        );
        // The official name saved with a character comes back from disk; a server no sheet
        // has named stays numeric (null) unless a sheet names it later.
        let listed = loaded.value(|_| None);
        assert_eq!(listed[3]["server_name"], "Triniel");
        assert_eq!(listed[2]["server_name"], Value::Null);
        let named = loaded.value(|id| (id == 1304).then(|| "Kaisinel".to_string()));
        assert_eq!(named[2]["server_name"], "Kaisinel");
        assert_eq!(named[1]["server_name"], Value::Null);
        assert_eq!(
            store.set(1304, "Aahz", false, 6, None).unwrap(),
            Change::Removed
        );
        assert_eq!(
            store.set(1304, "Aahz", false, 7, None).unwrap(),
            Change::Unchanged
        );
        assert_eq!(Store::load(path.clone()).list.len(), 3);
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn the_list_is_bounded_and_refuses_unobserved_characters() {
        let folder = folder("bounded");
        let mut store = Store::load(folder.join(FILE));
        for i in 0..MAX {
            store
                .set(1304, &format!("Name{i}"), true, i as u64, None)
                .unwrap();
        }
        let error = store.set(1304, "OneMore", true, 99, None).unwrap_err();
        assert!(error.contains("50"), "{error}");
        assert_eq!(store.list.len(), MAX);
        // Removing one makes room again.
        store.set(1304, "Name0", false, 100, None).unwrap();
        assert_eq!(
            store.set(1304, "OneMore", true, 101, None).unwrap(),
            Change::Saved
        );
        for (server, name) in [
            (1001, "Aahz"),
            (1304, "Player #12"),
            (1304, ""),
            (999, "Aahz"),
        ] {
            assert!(
                store.set(server, name, true, 0, None).is_err(),
                "{server} {name:?}"
            );
        }
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_failed_save_keeps_the_previous_list() {
        let folder = folder("failed");
        let path = folder.join(FILE);
        let mut store = Store::load(path.clone());
        fs::create_dir_all(&path).unwrap();
        assert!(store.set(1304, "Aahz", true, 1, None).is_err());
        assert!(store.list.is_empty());
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn corrupt_future_or_tampered_files_load_only_valid_entries_without_writing() {
        let folder = folder("invalid-file");
        let path = folder.join(FILE);
        fs::create_dir_all(&folder).unwrap();
        for bytes in [
            b"{broken".to_vec(),
            vec![b' '; MAX_BYTES as usize + 1],
            br#"{"version":2,"favorites":[{"server_id":1304,"name":"Aahz"}]}"#.to_vec(),
        ] {
            fs::write(&path, &bytes).unwrap();
            assert!(Store::load(path.clone()).list.is_empty());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let mixed = json!({"version":1,"favorites":[
            {"server_id":1304,"name":"Aahz","saved_ms":5},
            {"server_id":1304,"name":"Aahz","saved_ms":6},
            {"server_id":1001,"name":"Korean"},
            {"server_id":1304,"name":"a/b"},
            {"server_id":70000,"name":"Big"},
            {"name":"NoServer"}
        ]});
        fs::write(&path, mixed.to_string()).unwrap();
        let loaded = Store::load(path.clone());
        assert_eq!(loaded.list.len(), 1);
        assert_eq!(loaded.list[0].saved_ms, 5);
        let _ = fs::remove_dir_all(folder);
    }
}
