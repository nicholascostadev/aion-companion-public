//! Last recorded character metadata, keyed by verified server and exact name.
//! Roster values for every observed player, yours included, persist through native
//! recordings across restarts without a second profile format.
use companion_core::combat::CombatLog;
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

/// Bounds memory while allowing newly observed characters to replace old entries.
const CAPACITY: usize = 1024;

#[derive(Clone, Default)]
pub(super) struct Profiles(BTreeMap<(u16, String), Profile>, u64);

#[derive(Clone, Copy, Default)]
pub(super) struct Profile {
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
    observed: u64,
}

impl Profiles {
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
        // Recovered entries precede any observations from this session.
        for profile in scores.0.values_mut() { profile.observed = 0; }
        scores.1 = 0;
        scores
    }

    fn seed(&mut self, log: CombatLog) {
        // Prefer your character within each recording when recovering a bounded store.
        let mut actors: Vec<_> = log.actors.values().collect();
        actors.sort_by_key(|actor| !actor.local);
        for actor in actors {
            if let Some(server) = actor.server_id {
                // Logs are newest first; older logs must not evict recovered values.
                if self.0.len() >= CAPACITY && self.get(server, &actor.name).is_none() {
                    continue;
                }
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
        // Only observed character names identify a profile; "Player #id" placeholders never do.
        let named = name.chars().count() >= 2 && name.chars().all(char::is_alphanumeric);
        if !(1000..=3000).contains(&server) || !named || (gear_score.is_none() && combat_power.is_none()) {
            return;
        }
        let key = (server, name.to_owned());
        if self.0.len() >= CAPACITY && !self.0.contains_key(&key) {
            if let Some(oldest) = self.0.iter().min_by_key(|(_, profile)| profile.observed).map(|(key, _)| key.clone()) {
                self.0.remove(&oldest);
            }
        }
        self.1 += 1;
        let entry = self.0.entry(key).or_default();
        entry.gear_score = gear_score.or(entry.gear_score);
        entry.combat_power = combat_power.or(entry.combat_power);
        entry.observed = self.1;
    }

    pub(super) fn get(&self, server: u16, name: &str) -> Option<Profile> {
        self.0.get(&(server, name.to_owned())).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_cache_accepts_new_characters_and_keeps_recent_observations() {
        let mut profiles = Profiles::default();
        for i in 0..CAPACITY {
            profiles.remember(1304, &format!("Player{i}"), None, Some(100));
        }
        profiles.remember(1304, "Player0", None, Some(200));
        profiles.remember(1304, "NewAlt", None, Some(300));
        assert_eq!(profiles.get(1304, "NewAlt").unwrap().combat_power, Some(300));
        assert_eq!(profiles.get(1304, "Player0").unwrap().combat_power, Some(200));
        assert!(profiles.get(1304, "Player1").is_none());
        assert_eq!(profiles.0.len(), CAPACITY);

        let mut older = CombatLog::default();
        older.actors.insert(1, companion_core::combat::ActorInfo {
            id: 1, name: "OldCharacter".into(), server_id: Some(1304), combat_power: Some(50), ..Default::default()
        });
        profiles.seed(older);
        assert!(profiles.get(1304, "OldCharacter").is_none());
        assert_eq!(profiles.get(1304, "NewAlt").unwrap().combat_power, Some(300));
    }
}
