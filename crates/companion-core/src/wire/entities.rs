//! Identity and ownership fields from the MIT protocol reference. Ambiguous owners stay unresolved.
use super::{u32le, varint};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
mod roster;
mod identity;
mod group_diagnostic;
pub use group_diagnostic::GroupDiagnostic;

#[derive(Clone, Default)]
struct Entity {
    name: Option<String>,
    server_id: Option<u16>,
    spawned: bool,
    owner: Option<u32>,
    owner_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct GroupMember {
    pub character_id: Option<String>,
    pub slot: Option<u8>,
    pub group_index: Option<u8>,
    pub ready_observed_ms: Option<u64>,
    pub name: String,
    pub server_id: Option<u16>,
    pub class: Option<String>,
    pub level: u32,
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
    pub leader: Option<bool>,
    pub ready: Option<bool>,
}

#[derive(Clone, Serialize)]
pub struct Inspection {
    pub id: u64,
    pub name: String,
    pub class: String,
    pub level: u32,
    pub gear_score: u32,
    pub observed_ms: u64,
}

fn class_name(id: u32) -> Option<&'static str> {
    [
        "Gladiator",
        "Templar",
        "Ranger",
        "Assassin",
        "Spiritmaster",
        "Sorcerer",
        "Cleric",
        "Chanter",
    ]
    .get(id.checked_sub(1)? as usize)
    .copied()
}
fn server_id(bytes: &[u8]) -> Option<u16> {
    let id = u16::from_le_bytes(bytes.get(..2)?.try_into().ok()?);
    (1000..=3000).contains(&id).then_some(id)
}
fn observed_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |time| time.as_millis() as u64)
}

#[derive(Clone, Default)]
pub struct Entities {
    rows: HashMap<u32, Entity>,
    pub local: Option<u32>,
    pub local_identity_source: Option<&'static str>,
    attribute_identity: identity::AttributeIdentity,
    party: HashSet<String>,
    group: Vec<GroupMember>,
    inspections: VecDeque<Inspection>,
    pub roster_seen: bool,
    pub roster_observed_ms: Option<u64>,
    pub lobby_name: Option<String>,
    pub capacity: Option<u8>,
    pub party_id: Option<u32>,
    pub ready_observed_ms: Option<u64>,
    /// Bounded evidence for unsupported party layouts, exposed only through diagnostic access.
    pub unparsed_roster: Option<String>,
    pub group_diagnostic: GroupDiagnostic,
    pub self_records: u64,
    pub last_self_header: Option<String>,
    pub last_self_outcome: Option<&'static str>,
    pub revision: u64,
}

fn name_at(frame: &[u8], at: usize) -> Option<&str> {
    let size = usize::from(*frame.get(at)?);
    if !(2..=24).contains(&size) {
        return None;
    }
    let name = std::str::from_utf8(frame.get(at + 1..at + 1 + size)?).ok()?;
    if name.chars().count() < 2
        || !name.chars().all(char::is_alphanumeric)
        || !name.chars().any(char::is_alphabetic)
    {
        return None;
    }
    Some(name)
}

impl Entities {
    fn row(&mut self, id: u32) -> Option<&mut Entity> {
        if id == 0 || id > 10_000_000 || (self.rows.len() >= 8192 && !self.rows.contains_key(&id)) {
            return None;
        }
        self.rows.entry(id).or_default().into()
    }
    fn register(&mut self, id: u32, name: &str) {
        if let Some(row) = self.row(id) {
            if row.name.as_deref() != Some(name) {
                row.name = Some(name.into());
                row.server_id=None;
                self.revision += 1;
            }
        }
    }
    pub fn name(&self, id: u32) -> Option<&str> {
        self.rows.get(&id)?.name.as_deref()
    }
    pub fn local_server_id(&self) -> Option<u16> {
        self.rows.get(&self.local?)?.server_id
    }
    pub fn group_member(&self,id:u32)->Option<&GroupMember>{
        let row=self.rows.get(&id)?;let server=row.server_id?;
        let mut matches=self.group.iter().filter(|m|Some(m.name.as_str())==row.name.as_deref()&&m.server_id==Some(server));
        let member=matches.next()?;matches.next().is_none().then_some(member)
    }
    pub fn name_bindings(&self) -> Vec<(u32, String)> {
        let mut bindings: Vec<_> = self.rows.iter().filter_map(|(&id, row)| {
            row.name.as_ref().map(|name| (id, name.clone()))
        }).collect();
        bindings.sort_by_key(|row| row.0);
        bindings.truncate(128);
        bindings
    }
    pub fn label(&self, id: u32) -> String {
        self.name(id)
            .map_or_else(|| format!("Entity #{id}"), |name| format!("{name} #{id}"))
    }
    pub fn known_player(&self, id: u32) -> bool {
        self.local == Some(id) || self.name(id).is_some()
    }
    pub fn monster(&self, id: u32) -> bool {
        self.rows
            .get(&id)
            .is_some_and(|row| row.spawned && row.owner.is_none() && row.owner_name.is_none())
    }
    pub fn spawned(&self, id: u32) -> bool {
        self.rows.get(&id).is_some_and(|row| row.spawned)
    }
    pub fn owner(&self, id: u32) -> Option<u32> {
        let mut current = id;
        let mut seen = HashSet::new();
        for _ in 0..4 {
            if !seen.insert(current) {
                return None;
            }
            let Some(row) = self.rows.get(&current) else {
                return (current != id).then_some(current);
            };
            // A name in an NPC spawn can name its target. Only the explicit owner ID counts.
            let owner = row.owner;
            match owner {
                Some(next) if next != current => current = next,
                _ => return (current != id).then_some(current),
            }
        }
        None
    }
    pub fn party_member(&self, id: u32) -> bool {
        self.local == Some(id) || self.name(id).is_some_and(|name| self.party.contains(name))
    }
    pub fn named_count(&self) -> usize {
        self.rows.values().filter(|r| r.name.is_some()).count()
    }
    pub fn party_count(&self) -> usize {
        self.group.len()
    }
    pub fn group_members(&self) -> &[GroupMember] {
        &self.group
    }
    pub fn inspections(&self) -> &VecDeque<Inspection> {
        &self.inspections
    }

