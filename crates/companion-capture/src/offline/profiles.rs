//! Last recorded own-character metadata, keyed by verified server and exact name.
//! Native recordings keep it across restarts without a second profile format.
use companion_core::combat::CombatLog;
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

#[derive(Clone, Default)]
pub(super) struct OwnProfiles(BTreeMap<(u16, String), Profile>);

#[derive(Clone, Copy, Default)]
pub(super) struct Profile {
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
}

impl OwnProfiles {
    pub(super) fn load(root: &Path, index: &BTreeMap<String, Value>) -> Self {
        let mut entries: Vec<_> = index.iter().collect();
        entries.sort_by_key(|(_, row)| std::cmp::Reverse(row["started_ms"].as_u64().unwrap_or(0)));
        let mut scores = Self::default();
        // Metadata recovery must not turn startup into an unbounded log replay.
        let mut budget = 32 * 1024 * 1024u64;
        for (id, _) in entries.into_iter().take(128) {
            let path = root.join("logs").join(format!("{id}.json"));
            let Ok(meta) = std::fs::metadata(&path) else { continue; };
            if meta.len() > budget { continue; }
            budget -= meta.len();
            let Ok(bytes) = crate::persistence::read_bounded(&path, meta.len()) else { continue; };
            let Ok(log) = crate::state_validation::log(&bytes, false) else { continue; };
            if log.id == *id { scores.seed(log); }
        }
        scores
    }

    fn seed(&mut self, log: CombatLog) {
        for actor in log.actors.values().filter(|actor| actor.local) {
            if let Some(server) = actor.server_id {
                let newer = self.get(server, &actor.name).unwrap_or_default();
                self.remember(server, &actor.name,
                    newer.gear_score.or(actor.gear_score),
                    newer.combat_power.or(actor.combat_power));
            }
        }
    }

    pub(super) fn remember(&mut self, server: u16, name: &str, gear_score: Option<u32>, combat_power: Option<u64>) {
        let gear_score = gear_score.filter(|score| (1..=1_000_000).contains(score));
        let combat_power = combat_power.filter(|power| *power > 0);
        if !(1000..=3000).contains(&server) || name.is_empty() || (gear_score.is_none() && combat_power.is_none()) {
            return;
        }
        let key = (server, name.to_owned());
        if self.0.len() < 128 || self.0.contains_key(&key) {
            let entry = self.0.entry(key).or_default();
            entry.gear_score = gear_score.or(entry.gear_score);
            entry.combat_power = combat_power.or(entry.combat_power);
        }
    }

    pub(super) fn get(&self, server: u16, name: &str) -> Option<Profile> {
        self.0.get(&(server, name.to_owned())).copied()
    }
}
