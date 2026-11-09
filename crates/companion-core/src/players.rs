//! Player identity: the one place that decides who a player is.
//!
//! The wire supplies a player in pieces. A combat entity has a name and sometimes a
//! server. The party roster lists characters with class, level, gear score and combat
//! power. The local character alone receives its own combat power updates. Earlier
//! fights left values behind for a server and name. This module joins those pieces into
//! one [`PlayerRow`], and report players, `live_status.players[]` and the group roster
//! all read that row instead of joining on their own.
//!
//! The interface is the test surface: a [`Sighting`] is plain data, so every rule below
//! is exercised without packets, an encounter, files or JSON.
//! [`Entities::sighting`](crate::wire::entities::Entities::sighting) is the only adapter
//! from wire state.
//!
//! Gear score and combat power, highest precedence first:
//!
//! 1. The local character's own combat power update, including decreases.
//! 2. The value the current roster carries for the verified member.
//! 3. The value remembered for that exact server and name. Roster values and own updates
//!    are remembered as they are observed, so they follow a player through solo fights,
//!    a roster that omits them and leaving the group.
//! 4. The value the caller still holds for the same name and server.
//!
//! A different name or server is a different character and inherits none of this.
use crate::combat::{ActorInfo, CombatLog};
use crate::wire::{class_name, entities::GroupMember, player_skill};
use std::collections::BTreeMap;

/// What the wire currently shows for one entity.
#[derive(Clone, Copy, Debug, Default)]
pub struct Sighting<'a> {
    /// The observed character name. `None` until an identity record names the entity.
    pub name: Option<&'a str>,
    /// The server observed together with that name. Name-only records carry none.
    pub server_id: Option<u16>,
    /// This is the identified local character.
    pub local: bool,
    /// The entity arrived in an NPC spawn record, so it is not a player character.
    pub spawned: bool,
    /// Another observed entity carries the same name, so the name alone identifies no one.
    pub shares_name: bool,
    /// The local character's own combat power update, when it still belongs to this
    /// name and server.
    pub own_power: Option<u64>,
    /// The current party roster.
    pub roster: &'a [GroupMember],
}

/// The "in my group" rule: how a sighting relates to the local player's group.
///
/// Every case except [`Outside`](Membership::Outside) counts for group filters. Only
/// [`Member`](Membership::Member) may borrow the roster's server, class, level, gear
/// score and combat power.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Membership<'a> {
    /// Not the local character, and no roster member carries this name.
    Outside,
    /// The local character with no roster entry verified as theirs: solo, before a
    /// roster arrives, or on a roster that cannot be matched to them. You are always in
    /// your own group.
    Own,
    /// A roster member carries this name, but nothing shows it is this character: the
    /// roster has no server for it, the sighting's server differs, several roster
    /// members share the name, the name is on more than one entity, or the entity was
    /// spawned.
    Namesake,
    /// Exactly one roster member has this name and server. A name-only sighting
    /// qualifies when it is the sole bearer of the name, and takes the member's server.
    Member(&'a GroupMember),
}

impl<'a> Membership<'a> {
    /// Whether the player counts as part of the local group.
    pub fn counts(&self) -> bool {
        !matches!(self, Membership::Outside)
    }
    /// The roster member whose values this player may borrow.
    pub fn member(&self) -> Option<&'a GroupMember> {
        match self {
            Membership::Member(member) => Some(member),
            _ => None,
        }
    }
}

impl<'a> Sighting<'a> {
    pub fn membership(&self) -> Membership<'a> {
        let unverified = if self.local {
            Membership::Own
        } else {
            Membership::Namesake
        };
        let Some(name) = self
            .name
            .filter(|name| self.roster.iter().any(|member| member.name == *name))
        else {
            return if self.local {
                Membership::Own
            } else {
                Membership::Outside
            };
        };
        // Name-only records omit the server. The roster may vouch for it only while
        // both sides have exactly one such name; a departure or a later collision
        // revokes it, because nothing here is stored.
        if self.server_id.is_none() && (self.spawned || self.shares_name) {
            return unverified;
        }
        let mut matches = self.roster.iter().filter(|member| {
            member.name == name
                && self
                    .server_id
                    .is_none_or(|server| member.server_id == Some(server))
        });
        match (matches.next(), matches.next()) {
            (Some(member), None) if member.server_id.is_some() => Membership::Member(member),
            _ => unverified,
        }
    }
}

