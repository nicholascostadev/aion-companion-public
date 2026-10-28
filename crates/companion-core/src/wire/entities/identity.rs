//! Name bindings carried by masked self/player identity records.
use super::{name_at, server_id, Entities};
use crate::wire::{u32le, varint};

struct Binding<'a> {
    id: u32,
    name: &'a str,
    local: bool,
    server: Option<u16>,
}

#[derive(Clone, Default)]
pub(super) struct AttributeIdentity {
    id: Option<u32>,
    observations: u8,
    conflicted: bool,
}

// App-owned Global capture: private attribute deltas continued without any 33 36
// record and stayed on the local entity during another player's inspection.
// Accept only the complete observed layout; unknown trailers remain unsupported.
fn attributes(frame: &[u8]) -> Option<u32> {
    let mut at = 2;
    let id = varint(frame, &mut at).ok()?;
    if !(1..=10_000_000).contains(&id) { return None; }
    let count = usize::from(*frame.get(at)?);
    if count > 64 { return None; }
    at += 1;
    let end = at + count * 6;
    if frame.get(end..) != Some(&[0; 8]) { return None; }
    let mut fields = std::collections::HashSet::new();
    for entry in frame.get(at..end)?.chunks_exact(6) {
        let field = u16::from_le_bytes([entry[0], entry[1]]);
        if field == 0 || !fields.insert(field) { return None; }
    }
    Some(id)
}

fn read(frame: &[u8]) -> Option<Binding<'_>> {
    parse(frame).ok()
}

fn parse(frame: &[u8]) -> Result<Binding<'_>, &'static str> {
    let opcode = frame.get(..2).ok_or("truncated_opcode")?;
    let local = opcode == [0x33, 0x36];
    if !local && opcode != [0x45, 0x36] && opcode != [0x44, 0x36] {
        return Err("not_identity");
    }
    let mut at = 2;
    let id = varint(frame, &mut at).map_err(|_| "invalid_entity_id")?;
    if !(1..=10_000_000).contains(&id) { return Err("invalid_entity_id"); }
    // u32 mask followed by a second mask. Its first bit, not its exact byte, gates the name.
    let mask = *frame.get(at + 4).ok_or("truncated_masks")?;
    if mask & 1 == 0 { return Err("name_not_present"); }
    let name = name_at(frame, at + 5).ok_or("invalid_or_truncated_name")?;
    let after = at + 6 + usize::from(frame[at + 5]);
    if local {
        server_id(frame.get(after..).ok_or("invalid_or_truncated_server")?)
            .ok_or("invalid_or_truncated_server")?;
        let mut code_at = after + 2;
        let code = u32le(frame, &mut code_at).map_err(|_| "invalid_or_truncated_class")?;
        // Global also sends roster-style class codes (e.g. 36 for Chanter) and
        // profile tag 02. Both layouts carry the same server/name/level binding.
        if !(5..=40).contains(&code) { return Err("invalid_or_truncated_class"); }
        if !matches!(frame.get(code_at), Some(1 | 2)) { return Err("invalid_or_truncated_profile_tag"); }
        code_at += 1;
        let level = u32le(frame, &mut code_at).map_err(|_| "invalid_or_truncated_level")?;
        if !(1..=200).contains(&level) { return Err("invalid_or_truncated_level"); }
    }
    Ok(Binding { id, name, local, server:local.then(||server_id(frame.get(after..)?)).flatten() })
}

impl Entities {
    pub(super) fn resolve_attribute_identity(&mut self) {
        let evidence = &self.attribute_identity;
        if self.local.is_some() || evidence.conflicted || evidence.observations < 2 {
            return;
        }
        let Some(id) = evidence.id else { return; };
        // Private attribute heartbeats also repeat an empty, complete layout
        // during mid-session capture. Their entity binding is independent of
        // whether a name/server record or a changed attribute has arrived.
        self.local = Some(id);
        self.local_identity_source = Some("private_attributes");
        self.revision += 1;
    }

    fn observe_attributes(&mut self, frame: &[u8]) {
        if self.local_identity_source == Some("self_record") { return; }
        let Some(id) = attributes(frame) else { return; };
        let evidence = &mut self.attribute_identity;
        if evidence.id.is_some_and(|previous| previous != id) {
            evidence.conflicted = true;
            if self.local_identity_source == Some("private_attributes") {
                self.local = None;
                self.local_identity_source = None;
                self.revision += 1;
            }
            return;
        }
        evidence.id = Some(id);
        evidence.observations = evidence.observations.saturating_add(1).min(2);
        self.resolve_attribute_identity();
    }

