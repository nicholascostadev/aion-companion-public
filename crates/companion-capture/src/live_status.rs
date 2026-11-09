//! The `live_status` IPC payload: the fallback meter and the capture's own state.
//!
//! This file is the whole contract. Every field is always present, and `null` always
//! means "not observed", never zero. `fixtures/contracts/live_status.json` is this
//! payload for one synthetic fight. The capture crate's `contract_fixtures` test proves
//! the serialised payload equals it, and the frontend reads the same file.
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LiveStatus {
    /// The local character's Odyle energy. `null` unless the capture is running in
    /// phase `capturing` and a supported resource record was observed.
    pub odyle: Option<Odyle>,
    pub running: bool,
    /// `idle`, `starting`, `waiting_for_game`, `capturing`, `stopped` or `error`.
    pub phase: String,
    /// English text describing the phase, or the capture error.
    pub message: String,
    /// The current fight's length; zero before its first hit.
    pub duration_ms: u64,
    /// Damage events in the current fight.
    pub events: usize,
    pub stats: CaptureStats,
    /// Highest damage first. Limited to the group when `party_only` is set, or while
    /// an observed dungeon run has a roster.
    pub players: Vec<LivePlayer>,
    /// Entities whose name has been observed.
    pub named_entities: usize,
    pub roster_seen: bool,
    /// Members in the current party roster.
    pub party_members: usize,
    pub local_known: bool,
    /// The saved "party only" preference, not whether `players` is filtered right now.
    pub party_only: bool,
    pub auto_end: bool,
    /// The current fight's number, starting at one.
    pub encounter: u64,
    pub encounter_ended: bool,
    /// Skill names loaded from the catalogue.
    pub skill_labels: usize,
    /// Earlier fights still held in memory, oldest first.
    pub history: Vec<PastEncounter>,
}

/// The two absolute Odyle pools as the game last reported them.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Odyle {
    pub base: u32,
    pub bonus: u32,
    /// Epoch milliseconds.
    pub observed_ms: u64,
}

/// Capture counters. `{}` until the capture worker publishes for the first time; all
/// ten counters together from then on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct CaptureStats {
    #[serde(flatten)]
    pub counters: Option<CaptureCounters>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct CaptureCounters {
    pub adapters: usize,
    pub packets: u64,
    pub frames: u64,
    pub bundles: u64,
    pub rejected: u64,
    pub gaps: u64,
    pub retransmissions: u64,
    pub desyncs: u64,
    pub dropped: u64,
    pub metadata_dropped: u64,
}

/// One meter row: the fallback meter's totals for an entity
/// (`companion_core::live::LivePlayer`) beside the identity its player row carries
/// (`companion_core::players`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LivePlayer {
    pub entity: u32,
    /// `"<name> #<entity>"` once the name is observed, `"<class> #<entity>"` before.
    pub label: String,
    /// From the first skill the player used. `"Entity"` when that skill names no class.
    pub class: String,
    pub damage: u64,
    /// Damage per second over the whole fight.
    pub dps: f64,
    /// Damage per second over the last five seconds.
    pub current_dps: f64,
    /// This row's part of the damage of the rows shown, from 0 to 1.
    pub share: f64,
    pub direct_hits: u64,
    pub critical_hits: u64,
    pub ticks: u64,
    /// Damage by skill label: `"<name> (#<id>)"` with a catalogue name, `"Skill #<id>"`
    /// without one.
    pub skills: BTreeMap<String, u64>,
    pub name: Option<String>,
    /// Whether `name` is set.
    pub name_known: bool,
    pub is_local: bool,
    /// Observed with the name, or taken from the verified roster member.
    pub server_id: Option<u16>,
    /// Counts as part of the local player's group.
    pub party_member: bool,
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct PastEncounter {
    pub id: u64,
    pub duration_ms: u64,
    pub events: usize,
}
