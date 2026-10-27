//! Party roster wire fields, independently decoded and checked with recorded MIT vectors.
//! Field evidence and limits: docs/GROUP_PROTOCOL.md. Snapshot readiness stays unverified.
use super::{class_name, name_at, server_id, GroupMember};
use crate::wire::{u32le, varint};

pub(super) struct Roster {
    pub party_id: u32,
    pub name: String,
    pub capacity: u8,
    pub members: Vec<GroupMember>,
}

pub(super) struct Header<'a> {
    party_id: u32,
    name: &'a str,
    capacity: u8,
    leader: u64,
    count: u32,
    start: usize,
}

fn wide(frame: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(frame.get(at..at + 8)?.try_into().ok()?))
}

pub(super) fn header(frame: &[u8]) -> Option<Header<'_>> {
    if frame.get(..2)? != [2, 0x97] {
        return None;
    }
    let size = usize::from(*frame.get(6)?);
    let party_id = u32le(frame, &mut 2).ok()?;
    if size > 64 {
        return None;
    }
    let name = std::str::from_utf8(frame.get(7..7 + size)?).ok()?;
    if name.chars().any(char::is_control) {
        return None;
    }
    let at = 7 + size;
    let capacity = *frame.get(at)?;
    if !(1..=12).contains(&capacity) {
        return None;
    }
    let leader = wide(frame, at + 7)?;
    let mut start = at + 18;
    let count = varint(frame, &mut start).ok()?;
    if count > u32::from(capacity) {
        return None;
    }
    Some(Header { party_id, name, capacity, leader, count, start })
}

struct Entry {
    member: Option<GroupMember>,
    end: usize,
}

fn entry(frame: &[u8], at: usize, slot: u8, leader: u64) -> Option<Entry> {
    if *frame.get(at + 1)? != slot {
        return None;
    }
    let dbid = wide(frame, at + 2)?;
    let name_size = *frame.get(at + 10)?;
    if name_size == 0 {
        return (dbid == 0 && *frame.get(at)? == 0).then_some(Entry { member: None, end: at + 11 });
    }
    let server = server_id(frame.get(at + 8..)?)?;
    let name = name_at(frame, at + 10)?;
    let mut cursor = at + 11 + usize::from(name_size);
    let code = u32le(frame, &mut cursor).ok()?;
    if !(5..=40).contains(&code) {
        return None;
    }
    let class = class_name((code - 1) / 4);
    let level = u32le(frame, &mut cursor).ok()?;
    if frame[at]&1!=0 { u32le(frame,&mut cursor).ok()?; }
    let gear = u32le(frame, &mut cursor).ok()?;
    if !(1..=200).contains(&level) || gear > 1_000_000 {
        return None;
    }
    // Live full rosters can place the repeated server ID immediately after GS.
    // Its low bit is not readiness. Until a controlled live toggle identifies the
    // actual snapshot field, only explicit readiness-update records supply it.
    // Variable flags precede a repeated server id; CP is a u64 five bytes after that anchor.
    // Ambiguous anchors remain unknown rather than attaching another field as CP.
    let candidates: Vec<_> = (cursor..=cursor + 10)
        .filter_map(|anchor| {
            if frame.get(anchor..anchor + 2)? != server.to_le_bytes() {
                return None;
            }
            // All four markers occur in app-owned live rosters. Requiring only
            // a subset rejects the entire roster when another marker joins.
            if !matches!(frame.get(anchor + 4), Some(1..=4)) {
                return None;
            }
            let power = wide(frame, anchor + 5)?;
            (power <= 100_000_000).then_some((anchor + 13, power))
        })
        .collect();
    let [(end, power)] = candidates.as_slice() else { return None };
    Some(Entry {
        member: Some(GroupMember {
            character_id: Some(dbid.to_string()),slot:Some(slot),group_index:None,ready_observed_ms:None,
            name: name.into(),
            server_id: Some(server),
            class: class.map(str::to_owned),
            level,
            gear_score: (gear > 0).then_some(gear),
            combat_power: (*power > 0).then_some(*power),
            leader: (leader != 0).then_some(dbid == leader),
            ready: None,
        }),
        end: *end,
    })
}

pub(super) fn parse(frame: &[u8]) -> Option<Roster> {
    let meta = header(frame)?;
    let mut cursor = meta.start;
    let mut members = Vec::new();
    for slot in 1..=meta.count as u8 {
        // Tails and vacant slots have variable lengths. Require the next slot and a complete
        // validated member, and reject ambiguous boundaries. Work is bounded by 12 x 65 entries.
        let candidates: Vec<_> = (cursor..=cursor + if slot == 1 { 0 } else { 64 })
            .filter_map(|at| entry(frame, at, slot, meta.leader))
            .collect();
        let found = match candidates.as_slice() {
            [found] => found,
            [first, ..] if candidates.iter().all(|candidate| candidate.member.is_none()) => first,
            _ => return None,
        };
        cursor = found.end;
        if let Some(member) = &found.member {
            if members.iter().any(|previous: &GroupMember| {
                previous.name == member.name && previous.server_id == member.server_id
            }) {
                return None;
            }
            members.push(member.clone());
        }
    }
    Some(Roster { party_id: meta.party_id, name: meta.name.into(), capacity: meta.capacity, members })
}

