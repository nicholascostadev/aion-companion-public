//! Bounded structural readers for combat metadata; protocol facts from the MIT reference.
use super::entities::Entities;
use super::{healing_family, non_damage, player_skill, u32le, varint};
use crate::combat::CombatEvent;

fn event(kind: &str, source: u32, target: u32, skill: u32) -> CombatEvent {
    CombatEvent {
        source,
        target,
        skill,
        ..CombatEvent::new(kind)
    }
}
fn u64le(frame: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(frame.get(at..at + 8)?.try_into().ok()?))
}
fn f32le(frame: &[u8], at: usize) -> Option<f64> {
    let n = f32::from_le_bytes(frame.get(at..at + 4)?.try_into().ok()?) as f64;
    (n.is_finite() && n.abs() < 10_000_000.0).then_some(n)
}
fn var64(frame: &[u8], p: &mut usize) -> Option<u64> {
    let mut out = 0;
    for shift in (0..70).step_by(7) {
        let b = *frame.get(*p)?;
        *p += 1;
        if shift == 63 && b > 1 {
            return None;
        }
        out |= u64::from(b & 127) << shift;
        if b & 128 == 0 {
            return Some(out);
        }
    }
    None
}
fn npc_vitals(frame: &[u8]) -> Option<(u32, u64, u64)> {
    let mut p = 2;
    varint(frame, &mut p).ok()?;
    p += 2;
    let desc = *frame.get(p)?;
    p += 1;
    if desc & !31 != 0 {
        return None;
    }
    if desc & 1 != 0 {
        let n = usize::from(*frame.get(p)?);
        p += 1;
        frame.get(p..p + n)?;
        p += n;
    }
    let npc = u32le(frame, &mut p).ok()?;
    for (bit, size) in [(2, 1), (4, 1), (8, 5), (16, 1)] {
        if desc & bit != 0 {
            frame.get(p..p + size)?;
            p += size;
        }
    }
    let flags = u16::from_le_bytes(frame.get(p..p + 2)?.try_into().ok()?);
    p += 2;
    frame.get(p..p + 18)?;
    p += 18;
    for (bit, size) in [(1, 12), (2, 4), (4, 2), (8, 12), (16, 12), (32, 4)] {
        if flags & bit != 0 {
            frame.get(p..p + size)?;
            p += size;
        }
    }
    frame.get(p)?;
    p += 1;
    let current = var64(frame, &mut p)?;
    let maximum = var64(frame, &mut p)?;
    frame.get(p..p + 52)?;
    (maximum > 0 && current <= maximum && maximum <= 10_000_000_000_000)
        .then_some((npc, current, maximum))
}

