//! Bounded replay of the short interval before the local character is identified.
use super::*;

const MAX_EVENTS: usize = 2000;
const WINDOW_MS: u64 = 10000;

#[derive(Clone)]
pub(super) struct Startup {
    baseline: Box<Offline>,
    started: u64,
    count: usize,
    batches: Vec<Batch>,
    actor_ids: BTreeSet<u32>,
    pub(super) provisional_ids: BTreeSet<String>,
}

#[derive(Clone)]
struct Batch {
    at: u64,
    events: Vec<CombatEvent>,
    entities: Entities,
    settings: Value,
}

impl Offline {
    pub(super) fn track_startup(
        &mut self,
        events: &[CombatEvent],
        entities: &Entities,
        now: u64,
        epoch: u64,
    ) {
        if self.startup.as_ref().is_some_and(|s| {
            now.saturating_sub(s.started) > WINDOW_MS
                || s.count.saturating_add(events.len()) > MAX_EVENTS
        }) {
            self.startup = None;
        }
        if let Some(local) = entities.local {
            if let Some(startup) = self.startup.take() {
                self.replay_startup(startup, local, now, epoch);
            }
            return;
        }
        if self.startup.is_none()
            && self.origin.is_none()
            && events.len() <= MAX_EVENTS
            && events.iter().any(|e| {
                e.kind == "damage"
                    && e.amount > 0
                    && (player_skill(e.skill) || entities.known_player(e.source))
                    && !entities.spawned(e.source)
                    && !entities.monster(e.source)
                    && e.source != e.target
            })
        {
            self.startup = Some(Startup {
                baseline: Box::new(self.clone()),
                started: now,
                count: 0,
                batches: Vec::new(),
                actor_ids: BTreeSet::new(),
                provisional_ids: BTreeSet::new(),
            });
        }
        if !events.is_empty() {
            if let Some(startup) = &mut self.startup {
                startup.actor_ids.extend(self.log.actors.keys().copied());
                for event in events {
                    if entities.known_player(event.source)
                        || (player_skill(event.skill) && !entities.monster(event.source))
                    {
                        startup.actor_ids.insert(event.source);
                    }
                    if entities.known_player(event.target) {
                        startup.actor_ids.insert(event.target);
                    }
                }
                startup.count += events.len();
                startup.batches.push(Batch {
                    at: now,
                    events: events.to_vec(),
                    entities: entities.combat_context(events, startup.actor_ids.iter().copied()),
                    settings: self.settings.clone(),
                });
            }
        }
    }

    fn replay_startup(&mut self, startup: Startup, local: u32, now: u64, epoch: u64) {
        let mut restored = *startup.baseline;
        // Replay in memory first. Reliable writes are prepared only after the
        // corrected encounter set is complete, after any original queued writes.
        restored.root = None;
        restored.storage = None;
        restored.pending_saves.clear();
        restored.pending_checkpoint = None;
        let mut completed = BTreeMap::new();
        let remember =
            |state: &Offline, save: bool, completed: &mut BTreeMap<String, (CombatLog, bool)>| {
                if state.log.end_reason.is_some() && !state.log.events.is_empty() {
                    completed
                        .entry(state.log.id.clone())
                        .or_insert_with(|| (state.log.clone(), save));
                }
            };
        for batch in startup.batches {
            let mut context = batch.entities;
            // Only the now-verified self is added to historical eligibility.
            // Every other identity and party binding remains as observed then.
            context.local = Some(local);
            let save = batch.settings["auto_save"].as_bool().unwrap_or(true);
            restored.settings = batch.settings;
            restored.settings["auto_save"] = false.into();
            for event in batch.events {
                restored.tick(batch.at);
                remember(&restored, save, &mut completed);
                restored.receive(vec![event], &context, batch.at, epoch);
                remember(&restored, save, &mut completed);
            }
        }
        restored.tick(now);
        remember(
            &restored,
            self.settings["auto_save"].as_bool().unwrap_or(true),
            &mut completed,
        );
        let mut current = std::mem::take(self);
        restored.root = current.root.take();
        restored.storage = current.storage.take();
        restored.settings = current.settings;
        restored.catalogue = current.catalogue;
        restored.index = current.index;
        let replaced_provisional = !startup.provisional_ids.is_empty();
        let mut corrected_ids: BTreeSet<_> = completed.iter()
            .filter(|(_, (_, save))| *save)
            .map(|(id, _)| id.clone()).collect();
        if restored.log.end_reason.is_none() {
            corrected_ids.insert(restored.log.id.clone());
        }
        let mut archives = Vec::new();
        for id in startup.provisional_ids {
            restored.index.remove(&id);
            if !corrected_ids.contains(&id) {
                if let Some(root) = &restored.root {
                    archives.push(crate::storage::Write::archive(
                        root.join("logs").join(format!("{id}.json")),
                        root.join("logs/superseded").join(format!("{id}.json")),
                    ));
                }
            }
        }
        restored.pending_saves = current.pending_saves;
        restored.pending_checkpoint = current.pending_checkpoint;
        restored.alerts_engine = current.alerts_engine;
        restored.alert_updates = current.alert_updates;
        restored.notices = current.notices;
        restored.error = current.error;
        restored.persistence_error = current.persistence_error;
        restored.report_revision = current.report_revision.wrapping_add(1);
        restored.report_stream = current.report_stream.wrapping_add(1);
        let active = restored.log.clone();
        for (_, (log, save)) in completed {
            if save && restored.root.is_some() {
                restored.log = log;
                if let Err(error) = restored.save() {
                    restored.error = Some(error);
                }
            }
        }
        restored.log = active;
        if replaced_provisional {
            if let Some(root) = &restored.root {
                let path = root.join("index.json");
                archives.push(crate::storage::Write::json(path, restored.index.clone()));
                if restored.storage.is_some() {
                    // Older provisional writes and corrected saves are ahead
                    // of this transaction in the reliable filesystem queue.
                    restored.pending_saves.push_back(archives);
                } else {
                    for write in archives {
                        if let Err(error) = write.execute() {
                            restored.error = Some(error);
                            break;
                        }
                    }
                }
            }
        }
        restored.checkpoint();
        *self = restored;
    }
}