    pub fn observe(&mut self, frame: &[u8]) -> Result<(), ()> {
        let opcode = u16::from_be_bytes(frame.get(..2).ok_or(())?.try_into().map_err(|_| ())?);
        self.observe_identities(frame);
        let mut p = 2;
        match opcode {
            0x1392 | 0x1d97 if frame == [frame[0], frame[1], 0, 0] => {
                self.party.clear();
                self.group.clear();
                self.lobby_name = None;
                self.capacity = None;
                self.party_id = None;
                self.ready_observed_ms = None;
                self.roster_seen = true;
                self.roster_observed_ms = Some(observed_ms());
                self.revision += 1;
            }
            0x048d => {
                varint(frame, &mut p)?;
                p += 4;
                let id = varint(frame, &mut p)?;
                if let Some(name) = name_at(frame, p + 2) {
                    self.register(id, name);
                    if let Some(server) = server_id(&frame[p..]) {
                        if let Some(row) = self.row(id) {
                            if row.server_id != Some(server) {
                                row.server_id = Some(server);
                                self.revision += 1;
                            }
                        }
                    }
                    self.resolve_attribute_identity();
                }
            }
            0x0297 => {
                self.group_diagnostic.roster(frame);
                if let Some(roster) = roster::parse(frame) {
                    self.unparsed_roster = None;
                    self.party = roster.members.iter().map(|row| row.name.clone()).collect();
                    let same_party=self.party_id==Some(roster.party_id);
                    if !same_party { self.ready_observed_ms=None; }
                    let mut members=roster.members;
                    for member in &mut members {if member.ready.is_some(){member.ready_observed_ms=Some(observed_ms());}else if same_party{if let Some(old)=self.group.iter().find(|old|old.character_id.is_some()&&old.character_id==member.character_id){member.ready=old.ready;member.ready_observed_ms=old.ready_observed_ms;}}}
                    self.group = members;
                    self.ready_observed_ms=self.group.iter().filter_map(|m|m.ready_observed_ms).max();
                    self.lobby_name = Some(roster.name);
                    self.capacity = Some(roster.capacity);
                    self.party_id = Some(roster.party_id);
                    self.roster_seen = true;
                    self.roster_observed_ms = Some(observed_ms());
                    self.revision += 1;
                    return Ok(());
                }
                self.unparsed_roster = (frame.len() <= 8192)
                    .then(|| frame.iter().map(|byte| format!("{byte:02x}")).collect());
                // Keep a prior complete roster when an unfamiliar/truncated full header arrives.
                if frame.len() > 6 && roster::header(frame).is_some() {
                    return Ok(());
                }
                let mut names = HashSet::new();
                let mut group = Vec::new();
                let mut k = 2;
                while k + 1 < frame.len() {
                    if let Some(name) = name_at(frame, k) {
                        let after = k + 1 + usize::from(frame[k]);
                        if let Some(tail) = frame.get(after..after + 8) {
                            if (5..=40).contains(&tail[0])
                                && tail[1..4] == [0, 0, 0]
                                && (1..=200).contains(&tail[4])
                                && tail[5..8] == [0, 0, 0]
                            {
                                names.insert(name.to_owned());
                                let member = GroupMember {
                                    character_id:None,slot:None,group_index:None,ready_observed_ms:None,
                                    name: name.to_owned(),
                                    server_id: k
                                        .checked_sub(2)
                                        .and_then(|at| server_id(&frame[at..])),
                                    class: class_name((u32::from(tail[0]) - 1) / 4)
                                        .map(str::to_owned),
                                    level: u32::from(tail[4]),
                                    gear_score: None,
                                    combat_power: None,
                                    leader: None,
                                    ready: None,
                                };
                                if !group.contains(&member) {
                                    group.push(member);
                                }
                                k = after + 8;
                                continue;
                            }
                        }
                    }
                    k += 1;
                }
                if !names.is_empty() && group.len() <= 24 {
                    self.party = names;
                    group.sort_by(|a, b| a.name.cmp(&b.name).then(a.server_id.cmp(&b.server_id)));
                    self.group = group;
                    self.lobby_name = None;
                    self.capacity = None;
                    self.party_id = None;
                    self.ready_observed_ms = None;
                    self.roster_seen = true;
                    self.roster_observed_ms = Some(observed_ms());
                    self.revision += 1;
                }
            }
            0x1697 => {
                let observed = observed_ms();
                let mut matched = false;
                if frame.len() == 11 {
                    let id = u64::from_le_bytes(frame[2..10].try_into().map_err(|_| ())?).to_string();
                    if let Some(member) = self.group.iter_mut().find(|m| m.character_id.as_deref() == Some(&id)) {
                        member.ready = Some(frame[10] & 1 != 0);
                        member.ready_observed_ms = Some(observed);
                        self.ready_observed_ms = Some(observed);
                        self.revision += 1;
                        matched = true;
                    }
                }
                self.group_diagnostic.ready(frame, matched, observed);
            }
            0x0b97=>{if let Some(mut member)=roster::added(frame){
                if member.ready.is_some(){member.ready_observed_ms=Some(observed_ms());}
                if let Some(index)=self.group.iter().position(|m|m.character_id==member.character_id){member.leader=self.group[index].leader;if member.ready.is_none(){member.ready=self.group[index].ready;member.ready_observed_ms=self.group[index].ready_observed_ms;}self.group[index]=member;}else if self.group.len()<12{self.group.push(member);}
                self.ready_observed_ms=self.group.iter().filter_map(|m|m.ready_observed_ms).max();
                self.group.sort_by_key(|m|m.slot);self.party=self.group.iter().map(|m|m.name.clone()).collect();self.roster_seen=true;self.roster_observed_ms=Some(observed_ms());self.revision+=1;
            }},
            0x1e97 if frame.len()>=10&&frame.len()<=12=>{let id=u64::from_le_bytes(frame[2..10].try_into().map_err(|_|())?).to_string();let old=self.group.len();self.group.retain(|m|m.character_id.as_deref()!=Some(&id));if old!=self.group.len(){self.ready_observed_ms=self.group.iter().filter_map(|m|m.ready_observed_ms).max();self.party=self.group.iter().map(|m|m.name.clone()).collect();self.roster_observed_ms=Some(observed_ms());self.revision+=1;}},
            0x5036 => {
                if frame.len() < 40 || frame.get(2..5) != Some(&[0, 0, 7]) {
                    return Ok(());
                }
                let Some(name) = name_at(frame, 5) else {
                    return Ok(());
                };
                let after = 6 + usize::from(frame[5]);
                let mut q = after;
                let code = u32le(frame, &mut q)?;
                let Some(class) = class_name(code / 4) else {
                    return Ok(());
                };
                if !matches!(code % 4, 1 | 2) || frame.get(after + 4) != Some(&1) {
                    return Ok(());
                }
                q = after + 6;
                let level = u32le(frame, &mut q)?;
                q = after + 14;
                let gear_score = u32le(frame, &mut q)?;
                if !(1..=200).contains(&level) || gear_score > 1_000_000 {
                    return Ok(());
                }
                self.revision += 1;
                // These are inspection observations, not globally unique character identities.
                self.inspections.retain(|row| {
                    !(row.name == name
                        && row.class == class
                        && row.level == level
                        && row.gear_score == gear_score)
                });
                self.inspections.push_front(Inspection {
                    id: self.revision,
                    name: name.into(),
                    class: class.into(),
                    level,
                    gear_score,
                    observed_ms: observed_ms(),
                });
                self.inspections.truncate(32);
            }
            0x4136 => {
                let id = varint(frame, &mut p)?;
                let flags = frame.get(p..p + 3).ok_or(())?;
                let mut owner_name = None;
                if flags[2] == 1 {
                    let name = name_at(frame, p + 3).ok_or(())?;
                    owner_name = Some(name.to_owned());
                    p += 1 + usize::from(frame[p + 3]);
                }
                p += 3;
                u32le(frame, &mut p)?; // NPC type; no proprietary NPC name database required
                let mut owner = None;
                if let Some(marker) = frame
                    .get(p..)
                    .ok_or(())?
                    .windows(8)
                    .position(|bytes| bytes == [255; 8])
                {
                    let mut q = p + marker + 16;
                    if let Ok(candidate) = varint(frame, &mut q) {
                        if candidate > 0 && candidate != id {
                            owner = Some(candidate);
                        }
                    }
                }
                if let Some(row) = self.row(id) {
                    *row = Entity {
                        spawned: true,
                        owner,
                        owner_name,
                        ..Entity::default()
                    };
                    self.revision += 1;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hex(text: &str) -> Vec<u8> {
        text.as_bytes()
            .chunks_exact(2)
            .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
            .collect()
    }
    #[test]
    fn nickname_local_character_and_unicode_roster_are_observations() {
        let mut entities = Entities::default();
        entities
            .observe(&hex("4536F47F0320A00107074D696C69726961"))
            .unwrap();
        assert_eq!(entities.name(16372), Some("Miliria"));
        let mut local = vec![0x33, 0x36, 1, 0, 0, 0, 0, 0x37, 3, b'A', b'b', b'c', 0x18, 5];
        local.extend_from_slice(&6u32.to_le_bytes());
        local.push(1);
        local.extend_from_slice(&45u32.to_le_bytes());
        entities.observe(&local).unwrap();
        assert_eq!(entities.local, Some(1));
        let mut roster = vec![2, 0x97, 7];
        roster.extend_from_slice("Azaëde".as_bytes());
        roster.extend_from_slice(&[34, 0, 0, 0, 45, 0, 0, 0]);
        entities.observe(&roster).unwrap();
        entities.register(2, "Azaëde");
        assert!(entities.party_member(2));
        assert!(entities.party_member(1));
        assert!(!entities.party_member(16372));
        for size in 0..local.len() {
            let _ = Entities::default().observe(&local[..size]);
        }
    }
    #[test]
    fn inspections_are_available_before_joining_a_group_and_validate_layout() {
        // Header and profile fields from the attributed reference SelfCheckAion2 fixture.
        let frame = hex("50360000070b54657374737069656c65720600000001022d000000000000004c0900001805e80c30000000");
        let mut entities = Entities::default();
        entities.observe(&frame).unwrap();
        let profile = entities.inspections().front().unwrap();
        assert_eq!(
            (
                &*profile.name,
                &*profile.class,
                profile.level,
                profile.gear_score
            ),
            ("Testspieler", "Gladiator", 45, 2380)
        );
        assert!(!entities.roster_seen);
        entities.observe(&frame).unwrap();
        assert_eq!(entities.inspections().len(), 1);
        for size in 0..35 {
            let mut truncated = Entities::default();
            let _ = truncated.observe(&frame[..size]);
            assert!(truncated.inspections().is_empty());
        }
        let mut invalid = frame.clone();
        invalid[2] = 1;
        let mut fresh = Entities::default();
        fresh.observe(&invalid).unwrap();
        assert!(fresh.inspections().is_empty());
    }
    #[test]
    fn roster_profiles_preserve_cross_server_names_and_ignore_other_parties() {
        let mut frame = vec![2, 0x97];
        for server in [1304u16, 2301] {
            frame.extend_from_slice(&server.to_le_bytes());
            frame.extend_from_slice(&[3, b'A', b'b', b'c', 32, 0, 0, 0, 45, 0, 0, 0]);
        }
        let mut entities = Entities::default();
        entities.observe(&frame).unwrap();
        assert_eq!(entities.group_members().len(), 2);
        assert_eq!(entities.group_members()[0].class.as_deref(), Some("Cleric"));
        assert_eq!(entities.group_members()[0].server_id, Some(1304));
        frame[0] = 1;
        let mut unrelated = Entities::default();
        unrelated.observe(&frame).unwrap();
        assert!(!unrelated.roster_seen);
    }
    #[test]
    fn explicit_owner_and_reused_npc_id_do_not_guess() {
        let mut entities = Entities::default();
        let mut spawn = vec![0x41, 0x36, 2, 0, 0, 0];
        spawn.extend_from_slice(&123u32.to_le_bytes());
        spawn.extend_from_slice(&[255; 8]);
        spawn.extend_from_slice(&[0; 8]);
        spawn.push(1);
        entities.observe(&spawn).unwrap();
        assert_eq!(entities.owner(2), Some(1));
        assert!(!entities.monster(2));
        *spawn.last_mut().unwrap() = 2;
        entities.observe(&spawn).unwrap();
        assert_eq!(entities.owner(2), None);
        assert!(entities.monster(2));
        assert_eq!(entities.owner(999), None);
    }
}
