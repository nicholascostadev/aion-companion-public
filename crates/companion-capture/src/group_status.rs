//! The `group_status` IPC payload: the party roster, the room it belongs to and lobby
//! inspections.
//!
//! This file is the whole contract. Every field is always present, and `null` always
//! means "not observed", never zero or false. `fixtures/contracts/group_status.json` is
//! this payload for one synthetic party room. The capture crate's `contract_fixtures`
//! test proves the serialised payload equals it, and the frontend reads the same file.
//!
//! The desktop adapter adds `protocol_diagnostic` to this payload in development builds
//! only; it is not part of the contract.
use companion_core::wire::entities;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GroupStatus {
    /// When this capture began (epoch milliseconds). It changes with every restart.
    pub capture_id: u64,
    pub running: bool,
    /// `idle`, `starting`, `waiting_for_game`, `capturing`, `stopped` or `error`.
    pub phase: String,
    /// English text describing the phase, or the capture error.
    pub message: String,
    /// A roster record was observed, including one that emptied the party.
    pub roster_seen: bool,
    /// Milliseconds since the last roster record was observed.
    pub roster_age_ms: Option<u64>,
    /// In slot order for a complete roster.
    pub members: Vec<Member>,
    /// Newest first, at most 32.
    pub inspections: Vec<Inspection>,
    pub lobby_name: Option<String>,
    /// Party size limit, 1 to 12.
    pub capacity: Option<u8>,
    pub party_id: Option<u32>,
    /// A complete live party room roster: running in phase `capturing` with a title,
    /// a capacity and at least one member.
    pub room: bool,
    /// The dungeon the room's party was formed for.
    pub dungeon_id: Option<u32>,
    pub run: Run,
    /// A dungeon room whose run has not been observed to start or clear.
    pub preparing: bool,
    pub ready_check: ReadyCheck,
}

/// One roster member. Gear score and combat power follow the same precedence as the
/// meters (`companion_core::players`); every other field is the roster as observed.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Member {
    /// A 64-bit id as decimal text, because it exceeds a JavaScript safe integer.
    pub character_id: Option<String>,
    /// 1-based party slot.
    pub slot: Option<u8>,
    /// Never observed today; always `null`.
    pub group_index: Option<u8>,
    /// When `ready` was last observed (epoch milliseconds).
    pub ready_observed_ms: Option<u64>,
    pub name: String,
    pub server_id: Option<u16>,
    pub class: Option<String>,
    pub level: u32,
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
    pub leader: Option<bool>,
    /// Set only by an explicit readiness update, never by the roster itself.
    pub ready: Option<bool>,
}

impl From<entities::GroupMember> for Member {
    fn from(member: entities::GroupMember) -> Self {
        // Named in full, so a field added to the roster is a decision made here.
        let entities::GroupMember {
            character_id,
            slot,
            group_index,
            ready_observed_ms,
            name,
            server_id,
            class,
            level,
            gear_score,
            combat_power,
            leader,
            ready,
        } = member;
        Self {
            character_id,
            slot,
            group_index,
            ready_observed_ms,
            name,
            server_id,
            class,
            level,
            gear_score,
            combat_power,
            leader,
            ready,
        }
    }
}

/// A character inspected in the lobby. It is an observation, not an identity: the
/// record carries no server and no character id.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Inspection {
    /// Unique among the inspections of one capture; not a character id.
    pub id: u64,
    pub name: String,
    pub class: String,
    pub level: u32,
    pub gear_score: u32,
    /// Epoch milliseconds.
    pub observed_ms: u64,
}

impl From<entities::Inspection> for Inspection {
    fn from(inspection: entities::Inspection) -> Self {
        let entities::Inspection {
            id,
            name,
            class,
            level,
            gear_score,
            observed_ms,
        } = inspection;
        Self {
            id,
            name,
            class,
            level,
            gear_score,
            observed_ms,
        }
    }
}

/// The observed dungeon run; see `docs/GROUP_PROTOCOL.md`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Run {
    pub phase: RunPhase,
    /// The running or cleared dungeon.
    pub dungeon_id: Option<u32>,
    pub run_id: Option<String>,
    /// The last observed zone, inside a run or not.
    pub zone_id: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunPhase {
    /// Nothing observed since the connection began: a run may already be under way.
    Unknown,
    /// A zone was observed without an active dungeon run.
    Outside,
    Running,
    /// Cleared, still in the dungeon.
    Cleared,
}

/// Readiness metadata. Only each member's ready bit is observed today, so the fields
/// describing a timed ready-check round are always `null`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReadyCheck {
    /// Always `null`.
    pub active: Option<bool>,
    /// Always `null`.
    pub started_ms: Option<u64>,
    /// The newest readiness observation in this party (epoch milliseconds).
    pub observed_ms: Option<u64>,
    /// The oldest readiness observation among the members shown.
    pub oldest_observed_ms: Option<u64>,
    /// Always `null`.
    pub expires_ms: Option<u64>,
    /// Always `"observed lobby member readiness"`.
    pub source: &'static str,
    /// Always `true`.
    pub supported: bool,
}

/// What capture state holds for the group, copied out under the capture lock. The
/// payload is built from it after the lock is released.
pub(crate) struct Observed {
    pub capture_id: u64,
    pub running: bool,
    pub phase: String,
    pub message: String,
    pub roster_seen: bool,
    pub roster_observed_ms: Option<u64>,
    pub members: Vec<entities::GroupMember>,
    pub inspections: VecDeque<entities::Inspection>,
    pub lobby_name: Option<String>,
    pub capacity: Option<u8>,
    pub party_id: Option<u32>,
    pub ready_observed_ms: Option<u64>,
    pub room: bool,
    pub dungeon_id: Option<u32>,
    /// The run status as the run phase owner reports it.
    pub run: Value,
    pub preparing: bool,
}

impl GroupStatus {
    /// `now_ms` is the wall clock (epoch milliseconds) the roster's age is measured at.
    pub(crate) fn new(observed: Observed, now_ms: u64) -> Result<Self, String> {
        let run = serde_json::from_value(observed.run)
            .map_err(|error| format!("Dungeon run status is not the expected shape: {error}"))?;
        let oldest_ready = observed
            .members
            .iter()
            .filter_map(|member| member.ready_observed_ms)
            .min();
        Ok(Self {
            capture_id: observed.capture_id,
            running: observed.running,
            phase: observed.phase,
            message: observed.message,
            roster_seen: observed.roster_seen,
            roster_age_ms: observed
                .roster_observed_ms
                .map(|seen| now_ms.saturating_sub(seen)),
            members: observed.members.into_iter().map(Member::from).collect(),
            inspections: observed
                .inspections
                .into_iter()
                .map(Inspection::from)
                .collect(),
            lobby_name: observed.lobby_name,
            capacity: observed.capacity,
            party_id: observed.party_id,
            room: observed.room,
            dungeon_id: observed.dungeon_id,
            run,
            preparing: observed.preparing,
            ready_check: ReadyCheck {
                active: None,
                started_ms: None,
                observed_ms: observed.ready_observed_ms,
                oldest_observed_ms: oldest_ready,
                expires_ms: None,
                source: "observed lobby member readiness",
                supported: true,
            },
        })
    }
}
