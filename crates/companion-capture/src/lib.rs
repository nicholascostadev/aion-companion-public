//! Independent, receive-only Npcap collector, confined to game-owned flows.
use companion_core::wire::{entities::Entities, Hit};
use companion_core::{live::Meter, wire::Pipeline, Recording};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;
pub mod activities;
mod alert_catalogue;
pub mod alerts;
mod alerts_api;
mod cubes;
pub mod diagnostics;
pub mod localization;
pub mod maintenance_notice;
mod offline;
mod offline_api;
pub mod persistence;
mod pet_catalogue;
mod pets;
mod reports;
pub mod server_status;
pub mod state_validation;
mod storage;
mod storage_api;
use storage_api::{flush as flush_storage, operation as storage_operation};
/// Complete pre-serialized pet metadata for a JSON response; no owned object tree is built.
pub fn pet_catalogue() -> &'static str {
    pet_catalogue::JSON
}
fn wall_clock() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

#[cfg(windows)]
mod windows;

/// Checks driver access without consuming packets or changing the live collector.
pub fn capture_requirements() -> Value {
    #[cfg(windows)]
    {
        windows::requirements()
    }
    #[cfg(not(windows))]
    {
        json!({"state":"unsupported","detail":null})
    }
}

struct Shared {
    cubes: cubes::Cubes,
    odyle: Option<OdyleReading>,
    odyle_revision: u64,
    pets: Arc<Mutex<pets::Pets>>,
    offline: offline::Offline,
    meter: Meter,
    meter_targets: BTreeSet<u32>,
    started: Instant,
    stopped_ms: u64,
    running: bool,
    phase: String,
    message: String,
    stats: Value,
    generation: u64,
    reset_ms: u64,
    entities: Entities,
    group_trace: companion_core::wire::diagnostic::SmallFrames,
    skill_names: BTreeMap<u32, String>,
    party_only: bool,
    auto_end: bool,
    encounter: u64,
    history: VecDeque<Archived>,
    epoch_ms: u64,
}

#[derive(Clone, Copy, Serialize)]
struct OdyleReading {
    base: u32,
    bonus: u32,
    observed_ms: u64,
}

struct Archived {
    id: u64,
    recording: Recording,
    entities: Entities,
    stats: Value,
    start_ms: u64,
}
impl Default for Shared {
    fn default() -> Self {
        Self {
            cubes: cubes::Cubes::default(),
            odyle: None,
            odyle_revision: 0,
            pets: Arc::default(),
            offline: offline::Offline::default(),
            meter: Meter::default(),
            meter_targets: BTreeSet::new(),
            started: Instant::now(),
            stopped_ms: 0,
            running: false,
            phase: "idle".into(),
            message: "Ready for independent live capture.".into(),
            stats: json!({}),
            generation: 0,
            reset_ms: 0,
            entities: Entities::default(),
            group_trace: Default::default(),
            skill_names: BTreeMap::new(),
            party_only: false,
            auto_end: true,
            encounter: 1,
            history: VecDeque::new(),
            epoch_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |time| time.as_millis() as u64),
        }
    }
}
impl Shared {
    fn clear_odyle(&mut self) {
        self.odyle = None;
        self.odyle_revision = 0;
    }

    fn receive_odyle(&mut self, source: &companion_core::wire::odyle::State, at_ms: u64) {
        if self.odyle_revision == source.revision() {
            return;
        }
        self.odyle_revision = source.revision();
        self.odyle = source.balance().map(|balance| OdyleReading {
            base: balance.base,
            bonus: balance.bonus,
            observed_ms: self.epoch_ms.saturating_add(at_ms),
        });
    }
    fn now(&self) -> u64 {
        if self.running {
            self.started.elapsed().as_millis() as u64
        } else {
            self.stopped_ms
        }
    }
    fn snapshot(&mut self) -> Value {
        let now = self.now();
        if self.auto_end {
            self.meter.end_if_idle(now);
        }
        let duration = self.meter.duration(now);
        let events = self.meter.event_count();
        let mut players =
            serde_json::to_value(self.meter.players(now)).unwrap_or_else(|_| json!([]));
        if let Some(players) = players.as_array_mut() {
            players.retain(|p| {
                self.entities
                    .party_member(p["entity"].as_u64().unwrap_or(0) as u32)
            });
            let total: f64 = players
                .iter()
                .map(|p| p["damage"].as_f64().unwrap_or(0.0))
                .sum();
            for player in players {
                let id = player["entity"].as_u64().unwrap_or(0) as u32;
                player["name"] = self
                    .entities
                    .name(id)
                    .map_or(Value::Null, |name| name.into());
                player["name_known"] = self.entities.name(id).is_some().into();
                player["is_local"] = (self.entities.local == Some(id)).into();
                if self.entities.name(id).is_some() {
                    player["label"] = self.entities.label(id).into();
                }
                player["party_member"] = self.entities.party_member(id).into();
                player["share"] = if total > 0.0 {
                    player["damage"].as_f64().unwrap_or(0.0) / total
                } else {
                    0.0
                }
                .into();
                if let Some(skills) = player["skills"].as_object() {
                    let labels: serde_json::Map<String, Value> = skills
                        .iter()
                        .map(|(id, amount)| (skill_label(id, &self.skill_names), amount.clone()))
                        .collect();
                    player["skills"] = labels.into();
                }
            }
        }
        let odyle = if self.running && self.phase == "capturing" {
            self.odyle
        } else {
            None
        };
        json!({"odyle":odyle,"running":self.running,"phase":self.phase,"message":self.message,"duration_ms":duration,"events":events,"stats":self.stats,"players":players,"named_entities":self.entities.named_count(),"roster_seen":self.entities.roster_seen,"party_members":self.entities.party_count(),"local_known":self.entities.local.is_some(),"party_only":true,"auto_end":self.auto_end,"encounter":self.encounter,"encounter_ended":self.meter.ended(),"skill_labels":self.skill_names.len(),"history":self.history.iter().map(|r|json!({"id":r.id,"duration_ms":r.recording.duration_ms,"events":r.recording.events.len()})).collect::<Vec<_>>()})
    }