pub(super) fn read(frame: &[u8], entities: &Entities) -> Vec<CombatEvent> {
    read_inner(frame, entities).unwrap_or_default()
}
fn read_inner(frame: &[u8], entities: &Entities) -> Option<Vec<CombatEvent>> {
    let opcode = u16::from_be_bytes(frame.get(..2)?.try_into().ok()?);
    let mut p = 2;
    let mut out = Vec::new();
    match opcode {
        0x0191 => return super::field_bosses::read(frame),
        0x0438 => {
            let target = varint(frame, &mut p).ok()?;
            let flags = *frame.get(p)?;
            p += 2;
            let actor = varint(frame, &mut p).ok()?;
            let skill = u32le(frame, &mut p).ok()?;
            let source = entities.owner(actor).unwrap_or(actor);
            if actor == 0 || target == 0 || non_damage(skill) {
                return Some(out);
            }
            if flags & 4 == 0 {
                return Some(out);
            }
            let critical = *frame.get(p + 1)? == 3;
            let marker = frame
                .get(p + 2..)?
                .windows(4)
                .position(|w| (1..=9).contains(&w[0]) && w[1..] == [0, 0, 0])?
                + p
                + 2;
            let count = u32::from(frame[marker]);
            let mut q = marker + 4;
            varint(frame, &mut q).ok()?;
            let amount = u64::from(varint(frame, &mut q).ok()?);
            if amount == 0 || amount > 100_000_000 {
                return Some(out);
            }
            let player_source = ((player_skill(skill) || entities.known_player(source)) && !entities.monster(source))
                || entities.owner(actor).is_some();
            let heal = healing_family(skill) && !entities.monster(target);
            if heal && (!player_source || entities.owner(target).is_some()) {
                return Some(out);
            }
            if !player_source && !entities.known_player(target) {
                return Some(out);
            }
            if player_source && !heal && source == target {
                return Some(out);
            }
            let mut e = event(if heal { "heal" } else { "damage" }, source, target, skill);
            e.amount = amount;
            e.hit_count = count;
            e.critical = (!heal).then_some(critical);
            let kind = flags & 15;
            if !heal && (4..=7).contains(&kind) {
                let bits = if kind == 4 { 0 } else { *frame.get(p + 2)? };
                let direction = if kind == 4 { 0 } else { *frame.get(p + 4)? };
                e.back = Some(direction == 1);
                e.front = Some(direction == 2);
                e.parry = Some(bits & 2 != 0);
                e.perfect = Some(bits & 4 != 0);
                e.double = Some(bits & 8 != 0);
            }
            out.push(e);
        }
        0x0538 => {
            let target = varint(frame, &mut p).ok()?;
            let flags = *frame.get(p)?;
            p += 1;
            if flags & 8 == 0 {
                return Some(out);
            }
            let actor = varint(frame, &mut p).ok()?;
            varint(frame, &mut p).ok()?;
            let effect = u32le(frame, &mut p).ok()?;
            let amount = if flags & 2 != 0 {
                u64::from(varint(frame, &mut p).ok()?)
            } else {
                0
            };
            let healed = if flags & 1 != 0 {
                u64::from(varint(frame, &mut p).ok()?)
            } else {
                0
            };
            let skill = u32le(frame, &mut p).ok()?;
            if p != frame.len() {
                return None;
            }
            let source = entities.owner(actor).unwrap_or(actor);
            let heal = healing_family(skill) || healed > 0;
            if effect < 1_000_000_000
                || non_damage(skill)
                || (!player_skill(skill)
                    && entities.owner(actor).is_none()
                    && !entities.known_player(source)
                    && !entities.known_player(target))
            {
                return Some(out);
            }
            let value = if heal { healed } else { amount };
            if value == 0 || value > 100_000_000 || entities.owner(target).is_some() {
                return Some(out);
            }
            if !heal
                && (!entities.monster(source) || entities.known_player(target))
                && source != target
            {
                let mut e = event("damage", source, target, skill);
                e.amount = value;
                e.tick = true;
                e.hit_count = 1;
                out.push(e);
            } else if heal {
                let mut e = event("heal", source, target, skill);
                e.amount = value;
                e.tick = true;
                e.hit_count = 1;
                out.push(e);
            }
        }
        0x0238 | 0x0938 => {
            let source = varint(frame, &mut p).ok()?;
            p += 1;
            let skill = u32le(frame, &mut p).ok()?;
            let aim = *frame.get(p + 1)?;
            p += 2;
            let target = varint(frame, &mut p).ok()?;
            f32le(frame, p)?;
            p += 4;
            let mut e = event("cast", source, target, skill);
            if aim & 2 != 0 {
                e.x = f32le(frame, p);
                e.y = f32le(frame, p + 4);
                p += 12;
            }
            if opcode == 0x0938 {
                let ms = varint(frame, &mut p).ok()?;
                if !(50..=120000).contains(&ms) {
                    return None;
                }
                e.kind = "windup".into();
                e.duration_ms = Some(u64::from(ms));
            }
            if source == 0 || source > 10_000_000 || skill == 0 || skill > 300_000_000 {
                return None;
            }
            out.push(e);
        }
        0x2a38 | 0x2b38 => {
            let target = varint(frame, &mut p).ok()?;
            if opcode == 0x2a38 {
                if *frame.get(p)? != 1 {
                    return None;
                }
                p += 1;
            }
            p += 1;
            let instance = varint(frame, &mut p).ok()?;
            let effect = u32le(frame, &mut p).ok()?;
            let duration = u32le(frame, &mut p).ok()?;
            let stays = u32le(frame, &mut p).ok()?;
            p += 8;
            let source = varint(frame, &mut p).ok()?;
            if source == 0
                || target == 0
                || source > 10_000_000
                || target > 10_000_000
                || !(10..=2_999_999_999).contains(&effect)
            {
                return None;
            }
            let mut e = event("buff", source, target, effect / 10);
            e.instance = instance;
            e.duration_ms = (stays == 0).then_some(u64::from(duration.min(86_400_000)));
            out.push(e);
        }
        0x2c38 => {
            let target = varint(frame, &mut p).ok()?;
            let count = *frame.get(p)?;
            p += 1;
            if !(1..=64).contains(&count) {
                return None;
            }
            for _ in 0..count {
                let kind = *frame.get(p)?;
                p += 1;
                let instance = varint(frame, &mut p).ok()?;
                frame.get(p)?;
                p += 1;
                if kind == 7 {
                    varint(frame, &mut p).ok()?;
                    p += 8;
                } else if kind != 0 {
                    return None;
                }
                let mut e = event("buff_end", 0, target, 0);
                e.instance = instance;
                out.push(e);
            }
            if p != frame.len() {
                return None;
            }
        }
        0x008d => {
            let target = varint(frame, &mut p).ok()?;
            let format = *frame.get(p)?;
            p += 1;
            if format & !3 != 0 {
                return None;
            }
            if format & 1 != 0 {
                let count = usize::from(*frame.get(p)?);
                p += 1 + count * 5;
            }
            let mut e = event("hp", 0, target, 0);
            if format & 2 != 0 {
                let count = *frame.get(p)?;
                p += 1;
                for _ in 0..count {
                    let kind = *frame.get(p)?;
                    let value = u64le(frame, p + 1)?;
                    p += 9;
                    if value > i64::MAX as u64 {
                        return None;
                    }
                    if kind == 0 {
                        e.current_hp = Some(value);
                    }
                    if kind == 7 {
                        e.max_hp = (value > 0).then_some(value);
                    }
                }
            }
            if p != frame.len() {
                return None;
            }
            if e.current_hp.is_some() || e.max_hp.is_some() {
                out.push(e);
            }
        }
        0x2136 => {
            let zone = u32le(frame, &mut 6).ok()?;
            if zone > 0 && zone < 100_000_000 {
                let mut e = CombatEvent::new("zone");
                e.zone_id = Some(zone);
                out.push(e);
            }
        }
        0x218d => {
            let target = varint(frame, &mut p).ok()?;
            if frame.get(p..) == Some(&[0, 0]) {
                out.push(event("reset", 0, target, 0));
            }
        }
        0x4136 => {
            let target = varint(frame, &mut p).ok()?;
            let flags = frame.get(p..p + 3)?;
            if flags[2] == 1 {
                p += 1 + usize::from(*frame.get(p + 3)?);
            }
            p += 3;
            let npc = u32le(frame, &mut p).ok()?;
            let mut e = event("spawn", 0, target, npc);
            e.current_hp = None;
            out.push(e);
            if let Some((_, current, max)) = npc_vitals(frame) {
                let mut hp = event("hp", 0, target, 0);
                hp.current_hp = Some(current);
                hp.max_hp = Some(max);
                out.push(hp);
            }
        }
        0x0061 if frame.len() >= 23 => {
            let id = u32le(frame, &mut p).ok()?;
            let state = *frame.get(p)?;
            if state <= 16 && id > 0 {
                let mut e = event("dungeon_state", 0, 0, id);
                e.amount = u64::from(state);
                out.push(e);
            }
        }
        0x4738 => {
            let count = varint(frame, &mut p).ok()?;
            if count > 256 {
                return None;
            }
            for _ in 0..count {
                let skill = u32le(frame, &mut p).ok()?;
                let raw = varint(frame, &mut p).ok()?;
                let mut e = event("cooldown", entities.local.unwrap_or(0), 0, skill);
                e.amount = u64::from(raw);
                out.push(e);
            }
            if p != frame.len() {
                return None;
            }
        }
        0x468d => {
            // Character-death notification. The first varint is the victim.
            // Parse the complete structural record before publishing anything;
            // other fields remain uninterpreted until their meanings are verified.
            let target = varint(frame, &mut p).ok()?;
            u32le(frame, &mut p).ok()?;
            varint(frame, &mut p).ok()?;
            frame.get(p..p + 2)?;
            p += 2;
            for _ in 0..2 {
                let n = usize::from(*frame.get(p)?);
                p += 1;
                frame.get(p..p + n)?;
                p += n;
            }
            frame.get(p..p + 2)?;
            p += 2;
            varint(frame, &mut p).ok()?;
            u32le(frame, &mut p).ok()?;
            frame.get(p..p + 2)?;
            p += 2;
            if p != frame.len() || target == 0 || target > 10_000_000 {
                return None;
            }
            out.push(event("death", 0, target, 0));
        }
        0x4236 => {
            let target = varint(frame, &mut p).ok()?;
            varint(frame, &mut p).ok()?;
            let source = varint(frame, &mut p).ok()?;
            if p != frame.len() || target == 0 || target > 10_000_000 {
                return None;
            }
            out.push(event("despawn", source, target, 0));
        }
        0x0060 | 0x0160 => {
            let count = if opcode == 0x0060 {
                varint(frame, &mut p).ok()?
            } else {
                1
            };
            if count > 256 {
                return None;
            }
            for _ in 0..count {
                let flags = *frame.get(p)?;
                p += 1;
                let id = varint(frame, &mut p).ok()?;
                let state = *frame.get(p)?;
                p += 1;
                let clock = u64le(frame, p)?;
                p += 8;
                if flags & 1 != 0 {
                    u64le(frame, p)?;
                    p += 8;
                }
                if flags & 2 != 0 {
                    u64le(frame, p)?;
                    p += 8;
                }
                let mut e = event(
                    if opcode == 0x0160 {
                        "field_event"
                    } else {
                        "field_event_snapshot"
                    },
                    0,
                    0,
                    id,
                );
                e.instance = u32::from(state);
                e.amount = clock;
                out.push(e);
            }
            if p != frame.len() {
                return None;
            }
        }
        _ if frame.get(1) == Some(&0x37) => {
            let offset = match frame[0] {
                0x1a | 0x1b | 0x1c | 0x1e | 0x20 | 0x28 | 0x29 | 0x2a => 2,
                0x1f | 0x2f => 1,
                _ => return Some(out),
            };
            let target = varint(frame, &mut p).ok()?;
            let x = f32le(frame, p + offset)?;
            let y = f32le(frame, p + offset + 4)?;
            if x.abs() > 1. && y.abs() > 1. && x.abs() < 200000. && y.abs() < 200000. {
                let mut e = event("position", 0, target, 0);
                e.x = Some(x);
                e.y = Some(y);
                out.push(e);
            }
        }
        _ => {}
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hp_and_buff_end_are_transactional() {
        let e = Entities::default();
        let mut hp = vec![0, 0x8d, 3, 2, 1, 0];
        hp.extend_from_slice(&123u64.to_le_bytes());
        assert_eq!(read(&hp, &e)[0].current_hp, Some(123));
        hp.pop();
        assert!(read(&hp, &e).is_empty());
        assert!(read(&[0x2c, 0x38, 3, 2, 0, 1, 0], &e).is_empty());
    }
    #[test]
    fn field_changes_and_deaths_require_complete_structural_records() {
        let e = Entities::default();
        let mut field = vec![1, 0x60, 0, 9, 2];
        field.extend_from_slice(&123u64.to_le_bytes());
        assert_eq!(read(&field, &e)[0].kind, "field_event");
        field.pop();
        assert!(read(&field, &e).is_empty());
        let mut death = vec![0x46, 0x8d, 7];
        death.extend_from_slice(&0u32.to_le_bytes());
        death.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);
        death.extend_from_slice(&0u32.to_le_bytes());
        death.extend_from_slice(&[0, 0]);
        let observation = read(&death, &e);
        assert_eq!(observation.len(), 1);
        assert_eq!(observation[0].target, 7);
        assert_eq!(observation[0].kind, "death");
        death.pop();
        assert!(read(&death, &e).is_empty());
    }
    #[test]
    fn cooldown_raw_units_are_never_silently_called_milliseconds() {
        let e = Entities::default();
        let mut frame = vec![0x47, 0x38, 1];
        frame.extend_from_slice(&11_000_100u32.to_le_bytes());
        frame.push(5);
        let result = read(&frame, &e);
        assert_eq!(result[0].amount, 5);
        assert_eq!(result[0].duration_ms, None);
    }
}
