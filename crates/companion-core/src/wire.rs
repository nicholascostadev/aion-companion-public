//! AION 2 Global wire facts cross-checked with the MIT reference in THIRD_PARTY_NOTICES.
//! Bounded decoding of observed combat and identity records.
use std::collections::HashMap;
pub mod cubes;
pub mod diagnostic;
pub mod entities;
use entities::Entities;
mod field_bosses;
pub mod odyle;
pub mod pets;
mod telemetry;
mod spell_links;

#[cfg(test)]
#[path = "wire/tests.rs"]
mod tests;

const MAX_BUFFER: usize = 1 << 20;
const MAX_FRAME: usize = 1 << 18;

#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub actor: u32,
    pub target: u32,
    pub skill: u32,
    pub amount: u64,
    pub critical: bool,
    pub tick: bool,
}

fn varint(bytes: &[u8], cursor: &mut usize) -> Result<u32, ()> {
    let mut value = 0u32;
    for shift in (0..35).step_by(7) {
        let b = *bytes.get(*cursor).ok_or(())?;
        *cursor += 1;
        if shift == 28 && b > 15 {
            return Err(());
        }
        value |= u32::from(b & 127) << shift;
        if b & 128 == 0 {
            return Ok(value);
        }
    }
    Err(())
}

fn u32le(bytes: &[u8], cursor: &mut usize) -> Result<u32, ()> {
    let value = u32::from_le_bytes(
        bytes
            .get(*cursor..*cursor + 4)
            .ok_or(())?
            .try_into()
            .map_err(|_| ())?,
    );
    *cursor += 4;
    Ok(value)
}

pub fn player_skill(skill: u32) -> bool {
    (11..=19).contains(&(skill / 1_000_000))
}

fn healing_family(skill: u32) -> bool {
    // Healing families and party buffs must not inflate DPS. Factual ID lists, see notice.
    const HEALS: &[u32] = &[
        1000, 1111, 1112, 1126, 1127, 1138, 1172, 1173, 1211, 1223, 1225, 1226, 1232, 1272, 1308,
        1326, 1371, 1379, 1426, 1471, 1479, 1524, 1541, 1579, 1619, 1620, 1627, 1675, 1677, 1679,
        1699, 1709, 1710, 1712, 1716, 1724, 1727, 1729, 1732, 1739, 1772, 1780, 1812, 1814, 1816,
        1817, 1820, 1824, 1842, 1844, 1872, 1935, 1936, 1945, 1971, 1979,
    ];
    HEALS.contains(&(skill / 10_000))
}

fn non_damage(skill: u32) -> bool {
    skill == 11_000_100
        || (2_000_000..3_000_000).contains(&skill)
        || [1178, 1278, 1741, 1819].contains(&(skill / 10_000))
}

#[derive(Default)]
pub struct Decoder {
    spell_links: spell_links::Links,
    frame_time: Option<u64>,
    pub odyle: odyle::State,
    pub group_trace: diagnostic::SmallFrames,
    pub entities: Entities,
    pub frames: u64,
    pub rejected: u64,
    pub bundles: u64,
    pub observations: Vec<crate::combat::CombatEvent>,
    pub observation_drops: u64,
    pub pet_observations: Vec<pets::Observation>,
    pub cube_observations: Vec<cubes::Observation>,
}

impl Decoder {
    pub fn decode_at(&mut self, frame: &[u8], at_ms: u64) -> Vec<Hit> {
        self.frame_time = Some(at_ms);
        let hits = self.decode(frame);
        self.frame_time = None;
        hits
    }
    pub fn decode(&mut self, frame: &[u8]) -> Vec<Hit> {
        match self.decode_inner(frame, 0) {
            Ok(hits) => hits,
            Err(()) => {
                self.rejected += 1;
                Vec::new()
            }
        }
    }

