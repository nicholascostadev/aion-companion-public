//! The live encounter record and the versions its readers cache against.
//!
//! The log owns its events, its metadata and both versions, so the two cache rules
//! are kept by the type instead of by each caller:
//!
//! - `stream` names one append-only event history. Appending keeps it. Every other
//!   edit of the events (reset, replace, trim) takes a new one, and so does every new
//!   or copied log. A reader holding the first events of a stream therefore always
//!   holds a prefix of that stream's log.
//! - `revision` changes whenever something a rendered report shows changes without an
//!   appended event: a metadata edit made here, or [`EncounterLog::touch`] for report
//!   inputs owned elsewhere (entity observations, the catalogue).
//!
//! Durations are the encounter clock. They move on every tick, so the report cache
//! covers them with its freshness limit instead of a version.
//!
//! Reading goes through `Deref<Target = CombatLog>`. There is no `DerefMut`: every
//! write is one of the methods below.
use companion_core::combat::{ActorInfo, CombatEvent, CombatLog, TargetInfo};
use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicU64, Ordering},
};

/// A version is never reused in this process, so two logs never share one by accident.
fn stamp() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

pub(crate) struct EncounterLog {
    log: CombatLog,
    /// Capture-clock time of the first event; event times are relative to it.
    origin: Option<u64>,
    revision: u64,
    stream: u64,
}

/// What a reader copied: which history, how much of it, and which metadata.
/// Equal versions mean equal content, apart from the clock.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Version {
    revision: u64,
    stream: u64,
    events: usize,
}

/// The metadata a caller may edit in place. Identity, the clock, the end reason and
/// the events are not here.
pub(crate) struct Meta<'a> {
    pub label: &'a mut String,
    pub party_id: &'a mut Option<u32>,
    pub actors: &'a mut BTreeMap<u32, ActorInfo>,
    pub targets: &'a mut BTreeMap<u32, TargetInfo>,
    pub warnings: &'a mut Vec<String>,
}

/// A reader's update: the whole metadata and only the events after the prefix the
/// reader already holds.
pub(crate) struct Tail {
    log: CombatLog,
    prefix_len: usize,
}

impl Default for EncounterLog {
    fn default() -> Self {
        Self {
            log: CombatLog::default(),
            origin: None,
            revision: stamp(),
            stream: stamp(),
        }
    }
}

/// A copy is a separate history: it can append different events than the original,
/// so it takes its own versions.
impl Clone for EncounterLog {
    fn clone(&self) -> Self {
        Self {
            log: self.log.clone(),
            origin: self.origin,
            revision: stamp(),
            stream: stamp(),
        }
    }
}

impl std::ops::Deref for EncounterLog {
    type Target = CombatLog;
    fn deref(&self) -> &CombatLog {
        &self.log
    }
}

impl EncounterLog {
    pub fn origin(&self) -> Option<u64> {
        self.origin
    }
    /// Time since the encounter began; zero before it has.
    pub fn elapsed(&self, now: u64) -> u64 {
        now.saturating_sub(self.origin.unwrap_or(now))
    }
    pub fn version(&self) -> Version {
        Version {
            revision: self.revision,
            stream: self.stream,
            events: self.log.events.len(),
        }
    }

    /// Appends one event. The only event edit that keeps the stream.
    pub fn push(&mut self, event: CombatEvent) {
        self.log.events.push(event);
    }

    /// Replaces the whole encounter, events and clock origin together.
    pub fn replace(&mut self, log: CombatLog, origin: Option<u64>) {
        self.log = log;
        self.origin = origin;
        self.stream = stamp();
    }
    /// Back to no encounter.
    pub fn reset(&mut self) {
        self.replace(CombatLog::default(), None);
    }
    /// Removes the events `keep` rejects.
    pub fn retain_events(&mut self, keep: impl FnMut(&CombatEvent) -> bool) {
        self.log.events.retain(keep);
        self.stream = stamp();
    }