    pub(super) fn observe_identities(&mut self, frame: &[u8]) {
        if frame.get(..2) == Some(&[0x4a, 0x36]) {
            self.observe_attributes(frame);
            return;
        }
        if frame.get(..2) == Some(&[0x33, 0x36]) {
            self.self_records += 1;
            self.last_self_outcome = Some(match parse(frame) {
                Ok(_) => "accepted",
                Err(reason) => reason,
            });
            self.last_self_header = Some(frame[..frame.len().min(160)].iter()
                .map(|byte| format!("{byte:02x}")).collect());
        }
        if let Some(binding) = read(frame) {
            self.register(binding.id, binding.name);
            if let Some(row)=self.row(binding.id){row.server_id=binding.server.or(row.server_id);}
            if binding.local {
                self.local = Some(binding.id);
                self.local_identity_source = Some("self_record");
                self.revision += 1;
            }
        }
        // Identity records also appear inside non-combat notices. Require their full
        // server/class/level header, and reject conflicting identities in one notice.
        // Never scan damage, player/NPC spawns, roster, inspection or compressed bytes.
        let opcode = u16::from_be_bytes([frame[0], frame[1]]);
        if matches!(opcode, 0x0438 | 0x0538 | 0x0238 | 0x0938 | 0x4136 | 0x4236
            | 0x0297 | 0x0197 | 0x5036 | 0xffff | 0x3336 | 0x4436 | 0x4536
            | 0x008d | 0x2a38 | 0x2b38 | 0x2c38 | 0x468d | 0x4738 | 0x1697
            | 0x0b97 | 0x1e97 | 0x0060 | 0x0160 | 0x0061
            | 0x0090 | 0x0d90 | 0x1490 | 0x0990 | 0x0191) {
            return;
        }
        let mut candidate: Option<(usize, Binding<'_>)> = None;
        for offset in 2..frame.len().saturating_sub(20).min(64 * 1024) {
            if let Some(binding) = read(&frame[offset..]) {
                if binding.local {
                    if candidate.as_ref().is_some_and(|(_, previous)|
                        previous.id != binding.id || previous.name != binding.name) {
                        return;
                    }
                    candidate = Some((offset, binding));
                }
            }
        }
        if let Some((offset, binding)) = candidate {
            self.register(binding.id, binding.name);
            if let Some(row)=self.row(binding.id){row.server_id=binding.server.or(row.server_id);}
            self.local = Some(binding.id);
            self.local_identity_source = Some("self_record");
            self.self_records += 1;
            self.last_self_outcome = Some("accepted_embedded");
            self.last_self_header = Some(frame[offset..frame.len().min(offset + 160)]
                .iter().map(|byte| format!("{byte:02x}")).collect());
            self.revision += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference() -> Vec<u8> {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/self-identity-aahz.hex"))
            .trim().as_bytes().chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap()).collect()
    }
    #[test]
    fn recorded_self_identity_resolves_its_combat_id_and_survives_mask_changes() {
        let original = reference();
        for mask in [0x01, 0x07, 0x37, 0x81] {
            let mut frame = original.clone();
            frame[8] = mask;
            let mut entities = Entities::default();
            entities.observe(&frame).unwrap();
            assert_eq!(entities.local, Some(331));
            assert_eq!(entities.name(331), Some("Aahz"));
            assert_eq!(entities.label(331), "Aahz #331");
        }
    }
    #[test]
    fn self_identity_inside_a_notice_is_read_but_not_from_damage_or_rosters() {
        for opcode in [[0x00, 0x36], [0x1d, 0x37], [0x70, 0x37], [0x04, 0x38], [0x01, 0x97]] {
            let mut frame = opcode.to_vec();
            frame.extend_from_slice(&[0; 4]);
            frame.extend_from_slice(&reference());
            let mut entities = Entities::default();
            entities.observe(&frame).unwrap();
            let valid = opcode != [0x04, 0x38] && opcode != [0x01, 0x97];
            assert_eq!(entities.local, valid.then_some(331));
        }
    }
    #[test]
    fn absent_name_bit_invalid_profile_and_truncated_names_do_not_bind_self() {
        let reference = reference();
        for size in 0..24 {
            let mut entities = Entities::default();
            let _ = entities.observe(&reference[..size]);
            assert_eq!(entities.local, None);
        }
        for (offset, replacement) in [(8, 0x36), (15, 0), (20, 3)] {
            let mut frame = reference.clone();
            frame[offset] = replacement;
            let mut entities = Entities::default();
            entities.observe(&frame).unwrap();
            assert_eq!(entities.local, None);
        }
    }

    #[test]
    fn current_global_class_and_profile_flags_resolve_the_character_name() {
        // Verified live header; the nickname is replaced by a same-length test name.
        let text = "3336e5715eb1e9283709546573746163746f72630924000000022d0000006f0800006f080000";
        let frame: Vec<_> = text.as_bytes().chunks_exact(2).map(|pair|
            u8::from_str_radix(std::str::from_utf8(pair).unwrap(),16).unwrap()).collect();
        let mut entities = Entities::default();
        entities.observe(&frame).unwrap();
        assert_eq!(entities.local, Some(14565));
        assert_eq!(entities.name(14565), Some("Testactor"));
    }

    fn attribute_reference() -> Vec<Vec<u8>> {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/local-attribute-identity.hex"))
            .lines().map(|line| line.as_bytes().chunks_exact(2).map(|pair|
                u8::from_str_radix(std::str::from_utf8(pair).unwrap(),16).unwrap()).collect()).collect()
    }

    #[test]
    fn repeated_private_heartbeats_bind_self_before_name_or_attribute_values_arrive() {
        let frames = attribute_reference();
        let mut entities = Entities::default();
        entities.observe(&frames[1]).unwrap();
        assert_eq!(entities.local, None);
        entities.observe(&frames[1]).unwrap();
        assert_eq!(entities.local, Some(331));
        assert_eq!(entities.name(331), None);
        assert_eq!(entities.local_server_id(), None);
        entities.observe(&frames[2]).unwrap();
        assert_eq!(entities.local, Some(331));
        assert_eq!(entities.name(331), Some("Testactor"));
    }

    #[test]
    fn recorded_attributes_identify_local_without_login_teleport_or_inspection() {
        let frames = attribute_reference();
        for order in [[0, 1, 2], [2, 0, 1]] {
            let mut entities = Entities::default();
            let mut attributes = 0;
            for index in order {
                entities.observe(&frames[index]).unwrap();
                attributes += usize::from(index != 2);
                assert_eq!(entities.local, (attributes >= 2).then_some(331));
            }
            assert_eq!(entities.local, Some(331));
            assert_eq!(entities.name(331), Some("Testactor"));
            assert_eq!(entities.local_server_id(), Some(2403));
            assert_eq!(entities.self_records, 0);
        }
    }

    #[test]
    fn invalid_and_conflicting_attribute_updates_never_choose_another_player() {
        let frames = attribute_reference();
        for size in 2..frames[0].len() {
            let mut entities = Entities::default();
            for frame in [&frames[0][..size], &frames[0][..size], &frames[2]] { let _ = entities.observe(frame); }
            assert_eq!(entities.local, None);
        }
        for (offset, value) in [(4, 3), (24, 1)] {
            let mut invalid = frames[0].clone(); invalid[offset] = value;
            let mut entities = Entities::default();
            for frame in [&invalid, &invalid, &frames[2]] { entities.observe(frame).unwrap(); }
            assert_eq!(entities.local, None);
        }
        let mut duplicate_field = frames[0].clone();
        duplicate_field[11] = duplicate_field[5];
        duplicate_field[12] = duplicate_field[6];
        let mut zero_field = frames[0].clone();
        zero_field[5] = 0; zero_field[6] = 0;
        let mut extra_byte = frames[0].clone(); extra_byte.push(0);
        for invalid in [duplicate_field, zero_field, extra_byte] {
            let mut entities = Entities::default();
            for frame in [&invalid, &invalid, &frames[2]] { entities.observe(frame).unwrap(); }
            assert_eq!(entities.local, None);
        }
        let mut missing_server = frames[2].clone(); missing_server[11] = 0; missing_server[12] = 0;
        let mut entities = Entities::default();
        for frame in [&frames[0], &frames[1], &missing_server] { entities.observe(frame).unwrap(); }
        assert_eq!(entities.local, Some(331));
        assert_eq!(entities.local_server_id(), None);
        entities.observe(&frames[2]).unwrap();
        assert_eq!(entities.local, Some(331));
        let mut conflicting = frames[0].clone(); conflicting[2] += 1;
        for resolve_first in [false, true] {
            let mut entities = Entities::default();
            entities.observe(&frames[2]).unwrap();
            entities.observe(&frames[0]).unwrap();
            if resolve_first { entities.observe(&frames[1]).unwrap(); assert_eq!(entities.local, Some(331)); }
            entities.observe(&conflicting).unwrap();
            for frame in [&frames[0], &frames[1]] { entities.observe(frame).unwrap(); }
            assert_eq!(entities.local, None);
            entities.observe(&reference()).unwrap();
            entities.observe(&conflicting).unwrap();
            assert_eq!(entities.local, Some(331));
            assert_eq!(entities.name(331), Some("Aahz"));
        }
    }
}