    fn archive(&mut self) -> Result<(), String> {
        if self.meter.event_count() == 0 {
            return Ok(());
        }
        self.history.push_back(Archived {
            id: self.encounter,
            recording: self.meter.recording(self.now())?,
            entities: self.entities.clone(),
            stats: self.stats.clone(),
            start_ms: self.epoch_ms + self.meter.first_ms().unwrap_or(0),
        });
        while self.history.len() > 10
            || self
                .history
                .iter()
                .map(|row| row.recording.events.len())
                .sum::<usize>()
                > companion_core::MAX_EVENTS
        {
            self.history.pop_front();
        }
        self.encounter += 1;
        self.meter = Meter::default();
        self.meter_targets.clear();
        Ok(())
    }
    fn add_hits(&mut self, at_ms: u64, hits: Vec<Hit>) -> Result<(), String> {
        if self.auto_end {
            self.meter.end_if_idle(at_ms);
        }
        for hit in hits {
            if hit.amount == 0 {
                continue;
            }
            let party_damage =
                self.entities.party_member(hit.actor) && !self.entities.spawned(hit.actor);
            if !party_damage && (self.meter.ended() || !self.meter_targets.contains(&hit.target)) {
                continue;
            }
            if self.meter.ended() {
                self.archive()?;
            }
            if party_damage {
                self.meter_targets.insert(hit.target);
            }
            self.meter.add(at_ms, hit)?;
        }
        Ok(())
    }
}

fn id_from_label(label: &str) -> Option<u32> {
    label.rsplit_once('#')?.1.parse().ok()
}
fn skill_label(label: &str, names: &BTreeMap<u32, String>) -> String {
    id_from_label(label)
        .and_then(|id| names.get(&id).map(|name| format!("{name} (#{id})")))
        .unwrap_or_else(|| label.into())
}
fn decorate(
    mut recording: Recording,
    entities: &Entities,
    names: &BTreeMap<u32, String>,
    stats: &Value,
    party_only: bool,
) -> Result<Recording, String> {
    if party_only {
        recording.events.retain(|event| match event {
            companion_core::Event::Damage { source, .. } => {
                id_from_label(source).is_some_and(|id| entities.party_member(id))
            }
            _ => true,
        });
    }
    for event in &mut recording.events {
        if let companion_core::Event::Damage {
            source,
            target,
            skill,
            ..
        } = event
        {
            if let Some(id) = id_from_label(source) {
                *source = entities.label(id);
            }
            if let Some(id) = id_from_label(target) {
                *target = entities.label(id);
            }
            *skill = skill_label(skill, names);
        }
    }
    recording.events.insert(0,companion_core::Event::Gap{at_ms:0,reason:format!("Experimental PvE capture. Names require observed identity packets; explicit spawn ownership is used, inferred owners are not guessed. Healing-family attacks need a confirmed monster target. Auto encounters use 10s inactivity. Party filter: {party_only}. Diagnostics: {stats}")});
    recording.validate()?;
    Ok(recording)
}

struct Worker {
    stop: Arc<AtomicBool>,
    handle: std::thread::JoinHandle<()>,
}

#[derive(Default)]
pub struct LiveCapture {
    worker: Mutex<Option<Worker>>,
    shared: Arc<Mutex<Shared>>,
    // Never acquired by the capture worker. Serializes expensive polling reports
    // without holding the capture mutex, including polls from separate webviews.
    report_cache: Mutex<Option<reports::CachedReport>>,
    // Serializes preference edits and their native side effects. As with report
    // work, acquire this before shared state and never from the capture worker.
    settings_transaction: Mutex<()>,
}

/// One worker owns capture for the app lifetime. Reopening adapters after an error
/// never depends on a webview being mounted, shown or focused.
fn run_continuously(
    stop: &AtomicBool,
    shared: &Mutex<Shared>,
    mut capture: impl FnMut() -> Result<(), String>,
    mut wait: impl FnMut(&AtomicBool),
) -> Result<(), String> {
    while !stop.load(Ordering::Acquire) {
        let result = capture();
        if stop.load(Ordering::Acquire) {
            return result;
        }
        {
            let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
            let now = state.now();
            state.offline.finish("capture_error", now);
            state.archive()?;
            state.offline.reset_connection(now);
            let pets = state.pets.clone();
            state.entities = Entities::default();
            state.clear_odyle();
            state.cubes.reset_connection();
            state.group_trace.records.clear();
            state.stopped_ms = now;
            state.running = false;
            state.phase = "error".into();
            let error = result
                .err()
                .unwrap_or_else(|| "Capture worker ended unexpectedly.".into());
            diagnostics::record("error", "capture", &error);
            state.message = format!("{error} Retrying automatically in 10 seconds.");
            drop(state);
            pets.lock()
                .map_err(|_| "Pet state unavailable")?
                .reset_connection();
        }
        wait(stop);
        if !stop.load(Ordering::Acquire) {
            let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
            state.running = true;
            state.phase = "starting".into();
            state.message = "Reconnecting automatic live capture…".into();
        }
    }
    Ok(())
}

