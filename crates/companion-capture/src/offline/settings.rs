//! Settings and catalogue rules. Each takes the current value and returns the next
//! one, so they need no encounter, library or filesystem.
use companion_core::combat::Catalogue;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub fn defaults() -> Value {
    json!({"boss_alerts":false,"event_alerts":false,"dps_mode":"encounter","target_mode":"all","party_only":false,"idle_timeout_seconds":10,"dummy_length_seconds":0,"dummy_cooldown_seconds":5,"auto_save":true,"refresh_ms":250,"opacity":1.0,"scale":1.0,"fade_after_seconds":30,"fade_opacity":0.25,"hide_names":false,"compact_strip":false,"region":"global","locale":"en","hotkeys":{"toggle_overlay":"Ctrl+Shift+F9","toggle_lock":"Ctrl+Shift+F8","reset":"Ctrl+Shift+F6","copy_summary":"Ctrl+Shift+F5","compact_strip":"Ctrl+Shift+F4"},"presets":[],"active_preset":null,"alerts":[]})
}

/// The settings that result from applying `patch` to `current`, or why it is refused.
pub fn patched(current: &Value, patch: Value) -> Result<Value, String> {
    let object = patch.as_object().ok_or("Settings must be an object")?;
    let mut next = current.clone();
    for (key, value) in object {
        if next.get(key).is_none() {
            return Err(format!("Unknown setting: {key}"));
        }
        next[key] = value.clone();
    }
    for (key, min, max) in [
        ("idle_timeout_seconds", 1., 600.),
        ("dummy_length_seconds", 0., 300.),
        ("dummy_cooldown_seconds", 0., 300.),
        ("refresh_ms", 50., 1000.),
        ("opacity", 0.15, 1.),
        ("scale", 0.75, 2.),
        ("fade_after_seconds", 0., 600.),
        ("fade_opacity", 0.05, 1.),
    ] {
        let n = next[key].as_f64().ok_or_else(|| format!("Invalid {key}"))?;
        if !n.is_finite() || n < min || n > max {
            return Err(format!("{key} must be between {min} and {max}"));
        }
    }
    if next["dummy_length_seconds"]
        .as_u64()
        .is_none_or(|n| n > 0 && n < 10)
    {
        return Err("Dummy length is 0 or 10..300 seconds".into());
    }
    for key in [
        "party_only",
        "auto_save",
        "hide_names",
        "compact_strip",
        "boss_alerts",
        "event_alerts",
    ] {
        if !next[key].is_boolean() {
            return Err(format!("{key} must be true or false"));
        }
    }
    for (key, allowed) in [
        ("dps_mode", vec!["encounter", "active"]),
        ("target_mode", vec!["all", "boss"]),
        ("region", vec!["global", "twkr"]),
        (
            "locale",
            vec![
                "en", "pt", "pt-BR", "de", "es", "fr", "ja", "ko", "zh", "ru",
            ],
        ),
    ] {
        if !allowed.contains(&next[key].as_str().unwrap_or("")) {
            return Err(format!("Invalid {key}"));
        }
    }
    if next["presets"].as_array().is_none_or(|a| a.len() > 100)
        || next["alerts"].as_array().is_none_or(|a| a.len() > 200)
        || !next["hotkeys"].is_object()
        || serde_json::to_vec(&next).map_err(|e| e.to_string())?.len() > 512 * 1024
    {
        return Err("Settings exceed supported limits".into());
    }
    for key in [
        "idle_timeout_seconds",
        "dummy_cooldown_seconds",
        "refresh_ms",
        "fade_after_seconds",
    ] {
        if next[key].as_u64().is_none() {
            return Err(format!("{key} must be a whole number"));
        }
    }
    for key in [
        "toggle_overlay",
        "toggle_lock",
        "reset",
        "copy_summary",
        "compact_strip",
    ] {
        if next["hotkeys"][key].as_str().is_none_or(|s| s.len() > 100) {
            return Err(format!("Invalid {key} shortcut"));
        }
    }
    if next["hotkeys"]["toggle_lock"]
        .as_str()
        .unwrap_or("")
        .is_empty()
    {
        return Err("The lock shortcut is required to safely unlock the meter".into());
    }
    let mut preset_ids = BTreeSet::new();
    let mut bar_ids = BTreeSet::new();
    for preset in next["presets"].as_array().unwrap() {
        let id = preset["id"].as_str().ok_or("Preset id is required")?;
        if id.is_empty() || id.len() > 100 || !preset_ids.insert(id) {
            return Err("Preset ids must be unique".into());
        }
        if preset["name"]
            .as_str()
            .is_none_or(|s| s.trim().is_empty() || s.len() > 200)
        {
            return Err("Invalid preset name".into());
        }
        let bars = preset["bars"]
            .as_array()
            .ok_or("Preset bars must be an array")?;
        if bars.len() > 32 {
            return Err("A preset supports up to 32 bars".into());
        }
        for bar in bars {
            let id = bar["id"].as_str().ok_or("Bar id is required")?;
            if id.is_empty() || id.len() > 100 || !bar_ids.insert(id) {
                return Err("Bar ids must be unique".into());
            }
            if !["cooldowns", "buffs", "both"].contains(&bar["mode"].as_str().unwrap_or(""))
                || !["icons", "bars"].contains(&bar["appearance"].as_str().unwrap_or(""))
                || !bar["hidden"].is_boolean()
            {
                return Err("Invalid tracker bar options".into());
            }
            for (key, min, max) in [
                ("x", -20000., 20000.),
                ("y", -20000., 20000.),
                ("icon_size", 16., 128.),
            ] {
                if bar[key]
                    .as_f64()
                    .is_none_or(|n| !n.is_finite() || n < min || n > max)
                {
                    return Err(format!("Invalid tracker {key}"));
                }
            }
            if bar["skills"].as_array().is_none_or(|a| {
                a.len() > 128
                    || a.iter()
                        .any(|n| n.as_u64().is_none_or(|id| id == 0 || id > u32::MAX as u64))
            }) {
                return Err("Invalid tracker skills".into());
            }
        }
    }
    if !next["active_preset"].is_null()
        && !next["active_preset"]
            .as_str()
            .is_some_and(|id| preset_ids.contains(id))
    {
        return Err("Active preset does not exist".into());
    }
    let mut alert_ids = BTreeSet::new();
    for alert in next["alerts"].as_array().unwrap() {
        let id = alert["id"].as_str().ok_or("Alert id is required")?;
        if id.is_empty()
            || id.len() > 100
            || !alert_ids.insert(id)
            || !alert["enabled"].is_boolean()
        {
            return Err("Invalid alert id or state".into());
        }
        if alert["name"]
            .as_str()
            .is_none_or(|s| s.trim().is_empty() || s.len() > 200)
            || alert["sound"].as_str().is_none_or(|s| s.len() > 100)
            || alert["volume"]
                .as_f64()
                .is_none_or(|n| !(0.0..=1.0).contains(&n))
            || alert["lead_seconds"].as_u64().is_none_or(|n| n > 86400)
            || (!alert["at_ms"].is_null() && alert["at_ms"].as_u64().is_none())
            || (!alert["repeat_seconds"].is_null()
                && alert["repeat_seconds"]
                    .as_u64()
                    .is_none_or(|n| n > 31_536_000))
        {
            return Err("Invalid alert schedule".into());
        }
    }
    Ok(next)
}

