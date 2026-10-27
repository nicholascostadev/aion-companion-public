//! Version dispatch and structural limits shared by startup and native backup restore.
use companion_core::combat::{Catalogue, CombatLog};
use serde_json::Value;

pub fn settings(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > 512 * 1024 {
        return Err("Settings exceed 512 KiB".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let mut validation = crate::offline::Offline::default();
    validation.configure(value)
}

pub fn catalogue(bytes: &[u8]) -> Result<Catalogue, String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Catalogue exceeds 16 MiB".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if !value["skills"].is_array() || !value["npcs"].is_array() {
        return Err("Invalid catalogue structure".into());
    }
    let data: Catalogue = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if data.skills.len() > 50000
        || data.npcs.len() > 100000
        || data
            .skills
            .iter()
            .any(|s| s.id == 0 || s.name.len() > 1024 || s.specialties.len() > 100)
        || data.npcs.iter().any(|n| n.id == 0 || n.name.len() > 1024)
    {
        return Err("Invalid catalogue or excessive entries".into());
    }
    Ok(data)
}

pub fn log(bytes: &[u8], allow_empty: bool) -> Result<CombatLog, String> {
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("Log exceeds 256 MiB".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if !value.is_object() || !value["events"].is_array() || !value["id"].is_string() {
        return Err("Invalid native log structure".into());
    }
    let log: CombatLog = serde_json::from_value(value).map_err(|e| e.to_string())?;
    let empty = allow_empty && log.id.is_empty() && log.events.is_empty();
    if log.schema_version > 1
        || log.started_ms > 8_640_000_000_000_000
        || log.duration_ms > 31_536_000_000
        || (!empty && !valid_log_id(&log.id))
        || log.events.len() > 2_000_000
        || log.actors.len() > 4096
        || log.targets.len() > 16384
        || log.label.len() > 2048
        || log.run_id.len() > 256
        || log.warnings.len() > 256
        || log.warnings.iter().any(|s| s.len() > 4096)
        || log.actors.iter().any(|(id, a)| {
            *id != a.id || a.name.len() > 1024 || a.class.as_ref().is_some_and(|s| s.len() > 100)
        })
        || log
            .targets
            .iter()
            .any(|(id, t)| *id != t.id || t.name.len() > 1024)
        || log
            .events
            .iter()
            .try_fold(0u64, |sum, e| sum.checked_add(e.amount))
            .is_none()
        || log.events.iter().any(|e| {
            e.at_ms > 31_536_000_000
                || e.kind.is_empty()
                || e.kind.len() > 128
                || [e.x, e.y]
                    .into_iter()
                    .flatten()
                    .any(|n| !n.is_finite() || n.abs() > 1e12)
        })
    {
        return Err("Invalid native log or unsupported version".into());
    }
    // Versions 0 and 1 are explicitly supported. Legacy optional fields retain serde defaults.
    Ok(log)
}

pub fn valid_log_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn file(path: &str, bytes: &[u8]) -> Result<(), String> {
    match path {
        "offline/settings.json" => settings(bytes).map(|_| ()),
        "offline/pets.json" => crate::pets::validate_saved(bytes),
        _ => {
            let id = path
                .strip_prefix("offline/logs/")
                .and_then(|s| s.strip_suffix(".json"))
                .filter(|id| valid_log_id(id))
                .ok_or("File is not supported by native backup")?;
            let saved = log(bytes, false)?;
            if saved.id != id {
                return Err("Log identity does not match its file name".into());
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_optional_log_fields_remain_supported_but_future_or_empty_objects_do_not() {
        let legacy = log(br#"{"id":"legacy-fight","events":[]}"#, false).unwrap();
        assert_eq!(legacy.schema_version, 0);
        assert!(log(br#"{"schema_version":2,"id":"future","events":[]}"#, false).is_err());
        assert!(log(b"{}", true).is_err());
        assert!(log(br#"{"id":"../bad","events":[]}"#, false).is_err());
        let empty = serde_json::to_vec(&CombatLog::default()).unwrap();
        assert!(log(&empty, true).is_ok());
        assert!(log(&empty, false).is_err());
    }

    #[test]
    fn malformed_log_amounts_and_times_cannot_overflow_report_aggregation() {
        let value = serde_json::json!({"id":"overflow","events":[
            {"kind":"damage","amount":u64::MAX},
            {"kind":"damage","amount":1}
        ]});
        assert!(log(&serde_json::to_vec(&value).unwrap(), false).is_err());
        let value = serde_json::json!({"id":"time","started_ms":u64::MAX,"events":[]});
        assert!(log(&serde_json::to_vec(&value).unwrap(), false).is_err());
        let value =
            serde_json::json!({"id":"relative-time","events":[{"kind":"cast","at_ms":u64::MAX}]});
        assert!(log(&serde_json::to_vec(&value).unwrap(), false).is_err());
    }

    #[test]
    fn startup_preserves_invalid_settings_catalogue_checkpoint_and_index_before_defaults() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "aion-state-validation-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let names = [
            "settings.json",
            "catalogue.json",
            "active.json",
            "index.json",
        ];
        for name in names {
            std::fs::write(root.join(name), format!("broken-{name}")).unwrap();
        }
        let mut offline = crate::offline::Offline::default();
        offline.initialize(root.clone()).unwrap();
        assert!(offline.error.as_ref().unwrap().contains("preserved"));
        let entries: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        for name in names {
            let preserved = entries
                .iter()
                .find(|p| {
                    p.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(&format!("{name}.invalid-"))
                })
                .unwrap();
            assert_eq!(
                std::fs::read(preserved).unwrap(),
                format!("broken-{name}").as_bytes()
            );
        }
        assert!(offline.settings["hotkeys"]["toggle_lock"].is_string());
        let mut reloaded = crate::offline::Offline::default();
        reloaded.initialize(root.clone()).unwrap();
        assert!(reloaded.error.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
