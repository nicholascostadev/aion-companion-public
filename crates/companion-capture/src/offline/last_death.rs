//! The local character's latest death and the last hit it took before it, for the meter's
//! death shortcut. The game's death record names no killer, so this only ever reports the
//! last recorded hit, never a proven kill. Kept apart from the fight log: a fight ending,
//! a reset or a hidden fight never drops it.
use companion_core::combat::CombatEvent;
use companion_core::wire::{class_name, entities::Entities, player_skill};
use serde::Serialize;

/// A hit counts only when it landed this close before the death.
const LAST_HIT_WINDOW_MS: u64 = 10_000;

#[derive(Clone, Copy)]
struct Hit {
    at: u64,
    source: u32,
    skill: u32,
}

/// Who landed the last hit: a character observed by name, with the server observed with
/// that name on its entity (possibly only after the death), or a monster or unidentified
/// source without either.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Attacker {
    pub name: Option<String>,
    pub server_id: Option<u16>,
    pub class: Option<&'static str>,
    pub player: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LastDeath {
    /// Wall-clock time of the death, epoch milliseconds.
    pub at_ms: u64,
    /// The last hit within ten seconds before it; None when none was recorded.
    pub last_hit: Option<Attacker>,
}

#[derive(Clone, Default)]
pub struct DeathWatch {
    hit: Option<Hit>,
    dead: bool,
    latest: Option<LastDeath>,
    /// The entity of a last hit named without its server, while that server may still
    /// arrive: nearby players are often named well before the record with their server.
    unserved: Option<u32>,
}

impl DeathWatch {
    pub fn latest(&self) -> Option<&LastDeath> {
        self.latest.as_ref()
    }

    /// Completes the latest last hit with the server later observed with the same name on
    /// the same entity. A server is never replaced, and once the entity bears another name
    /// it lends the death nothing.
    pub fn learn(&mut self, entities: &Entities) {
        let Some(id) = self.unserved else { return };
        let Some(hit) = self.latest.as_mut().and_then(|death| death.last_hit.as_mut()) else {
            self.unserved = None;
            return;
        };
        if entities.monster(id) || entities.name(id) != hit.name.as_deref() {
            self.unserved = None;
        } else if let Some(server) = entities.server_id(id) {
            hit.server_id = Some(server);
            self.unserved = None;
        }
    }

    /// Follows one event about the local character; every other entity is ignored.
    pub fn observe(&mut self, e: &CombatEvent, entities: &Entities, now: u64, epoch: u64) {
        let Some(local) = entities.local.filter(|&id| id == e.target) else {
            return;
        };
        match e.kind.as_str() {
            "damage" if e.amount > 0 && e.source != 0 && e.source != local => {
                self.hit = Some(Hit { at: now, source: e.source, skill: e.skill });
            }
            "hp" if e.current_hp.is_some_and(|hp| hp > 0) => self.dead = false,
            "revive" => self.dead = false,
            "hp" | "death" if !self.dead && (e.kind == "death" || e.current_hp == Some(0)) => {
                self.dead = true;
                let hit = self
                    .hit
                    .take()
                    .filter(|hit| now.saturating_sub(hit.at) <= LAST_HIT_WINDOW_MS);
                let last_hit = hit.map(|hit| attacker(hit, entities));
                self.unserved = last_hit
                    .as_ref()
                    .filter(|(attacker, _)| attacker.player && attacker.server_id.is_none())
                    .map(|&(_, id)| id);
                self.latest = Some(LastDeath {
                    at_ms: epoch.saturating_add(now),
                    last_hit: last_hit.map(|(attacker, _)| attacker),
                });
            }
            _ => {}
        }
    }
}