    fn decode_inner(&mut self, frame: &[u8], depth: u8) -> Result<Vec<Hit>, ()> {
        self.frames += 1;
        let opcode = u16::from_be_bytes(frame.get(..2).ok_or(())?.try_into().map_err(|_| ())?);
        if opcode == 0xffff {
            if depth != 0 {
                return Err(());
            }
            let size = u32le(frame, &mut 2)? as usize;
            if size == 0 || size > MAX_BUFFER {
                return Err(());
            }
            let raw =
                lz4_flex::block::decompress(frame.get(6..).ok_or(())?, size).map_err(|_| ())?;
            if raw.len() != size {
                return Err(());
            }
            let mut cursor = 0;
            let mut frames = Vec::new();
            // Validate the entire bundle before emitting anything from it.
            while cursor < raw.len() {
                let length = varint(&raw, &mut cursor)?.checked_sub(4).ok_or(())? as usize;
                if !(2..=MAX_FRAME).contains(&length) {
                    return Err(());
                }
                let end = cursor.checked_add(length).ok_or(())?;
                frames.push(raw.get(cursor..end).ok_or(())?);
                cursor = end;
            }
            let mut hits = Vec::new();
            for inner in frames {
                match self.decode_inner(inner, depth + 1) {
                    Ok(decoded) => hits.extend(decoded),
                    Err(()) => self.rejected += 1,
                }
            }
            self.bundles += 1;
            return Ok(hits);
        }
        self.group_trace.record(frame);
        self.entities.observe(frame)?;
        if let Some(at_ms) = self.frame_time {
            self.spell_links.observe(frame, at_ms, &mut self.entities);
        }
        self.odyle.observe(frame, &self.entities);
        let pet_records = pets::read(frame);
        let capacity = 8192usize.saturating_sub(self.cube_observations.len());
        self.cube_observations
            .extend(cubes::read(frame, &pet_records).into_iter().take(capacity));
        let capacity = 8192usize.saturating_sub(self.pet_observations.len());
        self.pet_observations
            .extend(pet_records.into_iter().take(capacity));
        let mut metadata = telemetry::read(frame, &self.entities);
        let available = 8192usize.saturating_sub(self.observations.len());
        if metadata.len() > available {
            self.observation_drops += (metadata.len() - available) as u64;
            metadata.truncate(available);
        }
        self.observations.extend(metadata);
        if opcode != 0x0438 && opcode != 0x0538 {
            return Ok(Vec::new());
        }
        let mut p = 2;
        let target = varint(frame, &mut p)?;
        let flags = *frame.get(p).ok_or(())?;
        p += if opcode == 0x0438 { 2 } else { 1 };
        if (opcode == 0x0438 && flags & 4 == 0) || (opcode == 0x0538 && flags != 0x0a) {
            return Ok(Vec::new());
        }
        let actor = varint(frame, &mut p)?;
        let owner = self.entities.owner(actor);
        let source = owner.unwrap_or(actor);
        let (skill, amount, critical) = if opcode == 0x0438 {
            let skill = u32le(frame, &mut p)?;
            if non_damage(skill)
                || (!player_skill(skill) && owner.is_none() && !self.entities.known_player(source))
                || (healing_family(skill) && !self.entities.monster(target))
            {
                return Ok(Vec::new());
            }
            let critical = *frame.get(p + 1).ok_or(())? == 3;
            let marker = frame
                .get(p + 2..)
                .ok_or(())?
                .windows(4)
                .position(|w| (1..=9).contains(&w[0]) && w[1..] == [0, 0, 0])
                .ok_or(())?;
            let mut q = p + 2 + marker + 4;
            varint(frame, &mut q)?; // power scalar is itself variable length
            (skill, varint(frame, &mut q)?, critical)
        } else {
            varint(frame, &mut p)?; // effect stack
            let effect = u32le(frame, &mut p)?;
            let amount = varint(frame, &mut p)?;
            let skill = u32le(frame, &mut p)?;
            if p != frame.len() || effect < 1_000_000_000 {
                return Ok(Vec::new());
            }
            (skill, amount, false)
        };
        if actor == 0
            || target == 0
            || actor == target
            || amount == 0
            || amount > 100_000_000
            || non_damage(skill)
            || (!player_skill(skill) && owner.is_none() && !self.entities.known_player(source))
            || (self.entities.spawned(actor) && owner.is_none())
            || self.entities.spawned(source)
            || (healing_family(skill) && !self.entities.monster(target))
        {
            return Ok(Vec::new());
        }
        Ok(vec![Hit {
            actor: source,
            target,
            skill,
            amount: u64::from(amount),
            critical,
            tick: opcode == 0x0538,
        }])
    }
}

