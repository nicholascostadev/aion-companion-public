//! Link temporary spell NPCs only through observed, unambiguous cast evidence.
use super::{entities::Entities, u32le, varint};
use std::collections::{HashMap, VecDeque};

#[derive(Default)]
pub(super) struct Links {
    casts: VecDeque<Cast>,
    spawns: HashMap<u32, u64>,
}

struct Cast {
    actor: u32,
    variant: u32,
    at_ms: u64,
}

fn spell(skill: u32) -> bool {
    matches!(skill / 10_000, 1520 | 1528 | 1539)
}

impl Links {
    pub(super) fn observe(&mut self, frame: &[u8], at_ms: u64, entities: &mut Entities) {
        self.casts.retain(|cast| at_ms >= cast.at_ms && at_ms - cast.at_ms <= 5_000);
        self.spawns.retain(|_, time| at_ms >= *time && at_ms - *time <= 5_000);
        let _ = self.read(frame, at_ms, entities);
    }

    fn read(&mut self, frame: &[u8], at_ms: u64, entities: &mut Entities) -> Option<()> {
        let opcode = u16::from_be_bytes(frame.get(..2)?.try_into().ok()?);
        let mut p = 2;
        if opcode == 0x4136 {
            let id = varint(frame, &mut p).ok()?;
            self.spawns.remove(&id);
            if entities.spell_entity(id) && self.spawns.len() < 1024 {
                self.spawns.insert(id, at_ms);
            }
            return Some(());
        }
        let (actor, target, skill, start) = match opcode {
            0x0438 => {
                let target = varint(frame, &mut p).ok()?;
                let flags = *frame.get(p)?;
                p += 2;
                let actor = varint(frame, &mut p).ok()?;
                let skill = u32le(frame, &mut p).ok()?;
                frame.get(p..p + 8)?;
                (actor, target, skill, flags & 4 == 0)
            }
            0x0238 => {
                let actor = varint(frame, &mut p).ok()?;
                p += 1;
                let skill = u32le(frame, &mut p).ok()?;
                p += 2;
                let target = varint(frame, &mut p).ok()?;
                // A truncated cast header provides no ownership evidence.
                frame.get(p..p + 4)?;
                (actor, target, skill, true)
            }
            0x0538 => {
                let target = varint(frame, &mut p).ok()?;
                if *frame.get(p)? != 0x0a { return None; }
                p += 1;
                let actor = varint(frame, &mut p).ok()?;
                varint(frame, &mut p).ok()?;
                u32le(frame, &mut p).ok()?;
                varint(frame, &mut p).ok()?;
                let skill = u32le(frame, &mut p).ok()?;
                if p != frame.len() { return None; }
                (actor, target, skill, false)
            }
            _ => return None,
        };
        if !spell(skill) { return None; }
        if start && entities.known_player(actor) && !entities.spawned(actor) {
            if self.casts.len() == 1024 { self.casts.pop_front(); }
            self.casts.push_back(Cast { actor, variant: skill / 10, at_ms });
            return Some(());
        }
        if !entities.spell_entity(actor) || entities.owner(actor).is_some() { return None; }
        // Observed spell feedback names the caster as the target. Restrict this
        // to the release record, never infer ownership from an ordinary hit.
        if start && skill == 15_200_047 && entities.known_player(target) && !entities.spawned(target) {
            entities.bind_spell_owner(actor, target);
            return Some(());
        }
        let spawned_at = *self.spawns.get(&actor)?;
        // The owner cast precedes the spawn, not the first damage tick. Keeping
        // this window short avoids attributing an old cast to another player.
        let mut owners = self.casts.iter().filter(|cast| cast.variant == skill / 10
            && spawned_at >= cast.at_ms && spawned_at - cast.at_ms <= 1_000)
            .map(|cast| cast.actor);
        let owner = owners.next()?;
        if owners.all(|candidate| candidate == owner) {
            entities.bind_spell_owner(actor, owner);
        }
        Some(())
    }
}
