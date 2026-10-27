#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub mod wire;
pub mod live;
pub mod combat;

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_EVENTS: usize = 500_000;

/// Original normalized schema, deliberately independent of game wire formats.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Event {
    Damage { at_ms: u64, source: String, target: String, skill: String, amount: u64 },
    Heal { at_ms: u64, source: String, target: String, skill: String, amount: u64 },
    Position { at_ms: u64, actor: String, x: f64, y: f64 },
    Counter { at_ms: u64, character: String, key: String, value: u64, limit: u64 },
    PetSouls { at_ms: u64, character: String, pet: String, owned: u64, required: u64 },
    Gap { at_ms: u64, reason: String },
}

impl Event {
    pub fn at_ms(&self) -> u64 {
        match self {
            Self::Damage { at_ms, .. } | Self::Heal { at_ms, .. }
            | Self::Position { at_ms, .. } | Self::Counter { at_ms, .. }
            | Self::PetSouls { at_ms, .. } | Self::Gap { at_ms, .. } => *at_ms,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recording {
    pub schema_version: u32,
    pub source: String,
    pub duration_ms: u64,
    pub events: Vec<Event>,
}

#[derive(Default, Debug, Serialize)]
pub struct Player {
    pub damage: u64,
    pub healing: u64,
    pub dps: f64,
    pub skills: BTreeMap<String, u64>,
}

#[derive(Debug, Serialize)]
pub struct CounterState {
    pub character: String,
    pub key: String,
    pub value: u64,
    pub limit: u64,
}

#[derive(Debug, Serialize)]
pub struct PetState {
    pub character: String,
    pub pet: String,
    pub owned: u64,
    pub required: u64,
}

#[derive(Default, Debug, Serialize)]
pub struct Snapshot {
    pub at_ms: u64,
    pub players: BTreeMap<String, Player>,
    pub positions: BTreeMap<String, [f64; 2]>,
    pub counters: Vec<CounterState>,
    pub pets: Vec<PetState>,
    pub gaps: Vec<String>,
}

impl Recording {
    /// Accept only this application's versioned recording format.
    pub fn from_json(json: &str) -> Result<Self, String> {
        if json.len() > 128 * 1024 * 1024 {
            return Err("Recording exceeds 128 MiB".into());
        }
        let recording: Self = serde_json::from_str(json).map_err(|e| e.to_string())?;
        recording.validate()?;
        Ok(recording)
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION { return Err("Unsupported recording schema".into()); }
        if self.duration_ms == 0 || self.duration_ms > 86_400_000 { return Err("Duration must be between 1 ms and 24 hours".into()); }
        if self.events.len() > MAX_EVENTS { return Err("Recording exceeds event limit".into()); }
        let mut previous = 0;
        for e in &self.events {
            if e.at_ms() < previous || e.at_ms() > self.duration_ms { return Err("Events must be ordered and within duration".into()); }
            previous = e.at_ms();
            if let Event::Position { x, y, .. } = e {
                if !x.is_finite() || !y.is_finite() { return Err("Position must be finite".into()); }
            }
        }
        Ok(())
    }

    /// Rebuild from time zero so seeking backward cannot retain future state.
    /// DPS denominator is elapsed recording time, not inferred active time.
    pub fn snapshot(&self, requested_ms: u64) -> Result<Snapshot, String> {
        self.validate()?;
        let at_ms = requested_ms.min(self.duration_ms);
        let mut out = Snapshot { at_ms, ..Snapshot::default() };
        let mut counters = BTreeMap::new();
        let mut pets = BTreeMap::new();
        for event in self.events.iter().take_while(|e| e.at_ms() <= at_ms) {
            match event {
                Event::Damage { source, skill, amount, .. } => {
                    let player = out.players.entry(source.clone()).or_default();
                    player.damage = player.damage.checked_add(*amount).ok_or("Damage overflow")?;
                    let total = player.skills.entry(skill.clone()).or_default();
                    *total = total.checked_add(*amount).ok_or("Skill damage overflow")?;
                }
                Event::Heal { source, amount, .. } => {
                    let player = out.players.entry(source.clone()).or_default();
                    player.healing = player.healing.checked_add(*amount).ok_or("Healing overflow")?;
                }
                Event::Position { actor, x, y, .. } => { out.positions.insert(actor.clone(), [*x, *y]); }
                Event::Counter { character, key, value, limit, .. } => {
                    counters.insert((character.clone(), key.clone()), CounterState {
                        character: character.clone(), key: key.clone(), value: *value, limit: *limit,
                    });
                }
                Event::PetSouls { character, pet, owned, required, .. } => {
                    pets.insert((character.clone(), pet.clone()), PetState {
                        character: character.clone(), pet: pet.clone(), owned: *owned, required: *required,
                    });
                }
                Event::Gap { reason, .. } => out.gaps.push(reason.clone()),
            }
        }
        for player in out.players.values_mut() {
            player.dps = if at_ms == 0 { 0.0 } else { player.damage as f64 * 1000.0 / at_ms as f64 };
        }
        out.counters = counters.into_values().collect();
        out.pets = pets.into_values().collect();
        Ok(out)
    }
}

/// All future sources must produce normalized recordings, never UI-specific data.
pub trait EventSource {
    fn recording(&self) -> Result<Recording, String>;
}

pub struct DemoSource;
impl EventSource for DemoSource {
    fn recording(&self) -> Result<Recording, String> {
        let recording: Recording = serde_json::from_str(include_str!("../../../fixtures/demo.json")).map_err(|e| e.to_string())?;
        recording.validate()?;
        Ok(recording)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn totals_and_backward_seek() {
        let r = DemoSource.recording().unwrap();
        let end = r.snapshot(10_000).unwrap();
        assert_eq!(end.players["Scout"].damage, 3000);
        assert_eq!(end.players["Scout"].dps, 300.0);
        assert_eq!(end.players["Healer"].healing, 800);
        assert_eq!(r.snapshot(1_000).unwrap().players["Scout"].damage, 1000);
        assert!(r.snapshot(0).unwrap().players.is_empty());
    }
    #[test]
    fn updates_replace_and_missing_data_stays_visible() {
        let mut r = DemoSource.recording().unwrap();
        r.events.push(Event::Gap { at_ms: 9000, reason: "Missing segment".into() });
        let s = r.snapshot(10_000).unwrap();
        assert_eq!(s.pets.len(), 1);
        assert_eq!(s.pets[0].owned, 6);
        assert_eq!(s.gaps.len(), 1);
        assert_eq!(r.snapshot(2000).unwrap().pets[0].owned, 5);
    }
    #[test]
    fn invalid_recordings_and_overflow_are_rejected() {
        let mut r = DemoSource.recording().unwrap();
        r.schema_version = 99;
        assert!(r.validate().is_err());
        r.schema_version = 1;
        r.events.reverse();
        assert!(r.validate().is_err());
        r.events = vec![
            Event::Damage { at_ms: 1, source: "A".into(), target: "B".into(), skill: "S".into(), amount: u64::MAX },
            Event::Damage { at_ms: 2, source: "A".into(), target: "B".into(), skill: "S".into(), amount: 1 },
        ];
        assert!(r.snapshot(10).is_err());
    }
    #[test]
    fn native_import_rejects_foreign_formats_and_unrecognized_report_fields() {
        let native = DemoSource.recording().unwrap();
        let text = serde_json::to_string(&native).unwrap();
        assert_eq!(Recording::from_json(&text).unwrap().events.len(), native.events.len());
        assert!(Recording::from_json(r#"{"summary":{},"replay":{}}"#).is_err());
        let mut extra = serde_json::to_value(&native).unwrap();
        extra["saved_report"] = serde_json::json!({"damage":123});
        assert!(Recording::from_json(&extra.to_string()).is_err());
    }
}