#[derive(Default)]
pub struct Stream {
    next: Option<u32>,
    pending: HashMap<u32, Vec<u8>>,
    buffer: Vec<u8>,
    synced: bool,
    waiting_since: Option<u64>,
    pub gaps: u64,
    pub retransmissions: u64,
    pub desyncs: u64,
}

impl Stream {
    pub fn push(&mut self, sequence: u32, payload: &[u8], at_ms: u64) -> Vec<Vec<u8>> {
        if payload.is_empty() {
            return Vec::new();
        }
        let next = *self.next.get_or_insert(sequence);
        let delta = sequence.wrapping_sub(next) as i32;
        if delta > 0 {
            self.pending
                .entry(sequence)
                .or_insert_with(|| payload.to_vec());
            let since = *self.waiting_since.get_or_insert(at_ms);
            if self.pending.len() <= 64
                && self.pending.values().map(Vec::len).sum::<usize>() <= MAX_BUFFER / 4
                && at_ms.saturating_sub(since) < 1500
            {
                return Vec::new();
            }
            self.gaps += 1;
            self.synced = false;
            self.buffer.clear();
            self.next = self
                .pending
                .keys()
                .min_by_key(|s| s.wrapping_sub(next))
                .copied();
        } else {
            self.append(sequence, payload);
        }
        loop {
            let next = self.next.unwrap_or(sequence);
            let candidate = self
                .pending
                .keys()
                .copied()
                .filter(|s| s.wrapping_sub(next) as i32 <= 0)
                .min_by_key(|s| s.wrapping_sub(next) as i32);
            let Some(s) = candidate else {
                break;
            };
            if let Some(bytes) = self.pending.remove(&s) {
                self.append(s, &bytes);
            }
        }
        if self.pending.is_empty() {
            self.waiting_since = None;
        }
        if self.buffer.len() > MAX_BUFFER {
            self.buffer.clear();
            self.synced = false;
            self.gaps += 1;
        }
        self.cut_frames()
    }

    fn append(&mut self, sequence: u32, payload: &[u8]) {
        let overlap = self.next.unwrap_or(sequence).wrapping_sub(sequence) as i32;
        if overlap > 0 {
            self.retransmissions += 1;
        }
        let skip = overlap.max(0) as usize;
        if skip < payload.len() {
            self.buffer.extend_from_slice(&payload[skip..]);
            self.next = Some(sequence.wrapping_add(payload.len() as u32));
        }
    }

