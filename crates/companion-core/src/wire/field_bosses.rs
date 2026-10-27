//! The game's Field Boss list: map/slot identity, presence and absolute spawn clock.
use super::{u32le, varint};
use crate::combat::CombatEvent;
use std::collections::BTreeSet;

fn header(frame: &[u8], mut at: usize, map: u32) -> Option<(bool, u32, usize)> {
    let alive = match frame.get(at)? {
        0 => false,
        1 => true,
        _ => return None,
    };
    at += 1;
    let place = varint(frame, &mut at).ok()?;
    let slot = place.checked_sub(map.checked_mul(100)?)?;
    (1..=99).contains(&slot).then_some((alive, place, at))
}

fn rows(
    frame: &[u8],
    at: usize,
    map: u32,
    left: u8,
    budget: &mut usize,
) -> Option<Vec<CombatEvent>> {
    *budget = budget.checked_sub(1)?;
    if left == 0 {
        let tail = frame.get(at..)?;
        return (tail.len() <= 8 && tail.iter().all(|b| *b == 0)).then(Vec::new);
    }
    let (alive, place, mut cursor) = header(frame, at, map)?;
    let mut position = None;
    if alive {
        let bytes = frame.get(cursor..cursor + 12)?;
        let mut xyz = [0.0; 3];
        for (axis, chunk) in xyz.iter_mut().zip(bytes.chunks_exact(4)) {
            *axis = f32::from_le_bytes(chunk.try_into().ok()?);
            if !axis.is_finite() || axis.abs() > 10_000_000.0 {
                return None;
            }
        }
        position = Some((f64::from(xyz[0]), f64::from(xyz[1])));
        cursor += 12;
    }
    // Some slots have a one-byte extension before the clock. Accept a reading
    // only when the complete remaining list validates; never emit a partial list.
    for extra in 0..=1 {
        let clock_at = cursor + extra;
        let Some(bytes) = frame.get(clock_at..clock_at + 8) else {
            continue;
        };
        let clock = u64::from_le_bytes(bytes.try_into().ok()?);
        if clock != 0 && !(1_600_000_000_000..=2_600_000_000_000).contains(&clock) {
            continue;
        }
        if let Some(mut rest) = rows(frame, clock_at + 8, map, left - 1, budget) {
            if rest.iter().any(|e| e.skill == place) {
                continue;
            }
            let mut event = CombatEvent {
                skill: place,
                instance: u32::from(alive),
                amount: clock,
                zone_id: Some(map),
                ..CombatEvent::new("field_boss_state")
            };
            if let Some((x, y)) = position {
                event.x = Some(x);
                event.y = Some(y);
            }
            rest.insert(0, event);
            return Some(rest);
        }
    }
    None
}

pub(super) fn read(frame: &[u8]) -> Option<Vec<CombatEvent>> {
    if frame.get(..4)? != [0x01, 0x91, 0, 0] {
        return None;
    }
    let map = u32le(frame, &mut 4).ok()?;
    let count = *frame.get(8)?;
    if !(1000..=99_999).contains(&map) || !(1..=64).contains(&count) {
        return None;
    }
    let result = rows(frame, 9, map, count, &mut 4096)?;
    let distinct: BTreeSet<_> = result.iter().map(|e| e.skill).collect();
    (distinct.len() == result.len()).then_some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn list() -> Vec<u8> {
        let mut frame = vec![1, 0x91, 0, 0];
        frame.extend_from_slice(&1110u32.to_le_bytes());
        frame.push(2);
        // Slot 23 alive with coordinates, slot 24 absent with a respawn clock.
        for (slot, alive, extra) in [(23u32, true, false), (24, false, true)] {
            frame.push(u8::from(alive));
            let mut place = 111000 + slot;
            while place >= 128 {
                frame.push(place as u8 | 128);
                place >>= 7;
            }
            frame.push(place as u8);
            if alive {
                for coordinate in [123.0f32, 456.0, 0.0] {
                    frame.extend_from_slice(&coordinate.to_le_bytes());
                }
            }
            if extra {
                frame.push(7);
            }
            frame.extend_from_slice(&1_792_523_820_000u64.to_le_bytes());
        }
        frame
    }
    #[test]
    fn complete_list_preserves_presence_clock_and_map_slot_identity() {
        let frame = list();
        let rows = read(&frame).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].skill, rows[0].instance, rows[0].x),
            (111023, 1, Some(123.0))
        );
        assert_eq!(
            (rows[1].skill, rows[1].instance, rows[1].amount),
            (111024, 0, 1_792_523_820_000)
        );
        for length in 0..frame.len() {
            assert!(read(&frame[..length]).is_none(), "length {length}");
        }
        let mut invalid = frame.clone();
        invalid.push(1);
        assert!(read(&invalid).is_none());
        for (offset, byte) in [(2, 1), (8, 65), (9, 2)] {
            let mut invalid = frame.clone();
            invalid[offset] = byte;
            assert!(read(&invalid).is_none());
        }
    }
}
