//! The Group toggle enables display in an observed room, never a forced-open panel.
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Roster {
    /// Capture cannot currently establish membership. Keep the panel hidden.
    Unknown,
    /// A roster without room metadata, or an explicit room leave.
    Outside,
    /// An authoritative structured room roster, including a host waiting alone.
    Room(u64),
}

impl Roster {
    pub fn from_snapshot(group: &Value) -> Self {
        if group["running"] != true || group["phase"] != "capturing" || group["roster_seen"] != true
        {
            return Self::Unknown;
        }
        match (
            group["party_id"].as_u64(),
            group["lobby_name"].as_str(),
            group["capacity"].as_u64(),
        ) {
            (Some(id), Some(_), Some(1..=12))
                if group["members"]
                    .as_array()
                    .is_some_and(|rows| !rows.is_empty()) =>
            {
                Self::Room(id)
            }
            _ => Self::Outside,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Show,
    Hide,
}

pub struct GroupAuto {
    enabled: bool,
    last: Roster,
    /// Both room transitions and manual changes invalidate pending window creation.
    revision: u64,
}
impl Default for GroupAuto {
    fn default() -> Self {
        Self {
            enabled: false,
            last: Roster::Unknown,
            revision: 0,
        }
    }
}

impl GroupAuto {
    fn wants_visible(&self) -> bool {
        self.enabled && matches!(self.last, Roster::Room(_))
    }

    /// `requested` is the panel's current visibility request, not the feature toggle.
    pub fn observe(&mut self, roster: Roster, requested: bool) -> Option<Action> {
        if self.last != roster {
            self.revision += 1;
        }
        self.last = roster;
        match (self.wants_visible(), requested) {
            (true, false) => Some(Action::Show),
            (false, true) => Some(Action::Hide),
            _ => None,
        }
    }

    /// Menu, tray and close all change the feature intent. Enabling outside a room waits.
    pub fn manual(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.revision += 1;
    }
    pub fn enabled(&self) -> bool {
        self.enabled
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn show_allowed(&self, revision: u64) -> bool {
        self.revision == revision && self.wants_visible()
    }
    pub fn hide_allowed(&self, revision: u64) -> bool {
        self.revision == revision && !self.wants_visible()
    }
    pub fn status(&self) -> Value {
        let (roster, room_id) = match self.last {
            Roster::Unknown => ("unknown", None),
            Roster::Outside => ("outside", None),
            Roster::Room(id) => ("room", Some(id)),
        };
        json!({"enabled":self.enabled,"roster":roster,"in_room":room_id.is_some(),"room_id":room_id})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Action::{Hide, Show};
    use Roster::{Outside, Room, Unknown};

    fn snapshot() -> Value {
        json!({"running":true,"phase":"capturing","roster_seen":true,
            "party_id":7,"lobby_name":"Raid room","capacity":5,"members":[{}]})
    }
    #[test]
    fn room_requires_a_complete_live_room_roster_not_just_party_members() {
        assert_eq!(Roster::from_snapshot(&snapshot()), Room(7)); // A host may be alone.
        let mut group = snapshot();
        group["members"] = json!([{}, {}]);
        group["lobby_name"] = Value::Null;
        assert_eq!(Roster::from_snapshot(&group), Outside);
        for key in ["party_id", "capacity"] {
            let mut group = snapshot();
            group[key] = Value::Null;
            assert_eq!(Roster::from_snapshot(&group), Outside);
        }
        let mut group = snapshot();
        group["members"] = json!([]);
        assert_eq!(Roster::from_snapshot(&group), Outside);
        let mut group = snapshot();
        group["capacity"] = json!(0);
        assert_eq!(Roster::from_snapshot(&group), Outside);
    }
    #[test]
    fn stale_roster_does_not_open_after_disconnect_or_capture_stop() {
        for phase in ["starting", "waiting_for_game", "error", "stopped"] {
            let mut group = snapshot();
            group["phase"] = phase.into();
            assert_eq!(Roster::from_snapshot(&group), Unknown);
        }
        let mut group = snapshot();
        group["running"] = false.into();
        assert_eq!(Roster::from_snapshot(&group), Unknown);
        let mut group = snapshot();
        group["roster_seen"] = false.into();
        assert_eq!(Roster::from_snapshot(&group), Unknown);
        assert_eq!(Roster::from_snapshot(&json!({})), Unknown);
    }
    #[test]
    fn disabled_by_default_even_when_a_room_is_observed() {
        let mut auto = GroupAuto::default();
        assert_eq!(auto.observe(Room(7), false), None);
        assert_eq!(auto.status()["enabled"], false);
    }
    #[test]
    fn enabling_outside_a_room_waits_and_can_be_disabled_while_waiting() {
        let mut auto = GroupAuto::default();
        auto.manual(true);
        for roster in [Unknown, Outside] {
            assert_eq!(auto.observe(roster, false), None);
        }
        assert_eq!(auto.status()["enabled"], true);
        auto.manual(false);
        assert_eq!(auto.observe(Room(7), false), None);
    }
    #[test]
    fn enabled_room_entry_shows_and_leave_hides_without_disabling() {
        let mut auto = GroupAuto::default();
        auto.manual(true);
        assert_eq!(auto.observe(Room(7), false), Some(Show));
        assert_eq!(auto.observe(Room(7), true), None);
        assert_eq!(auto.observe(Outside, true), Some(Hide));
        assert_eq!(auto.status()["enabled"], true);
        assert_eq!(auto.observe(Outside, false), None);
        assert_eq!(auto.observe(Room(7), false), Some(Show));
    }
    #[test]
    fn enabling_in_a_room_shows_but_disabling_stays_off_across_rooms() {
        let mut auto = GroupAuto::default();
        auto.observe(Room(7), false);
        auto.manual(true);
        assert_eq!(auto.observe(Room(7), false), Some(Show));
        auto.manual(false);
        assert_eq!(auto.observe(Room(7), true), Some(Hide));
        for roster in [Room(7), Outside, Room(9)] {
            assert_eq!(auto.observe(roster, false), None);
        }
    }
    #[test]
    fn unknown_membership_hides_but_keeps_the_toggle_enabled() {
        let mut auto = GroupAuto::default();
        auto.manual(true);
        auto.observe(Room(7), false);
        assert_eq!(auto.observe(Unknown, true), Some(Hide));
        assert_eq!(auto.status()["enabled"], true);
        assert_eq!(auto.observe(Room(7), false), Some(Show));
    }
    #[test]
    fn a_pending_show_cannot_commit_after_disable_leave_or_room_change() {
        for next in [Unknown, Outside, Room(9)] {
            let mut auto = GroupAuto::default();
            auto.manual(true);
            auto.observe(Room(7), false);
            let revision = auto.revision();
            assert!(auto.show_allowed(revision));
            auto.observe(next, false);
            assert!(!auto.show_allowed(revision));
        }
        let mut auto = GroupAuto::default();
        auto.manual(true);
        auto.observe(Room(7), false);
        let revision = auto.revision();
        auto.manual(false);
        assert!(!auto.show_allowed(revision));
    }
    #[test]
    fn leaving_and_rejoining_the_same_room_invalidates_old_creation() {
        let mut auto = GroupAuto::default();
        auto.manual(true);
        auto.observe(Room(7), false);
        let revision = auto.revision();
        auto.observe(Outside, false);
        auto.observe(Room(7), false);
        assert!(!auto.show_allowed(revision));
        assert!(auto.show_allowed(auto.revision()));
    }
    #[test]
    fn a_stale_hide_cannot_hide_a_newly_enabled_room() {
        let mut auto = GroupAuto::default();
        auto.observe(Room(7), true);
        let revision = auto.revision();
        assert!(auto.hide_allowed(revision));
        auto.manual(true);
        assert!(!auto.hide_allowed(revision));
    }
}
