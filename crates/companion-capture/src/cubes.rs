//! Ephemeral nearby observations, scoped to one captured world context.
use companion_core::wire::{
    cubes::{Observation, Point},
    entities::Entities,
    pets::Observation as PetObservation,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const MAX_CUBES: usize = 128;
const POSITION_FRESH_MS: u64 = 15_000;
const FACING_FRESH_MS: u64 = 10_000;
const SIGHTING_FRESH_MS: u64 = 90_000;
const HISTORY_MS: u64 = 300_000;
const TERMINAL_MS: u64 = 30_000;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Observed,
    Opening,
    Opened,
    OutOfView,
    Removed,
    Stale,
}
impl Status {
    fn actionable(self) -> bool {
        matches!(self, Self::Observed | Self::Opening)
    }
    fn terminal(self) -> bool {
        matches!(self, Self::Opened | Self::Removed)
    }
}

#[derive(Clone)]
struct Cube {
    id: u32,
    template: u32,
    position: Point,
    first_seen: u64,
    seen: u64,
    status: Status,
    opened_by_local: Option<bool>,
}

#[derive(Clone)]
struct Identity {
    entity: u32,
    name: Option<String>,
    server: Option<u16>,
}

#[derive(Clone, Default)]
pub(crate) struct Cubes {
    identity: Option<Identity>,
    zone: Option<u32>,
    position: Option<(Point, u64)>,
    /// Coordinate yaw from a validated own skill: 0 = +X, 90 = +Y, never velocity.
    facing: Option<(f64, u64)>,
    cubes: BTreeMap<u32, Cube>,
    context: u64,
    revision: u64,
    observed_total: u64,
    opened_total: u64,
}

fn supported(template: u32) -> bool {
    // Two observed Verteron variants and the experimental Altgard signature.
    // These are protocol facts; see the versioned evidence in the research note.
    matches!(template, 1200039 | 1200041 | 1301199)
}

impl Cubes {
    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    /// Shared captured world context for map finders. Static gathering locations do
    /// not become live observations merely because the character has a position.
    pub(crate) fn world_status(
        &self,
        running: bool,
        phase: &str,
        message: &str,
        capture_id: u64,
        now: u64,
    ) -> Value {
        let age = self.position.map(|(_, seen)| now.saturating_sub(seen));
        let last_position = self.last_position(running, now);
        let position = last_position.filter(|(_, seen)| now - seen <= POSITION_FRESH_MS);
        json!({"running":running,"phase":phase,"message":message,"now_ms":now,
            "session_id":format!("{capture_id}:{}",self.context),"revision":self.revision,
            "zone_id":if running { self.zone } else { None },
            "map_id":if running { super::pets::map_id(self.zone) } else { None },
            "position":position.map(|(p, seen)| json!({"x":p.x,"y":p.y,"z":p.z,"observed_ms":seen})),
            "last_position":last_position.map(|(p, seen)| json!({"x":p.x,"y":p.y,"z":p.z,"observed_ms":seen})),
            "facing":self.facing(running, now).map(|(degrees, seen)|json!({"degrees":degrees,"observed_ms":seen})),
            "position_age_ms":if running { age } else { None }})
    }

    fn last_position(&self, running: bool, now: u64) -> Option<(Point, u64)> {
        self.position
            .filter(|(_, seen)| running && self.identity.is_some() && *seen <= now)
    }

    fn facing(&self, running: bool, now: u64) -> Option<(f64, u64)> {
        self.facing.filter(|(_, seen)| {
            self.last_position(running, now).is_some()
                && *seen <= now
                && now - seen <= FACING_FRESH_MS
        })
    }

    /// Reuse the same validated facing observations as the pet map, without depending
    /// on a saved pet profile. Packet order within this batch is significant.
    pub(crate) fn observe_facing(
        &mut self,
        events: &[PetObservation],
        entities: &Entities,
        now: u64,
    ) {
        for event in events {
            match event {
                PetObservation::Zone { .. } => self.facing = None,
                PetObservation::Facing { entity, degrees }
                    if entities.local == Some(*entity)
                        && self
                            .identity
                            .as_ref()
                            .is_some_and(|own| own.entity == *entity)
                        && degrees.is_finite() =>
                {
                    self.facing = Some((degrees.rem_euclid(360.0), now));
                    self.revision = self.revision.saturating_add(1);
                }
                _ => {}
            }
        }
    }