fn wait_for_retry(stop: &AtomicBool) {
    // Quitting remains responsive even if Npcap is missing or unavailable.
    for _ in 0..100 {
        if stop.load(Ordering::Acquire) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

impl LiveCapture {
    /// Support state without raw protocol evidence, recordings or expensive reports.
    pub fn support_snapshot(&self) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let o = &s.offline;
        let settings = [
            "locale",
            "dps_mode",
            "party_only",
            "auto_save",
            "idle_timeout_ms",
            "opacity",
            "scale",
            "privacy_mode",
        ]
        .into_iter()
        .filter_map(|key| o.settings.get(key).map(|v| (key.to_owned(), v.clone())))
        .collect::<serde_json::Map<String, Value>>();
        let group =
            serde_json::to_value(&s.entities.group_diagnostic).map_err(|e| e.to_string())?;
        Ok(json!({
            "running":s.running,"phase":s.phase,"message":s.message,"stats":s.stats,
            "duration_ms":s.now(),"event_count":s.meter.event_count(),"encounter":s.encounter,
            "named_entities":s.entities.named_count(),"local_known":s.entities.local.is_some(),
            "party_members":s.entities.party_count(),"roster_seen":s.entities.roster_seen,
            "roster_age_ms":s.entities.roster_observed_ms.map(|seen|wall_clock().saturating_sub(seen)),
            "roster":s.entities.group_members().into_iter().take(64).collect::<Vec<_>>(),
            "roster_frames":group["roster_frames"],"ready_frames":group["ready_frames"],
            "last_ready_outcome":group["last_ready"]["outcome"],
            "last_ready_length":group["last_ready"]["length"],
            "library_count":o.library_count(),"settings":settings,
            "catalogue":{"skills":o.catalogue.skills.len(),"npcs":o.catalogue.npcs.len()},
            "storage_error":o.storage.as_ref().and_then(|storage|storage.error()),
            "persistence_error":o.persistence_error,"offline_error":o.error
        }))
    }
    pub fn start_automatic(&self) -> Result<Value, String> {
        self.start(13328)
    }
    pub fn cubes_status(&self) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let (cubes, running, phase, message, capture_id) = (
            s.cubes.clone(),
            s.running,
            s.phase.clone(),
            s.message.clone(),
            s.epoch_ms,
        );
        drop(s);
        Ok(cubes.status(running, &phase, &message, capture_id, wall_clock()))
    }
    pub fn cubes_clear(&self) -> Result<Value, String> {
        self.shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .cubes
            .clear();
        self.cubes_status()
    }
    /// Small map-position snapshot; contains no inferred gathering availability.
    pub fn gathering_status(&self) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        Ok(s.cubes.world_status(s.running, &s.phase, &s.message, s.epoch_ms, wall_clock()))
    }
    pub fn pets_status(&self, profile_id: Option<&str>) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let (pets, running, phase, message) = (
            s.pets.clone(),
            s.running,
            s.phase.clone(),
            s.message.clone(),
        );
        drop(s);
        let pets = pets.lock().map_err(|_| "Pet state unavailable")?;
        Ok(pets.status(profile_id, running, &phase, &message, wall_clock()))
    }
    pub fn pets_configure(&self, config: Value) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let (pets, running, phase, message) = (
            s.pets.clone(),
            s.running,
            s.phase.clone(),
            s.message.clone(),
        );
        drop(s);
        let mut pets = pets.lock().map_err(|_| "Pet state unavailable")?;
        pets.configure(config)?;
        Ok(pets.status(None, running, &phase, &message, wall_clock()))
    }
    pub fn pets_motion(&self, profile_id: Option<&str>) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let (pets, running) = (s.pets.clone(), s.running);
        drop(s);
        let pets = pets.lock().map_err(|_| "Pet state unavailable")?;
        Ok(pets.motion_status(profile_id, running, wall_clock()))
    }
    /// Bounded identity evidence for local protocol debugging; no game memory or account data.
    pub fn identity_diagnostic(&self) -> Result<Value, String> {
        let mut state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        state.group_trace.enabled = true;
        state.group_trace.identity_mode = true;
        Ok(
            json!({"local":state.entities.local,"names":state.entities.name_bindings(),
            "local_identity_source":state.entities.local_identity_source,
            "self_records":state.entities.self_records,"last_self_header":state.entities.last_self_header,
            "last_self_outcome":state.entities.last_self_outcome,
            "trace":{"sampled":true,"max_record_bytes":8192,"max_records":256,"per_opcode":4,
                "max_hex_bytes":1048576,"records":state.group_trace.records}}),
        )
    }

    /// End explicit packet sampling without resetting the observed character or combat.
    pub fn finish_identity_diagnostic(&self) -> Result<(), String> {
        let mut state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        state.group_trace.enabled = false;
        state.group_trace.identity_mode = false;
        state.group_trace.records.clear();
        Ok(())
    }
    /// At most one unsupported roster frame, never combat traffic or credentials.
    /// This is used by the optional local diagnostics file, not the Group view's polling API.
    pub fn group_protocol_diagnostic(&self) -> Result<Option<String>, String> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .entities
            .unparsed_roster
            .clone())
    }

    /// Local development/opt-in diagnostics, separate from the normal Group polling API.
    pub fn group_debug_snapshot(&self) -> Result<Value, String> {
        let mut state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        state.group_trace.enabled = true;
        Ok(json!({"schema_version":1,"kind":"aion-group-diagnostic",
            "updates":state.entities.group_diagnostic,"unparsed_roster":state.entities.unparsed_roster,
            "small_frames":state.group_trace.records}))
    }

    /// Lobby inspection is deliberately independent from combat totals and party filtering.
    pub fn group_snapshot(&self) -> Result<Value, String> {
        let state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |time| time.as_millis() as u64);
        Ok(
            json!({"capture_id":state.epoch_ms,"running":state.running,"phase":state.phase,
            "message":state.message,"roster_seen":state.entities.roster_seen,
            "roster_age_ms":state.entities.roster_observed_ms.map(|seen|now.saturating_sub(seen)),
            "members":state.entities.group_members(),"inspections":state.entities.inspections(),
            "lobby_name":state.entities.lobby_name,"capacity":state.entities.capacity,
            "party_id":state.entities.party_id,"ready_check":{"active":null,"started_ms":null,"observed_ms":state.entities.ready_observed_ms,"oldest_observed_ms":state.entities.group_members().iter().filter_map(|m|m.ready_observed_ms).min(),"expires_ms":null,"source":"observed lobby member readiness","supported":true}}),
        )
    }

    pub fn start(&self, port: u16) -> Result<Value, String> {
        if port == 0 {
            return Err("Choose a nonzero game server port.".into());
        }
        let mut worker = self
            .worker
            .lock()
            .map_err(|_| "Capture control unavailable")?;
        if let Some(active) = worker.as_ref() {
            if !active.handle.is_finished() {
                return self.snapshot();
            }
        }
        if let Some(old) = worker.take() {
            let _ = old.handle.join();
        }
        let pets = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .pets
            .clone();
        pets.lock()
            .map_err(|_| "Pet state unavailable")?
            .reset_connection();
        {
            let mut state = self
                .shared
                .lock()
                .map_err(|_| "Capture state unavailable")?;
            state.archive()?;
            let history = std::mem::take(&mut state.history);
            let skill_names = std::mem::take(&mut state.skill_names);
            let mut offline = std::mem::take(&mut state.offline);
            let pets = std::mem::take(&mut state.pets);
            offline.reset_connection(state.now());
            *state = Shared {
                running: true,
                phase: "starting".into(),
                message: "Starting independent Npcap capture…".into(),
                encounter: state.encounter,
                history,
                offline,
                pets,
                skill_names,
                party_only: state.party_only,
                auto_end: state.auto_end,
                ..Shared::default()
            };
        }
        let stop = Arc::new(AtomicBool::new(false));
        diagnostics::record("info", "capture", "Starting automatic capture");
        let flag = stop.clone();
        let shared = self.shared.clone();
        let handle = std::thread::Builder::new()
            .name("aion-passive-capture".into())
            .spawn(move || {
                let result =
                    run_continuously(&flag, &shared, || run(port, &flag, &shared), wait_for_retry);
                if let Ok(mut state) = shared.lock() {
                    let now = state.now();
                    state.offline.finish(
                        if result.is_ok() {
                            "stopped"
                        } else {
                            "capture_error"
                        },
                        now,
                    );
                    state.stopped_ms = state.now();
                    state.running = false;
                    state.clear_odyle();
                    state.cubes.reset_connection();
                    match result {
                        Ok(()) => {
                            diagnostics::record("info", "capture", "Capture stopped");
                            state.phase = "stopped".into();
                            state.message = "Capture stopped. Live results are retained.".into();
                        }
                        Err(error) => {
                            diagnostics::record("error", "capture", &error);
                            state.phase = "error".into();
                            state.message = error;
                        }
                    }
                }
            })
            .map_err(|e| {
                let message = e.to_string();
                diagnostics::record("error", "capture", &message);
                if let Ok(mut state) = self.shared.lock() {
                    state.running = false;
                    state.phase = "error".into();
                    state.message = message.clone();
                }
                message
            })?;
        *worker = Some(Worker { stop, handle });
        self.snapshot()
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .snapshot())
    }

    pub fn stop(&self) -> Result<Value, String> {
        let mut worker = self
            .worker
            .lock()
            .map_err(|_| "Capture control unavailable")?;
        if let Some(worker) = worker.take() {
            worker.stop.store(true, Ordering::Release);
            worker
                .handle
                .join()
                .map_err(|_| "Capture worker exited unexpectedly")?;
        }
        {
            let mut state = self
                .shared
                .lock()
                .map_err(|_| "Capture state unavailable")?;
            let now = state.now();
            state.offline.finish("stopped", now);
            state.cubes.reset_connection();
        }
        let pets = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .pets
            .clone();
        pets.lock()
            .map_err(|_| "Pet state unavailable")?
            .checkpoint()?;
        flush_storage(&self.shared, true)?;
        self.snapshot()
    }

    pub fn reset(&self) -> Result<Value, String> {
        storage_operation(
            &self.shared,
            |state| {
                state.archive()?;
                let now = state.now();
                state.offline.finish("manual", now);
                state.offline.clear();
                state.reset_ms = state.now();
                state.generation += 1;
                Ok(state.snapshot())
            },
            false,
        )
    }

    pub fn recording(&self) -> Result<Recording, String> {
        self.recording_id(None)
    }
    pub fn recording_id(&self, id: Option<u64>) -> Result<Recording, String> {
        let state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let (recording, entities, stats) = if let Some(id) = id {
            let row = state
                .history
                .iter()
                .find(|r| r.id == id)
                .ok_or("Encounter is no longer retained in memory.")?;
            (
                row.recording.clone(),
                row.entities.clone(),
                row.stats.clone(),
            )
        } else {
            if state.running && !state.meter.ended() {
                return Err(
                    "Wait for the current fight to end, or open a completed fight from history."
                        .into(),
                );
            }
            (
                state.meter.recording(state.now())?,
                state.entities.clone(),
                state.stats.clone(),
            )
        };
        let names = state.skill_names.clone();
        let party_only = state.party_only;
        drop(state);
        decorate(recording, &entities, &names, &stats, party_only)
    }
    pub fn configure(&self, auto_end: bool, party_only: bool) -> Result<Value, String> {
        let _transaction = self
            .settings_transaction
            .lock()
            .map_err(|_| "Settings transaction unavailable")?;
        self.persist_offline_settings(json!({"party_only":party_only}))?;
        let mut state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        // A finished encounter cannot be resumed into its already archived time window.
        if state.meter.ended() && !auto_end {
            state.archive()?;
        }
        state.auto_end = auto_end;
        state.party_only = party_only;
        Ok(state.snapshot())
    }
    pub fn set_skill_names(&self, names: BTreeMap<u32, String>) -> Result<(), String> {
        if names.len() > 50_000
            || names
                .values()
                .any(|name| name.is_empty() || name.len() > 160)
        {
            return Err("Invalid optional skill label catalog.".into());
        }
        let mut state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        state.offline.set_names(&names);
        state.skill_names.extend(names);
        Ok(())
    }
    pub fn comparison_report(&self) -> Result<Value, String> {
        let state = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let mut recordings: Vec<_> = state
            .history
            .iter()
            .map(|r| (r.id, r.start_ms, r.recording.clone(), r.stats.clone()))
            .collect();
        if state.meter.event_count() > 0 {
            recordings.push((
                state.encounter,
                state.epoch_ms + state.meter.first_ms().unwrap_or(0),
                state.meter.recording(state.now())?,
                state.stats.clone(),
            ));
        }
        let start = state.epoch_ms;
        let end = state.epoch_ms + state.now();
        drop(state);
        let recordings: Vec<Value> = recordings.into_iter().map(|(id,start_ms,recording,stats)|json!({"id":id,"start_ms":start_ms,"recording":recording,"stats":stats})).collect();
        Ok(
            json!({"schema_version":1,"kind":"aion-independent-comparison","capture_start_ms":start,"capture_end_ms":end,"recordings":recordings}),
        )
    }
}

