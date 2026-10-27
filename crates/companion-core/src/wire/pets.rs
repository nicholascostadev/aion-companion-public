//! Bounded readers for pet collection and spatial game observations.
use super::{u32le, varint};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq)]
pub struct PetState {
    pub pet_id: u32,
    pub level: u8,
    pub progress: u32,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Observation {
    Collection {
        active: Option<u32>,
        states: Vec<PetState>,
    },
    Progress {
        pet_id: u32,
        gained: u32,
    },
    Level {
        pet_id: u32,
        level: u8,
    },
    Added {
        pet_id: u32,
        level: u8,
    },
    Spawn {
        entity: u32,
        npc: u32,
        x: Option<f64>,
        y: Option<f64>,
    },
    Remove {
        entity: u32,
    },
    Position {
        entity: u32,
        x: f64,
        y: f64,
    },
    Facing {
        entity: u32,
        degrees: f64,
    },
    Zone {
        id: u32,
        x: Option<f64>,
        y: Option<f64>,
    },
}
fn pet(id: u32) -> bool {
    (1000..=99_999).contains(&id)
}
fn coord(f: &[u8], at: usize) -> Option<f64> {
    let n = f32::from_le_bytes(f.get(at..at + 4)?.try_into().ok()?) as f64;
    (n.is_finite() && n.abs() < 1_000_000.).then_some(n)
}
pub(super) fn read(f: &[u8]) -> Vec<Observation> {
    read_inner(f).unwrap_or_default()
}
fn read_inner(f: &[u8]) -> Option<Vec<Observation>> {
    let opcode = u16::from_be_bytes(f.get(..2)?.try_into().ok()?);
    let mut p = 2;
    let mut out = Vec::new();
    match opcode {
        0x0090 => {
            let active = u32le(f, &mut p).ok()?;
            if active != 0 && !pet(active) {
                return None;
            }
            let n = varint(f, &mut p).ok()? as usize;
            if n > 2000 {
                return None;
            }
            let mut states = Vec::new();
            let mut ids = BTreeSet::new();
            for _ in 0..n {
                let id = u32le(f, &mut p).ok()?;
                if !pet(id) || u32le(f, &mut p).ok()? != id || !ids.insert(id) {
                    return None;
                }
                let level = u32le(f, &mut p).ok()?;
                if !(1..=3).contains(&level) {
                    return None;
                }
                states.push(PetState {
                    pet_id: id,
                    level: level as u8,
                    progress: 0,
                });
            }
            let m = varint(f, &mut p).ok()?;
            if m > 2000 {
                return None;
            }
            let mut seen = BTreeSet::new();
            for _ in 0..m {
                let id = u32le(f, &mut p).ok()?;
                let progress = u32le(f, &mut p).ok()?;
                if !pet(id) || progress > 1_000_000 || !seen.insert(id) {
                    return None;
                }
                if let Some(s) = states.iter_mut().find(|s| s.pet_id == id) {
                    s.progress = if s.level == 3 { 0 } else { progress };
                }
            }
            // Later species/insight records may follow these complete, validated lists.
            out.push(Observation::Collection {
                active: (active != 0).then_some(active),
                states,
            });
        }
        0x0d90 => {
            let n = usize::from(*f.get(p)?);
            p += 1;
            if n > 200 || f.len() != p + n * 8 {
                return None;
            }
            for _ in 0..n {
                let pet_id = u32le(f, &mut p).ok()?;
                let gained = u32le(f, &mut p).ok()?;
                if !pet(pet_id) || !(1..1000).contains(&gained) {
                    return None;
                }
                out.push(Observation::Progress { pet_id, gained });
            }
        }
        0x1490 | 0x0990 => {
            if opcode == 0x1490 && f.get(2..4) != Some(&[0, 0]) {
                return None;
            }
            p = 4;
            let pet_id = u32le(f, &mut p).ok()?;
            let level = u32le(f, &mut p).ok()?;
            if !pet(pet_id) || !(1..=3).contains(&level) {
                return None;
            }
            out.push(if opcode == 0x1490 {
                Observation::Level {
                    pet_id,
                    level: level as u8,
                }
            } else {
                Observation::Added {
                    pet_id,
                    level: level as u8,
                }
            });
        }
        0x4136 => {
            let entity = varint(f, &mut p).ok()?;
            f.get(p..p + 3)?;
            let descriptor = f[p + 2];
            if descriptor & !31 != 0 {
                return None;
            }
            p += 3;
            if descriptor & 1 != 0 {
                let len = usize::from(*f.get(p)?);
                p += 1;
                f.get(p..p + len)?;
                p += len;
            }
            let npc = u32le(f, &mut p).ok()?;
            if entity == 0 || entity > 10_000_000 || npc == 0 {
                return None;
            }
            // Extra descriptor fields move the spatial block. Keep the known NPC
            // without publishing speculative coordinates for those layouts.
            let x = (descriptor & !1 == 0).then(|| coord(f, p + 2)).flatten();
            let y = (descriptor & !1 == 0).then(|| coord(f, p + 6)).flatten();
            out.push(Observation::Spawn { entity, npc, x, y });
        }
        0x4236 => {
            let entity = varint(f, &mut p).ok()?;
            if f.get(p) == Some(&0) && matches!(f.get(p + 1), Some(3 | 7)) {
                out.push(Observation::Remove { entity });
            }
        }
        0x2136 => {
            p = 6;
            let id = u32le(f, &mut p).ok()?;
            if id == 0 || id >= 100_000_000 {
                return None;
            }
            out.push(Observation::Zone {
                id,
                x: coord(f, 18),
                y: coord(f, 22),
            });
        }
        0x0238 | 0x0938 => {
            let entity = varint(f, &mut p).ok()?;
            f.get(p)?;
            p += 1;
            let skill = u32le(f, &mut p).ok()?;
            let aim = *f.get(p + 1)?;
            p += 2;
            let target = varint(f, &mut p).ok()?;
            let angle = f32::from_le_bytes(f.get(p..p + 4)?.try_into().ok()?) as f64;
            p += 4;
            if entity == 0
                || entity > 10_000_000
                || !(1..=300_000_000).contains(&skill)
                || target > 10_000_000
                || !angle.is_finite()
                || angle.abs() > 720.0
            {
                return None;
            }
            if aim & 2 != 0 {
                // These are aim coordinates, not a measured player location.
                for offset in [0, 4, 8] {
                    coord(f, p + offset)?;
                }
                p += 12;
            }
            if opcode == 0x0938 && !(50..=120_000).contains(&varint(f, &mut p).ok()?) {
                return None;
            }
            out.push(Observation::Facing {
                entity,
                degrees: angle.rem_euclid(360.0),
            });
        }
        0x2a38 | 0x2b38 => {
            // Effect add/renew ends with the CASTER's location, even when its target
            // is somebody else. The pet state owner decides whether that caster is us.
            let target = varint(f, &mut p).ok()?;
            if opcode == 0x2a38 {
                if *f.get(p)? != 1 {
                    return None;
                }
                p += 1;
            }
            f.get(p)?; // effect type
            p += 1;
            varint(f, &mut p).ok()?; // instance
            let effect = u32le(f, &mut p).ok()?;
            u32le(f, &mut p).ok()?; // duration
            u32le(f, &mut p).ok()?; // permanent flag
            f.get(p..p + 8)?; // clock
            p += 8;
            let entity = varint(f, &mut p).ok()?;
            let tail = f.len().checked_sub(12)?;
            if entity == 0
                || entity > 10_000_000
                || target == 0
                || target > 10_000_000
                || !(10..=2_999_999_999).contains(&effect)
                || tail <= p
            {
                return None;
            }
            let x = coord(f, tail)?;
            let y = coord(f, tail + 4)?;
            let z = coord(f, tail + 8)?;
            if !(100.0..500_000.0).contains(&x.abs())
                || !(100.0..500_000.0).contains(&y.abs())
                || z.abs() >= 50_000.0
            {
                return None;
            }
            out.push(Observation::Position { entity, x, y });
        }
        _ if opcode & 255 == 0x37 => {
            let entity = varint(f, &mut p).ok()?;
            if entity == 0 || entity > 10_000_000 {
                return None;
            }
            let offset = match opcode >> 8 {
                0x1a | 0x1b | 0x1c | 0x1e | 0x20 | 0x28 | 0x29 | 0x2a => 2,
                0x1f | 0x2f => 1,
                0x3c if f.get(p) == Some(&3) => 1,
                _ => return Some(out),
            };
            out.push(Observation::Position {
                entity,
                x: coord(f, p + offset)?,
                y: coord(f, p + offset + 4)?,
            });
        }
        _ => {}
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn skill_facing_is_bounded_and_never_publishes_aim_as_player_position() {
        for opcode in [0x02, 0x09] {
            for angle in [0.0f32, 90.0, -90.0, 720.0] {
                let mut f = vec![opcode, 0x38, 42, 0];
                word(&mut f, 1_000_001);
                f.extend([0, 2, 7]); // aim flags, different target
                let offset = f.len();
                f.extend(angle.to_le_bytes());
                for n in [1000f32, 2000.0, 300.0] {
                    f.extend(n.to_le_bytes());
                }
                if opcode == 0x09 {
                    f.push(100);
                }
                let expected = vec![Observation::Facing {
                    entity: 42,
                    degrees: (angle as f64).rem_euclid(360.0),
                }];
                assert_eq!(read(&f), expected);
                let mut decoder = super::super::Decoder::default();
                decoder.decode(&f);
                assert_eq!(decoder.pet_observations, expected);
                for cut in 0..f.len() {
                    assert!(read(&f[..cut]).is_empty());
                }
                for bad in [f32::NAN, f32::INFINITY, 721.0] {
                    let mut invalid = f.clone();
                    invalid[offset..offset + 4].copy_from_slice(&bad.to_le_bytes());
                    assert!(read(&invalid).is_empty());
                }
                f[2] = 0;
                assert!(read(&f).is_empty());
            }
        }
        // Instant casts need no aim point or duration; a zero target is legitimate.
        let mut f = vec![0x02, 0x38, 42, 0];
        word(&mut f, 1_000_001);
        f.extend([0, 0, 0]);
        f.extend(0f32.to_le_bytes());
        assert_eq!(
            read(&f),
            vec![Observation::Facing {
                entity: 42,
                degrees: 0.0
            }]
        );
    }
    fn word(f: &mut Vec<u8>, n: u32) {
        f.extend(n.to_le_bytes());
    }
    #[test]
    fn collection_is_atomic_and_preserves_reported_progress() {
        let mut f = vec![0, 0x90];
        word(&mut f, 1004);
        f.push(2);
        for (id, l) in [(1004, 2), (1007, 3)] {
            word(&mut f, id);
            word(&mut f, id);
            word(&mut f, l);
        }
        f.push(1);
        word(&mut f, 1004);
        word(&mut f, 32);
        assert_eq!(
            read(&f),
            vec![Observation::Collection {
                active: Some(1004),
                states: vec![
                    PetState {
                        pet_id: 1004,
                        level: 2,
                        progress: 32
                    },
                    PetState {
                        pet_id: 1007,
                        level: 3,
                        progress: 0
                    }
                ]
            }]
        );
        for cut in 0..f.len() {
            assert!(read(&f[..cut]).is_empty());
        }
        let mut bad = f.clone();
        bad[11] = 0;
        assert!(read(&bad).is_empty());
    }
    #[test]
    fn truncated_or_invalid_delta_never_partially_commits() {
        let mut f = vec![0x0d, 0x90, 2];
        for (id, n) in [(1004, 1), (1007, 2)] {
            word(&mut f, id);
            word(&mut f, n);
        }
        assert_eq!(read(&f).len(), 2);
        f.pop();
        assert!(read(&f).is_empty());
        assert!(read(&[0x0d, 0x90, 255]).is_empty());
    }
    #[test]
    fn position_rejects_nan_and_unknown_families() {
        let mut f = vec![0x3c, 0x37, 1, 3];
        f.extend(10f32.to_le_bytes());
        f.extend(20f32.to_le_bytes());
        assert_eq!(
            read(&f),
            vec![Observation::Position {
                entity: 1,
                x: 10.,
                y: 20.
            }]
        );
        f[4..8].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(read(&f).is_empty());
        f[0] = 0xff;
        assert!(read(&f).is_empty());
    }
    #[test]
    fn effect_coordinates_belong_to_caster_and_need_a_complete_finite_tail() {
        for opcode in [0x2a, 0x2b] {
            let mut frame = vec![opcode, 0x38, 7]; // recipient differs from caster
            if opcode == 0x2a {
                frame.push(1);
            }
            frame.extend([0, 1]); // type, instance
            for value in [1_100_000_010, 1000, 0] {
                word(&mut frame, value);
            }
            frame.extend(1_792_623_979_421u64.to_le_bytes());
            frame.push(42); // caster
            frame.push(0); // effect extension before the spatial tail
            let header = frame.len();
            for value in [1250.0f32, -2500.0, 300.0] {
                frame.extend(value.to_le_bytes());
            }
            assert_eq!(
                read(&frame),
                vec![Observation::Position {
                    entity: 42,
                    x: 1250.0,
                    y: -2500.0,
                }]
            );
            for cut in 0..frame.len() {
                assert!(
                    read(&frame[..cut]).is_empty(),
                    "opcode {opcode:x}, cut {cut}"
                );
            }
            for axis in 0..3 {
                let mut invalid = frame.clone();
                invalid[header + axis * 4..header + axis * 4 + 4]
                    .copy_from_slice(&f32::NAN.to_le_bytes());
                assert!(read(&invalid).is_empty());
            }
        }
    }
    #[test]
    fn empty_collection_is_a_valid_sync_but_species_layout_is_not() {
        assert_eq!(
            read(&[0, 0x90, 0, 0, 0, 0, 0, 0]),
            vec![Observation::Collection {
                active: None,
                states: vec![]
            }]
        );
        assert!(read(&[0, 0x90, 0, 0, 0, 0, 1, 0, 0]).is_empty());
    }
    #[test]
    fn normal_decoder_routes_pet_notices_without_damage_or_inventory_double_counting() {
        let mut decoder = super::super::Decoder::default();
        let mut notice = vec![0x0d, 0x90, 1];
        word(&mut notice, 1004);
        word(&mut notice, 2);
        assert!(decoder.decode(&notice).is_empty());
        assert_eq!(
            decoder.pet_observations,
            vec![Observation::Progress {
                pet_id: 1004,
                gained: 2
            }]
        );
        assert!(decoder.observations.is_empty());
        let mut inventory = vec![0x1b, 0x56];
        inventory.resize(30, 0);
        assert!(decoder.decode(&inventory).is_empty());
        assert_eq!(decoder.pet_observations.len(), 1);
        let mut added = vec![0x09, 0x90, 1, 0];
        word(&mut added, 1004);
        word(&mut added, 1);
        assert_eq!(
            read(&added),
            vec![Observation::Added {
                pet_id: 1004,
                level: 1
            }]
        );
    }
}