/// The attacker and the entity that speaks for it.
fn attacker(hit: Hit, entities: &Entities) -> (Attacker, u32) {
    // A confirmed summon or spell entity speaks for its owner.
    let id = entities.owner(hit.source).unwrap_or(hit.source);
    // Names are registered only from player identity records, never from monster spawns,
    // and a server id is kept only with the name it arrived with.
    let name = entities.name(id).filter(|_| !entities.monster(id));
    let player = name.is_some();
    let attacker = Attacker {
        name: name.map(str::to_owned),
        server_id: if player { entities.server_id(id) } else { None },
        class: (player && player_skill(hit.skill)).then(|| class_name(hit.skill)),
        player,
    };
    (attacker, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCAL: u32 = 1;
    /// A player identity record binds an entity to a character name and its server.
    fn identify(entities: &mut Entities, id: u8, server: u16, name: &str) {
        let mut frame = vec![0x04, 0x8d, 0, 0, 0, 0, 0, id];
        frame.extend_from_slice(&server.to_le_bytes());
        frame.push(name.len() as u8);
        frame.extend_from_slice(name.as_bytes());
        entities.observe(&frame).unwrap();
    }
    fn hit(source: u32, skill: u32) -> CombatEvent {
        CombatEvent { source, target: LOCAL, skill, amount: 900, ..CombatEvent::new("damage") }
    }
    fn hp(current: u64) -> CombatEvent {
        CombatEvent { target: LOCAL, current_hp: Some(current), ..CombatEvent::new("hp") }
    }
    fn died() -> CombatEvent {
        CombatEvent { target: LOCAL, ..CombatEvent::new("death") }
    }
    fn world() -> Entities {
        let mut entities = Entities::default();
        entities.local = Some(LOCAL);
        identify(&mut entities, 7, 1304, "Rival");
        entities
    }

    #[test]
    fn a_death_reports_the_last_player_hit_with_its_observed_server() {
        let entities = world();
        let mut watch = DeathWatch::default();
        watch.observe(&hit(99, 0), &entities, 1_000, 50_000);
        watch.observe(&hit(7, 15_010_000), &entities, 2_000, 50_000);
        watch.observe(&hp(0), &entities, 2_500, 50_000);
        assert_eq!(
            watch.latest(),
            Some(&LastDeath {
                at_ms: 52_500,
                last_hit: Some(Attacker {
                    name: Some("Rival".into()),
                    server_id: Some(1304),
                    class: Some("Sorcerer"),
                    player: true,
                }),
            })
        );
        // The game's own death record for the same death does not replace it.
        watch.observe(&died(), &entities, 2_600, 50_000);
        assert_eq!(watch.latest().unwrap().at_ms, 52_500);
    }

    #[test]
    fn unnamed_sources_stale_hits_and_other_targets_never_name_a_player() {
        let entities = world();
        let mut watch = DeathWatch::default();
        // A monster or unidentified entity has neither name nor server.
        watch.observe(&hit(99, 0), &entities, 1_000, 0);
        watch.observe(&died(), &entities, 1_100, 0);
        let last = watch.latest().unwrap().last_hit.clone().unwrap();
        assert_eq!((last.player, last.name, last.server_id), (false, None, None));
        // After a revive, a hit older than the window is not the last hit of the next death.
        watch.observe(&hp(500), &entities, 2_000, 0);
        watch.observe(&hit(7, 15_010_000), &entities, 3_000, 0);
        watch.observe(&died(), &entities, 3_000 + LAST_HIT_WINDOW_MS + 1, 0);
        assert_eq!(watch.latest().unwrap().last_hit, None);
        // Someone else's death and hits leave the local record alone.
        let before = watch.latest().cloned();
        watch.observe(&CombatEvent { target: 7, ..CombatEvent::new("death") }, &entities, 20_000, 0);
        assert_eq!(watch.latest().cloned(), before);
    }

    #[test]
    fn a_server_observed_after_the_death_counts_only_for_the_same_name() {
        let mut entities = world();
        let mut watch = DeathWatch::default();
        // Named without a server, as nearby players often are when they hit you.
        identify(&mut entities, 8, 0, "Nearby");
        watch.observe(&hit(8, 0), &entities, 1_000, 0);
        watch.observe(&died(), &entities, 1_000, 0);
        let server = |watch: &DeathWatch| watch.latest().unwrap().last_hit.clone().unwrap().server_id;
        watch.learn(&entities);
        assert_eq!(server(&watch), None);
        // The entity is named again first as another character, then that one's server
        // arrives: neither belongs to the character who landed the last hit.
        identify(&mut entities, 8, 0, "Stranger");
        watch.learn(&entities);
        identify(&mut entities, 8, 2405, "Stranger");
        watch.learn(&entities);
        assert_eq!(server(&watch), None);
        // Nor does that character's server reach the death once the original name returns.
        identify(&mut entities, 8, 1304, "Nearby");
        watch.learn(&entities);
        assert_eq!(server(&watch), None);
    }

    #[test]
    fn a_renamed_entity_never_keeps_the_previous_characters_server() {
        let mut entities = world();
        let mut watch = DeathWatch::default();
        // A new name arriving without a valid server drops the server seen with the old one.
        identify(&mut entities, 7, 0, "Imposter");
        watch.observe(&hit(7, 0), &entities, 1_000, 0);
        watch.observe(&died(), &entities, 1_000, 0);
        let last = watch.latest().unwrap().last_hit.clone().unwrap();
        // A non-class skill never invents a class either.
        assert_eq!(
            (last.name.as_deref(), last.server_id, last.class),
            (Some("Imposter"), None, None)
        );
    }
}