pub(super) fn added(frame:&[u8])->Option<GroupMember>{let slot=*frame.get(3)?;if !(1..=12).contains(&slot){return None;}entry(frame,2,slot,0)?.member}

#[cfg(test)]
mod tests {
    use super::*;

    fn recorded(text: &str) -> Vec<u8> {
        text.trim().as_bytes().chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }
    const CANYON: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/group-roster-canyon.hex"));
    const FULL: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/group-roster-flutschie.hex"));
    const LOBBY: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/group-roster-lobby.hex"));
    const LIVE: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/group-roster-live-variants.hex"));
    const LIVE_TWO: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/group-roster-live-marker-two.hex"));

    #[test]
    fn recorded_rosters_provide_cp_gear_leader_and_real_capacity_without_inspection() {
        for (fixture, count) in [(FULL, 5), (CANYON, 4), (LOBBY, 4)] {
            let parsed = parse(&recorded(fixture)).expect("recorded roster must parse");
            assert_eq!(parsed.capacity, 5);
            assert_eq!(parsed.members.len(), count);
            assert_eq!(parsed.members.iter().filter(|row| row.leader == Some(true)).count(), 1);
            assert!(parsed.members.iter().all(|row| row.character_id.is_some()));
        }
        let parsed = parse(&recorded(CANYON)).unwrap();
        assert_eq!(parsed.name, "Départ immédiat.");
        let aza = &parsed.members[0];
        assert_eq!((aza.name.as_str(), aza.class.as_deref(), aza.server_id, aza.level,
            aza.gear_score, aza.combat_power),
            ("Azaëde", Some("Chanter"), Some(1303), 45, Some(1494), Some(72079)));
        assert_eq!(parsed.members[3].server_id, Some(2301));
        assert_eq!(parsed.members[3].combat_power, Some(71687));
    }

    #[test]
    fn truncated_rosters_do_not_replace_a_complete_snapshot() {
        let frame = recorded(FULL);
        let complete = parse(&frame).unwrap();
        let mut entities = super::super::Entities::default();
        entities.observe(&frame).unwrap();
        let revision = entities.revision;
        // Truncate throughout the last occupied member, not merely unused packet tail.
        for end in frame.len() - 30..frame.len() - 18 {
            assert!(parse(&frame[..end]).is_none());
            entities.observe(&frame[..end]).unwrap();
            assert_eq!(entities.revision, revision);
            let mut observed=entities.group_members().to_vec();for member in &mut observed{member.ready_observed_ms=None;}assert_eq!(observed, complete.members);
        }
        let mut corrupt = frame.clone();
        // A different opcode is another party, never our authoritative roster.
        corrupt[0] = 1;
        assert!(parse(&corrupt).is_none());
    }

    #[test]
    fn readiness_requires_an_explicit_update_not_server_id_or_slot_flags(){
        let mut entities=super::super::Entities::default();entities.observe(&recorded(FULL)).unwrap();
        assert!(entities.group_members().iter().all(|member| member.ready.is_none()));
        let id: u64=entities.group_members()[0].character_id.as_ref().unwrap().parse().unwrap();
        let mut ready=vec![0x16,0x97];ready.extend_from_slice(&id.to_le_bytes());ready.push(1);entities.observe(&ready).unwrap();assert_eq!(entities.group_members()[0].ready,Some(true));
        ready[10]=0;entities.observe(&ready).unwrap();assert_eq!(entities.group_members()[0].ready,Some(false));
        ready.pop();let before=entities.revision;entities.observe(&ready).unwrap();assert_eq!(entities.revision,before);
        ready.push(1);ready[2]^=0x80;entities.observe(&ready).unwrap();assert_eq!(entities.group_members()[0].ready,Some(false));
        assert!(entities.ready_observed_ms.is_some());
        entities.observe(&[0x1d,0x97,0,0]).unwrap();assert!(entities.ready_observed_ms.is_none());assert!(entities.group_members().is_empty());
    }

    #[test]
    fn live_marker_two_and_optional_member_tails_keep_the_whole_room() {
        let parsed = parse(&recorded(LIVE_TWO)).expect("live marker 02 must parse");
        assert_eq!(parsed.capacity, 5);
        assert_eq!(parsed.members.len(), 5);
        assert_eq!(parsed.members.iter().map(|member| member.combat_power.unwrap()).collect::<Vec<_>>(), vec![108660, 114192, 105790, 96598, 95609]);
        assert!(parsed.members.iter().all(|member| member.ready.is_none()));
    }