    pub(crate) fn reset_connection(&mut self) {
        let context = self.context.saturating_add(1);
        let revision = self.revision.saturating_add(1);
        *self = Self {
            context,
            revision,
            ..Self::default()
        };
    }

    pub(crate) fn clear(&mut self) {
        self.cubes.clear();
        self.observed_total = 0;
        self.opened_total = 0;
        self.context = self.context.saturating_add(1);
        self.revision = self.revision.saturating_add(1);
    }

    fn prune(&mut self, now: u64) {
        let previous = self.cubes.len();
        self.cubes.retain(|_, cube| {
            now.saturating_sub(cube.seen)
                <= if cube.status.terminal() {
                    TERMINAL_MS
                } else {
                    HISTORY_MS
                }
        });
        if self.cubes.len() != previous {
            self.revision = self.revision.saturating_add(1);
        }
    }

    pub(crate) fn receive(&mut self, events: Vec<Observation>, entities: &Entities, now: u64) {
        let identity = entities
            .local
            .map(|entity| (entity, entities.name(entity), entities.local_server_id()));
        let changed = match (&self.identity, identity) {
            (Some(old), Some((entity, name, server))) => {
                old.entity != entity
                    || (old.name.is_some() && name.is_some() && old.name.as_deref() != name)
                    || (old.server.is_some() && server.is_some() && old.server != server)
            }
            (Some(_), None) => true,
            _ => false,
        };
        if changed {
            self.reset_connection();
        }
        self.identity = identity.map(|(entity, name, server)| Identity {
            entity,
            name: name.map(str::to_owned),
            server,
        });
        self.prune(now);
        for event in events {
            match event {
                Observation::Zone { id, position } => {
                    // Even the same map can be a different channel or instance.
                    self.clear();
                    self.zone = Some(id);
                    self.position = position.map(|point| (point, now));
                    self.facing = None;
                }
                Observation::Position { entity, position } => {
                    if entities.local == Some(entity) {
                        self.position = Some((position, now));
                        self.revision = self.revision.saturating_add(1);
                    }
                }
                Observation::Spawn {
                    entity,
                    template,
                    position,
                } => {
                    if !supported(template) {
                        // An ID reused for an unrelated object cannot retain a cube marker.
                        if self.cubes.remove(&entity).is_some() {
                            self.revision = self.revision.saturating_add(1);
                        }
                        continue;
                    }
                    let Some(_) = position.z else {
                        continue;
                    };
                    let previous = self.cubes.get(&entity);
                    let same = previous.filter(|old| {
                        old.template == template
                            && old.position == position
                            && !old.status.terminal()
                    });
                    let first_seen = same.map_or(now, |cube| cube.first_seen);
                    if same.is_none() {
                        self.observed_total = self.observed_total.saturating_add(1);
                    }
                    if self.cubes.len() >= MAX_CUBES && !self.cubes.contains_key(&entity) {
                        if let Some(oldest) =
                            self.cubes.values().min_by_key(|c| c.seen).map(|c| c.id)
                        {
                            self.cubes.remove(&oldest);
                        }
                    }
                    self.cubes.insert(
                        entity,
                        Cube {
                            id: entity,
                            template,
                            position,
                            first_seen,
                            seen: now,
                            status: Status::Observed,
                            opened_by_local: None,
                        },
                    );
                    self.revision = self.revision.saturating_add(1);
                }
                Observation::Remove { entity, reason } => {
                    let Some(cube) = self.cubes.get_mut(&entity) else {
                        continue;
                    };
                    if cube.status.terminal() {
                        continue;
                    }
                    cube.status = if reason == 1 {
                        Status::OutOfView
                    } else {
                        Status::Removed
                    };
                    cube.seen = now;
                    self.revision = self.revision.saturating_add(1);
                }
                Observation::Interaction {
                    entity,
                    actor,
                    done,
                } => {
                    let Some(cube) = self.cubes.get_mut(&entity) else {
                        continue;
                    };
                    if cube.status.terminal() {
                        continue;
                    }
                    cube.status = if done {
                        Status::Opened
                    } else {
                        Status::Opening
                    };
                    cube.opened_by_local = if done {
                        entities.local.map(|local| local == actor)
                    } else {
                        None
                    };
                    cube.seen = now;
                    if done {
                        self.opened_total = self.opened_total.saturating_add(1);
                    }
                    self.revision = self.revision.saturating_add(1);
                }
            }
        }
    }