/// A skill the player was seen using, as evidence of their class.
#[derive(Clone, Copy, Debug)]
pub struct SkillUse {
    pub skill: u32,
    /// Outgoing damage. Recipient-triggered effects can carry another class's skill ID,
    /// so only attacks may correct a class that is already known.
    pub attack: bool,
}

/// One player, joined. `None` always means "not observed", never zero.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlayerRow {
    pub name: Option<String>,
    /// Observed with the name, or taken from the verified roster member.
    pub server_id: Option<u16>,
    pub class: Option<String>,
    pub level: Option<u32>,
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
    pub local: bool,
    /// [`Membership::counts`] for this player.
    pub in_group: bool,
}

/// What a caller kept from a player's previous row, borrowed.
#[derive(Clone, Copy, Debug, Default)]
pub struct Held<'a> {
    pub name: Option<&'a str>,
    pub server_id: Option<u16>,
    pub class: Option<&'a str>,
    pub level: Option<u32>,
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
}

/// Recorded fights label a player without an observed name this way. Character names
/// are alphanumeric, so no real name collides with it.
fn placeholder(id: u32) -> String {
    format!("Player #{id}")
}

impl<'a> Held<'a> {
    /// The values a recorded report player holds.
    pub fn of(actor: &'a ActorInfo) -> Self {
        Self {
            name: (actor.name != placeholder(actor.id)).then_some(actor.name.as_str()),
            server_id: actor.server_id,
            class: actor.class.as_deref(),
            level: actor.level,
            gear_score: actor.gear_score,
            combat_power: actor.combat_power,
        }
    }
}

impl PlayerRow {
    pub fn name_known(&self) -> bool {
        self.name.is_some()
    }
    pub fn held(&self) -> Held<'_> {
        Held {
            name: self.name.as_deref(),
            server_id: self.server_id,
            class: self.class.as_deref(),
            level: self.level,
            gear_score: self.gear_score,
            combat_power: self.combat_power,
        }
    }
    /// The report player recorded for entity `id` in the native log format.
    pub fn into_actor(self, id: u32) -> ActorInfo {
        ActorInfo {
            id,
            name: self.name.unwrap_or_else(|| placeholder(id)),
            class: self.class,
            local: self.local,
            party: self.in_group,
            server_id: self.server_id,
            level: self.level,
            gear_score: self.gear_score,
            combat_power: self.combat_power,
        }
    }
}

/// The last gear score and combat power observed for one server and name.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Remembered {
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
}

#[derive(Clone, Copy, Default)]
struct Entry {
    values: Remembered,
    observed: u64,
}

/// Bounds memory while allowing newly observed characters to replace old entries.
const CAPACITY: usize = 1024;

/// What can be remembered at all: a verified server, an observed character name (never
/// a "Player #id" placeholder) and at least one plausible value.
fn storable(
    server: u16,
    name: &str,
    gear_score: Option<u32>,
    combat_power: Option<u64>,
) -> Option<Remembered> {
    let gear_score = gear_score.filter(|score| (1..=1_000_000).contains(score));
    let combat_power = combat_power.filter(|power| *power > 0);
    let named = name.chars().count() >= 2 && name.chars().all(char::is_alphanumeric);
    ((1000..=3000).contains(&server) && named && (gear_score.is_some() || combat_power.is_some()))
        .then_some(Remembered {
            gear_score,
            combat_power,
        })
}

/// The player identity join and the values it remembers between sightings.
#[derive(Clone, Default)]
pub struct Players {
    remembered: BTreeMap<u16, BTreeMap<String, Entry>>,
    len: usize,
    clock: u64,
}

impl Players {
    /// Rebuilds what was remembered from the app's own recorded fights, newest first.
    /// Recovered values precede every observation of this session.
    pub fn recovered(logs: impl IntoIterator<Item = CombatLog>) -> Self {
        let mut players = Self::default();
        for log in logs {
            players.seed(&log);
        }
        for entry in players.remembered.values_mut().flat_map(BTreeMap::values_mut) {
            entry.observed = 0;
        }
        players.clock = 0;
        players
    }

    fn seed(&mut self, log: &CombatLog) {
        // Prefer your character within each recording when recovering a bounded store.
        let mut actors: Vec<_> = log.actors.values().collect();
        actors.sort_by_key(|actor| !actor.local);
        for actor in actors {
            let Some(server) = actor.server_id else {
                continue;
            };
            let newer = self.remembered(server, &actor.name);
            // Logs are newest first; older logs must not evict recovered values.
            if self.len >= CAPACITY && newer.is_none() {
                continue;
            }
            let newer = newer.unwrap_or_default();
            self.remember(
                server,
                &actor.name,
                newer.gear_score.or(actor.gear_score),
                newer.combat_power.or(actor.combat_power),
            );
        }
    }