    /// Mutable metadata. Taking it counts as a change to the rendered report.
    pub fn meta(&mut self) -> Meta<'_> {
        self.revision = stamp();
        // Every field is named so a new `CombatLog` field has to be placed here.
        let CombatLog {
            schema_version: _,
            id: _,
            label,
            started_ms: _,
            duration_ms: _,
            end_reason: _,
            zone_id: _,
            run_id: _,
            party_id,
            actors,
            targets,
            events: _,
            warnings,
        } = &mut self.log;
        Meta {
            label,
            party_id,
            actors,
            targets,
            warnings,
        }
    }
    /// Finishes the encounter with its final duration.
    pub fn end(&mut self, reason: &str, duration_ms: u64) {
        self.log.end_reason = Some(reason.into());
        self.log.duration_ms = duration_ms;
        self.revision = stamp();
    }
    /// Something a report shows changed outside the log.
    pub fn touch(&mut self) {
        self.revision = stamp();
    }

    /// Moves the encounter clock. Not a version change; see the module comment.
    pub fn set_duration(&mut self, duration_ms: u64) {
        self.log.duration_ms = duration_ms;
    }

    /// A complete copy, for saving and for explicit inspection.
    pub fn snapshot(&self) -> CombatLog {
        self.log.clone()
    }
    /// How many of the events `held` describes are still the start of this log.
    /// Zero as soon as the history was edited, replaced or belongs to another log.
    pub fn prefix_len(&self, held: Option<&Version>) -> usize {
        held.filter(|held| held.stream == self.stream && held.events <= self.log.events.len())
            .map_or(0, |held| held.events)
    }
    /// The copy a reader holding `held` needs to be current. After a reader's first
    /// copy only the appended events are cloned.
    pub fn tail(&self, held: Option<&Version>) -> Tail {
        let prefix_len = self.prefix_len(held);
        // Intentionally enumerate metadata: adding a `CombatLog` field must update
        // this copy too, and the compiler enforces that requirement.
        let log = CombatLog {
            schema_version: self.log.schema_version,
            id: self.log.id.clone(),
            label: self.log.label.clone(),
            started_ms: self.log.started_ms,
            duration_ms: self.log.duration_ms,
            end_reason: self.log.end_reason.clone(),
            zone_id: self.log.zone_id,
            run_id: self.log.run_id.clone(),
            party_id: self.log.party_id,
            actors: self.log.actors.clone(),
            targets: self.log.targets.clone(),
            events: self.log.events[prefix_len..].to_vec(),
            warnings: self.log.warnings.clone(),
        };
        Tail { log, prefix_len }
    }
}