    pub(crate) fn status(
        &self,
        running: bool,
        phase: &str,
        message: &str,
        capture_id: u64,
        now: u64,
    ) -> Value {
        let age = self.position.map(|(_, seen)| now.saturating_sub(seen));
        let last_position = self.last_position(running, now);
        let position = last_position.filter(|(_, seen)| now - seen <= POSITION_FRESH_MS);
        let mut rows = self.cubes.values().filter(|c| running && now.saturating_sub(c.seen) <= if c.status.terminal() { TERMINAL_MS } else { HISTORY_MS }).map(|c| {
            let status = if c.status.actionable() && now.saturating_sub(c.seen) > SIGHTING_FRESH_MS { Status::Stale } else { c.status };
            let measured = position.filter(|_| status.actionable());
            let distance = measured.map(|(p, _)| (c.position.x - p.x).hypot(c.position.y - p.y) / 100.);
            let height = measured.and_then(|(p, _)| p.z.zip(c.position.z).map(|(pz, cz)| (cz - pz) / 100.));
            let bearing = measured.and_then(|(p, _)| {
                let (dx, dy) = (c.position.x - p.x, c.position.y - p.y);
                (dx.hypot(dy) > 0.01).then(|| dx.atan2(-dy).to_degrees().rem_euclid(360.))
            });
            (status.actionable(), distance, c.seen, json!({"id":c.id,"template_id":c.template,"x":c.position.x,"y":c.position.y,"z":c.position.z,
                "first_seen_ms":c.first_seen,"last_seen_ms":c.seen,"status":status,"opened_by_local":c.opened_by_local,
                "distance_m":distance,"height_m":height,"bearing_deg":bearing}))
        }).collect::<Vec<_>>();
        rows.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| {
                    a.1.unwrap_or(f64::INFINITY)
                        .total_cmp(&b.1.unwrap_or(f64::INFINITY))
                })
                .then_with(|| b.2.cmp(&a.2))
        });
        json!({"running":running,"phase":phase,"message":message,"experimental":true,"now_ms":now,
            "session_id":format!("{capture_id}:{}",self.context),"revision":self.revision,
            "zone_id":if running { self.zone } else { None },"map_id":if running { super::pets::map_id(self.zone) } else { None },
            "position":position.map(|(p, seen)| json!({"x":p.x,"y":p.y,"z":p.z,"observed_ms":seen})),"position_age_ms":if running { age } else { None },
            "last_position":last_position.map(|(p, seen)| json!({"x":p.x,"y":p.y,"z":p.z,"observed_ms":seen})),
            "facing":self.facing(running, now).map(|(degrees, seen)|json!({"degrees":degrees,"observed_ms":seen})),
            "cubes":rows.into_iter().map(|row| row.3).collect::<Vec<_>>(),"observed_total":if running {self.observed_total} else {0},"opened_total":if running {self.opened_total} else {0}})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn point(x: f64, y: f64, z: Option<f64>) -> Point {
        Point { x, y, z }
    }
    fn spawn(id: u32) -> Observation {
        Observation::Spawn {
            entity: id,
            template: 1200039,
            position: point(300., -400., Some(1000.)),
        }
    }
    fn snapshot(c: &Cubes, now: u64) -> Value {
        c.status(true, "capturing", "", 1, now)
    }
    fn local() -> Entities {
        let mut e = Entities::default();
        e.local = Some(7);
        e
    }
    #[test]
    fn facing_uses_only_owned_validated_yaw_and_does_not_refresh_the_position() {
        let mut c = Cubes::default();
        let e = local();
        c.receive(
            vec![Observation::Position {
                entity: 7,
                position: point(10., 20., None),
            }],
            &e,
            1000,
        );
        c.observe_facing(
            &[
                PetObservation::Facing {
                    entity: 8,
                    degrees: 90.,
                },
                PetObservation::Facing {
                    entity: 7,
                    degrees: f64::NAN,
                },
            ],
            &e,
            2000,
        );
        assert!(snapshot(&c, 2000)["facing"].is_null());
        c.observe_facing(
            &[PetObservation::Facing {
                entity: 7,
                degrees: -90.,
            }],
            &e,
            2000,
        );
        let out = snapshot(&c, 2000);
        assert_eq!(out["now_ms"], 2000);
        assert_eq!(out["facing"], json!({"degrees":270.,"observed_ms":2000}));
        assert_eq!(out["position"]["observed_ms"], 1000);
        assert_eq!(out["last_position"], out["position"]);
        c.receive(
            vec![Observation::Position {
                entity: 7,
                position: point(30., 20., None),
            }],
            &e,
            3000,
        );
        assert_eq!(snapshot(&c, 3000)["facing"], out["facing"]);
        assert!(snapshot(&c, 12001)["facing"].is_null());
    }

    #[test]
    fn last_position_and_facing_have_independent_freshness_without_stale_measurements() {
        let mut c = Cubes::default();
        let e = local();
        c.receive(
            vec![
                spawn(1),
                Observation::Position {
                    entity: 7,
                    position: point(0., 0., Some(0.)),
                },
            ],
            &e,
            1000,
        );
        c.observe_facing(
            &[PetObservation::Facing {
                entity: 7,
                degrees: 90.,
            }],
            &e,
            17000,
        );
        let out = snapshot(&c, 17000);
        assert!(out["position"].is_null());
        assert_eq!(out["last_position"]["observed_ms"], 1000);
        assert_eq!(out["facing"]["degrees"], 90.);
        for key in ["distance_m", "height_m", "bearing_deg"] {
            assert!(out["cubes"][0][key].is_null());
        }
        assert!(snapshot(&c, 999)["position"].is_null());
        assert!(snapshot(&c, 999)["last_position"].is_null());
        assert!(snapshot(&c, 999)["facing"].is_null());
        assert_eq!(
            c.world_status(true, "capturing", "", 1, 17000)["facing"],
            out["facing"]
        );
        for key in ["position", "last_position", "facing"] {
            assert!(c.status(false, "stopped", "", 1, 17000)[key].is_null());
            assert!(c.world_status(false, "stopped", "", 1, 17000)[key].is_null());
        }
    }

    #[test]
    fn clear_preserves_own_fix_but_world_and_identity_changes_reset_motion() {
        let mut c = Cubes::default();
        let mut e = local();
        c.receive(
            vec![Observation::Zone {
                id: 1010,
                position: Some(point(1., 2., None)),
            }],
            &e,
            1000,
        );
        c.observe_facing(
            &[PetObservation::Facing {
                entity: 7,
                degrees: 45.,
            }],
            &e,
            1000,
        );
        let before = snapshot(&c, 1000);
        c.clear();
        let cleared = snapshot(&c, 1001);
        assert_ne!(cleared["session_id"], before["session_id"]);
        assert_eq!(cleared["last_position"], before["last_position"]);
        assert_eq!(cleared["facing"], before["facing"]);
        c.observe_facing(
            &[
                PetObservation::Facing {
                    entity: 7,
                    degrees: 90.,
                },
                PetObservation::Zone {
                    id: 1010,
                    x: Some(0.),
                    y: Some(0.),
                },
            ],
            &e,
            1002,
        );
        assert!(snapshot(&c, 1002)["facing"].is_null());
        c.receive(
            vec![Observation::Zone {
                id: 1010,
                position: None,
            }],
            &e,
            1003,
        );
        assert!(snapshot(&c, 1003)["last_position"].is_null());
        c.receive(
            vec![Observation::Position {
                entity: 7,
                position: point(1., 2., None),
            }],
            &e,
            1004,
        );
        c.observe_facing(
            &[PetObservation::Facing {
                entity: 7,
                degrees: 45.,
            }],
            &e,
            1004,
        );
        e.local = Some(8);
        c.receive(vec![], &e, 1005);
        assert!(snapshot(&c, 1005)["last_position"].is_null());
        assert!(snapshot(&c, 1005)["facing"].is_null());
        c.receive(
            vec![Observation::Position {
                entity: 8,
                position: point(1., 2., None),
            }],
            &e,
            1006,
        );
        c.observe_facing(
            &[PetObservation::Facing {
                entity: 8,
                degrees: 45.,
            }],
            &e,
            1006,
        );
        c.reset_connection();
        assert!(snapshot(&c, 1007)["last_position"].is_null());
        assert!(snapshot(&c, 1007)["facing"].is_null());
    }
    #[test]
    fn gathering_world_context_never_infers_resource_availability_or_keeps_stale_geometry() {
        let mut c = Cubes::default();
        let mut e = local();
        let world = |c: &Cubes, running, now| c.world_status(running, "capturing", "", 9, now);
        c.receive(
            vec![
                Observation::Zone {
                    id: 1010,
                    position: Some(point(10., 20., None)),
                },
                spawn(1),
            ],
            &e,
            1000,
        );
        let first = world(&c, true, 1000);
        assert_eq!(first["map_id"], "World/World_L/World_L_A");
        assert_eq!(first["position"]["x"], 10.);
        assert!(first["position"]["z"].is_null());
        assert!(first.get("cubes").is_none());
        assert!(first.get("resources").is_none());
        assert!(world(&c, true, 16001)["position"].is_null());
        assert_eq!(world(&c, true, 16001)["map_id"], first["map_id"]);
        for key in ["position", "zone_id", "map_id", "position_age_ms"] {
            assert!(world(&c, false, 1001)[key].is_null());
        }
        c.receive(
            vec![Observation::Zone {
                id: 1110,
                position: None,
            }],
            &e,
            2000,
        );
        let second = world(&c, true, 2000);
        assert_eq!(second["map_id"], "World/World_D/World_D_A");
        assert!(second["position"].is_null());
        assert_ne!(first["session_id"], second["session_id"]);
        c.receive(
            vec![Observation::Position {
                entity: 8,
                position: point(0., 0., Some(0.)),
            }],
            &e,
            2001,
        );
        assert!(world(&c, true, 2001)["position"].is_null());
        e.local = None;
        c.receive(vec![], &e, 2002);
        assert!(world(&c, true, 2002)["map_id"].is_null());
        c.reset_connection();
        assert!(world(&c, true, 2003)["position"].is_null());
    }
    #[test]
    fn lifecycle_distinguishes_opened_from_out_of_view_and_deduplicates() {
        let mut c = Cubes::default();
        let e = local();
        c.receive(vec![spawn(1), spawn(1), spawn(2)], &e, 1000);
        assert_eq!(snapshot(&c, 1000)["observed_total"], 2);
        c.receive(
            vec![Observation::Remove {
                entity: 1,
                reason: 1,
            }],
            &e,
            1100,
        );
        assert_eq!(snapshot(&c, 1100)["opened_total"], 0);
        c.receive(
            vec![
                Observation::Interaction {
                    entity: 2,
                    actor: 7,
                    done: true,
                },
                Observation::Interaction {
                    entity: 2,
                    actor: 7,
                    done: true,
                },
                Observation::Remove {
                    entity: 2,
                    reason: 4,
                },
            ],
            &e,
            1200,
        );
        let out = snapshot(&c, 1200);
        assert_eq!(out["opened_total"], 1);
        assert!(out["cubes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["status"] == "out_of_view"));
        assert!(out["cubes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["status"] == "opened" && v["opened_by_local"] == true));
        assert_eq!(snapshot(&c, 32000)["cubes"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn distances_require_fresh_owned_position_and_height_requires_z() {
        let mut c = Cubes::default();
        let e = local();
        c.receive(
            vec![
                spawn(1),
                Observation::Position {
                    entity: 8,
                    position: point(0., 0., Some(0.)),
                },
            ],
            &e,
            1000,
        );
        assert!(snapshot(&c, 1000)["cubes"][0]["distance_m"].is_null());
        c.receive(
            vec![Observation::Position {
                entity: 7,
                position: point(0., 0., None),
            }],
            &e,
            2000,
        );
        assert_eq!(snapshot(&c, 2000)["cubes"][0]["distance_m"], 5.);
        assert!(snapshot(&c, 2000)["cubes"][0]["height_m"].is_null());
        c.receive(
            vec![Observation::Position {
                entity: 7,
                position: point(0., 0., Some(500.)),
            }],
            &e,
            3000,
        );
        assert_eq!(snapshot(&c, 3000)["cubes"][0]["height_m"], 5.);
        assert!(snapshot(&c, 18001)["cubes"][0]["distance_m"].is_null());
        assert_eq!(snapshot(&c, 92000)["cubes"][0]["status"], "stale");
        assert!(c.status(false, "stopped", "", 1, 3000)["cubes"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    #[test]
    fn context_changes_clear_markers_even_on_same_zone_and_unrelated_ids_never_leak() {
        let mut c = Cubes::default();
        let mut e = local();
        c.receive(
            vec![
                Observation::Zone {
                    id: 1010,
                    position: None,
                },
                spawn(1),
            ],
            &e,
            1000,
        );
        let first = snapshot(&c, 1000)["session_id"].clone();
        c.receive(
            vec![Observation::Zone {
                id: 1010,
                position: None,
            }],
            &e,
            1100,
        );
        assert!(snapshot(&c, 1100)["cubes"].as_array().unwrap().is_empty());
        assert_ne!(snapshot(&c, 1100)["session_id"], first);
        c.receive(vec![spawn(1)], &e, 1200);
        e.local = Some(8);
        c.receive(vec![], &e, 1300);
        assert!(snapshot(&c, 1300)["cubes"].as_array().unwrap().is_empty());
        c.receive(
            vec![
                spawn(1),
                Observation::Spawn {
                    entity: 1,
                    template: 99,
                    position: point(0., 0., Some(0.)),
                },
            ],
            &e,
            1400,
        );
        assert!(snapshot(&c, 1400)["cubes"].as_array().unwrap().is_empty());
        c.receive((1..=200).map(spawn).collect(), &e, 1500);
        assert_eq!(
            snapshot(&c, 1500)["cubes"].as_array().unwrap().len(),
            MAX_CUBES
        );
        c.reset_connection();
        assert!(snapshot(&c, 1500)["position"].is_null());
        assert!(snapshot(&c, 1500)["zone_id"].is_null());
    }

    #[test]
    fn reusing_a_local_entity_for_another_name_cannot_retain_sightings() {
        let mut decoder = companion_core::wire::Decoder::default();
        let hex = include_str!("../../companion-core/tests/fixtures/self-identity-aahz.hex").trim();
        let mut identity: Vec<u8> = hex
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        decoder.decode(&identity);
        let mut c = Cubes::default();
        c.receive(vec![spawn(1)], &decoder.entities, 1000);
        assert_eq!(snapshot(&c, 1000)["observed_total"], 1);
        let at = identity
            .windows(4)
            .position(|bytes| bytes == b"Aahz")
            .unwrap();
        identity[at..at + 4].copy_from_slice(b"Newa");
        decoder.decode(&identity);
        c.receive(vec![], &decoder.entities, 1100);
        assert!(snapshot(&c, 1100)["cubes"].as_array().unwrap().is_empty());
    }
}