/// The settings that result from moving tracker bars of one preset.
pub fn repositioned(current: &Value, preset_id: &str, positions: Value) -> Result<Value, String> {
    let moves = positions.as_array().ok_or("Positions must be an array")?;
    if moves.len() > 32 {
        return Err("Too many tracker positions".into());
    }
    let mut presets = current["presets"].clone();
    let preset = presets
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|p| p["id"].as_str() == Some(preset_id))
        .ok_or("Preset no longer exists")?;
    let bars = preset["bars"].as_array_mut().ok_or("Preset has no bars")?;
    let mut seen = BTreeSet::new();
    for movement in moves {
        let id = movement["bar_id"].as_str().ok_or("Bar id required")?;
        if !seen.insert(id) {
            return Err("Duplicate bar position".into());
        }
        let bar = bars
            .iter_mut()
            .find(|b| b["id"].as_str() == Some(id))
            .ok_or("Bar no longer exists")?;
        for key in ["x", "y"] {
            let n = movement[key]
                .as_i64()
                .filter(|n| (-20000..=20000).contains(n))
                .ok_or("Invalid tracker coordinate")?;
            bar[key] = n.into();
        }
    }
    patched(current, json!({"presets":presets}))
}

/// The catalogue that results from importing `json` into `current`.
pub fn catalogue_with_import(current: &Catalogue, json: &str) -> Result<Catalogue, String> {
    if json.len() > 16 * 1024 * 1024 {
        return Err("Catalogue exceeds 16 MiB".into());
    }
    let mut next: Catalogue = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if next.skills.len() > 50000
        || next.npcs.len() > 100000
        || next
            .skills
            .iter()
            .any(|s| s.id == 0 || s.name.is_empty() || s.name.len() > 240)
        || next.npcs.iter().any(|n| n.id == 0 || n.name.len() > 240)
    {
        return Err("Invalid catalogue entries".into());
    }
    next.skills.sort_by_key(|s| s.id);
    next.npcs.sort_by_key(|n| n.id);
    if next.skills.windows(2).any(|w| w[0].id == w[1].id)
        || next.npcs.windows(2).any(|w| w[0].id == w[1].id)
        || next.skills.iter().any(|s| {
            s.cooldown_ms.is_some_and(|n| n > 604800000) || s.charge_max.is_some_and(|n| n > 9)
        })
    {
        return Err("Duplicate ids or invalid catalogue timing".into());
    }
    // Metadata imports enrich the independent catalogue rather than removing
    // every built-in NPC when a file supplies a handful of skill durations.
    let mut skills = current
        .skills
        .iter()
        .map(|s| (s.id, s.clone()))
        .collect::<BTreeMap<_, _>>();
    for mut skill in next.skills {
        if let Some(old) = skills.get(&skill.id) {
            skill.class = skill.class.or(old.class.clone());
            skill.cooldown_ms = skill.cooldown_ms.or(old.cooldown_ms);
            skill.charge_max = skill.charge_max.or(old.charge_max);
            skill.specialty_mode = skill.specialty_mode.or(old.specialty_mode.clone());
            if skill.specialties.is_empty() {
                skill.specialties = old.specialties.clone();
            }
        }
        skills.insert(skill.id, skill);
    }
    let mut npcs = current
        .npcs
        .iter()
        .map(|n| (n.id, n.clone()))
        .collect::<BTreeMap<_, _>>();
    for npc in next.npcs {
        npcs.insert(npc.id, npc);
    }
    next = Catalogue {
        skills: skills.into_values().collect(),
        npcs: npcs.into_values().collect(),
    };
    if next.skills.len() > 50000 || next.npcs.len() > 100000 {
        return Err("Merged catalogue exceeds limits".into());
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_core::combat::{NpcInfo, SkillInfo};

    fn tracker_presets() -> Value {
        json!([{"id":"p","name":"Test","bars":[{"id":"b","name":"Bar","mode":"both","skills":[11010000],"x":0,"y":0,"icon_size":32,"appearance":"icons","hidden":false}]}])
    }

    #[test]
    fn a_patch_is_validated_against_the_current_settings_without_changing_them() {
        let current = defaults();
        assert!(patched(&current, json!({"opacity":0})).is_err());
        assert!(patched(&current, json!({"dummy_length_seconds":3})).is_err());
        assert!(patched(&current, json!({"unknown":1})).is_err());
        assert!(patched(&current, json!([])).is_err());
        let next = patched(&current, json!({"dps_mode":"active","opacity":0.7})).unwrap();
        assert_eq!(next["dps_mode"], "active");
        assert_eq!(next["opacity"], 0.7);
        assert_eq!(next["locale"], current["locale"]);
        assert_eq!(current, defaults());
        // An unchanged document is a valid patch of itself.
        assert_eq!(patched(&next, next.clone()).unwrap(), next);
    }

    #[test]
    fn positions_move_only_the_named_bars_of_an_existing_preset() {
        let current = patched(&defaults(), json!({"presets":tracker_presets(),"opacity":0.7})).unwrap();
        let next = repositioned(&current, "p", json!([{"bar_id":"b","x":41,"y":23}])).unwrap();
        assert_eq!(next["presets"][0]["bars"][0]["x"], 41);
        assert_eq!(next["presets"][0]["bars"][0]["y"], 23);
        assert_eq!(next["opacity"], 0.7);
        assert_eq!(current["presets"][0]["bars"][0]["x"], 0);
        for refused in [
            json!([{"bar_id":"missing","x":1,"y":2}]),
            json!([{"bar_id":"b","x":1,"y":2},{"bar_id":"b","x":3,"y":4}]),
            json!([{"bar_id":"b","x":20001,"y":2}]),
            json!({"bar_id":"b"}),
        ] {
            assert!(repositioned(&current, "p", refused).is_err());
        }
        assert!(repositioned(&current, "gone", json!([])).is_err());
    }

    #[test]
    fn a_catalogue_import_enriches_the_current_catalogue_and_rejects_invalid_entries() {
        let current = Catalogue {
            skills: vec![SkillInfo {
                id: 5,
                name: "Old".into(),
                cooldown_ms: Some(3000),
                ..Default::default()
            }],
            npcs: vec![NpcInfo {
                id: 77,
                name: "Boss".into(),
                boss: true,
                ..Default::default()
            }],
        };
        let next = catalogue_with_import(
            &current,
            r#"{"skills":[{"id":9,"name":"Added"},{"id":5,"name":"Renamed"}]}"#,
        )
        .unwrap();
        assert_eq!(
            next.skills.iter().map(|s| s.id).collect::<Vec<_>>(),
            vec![5, 9]
        );
        assert_eq!(next.skills[0].name, "Renamed");
        assert_eq!(next.skills[0].cooldown_ms, Some(3000));
        assert_eq!(next.npcs.len(), 1);
        assert_eq!(current.skills[0].name, "Old");
        for refused in [
            r#"{"skills":[{"id":0,"name":"Zero"}]}"#,
            r#"{"skills":[{"id":5,"name":""}]}"#,
            r#"{"skills":[{"id":5,"name":"A"},{"id":5,"name":"B"}]}"#,
            r#"{"skills":[{"id":5,"name":"A","charge_max":10}]}"#,
            "not json",
        ] {
            assert!(catalogue_with_import(&current, refused).is_err(), "{refused}");
        }
    }
}