impl Tail {
    /// Events the reader is expected to hold already.
    #[cfg(test)]
    pub fn prefix_len(&self) -> usize {
        self.prefix_len
    }
    /// Events copied for this update.
    #[cfg(test)]
    pub fn appended(&self) -> usize {
        self.log.events.len()
    }
    /// Presents the encounter with another clock reading and end reason than the log
    /// records, as reports do while a confirmed kill waits out its grace period.
    pub fn shown_as(mut self, duration_ms: u64, end_reason: Option<String>) -> Self {
        self.log.duration_ms = duration_ms;
        self.log.end_reason = end_reason;
        self
    }
    /// Completes the copy with the events the reader holds. `held` must be the copy
    /// whose version this tail was prepared against.
    pub fn onto(self, held: Option<CombatLog>) -> CombatLog {
        let mut log = self.log;
        if self.prefix_len > 0 {
            let mut events = held
                .expect("A tail with a prefix is prepared against the reader's copy")
                .events;
            debug_assert_eq!(events.len(), self.prefix_len);
            events.append(&mut log.events);
            log.events = events;
        }
        log
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(at_ms: u64) -> CombatEvent {
        CombatEvent {
            at_ms,
            ..CombatEvent::new("damage")
        }
    }
    fn fight(id: &str, events: u64) -> CombatLog {
        CombatLog {
            id: id.into(),
            events: (0..events).map(event).collect(),
            ..Default::default()
        }
    }
    /// A reader's complete copy and the version it describes.
    fn read(log: &EncounterLog) -> (CombatLog, Version) {
        (log.tail(None).onto(None), log.version())
    }
    /// The reader catches up from `held`; the result must equal the log itself.
    fn catch_up(log: &EncounterLog, held: (CombatLog, Version)) -> usize {
        let tail = log.tail(Some(&held.1));
        let prefix_len = tail.prefix_len();
        let merged = tail.onto(Some(held.0));
        assert_eq!(merged.events, log.events);
        assert_eq!(merged.label, log.label);
        assert_eq!(merged.actors.len(), log.actors.len());
        prefix_len
    }

    #[test]
    fn appends_keep_the_prefix_and_copy_only_the_new_events() {
        let mut log = EncounterLog::default();
        log.replace(fight("a", 3), Some(0));
        let held = read(&log);
        log.push(event(10));
        log.push(event(11));
        assert_ne!(log.version(), held.1, "An append is a new version");
        assert_eq!(log.prefix_len(Some(&held.1)), 3);
        let tail = log.tail(Some(&held.1));
        assert_eq!((tail.prefix_len(), tail.appended()), (3, 2));
        assert_eq!(catch_up(&log, held), 3);
        // A reader that is already current copies no event at all.
        let held = read(&log);
        assert_eq!(log.version(), held.1);
        assert_eq!(log.tail(Some(&held.1)).appended(), 0);
    }

    #[test]
    fn every_other_event_edit_starts_a_new_history() {
        type Edit = fn(&mut EncounterLog);
        let edits: [(&str, Edit); 5] = [
            ("reset", |log| log.reset()),
            ("replace", |log| log.replace(fight("b", 3), Some(5))),
            // Same identity, same event count, different events.
            ("replace in place", |log| {
                let mut next = log.snapshot();
                next.events[0].amount = 999;
                log.replace(next, log.origin());
            }),
            ("trim", |log| log.retain_events(|event| event.at_ms < 2)),
            // A trim is never treated as an append, even when it removes nothing.
            ("trim nothing", |log| log.retain_events(|_| true)),
        ];
        for (name, edit) in edits {
            let mut log = EncounterLog::default();
            log.replace(fight("a", 3), Some(0));
            let held = read(&log);
            edit(&mut log);
            assert_ne!(log.version(), held.1, "{name}");
            assert_eq!(log.prefix_len(Some(&held.1)), 0, "{name}");
            // Appending afterwards cannot make the old copy a prefix again.
            log.push(event(20));
            log.push(event(21));
            log.push(event(22));
            assert_eq!(log.prefix_len(Some(&held.1)), 0, "{name} then append");
            assert_eq!(catch_up(&log, held), 0, "{name}");
        }
    }

    #[test]
    fn reset_and_replace_move_the_clock_origin_with_the_events() {
        let mut log = EncounterLog::default();
        assert_eq!((log.origin(), log.elapsed(700)), (None, 0));
        log.replace(fight("a", 1), Some(500));
        assert_eq!((log.origin(), log.elapsed(700)), (Some(500), 200));
        log.reset();
        assert_eq!((log.origin(), log.elapsed(700)), (None, 0));
        assert!(log.id.is_empty() && log.events.is_empty());
    }

    #[test]
    fn metadata_changes_are_new_versions_that_keep_the_prefix() {
        type Edit = fn(&mut EncounterLog);
        let edits: [(&str, Edit); 7] = [
            ("label", |log| *log.meta().label = "Boss".into()),
            ("party", |log| *log.meta().party_id = Some(7)),
            ("actor", |log| {
                log.meta().actors.insert(1, ActorInfo::default());
            }),
            ("target", |log| {
                log.meta().targets.insert(2, TargetInfo::default());
            }),
            ("warning", |log| log.meta().warnings.push("Gap".into())),
            ("end", |log| log.end("kill", 4000)),
            ("outside observation", |log| log.touch()),
        ];
        for (name, edit) in edits {
            let mut log = EncounterLog::default();
            log.replace(fight("a", 3), Some(0));
            let held = read(&log);
            edit(&mut log);
            assert_ne!(log.version(), held.1, "{name}");
            assert_eq!(log.prefix_len(Some(&held.1)), 3, "{name}");
            let tail = log.tail(Some(&held.1));
            assert_eq!(tail.appended(), 0, "{name} copies no event");
            assert_eq!(catch_up(&log, held), 3, "{name}");
        }
        let mut log = EncounterLog::default();
        log.end("kill", 4000);
        assert_eq!(log.end_reason.as_deref(), Some("kill"));
        assert_eq!(log.duration_ms, 4000);
    }

    #[test]
    fn the_clock_alone_is_not_a_version() {
        let mut log = EncounterLog::default();
        log.replace(fight("a", 3), Some(0));
        let held = read(&log);
        log.set_duration(1234);
        assert_eq!(log.version(), held.1);
        assert_eq!(log.duration_ms, 1234);
        // The next copy still carries the current clock.
        assert_eq!(log.tail(Some(&held.1)).onto(Some(held.0)).duration_ms, 1234);
    }

    #[test]
    fn a_copy_or_a_new_log_never_shares_a_history() {
        let mut original = EncounterLog::default();
        original.replace(fight("a", 3), Some(0));
        let held = read(&original);
        // Both append "the fourth event", but not the same one.
        let mut copy = original.clone();
        copy.push(event(40));
        original.push(event(41));
        assert_eq!(original.prefix_len(Some(&held.1)), 3);
        assert_eq!(copy.prefix_len(Some(&held.1)), 0);
        assert_ne!(copy.version(), original.version());
        assert_eq!(copy.origin(), original.origin());
        assert_eq!(catch_up(&copy, held), 0);
        // Two untouched logs are still different histories.
        let (first, second) = (EncounterLog::default(), EncounterLog::default());
        assert_ne!(first.version(), second.version());
        assert_eq!(second.prefix_len(Some(&first.version())), 0);
    }

    #[test]
    fn a_tail_can_be_presented_without_changing_the_log() {
        let mut log = EncounterLog::default();
        log.replace(fight("a", 2), Some(0));
        log.set_duration(9000);
        let version = log.version();
        let shown = log.tail(None).shown_as(5000, Some("kill".into())).onto(None);
        assert_eq!(shown.duration_ms, 5000);
        assert_eq!(shown.end_reason.as_deref(), Some("kill"));
        assert_eq!(shown.events, log.events);
        assert_eq!((log.duration_ms, log.end_reason.clone()), (9000, None));
        assert_eq!(log.version(), version);
    }

    #[test]
    fn snapshot_is_the_recorded_log_and_serialises_like_it() {
        let mut log = EncounterLog::default();
        log.replace(fight("a", 2), Some(0));
        log.meta().actors.insert(1, ActorInfo::default());
        log.end("kill", 3000);
        let snapshot = log.snapshot();
        // The durable format is `CombatLog` itself: the wrapper adds no field.
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap(),
            serde_json::to_value(&*log).unwrap()
        );
        let read_back: CombatLog =
            serde_json::from_value(serde_json::to_value(&snapshot).unwrap()).unwrap();
        assert_eq!(read_back.events, log.events);
        assert_eq!(read_back.end_reason.as_deref(), Some("kill"));
    }
}
