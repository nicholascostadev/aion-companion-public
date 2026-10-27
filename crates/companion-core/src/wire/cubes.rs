//! Bounded world-object lifecycle observations. Protocol evidence: docs/CUBE_FINDER_RESEARCH.md.
//! Spatial XY ownership comes from the existing validated spatial reader; Z is optional.
use super::{pets, u32le, varint};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Observation {
    Spawn {
        entity: u32,
        template: u32,
        position: Point,
    },
    Remove {
        entity: u32,
        reason: u8,
    },
    Interaction {
        entity: u32,
        actor: u32,
        done: bool,
    },
    Position {
        entity: u32,
        position: Point,
    },
    Zone {
        id: u32,
        position: Option<Point>,
    },
}

fn coordinate(frame: &[u8], at: usize) -> Option<f64> {
    let value = f32::from_le_bytes(frame.get(at..at.checked_add(4)?)?.try_into().ok()?) as f64;
    (value.is_finite() && value.abs() < 1_000_000.).then_some(value)
}

fn valid_entity(entity: u32) -> bool {
    (1..=10_000_000).contains(&entity)
}

/// Called once for each completely decoded frame, including frames inside bundles.
pub(super) fn read(frame: &[u8], spatial: &[pets::Observation]) -> Vec<Observation> {
    let Some(opcode) = frame.get(..2).map(|v| u16::from_be_bytes([v[0], v[1]])) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    if matches!(opcode, 0x3436 | 0x3536 | 0x3836 | 0x3a36) {
        if let Some(event) = object(frame, opcode) {
            result.push(event);
        }
        return result;
    }
    // Do not rediscover player identity, infer ownership from aim points, or
    // reinterpret collection packets. Reuse only already validated spatial records.
    let z = match opcode {
        0x2136 => coordinate(frame, 26),
        0x2a38 | 0x2b38 => frame
            .len()
            .checked_sub(4)
            .and_then(|at| coordinate(frame, at)),
        _ if opcode & 255 == 0x37 => movement_z(frame, opcode),
        _ => None,
    };
    for observation in spatial {
        match *observation {
            pets::Observation::Position { entity, x, y } => {
                result.push(Observation::Position {
                    entity,
                    position: Point { x, y, z },
                });
            }
            pets::Observation::Zone { id, x, y } => result.push(Observation::Zone {
                id,
                position: x.zip(y).map(|(x, y)| Point { x, y, z }),
            }),
            _ => {}
        }
    }
    result
}

fn movement_z(frame: &[u8], opcode: u16) -> Option<f64> {
    let mut p = 2;
    varint(frame, &mut p).ok()?;
    let offset = match opcode >> 8 {
        0x1a | 0x1b | 0x1c | 0x1e | 0x20 | 0x28 | 0x29 | 0x2a => 2,
        0x1f | 0x2f => 1,
        0x3c if frame.get(p) == Some(&3) => 1,
        _ => return None,
    };
    coordinate(frame, p + offset + 8)
}