    fn cut_frames(&mut self) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut p = 0;
        while p < self.buffer.len() {
            if !self.synced {
                // Three known, complete records establish a boundary after mid-stream starts/loss.
                let found = (p..self.buffer.len().min(p + 8192)).find(|&start| {
                    let mut cursor = start;
                    for _ in 0..3 {
                        let Ok((body, end)) = record(&self.buffer, cursor) else {
                            return false;
                        };
                        let opcode = u16::from_be_bytes([body[0], body[1]]);
                        if !matches!(
                            opcode,
                            0x0438
                                | 0x0538
                                | 0x0238
                                | 0x0938
                                | 0x0036
                                | 0xffff
                                | 0x008d
                                | 0x2a38
                                | 0x2b38
                                | 0x2c38
                                | 0x3c37
                                | 0x4536
                                | 0x4436
                                | 0x4136
                                | 0x4236
                                | 0x0297
                                | 0x048d
                                | 0x3336
                                | 0x5036
                                | 0x1392
                                | 0x1d97
                                | 0x1697
                                | 0x0b97
                                | 0x1e97
                                | 0x468d
                                | 0x4738
                                | 0x2136
                                | 0x218d
                                | 0x0191
                                | 0x0b61
                                | 0x0c61
                        ) {
                            return false;
                        }
                        cursor = end;
                    }
                    true
                });
                let Some(start) = found else {
                    if self.buffer.len() - p > MAX_FRAME * 2 {
                        p = self.buffer.len() - MAX_FRAME;
                        self.desyncs += 1;
                    }
                    break;
                };
                if start != p {
                    self.desyncs += 1;
                }
                p = start;
                self.synced = true;
            }
            if self.buffer[p] == 0 {
                p += 1;
                continue;
            }
            if self.buffer.len() - p >= 5
                && (0x14..=0x17).contains(&self.buffer[p])
                && self.buffer[p + 1] == 3
                && (1..=4).contains(&self.buffer[p + 2])
            {
                let size = u16::from_be_bytes([self.buffer[p + 3], self.buffer[p + 4]]) as usize;
                if (1..=16640).contains(&size) {
                    if self.buffer.len() - p < size + 5 {
                        break;
                    }
                    p += size + 5;
                    continue;
                }
            }
            match record(&self.buffer, p) {
                Ok((body, end)) => {
                    out.push(body.to_vec());
                    p = end;
                }
                Err(false) => break,
                Err(true) => {
                    self.synced = false;
                    self.desyncs += 1;
                    p += 1;
                }
            }
        }
        self.buffer.drain(..p);
        out
    }
}

// Err(false): incomplete, Err(true): malformed. Length includes four absent header bytes.
fn record(bytes: &[u8], start: usize) -> Result<(&[u8], usize), bool> {
    let mut p = start;
    let length = match varint(bytes, &mut p) {
        Ok(n) => n.checked_sub(4).ok_or(true)? as usize,
        Err(()) => return Err(bytes.len().saturating_sub(start) >= 5),
    };
    if !(2..=MAX_FRAME).contains(&length) {
        return Err(true);
    }
    let end = p + length;
    Ok((bytes.get(p..end).ok_or(false)?, end))
}

#[derive(Clone, Copy, Debug, Hash, Eq, PartialEq)]
pub struct Flow {
    pub source: [u8; 16],
    pub destination: [u8; 16],
    pub source_port: u16,
    pub destination_port: u16,
    pub ipv6: bool,
}

pub struct Segment<'a> {
    pub flow: Flow,
    pub sequence: u32,
    pub payload: &'a [u8],
    pub close: bool,
}