impl Drop for LiveCapture {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(windows)]
fn run(port: u16, stop: &AtomicBool, shared: &Arc<Mutex<Shared>>) -> Result<(), String> {
    windows::capture(port, stop, shared)
}
#[cfg(not(windows))]
fn run(_: u16, _: &AtomicBool, _: &Arc<Mutex<Shared>>) -> Result<(), String> {
    Err("Independent live capture currently requires Windows and Npcap.".into())
}

fn publish(
    shared: &Mutex<Shared>,
    pipeline: &Pipeline,
    adapters: usize,
    dropped: u64,
) -> Result<(), String> {
    let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
    state.stats = json!({"adapters":adapters,"packets":pipeline.packets,"frames":pipeline.decoder.frames,"bundles":pipeline.decoder.bundles,"rejected":pipeline.decoder.rejected,"gaps":pipeline.gaps,"retransmissions":pipeline.retransmissions,"desyncs":pipeline.desyncs,"dropped":dropped,"metadata_dropped":pipeline.decoder.observation_drops});
    let stats = state.stats.clone();
    state.offline.capture_quality(&stats);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_core::wire::Hit;

    fn odyle_decoder() -> companion_core::wire::Decoder {
        let mut decoder = companion_core::wire::Decoder::default();
        assert!(decoder
            .decode(&[0x0b, 0x61, 0x0c, 1, 0x87, 0x93, 3, 15, 0x93, 2])
            .is_empty());
        decoder
    }

    #[test]
    fn odyle_status_is_observed_without_combat_and_zero_is_not_unknown() {
        let mut state = Shared {
            running: true,
            phase: "capturing".into(),
            epoch_ms: 1000,
            ..Shared::default()
        };
        assert_eq!(state.snapshot()["odyle"], Value::Null);
        let mut decoder = odyle_decoder();
        state.receive_odyle(&decoder.odyle, 20);
        assert_eq!(
            state.snapshot()["odyle"],
            json!({"base":15,"bonus":275,"observed_ms":1020})
        );
        state.receive_odyle(&decoder.odyle, 40);
        assert_eq!(state.snapshot()["odyle"]["observed_ms"], 1020);
        decoder.decode(&[0x0c, 0x61, 0, 0, 1, 0x87, 0x93, 3]);
        state.receive_odyle(&decoder.odyle, 50);
        assert_eq!(
            state.snapshot()["odyle"],
            json!({"base":0,"bonus":0,"observed_ms":1050})
        );
        assert_eq!(state.snapshot()["events"], 0);
        state.running = false;
        assert_eq!(state.snapshot()["odyle"], Value::Null);
    }

    #[test]
    fn combat_reset_keeps_odyle_but_connection_and_identity_resets_clear_it() {
        let capture = LiveCapture::default();
        let mut decoder = odyle_decoder();
        {
            let mut state = capture.shared.lock().unwrap();
            state.running = true;
            state.phase = "capturing".into();
            state.receive_odyle(&decoder.odyle, 0);
        }
        assert_eq!(capture.reset().unwrap()["odyle"]["bonus"], 275);
        decoder.entities.local = Some(1);
        decoder.decode(&[0, 1]);
        decoder.entities.local = Some(2);
        decoder.decode(&[0, 1]);
        {
            let mut state = capture.shared.lock().unwrap();
            state.receive_odyle(&decoder.odyle, 10);
            assert_eq!(state.snapshot()["odyle"], Value::Null);
            state.clear_odyle();
            state.receive_odyle(&odyle_decoder().odyle, 20);
            assert_eq!(state.snapshot()["odyle"]["base"], 15);
            state.clear_odyle();
            assert_eq!(state.snapshot()["odyle"], Value::Null);
        }
    }

    fn hit() -> Hit {
        Hit {
            actor: 1,
            target: 2,
            skill: 14_000_100,
            amount: 1234,
            critical: true,
            tick: false,
        }
    }

    #[test]
    fn fallback_meter_waits_for_our_damage_and_ignores_unrelated_targets() {
        let mut state = Shared::default();
        state.add_hits(500, vec![hit()]).unwrap();
        assert_eq!(state.snapshot()["events"], 0);
        state.entities.local = Some(1);
        state
            .add_hits(1000, vec![Hit { actor: 3, ..hit() }])
            .unwrap();
        assert_eq!(state.snapshot()["events"], 0);
        state
            .add_hits(2000, vec![Hit { amount: 0, ..hit() }])
            .unwrap();
        assert_eq!(state.snapshot()["events"], 0);
        state.add_hits(3000, vec![hit()]).unwrap();
        state
            .add_hits(
                4000,
                vec![
                    Hit { actor: 3, ..hit() },
                    Hit {
                        actor: 4,
                        target: 30,
                        ..hit()
                    },
                ],
            )
            .unwrap();
        assert_eq!(state.snapshot()["events"], 2);
        state
            .add_hits(15000, vec![Hit { actor: 4, ..hit() }])
            .unwrap();
        assert!(state.history.is_empty());
        assert_eq!(state.snapshot()["events"], 2);
        state
            .add_hits(
                16000,
                vec![Hit {
                    target: 30,
                    ..hit()
                }],
            )
            .unwrap();
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.snapshot()["events"], 1);
    }

    #[test]
    fn default_and_invalid_start_never_open_capture() {
        let capture = LiveCapture::default();
        assert_eq!(capture.snapshot().unwrap()["running"], false);
        assert!(capture.start(0).is_err());
        assert!(capture.worker.lock().unwrap().is_none());
        assert!(capture.recording().is_err());
        capture.stop().unwrap();
    }

    #[test]
    fn cube_ipc_keeps_combat_reset_separate_from_clear_and_stop() {
        use companion_core::wire::cubes::{Observation, Point};
        let capture = LiveCapture::default();
        assert!(capture.cubes_status().unwrap()["cubes"]
            .as_array()
            .unwrap()
            .is_empty());
        {
            let mut state = capture.shared.lock().unwrap();
            state.running = true;
            state.phase = "capturing".into();
            state.entities.local = Some(7);
            let identity = state.entities.clone();
            state.cubes.receive(
                vec![
                    Observation::Position {
                        entity: 7,
                        position: Point {
                            x: 1000.,
                            y: 1000.,
                            z: Some(0.),
                        },
                    },
                    Observation::Spawn {
                        entity: 8,
                        template: 1200039,
                        position: Point {
                            x: 1000.,
                            y: 1500.,
                            z: Some(100.),
                        },
                    },
                ],
                &identity,
                wall_clock(),
            );
        }
        let before = capture.cubes_status().unwrap();
        assert_eq!(before["cubes"][0]["distance_m"], 5.);
        let gathering = capture.gathering_status().unwrap();
        assert_eq!(gathering["position"], before["position"]);
        assert!(gathering.get("cubes").is_none());
        capture.reset().unwrap();
        assert_eq!(capture.cubes_status().unwrap()["cubes"], before["cubes"]);
        let cleared = capture.cubes_clear().unwrap();
        assert!(cleared["cubes"].as_array().unwrap().is_empty());
        assert!(cleared["position"].is_object());
        assert_ne!(cleared["session_id"], before["session_id"]);
        assert_eq!(capture.gathering_status().unwrap()["position"], gathering["position"]);
        capture.stop().unwrap();
        assert!(capture.cubes_status().unwrap()["position"].is_null());
        assert!(capture.gathering_status().unwrap()["position"].is_null());
    }

    #[test]
    fn support_snapshot_does_not_include_packets_or_combat_events() {
        let capture = LiveCapture::default();
        {
            let mut state = capture.shared.lock().unwrap();
            state.entities.unparsed_roster = Some("secret-packet-hex".into());
            state.offline.settings["account_token"] = json!("secret-account-token");
            state.stats = json!({"packets":12,"dropped":1});
        }
        let report = capture.support_snapshot().unwrap();
        let text = report.to_string();
        assert!(!text.contains("secret-packet-hex"));
        assert!(!text.contains("secret-account-token"));
        assert!(report.get("events").is_none());
        assert!(report.get("report").is_none());
        assert_eq!(report["stats"]["packets"], 12);
        assert_eq!(report["library_count"], 0);
    }

    #[test]
    fn identity_diagnostics_distinguish_missing_and_rejected_self_records() {
        let capture = LiveCapture::default();
        assert_eq!(
            capture.identity_diagnostic().unwrap()["last_self_outcome"],
            Value::Null
        );
        {
            let mut state = capture.shared.lock().unwrap();
            state.entities.observe(&[0x33, 0x36, 1]).unwrap();
        }
        let rejected = capture.identity_diagnostic().unwrap();
        assert_eq!(rejected["self_records"], 1);
        assert_eq!(rejected["last_self_outcome"], "truncated_masks");
        assert_eq!(rejected["local"], Value::Null);
        let source = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../companion-core/tests/fixtures/self-identity-aahz.hex"
        ));
        let frame: Vec<_> = source
            .trim()
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        capture
            .shared
            .lock()
            .unwrap()
            .entities
            .observe(&frame)
            .unwrap();
        let accepted = capture.identity_diagnostic().unwrap();
        assert_eq!(accepted["last_self_outcome"], "accepted");
        assert_eq!(accepted["local"], 331);
        assert!(capture.shared.lock().unwrap().group_trace.identity_mode);
        assert!(!capture
            .support_snapshot()
            .unwrap()
            .to_string()
            .contains("last_self_header"));
    }

    #[test]
    fn automatic_capture_retries_errors_and_keeps_completed_damage() {
        use std::cell::Cell;
        let capture = LiveCapture::default();
        {
            let mut state = capture.shared.lock().unwrap();
            state.running = true;
            state.meter.add(0, hit()).unwrap();
            state.receive_odyle(&odyle_decoder().odyle, 0);
        }
        let stop = AtomicBool::new(false);
        let attempts = Cell::new(0);
        let waits = Cell::new(0);
        run_continuously(
            &stop,
            &capture.shared,
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() == 1 {
                    return Err("Test adapter unavailable".into());
                }
                let state = capture.shared.lock().unwrap();
                assert!(state.running);
                assert!(state.odyle.is_none());
                assert_eq!(state.history.len(), 1);
                assert_eq!(state.history[0].recording.events.len(), 1);
                assert_eq!(state.meter.event_count(), 0);
                drop(state);
                stop.store(true, Ordering::Release);
                Ok(())
            },
            |_| {
                waits.set(waits.get() + 1);
                let snapshot = capture.snapshot().unwrap();
                assert_eq!(snapshot["running"], false);
                assert_eq!(snapshot["phase"], "error");
                assert!(snapshot["message"]
                    .as_str()
                    .unwrap()
                    .contains("Test adapter unavailable"));
                assert!(snapshot["message"]
                    .as_str()
                    .unwrap()
                    .contains("Retrying automatically"));
            },
        )
        .unwrap();
        assert_eq!(attempts.get(), 2);
        assert_eq!(waits.get(), 1);
    }

    #[test]
    fn quitting_during_retry_does_not_restart_capture() {
        let stop = AtomicBool::new(false);
        let capture = LiveCapture::default();
        let mut attempts = 0;
        run_continuously(
            &stop,
            &capture.shared,
            || {
                attempts += 1;
                Err("Test driver unavailable".into())
            },
            |flag| {
                flag.store(true, Ordering::Release);
            },
        )
        .unwrap();
        assert_eq!(attempts, 1);
    }

    #[test]
    fn another_start_request_does_not_replace_an_active_worker() {
        let capture = LiveCapture::default();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::spawn(move || {
            while !flag.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        });
        *capture.worker.lock().unwrap() = Some(Worker { stop, handle });
        {
            let mut state = capture.shared.lock().unwrap();
            state.running = true;
            state.meter.add(0, hit()).unwrap();
        }
        assert_eq!(capture.start_automatic().unwrap()["events"], 1);
        capture.stop().unwrap();
        assert!(capture.worker.lock().unwrap().is_none());
    }

    #[test]
    fn reports_can_be_saved_while_capture_continues() {
        let capture = LiveCapture::default();
        {
            let mut state = capture.shared.lock().unwrap();
            state.running = true;
            state.meter.add(0, hit()).unwrap();
        }
        let report = capture.comparison_report().unwrap();
        assert_eq!(
            report["recordings"][0]["recording"]["events"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(capture.snapshot().unwrap()["running"], true);
        assert_eq!(capture.snapshot().unwrap()["events"], 1);
    }

    #[test]
    fn group_message_trace_is_opt_in_and_separate_from_normal_polling() {
        let capture = LiveCapture::default();
        assert!(!capture.shared.lock().unwrap().group_trace.enabled);
        let normal = capture.group_snapshot().unwrap();
        assert!(!capture.shared.lock().unwrap().group_trace.enabled);
        assert!(normal.get("small_frames").is_none());
        capture.group_debug_snapshot().unwrap();
        let mut decoder = companion_core::wire::Decoder::default();
        decoder.group_trace.enabled = capture.shared.lock().unwrap().group_trace.enabled;
        decoder.decode(&[0x7f, 0x97, 1, 2]);
        capture
            .shared
            .lock()
            .unwrap()
            .group_trace
            .append(decoder.group_trace.take());
        let diagnostic = capture.group_debug_snapshot().unwrap();
        assert_eq!(diagnostic["small_frames"][0]["opcode"], 0x7f97);
        assert_eq!(diagnostic["small_frames"][0]["hex"], "7f970102");
        assert!(capture
            .group_snapshot()
            .unwrap()
            .get("small_frames")
            .is_none());
    }

    #[test]
    fn group_readiness_updates_reach_polling_and_keep_decode_evidence_separate() {
        let capture = LiveCapture::default();
        let fixture = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../companion-core/tests/fixtures/group-roster-flutschie.hex"
        ));
        let roster: Vec<_> = fixture
            .trim()
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        capture
            .shared
            .lock()
            .unwrap()
            .entities
            .observe(&roster)
            .unwrap();
        let initial = capture.group_snapshot().unwrap();
        let id: u64 = initial["members"][0]["character_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let mut update = vec![0x16, 0x97];
        update.extend_from_slice(&id.to_le_bytes());
        update.push(1);
        for ready in [true, false] {
            update[10] = u8::from(ready);
            capture
                .shared
                .lock()
                .unwrap()
                .entities
                .observe(&update)
                .unwrap();
            let group = capture.group_snapshot().unwrap();
            assert_eq!(group["members"][0]["ready"], ready);
            assert!(group["members"][0]["ready_observed_ms"].as_u64().unwrap() > 0);
            assert_eq!(
                group["members"][0]["ready_observed_ms"],
                group["ready_check"]["observed_ms"]
            );
            assert!(group.get("protocol_diagnostic").is_none());
        }
        let before = capture.group_snapshot().unwrap()["members"].clone();
        update[2] ^= 0x80;
        capture
            .shared
            .lock()
            .unwrap()
            .entities
            .observe(&update)
            .unwrap();
        assert_eq!(
            capture.group_debug_snapshot().unwrap()["updates"]["last_ready"]["outcome"],
            "unknown_member"
        );
        update.push(0);
        capture
            .shared
            .lock()
            .unwrap()
            .entities
            .observe(&update)
            .unwrap();
        let diagnostic = capture.group_debug_snapshot().unwrap();
        assert_eq!(diagnostic["updates"]["ready_frames"], 4);
        assert_eq!(diagnostic["updates"]["roster_frames"], 1);
        assert_eq!(
            diagnostic["updates"]["last_ready"]["outcome"],
            "unsupported_length"
        );
        assert_eq!(capture.group_snapshot().unwrap()["members"], before);
    }

    #[test]
    fn lobby_inspections_do_not_require_combat_or_party_membership() {
        let capture = LiveCapture::default();
        let mut frame = vec![0x50, 0x36, 0, 0, 7, 3, b'A', b'b', b'c'];
        frame.extend_from_slice(&6u32.to_le_bytes());
        frame.extend_from_slice(&[1, 2]);
        frame.extend_from_slice(&45u32.to_le_bytes());
        frame.extend_from_slice(&[0; 4]);
        frame.extend_from_slice(&2380u32.to_le_bytes());
        frame.resize(40, 0);
        capture
            .shared
            .lock()
            .unwrap()
            .entities
            .observe(&frame)
            .unwrap();
        capture.configure(true, true).unwrap();
        let group = capture.group_snapshot().unwrap();
        assert_eq!(group["inspections"][0]["name"], "Abc");
        assert_eq!(group["inspections"][0]["gear_score"], 2380);
        assert_eq!(group["members"].as_array().unwrap().len(), 0);
        assert_eq!(capture.snapshot().unwrap()["events"], 0);
    }

    #[test]
    fn a_late_self_identity_replaces_the_pending_name_without_changing_damage() {
        let capture = LiveCapture::default();
        let mut event = hit();
        event.actor = 331;
        {
            let mut state = capture.shared.lock().unwrap();
            state.meter.add(0, event).unwrap();
            state.stopped_ms = 1000;
        }
        let pending = capture.snapshot().unwrap();
        assert!(pending["players"].as_array().unwrap().is_empty());
        let source = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../companion-core/tests/fixtures/self-identity-aahz.hex"
        ));
        let body: Vec<_> = source
            .trim()
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        capture
            .shared
            .lock()
            .unwrap()
            .entities
            .observe(&body)
            .unwrap();
        let resolved = capture.snapshot().unwrap();
        assert_eq!(resolved["players"][0]["name_known"], true);
        assert_eq!(resolved["players"][0]["name"], "Aahz");
        assert_eq!(resolved["players"][0]["is_local"], true);
        assert_eq!(resolved["players"][0]["damage"], hit().amount);
        assert_eq!(resolved["players"][0]["dps"], hit().amount as f64);
    }

    #[test]
    fn attribute_fallback_labels_existing_damage_without_a_self_record() {
        let capture = LiveCapture::default();
        let mut event = hit();
        event.actor = 331;
        {
            let mut state = capture.shared.lock().unwrap();
            state.meter.add(0, event).unwrap();
            state.stopped_ms = 1000;
        }
        let pending = capture.snapshot().unwrap();
        assert!(pending["players"].as_array().unwrap().is_empty());
        let source = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../companion-core/tests/fixtures/local-attribute-identity.hex"
        ));
        for line in source.lines() {
            let frame: Vec<_> = line
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
                .collect();
            capture
                .shared
                .lock()
                .unwrap()
                .entities
                .observe(&frame)
                .unwrap();
        }
        let resolved = capture.snapshot().unwrap();
        assert_eq!(resolved["players"][0]["name"], "Testactor");
        assert_eq!(resolved["players"][0]["is_local"], true);
        assert_eq!(resolved["players"][0]["damage"], hit().amount);
        assert_eq!(resolved["players"][0]["dps"], hit().amount as f64);
        assert_eq!(capture.identity_diagnostic().unwrap()["self_records"], 0);
        capture.finish_identity_diagnostic().unwrap();
        assert_eq!(capture.snapshot().unwrap()["players"][0]["is_local"], true);
        assert_eq!(
            capture.snapshot().unwrap()["players"][0]["damage"],
            resolved["players"][0]["damage"]
        );
        let state = capture.shared.lock().unwrap();
        assert!(!state.group_trace.enabled);
        assert!(!state.group_trace.identity_mode);
        assert!(state.group_trace.records.is_empty());
    }

    #[test]
    fn export_retains_damage_and_capture_loss_information() {
        let capture = LiveCapture::default();
        {
            let mut state = capture.shared.lock().unwrap();
            state.meter.add(0, hit()).unwrap();
            state.stopped_ms = 2000;
            state.stats = json!({"gaps":2,"dropped":3});
        }
        let recording = capture.recording().unwrap();
        let snapshot = recording.snapshot(2000).unwrap();
        assert_eq!(snapshot.players["Entity #1"].damage, 1234);
        assert!(snapshot.gaps[0].contains("\"gaps\":2"));
        assert!(snapshot.gaps[0].contains("\"dropped\":3"));
    }

    #[test]
    fn reset_keeps_capture_state_and_invalidates_pending_generation() {
        let capture = LiveCapture::default();
        {
            let mut state = capture.shared.lock().unwrap();
            state.running = true;
            state.meter.add(0, hit()).unwrap();
        }
        assert!(capture.recording().is_err());
        let snapshot = capture.reset().unwrap();
        assert_eq!(snapshot["events"], 0);
        assert_eq!(snapshot["running"], true);
        assert_eq!(capture.shared.lock().unwrap().generation, 1);
    }

    #[test]
    fn inactivity_archives_previous_fight_and_preserves_replay() {
        let mut state = Shared::default();
        state.entities.local = Some(1);
        state.add_hits(1000, vec![hit()]).unwrap();
        state.add_hits(2000, vec![hit()]).unwrap();
        state.meter.end_if_idle(12000);
        assert!(state.meter.ended());
        assert_eq!(state.meter.duration(12000), 1000);
        assert_eq!(state.meter.players(12000)[0].current_dps, 0.0);
        state.add_hits(13000, vec![hit()]).unwrap();
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].recording.events.len(), 2);
        assert_eq!(state.meter.event_count(), 1);
        assert_eq!(state.encounter, 2);
    }

    #[test]
    fn names_party_filter_and_skill_labels_do_not_change_raw_comparison_damage() {
        let capture = LiveCapture::default();
        {
            let mut state = capture.shared.lock().unwrap();
            let mut local = vec![
                0x33, 0x36, 1, 0, 0, 0, 0, 0x37, 3, b'A', b'b', b'c', 0x18, 5,
            ];
            local.extend_from_slice(&6u32.to_le_bytes());
            local.push(1);
            local.extend_from_slice(&45u32.to_le_bytes());
            state.entities.observe(&local).unwrap();
            state.add_hits(0, vec![hit()]).unwrap();
            let other = Hit { actor: 3, ..hit() };
            state.add_hits(100, vec![other]).unwrap();
            state.stopped_ms = 2000;
        }
        capture
            .set_skill_names(BTreeMap::from([(14_000_100, "Test skill".into())]))
            .unwrap();
        let out = capture.configure(true, true).unwrap();
        assert_eq!(out["players"].as_array().unwrap().len(), 1);
        assert_eq!(out["players"][0]["label"], "Abc #1");
        assert_eq!(out["players"][0]["share"], 1.0);
        let recording = capture.recording().unwrap();
        assert_eq!(
            recording.snapshot(2000).unwrap().players["Abc #1"].damage,
            1234
        );
        let report = capture.comparison_report().unwrap();
        assert_eq!(
            report["recordings"][0]["recording"]["events"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            report["recordings"][0]["recording"]["events"][0]["source"],
            "Entity #1"
        );
    }
}
