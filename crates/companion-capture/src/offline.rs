//! Durable local combat library and settings. No network client or external service.
use crate::reports::{has_boss_targets, CachedReport, LogSource, PollUpdate, ReportRequest};
use crate::storage::atomic;
use companion_core::combat::{ActorInfo, Catalogue, CombatEvent, CombatLog, TargetInfo};
use companion_core::wire::{entities::Entities, player_skill};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    path::PathBuf,
    sync::Arc,
};

pub(super) struct Offline {
    pub alerts_engine: Arc<std::sync::Mutex<crate::alerts::Alerts>>,
    pub alert_updates: VecDeque<crate::alerts_api::Update>,
    pub settings: Value,
    pub catalogue: Arc<Catalogue>,
    pub log: CombatLog,
    root: Option<PathBuf>,
    origin: Option<u64>,
    last_hit: u64,
    zone: Option<u32>,
    dungeon: Option<u32>,
    run: String,
    index: BTreeMap<String, Value>,
    pending_end: Option<(u64, String)>,
    disengaged: BTreeSet<u32>,
    blocked_until: u64,
    hp: BTreeMap<u32, u64>,
    vitals: BTreeMap<u32, (Option<u64>, Option<u64>)>,
    spawns: BTreeMap<u32, u32>,
    warm: VecDeque<CombatEvent>,
    cooldowns: BTreeMap<u32, Cooldown>,
    buffs: BTreeMap<(u32, u32), (u64, CombatEvent)>,
    local: Option<u32>,
    notices: VecDeque<Value>,
    pub error: Option<String>,
    last_checkpoint: u64,
    report_revision: u64,
    report_stream: u64,
    pub storage: Option<Arc<crate::storage::Storage>>,
    pub pending_saves: VecDeque<Vec<crate::storage::Write>>,
    pub pending_checkpoint: Option<crate::storage::Write>,
    pub persistence_error: Option<String>,
}
#[derive(Default)]
struct Cooldown {
    at: u64,
    raw: u64,
    samples: Vec<f64>,
}
#[derive(PartialEq, Eq)]
pub(super) struct ReportKey {
    revision: u64,
    stream: u64,
    id: String,
    label: String,
    events: usize,
    ended: Option<String>,
    boss: bool,
}
impl Cooldown {
    fn update(&mut self, at: u64, raw: u64) {
        if raw > self.raw {
            self.samples.clear();
        }
        let elapsed = at.saturating_sub(self.at);
        if (300..=5000).contains(&elapsed) && self.raw > raw && raw > 0 {
            let scale = (self.raw - raw) as f64 / elapsed as f64;
            if (0.1..=20.).contains(&scale) {
                self.samples.push(scale);
                if self.samples.len() > 8 {
                    self.samples.remove(0);
                }
            }
        }
        self.at = at;
        self.raw = raw;
    }
    fn remaining(&self, now: u64) -> Option<u64> {
        if self.raw == 0 {
            return Some(0);
        }
        if self.samples.len() < 3 || now.saturating_sub(self.at) > 5000 {
            return None;
        }
        let mut samples = self.samples.clone();
        samples.sort_by(f64::total_cmp);
        let scale = samples[samples.len() / 2];
        // Require consistent observed wall-clock slopes, never assume wire units.
        if samples.iter().any(|s| (s - scale).abs() / scale > 0.3) {
            return None;
        }
        Some(((self.raw as f64 / scale) as u64).saturating_sub(now.saturating_sub(self.at)))
    }
}
pub fn defaults() -> Value {
    json!({"boss_alerts":false,"event_alerts":false,"dps_mode":"encounter","target_mode":"all","party_only":false,"idle_timeout_seconds":10,"dummy_length_seconds":0,"dummy_cooldown_seconds":5,"auto_save":true,"refresh_ms":250,"opacity":1.0,"scale":1.0,"fade_after_seconds":30,"fade_opacity":0.25,"hide_names":false,"compact_strip":false,"region":"global","locale":"en","hotkeys":{"toggle_overlay":"Ctrl+Shift+F9","toggle_lock":"Ctrl+Shift+F8","reset":"Ctrl+Shift+F6","copy_summary":"Ctrl+Shift+F5","compact_strip":"Ctrl+Shift+F4"},"presets":[],"active_preset":null,"alerts":[]})
}
impl Default for Offline {
    fn default() -> Self {
        Self {
            alerts_engine: Arc::default(),
            alert_updates: VecDeque::new(),
            settings: defaults(),
            catalogue: Arc::default(),
            log: CombatLog::default(),
            root: None,
            origin: None,
            last_hit: 0,
            zone: None,
            dungeon: None,
            run: String::new(),
            index: BTreeMap::new(),
            pending_end: None,
            disengaged: BTreeSet::new(),
            blocked_until: 0,
            hp: BTreeMap::new(),
            vitals: BTreeMap::new(),
            spawns: BTreeMap::new(),
            warm: VecDeque::new(),
            cooldowns: BTreeMap::new(),
            buffs: BTreeMap::new(),
            local: None,
            notices: VecDeque::new(),
            error: None,
            last_checkpoint: 0,
            report_revision: 0,
            report_stream: 0,
            storage: None,
            pending_saves: VecDeque::new(),
            pending_checkpoint: None,
            persistence_error: None,
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
impl Offline {
    pub fn settings_write(&self, next: Value) -> Option<crate::storage::Write> {
        self.root
            .as_ref()
            .map(|root| crate::storage::Write::json(root.join("settings.json"), next))
    }
    pub fn catalogue_write(&self, next: Arc<Catalogue>) -> Option<crate::storage::Write> {
        self.root
            .as_ref()
            .map(|root| crate::storage::Write::json_arc(root.join("catalogue.json"), next))
    }
    pub fn replace_catalogue(&mut self, next: Arc<Catalogue>) {
        self.catalogue = next;
        self.report_revision = self.report_revision.wrapping_add(1);
    }
    pub fn initialize(&mut self, root: PathBuf) -> Result<(), String> {
        fs::create_dir_all(root.join("logs")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("exports")).map_err(|e| e.to_string())?;
        self.root = Some(root.clone());
        self.catalogue = Arc::new(
            serde_json::from_str(include_str!("../data/catalogue.json"))
                .map_err(|e| e.to_string())?,
        );
        let (settings, error) = crate::persistence::load_preserving(
            &root.join("settings.json"),
            512 * 1024,
            crate::state_validation::settings,
        )?;
        if let Some(settings) = settings {
            self.settings = settings;
        }
        self.error = error;
        let (catalogue, error) = crate::persistence::load_preserving(
            &root.join("catalogue.json"),
            16 * 1024 * 1024,
            crate::state_validation::catalogue,
        )?;
        if let Some(catalogue) = catalogue {
            self.catalogue = Arc::new(catalogue);
        }
        if let Some(error) = error {
            self.error = Some(error);
        }
        Arc::make_mut(&mut self.catalogue)
            .skills
            .sort_by_key(|s| s.id);
        Arc::make_mut(&mut self.catalogue)
            .npcs
            .sort_by_key(|n| n.id);
        let epoch_now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |t| t.as_millis() as u64);
        let mut alerts = self
            .alerts_engine
            .lock()
            .map_err(|_| "Alert state unavailable")?;
        if let Err(error) = alerts.initialize(root.clone(), &self.settings, epoch_now) {
            alerts.error = Some(error);
        }
        drop(alerts);
        let (active, error) = crate::persistence::load_preserving(
            &root.join("active.json"),
            256 * 1024 * 1024,
            |bytes| crate::state_validation::log(bytes, true),
        )?;
        if let Some(error) = error {
            self.error = Some(error);
        }
        if let Some(mut log) = active {
            if !log.events.is_empty() && valid_id(&log.id) && log.end_reason.is_none() {
                let saved_path = root.join("logs").join(format!("{}.json", log.id));
                let mut preserve_finished = false;
                if saved_path.try_exists().map_err(|e| e.to_string())? {
                    // A crash may occur after the completed log is confirmed but
                    // before its replaceable active checkpoint reaches the disk.
                    // Preserve finished saves, and prefer a newer manual save.
                    let saved = LogSource::File(saved_path.clone()).load()
                            .map_err(|error| format!("Cannot recover over an unreadable saved encounter; active checkpoint preserved: {error}"))?;
                    if saved.id != log.id {
                        return Err(
                            "Saved encounter identity differs; active checkpoint preserved".into(),
                        );
                    }
                    if saved.end_reason.is_some() {
                        preserve_finished = true;
                    } else if (saved.events.len(), saved.duration_ms)
                        > (log.events.len(), log.duration_ms)
                    {
                        log = saved;
                    }
                }
                if !preserve_finished {
                    log.end_reason = Some("recovered".into());
                    log.warnings.push("Recovered after the previous process ended; the final seconds may be incomplete.".into());
                    atomic(&saved_path, &log)?;
                }
            }
        }
        // Replace the checkpoint only after recovery succeeds.
        atomic(&root.join("active.json"), &CombatLog::default())?;
        let (index, error) = crate::persistence::load_preserving(
            &root.join("index.json"),
            32 * 1024 * 1024,
            |bytes| {
                let index: BTreeMap<String, Value> =
                    serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
                if index.len() > 10000
                    || index
                        .iter()
                        .any(|(id, value)| !valid_id(id) || !value.is_object())
                {
                    return Err("Invalid library index".into());
                }
                Ok(index)
            },
        )?;
        if let Some(index) = index {
            self.index = index;
        }
        if let Some(error) = error {
            self.error = Some(error);
        }
        self.index
            .retain(|id, _| valid_id(id) && root.join("logs").join(format!("{id}.json")).exists());
        for entry in fs::read_dir(root.join("logs"))
            .map_err(|e| e.to_string())?
            .take(10000)
            .flatten()
        {
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if path.extension().is_some_and(|e| e == "json")
                && !self.index.contains_key(id)
                && valid_id(id)
            {
                if let Ok(bytes) = crate::persistence::read_bounded(&path, 256 * 1024 * 1024) {
                    if let Ok(log) = crate::state_validation::log(&bytes, false) {
                        if log.id != id {
                            continue;
                        }
                        self.index.insert(id.into(), self.metadata(&log));
                    }
                }
            }
        }
        atomic(&root.join("index.json"), &self.index)?;
        Ok(())
    }
    pub fn configure(&mut self, patch: Value) -> Result<Value, String> {
        let object = patch.as_object().ok_or("Settings must be an object")?;
        let mut next = self.settings.clone();
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
        if let Some(root) = &self.root {
            atomic(&root.join("settings.json"), &next)?;
        }
        self.settings = next;
        Ok(self.settings.clone())
    }
    pub fn catalogue_import(&mut self, json: &str) -> Result<Value, String> {
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
        let mut skills = self
            .catalogue
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
        let mut npcs = self
            .catalogue
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
        if let Some(root) = &self.root {
            atomic(&root.join("catalogue.json"), &next)?;
        }
        self.catalogue = Arc::new(next);
        self.report_revision = self.report_revision.wrapping_add(1);
        Ok(json!({"skills":self.catalogue.skills.len(),"npcs":self.catalogue.npcs.len()}))
    }
    pub fn set_names(&mut self, names: &BTreeMap<u32, String>) {
        self.report_revision = self.report_revision.wrapping_add(1);
        let catalogue = Arc::make_mut(&mut self.catalogue);
        for (&id, name) in names {
            if !catalogue.skills.iter().any(|s| s.id == id) {
                catalogue.skills.push(companion_core::combat::SkillInfo {
                    id,
                    name: name.clone(),
                    ..Default::default()
                });
            }
        }
        catalogue.skills.sort_by_key(|s| s.id);
    }
    fn actor(&mut self, id: u32, entities: &Entities, event: Option<&CombatEvent>) {
        // Spawn names can describe a target, and do not prove player ownership.
        // Confirmed summons have already been mapped to their owner by the decoder.
        // Inside an observed instance, its observed group is authoritative. Some
        // traps/skill entities arrive without an understood spawn/owner record;
        // a player skill ID alone must not add them as extra dungeon members.
        if entities.spawned(id)
            || (self.dungeon_roster_active(entities) && !entities.party_member(id))
        {
            self.log.actors.remove(&id);
            return;
        }
        if id == 0 || self.log.actors.len() >= 256 {
            return;
        }
        let name = entities
            .name(id)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Player #{id}"));
        let member = entities.group_member(id);
        let a = self.log.actors.entry(id).or_insert_with(|| ActorInfo {
            id,
            ..Default::default()
        });
        a.name = name;
        a.local = entities.local == Some(id);
        a.party = entities.party_member(id);
        // Recipient-triggered party effects can carry another class's skill ID
        // even in cast packets (for example Sprint Mantra's self-heal proc).
        // Keep non-damage evidence as a fallback for healers, but let attacks
        // establish/correct the class without later effects overwriting it.
        if let Some(event) = event.filter(|event| {
            player_skill(event.skill) && (event.kind == "damage" || a.class.is_none())
        }) {
            a.class = Some(companion_core::wire::class_name(event.skill).into());
        }
        if let Some(m) = member {
            a.class = m.class.clone().or(a.class.clone());
            a.level = Some(m.level);
            a.server_id = m.server_id;
            a.gear_score = m.gear_score;
            a.combat_power = m.combat_power;
        }
    }
    pub fn receive(&mut self, events: Vec<CombatEvent>, entities: &Entities, now: u64, epoch: u64) {
        self.report_revision = self.report_revision.wrapping_add(1);
        self.alert_updates
            .push_back(crate::alerts_api::Update::Observe {
                server: entities.local_server_id(),
                events: events.clone(),
                catalogue: self.catalogue.clone(),
                now: epoch.saturating_add(now),
            });
        self.tick(now);
        self.local = entities.local;
        for mut e in events {
            if e.kind == "cast" && self.local.is_none_or(|id| e.source == id) {
                self.cooldowns.retain(|id, _| id / 10000 != e.skill / 10000);
            }
            if e.kind == "hp" && self.vitals.len() < 8192 {
                let old = self.vitals.entry(e.target).or_default();
                old.0 = e.current_hp.or(old.0);
                old.1 = e.max_hp.or(old.1);
            }
            if e.kind == "dungeon_state" {
                if e.amount == 3 && self.dungeon == Some(e.skill) {
                    let ended_at = if self.kill_pending() {
                        self.last_hit
                    } else {
                        now
                    };
                    self.finish("clear", ended_at);
                    self.run.clear();
                    self.dungeon = None;
                } else if e.amount != 3 && self.dungeon != Some(e.skill) {
                    self.finish("dungeon_change", now);
                    self.run = format!("run-{}", epoch + now);
                    self.dungeon = Some(e.skill);
                }
                continue;
            }
            while self.notices.front().is_some_and(|n| {
                n["due_ms"].as_u64().unwrap_or(0).saturating_add(15000) < epoch + now
            }) {
                self.notices.pop_front();
            }
            if e.kind == "field_event" {
                if self.settings["event_alerts"] == true {
                    self.notice(
                        format!("event-{}-{}", e.skill, e.instance),
                        format!("Field event #{} updated (state {})", e.skill, e.instance),
                        epoch + now,
                    );
                }
                continue;
            }
            if matches!(e.kind.as_str(), "field_event_snapshot" | "field_boss_state") {
                continue;
            }
            if matches!(e.kind.as_str(), "cast" | "damage" | "heal") {
                if let Some(max) = self.catalogue.skill(e.skill).and_then(|s| s.charge_max) {
                    let stage = (e.skill % 10) as u8;
                    if stage <= max {
                        e.charge = Some(stage);
                    }
                }
            }
            if e.kind == "zone" {
                if self.zone.is_some() && self.zone != e.zone_id {
                    self.finish("zone_change", now);
                    self.spawns.clear();
                    self.hp.clear();
                    self.vitals.clear();
                    self.warm.clear();
                    self.cooldowns.clear();
                    self.buffs.clear();
                    self.run = format!("run-{}", epoch + now);
                }
                self.zone = e.zone_id;
                continue;
            }
            if e.kind == "spawn" {
                self.vitals.remove(&e.target);
                self.hp.remove(&e.target);
                if self.settings["boss_alerts"] == true && !self.spawns.contains_key(&e.target) {
                    if let Some(npc) = self
                        .catalogue
                        .npcs
                        .iter()
                        .find(|npc| npc.id == e.skill && npc.boss)
                    {
                        self.notice(
                            format!("boss-{}-{}", e.target, epoch + now),
                            format!("{} appeared nearby", npc.name),
                            epoch + now,
                        );
                    }
                }
                if self.spawns.len() < 8192 {
                    self.spawns.insert(e.target, e.skill);
                }
                continue;
            }
            if e.kind == "cooldown" {
                if self.cooldowns.len() < 512 {
                    self.cooldowns
                        .entry(e.skill)
                        .or_default()
                        .update(now, e.amount);
                }
                continue;
            }
            if e.kind == "buff" && self.buffs.len() < 4096 {
                self.buffs.insert((e.target, e.instance), (now, e.clone()));
            }
            if e.kind == "buff_end" {
                self.buffs.remove(&(e.target, e.instance));
            }
            // Nearby combat is visible on the wire too. Only our own group's
            // positive outgoing damage can begin a pull or engage a new target.
            // Once engaged, retain other players' hits on that enemy and incoming
            // damage/healing for the current fight, without importing nearby pulls.
            let party_damage = e.kind == "damage"
                && e.amount > 0
                && entities.party_member(e.source)
                && !entities.spawned(e.source);
            let active =
                self.origin.is_some() && self.log.end_reason.is_none() && !self.kill_pending();
            if (e.kind == "damage" && e.amount == 0)
                || (matches!(e.kind.as_str(), "damage" | "heal")
                    && !party_damage
                    && (!active
                        || (e.kind == "damage"
                            && !self.log.targets.contains_key(&e.target)
                            && !entities.party_member(e.target))))
            {
                continue;
            }
            // Reaching a boss can follow path combat without an idle gap. Begin
            // a fresh encounter on our group's first boss hit so neither the
            // approach time nor its actors/events enter the boss's DPS clock.
            // Existing boss targets keep multi-phase fights on the same clock.
            if party_damage
                && self.origin.is_some()
                && self.log.end_reason.is_none()
                && !self.log.targets.values().any(|target| target.boss)
                && self
                    .spawns
                    .get(&e.target)
                    .and_then(|id| self.catalogue.npcs.iter().find(|npc| npc.id == *id))
                    .is_some_and(|npc| npc.boss)
            {
                self.finish("boss_pull", self.last_hit);
            }
            if e.kind == "damage"
                && self
                    .pending_end
                    .as_ref()
                    .is_some_and(|(_, why)| why == "kill")
                && self
                    .spawns
                    .get(&e.target)
                    .and_then(|id| self.catalogue.npcs.iter().find(|n| n.id == *id))
                    .is_some_and(|npc| !npc.boss && !npc.dummy)
            {
                self.finish("kill", self.last_hit);
            }
            let player_source = (player_skill(e.skill) && !entities.monster(e.source))
                || entities.known_player(e.source);
            if self.log.end_reason.is_some() {
                // Recovery healing after a kill is not a new pull. Keep the boss
                // result available until damage starts the next encounter.
                if e.kind == "heal"
                    && matches!(self.log.end_reason.as_deref(), Some("kill" | "clear"))
                {
                    continue;
                }
                if e.kind == "damage"
                    && matches!(self.log.end_reason.as_deref(), Some("kill" | "clear"))
                    && (!player_source
                        || entities.known_player(e.target)
                        || self.log.actors.contains_key(&e.target)
                        || self.hp.get(&e.target) == Some(&0))
                {
                    // Incoming effects and ticks on a dead boss cannot replace its result.
                    // A fresh spawn clears this HP observation and permits a pull.
                    continue;
                }
                if matches!(e.kind.as_str(), "damage" | "heal") {
                    self.report_stream = self.report_stream.wrapping_add(1);
                    self.log = CombatLog::default();
                    self.origin = None;
                } else {
                    continue;
                }
            }
            let combat = matches!(e.kind.as_str(), "damage" | "heal")
                && (player_source || entities.known_player(e.target));
            if self.origin.is_none() {
                if !combat || now < self.blocked_until {
                    e.at_ms = now;
                    self.warm.push_back(e);
                    while self.warm.len() > 2000
                        || self
                            .warm
                            .front()
                            .is_some_and(|old| old.at_ms.saturating_add(10000) < now)
                    {
                        self.warm.pop_front();
                    }
                    continue;
                }
                self.origin = Some(now);
                let stamp = epoch + now;
                if self.run.is_empty() {
                    self.run = format!("run-{stamp}");
                }
                self.report_stream = self.report_stream.wrapping_add(1);
                self.log = CombatLog {
                    schema_version: 1,
                    id: format!("fight-{stamp}"),
                    label: "Combat encounter".into(),
                    started_ms: stamp,
                    zone_id: self.zone,
                    run_id: self.run.clone(),
                    party_id: entities.party_id,
                    ..Default::default()
                };
                self.log.warnings.push("Direction flags follow the observed protocol; front/back geometry has not been validated on this character. Missing packet families remain unavailable.".into());
                for mut before in self.warm.drain(..) {
                    if before.kind == "hp" {
                        if let Some(duration) = before.duration_ms {
                            before.duration_ms =
                                Some(duration.saturating_sub(now.saturating_sub(before.at_ms)));
                        }
                        before.at_ms = 0;
                        self.log.events.push(before);
                    }
                }
                let effects = self
                    .buffs
                    .values()
                    .filter_map(|(at, buff)| {
                        let mut buff = buff.clone();
                        if let Some(duration) = buff.duration_ms {
                            let remaining = duration.saturating_sub(now.saturating_sub(*at));
                            if remaining == 0 {
                                return None;
                            }
                            buff.duration_ms = Some(remaining);
                        }
                        buff.at_ms = 0;
                        Some(buff)
                    })
                    .collect::<Vec<_>>();
                for buff in effects {
                    if entities.known_player(buff.source) {
                        self.actor(buff.source, entities, None);
                    }
                    if entities.known_player(buff.target) {
                        self.actor(buff.target, entities, None);
                    }
                    self.log.events.push(buff);
                }
            }
            let origin = self.origin.unwrap();
            e.at_ms = now.saturating_sub(origin);
            self.log.duration_ms = e.at_ms.max(self.log.duration_ms);
            self.log.party_id = entities.party_id;
            if player_source && e.source > 0 {
                self.actor(e.source, entities, Some(&e));
            }
            if entities.known_player(e.target) {
                self.actor(e.target, entities, None);
            }
            if e.kind == "damage" && !self.log.actors.contains_key(&e.target) {
                self.disengaged.remove(&e.target);
                let npc = self.spawns.get(&e.target).copied();
                let metadata = npc.and_then(|id| self.catalogue.npcs.iter().find(|n| n.id == id));
                let t = self
                    .log
                    .targets
                    .entry(e.target)
                    .or_insert_with(|| TargetInfo {
                        id: e.target,
                        npc_id: npc,
                        name: metadata
                            .map_or_else(|| format!("Target #{}", e.target), |m| m.name.clone()),
                        boss: metadata.is_some_and(|m| m.boss),
                        dummy: metadata.is_some_and(|m| m.dummy),
                        berserk_seconds: metadata.and_then(|m| m.berserk_seconds),
                        ..Default::default()
                    });
                if let Some((current, max)) = self.vitals.get(&e.target) {
                    t.current_hp = *current;
                    t.max_hp = *max;
                    t.dead = *current == Some(0);
                }
                t.damage = t.damage.saturating_add(e.amount);
                if (t.boss || t.dummy) && self.log.label == "Combat encounter" {
                    self.log.label = t.name.clone();
                }
                if t.boss
                    && !t.dead
                    && self.pending_end.as_ref().is_some_and(|(_, why)| {
                        matches!(why.as_str(), "kill" | "despawn" | "reset")
                    })
                {
                    self.pending_end = None;
                }
            }
            if e.kind == "hp" {
                if let Some(t) = self.log.targets.get_mut(&e.target) {
                    t.max_hp = e.max_hp.or(t.max_hp);
                }
                if let Some(hp) = e.current_hp {
                    let previous = self.hp.insert(e.target, hp);
                    if let Some(t) = self.log.targets.get_mut(&e.target) {
                        t.current_hp = Some(hp);
                        t.max_hp = e.max_hp.or(t.max_hp);
                        t.dead = hp == 0;
                        if hp == 0 && previous != Some(0) && t.boss {
                            self.pending_end = Some((now + 15000, "kill".into()));
                        }
                    }
                    if self.log.actors.contains_key(&e.target) && previous != Some(hp) {
                        if hp == 0 {
                            let mut death = CombatEvent::new("death");
                            death.target = e.target;
                            death.at_ms = e.at_ms;
                            self.log.events.push(death);
                        } else if previous == Some(0) {
                            let mut revive = CombatEvent::new("revive");
                            revive.target = e.target;
                            revive.at_ms = e.at_ms;
                            self.log.events.push(revive);
                        }
                    }
                }
            }
            if e.kind == "death" {
                if self.hp.get(&e.target) == Some(&0) {
                    continue;
                }
                self.hp.insert(e.target, 0);
                if let Some(t) = self.log.targets.get_mut(&e.target) {
                    t.dead = true;
                    t.current_hp = Some(0);
                    if t.boss {
                        self.pending_end = Some((now + 15000, "kill".into()));
                    }
                }
            }
            if self
                .pending_end
                .as_ref()
                .is_some_and(|(_, why)| why == "kill")
                && self.log.targets.values().any(|t| t.boss && !t.dead)
            {
                self.pending_end = None;
            }
            if e.kind == "hp"
                && e.current_hp.is_some_and(|hp| hp > 0)
                && self.log.actors.contains_key(&e.target)
                && self
                    .pending_end
                    .as_ref()
                    .is_some_and(|(_, why)| why == "wipe")
            {
                self.pending_end = None;
            }
            if e.kind == "despawn" && self.log.targets.get(&e.target).is_some_and(|t| t.boss) {
                // A removal alone can also be a phase transition. Only a known
                // zero-HP target is a kill; otherwise retain a reset candidate.
                let why = if self.log.targets[&e.target].dead {
                    "kill"
                } else {
                    "despawn"
                };
                let deadline = self
                    .pending_end
                    .as_ref()
                    .filter(|(_, pending)| pending == "kill")
                    .map_or(now + 5000, |(at, _)| (*at).max(now + 5000));
                self.pending_end = Some((deadline, why.into()));
            }
            if e.kind == "reset" && self.log.targets.get(&e.target).is_some_and(|t| t.boss) {
                self.disengaged.insert(e.target);
            }
            if e.kind == "reset"
                && self.log.targets.get(&e.target).is_some_and(|t| t.boss)
                && self
                    .log
                    .targets
                    .values()
                    .filter(|t| t.boss)
                    .all(|t| t.dead || self.disengaged.contains(&t.id))
                && !self
                    .pending_end
                    .as_ref()
                    .is_some_and(|(_, why)| why == "kill")
            {
                self.pending_end = Some((now + 1000, "reset".into()));
            }
            if matches!(e.kind.as_str(), "hp" | "death")
                && entities.group_members().len() > 1
                && entities.group_members().iter().all(|m| {
                    self.log.actors.values().any(|a| {
                        a.name == m.name
                            && a.server_id.is_some()
                            && a.server_id == m.server_id
                            && self.hp.get(&a.id) == Some(&0)
                    })
                })
                && !self
                    .pending_end
                    .as_ref()
                    .is_some_and(|(_, why)| why == "kill")
            {
                self.pending_end = Some((now + 2000, "wipe".into()));
            }
            let boss_encounter = self.log.targets.values().any(|target| target.boss);
            let boss_damage = e.kind == "damage"
                && (self
                    .log
                    .targets
                    .get(&e.target)
                    .is_some_and(|target| target.boss)
                    || self
                        .log
                        .targets
                        .get(&e.source)
                        .is_some_and(|target| target.boss));
            if combat
                && (!boss_encounter || boss_damage)
                && (!self.kill_pending()
                    || (e.kind == "damage"
                        && self.log.actors.contains_key(&e.source)
                        && !self.log.actors.contains_key(&e.target)))
            {
                self.last_hit = now;
            }
            if self.log.events.len() < companion_core::MAX_EVENTS {
                self.log.events.push(e);
            } else {
                self.finish("event_limit", now);
            }
        }
        let ids: Vec<_> = self.log.actors.keys().copied().collect();
        for id in ids {
            self.actor(id, entities, None);
        }
        if now.saturating_sub(self.last_checkpoint) >= 5000 && !self.log.events.is_empty() {
            self.last_checkpoint = now;
            self.checkpoint();
        }
    }
    pub fn tick(&mut self, now: u64) {
        if self.origin.is_none() || self.log.end_reason.is_some() {
            return;
        }
        let elapsed = now.saturating_sub(self.origin.unwrap());
        let dummy = self.log.targets.values().any(|t| t.dummy);
        let cap = self.settings["dummy_length_seconds"].as_u64().unwrap_or(0) * 1000;
        if dummy && cap > 0 && elapsed >= cap {
            self.report_stream = self.report_stream.wrapping_add(1);
            self.log.events.retain(|e| e.at_ms <= cap);
            self.finish("dummy_cap", self.origin.unwrap().saturating_add(cap));
            self.blocked_until = now
                + self.settings["dummy_cooldown_seconds"]
                    .as_u64()
                    .unwrap_or(5)
                    * 1000;
            return;
        }
        if let Some((at, why)) = self.pending_end.clone() {
            if now >= at {
                self.finish(&why, self.last_hit.max(self.origin.unwrap()));
            } else {
                self.log.duration_ms = if why == "kill" {
                    self.last_hit.saturating_sub(self.origin.unwrap())
                } else {
                    elapsed
                };
            }
            return;
        }
        let boss = self.log.targets.values().any(|t| t.boss && !t.dead);
        if !boss
            && now.saturating_sub(self.last_hit)
                >= self.settings["idle_timeout_seconds"].as_u64().unwrap_or(10) * 1000
        {
            self.finish("idle", self.last_hit);
        } else {
            self.log.duration_ms = elapsed;
        }
    }
    pub fn finish(&mut self, reason: &str, now: u64) {
        if self.log.events.is_empty() || self.log.end_reason.is_some() {
            return;
        }
        self.log.end_reason = Some(reason.into());
        self.log.duration_ms = now.saturating_sub(self.origin.unwrap_or(now));
        self.pending_end = None;
        self.disengaged.clear();
        if self.settings["auto_save"].as_bool().unwrap_or(true) {
            if let Err(error) = self.save() {
                self.error = Some(error);
            }
        }
        self.checkpoint();
    }
    pub fn save(&mut self) -> Result<Value, String> {
        let root = self
            .root
            .as_ref()
            .ok_or("Local library is not initialized")?;
        if self.log.events.is_empty() || !valid_id(&self.log.id) {
            return Err("No combat has been recorded".into());
        }
        let meta = self.metadata(&self.log);
        self.index.insert(self.log.id.clone(), meta.clone());
        if self.storage.is_some() {
            self.pending_saves.push_back(vec![
                crate::storage::Write::json(
                    root.join("logs").join(format!("{}.json", self.log.id)),
                    self.log.clone(),
                ),
                crate::storage::Write::json(root.join("index.json"), self.index.clone()),
            ]);
        } else {
            atomic(
                &root.join("logs").join(format!("{}.json", self.log.id)),
                &self.log,
            )?;
            atomic(&root.join("index.json"), &self.index)?;
        }
        Ok(meta)
    }
    pub fn clear(&mut self) {
        self.report_revision = self.report_revision.wrapping_add(1);
        self.report_stream = self.report_stream.wrapping_add(1);
        self.log = CombatLog::default();
        self.origin = None;
        self.pending_end = None;
        self.disengaged.clear();
        self.checkpoint();
    }
    fn checkpoint(&mut self) {
        if let Some(root) = &self.root {
            let path = root.join("active.json");
            let result = if self.storage.is_some() {
                self.pending_checkpoint = Some(crate::storage::Write::json(path, self.log.clone()));
                Ok(())
            } else {
                atomic(&path, &self.log)
            };
            if let Err(error) = result {
                self.error = Some(error);
            }
        }
    }
    pub fn reset_connection(&mut self, now: u64) {
        self.alert_updates
            .push_back(crate::alerts_api::Update::Reset(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_millis() as u64),
            ));
        self.finish("connection_change", now);
        self.clear();
        self.warm.clear();
        self.spawns.clear();
        self.hp.clear();
        self.vitals.clear();
        self.dungeon = None;
        self.notices.clear();
        self.cooldowns.clear();
        self.buffs.clear();
        self.local = None;
        self.blocked_until = 0;
        self.last_checkpoint = 0;
        self.last_hit = 0;
        self.zone = None;
        self.run.clear();
    }
    pub fn report_key(&self) -> ReportKey {
        ReportKey {
            revision: self.report_revision,
            stream: self.report_stream,
            id: self.log.id.clone(),
            label: self.log.label.clone(),
            events: self.log.events.len(),
            ended: self.report_end_reason(),
            boss: has_boss_targets(&self.log),
        }
    }
    fn kill_pending(&self) -> bool {
        self.pending_end
            .as_ref()
            .is_some_and(|(_, why)| why == "kill")
    }
    pub(super) fn dungeon_roster_active(&self, entities: &Entities) -> bool {
        self.dungeon.is_some() && entities.party_count() > 0
    }
    fn report_end_reason(&self) -> Option<String> {
        self.log
            .end_reason
            .clone()
            .or_else(|| self.kill_pending().then(|| "kill".into()))
    }
    fn report_duration(&self) -> u64 {
        if self.kill_pending() {
            self.last_hit
                .saturating_sub(self.origin.unwrap_or(self.last_hit))
        } else {
            self.log.duration_ms
        }
    }
    fn report_snapshot(&self) -> CombatLog {
        let mut log = self.log.clone();
        // Present the completed result immediately, but keep the internal grace
        // period so a second boss phase can resume this same encounter.
        log.end_reason = self.report_end_reason();
        log.duration_ms = self.report_duration();
        log
    }
    pub fn poll_update(&self, now: u64, previous: Option<&CachedReport>) -> PollUpdate {
        let prefix_len = previous
            .filter(|cached| {
                cached.key.stream == self.report_stream
                    && cached.log.id == self.log.id
                    && cached.log.events.len() <= self.log.events.len()
            })
            .map_or(0, |cached| cached.log.events.len());
        // Intentionally enumerate metadata: adding a CombatLog field must update
        // this snapshot too, and the compiler enforces that requirement.
        let log = CombatLog {
            schema_version: self.log.schema_version,
            id: self.log.id.clone(),
            label: self.log.label.clone(),
            started_ms: self.log.started_ms,
            duration_ms: self.report_duration(),
            end_reason: self.report_end_reason(),
            zone_id: self.log.zone_id,
            run_id: self.log.run_id.clone(),
            party_id: self.log.party_id,
            actors: self.log.actors.clone(),
            targets: self.log.targets.clone(),
            events: self.log.events[prefix_len..].to_vec(),
            warnings: self.log.warnings.clone(),
        };
        PollUpdate {
            log,
            prefix_len,
            catalogue: self.catalogue.clone(),
            now_ms: now.saturating_sub(self.origin.unwrap_or(now)),
            party_only: true,
            boss_only: has_boss_targets(&self.log),
        }
    }
    #[cfg(test)]
    pub fn report_request(&self, now: u64) -> ReportRequest {
        let boss = has_boss_targets(&self.log);
        ReportRequest {
            source: LogSource::Snapshot(self.report_snapshot()),
            catalogue: self.catalogue.clone(),
            now_ms: Some(now.saturating_sub(self.origin.unwrap_or(now))),
            party_only: true,
            boss_only: boss,
            detail_limit: Some(25000),
        }
    }
    /// Explicit inspection keeps every event, including the start of a long fight.
    /// An encounter transition must never substitute the new fight for the requested one.
    pub fn inspect_request(&self, id: &str, now: u64) -> Result<ReportRequest, String> {
        if !valid_id(id) {
            return Err("Invalid log selection".into());
        }
        if self.log.id == id {
            return Ok(ReportRequest {
                source: LogSource::Snapshot(self.report_snapshot()),
                catalogue: self.catalogue.clone(),
                now_ms: Some(now.saturating_sub(self.origin.unwrap_or(now))),
                party_only: false,
                boss_only: false,
                detail_limit: None,
            });
        }
        self.read_request(id, false)
    }
    #[cfg(test)]
    pub fn report(&self, now: u64) -> Value {
        self.report_request(now).execute().unwrap()
    }
    #[cfg(test)]
    pub fn inspect(&self, id: &str, now: u64) -> Result<Value, String> {
        self.inspect_request(id, now)?.execute()
    }
    fn metadata(&self, log: &CombatLog) -> Value {
        let damage: u64 = log
            .events
            .iter()
            .filter(|e| {
                e.kind == "damage"
                    && log.actors.contains_key(&e.source)
                    && !log.actors.contains_key(&e.target)
            })
            .map(|e| e.amount)
            .sum();
        json!({"id":log.id,"label":log.label,"started_ms":log.started_ms,"duration_ms":log.duration_ms,"damage":damage,"dps":damage as f64*1000./log.duration_ms.max(1000)as f64,"players":log.actors.values().map(|a|a.name.clone()).collect::<Vec<_>>(),"boss":log.targets.values().find(|t|t.boss||t.dummy).map(|t|t.name.clone()),"zone_id":log.zone_id,"run_id":log.run_id,"end_reason":log.end_reason})
    }
    pub fn logs(&self, query: &Value) -> Result<Vec<Value>, String> {
        let mut rows = Vec::new();
        let search = query["search"].as_str().unwrap_or("").to_lowercase();
        for m in self.index.values() {
            if !search.is_empty() && !m.to_string().to_lowercase().contains(&search) {
                continue;
            }
            if let Some(boss) = query["boss"].as_str() {
                if !boss.is_empty()
                    && !m["boss"]
                        .as_str()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&boss.to_lowercase())
                {
                    continue;
                }
            }
            if let Some(zone) = query["zone_id"].as_u64() {
                if m["zone_id"].as_u64() != Some(zone) {
                    continue;
                }
            }
            if let Some(run) = query["run_id"].as_str() {
                if !run.is_empty() && m["run_id"].as_str() != Some(run) {
                    continue;
                }
            }
            let started = m["started_ms"].as_u64().unwrap_or(0);
            if query["from_ms"].as_u64().is_some_and(|n| started < n)
                || query["to_ms"].as_u64().is_some_and(|n| started > n)
            {
                continue;
            }
            rows.push(m.clone());
        }
        let key = match query["sort"].as_str() {
            Some("damage") => "damage",
            Some("dps") => "dps",
            _ => "started_ms",
        };
        rows.sort_by(|a, b| {
            b[key]
                .as_f64()
                .unwrap_or(0.)
                .total_cmp(&a[key].as_f64().unwrap_or(0.))
        });
        Ok(rows
            .into_iter()
            .skip(query["offset"].as_u64().unwrap_or(0) as usize)
            .take(query["limit"].as_u64().unwrap_or(200).min(2000) as usize)
            .collect())
    }
    pub fn library_count(&self) -> usize {
        self.index.len()
    }
    pub fn positions(&mut self, preset_id: &str, positions: Value) -> Result<Value, String> {
        let moves = positions.as_array().ok_or("Positions must be an array")?;
        if moves.len() > 32 {
            return Err("Too many tracker positions".into());
        }
        let mut presets = self.settings["presets"].clone();
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
        self.configure(json!({"presets":presets}))
    }
    pub fn capture_quality(&mut self, stats: &Value) {
        self.report_revision = self.report_revision.wrapping_add(1);
        const PREFIX: &str = "Capture quality:";
        self.log.warnings.retain(|w| !w.starts_with(PREFIX));
        let mut issues = Vec::new();
        for key in ["gaps", "dropped", "rejected", "metadata_dropped"] {
            let n = stats[key].as_u64().unwrap_or(0);
            if n > 0 {
                issues.push(format!("{key}={n}"));
            }
        }
        if !issues.is_empty() {
            self.log.warnings.push(format!(
                "{PREFIX} {} during this capture. Some data may be incomplete.",
                issues.join(", ")
            ));
        }
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("Invalid local log id".into());
        }
        Ok(self
            .root
            .as_ref()
            .ok_or("Library not initialized")?
            .join("logs")
            .join(format!("{id}.json")))
    }
    #[cfg(test)]
    pub fn load(&self, id: &str) -> Result<CombatLog, String> {
        LogSource::File(self.path(id)?).load()
    }
    #[cfg(test)]
    pub fn read(&self, id: &str) -> Result<Value, String> {
        self.read_filtered(id, false)
    }
    #[cfg(test)]
    pub fn read_filtered(&self, id: &str, boss_only: bool) -> Result<Value, String> {
        self.read_request(id, boss_only)?.execute()
    }
    pub fn read_request(&self, id: &str, boss_only: bool) -> Result<ReportRequest, String> {
        Ok(ReportRequest {
            source: LogSource::File(self.path(id)?),
            catalogue: self.catalogue.clone(),
            now_ms: None,
            // The saved meter requests this view even for ordinary encounters.
            // Full log inspection continues to include every recorded actor.
            party_only: boss_only,
            boss_only,
            detail_limit: None,
        })
    }
    #[cfg(test)]
    pub fn rename(&mut self, id: &str, label: &str) -> Result<Value, String> {
        let log = self.load(id)?;
        self.rename_loaded(id, label, log)
    }
    pub fn rename_loaded(
        &mut self,
        id: &str,
        label: &str,
        log: CombatLog,
    ) -> Result<Value, String> {
        if label.trim().is_empty() || label.len() > 200 {
            return Err("Use a label of 1..200 bytes".into());
        }
        let mut log = if self.log.id == id {
            self.log.clone()
        } else {
            log
        };
        log.label = label.trim().into();
        if self.log.id == id {
            self.log.label = log.label.clone();
        }
        let meta = self.metadata(&log);
        self.index.insert(id.into(), meta.clone());
        let path = self.path(id)?;
        let index = self.root.as_ref().unwrap().join("index.json");
        if self.storage.is_some() {
            self.pending_saves.push_back(vec![
                crate::storage::Write::json(path, log),
                crate::storage::Write::json(index, self.index.clone()),
            ]);
        } else {
            atomic(&path, &log)?;
            atomic(&index, &self.index)?;
        }
        Ok(meta)
    }
    pub fn delete(&mut self, ids: &[String]) -> Result<usize, String> {
        if ids.len() > 10000 || ids.iter().any(|id| !valid_id(id)) {
            return Err("Invalid log selection".into());
        }
        let mut count = 0;
        let mut writes = Vec::new();
        for id in ids {
            let path = self.path(id)?;
            if self.storage.is_some() {
                count += usize::from(self.index.contains_key(id));
                writes.push(crate::storage::Write::remove(path));
            } else if path.exists() {
                crate::persistence::remove(&path)?;
                count += 1;
            }
            self.index.remove(id);
        }
        if let Some(root) = &self.root {
            if self.storage.is_some() {
                writes.push(crate::storage::Write::json(
                    root.join("index.json"),
                    self.index.clone(),
                ));
                self.pending_saves.push_back(writes);
            } else {
                atomic(&root.join("index.json"), &self.index)?;
            }
        }
        Ok(count)
    }
    pub fn export_path(&self, id: &str) -> Result<PathBuf, String> {
        self.path(id)?;
        Ok(self
            .root
            .as_ref()
            .unwrap()
            .join("exports")
            .join(format!("{id}.json")))
    }
    pub fn data_folder(&self) -> Result<String, String> {
        Ok(self
            .root
            .as_ref()
            .ok_or("Library not initialized")?
            .to_string_lossy()
            .into())
    }
    pub fn trackers(&self, now: u64) -> Vec<Value> {
        let mut out = Vec::new();
        let Some(presets) = self.settings["presets"].as_array() else {
            return out;
        };
        let selected = self.settings["active_preset"]
            .as_str()
            .or_else(|| presets.first().and_then(|p| p["id"].as_str()));
        for preset in presets {
            if preset["id"].as_str() != selected {
                continue;
            }
            if let Some(bars) = preset["bars"].as_array() {
                for bar in bars {
                    if bar["hidden"] == true {
                        continue;
                    }
                    if let Some(skills) = bar["skills"].as_array() {
                        for skill in skills {
                            let Some(id) = skill.as_u64().map(|n| n as u32) else {
                                continue;
                            };
                            let mode = bar["mode"].as_str().unwrap_or("both");
                            if mode != "buffs" {
                                let observed =
                                    self.cooldowns.get(&id).and_then(|s| s.remaining(now));
                                if let Some(remaining) = observed {
                                    let estimated =
                                        self.cooldowns.get(&id).is_none_or(|c| c.raw != 0);
                                    out.push(json!({"bar_id":bar["id"],"skill":id,"name":self.catalogue.name(id),"remaining_ms":remaining,"kind":"cooldown","source":self.local,"target":null,"estimated":estimated,"basis":if estimated{"observed wall-clock calibration"}else{"observed ready (wire zero)"}}));
                                }
                                let cooldown = self.catalogue.skill(id).and_then(|s| s.cooldown_ms);
                                if let Some(ms) = cooldown.filter(|_| observed.is_none()) {
                                    let last = self.log.events.iter().rev().find(|e| {
                                        e.source != 0
                                            && e.skill == id
                                            && e.kind == "cast"
                                            && self
                                                .log
                                                .actors
                                                .get(&e.source)
                                                .is_some_and(|a| a.local)
                                    });
                                    if let Some(cast) = last {
                                        let remaining = ms.saturating_sub(
                                            now.saturating_sub(self.origin.unwrap_or(now))
                                                .saturating_sub(cast.at_ms),
                                        );
                                        out.push(json!({"bar_id":bar["id"],"skill":id,"name":self.catalogue.name(id),"remaining_ms":remaining,"kind":"cooldown","source":cast.source,"target":cast.target,"estimated":true,"basis":"catalogue duration since cast"}));
                                    }
                                }
                            }
                            if mode != "cooldowns" {
                                for (at, buff) in self.buffs.values() {
                                    let remaining = buff.duration_ms.map(|duration| {
                                        duration.saturating_sub(now.saturating_sub(*at))
                                    });
                                    if buff.skill == id
                                        && Some(buff.target) == self.local
                                        && remaining != Some(0)
                                    {
                                        out.push(json!({"bar_id":bar["id"],"skill":id,"name":self.catalogue.name(id),"remaining_ms":remaining,"kind":"buff","source":buff.source,"target":buff.target,"estimated":false,"basis":"observed buff duration"}));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        out
    }
    pub fn alerts(&self, epoch_now: u64) -> Vec<Value> {
        let mut out = self
            .notices
            .iter()
            .filter(|n| {
                n["due_ms"]
                    .as_u64()
                    .is_some_and(|due| due.saturating_add(15000) >= epoch_now)
            })
            .cloned()
            .map(|mut n| {
                n["remaining_ms"] =
                    json!(n["due_ms"].as_u64().unwrap_or(epoch_now) as i128 - epoch_now as i128);
                n
            })
            .collect::<Vec<_>>();
        if let Some(alerts) = self.settings["alerts"].as_array() {
            for a in alerts {
                if a["enabled"] != true {
                    continue;
                }
                let Some(first) = a["at_ms"].as_u64() else {
                    continue;
                };
                let repeat = a["repeat_seconds"]
                    .as_u64()
                    .unwrap_or(0)
                    .saturating_mul(1000);
                let due = if first < epoch_now && repeat > 0 {
                    // Keep the just-due occurrence for one poll window, so crossing
                    // a repeat boundary cannot skip its audio notification.
                    let current =
                        first.saturating_add(((epoch_now - first) / repeat).saturating_mul(repeat));
                    if epoch_now.saturating_sub(current) <= 2000 {
                        current
                    } else {
                        current.saturating_add(repeat)
                    }
                } else {
                    first
                };
                if due.saturating_add(60000) < epoch_now {
                    continue;
                }
                out.push(json!({"id":a["id"],"name":a["name"],"due_ms":due,"remaining_ms":due as i128-epoch_now as i128,"sound":a["sound"],"volume":a["volume"],"lead_seconds":a["lead_seconds"]}));
            }
        }
        out
    }
    fn notice(&mut self, id: String, name: String, due: u64) {
        if self.notices.iter().any(|n| n["id"] == id) {
            return;
        }
        self.notices.push_back(json!({"id":id,"name":name,"due_ms":due,"remaining_ms":0,"sound":"chime","volume":0.5,"lead_seconds":0}));
        while self.notices.len() > 32 {
            self.notices.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recipient_effects_do_not_replace_attack_class() {
        for kind in ["cast", "heal", "buff", "windup"] {
            let mut offline = Offline::default();
            offline.settings["auto_save"] = false.into();
            let mut entities = Entities::default();
            entities.local = Some(14749);
            offline.receive(
                vec![CombatEvent {
                    source: 14749,
                    target: 33644,
                    skill: 14340230,
                    amount: 1112,
                    ..CombatEvent::new("damage")
                }],
                &entities,
                170596,
                100000,
            );
            offline.receive(
                vec![CombatEvent {
                    source: 14749,
                    target: 14749,
                    skill: 18160002,
                    amount: if kind == "heal" { 200 } else { 0 },
                    ..CombatEvent::new(kind)
                }],
                &entities,
                170695,
                100000,
            );
            assert_eq!(
                offline.log.actors[&14749].class.as_deref(),
                Some("Ranger"),
                "Sprint Mantra {kind} must not change the recipient's class"
            );
        }
    }
    #[test]
    fn attack_class_corrects_effect_fallback_without_losing_healer_detection() {
        let mut offline = Offline::default();
        offline.settings["auto_save"] = false.into();
        let mut entities = Entities::default();
        entities.local = Some(1);
        offline.receive(
            vec![CombatEvent {
                source: 1,
                target: 20,
                skill: 3000024,
                amount: 100,
                ..CombatEvent::new("damage")
            }],
            &entities,
            0,
            100000,
        );
        for (now, kind, skill, class) in [
            (1, "heal", 18160002, "Chanter"),
            (2, "damage", 14340230, "Ranger"),
            (3, "heal", 18160002, "Ranger"),
        ] {
            offline.receive(
                vec![CombatEvent {
                    source: 1,
                    target: if kind == "heal" { 1 } else { 20 },
                    skill,
                    amount: 100,
                    ..CombatEvent::new(kind)
                }],
                &entities,
                now,
                100000,
            );
            assert_eq!(offline.log.actors[&1].class.as_deref(), Some(class));
        }
    }
    #[test]
    fn boss_clock_starts_on_party_engagement_after_path_combat() {
        let root = std::env::temp_dir().join(format!(
            "aion-boss-clock-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut o = Offline::default();
        o.initialize(root.clone()).unwrap();
        Arc::make_mut(&mut o.catalogue)
            .npcs
            .push(companion_core::combat::NpcInfo {
                id: 77,
                name: "Test boss".into(),
                boss: true,
                ..Default::default()
            });
        let mut entities = Entities::default();
        entities.local = Some(1);
        let hit = |source, target, amount| CombatEvent {
            source,
            target,
            skill: 11010000,
            amount,
            ..CombatEvent::new("damage")
        };
        o.receive(vec![hit(30, 1, 100)], &entities, 500, 100000);
        assert!(
            o.log.id.is_empty(),
            "Incoming path damage cannot start a pull"
        );
        o.receive(vec![hit(1, 30, 900)], &entities, 1000, 100000);
        o.receive(
            vec![CombatEvent {
                target: 20,
                skill: 77,
                ..CombatEvent::new("spawn")
            }],
            &entities,
            2000,
            100000,
        );
        let path_id = o.log.id.clone();
        o.receive(vec![hit(3, 20, 800)], &entities, 2500, 100000);
        assert_eq!(
            o.log.id, path_id,
            "A nearby player's boss hit is not our pull"
        );
        o.receive(vec![hit(1, 30, 900)], &entities, 3500, 100000);
        let previous = o.poll_update(3500, None).execute(None, o.report_key());

        o.receive(vec![hit(1, 20, 1000)], &entities, 4000, 100000);
        o.receive(vec![hit(1, 20, 1000)], &entities, 6000, 100000);
        o.tick(6000);
        let report = o.report(6000);
        assert_eq!(report["started_ms"], 104000);
        assert_ne!(o.log.id, path_id);
        assert_eq!(report["duration_ms"], 2000);
        assert_eq!(report["players"][0]["damage"], 2000);
        assert_eq!(report["players"][0]["edps"], 1000.0);
        assert_eq!(report["events"][0]["at_ms"], 0);
        assert!(!o.log.targets.contains_key(&30));
        let update = o.poll_update(6000, Some(&previous));
        assert_eq!(
            update.prefix_len, 0,
            "The path event cache cannot become the boss prefix"
        );
        let mut current = update.execute(Some(previous), o.report_key());
        assert_eq!(current.summary["players"], report["players"]);
        assert_eq!(current.summary["duration_ms"], 2000);
        assert_eq!(current.report(true)["events"], report["events"]);
        let path = o.read(&path_id).unwrap();
        assert_eq!(path["end_reason"], "boss_pull");
        assert_eq!(path["duration_ms"], 2500);
        assert_eq!(path["players"][0]["damage"], 1800);
        assert_eq!(path["events"].as_array().unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn boss_clock_finishes_at_boss_damage_even_when_adds_keep_fighting() {
        let mut o = Offline::default();
        o.settings["auto_save"] = false.into();
        Arc::make_mut(&mut o.catalogue)
            .npcs
            .push(companion_core::combat::NpcInfo {
                id: 77,
                name: "Test boss".into(),
                boss: true,
                ..Default::default()
            });
        let mut entities = Entities::default();
        entities.local = Some(1);
        o.receive(
            vec![CombatEvent {
                target: 20,
                skill: 77,
                ..CombatEvent::new("spawn")
            }],
            &entities,
            0,
            100000,
        );
        for (now, source, target, amount) in [
            (4000, 1, 20, 1000),
            (6000, 1, 20, 1000),
            (6500, 1, 30, 900),
            (6600, 30, 1, 500),
        ] {
            o.receive(
                vec![CombatEvent {
                    source,
                    target,
                    skill: 11010000,
                    amount,
                    ..CombatEvent::new("damage")
                }],
                &entities,
                now,
                100000,
            );
        }
        o.receive(
            vec![CombatEvent {
                target: 20,
                ..CombatEvent::new("death")
            }],
            &entities,
            7000,
            100000,
        );
        for now in [7000, 25000] {
            o.tick(now);
            let report = o.report(now);
            assert_eq!(report["duration_ms"], 2000);
            assert_eq!(report["players"][0]["damage"], 2000);
            assert_eq!(report["players"][0]["edps"], 1000.0);
            assert_eq!(report["end_reason"], "kill");
        }
    }

    #[test]
    fn automatic_boss_filter_updates_live_and_saved_meter_aggregates() {
        let mut offline = Offline::default();
        offline.log.id = "mixed-fight".into();
        offline.log.duration_ms = 2000;
        for id in 1..=3 {
            offline.log.actors.insert(
                id,
                ActorInfo {
                    id,
                    name: format!("Player {id}"),
                    party: true,
                    ..Default::default()
                },
            );
        }
        for (source, target, skill, amount) in [
            (1, 20, 11010000, 100),
            (1, 30, 11020000, 900),
            (2, 20, 11010000, 300),
            (2, 30, 11020000, 700),
            (3, 30, 11020000, 400),
        ] {
            offline.log.events.push(CombatEvent {
                at_ms: 1000,
                source,
                target,
                skill,
                amount,
                ..CombatEvent::new("damage")
            });
        }
        let total = |report: &Value| {
            report["players"]
                .as_array()
                .unwrap()
                .iter()
                .map(|player| player["damage"].as_u64().unwrap())
                .sum::<u64>()
        };
        // Old saved preferences cannot make an ordinary encounter empty.
        offline.settings["target_mode"] = "boss".into();
        assert_eq!(total(&offline.report(2000)), 2400);
        let previous = offline
            .poll_update(2000, None)
            .execute(None, offline.report_key());
        assert_eq!(total(&previous.summary), 2400);
        // Once native identifies a boss, even an unchanged event prefix is re-aggregated.
        offline.log.targets.insert(
            20,
            TargetInfo {
                id: 20,
                boss: true,
                ..Default::default()
            },
        );
        assert!(offline.report_key() != previous.key);
        let update = offline.poll_update(2000, Some(&previous));
        assert_eq!(update.prefix_len, 5);
        let mut current = update.execute(Some(previous), offline.report_key());
        let expected = offline.report(2000);
        assert_eq!(total(&expected), 400);
        assert_eq!(expected["players"].as_array().unwrap().len(), 2);
        for player in expected["players"].as_array().unwrap() {
            let damage = player["damage"].as_u64().unwrap();
            assert_eq!(player["skills"].as_array().unwrap().len(), 1);
            assert_eq!(player["skills"][0]["id"], 11010000);
            assert_eq!(player["skills"][0]["damage"], damage);
            assert_eq!(player["edps"].as_f64().unwrap(), damage as f64 / 2.0);
            assert_eq!(player["current_dps"].as_f64().unwrap(), damage as f64 / 5.0);
        }
        assert_eq!(current.summary["players"], expected["players"]);
        assert_eq!(current.report(true)["players"], expected["players"]);
        offline.settings["target_mode"] = "all".into();
        assert_eq!(offline.report(2000)["players"], expected["players"]);
        // The saved meter uses the same rule; full inspection retains all raw damage.
        let saved = |log| {
            ReportRequest {
                source: LogSource::Snapshot(log),
                catalogue: offline.catalogue.clone(),
                now_ms: None,
                party_only: false,
                boss_only: true,
                detail_limit: None,
            }
            .execute()
            .unwrap()
        };
        assert_eq!(saved(offline.log.clone())["players"], expected["players"]);
        assert_eq!(total(&offline.inspect("mixed-fight", 2000).unwrap()), 2400);
        assert_eq!(offline.log.events.len(), 5);
        let mut ordinary = offline.log.clone();
        ordinary.targets.clear();
        assert_eq!(total(&saved(ordinary.clone())), 2400);
        ordinary.targets.insert(
            20,
            TargetInfo {
                id: 20,
                dummy: true,
                ..Default::default()
            },
        );
        assert_eq!(total(&saved(ordinary)), 400);
    }

    #[test]
    fn meter_waits_for_local_or_party_damage_to_each_enemy() {
        let mut offline = Offline::default();
        offline.settings["auto_save"] = false.into();
        let mut entities = Entities::default();
        offline.receive(
            vec![CombatEvent {
                source: 1,
                target: 20,
                skill: 11010000,
                amount: 100,
                ..CombatEvent::new("damage")
            }],
            &entities,
            500,
            100000,
        );
        assert!(
            offline.log.id.is_empty(),
            "Unidentified players cannot start a pull"
        );
        entities.local = Some(1);
        entities
            .observe(&[0x45, 0x36, 2, 0, 0, 0, 0, 1, 4, b'A', b'l', b'l', b'y'])
            .unwrap();
        entities
            .observe(&[2, 0x97, 4, b'A', b'l', b'l', b'y', 34, 0, 0, 0, 45, 0, 0, 0])
            .unwrap();
        assert!(entities.party_member(2));
        let damage = |source, target, amount| CombatEvent {
            source,
            target,
            skill: 11010000,
            amount,
            ..CombatEvent::new("damage")
        };
        for event in [
            damage(3, 20, 100),
            damage(20, 1, 100),
            damage(1, 20, 0),
            CombatEvent {
                source: 1,
                target: 1,
                skill: 11010000,
                amount: 100,
                ..CombatEvent::new("heal")
            },
        ] {
            offline.receive(vec![event], &entities, 1000, 100000);
            assert!(offline.log.id.is_empty(), "No outgoing party damage yet");
            assert!(offline.report(1000)["players"]
                .as_array()
                .unwrap()
                .is_empty());
            let summary = offline
                .poll_update(1000, None)
                .execute(None, offline.report_key());
            assert!(summary.summary["players"].as_array().unwrap().is_empty());
        }
        offline.receive(vec![damage(2, 20, 200)], &entities, 2000, 100000);
        assert_eq!(offline.log.started_ms, 102000);
        // Nearby damage stays in the log, but must not enter party rankings.
        offline.receive(
            vec![damage(3, 20, 50), damage(4, 30, 900)],
            &entities,
            3000,
            100000,
        );
        assert_eq!(offline.log.targets[&20].damage, 250);
        let summary = offline
            .poll_update(3000, None)
            .execute(None, offline.report_key());
        assert_eq!(summary.summary["players"], offline.report(3000)["players"]);
        assert_eq!(
            offline.report(3000)["players"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["damage"].as_u64().unwrap())
                .sum::<u64>(),
            200
        );
        assert!(!offline.log.targets.contains_key(&30));
        offline.tick(14000);
        let completed = offline.log.id.clone();
        offline.receive(vec![damage(4, 30, 900)], &entities, 15000, 100000);
        assert_eq!(
            offline.log.id, completed,
            "Nearby fights cannot replace our result"
        );
        offline.receive(vec![damage(1, 30, 75)], &entities, 16000, 100000);
        assert_ne!(offline.log.id, completed);
        assert_eq!(offline.report(16000)["players"][0]["damage"], 75);
    }

    #[test]
    fn party_only_meter_keeps_solo_damage_and_excludes_nearby_players() {
        let mut state = crate::Shared::default();
        state.entities.local = Some(1);
        state.offline.settings["auto_save"] = false.into();
        // A previously saved opt-out cannot expose other players in the meter.
        state.party_only = false;
        state.offline.settings["party_only"] = false.into();
        for (source, amount) in [(1, 100), (2, 900)] {
            state
                .add_hits(
                    1000,
                    vec![companion_core::wire::Hit {
                        actor: source,
                        target: 20,
                        skill: 11010000,
                        amount,
                        critical: false,
                        tick: false,
                    }],
                )
                .unwrap();
        }
        let snapshot = state.snapshot();
        assert_eq!(snapshot["party_only"], true);
        let players = snapshot["players"].as_array().unwrap();
        assert_eq!(players.len(), 1);
        assert_eq!(players[0]["entity"], 1);
        assert_eq!(players[0]["damage"], 100);
        assert_eq!(players[0]["share"], 1.0);
    }

    #[test]
    fn party_only_meter_filters_saved_boss_and_ordinary_fights() {
        let root = std::env::temp_dir().join(format!(
            "aion-party-meter-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut offline = Offline::default();
        offline.initialize(root.clone()).unwrap();
        let mut entities = Entities::default();
        entities.local = Some(1);
        for (source, amount) in [(1, 100), (2, 900)] {
            offline.receive(
                vec![CombatEvent {
                    source,
                    target: 20,
                    skill: 11010000,
                    amount,
                    ..CombatEvent::new("damage")
                }],
                &entities,
                1000,
                100000,
            );
        }
        let id = offline.log.id.clone();
        for boss in [false, true] {
            offline.log.targets.get_mut(&20).unwrap().boss = boss;
            atomic(&offline.path(&id).unwrap(), &offline.log).unwrap();
            let report = offline.read_filtered(&id, true).unwrap();
            assert_eq!(report["players"].as_array().unwrap().len(), 1);
            assert_eq!(report["players"][0]["id"], 1);
            assert_eq!(report["players"][0]["damage"], 100);
            assert_eq!(
                offline.read(&id).unwrap()["players"].as_array().unwrap().len(),
                2
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn polling_transfers_only_appended_events_and_refreshes_metadata() {
        let mut offline = Offline::default();
        offline.log.id = "append-fight".into();
        offline.log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                name: "Pending".into(),
                local: true,
                ..Default::default()
            },
        );
        let damage = CombatEvent {
            at_ms: 1000,
            source: 1,
            target: 2,
            amount: 150,
            ..CombatEvent::new("damage")
        };
        offline.log.events.push(damage.clone());
        let previous = offline
            .poll_update(2000, None)
            .execute(None, offline.report_key());
        offline.log.events.push(damage);
        offline.log.actors.get_mut(&1).unwrap().name = "Observed".into();
        let update = offline.poll_update(2000, Some(&previous));
        assert_eq!(update.prefix_len, 1);
        assert_eq!(update.log.events.len(), 1);
        let mut current = update.execute(Some(previous), offline.report_key());
        assert_eq!(*current.report(true), offline.report(2000));
        assert_eq!(current.report(true)["players"][0]["damage"], 300);
        assert_eq!(current.report(true)["players"][0]["name"], "Observed");

        // A reset can reuse an ID and have the same event count; stream ownership
        // still forbids reusing the old prefix.
        offline.clear();
        offline.log = current.log.clone();
        offline.log.events[0].amount = 999;
        let reset = offline.poll_update(2000, Some(&current));
        assert_eq!(reset.prefix_len, 0);
        assert_eq!(
            *reset
                .execute(Some(current), offline.report_key())
                .report(true),
            offline.report(2000)
        );
    }

    #[test]
    fn dummy_cap_rebuilds_the_polling_snapshot_after_trimming_events() {
        let mut offline = Offline::default();
        offline.origin = Some(0);
        offline.log.id = "dummy-fight".into();
        offline.settings["dummy_length_seconds"] = 10.into();
        offline.log.targets.insert(
            2,
            TargetInfo {
                id: 2,
                dummy: true,
                ..Default::default()
            },
        );
        offline.log.events = vec![
            CombatEvent {
                at_ms: 1000,
                ..CombatEvent::new("cast")
            },
            CombatEvent {
                at_ms: 12000,
                ..CombatEvent::new("cast")
            },
        ];
        let previous = offline
            .poll_update(9000, None)
            .execute(None, offline.report_key());
        offline.tick(15000);
        let update = offline.poll_update(15000, Some(&previous));
        assert_eq!(update.prefix_len, 0);
        let mut result = update.execute(Some(previous), offline.report_key());
        assert_eq!(*result.report(true), offline.report(15000));
        assert_eq!(result.log.events.len(), 1);
        assert_eq!(result.log.end_reason.as_deref(), Some("dummy_cap"));
    }

    #[test]
    fn explicit_inspection_preserves_the_start_of_a_long_fight() {
        let mut offline = Offline::default();
        offline.log.id = "long-fight".into();
        offline.log.duration_ms = 30000;
        offline.log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                name: "Tester".into(),
                local: true,
                ..Default::default()
            },
        );
        offline.log.events = (0..25001)
            .map(|at_ms| CombatEvent {
                at_ms,
                source: 1,
                target: 2,
                amount: at_ms + 1,
                ..CombatEvent::new("damage")
            })
            .collect();
        let polling = offline.report(30000);
        assert_eq!(polling["events"].as_array().unwrap().len(), 25000);
        let full = offline.inspect("long-fight", 30000).unwrap();
        assert_eq!(full["events"].as_array().unwrap().len(), 25001);
        assert_eq!(full["events"][0]["amount"], 1);
        assert_eq!(
            full["players"][0]["damage"],
            polling["players"][0]["damage"]
        );
        // Inspection includes the whole fight even if the meter currently filters it.
        offline.log.actors.get_mut(&1).unwrap().local = false;
        offline.settings["target_mode"] = "boss".into();
        assert!(offline.report(30000)["players"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(
            offline.inspect("long-fight", 30000).unwrap()["players"][0]["id"],
            1
        );
        assert!(offline.inspect("../settings", 30000).is_err());
        assert!(offline.inspect("another-fight", 30000).is_err());
    }
    #[test]
    fn dungeon_roster_excludes_unbound_skill_entities_without_a_spawn() {
        let mut o = Offline::default();
        o.settings["auto_save"] = false.into();
        let mut entities = Entities::default();
        o.receive(
            vec![CombatEvent {
                skill: 99,
                amount: 1,
                ..CombatEvent::new("dungeon_state")
            }],
            &entities,
            0,
            100000,
        );
        let mut roster = vec![2, 0x97];
        for id in 1..=5u8 {
            let name = format!("Member{id}");
            let mut identity = vec![0x45, 0x36, id, 0, 0, 0, 0, 1, name.len() as u8];
            identity.extend_from_slice(name.as_bytes());
            entities.observe(&identity).unwrap();
            roster.push(name.len() as u8);
            roster.extend_from_slice(name.as_bytes());
            roster.extend_from_slice(&[34, 0, 0, 0, 45, 0, 0, 0]);
        }
        entities.observe(&roster).unwrap();
        assert_eq!(entities.party_count(), 5);
        for source in 1..=6 {
            o.receive(
                vec![CombatEvent {
                    source,
                    target: 20,
                    skill: 17150002,
                    amount: 2388,
                    ..CombatEvent::new("damage")
                }],
                &entities,
                source as u64 * 1000,
                100000,
            );
        }
        assert_eq!(o.report(6000)["players"].as_array().unwrap().len(), 5);
        let mut fallback = crate::Shared {
            offline: o,
            entities: entities.clone(),
            stopped_ms: 6000,
            ..Default::default()
        };
        for source in 1..=6 {
            fallback
                .add_hits(
                    1000,
                    vec![companion_core::wire::Hit {
                        actor: source,
                        target: 20,
                        skill: 17150002,
                        amount: 2388,
                        critical: false,
                        tick: false,
                    }],
                )
                .unwrap();
        }
        assert_eq!(fallback.snapshot()["players"].as_array().unwrap().len(), 5);
        let mut o = fallback.offline;
        // Open-world meters apply the same party boundary as dungeon meters.
        o.dungeon = None;
        o.receive(
            vec![CombatEvent {
                source: 6,
                target: 20,
                skill: 17150002,
                amount: 100,
                ..CombatEvent::new("damage")
            }],
            &entities,
            7000,
            100000,
        );
        assert_eq!(o.report(7000)["players"].as_array().unwrap().len(), 5);
        assert!(o.log.actors.contains_key(&6));
    }
    #[test]
    fn spawned_sources_do_not_add_a_sixth_dungeon_player() {
        let mut o = Offline::default();
        o.settings["auto_save"] = false.into();
        let mut entities = Entities::default();
        entities.local = Some(1);
        // A name in an NPC spawn can be its target, not an owner binding.
        let spawn = [
            0x41, 0x36, 6, 0, 0, 1, 4, b'T', b'e', b's', b't', 77, 0, 0, 0,
        ];
        entities.observe(&spawn).unwrap();
        for source in 1..=6 {
            o.receive(
                vec![CombatEvent {
                    source,
                    target: 20,
                    skill: 11010000,
                    amount: 100,
                    ..CombatEvent::new("damage")
                }],
                &entities,
                source as u64 * 1000,
                100000,
            );
        }
        let report = o.report(6000);
        assert_eq!(report["players"].as_array().unwrap().len(), 1);
        assert_eq!(o.log.actors.len(), 5, "Spawned sources cannot become actors");
        assert_eq!(
            report["players"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["damage"].as_u64().unwrap())
                .sum::<u64>(),
            100
        );
    }
    #[test]
    fn boss_completion_freezes_reports_during_phase_grace_and_after_finish() {
        let mut o = Offline::default();
        o.settings["auto_save"] = false.into();
        Arc::make_mut(&mut o.catalogue)
            .npcs
            .push(companion_core::combat::NpcInfo {
                id: 77,
                name: "Test boss".into(),
                boss: true,
                ..Default::default()
            });
        let mut entities = Entities::default();
        entities.local = Some(1);
        o.receive(
            vec![CombatEvent {
                target: 2,
                skill: 77,
                ..CombatEvent::new("spawn")
            }],
            &entities,
            0,
            100000,
        );
        for now in [1000, 5000] {
            o.receive(
                vec![CombatEvent {
                    source: 1,
                    target: 2,
                    skill: 11010000,
                    amount: 1000,
                    ..CombatEvent::new("damage")
                }],
                &entities,
                now,
                100000,
            );
        }
        o.receive(
            vec![CombatEvent {
                target: 2,
                ..CombatEvent::new("death")
            }],
            &entities,
            5100,
            100000,
        );
        let initial = o.report(5100);
        assert_eq!(initial["end_reason"], "kill");
        assert_eq!(initial["duration_ms"], 4000);
        for now in [9000, 20000, 60000] {
            o.receive(
                vec![
                    CombatEvent {
                        source: 1,
                        target: 1,
                        skill: 17100000,
                        amount: 200,
                        ..CombatEvent::new("heal")
                    },
                    CombatEvent {
                        source: 99,
                        target: 1,
                        skill: 1607000,
                        amount: 20,
                        ..CombatEvent::new("damage")
                    },
                    CombatEvent {
                        source: 3,
                        target: 4,
                        skill: 11010000,
                        amount: 500,
                        ..CombatEvent::new("damage")
                    },
                ],
                &entities,
                now,
                100000,
            );
            o.tick(now);
            let report = o.report(now);
            assert_eq!(report["players"][0]["edps"], initial["players"][0]["edps"]);
            assert_eq!(
                report["players"][0]["current_dps"],
                initial["players"][0]["current_dps"]
            );
            let update = o.poll_update(now, None);
            let summary = update.execute(None, o.report_key());
            assert_eq!(summary.summary["players"], report["players"]);
            assert_eq!(
                o.inspect(&o.log.id, now).unwrap()["players"],
                report["players"]
            );
        }
        let completed_id = o.log.id.clone();
        o.receive(
            vec![CombatEvent {
                source: 1,
                target: 2,
                skill: 11010000,
                amount: 100,
                ..CombatEvent::new("damage")
            }],
            &entities,
            61000,
            100000,
        );
        assert_eq!(o.log.id, completed_id);
        assert_eq!(o.report(61000)["players"][0]["damage"], 2000);
        o.receive(
            vec![
                CombatEvent {
                    target: 2,
                    skill: 77,
                    ..CombatEvent::new("spawn")
                },
                CombatEvent {
                    source: 1,
                    target: 2,
                    skill: 11010000,
                    amount: 100,
                    ..CombatEvent::new("damage")
                },
            ],
            &entities,
            62000,
            100000,
        );
        assert_ne!(o.log.id, completed_id);
        assert_eq!(o.report(62000)["players"][0]["damage"], 100);
    }
    #[test]
    fn boss_death_waits_for_phase_transition_and_a_new_alive_boss_cancels_it() {
        let mut o = Offline::default();
        o.settings["auto_save"] = false.into();
        Arc::make_mut(&mut o.catalogue)
            .npcs
            .push(companion_core::combat::NpcInfo {
                id: 77,
                name: "Test boss".into(),
                boss: true,
                ..Default::default()
            });
        let mut entities = Entities::default();
        entities.local = Some(1);
        let hit = |target| CombatEvent {
            source: 1,
            target,
            skill: 11010000,
            amount: 100,
            ..CombatEvent::new("damage")
        };
        for target in [2, 3] {
            o.receive(
                vec![CombatEvent {
                    target,
                    skill: 77,
                    ..CombatEvent::new("spawn")
                }],
                &entities,
                0,
                100000,
            );
        }
        o.receive(vec![hit(2)], &entities, 100, 100000);
        o.receive(
            vec![CombatEvent {
                target: 2,
                ..CombatEvent::new("death")
            }],
            &entities,
            200,
            100000,
        );
        assert!(o.log.targets[&2].dead);
        // Removing a dead phase must not shorten its transition grace.
        o.receive(
            vec![CombatEvent {
                target: 2,
                ..CombatEvent::new("despawn")
            }],
            &entities,
            300,
            100000,
        );
        o.tick(12000);
        assert!(o.log.end_reason.is_none());
        assert_eq!(o.report(12000)["end_reason"], "kill");
        o.receive(vec![hit(3)], &entities, 13000, 100000);
        o.tick(17000);
        assert!(o.log.end_reason.is_none());
        assert!(o.report(17000)["end_reason"].is_null());
        assert_eq!(o.report(17000)["duration_ms"], 16900);
        o.receive(
            vec![CombatEvent {
                target: 3,
                current_hp: Some(0),
                ..CombatEvent::new("hp")
            }],
            &entities,
            18000,
            100000,
        );
        o.tick(34000);
        assert_eq!(o.log.end_reason.as_deref(), Some("kill"));
        assert_eq!(o.log.duration_ms, 12900);
    }
    #[test]
    fn recorded_wire_vectors_reach_the_offline_report_without_changing_damage() {
        let mut decoder = companion_core::wire::Decoder::default();
        decoder.entities.local = Some(1086);
        let mut offline = Offline::default();
        offline.settings["auto_save"] = false.into();
        for (at, hex) in [
            (
                1000,
                "04388484030600be08fe26a8004f02000002433baf4101000000ba4ffd020100",
            ),
            (
                2000,
                "04388484032600be08fe26a8005703000002433baf4101000000ba4fcc0401020100",
            ),
        ] {
            let frame = hex
                .as_bytes()
                .chunks_exact(2)
                .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
                .collect::<Vec<_>>();
            decoder.decode(&frame);
            offline.receive(
                std::mem::take(&mut decoder.observations),
                &decoder.entities,
                at,
                100000,
            );
        }
        offline.finish("manual", 2000);
        let r = offline.report(2000);
        let player = &r["players"][0];
        assert_eq!(player["id"], 1086);
        assert_eq!(player["damage"], 969);
        assert_eq!(player["crits"], 1);
        assert_eq!(player["critical_hits_observed"], 2);
        assert_eq!(player["edps"], 969.0);
        let restored: CombatLog =
            serde_json::from_value(serde_json::to_value(&offline.log).unwrap()).unwrap();
        assert_eq!(restored.events, offline.log.events);
    }
    #[test]
    fn dummy_boundary_preserves_exact_cap_and_repeat_alert_crossing() {
        let mut o = Offline::default();
        o.settings["auto_save"] = false.into();
        o.settings["dummy_length_seconds"] = 10.into();
        Arc::make_mut(&mut o.catalogue)
            .npcs
            .push(companion_core::combat::NpcInfo {
                id: 77,
                name: "Training dummy".into(),
                dummy: true,
                ..Default::default()
            });
        let mut entities = Entities::default();
        entities.local = Some(1);
        o.receive(
            vec![CombatEvent {
                target: 2,
                skill: 77,
                ..CombatEvent::new("spawn")
            }],
            &entities,
            0,
            100000,
        );
        o.receive(
            vec![CombatEvent {
                source: 1,
                target: 2,
                skill: 11010000,
                amount: 100,
                ..CombatEvent::new("damage")
            }],
            &entities,
            100,
            100000,
        );
        o.tick(11000);
        assert_eq!(o.log.duration_ms, 10000);
        assert_eq!(o.log.end_reason.as_deref(), Some("dummy_cap"));
        o.settings["alerts"] = json!([{"id":"a","name":"Test","enabled":true,"at_ms":10000,"repeat_seconds":10,"sound":"bell","volume":0.5}]);
        assert_eq!(o.alerts(20100)[0]["due_ms"], 20000);
        assert_eq!(o.alerts(20100)[0]["remaining_ms"], -100);
    }
    #[test]
    fn cooldown_calibration_needs_consistent_evidence_and_rejects_stale_data() {
        let mut c = Cooldown::default();
        c.update(0, 10000);
        assert_eq!(c.remaining(0), None);
        c.update(500, 9000);
        c.update(1000, 8000);
        c.update(1500, 7000);
        assert_eq!(c.remaining(2000), Some(3000));
        assert_eq!(c.remaining(8000), None);
        c.update(2000, 10000);
        assert_eq!(c.remaining(2000), None);
        c.update(2500, 0);
        assert_eq!(c.remaining(2500), Some(0));
    }
    #[test]
    fn settings_reject_invalid_updates_without_mutating() {
        let mut o = Offline::default();
        assert!(o.configure(json!({"opacity":0})).is_err());
        assert_eq!(o.settings["opacity"], 1.);
        assert!(o.configure(json!({"dummy_length_seconds":3})).is_err());
        assert!(o.configure(json!({"dps_mode":"active"})).is_ok());
        let presets = json!([{"id":"p","name":"Test","bars":[{"id":"b","name":"Bar","mode":"both","skills":[11010000],"x":0,"y":0,"icon_size":32,"appearance":"icons","hidden":false}]}]);
        o.configure(json!({"presets":presets,"opacity":0.7}))
            .unwrap();
        o.positions("p", json!([{"bar_id":"b","x":41,"y":23}]))
            .unwrap();
        assert_eq!(o.settings["opacity"], 0.7);
        assert_eq!(o.settings["presets"][0]["bars"][0]["x"], 41);
        assert!(o
            .positions("p", json!([{"bar_id":"missing","x":1,"y":2}]))
            .is_err());
        assert_eq!(o.settings["presets"][0]["bars"][0]["x"], 41);
    }
    #[test]
    fn library_persists_filters_and_guards_paths() {
        let root = std::env::temp_dir().join(format!(
            "aion-offline-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut o = Offline::default();
        o.initialize(root.clone()).unwrap();
        o.log = CombatLog {
            id: "fight-1".into(),
            label: "Test boss".into(),
            duration_ms: 1000,
            ..Default::default()
        };
        o.log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                name: "Tester".into(),
                local: true,
                ..Default::default()
            },
        );
        o.log.events.push(CombatEvent {
            source: 1,
            target: 2,
            skill: 11010000,
            amount: 100,
            ..CombatEvent::new("damage")
        });
        o.log.targets.insert(
            2,
            TargetInfo {
                id: 2,
                boss: true,
                ..Default::default()
            },
        );
        o.log.events.push(CombatEvent {
            source: 1,
            target: 3,
            skill: 11010000,
            amount: 50,
            critical: Some(true),
            ..CombatEvent::new("damage")
        });
        o.save().unwrap();
        assert_eq!(o.read("fight-1").unwrap()["players"][0]["damage"], 150);
        let boss = o.read_filtered("fight-1", true).unwrap();
        assert_eq!(boss["players"][0]["damage"], 100);
        assert_eq!(boss["players"][0]["damage_hits"], 1);
        assert!(boss["players"][0]["damage_crits"].is_null());
        assert_eq!(boss["players"][0]["skills"][0]["damage"], 100);
        // A stale in-flight checkpoint must never replace a finished saved fight.
        o.origin = Some(0);
        atomic(&root.join("active.json"), &o.log).unwrap();
        let stale = o.log.clone();
        o.finish("kill", 2000);
        // Reproduce a crash before the writer publishes the finished checkpoint.
        atomic(&root.join("active.json"), &stale).unwrap();
        let mut restarted = Offline::default();
        restarted.initialize(root.clone()).unwrap();
        assert_eq!(restarted.read("fight-1").unwrap()["end_reason"], "kill");
        assert_eq!(restarted.read("fight-1").unwrap()["duration_ms"], 2000);
        // Selecting a saved fight while a different encounter is active keeps its identity.
        restarted.log.id = "fight-2".into();
        assert_eq!(restarted.inspect("fight-1", 3000).unwrap()["id"], "fight-1");
        assert_eq!(restarted.inspect("fight-2", 3000).unwrap()["id"], "fight-2");
        assert_eq!(o.logs(&json!({"search":"Tester"})).unwrap().len(), 1);
        assert!(o.read("../settings").is_err());
        assert!(o.delete(&["../settings".into()]).is_err());
        o.rename("fight-1", "Renamed").unwrap();
        assert_eq!(o.read("fight-1").unwrap()["label"], "Renamed");
        assert_eq!(o.delete(&["fight-1".into()]).unwrap(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