fn object(frame: &[u8], opcode: u16) -> Option<Observation> {
    let mut p = 2;
    let entity = varint(frame, &mut p).ok()?;
    if !valid_entity(entity) {
        return None;
    }
    match opcode {
        0x3436 => {
            // Common complete object header: kind, template, XYZ, extra float,
            // heading, three state bytes and a creation timestamp. No timer is inferred.
            frame.get(p..p + 37)?;
            if frame.get(p..p + 2)? != [4, 0] {
                return None;
            }
            p += 2;
            let template = u32le(frame, &mut p).ok()?;
            if template == 0 {
                return None;
            }
            Some(Observation::Spawn {
                entity,
                template,
                position: Point {
                    x: coordinate(frame, p)?,
                    y: coordinate(frame, p + 4)?,
                    z: Some(coordinate(frame, p + 8)?),
                },
            })
        }
        0x3536 => Some(Observation::Remove {
            entity,
            reason: *frame.get(p)?,
        }),
        0x3836 | 0x3a36 => {
            let actor = varint(frame, &mut p).ok()?;
            if !valid_entity(actor) {
                return None;
            }
            let done = opcode == 0x3a36;
            if done {
                // A partial completion must not hide a still-available object.
                // Only the complete successful pattern observed for the supported
                // cube signatures establishes an opening. Failed/unknown outcomes
                // remain unknown until a subsequent object lifecycle record.
                if u32le(frame, &mut p).ok()? != 1 || u32le(frame, &mut p).ok()? != 630_900_003 {
                    return None;
                }
            } else if frame.get(p) != Some(&1) {
                return None;
            }
            Some(Observation::Interaction {
                entity,
                actor,
                done,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bytes(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
            .collect()
    }
    #[test]
    fn published_global_spawn_vectors_decode_world_xyz() {
        for (hex, entity, x, y, z) in [
            ("3436e5ff030400a74f1200001d44c780a5f647006471460000000000000000010101aae4a534a101000000000000000000002c4d4502070000", 65509, -50205., 126283., 15449.),
            ("3436868d020400a74f1200a0b447c7b26c034800de964600000000002490430101014ab6a734a101000000000000000000002c4d4502070000", 34438, -51124.625, 134578.78125, 19311.),
        ] {
            let frame = bytes(hex);
            let expected = Observation::Spawn { entity, template: 1200039, position: Point { x, y, z: Some(z) } };
            assert_eq!(read(&frame, &[]), [expected.clone()]);
            let mut decoder = super::super::Decoder::default();
            assert!(decoder.decode(&frame).is_empty());
            assert_eq!(decoder.cube_observations, [expected]);
            for cut in 0..42 { assert!(read(&frame[..cut], &[]).is_empty(), "cut {cut}"); }
            let mut invalid = frame.clone();
            invalid[11..15].copy_from_slice(&f32::NAN.to_le_bytes());
            assert!(read(&invalid, &[]).is_empty());
        }
    }
    #[test]
    fn malformed_interactions_and_unknown_spatial_ownership_stay_unknown() {
        assert!(read(&bytes("3a36010101000000"), &[]).is_empty());
        assert!(read(&bytes("3a3601010000000000000000"), &[]).is_empty());
        assert_eq!(
            read(&bytes("3a3601010100000023c59a25"), &[]),
            [Observation::Interaction {
                entity: 1,
                actor: 1,
                done: true
            }]
        );
        assert!(read(&bytes("3836010100"), &[]).is_empty());
        assert!(read(&bytes("35360004"), &[]).is_empty());
        assert_eq!(
            read(&bytes("35360101"), &[]),
            [Observation::Remove {
                entity: 1,
                reason: 1
            }]
        );
        let mut frame = bytes("3c370103");
        for value in [1000f32, 2000., 300.] {
            frame.extend(value.to_le_bytes());
        }
        let spatial = pets::read(&frame);
        assert_eq!(
            read(&frame, &spatial),
            [Observation::Position {
                entity: 1,
                position: Point {
                    x: 1000.,
                    y: 2000.,
                    z: Some(300.)
                }
            }]
        );
        frame.truncate(frame.len() - 4);
        assert_eq!(
            read(&frame, &pets::read(&frame)),
            [Observation::Position {
                entity: 1,
                position: Point {
                    x: 1000.,
                    y: 2000.,
                    z: None
                }
            }]
        );
        assert!(read(&frame, &[]).is_empty());
    }

    #[test]
    fn an_incomplete_bundle_never_publishes_partial_cube_observations() {
        let spawn = bytes("3436e5ff030400a74f1200001d44c780a5f647006471460000000000000000010101aae4a534a101000000000000000000002c4d4502070000");
        let mut raw = vec![(spawn.len() + 4) as u8];
        raw.extend_from_slice(&spawn);
        let bundle = |raw: &[u8]| {
            let mut result = vec![0xff, 0xff];
            result.extend_from_slice(&(raw.len() as u32).to_le_bytes());
            result.extend(lz4_flex::block::compress(raw));
            result
        };
        let mut decoder = super::super::Decoder::default();
        raw.extend([0x10, 0x34]);
        decoder.decode(&bundle(&raw));
        assert!(decoder.cube_observations.is_empty());
        raw.truncate(raw.len() - 2);
        decoder.decode(&bundle(&raw));
        assert_eq!(decoder.cube_observations.len(), 1);
    }

    #[test]
    fn effect_height_follows_the_validated_caster_not_the_recipient() {
        for opcode in [0x2a, 0x2b] {
            let mut frame = vec![opcode, 0x38, 7];
            if opcode == 0x2a {
                frame.push(1);
            }
            frame.extend([0, 1]);
            for word in [1_100_000_010u32, 1000, 0] {
                frame.extend(word.to_le_bytes());
            }
            frame.extend(1_792_623_979_421u64.to_le_bytes());
            frame.extend([42, 0]);
            for value in [1250f32, -2500., 300.] {
                frame.extend(value.to_le_bytes());
            }
            let spatial = pets::read(&frame);
            assert_eq!(
                read(&frame, &spatial),
                [Observation::Position {
                    entity: 42,
                    position: Point {
                        x: 1250.,
                        y: -2500.,
                        z: Some(300.)
                    }
                }]
            );
            let end = frame.len();
            frame[end - 4..].copy_from_slice(&f32::NAN.to_le_bytes());
            assert!(read(&frame, &pets::read(&frame)).is_empty());
        }
    }
}
