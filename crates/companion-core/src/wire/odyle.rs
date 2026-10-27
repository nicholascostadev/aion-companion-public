//! The two absolute Odyle pools in incoming resource-status records.
//! Protocol provenance and byte-vector attribution are in THIRD_PARTY_NOTICES.txt.
use super::{entities::Entities, varint, MAX_FRAME};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Balance {
    pub base: u32,
    pub bonus: u32,
}

/// Recognize only the Odyle resource key/group in the two resource message families.
/// Framing and compressed-bundle completeness are checked before this reader runs.
/// Other resource records and change-amount trailers are deliberately left uninterpreted.
pub fn read(frame: &[u8]) -> Option<Balance> {
    if frame.len() > MAX_FRAME || !matches!(frame.get(..2), Some([0x0b, 0x61] | [0x0c, 0x61])) {
        return None;
    }
    let body = frame.get(2..)?;
    let mut result = None;
    for (index, marker) in body.windows(4).enumerate() {
        if marker != [0x01, 0x87, 0x93, 0x03] || index == 0 {
            continue;
        }
        // Multiple matching records are ambiguous; never select one by accident.
        if result.is_some() {
            return None;
        }
        let mask = body[index - 1];
        if !matches!(mask, 0x00 | 0x04 | 0x08 | 0x0c) {
            return None;
        }
        let mut at = index + 4;
        let mut pool = |bit| -> Option<u32> {
            if mask & bit == 0 {
                return Some(0);
            }
            let start = at;
            let value = varint(body, &mut at).ok()?;
            // A sanity bound, not a game cap. Require canonical varints as well.
            (value <= 10_000 && (at - start == 1 || body[at - 1] != 0)).then_some(value)
        };
        result = Some(Balance {
            base: pool(0x04)?,
            bonus: pool(0x08)?,
        });
    }
    result
}

#[derive(Clone)]
struct Owner {
    entity: u32,
    name: Option<String>,
    server: Option<u16>,
}

/// One connection's latest observation, bounded to a single pair of pools.
/// Character changes invalidate it; merely learning a name/server does not.
#[derive(Clone, Default)]
pub struct State {
    owner: Option<Owner>,
    balance: Option<Balance>,
    revision: u64,
}