    #[test]
    fn live_roster_variants_include_all_members_and_never_treat_server_bits_as_ready() {
        let frame = recorded(LIVE);
        let parsed = parse(&frame).expect("all observed marker variants must parse");
        assert_eq!(parsed.capacity, 5);
        assert_eq!(parsed.members.len(), 5);
        assert_eq!(parsed.members.iter().map(|member| member.slot.unwrap()).collect::<Vec<_>>(), vec![1, 2, 3, 4, 5]);
        assert_eq!(parsed.members.iter().map(|member| member.combat_power.unwrap()).collect::<Vec<_>>(), vec![117176, 96718, 103273, 110272, 94505]);
        assert_eq!(parsed.members[3].class.as_deref(), Some("Gladiator"));
        assert_eq!(parsed.members[4].class.as_deref(), Some("Cleric"));
        assert_eq!(parsed.members[0].leader, Some(true));
        assert!(parsed.members.iter().all(|member| member.ready.is_none()));
        let mut entities = super::super::Entities::default();
        // Reproduce the reported three-member snapshot becoming four, then five.
        for (count, end) in [(3, 207), (4, 266)] {
            let mut joined = frame[..end].to_vec();
            joined[42] = count;
            joined.extend_from_slice(&[0, 9]);
            entities.observe(&joined).unwrap();
            assert_eq!(entities.group_members().len(), usize::from(count));
            assert!(entities.unparsed_roster.is_none());
        }
        entities.observe(&frame).unwrap();
        assert!(entities.unparsed_roster.is_none());
        assert_eq!(entities.group_members().len(), 5);
        assert!(entities.ready_observed_ms.is_none());

        // Existing timestamped incremental observations survive a same-room
        // roster refresh; an unverified full snapshot must not refresh their age.
        let id: u64 = parsed.members[1].character_id.as_ref().unwrap().parse().unwrap();
        let mut ready = vec![0x16, 0x97];
        ready.extend_from_slice(&id.to_le_bytes());
        ready.push(1);
        entities.observe(&ready).unwrap();
        let observed = entities.group_members()[1].ready_observed_ms;
        entities.observe(&frame).unwrap();
        assert_eq!(entities.group_members()[1].ready, Some(true));
        assert_eq!(entities.group_members()[1].ready_observed_ms, observed);
        assert!(entities.group_members()[0].ready.is_none());

        // A genuinely unknown marker still rejects the partial snapshot.
        let mut unsupported = frame;
        unsupported[246] = 0x7f;
        entities.observe(&unsupported).unwrap();
        assert_eq!(entities.group_members().len(), 5);
        assert!(entities.unparsed_roster.is_some());
    }

    #[test]
    fn exact_party_leave_records_clear_the_roster_but_keep_inspection_history() {
        let frame = recorded(CANYON);
        for opcode in [[0x13, 0x92], [0x1d, 0x97]] {
            let mut entities = super::super::Entities::default();
            entities.observe(&frame).unwrap();
            entities.observe(&[opcode[0], opcode[1], 1, 0]).unwrap();
            assert_eq!(entities.group_members().len(), 4);
            entities.observe(&[opcode[0], opcode[1], 0, 0, 1]).unwrap();
            assert_eq!(entities.group_members().len(), 4);
            entities.observe(&[opcode[0], opcode[1], 0, 0]).unwrap();
            assert!(entities.group_members().is_empty());
            assert!(entities.lobby_name.is_none());
            assert!(entities.capacity.is_none());
        }
    }

    #[test]
    fn vacant_middle_slots_do_not_hide_later_members_and_zero_power_is_unknown() {
        let mut frame = vec![2, 0x97];
        frame.extend_from_slice(&7u32.to_le_bytes());
        frame.extend_from_slice(&[4, b'T', b'e', b's', b't', 5]);
        frame.extend_from_slice(&[0; 6]); // dungeon and two flags
        frame.extend_from_slice(&((1304u64 << 48) | 1).to_le_bytes());
        frame.extend_from_slice(&[0, 0, 0, 5]); // three flags, five slots
        for slot in 1..=5u8 {
            if (2..=4).contains(&slot) {
                frame.extend_from_slice(&[0, slot]);
                frame.extend_from_slice(&[0; 12]);
                continue;
            }
            frame.extend_from_slice(&[0x1e, slot]);
            frame.extend_from_slice(&((1304u64 << 48) | u64::from(slot)).to_le_bytes());
            frame.extend_from_slice(&[3, b'A', b'b', b'0' + slot]);
            for value in [6u32, 45, 2000] { frame.extend_from_slice(&value.to_le_bytes()); }
            frame.extend_from_slice(&1304u16.to_le_bytes());
            frame.extend_from_slice(&1304u16.to_le_bytes());
            frame.push(4);
            frame.extend_from_slice(&(if slot == 1 { 100_000u64 } else { 0 }).to_le_bytes());
            frame.extend_from_slice(&[0; 3]);
        }
        let parsed = parse(&frame).unwrap();
        assert_eq!(parsed.members.len(), 2);
        assert_eq!(parsed.members[1].name, "Ab5");
        assert_eq!(parsed.members[0].combat_power, Some(100_000));
        assert_eq!(parsed.members[1].combat_power, None);
        assert_eq!(parsed.members[0].leader, Some(true));
        assert_eq!(parsed.members[1].leader, Some(false));
    }
}
