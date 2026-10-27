use crate::{
    wire::{class_name, Hit},
    Event, Recording, MAX_EVENTS, SCHEMA_VERSION,
};
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};

#[derive(Default, Serialize)]
pub struct LivePlayer {
    pub entity: u32,
    pub label: String,
    pub class: String,
    pub damage: u64,
    pub dps: f64,
    pub current_dps: f64,
    pub share: f64,
    pub direct_hits: u64,
    pub critical_hits: u64,
    pub ticks: u64,
    pub skills: BTreeMap<String, u64>,
}

#[derive(Default)]
pub struct Meter {
    first_ms: Option<u64>,
    last_ms: u64,
    players: BTreeMap<u32, LivePlayer>,
    events: Vec<Event>,
    recent: VecDeque<(u64, u32, u64)>,
    ended_ms: Option<u64>,
}

impl Meter {
    pub fn add(&mut self, now_ms: u64, hit: Hit) -> Result<(), String> {
        if self.ended_ms.is_some() {
            return Err("Encounter has ended.".into());
        }
        // Reserve one event for capture diagnostics added by the host on export.
        if self.events.len() >= MAX_EVENTS - 1 {
            return Err("Live event limit reached. Stop and save this session.".into());
        }
        let first = *self.first_ms.get_or_insert(now_ms);
        let time = now_ms.saturating_sub(first).max(self.last_ms);
        if time > 86_400_000 {
            return Err("Live session reached 24 hours. Stop and save this session.".into());
        }
        let skill = format!("Skill #{}", hit.skill);
        let player = self.players.entry(hit.actor).or_insert_with(|| LivePlayer {
            entity: hit.actor,
            label: format!("{} #{}", class_name(hit.skill), hit.actor),
            class: class_name(hit.skill).into(),
            ..LivePlayer::default()
        });
        let damage = player
            .damage
            .checked_add(hit.amount)
            .ok_or("Damage overflow")?;
        let skill_total = player.skills.entry(skill.clone()).or_default();
        *skill_total = skill_total
            .checked_add(hit.amount)
            .ok_or("Skill damage overflow")?;
        player.damage = damage;
        if hit.tick {
            player.ticks += 1;
        } else {
            player.direct_hits += 1;
            player.critical_hits += u64::from(hit.critical);
        }
        self.events.push(Event::Damage {
            at_ms: time,
            source: format!("Entity #{}", hit.actor),
            target: format!("Entity #{}", hit.target),
            skill,
            amount: hit.amount,
        });
        self.recent.push_back((time, hit.actor, hit.amount));
        self.last_ms = time;
        Ok(())
    }

    pub fn duration(&self, now_ms: u64) -> u64 {
        let now_ms = self.ended_ms.unwrap_or(now_ms);
        self.first_ms.map_or(0, |first| {
            now_ms
                .saturating_sub(first)
                .max(self.last_ms)
                .clamp(1, 86_400_000)
        })
    }

    pub fn players(&mut self, now_ms: u64) -> Vec<&LivePlayer> {
        let time = self.duration(now_ms);
        let window_time = self
            .first_ms
            .map_or(0, |first| now_ms.saturating_sub(first));
        while self
            .recent
            .front()
            .is_some_and(|row| row.0.saturating_add(5000) <= window_time)
        {
            self.recent.pop_front();
        }
        let mut recent: BTreeMap<u32, u64> = BTreeMap::new();
        for (_, id, amount) in &self.recent {
            *recent.entry(*id).or_default() += amount;
        }
        let total = self.players.values().map(|p| p.damage as f64).sum::<f64>();
        for (id, p) in &mut self.players {
            p.dps = p.damage as f64 * 1000.0 / time.max(1) as f64;
            p.current_dps = recent.get(id).copied().unwrap_or(0) as f64 / 5.0;
            p.share = if total > 0.0 {
                p.damage as f64 / total
            } else {
                0.0
            };
        }
        let mut players: Vec<_> = self.players.values().collect();
        players.sort_by(|a, b| b.damage.cmp(&a.damage).then(a.entity.cmp(&b.entity)));
        players
    }

    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    pub fn first_ms(&self) -> Option<u64> {
        self.first_ms
    }
    pub fn ended(&self) -> bool {
        self.ended_ms.is_some()
    }
    pub fn end_if_idle(&mut self, now_ms: u64) {
        if let Some(first) = self.first_ms {
            let last = first.saturating_add(self.last_ms);
            if now_ms.saturating_sub(last) >= 10_000 {
                self.ended_ms = Some(last);
            }
        }
    }

    pub fn recording(&self, now_ms: u64) -> Result<Recording, String> {
        if self.events.is_empty() {
            return Err("No live damage has been collected yet.".into());
        }
        let recording = Recording {
            schema_version: SCHEMA_VERSION,
            source: "Independent AION 2 Global capture (experimental player-skill damage)".into(),
            duration_ms: self.duration(now_ms),
            events: self.events.clone(),
        };
        recording.validate()?;
        Ok(recording)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_rates_window_and_export_use_the_same_damage() {
        let mut meter = Meter::default();
        let hit = |amount, critical| Hit {
            actor: 1,
            target: 2,
            skill: 14_000_100,
            amount,
            critical,
            tick: false,
        };
        meter.add(1000, hit(1000, true)).unwrap();
        meter.add(2000, hit(2000, false)).unwrap();
        let players = meter.players(6000);
        assert_eq!(players[0].dps, 600.0);
        assert_eq!(players[0].current_dps, 400.0);
        assert_eq!(players[0].critical_hits, 1);
        assert_eq!(players[0].share, 1.0);
        let recording = meter.recording(6000).unwrap();
        assert_eq!(
            recording.snapshot(5000).unwrap().players["Entity #1"].damage,
            3000
        );
        assert_eq!(meter.players(8000)[0].current_dps, 0.0);
    }
    #[test]
    fn idle_time_is_explicit_session_time_and_reset_clears_totals() {
        let mut meter = Meter::default();
        assert!(meter.recording(1000).is_err());
        meter
            .add(
                5000,
                Hit {
                    actor: 1,
                    target: 2,
                    skill: 14_000_100,
                    amount: 1000,
                    critical: false,
                    tick: false,
                },
            )
            .unwrap();
        assert_eq!(meter.players(7000)[0].dps, 500.0);
        meter = Meter::default();
        assert_eq!(meter.event_count(), 0);
        assert!(meter.players(8000).is_empty());
    }
}