    /// The values remembered for this exact server and name.
    pub fn remembered(&self, server: u16, name: &str) -> Option<Remembered> {
        Some(self.remembered.get(&server)?.get(name)?.values)
    }

    /// What [`remembered`](Self::remembered) would return once these values are
    /// remembered, without storing them.
    fn refreshed(
        &self,
        server: u16,
        name: &str,
        gear_score: Option<u32>,
        combat_power: Option<u64>,
    ) -> Option<Remembered> {
        let known = self.remembered(server, name);
        let Some(fresh) = storable(server, name, gear_score, combat_power) else {
            return known;
        };
        let known = known.unwrap_or_default();
        Some(Remembered {
            gear_score: fresh.gear_score.or(known.gear_score),
            combat_power: fresh.combat_power.or(known.combat_power),
        })
    }

    fn remember(
        &mut self,
        server: u16,
        name: &str,
        gear_score: Option<u32>,
        combat_power: Option<u64>,
    ) {
        let Some(fresh) = storable(server, name, gear_score, combat_power) else {
            return;
        };
        if self.remembered(server, name).is_none() {
            if self.len >= CAPACITY {
                let oldest = self
                    .remembered
                    .iter()
                    .flat_map(|(server, names)| {
                        names.iter().map(move |(name, entry)| (entry.observed, *server, name))
                    })
                    .min_by_key(|oldest| oldest.0)
                    .map(|(_, server, name)| (server, name.clone()));
                if let Some((server, name)) = oldest {
                    if let Some(names) = self.remembered.get_mut(&server) {
                        names.remove(&name);
                        self.len -= 1;
                    }
                }
            }
            self.len += 1;
        }
        self.clock += 1;
        let entry = self
            .remembered
            .entry(server)
            .or_default()
            .entry(name.to_owned())
            .or_default();
        entry.values.gear_score = fresh.gear_score.or(entry.values.gear_score);
        entry.values.combat_power = fresh.combat_power.or(entry.values.combat_power);
        entry.observed = self.clock;
    }

    /// Remembers every roster member's values on receipt. Lobby rosters often precede
    /// all combat, and a departure or roster clear would otherwise discard them.
    pub fn remember_roster(&mut self, roster: &[GroupMember]) {
        for member in roster {
            if let Some(server) = member.server_id {
                self.remember(server, &member.name, member.gear_score, member.combat_power);
            }
        }
    }

    /// The precedence in the module documentation, for one character.
    fn rated(
        &self,
        name: Option<&str>,
        server: Option<u16>,
        member: Option<&GroupMember>,
        own_power: Option<u64>,
        held: (Option<u32>, Option<u64>),
    ) -> (Option<u32>, Option<u64>) {
        let (mut gear_score, mut combat_power) =
            member.map_or(held, |member| (member.gear_score, member.combat_power));
        if let (Some(server), Some(name)) = (server, name) {
            let remembered = match member {
                Some(member) => {
                    self.refreshed(server, name, member.gear_score, member.combat_power)
                }
                None => self.remembered(server, name),
            };
            if let Some(remembered) = remembered {
                gear_score = remembered.gear_score.or(gear_score);
                combat_power = remembered.combat_power.or(combat_power);
            }
        }
        // A direct self update supersedes roster and remembered values, including decreases.
        (gear_score, own_power.or(combat_power))
    }