impl State {
    pub fn balance(&self) -> Option<Balance> {
        self.balance
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn replace(&mut self, balance: Option<Balance>) {
        self.balance = balance;
        self.revision = self.revision.wrapping_add(1);
    }

    pub(super) fn observe(&mut self, frame: &[u8], entities: &Entities) {
        let owner = entities
            .local
            .map(|entity| (entity, entities.name(entity), entities.local_server_id()));
        let changed = match (&self.owner, owner) {
            (Some(old), Some((entity, name, server))) => {
                old.entity != entity
                    || (old.name.is_some() && name.is_some() && old.name.as_deref() != name)
                    || (old.server.is_some() && server.is_some() && old.server != server)
            }
            (Some(_), None) => true,
            _ => false,
        };
        let same = match (&self.owner, owner) {
            (Some(old), Some((entity, name, server))) => {
                old.entity == entity && old.name.as_deref() == name && old.server == server
            }
            (None, None) => true,
            _ => false,
        };
        if !same {
            self.owner = owner.map(|(entity, name, server)| Owner {
                entity,
                name: name.map(str::to_owned),
                server,
            });
        }
        if changed {
            self.replace(None);
        }
        let next = read(frame);
        if frame.get(..2) == Some(&[0x0b, 0x61]) || next.is_some() {
            // A new full snapshot that lacks a supported Odyle record is unknown,
            // never the previous character's value and never an inferred zero.
            self.replace(next);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        text.as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn resource_records_carry_absolute_base_and_bonus_not_change_amounts() {
        for (bytes, base, bonus) in [
            ("0c61000c018793035f98020308ecff0403", 95, 280),
            ("0c61010c01879303b303870601a0000000", 435, 775),
            ("0c61000801879303eb010308ecff0405", 0, 235),
            ("0c61010801879303b20f0128000000", 0, 1970),
            ("0c6100040187930378040287930302040306001104", 120, 0),
            ("0c61000001879303040287930302", 0, 0),
            // Reduced Odyle record independently verified in an app-owned Global snapshot.
            ("0b610c018793030f9302", 15, 275),
        ] {
            assert_eq!(read(&hex(bytes)), Some(Balance { base, bonus }));
        }
    }

    #[test]
    fn malformed_unrelated_ambiguous_and_truncated_values_are_not_balances() {
        for bytes in [
            "0438000c018793030f9302",
            "0c610008088793031c03",
            "0c61000404000000000a03",
            "0c61000801879303ffff7f03",
            "0c6100020187930301",
            "0c610008018793038000",
            "0c61000c018793030f9302ff0001879303",
            "0c61000801879303ffffffff10",
        ] {
            assert_eq!(read(&hex(bytes)), None, "{bytes}");
        }
        let record = hex("0b610c018793030f9302");
        for end in 0..record.len() {
            assert_eq!(read(&record[..end]), None);
        }
        let mut too_large = vec![0; MAX_FRAME + 1];
        too_large[..record.len()].copy_from_slice(&record);
        assert_eq!(read(&too_large), None);
    }

    #[test]
    fn deltas_replace_both_pools_and_an_unsupported_snapshot_is_unknown() {
        let mut state = State::default();
        let entities = Entities::default();
        state.observe(&hex("0b610c018793030f9302"), &entities);
        assert_eq!(
            state.balance(),
            Some(Balance {
                base: 15,
                bonus: 275
            })
        );
        state.observe(&hex("0c610008018793030a"), &entities);
        assert_eq!(state.balance(), Some(Balance { base: 0, bonus: 10 }));
        let revision = state.revision();
        state.observe(&hex("0c610c0187930380"), &entities);
        assert_eq!(state.revision(), revision);
        state.observe(&hex("0b61040287930302"), &entities);
        assert_eq!(state.balance(), None);
        state.observe(&hex("0c61000001879303"), &entities);
        assert_eq!(state.balance(), Some(Balance { base: 0, bonus: 0 }));
    }

    #[test]
    fn learning_identity_keeps_the_self_resource_but_switching_character_clears_it() {
        let mut state = State::default();
        let mut entities = Entities::default();
        state.observe(&hex("0b610c018793030f9302"), &entities);
        entities.local = Some(1);
        state.observe(&[0, 1], &entities);
        assert!(state.balance().is_some());
        entities.local = Some(2);
        state.observe(&[0, 1], &entities);
        assert_eq!(state.balance(), None);
        state.observe(&hex("0c610004018793030f"), &entities);
        entities.local = None;
        state.observe(&[0, 1], &entities);
        assert_eq!(state.balance(), None);
    }

    #[test]
    fn a_reused_entity_with_a_different_name_also_clears_the_balance() {
        let mut decoder = crate::wire::Decoder::default();
        let mut identity = hex(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/self-identity-aahz.hex"
        ))
        .trim());
        decoder.decode(&identity);
        decoder.decode(&hex("0b610c018793030f9302"));
        assert!(decoder.odyle.balance().is_some());
        let name_at = identity
            .windows(4)
            .position(|bytes| bytes == b"Aahz")
            .unwrap();
        identity[name_at..name_at + 4].copy_from_slice(b"Newa");
        decoder.decode(&identity);
        assert_eq!(decoder.odyle.balance(), None);
    }

    fn framed(frame: &[u8]) -> Vec<u8> {
        assert!(frame.len() + 4 < 128);
        [vec![(frame.len() + 4) as u8], frame.to_vec()].concat()
    }

    #[test]
    fn resource_traffic_synchronizes_and_incomplete_tcp_or_bundles_never_publish_it() {
        let snapshot = hex("0b610c018793030f9302");
        let update = hex("0c610008018793030a");
        let zero = hex("0c61000001879303");
        let raw = [framed(&snapshot), framed(&update), framed(&zero)].concat();
        let mut stream = crate::wire::Stream::default();
        assert!(stream.push(100, &raw[..raw.len() - 1], 0).is_empty());
        let frames = stream.push(100 + raw.len() as u32 - 1, &raw[raw.len() - 1..], 1);
        assert_eq!(frames.len(), 3);
        let mut decoder = crate::wire::Decoder::default();
        for frame in frames {
            assert!(decoder.decode(&frame).is_empty());
        }
        assert_eq!(decoder.odyle.balance(), Some(Balance { base: 0, bonus: 0 }));
        assert!(decoder.observations.is_empty());
        let mut compressed = vec![0xff, 0xff];
        compressed.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        compressed.extend_from_slice(&lz4_flex::block::compress(&raw));
        decoder.decode(&compressed);
        let revision = decoder.odyle.revision();
        let invalid = [framed(&snapshot), vec![0x10, 0x0b]].concat();
        let mut compressed = vec![0xff, 0xff];
        compressed.extend_from_slice(&(invalid.len() as u32).to_le_bytes());
        compressed.extend_from_slice(&lz4_flex::block::compress(&invalid));
        decoder.decode(&compressed);
        assert_eq!(decoder.odyle.revision(), revision);
        assert_eq!(decoder.odyle.balance(), Some(Balance { base: 0, bonus: 0 }));
    }
}
