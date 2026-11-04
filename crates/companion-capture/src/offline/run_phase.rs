//! Whether the player is inside an observed dungeon run, so the meter can show the party
//! room while a group prepares. Only the decoded dungeon state (`0x0061`) starts a run;
//! damage, readiness and the party title never do. A run lasts through pulls, resets,
//! wipes and idle gaps in its zone, and ends when the player leaves that zone or the
//! connection changes. A clear keeps the run until the player leaves, so the final
//! result stays on the meter.

/// The dungeon state value the game sends when a run is cleared.
const CLEARED: u64 = 3;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Run {
    dungeon: u32,
    id: String,
    /// The zone this run belongs to; leaving it ends the run.
    zone: Option<u32>,
    /// Our group dealt damage during the run, so its zone is the instance.
    engaged: bool,
    /// The zone was already corrected once (see `zone`).
    rebound: bool,
    cleared: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Nothing observed since the connection began: a run may already be under way.
    Unknown,
    /// A zone was observed without an active dungeon run.
    Outside,
    Running,
    /// Cleared, still in the dungeon.
    Cleared,
}

#[derive(Clone, Debug, Default)]
pub struct RunPhase {
    /// A zone or dungeon state was observed since the connection began.
    known: bool,
    zone: Option<u32>,
    run: Option<Run>,
}

impl RunPhase {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// `run_id` names the run when this state begins one.
    pub fn dungeon_state(&mut self, dungeon: u32, state: u64, run_id: &str) {
        self.known = true;
        if state == CLEARED {
            if let Some(run) = self.run.as_mut().filter(|run| run.dungeon == dungeon) {
                run.cleared = true;
            }
            return;
        }
        // Repeated states of the same uncleared dungeon (phases, wipes) continue its run.
        if self
            .run
            .as_ref()
            .is_some_and(|run| run.dungeon == dungeon && !run.cleared)
        {
            return;
        }
        self.run = Some(Run {
            dungeon,
            id: run_id.to_owned(),
            zone: self.zone,
            engaged: false,
            rebound: false,
            cleared: false,
        });
    }

    pub fn zone(&mut self, zone: u32) {
        self.known = true;
        if self.zone.replace(zone) == Some(zone) {
            return;
        }
        let Some(run) = self.run.as_mut() else {
            return;
        };
        if run.zone == Some(zone) {
            return;
        }
        // The instance's zone may load just after its dungeon state. Before our group
        // fights there, the first zone change is taken as that load rather than an exit.
        if !run.engaged && !run.cleared && !run.rebound {
            run.zone = Some(zone);
            run.rebound = true;
            return;
        }
        self.run = None;
    }

    /// Our group dealt damage: the current zone is the run's.
    pub fn engaged(&mut self) {
        if let Some(run) = self.run.as_mut() {
            if !run.engaged && run.zone.is_none() {
                run.zone = self.zone;
            }
            run.engaged = true;
        }
    }

    pub fn phase(&self) -> Phase {
        match &self.run {
            Some(run) if run.cleared => Phase::Cleared,
            Some(_) => Phase::Running,
            None if self.known => Phase::Outside,
            None => Phase::Unknown,
        }
    }

    pub fn status(&self) -> serde_json::Value {
        let phase = match self.phase() {
            Phase::Unknown => "unknown",
            Phase::Outside => "outside",
            Phase::Running => "running",
            Phase::Cleared => "cleared",
        };
        serde_json::json!({
            "phase": phase,
            "dungeon_id": self.run.as_ref().map(|run| run.dungeon),
            "run_id": self.run.as_ref().map(|run| run.id.clone()),
            "zone_id": self.zone,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_known_until_a_zone_or_dungeon_state_arrives() {
        let mut run = RunPhase::default();
        assert_eq!(run.phase(), Phase::Unknown);
        run.engaged();
        assert_eq!(run.phase(), Phase::Unknown);
        run.zone(1110);
        assert_eq!(run.phase(), Phase::Outside);
        run.reset();
        assert_eq!(run.phase(), Phase::Unknown);
        run.dungeon_state(600092, 1, "run-1");
        assert_eq!(run.phase(), Phase::Running);
    }

    #[test]
    fn a_run_survives_pulls_wipes_and_repeated_states_in_its_zone() {
        let mut run = RunPhase::default();
        run.zone(600092);
        run.dungeon_state(600092, 1, "run-1");
        run.engaged();
        for state in [2, 1, 5, 2] {
            run.dungeon_state(600092, state, "run-later");
        }
        run.zone(600092);
        assert_eq!(run.phase(), Phase::Running);
        assert_eq!(run.status()["run_id"], "run-1");
    }

    #[test]
    fn the_instance_zone_may_load_after_its_dungeon_state() {
        let mut run = RunPhase::default();
        run.zone(1110);
        run.dungeon_state(600092, 1, "run-1");
        run.zone(600092);
        assert_eq!(run.phase(), Phase::Running);
        run.engaged();
        run.zone(1110);
        assert_eq!(run.phase(), Phase::Outside);
    }

    #[test]
    fn leaving_an_engaged_run_ends_it_without_a_clear() {
        let mut run = RunPhase::default();
        run.zone(600092);
        run.dungeon_state(600092, 1, "run-1");
        run.engaged();
        run.zone(1110);
        assert_eq!(run.phase(), Phase::Outside);
        assert_eq!(run.status()["run_id"], serde_json::Value::Null);
    }

    #[test]
    fn a_clear_lasts_until_the_player_leaves_and_a_new_entry_is_a_new_run() {
        let mut run = RunPhase::default();
        run.zone(600092);
        run.dungeon_state(600092, 1, "run-1");
        run.dungeon_state(600092, 3, "");
        assert_eq!(run.phase(), Phase::Cleared);
        run.zone(1110);
        assert_eq!(run.phase(), Phase::Outside);
        run.zone(600092);
        run.dungeon_state(600092, 1, "run-2");
        assert_eq!(run.phase(), Phase::Running);
        assert_eq!(run.status()["run_id"], "run-2");
        // A clear of another dungeon never ends this one.
        run.dungeon_state(610062, 3, "");
        assert_eq!(run.phase(), Phase::Running);
    }

    #[test]
    fn another_dungeon_begins_its_own_run() {
        let mut run = RunPhase::default();
        run.zone(600092);
        run.dungeon_state(600092, 1, "run-1");
        run.dungeon_state(610062, 1, "run-2");
        assert_eq!(run.status()["dungeon_id"], 610062);
        assert_eq!(run.status()["run_id"], "run-2");
    }
}