    fn resolve<'a>(
        &self,
        seen: &Sighting<'a>,
        held: Option<Held<'_>>,
        skill: Option<SkillUse>,
    ) -> (PlayerRow, Option<&'a GroupMember>) {
        let membership = seen.membership();
        let member = membership.member();
        let server_id = seen.server_id.or(member.and_then(|member| member.server_id));
        let held = held.unwrap_or_default();
        // Held gear score and combat power belong to one character.
        let kept = if held.name == seen.name && held.server_id == server_id {
            (held.gear_score, held.combat_power)
        } else {
            (None, None)
        };
        // Class and level describe whoever this entity was last seen as; attacks and
        // the roster correct them.
        let mut class = held.class;
        if let Some(used) =
            skill.filter(|used| player_skill(used.skill) && (used.attack || class.is_none()))
        {
            class = Some(class_name(used.skill));
        }
        let mut level = held.level;
        if let Some(member) = member {
            class = member.class.as_deref().or(class);
            level = Some(member.level);
        }
        let (gear_score, combat_power) =
            self.rated(seen.name, server_id, member, seen.own_power, kept);
        let row = PlayerRow {
            name: seen.name.map(str::to_owned),
            server_id,
            class: class.map(str::to_owned),
            level,
            gear_score,
            combat_power,
            local: seen.local,
            in_group: membership.counts(),
        };
        (row, member)
    }

    /// The row for a sighting, read without remembering anything. Status polls use
    /// this, so how often a window asks never changes what a report shows.
    pub fn row(&self, seen: &Sighting<'_>) -> PlayerRow {
        self.resolve(seen, None, None).0
    }

    /// The row for a player taking part in a fight, remembering what the sighting
    /// carries. `held` is that player's previous row in the same fight, and `skill`
    /// the skill they were just seen using.
    pub fn observe(
        &mut self,
        seen: &Sighting<'_>,
        held: Option<Held<'_>>,
        skill: Option<SkillUse>,
    ) -> PlayerRow {
        let (row, member) = self.resolve(seen, held, skill);
        if let (Some(server), Some(name)) = (row.server_id, row.name.as_deref()) {
            if let Some(member) = member {
                self.remember(server, name, member.gear_score, member.combat_power);
            }
            if let Some(power) = seen.own_power {
                self.remember(server, name, row.gear_score, Some(power));
            }
        }
        row
    }

    /// The roster with each member's gear score and combat power following the same
    /// precedence as their player row. `local` is the local character's sighting; its
    /// own update applies only to the roster member verified as that character. Every
    /// other roster field is passed through as observed.
    pub fn roster(&self, roster: &[GroupMember], local: Option<&Sighting<'_>>) -> Vec<GroupMember> {
        let own = local.and_then(|seen| Some((seen.membership().member()?, seen.own_power?)));
        roster
            .iter()
            .map(|member| {
                let own_power = own
                    .filter(|(own, _)| *own == member)
                    .map(|(_, power)| power);
                let (gear_score, combat_power) = self.rated(
                    Some(&member.name),
                    member.server_id,
                    Some(member),
                    own_power,
                    (None, None),
                );
                GroupMember {
                    gear_score,
                    combat_power,
                    ..member.clone()
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(name: &str, server: Option<u16>) -> GroupMember {
        GroupMember {
            character_id: None,
            slot: None,
            group_index: None,
            ready_observed_ms: None,
            name: name.into(),
            server_id: server,
            class: None,
            level: 45,
            gear_score: None,
            combat_power: None,
            leader: None,
            ready: None,
        }
    }
    fn rated(name: &str, server: u16, gear_score: u32, combat_power: u64) -> GroupMember {
        GroupMember {
            gear_score: Some(gear_score),
            combat_power: Some(combat_power),
            ..member(name, Some(server))
        }
    }
    fn seen<'a>(name: &'a str, server: Option<u16>, roster: &'a [GroupMember]) -> Sighting<'a> {
        Sighting {
            name: Some(name),
            server_id: server,
            roster,
            ..Sighting::default()
        }
    }
    fn power(row: &PlayerRow) -> (Option<u32>, Option<u64>) {
        (row.gear_score, row.combat_power)
    }

    #[test]
    fn membership_names_each_way_a_player_relates_to_the_group() {
        let roster = [rated("Aahz", 1304, 2700, 150_000), member("Legacy", None)];
        let stranger = seen("Stranger", Some(1304), &roster);
        assert_eq!(stranger.membership(), Membership::Outside);
        assert!(!stranger.membership().counts());
        assert_eq!(Sighting { roster: &roster, ..Sighting::default() }.membership(), Membership::Outside);

        // You are in your own group solo, unnamed, or on a roster that cannot be matched.
        for own in [
            Sighting { local: true, ..Sighting::default() },
            Sighting { local: true, ..seen("Solo", Some(1304), &roster) },
            Sighting { local: true, ..seen("Aahz", Some(2301), &roster) },
        ] {
            assert_eq!(own.membership(), Membership::Own);
            assert!(own.membership().counts());
        }

        // The observed server, or being the only bearer of the name, verifies a member.
        for verified in [seen("Aahz", Some(1304), &roster), seen("Aahz", None, &roster)] {
            assert_eq!(verified.membership(), Membership::Member(&roster[0]));
        }
        let local = Sighting { local: true, ..seen("Aahz", None, &roster) };
        assert_eq!(local.membership().member(), Some(&roster[0]));

        // A matching name that verifies no one still counts, and borrows nothing.
        for namesake in [
            seen("Legacy", None, &roster),
            Sighting { shares_name: true, ..seen("Aahz", None, &roster) },
            Sighting { spawned: true, ..seen("Aahz", None, &roster) },
        ] {
            assert_eq!(namesake.membership(), Membership::Namesake);
            assert!(namesake.membership().counts());
            assert_eq!(namesake.membership().member(), None);
        }
        // An observed server settles what a shared name cannot.
        let settled = Sighting { shares_name: true, spawned: true, ..seen("Aahz", Some(1304), &roster) };
        assert_eq!(settled.membership(), Membership::Member(&roster[0]));
    }

    #[test]
    fn ambiguous_roster_names_need_an_observed_server() {
        let roster = [rated("Twin", 1304, 2700, 150_000), rated("Twin", 2301, 2600, 140_000)];
        let players = Players::default();
        let name_only = seen("Twin", None, &roster);
        assert_eq!(name_only.membership(), Membership::Namesake);
        let row = players.row(&name_only);
        assert_eq!((row.server_id, power(&row), row.in_group), (None, (None, None), true));
        for member in &roster {
            let row = players.row(&seen("Twin", member.server_id, &roster));
            assert_eq!(row.server_id, member.server_id);
            assert_eq!(power(&row), (member.gear_score, member.combat_power));
        }
    }

    /// The two former predicates disagree here: by name this player is in the group,
    /// by identity they are not. The party filter keeps counting them; see the report.
    #[test]
    fn a_cross_server_namesake_counts_for_the_group_filter_but_borrows_nothing() {
        let roster = [rated("Aahz", 1304, 2700, 150_000)];
        let mut players = Players::default();
        players.remember_roster(&roster);
        let namesake = seen("Aahz", Some(1305), &roster);
        assert_eq!(namesake.membership(), Membership::Namesake);
        let row = players.observe(&namesake, None, None);
        assert!(row.in_group);
        assert_eq!((row.server_id, row.level, power(&row)), (Some(1305), None, (None, None)));
        assert_eq!(players.remembered(1305, "Aahz"), None);
    }

    #[test]
    fn a_name_only_member_takes_the_rosters_identity_only_while_it_vouches_for_them() {
        let roster = [GroupMember { class: Some("Cleric".into()), ..rated("Aahz", 1304, 2700, 150_000) }];
        let mut players = Players::default();
        let joined = players.observe(&seen("Aahz", None, &roster), None, None);
        assert_eq!(joined.server_id, Some(1304));
        assert_eq!((joined.class.as_deref(), joined.level), (Some("Cleric"), Some(45)));
        assert_eq!(power(&joined), (Some(2700), Some(150_000)));
        // Without the roster nothing ties this entity to that server any more, so the
        // values it held are another character's as far as anyone can tell.
        let left = players.observe(&seen("Aahz", None, &[]), Some(joined.held()), None);
        assert_eq!((left.server_id, power(&left), left.in_group), (None, (None, None), false));
        assert_eq!((left.class.as_deref(), left.level), (Some("Cleric"), Some(45)));
    }

    #[test]
    fn the_current_roster_refreshes_what_is_remembered_and_is_filled_by_it() {
        let mut players = Players::default();
        let first = [rated("Aahz", 1304, 2700, 150_000)];
        assert_eq!(power(&players.observe(&seen("Aahz", Some(1304), &first), None, None)), (Some(2700), Some(150_000)));
        // A newer roster wins over the remembered value, upward or downward.
        let lower = [rated("Aahz", 1304, 2650, 140_000)];
        assert_eq!(power(&players.observe(&seen("Aahz", Some(1304), &lower), None, None)), (Some(2650), Some(140_000)));
        assert_eq!(players.remembered(1304, "Aahz"), Some(Remembered { gear_score: Some(2650), combat_power: Some(140_000) }));
        // A roster that omits a value does not erase it.
        let partial = [GroupMember { gear_score: Some(2660), ..member("Aahz", Some(1304)) }];
        assert_eq!(power(&players.observe(&seen("Aahz", Some(1304), &partial), None, None)), (Some(2660), Some(140_000)));
    }

    #[test]
    fn roster_values_are_remembered_on_receipt_before_any_row_is_asked_for() {
        let mut players = Players::default();
        players.remember_roster(&[rated("Aahz", 1304, 2700, 150_000), member("Legacy", None)]);
        // The lobby roster is gone by the first hit.
        let row = players.observe(&seen("Aahz", Some(1304), &[]), None, None);
        assert_eq!(power(&row), (Some(2700), Some(150_000)));
        assert!(!row.in_group);
    }

    #[test]
    fn values_follow_a_player_by_verified_server_and_name_after_they_leave() {
        let roster = [rated("Aahz", 1304, 2700, 72_079), rated("Tananda", 2301, 2600, 71_687)];
        let mut players = Players::default();
        for member in &roster {
            players.observe(&seen(&member.name, member.server_id, &roster), None, None);
        }
        // A later fight after leaving: no roster, and no row held from the old fight.
        for member in &roster {
            let row = players.observe(&seen(&member.name, member.server_id, &[]), None, None);
            assert_eq!(power(&row), (member.gear_score, member.combat_power));
            assert_eq!((row.in_group, row.level), (false, None));
        }
        // The same name on another server, a stranger, an unknown server and an
        // unnamed entity are other characters.
        for other in [
            seen("Aahz", Some(1305), &[]),
            seen("Stranger", Some(1304), &[]),
            seen("Aahz", None, &[]),
            Sighting { server_id: Some(1304), ..Sighting::default() },
        ] {
            assert_eq!(power(&players.observe(&other, None, None)), (None, None));
        }
    }

    #[test]
    fn the_own_update_outranks_roster_and_remembered_values_including_decreases() {
        let roster = [rated("Aahz", 1304, 2752, 127_375)];
        let mut players = Players::default();
        let local = Sighting { local: true, ..seen("Aahz", Some(1304), &roster) };
        let mut row = players.observe(&local, None, None);
        assert_eq!(row.combat_power, Some(127_375));
        // Removing and re-equipping an item, with the roster still showing the old value.
        for own in [145_988, 164_343, 145_988] {
            let updated = Sighting { own_power: Some(own), ..local };
            row = players.observe(&updated, Some(row.held()), None);
            assert_eq!(power(&row), (Some(2752), Some(own)));
            assert_eq!(players.remembered(1304, "Aahz").unwrap().combat_power, Some(own));
        }
        // It applies solo as well, and stays remembered once the update is gone.
        let solo = Sighting { local: true, own_power: Some(150_000), ..seen("Aahz", Some(1304), &[]) };
        assert_eq!(players.observe(&solo, None, None).combat_power, Some(150_000));
        let later = Sighting { local: true, ..seen("Aahz", Some(1304), &[]) };
        assert_eq!(power(&players.observe(&later, None, None)), (Some(2752), Some(150_000)));
    }

    #[test]
    fn a_new_name_or_server_drops_held_values() {
        let mut players = Players::default();
        // Without a server nothing can be remembered: only the held row carries the value.
        let unverified = Sighting { local: true, own_power: Some(164_343), ..seen("Aahz", None, &[]) };
        let row = players.observe(&unverified, None, Some(SkillUse { skill: 11_010_000, attack: true }));
        assert_eq!(row.combat_power, Some(164_343));
        let lapsed = Sighting { local: true, ..seen("Aahz", None, &[]) };
        assert_eq!(players.observe(&lapsed, Some(row.held()), None).combat_power, Some(164_343));
        assert_eq!(players.observe(&lapsed, None, None).combat_power, None);
        for changed in [
            Sighting { local: true, ..seen("Newname", None, &[]) },
            Sighting { local: true, ..seen("Aahz", Some(1304), &[]) },
            Sighting { local: true, ..Sighting::default() },
        ] {
            let next = players.observe(&changed, Some(row.held()), None);
            assert_eq!(power(&next), (None, None));
            // Class is evidence about the entity, corrected by its next attack or roster.
            assert_eq!(next.class.as_deref(), Some("Gladiator"));
        }
    }

    #[test]
    fn reading_a_row_never_changes_what_is_remembered() {
        let roster = [rated("Aahz", 1304, 2700, 150_000)];
        let players = Players::default();
        let local = Sighting { local: true, own_power: Some(164_343), ..seen("Aahz", Some(1304), &roster) };
        let row = players.row(&local);
        assert_eq!(power(&row), (Some(2700), Some(164_343)));
        assert_eq!((row.name_known(), row.local, row.in_group), (true, true, true));
        assert_eq!(players.remembered(1304, "Aahz"), None);
        // A read agrees with the row a fight records for the same sighting.
        assert_eq!(row, players.clone().observe(&local, None, None));
        let unnamed = players.row(&Sighting::default());
        assert_eq!((unnamed.name_known(), unnamed.local, unnamed.in_group), (false, false, false));
    }

    #[test]
    fn class_comes_from_the_roster_then_attacks_then_the_first_other_skill() {
        let mut players = Players::default();
        let nobody = seen("Aahz", Some(1304), &[]);
        let heal = |skill| Some(SkillUse { skill, attack: false });
        let attack = |skill| Some(SkillUse { skill, attack: true });
        let row = players.observe(&nobody, None, heal(17_010_000));
        assert_eq!(row.class.as_deref(), Some("Cleric"));
        // Another class's effect on them does not replace it; their own attack does.
        let row = players.observe(&nobody, Some(row.held()), heal(18_010_000));
        assert_eq!(row.class.as_deref(), Some("Cleric"));
        let row = players.observe(&nobody, Some(row.held()), attack(18_010_000));
        assert_eq!(row.class.as_deref(), Some("Chanter"));
        // Not a class skill: no evidence.
        let row = players.observe(&nobody, Some(row.held()), attack(2_900_001));
        assert_eq!(row.class.as_deref(), Some("Chanter"));
        let roster = [GroupMember { class: Some("Templar".into()), ..member("Aahz", Some(1304)) }];
        let row = players.observe(&seen("Aahz", Some(1304), &roster), Some(row.held()), attack(11_010_000));
        assert_eq!((row.class.as_deref(), row.level), (Some("Templar"), Some(45)));
        // A roster without a class keeps the attack's.
        let roster = [member("Aahz", Some(1304))];
        let row = players.observe(&seen("Aahz", Some(1304), &roster), None, attack(11_010_000));
        assert_eq!(row.class.as_deref(), Some("Gladiator"));
    }

    #[test]
    fn roster_rows_follow_the_same_precedence_as_player_rows() {
        let roster = [
            rated("Aahz", 1304, 2752, 127_375),
            member("Tananda", Some(2301)),
            GroupMember { ready: Some(true), leader: Some(true), ..member("Legacy", None) },
        ];
        let mut players = Players::default();
        players.remember_roster(&[rated("Tananda", 2301, 2600, 71_687)]);
        // Nothing to add: the roster is passed through.
        assert_eq!(Players::default().roster(&roster, None), roster);
        let local = Sighting { local: true, own_power: Some(145_988), ..seen("Aahz", None, &roster) };
        let rows = players.roster(&roster, Some(&local));
        // Your own update, including a decrease, and what was remembered for a member
        // whose roster entry carries no values.
        assert_eq!(power_of(&rows[0]), (Some(2752), Some(145_988)));
        assert_eq!(power_of(&rows[1]), (Some(2600), Some(71_687)));
        assert_eq!(rows[2], roster[2]);
        for (row, member) in rows.iter().zip(&roster) {
            assert_eq!(GroupMember { gear_score: member.gear_score, combat_power: member.combat_power, ..row.clone() }, *member);
        }
        // Each seat shows what that member's player row shows.
        assert_eq!(power(&players.row(&local)), power_of(&rows[0]));
        assert_eq!(power(&players.row(&seen("Tananda", Some(2301), &roster))), power_of(&rows[1]));
        // An own update that is not verified as a roster member's applies to no seat.
        let unmatched = Sighting { local: true, own_power: Some(1), ..seen("Aahz", Some(1305), &roster) };
        assert_eq!(power_of(&players.roster(&roster, Some(&unmatched))[0]), (Some(2752), Some(127_375)));
    }
    fn power_of(member: &GroupMember) -> (Option<u32>, Option<u64>) {
        (member.gear_score, member.combat_power)
    }

    #[test]
    fn report_players_record_a_placeholder_for_an_unobserved_name() {
        let row = PlayerRow {
            name: Some("Aahz".into()),
            server_id: Some(1304),
            class: Some("Gladiator".into()),
            level: Some(45),
            gear_score: Some(2700),
            combat_power: Some(150_000),
            local: true,
            in_group: true,
        };
        let actor = row.clone().into_actor(7);
        assert_eq!((actor.id, actor.name.as_str(), actor.local, actor.party), (7, "Aahz", true, true));
        let held = Held::of(&actor);
        assert_eq!((held.name, held.server_id, held.class, held.level), (Some("Aahz"), Some(1304), Some("Gladiator"), Some(45)));
        assert_eq!((held.gear_score, held.combat_power), (Some(2700), Some(150_000)));
        let unnamed = PlayerRow::default().into_actor(7);
        assert_eq!((unnamed.name.as_str(), unnamed.party), ("Player #7", false));
        assert_eq!(Held::of(&unnamed).name, None);
        // A recorded placeholder is not a name, so naming the player is a change of identity.
        let mut players = Players::default();
        let held = ActorInfo { combat_power: Some(1), ..unnamed };
        let named = players.observe(&seen("Aahz", None, &[]), Some(Held::of(&held)), None);
        assert_eq!(named.combat_power, None);
        let still_unnamed = players.observe(&Sighting::default(), Some(Held::of(&held)), None);
        assert_eq!(still_unnamed.combat_power, Some(1));
    }

    #[test]
    fn only_observed_names_on_verified_servers_with_plausible_values_are_remembered() {
        let mut players = Players::default();
        players.remember(1304, "Player #7", Some(2700), Some(150_000));
        players.remember(999, "Aahz", Some(2700), Some(150_000));
        players.remember(1304, "A", Some(2700), Some(150_000));
        players.remember(1304, "Aahz", Some(0), Some(0));
        players.remember(1304, "Aahz", Some(1_000_001), None);
        assert_eq!(players.len, 0);
        players.remember(1304, "Aahz", Some(1_000_001), Some(150_000));
        assert_eq!(players.remembered(1304, "Aahz"), Some(Remembered { gear_score: None, combat_power: Some(150_000) }));
    }

    #[test]
    fn a_full_memory_replaces_its_least_recently_observed_player() {
        let mut players = Players::default();
        for i in 0..CAPACITY {
            players.remember(1304, &format!("Player{i}"), None, Some(100));
        }
        players.remember(1304, "Player0", None, Some(200));
        players.remember(1304, "NewAlt", None, Some(300));
        assert_eq!(players.remembered(1304, "NewAlt").unwrap().combat_power, Some(300));
        assert_eq!(players.remembered(1304, "Player0").unwrap().combat_power, Some(200));
        assert!(players.remembered(1304, "Player1").is_none());
        assert_eq!(players.len, CAPACITY);
        assert_eq!(players.remembered.values().map(BTreeMap::len).sum::<usize>(), CAPACITY);

        // Recovering an older recording must not evict what this session observed.
        let mut older = CombatLog::default();
        older.actors.insert(1, ActorInfo {
            id: 1, name: "OldCharacter".into(), server_id: Some(1304), combat_power: Some(50), ..Default::default()
        });
        players.seed(&older);
        assert!(players.remembered(1304, "OldCharacter").is_none());
        assert_eq!(players.remembered(1304, "NewAlt").unwrap().combat_power, Some(300));
    }

    #[test]
    fn recovery_keeps_the_newest_recorded_value_and_fills_gaps_from_older_fights() {
        let fight = |gear_score, combat_power| {
            let mut log = CombatLog::default();
            log.actors.insert(331, ActorInfo {
                id: 331, name: "Aahz".into(), local: true, server_id: Some(1304), gear_score, combat_power, ..Default::default()
            });
            log.actors.insert(13, ActorInfo { id: 13, name: "Tananda".into(), server_id: Some(2301), combat_power: Some(71_687), ..Default::default() });
            log.actors.insert(9, ActorInfo { id: 9, name: "Player #9".into(), server_id: Some(1304), combat_power: Some(5), ..Default::default() });
            log.actors.insert(10, ActorInfo { id: 10, name: "Unverified".into(), combat_power: Some(5), ..Default::default() });
            log
        };
        // Newest first: its gear score wins, and the older fight supplies the missing CP.
        let mut players = Players::recovered([fight(Some(2399), None), fight(Some(2380), Some(127_375))]);
        assert_eq!(players.remembered(1304, "Aahz"), Some(Remembered { gear_score: Some(2399), combat_power: Some(127_375) }));
        // Every recorded player with a verified server and name is recovered, not only you.
        assert_eq!(players.row(&seen("Tananda", Some(2301), &[])).combat_power, Some(71_687));
        assert_eq!(players.len, 2);
        // Anything observed this session is newer than everything recovered.
        assert_eq!(players.clock, 0);
        let row = players.observe(&Sighting { local: true, ..seen("Aahz", Some(1304), &[]) }, None, None);
        assert_eq!(power(&row), (Some(2399), Some(127_375)));
        assert_eq!(power(&players.observe(&seen("Aahz", Some(1303), &[]), None, None)), (None, None));
    }
}