/// Ethernet (including VLAN), Npcap loopback, raw IPv4/IPv6. Fragments are rejected.
pub fn tcp_segment(packet: &[u8], link: i32) -> Option<Segment<'_>> {
    let (mut p, mut kind) = match link {
        1 => (14, u16::from_be_bytes(packet.get(12..14)?.try_into().ok()?)),
        0 | 108 => {
            let b: [u8; 4] = packet.get(..4)?.try_into().ok()?;
            let af = if link == 0 {
                u32::from_le_bytes(b)
            } else {
                u32::from_be_bytes(b)
            };
            (
                4,
                if af == 2 {
                    0x0800
                } else if matches!(af, 23 | 24 | 28 | 30) {
                    0x86dd
                } else {
                    return None;
                },
            )
        }
        12 | 101 => (
            0,
            if packet.first()? >> 4 == 4 {
                0x0800
            } else {
                0x86dd
            },
        ),
        _ => return None,
    };
    for _ in 0..2 {
        if kind == 0x8100 || kind == 0x88a8 {
            kind = u16::from_be_bytes(packet.get(p + 2..p + 4)?.try_into().ok()?);
            p += 4;
        }
    }
    let mut source = [0u8; 16];
    let mut destination = [0u8; 16];
    let end;
    if kind == 0x0800 {
        if packet.get(p)? >> 4 != 4 {
            return None;
        }
        let ihl = usize::from(packet[p] & 15) * 4;
        let length = usize::from(u16::from_be_bytes(
            packet.get(p + 2..p + 4)?.try_into().ok()?,
        ));
        let fragments = u16::from_be_bytes(packet.get(p + 6..p + 8)?.try_into().ok()?);
        if ihl < 20 || length < ihl + 20 || fragments & 0x3fff != 0 || *packet.get(p + 9)? != 6 {
            return None;
        }
        source[..4].copy_from_slice(packet.get(p + 12..p + 16)?);
        destination[..4].copy_from_slice(packet.get(p + 16..p + 20)?);
        end = p + length;
        p += ihl;
    } else if kind == 0x86dd {
        if packet.get(p)? >> 4 != 6 {
            return None;
        }
        end = p
            + 40
            + usize::from(u16::from_be_bytes(
                packet.get(p + 4..p + 6)?.try_into().ok()?,
            ));
        source.copy_from_slice(packet.get(p + 8..p + 24)?);
        destination.copy_from_slice(packet.get(p + 24..p + 40)?);
        let mut next = *packet.get(p + 6)?;
        p += 40;
        for _ in 0..8 {
            if next == 6 {
                break;
            }
            if !matches!(next, 0 | 43 | 60) || p + 2 > end {
                return None;
            }
            let size = (usize::from(*packet.get(p + 1)?) + 1) * 8;
            next = *packet.get(p)?;
            p += size;
        }
        if next != 6 {
            return None;
        }
    } else {
        return None;
    }
    let bytes = packet.get(p..end)?;
    let offset = usize::from(*bytes.get(12)? >> 4) * 4;
    if offset < 20 {
        return None;
    }
    let flags = *bytes.get(13)?;
    let sequence = u32::from_be_bytes(bytes.get(4..8)?.try_into().ok()?)
        .wrapping_add(u32::from(flags & 2 != 0));
    Some(Segment {
        flow: Flow {
            source,
            destination,
            source_port: u16::from_be_bytes(bytes.get(..2)?.try_into().ok()?),
            destination_port: u16::from_be_bytes(bytes.get(2..4)?.try_into().ok()?),
            ipv6: kind == 0x86dd,
        },
        sequence,
        payload: bytes.get(offset..)?,
        close: flags & 5 != 0,
    })
}

#[derive(Default)]
pub struct Pipeline {
    streams: HashMap<Flow, Stream>,
    pub decoder: Decoder,
    pub packets: u64,
    pub gaps: u64,
    pub retransmissions: u64,
    pub desyncs: u64,
}
impl Pipeline {
    pub fn retain_flows(&mut self, active: &std::collections::HashSet<Flow>) {
        self.streams.retain(|flow, _| active.contains(flow));
    }
    pub fn ingest(&mut self, segment: Segment<'_>, at_ms: u64) -> Vec<Hit> {
        self.packets += 1;
        if self.streams.len() >= 32 && !self.streams.contains_key(&segment.flow) {
            self.gaps += 1;
            return Vec::new();
        }
        let stream = self.streams.entry(segment.flow).or_default();
        let before = (stream.gaps, stream.retransmissions, stream.desyncs);
        let frames = stream.push(segment.sequence, segment.payload, at_ms);
        self.gaps += stream.gaps - before.0;
        self.retransmissions += stream.retransmissions - before.1;
        self.desyncs += stream.desyncs - before.2;
        let mut hits = Vec::new();
        for frame in frames {
            hits.extend(self.decoder.decode_at(&frame, at_ms));
        }
        if segment.close {
            self.streams.remove(&segment.flow);
        }
        hits
    }
}

pub fn class_name(skill: u32) -> &'static str {
    match skill / 1_000_000 {
        11 => "Gladiator",
        12 => "Templar",
        13 => "Assassin",
        14 => "Ranger",
        15 => "Sorcerer",
        16 => "Spiritmaster",
        17 => "Cleric",
        18 => "Chanter",
        19 => "Brawler",
        _ => "Entity",
    }
}
