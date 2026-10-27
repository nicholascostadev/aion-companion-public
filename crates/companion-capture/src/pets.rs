//! Local pet collections, farming facts and ephemeral live sightings.
use crate::pet_catalogue::catalogue;
use companion_core::wire::{entities::Entities, pets::Observation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    path::PathBuf,
    sync::OnceLock,
};

fn known(id: u32) -> bool {
    catalogue().pets.iter().any(|p| p.id == id)
}
fn pets_of(npc: u32) -> Vec<u32> {
    static INDEX: OnceLock<BTreeMap<u32, Vec<u32>>> = OnceLock::new();
    INDEX
        .get_or_init(|| {
            let mut out: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
            for p in &catalogue().pets {
                for &npc in &p.npc_ids {
                    out.entry(npc).or_default().push(p.id);
                }
            }
            out
        })
        .get(&npc)
        .cloned()
        .unwrap_or_default()
}
fn npc_name(id: u32) -> String {
    catalogue()
        .npcs
        .iter()
        .find(|n| n.id == id)
        .map(|n| n.name.to_string())
        .unwrap_or_else(|| format!("Monster #{id}"))
}
pub(crate) fn map_id(zone: Option<u32>) -> Option<String> {
    let z = zone?;
    let mut matches = catalogue().maps.iter().filter(|m| m.zone_ids.contains(&z));
    let map = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    Some(map.id.to_string())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FarmingGoal {
    pub pet_id: u32,
    pub map_id: String,
}
/// The only maps pets are farmed on, one per realm: Verteron (Elyos), Altgard (Asmodian) and
/// Chaotic Lower Reshanta (Abyss). Mirrors `FARM_MAPS` in `frontend/src/features/pets/maps.ts`.
pub const FARM_MAPS: [&str; 3] = [
    "World/World_L/World_L_A",
    "World/World_D/World_D_A",
    "Intersever/Abyss/Abyss_Reshanta_A",
];
/// Version of `pets.json`. Routes were added without a bump: their fields are optional and
/// omitted while empty, so older saved files load unchanged.
pub const SCHEMA_VERSION: u32 = 1;
/// Static spawn points within this distance of a stop's anchor belong to the stop, in game
/// centimetres (80 m). A geometric grouping only: it says nothing about terrain or travel.
pub const STOP_RADIUS_CM: i64 = 8_000;
const MAX_ROUTES: usize = 12;
const MAX_STOPS: usize = 24;
const MAX_TARGETS: usize = 8;
const MAX_NAME: usize = 48;
const MAX_ID: usize = 40;
/// Game coordinates a stop may hold, in centimetres; far beyond every map's bounds.
const COORDINATES: std::ops::RangeInclusive<i64> = -10_000_000..=10_000_000;

/// One stop of a farming route, anchored to a catalogue spawn record on the route's map.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RouteStop {
    pub id: String,
    /// Source monster of the anchoring spawn record.
    pub npc_id: u32,
    /// Static coordinates of the anchoring spawn record, in game centimetres.
    pub x: i64,
    pub y: i64,
    /// Route targets with a static spawn point within `STOP_RADIUS_CM` of the anchor.
    pub pet_ids: Vec<u32>,
    /// The user marked this stop done.
    #[serde(default)]
    pub done: bool,
}
/// A named, manually ordered sequence of stops for several pets on one farming map.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FarmingRoute {
    pub id: String,
    pub name: String,
    pub map_id: String,
    /// Pets this route farms.
    #[serde(default)]
    pub pet_ids: Vec<u32>,
    /// In the user's order.
    #[serde(default)]
    pub stops: Vec<RouteStop>,
    #[serde(default)]
    pub current_stop_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub revision: u64,
    pub pinned_ids: Vec<u32>,
    pub show_maxed: bool,
    pub nearby_radius: f64,
    pub opacity: f64,
    pub scale: f64,
    pub show_toasts: bool,
    pub farming_goal: Option<FarmingGoal>,
    pub last_map_id: Option<String>,
    /// Omitted while empty, so a file without routes stays readable by older builds.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<FarmingRoute>,
    /// The route being followed; independent of the farming goal and pins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_route_id: Option<String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            revision: 0,
            pinned_ids: vec![],
            show_maxed: false,
            nearby_radius: 250.,
            opacity: 0.8,
            scale: 1.,
            show_toasts: true,
            farming_goal: None,
            last_map_id: None,
            routes: vec![],
            active_route_id: None,
        }
    }
}
fn valid_id(id: &str) -> bool {
    (1..=MAX_ID).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn unique<T: Ord>(items: impl IntoIterator<Item = T>) -> bool {
    let mut seen = BTreeSet::new();
    items.into_iter().all(|item| seen.insert(item))
}
/// Shape of the saved routes. Catalogue references are checked only where a save adds or
/// changes them (`validate_route_changes`), so a catalogue update never makes saved routes
/// unloadable: orphaned stops stay saved for the user to repair.
fn validate_routes(c: &Config) -> bool {
    c.routes.len() <= MAX_ROUTES
        && unique(c.routes.iter().map(|r| r.id.as_str()))
        && c.active_route_id
            .as_deref()
            .is_none_or(|id| c.routes.iter().any(|r| r.id == id))
        && c.routes.iter().all(|r| {
            valid_id(&r.id)
                && !r.name.trim().is_empty()
                && r.name.trim().len() == r.name.len()
                && r.name.chars().count() <= MAX_NAME
                && !r.name.chars().any(char::is_control)
                && (1..=128).contains(&r.map_id.len())
                && r.pet_ids.len() <= MAX_TARGETS
                && unique(r.pet_ids.iter().copied())
                && r.stops.len() <= MAX_STOPS
                && unique(r.stops.iter().map(|s| s.id.as_str()))
                && r.current_stop_id
                    .as_deref()
                    .is_none_or(|id| r.stops.iter().any(|s| s.id == id))
                && r.stops.iter().all(|s| {
                    valid_id(&s.id)
                        && (1..=MAX_TARGETS).contains(&s.pet_ids.len())
                        && unique(s.pet_ids.iter().copied())
                        // A stop only serves the route's own targets, known or not.
                        && s.pet_ids.iter().all(|id| r.pet_ids.contains(id))
                        // Signed range, so a malformed i64::MIN never overflows `abs`.
                        && COORDINATES.contains(&s.x)
                        && COORDINATES.contains(&s.y)
                })
        })
}
/// Static spawn records of `pet` on `map`: (source monster, x, y).
fn spawns_of(pet: u32, map: &str) -> Vec<(u32, i64, i64)> {
    catalogue()
        .pets
        .iter()
        .filter(|p| p.id == pet)
        .flat_map(|p| p.spawns.iter())
        .filter(|s| s.map_id == map)
        .map(|s| (s.npc_id, s.x, s.y))
        .collect()
}
fn farm_map(id: &str) -> bool {
    FARM_MAPS.contains(&id) && catalogue().maps.iter().any(|m| m.id == id)
}
/// A stop references a real catalogue spawn record of one of its pets on the route's map,
/// and every pet it serves is a route target with a static point near that anchor.
fn valid_stop(route: &FarmingRoute, stop: &RouteStop) -> bool {
    let anchored = stop.pet_ids.iter().any(|&pet| {
        spawns_of(pet, &route.map_id)
            .iter()
            .any(|&(npc, x, y)| npc == stop.npc_id && x == stop.x && y == stop.y)
    });
    anchored
        && stop.pet_ids.iter().all(|&pet| {
            route.pet_ids.contains(&pet)
                && spawns_of(pet, &route.map_id).iter().any(|&(_, x, y)| {
                    ((x - stop.x) as f64).hypot((y - stop.y) as f64) <= STOP_RADIUS_CM as f64
                })
        })
}
/// Catalogue checks for what a save adds or changes. A new route, a route moved to another
/// map, a new target and a new or edited stop must be valid now: only the three farming maps,
/// targets that spawn there and stops anchored on that map. Anything kept unchanged from the
/// saved preferences passes as it is, so routes orphaned by a catalogue update can still be
/// renamed, reordered, marked or cleaned up instead of being lost.
fn validate_route_changes(old: &Config, next: &Config) -> Result<(), String> {
    for route in &next.routes {
        let prev = old
            .routes
            .iter()
            .find(|r| r.id == route.id && r.map_id == route.map_id);
        if prev.is_none() && !farm_map(&route.map_id) {
            return Err("Routes are limited to the three farming maps".into());
        }
        for &pet in &route.pet_ids {
            if !prev.is_some_and(|p| p.pet_ids.contains(&pet))
                && spawns_of(pet, &route.map_id).is_empty()
            {
                return Err("A route target has no recorded spawn on the route's map".into());
            }
        }
        for stop in &route.stops {
            let kept = prev.is_some_and(|p| {
                p.stops.iter().any(|s| {
                    s.id == stop.id
                        && s.npc_id == stop.npc_id
                        && s.x == stop.x
                        && s.y == stop.y
                        && s.pet_ids == stop.pet_ids
                })
            });
            if !kept && !valid_stop(route, stop) {
                return Err(
                    "A route stop does not match a recorded spawn of its pets on the route's map"
                        .into(),
                );
            }
        }
    }
    Ok(())
}
fn validate(c: &Config) -> Result<(), String> {
    let valid_map = |id: &str| catalogue().maps.iter().any(|m| m.id == id);
    if !c.nearby_radius.is_finite()
        || !(10.0..=5000.).contains(&c.nearby_radius)
        || !c.opacity.is_finite()
        || !(0.15..=1.).contains(&c.opacity)
        || !c.scale.is_finite()
        || !(0.7..=2.).contains(&c.scale)
        || c.pinned_ids.len() > 207
        || c.pinned_ids.iter().any(|id| !known(*id))
        || c.last_map_id.as_deref().is_some_and(|id| !valid_map(id))
        || c.farming_goal.as_ref().is_some_and(|goal| {
            !valid_map(&goal.map_id)
                || !catalogue().pets.iter().any(|p| {
                    p.id == goal.pet_id && p.spawns.iter().any(|s| s.map_id == goal.map_id)
                })
        })
        || !validate_routes(c)
    {
        return Err("Invalid pet preferences".into());
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Progress {
    pub pet_id: u32,
    pub level: u8,
    pub progress: u32,
    pub observed_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Gain {
    pub id: String,
    pub pet_id: u32,
    pub gained: u32,
    pub at_ms: u64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Profile {
    id: String,
    name: String,
    server_id: Option<u16>,
    synced_ms: Option<u64>,
    progress: BTreeMap<u32, Progress>,
    active_pet_id: Option<u32>,
    gains: VecDeque<Gain>,
}
// Older builds recorded pickups while refusing to advance a cached collection. Recover
// retained pickups after each row's last applied observation, without replaying any twice.
fn recover_progress(profile: &mut Profile) -> bool {
    let mut changed = false;
    for state in profile.progress.values_mut().filter(|s| s.level < 3) {
        let mut latest = state.observed_ms;
        let mut gained = 0u32;
        for gain in profile
            .gains
            .iter()
            .filter(|g| g.pet_id == state.pet_id && g.at_ms > state.observed_ms)
        {
            gained = gained.saturating_add(gain.gained);
            latest = latest.max(gain.at_ms);
        }
        if gained > 0 {
            state.progress = state.progress.saturating_add(gained).min(1_000_000);
            state.observed_ms = latest;
            changed = true;
        }
    }
    changed
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    schema_version: u32,
    config: Config,
    profiles: BTreeMap<String, Profile>,
    last_profile: Option<String>,
    sequence: u64,
}
const MAX_SAVED_BYTES: usize = 4 * 1024 * 1024;
/// Reads saved pet state exactly as startup does: the same size limit, schema and checks.
fn parse_saved(bytes: &[u8]) -> Result<Saved, String> {
    if bytes.len() > MAX_SAVED_BYTES {
        return Err("Pet state exceeds 4 MiB".into());
    }
    let data: Saved = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    validate(&data.config)?;
    if data.schema_version != SCHEMA_VERSION
        || data.profiles.len() > 128
        || data.profiles.values().any(|p| {
            p.progress.len() > 2000
                || p.gains.len() > 100
                || p.name.len() > 128
                || p.progress
                    .values()
                    .any(|s| !(1..=3).contains(&s.level) || s.progress > 1_000_000)
        })
    {
        return Err("Invalid saved pet collection".into());
    }
    Ok(data)
}
/// Ok when `bytes` is a `pets.json` this build loads without falling back to read-only:
/// older files without routes, and routes whose catalogue references have since gone stale.
pub fn validate_saved(bytes: &[u8]) -> Result<(), String> {
    parse_saved(bytes).map(|_| ())
}
#[derive(Clone, Serialize)]
struct Position {
    zone_id: Option<u32>,
    map_id: Option<String>,
    x: f64,
    y: f64,
    observed_ms: u64,
}
#[derive(Clone, Serialize)]
struct Facing {
    degrees: f64,
    observed_ms: u64,
}
struct Mob {
    npc: u32,
    x: Option<f64>,
    y: Option<f64>,
    seen: u64,
}
#[derive(Clone, Default, Serialize)]
struct Session {
    profile_id: Option<String>,
    started_ms: Option<u64>,
    souls_gained: u64,
    level_ups: u32,
    obtained: u32,
    #[serde(skip)]
    levels: BTreeMap<u32, u8>,
}
impl Session {
    fn observe_level(&mut self, pet_id: u32, level: u8, count: bool) {
        let previous = self.levels.entry(pet_id).or_default();
        if level > *previous {
            if count {
                if *previous == 0 {
                    self.obtained = self.obtained.saturating_add(1);
                }
                self.level_ups = self
                    .level_ups
                    .saturating_add((level - (*previous).max(1)) as u32);
            }
            *previous = level;
        }
    }
}
#[derive(Default)]
pub(super) struct Pets {
    pub storage: Option<std::sync::Arc<crate::storage::Storage>>,
    saved: Saved,
    root: Option<PathBuf>,
    active: Option<String>,
    live_synced: bool,
    /// A level-up or obtain notice establishes an exact per-pet zero baseline, even mid-connection.
    live_progress: BTreeSet<u32>,
    zone: Option<u32>,
    position: Option<Position>,
    facing: Option<Facing>,
    mobs: BTreeMap<u32, Mob>,
    pending: VecDeque<Observation>,
    revision: u64,
    error: Option<String>,
    read_only: bool,
    dirty: bool,
    last_save_attempt: u64,
    session: Session,
}
impl Pets {
    pub fn initialize(&mut self, root: PathBuf) -> Result<(), String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        self.root = Some(root.clone());
        let path = root.join("pets.json");
        if path.exists() {
            let result: Result<Saved, String> = (|| {
                if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_SAVED_BYTES as u64 {
                    return Err("Pet state exceeds 4 MiB".into());
                }
                parse_saved(&fs::read(&path).map_err(|e| e.to_string())?)
            })();
            match result {
                Ok(mut s) => {
                    for profile in s.profiles.values_mut() {
                        self.dirty |= recover_progress(profile);
                    }
                    self.saved = s;
                }
                Err(e) => {
                    self.read_only = true;
                    self.error = Some(format!(
                        "Saved pet state could not be loaded: {e}. The file is preserved."
                    ));
                }
            }
        } else {
            self.saved.schema_version = SCHEMA_VERSION;
        }
        Ok(())
    }
    fn persist(&mut self) -> Result<(), String> {
        if self.read_only {
            return Err(self
                .error
                .clone()
                .unwrap_or_else(|| "Pet state is read-only".into()));
        }
        let Some(root) = &self.root else {
            return Ok(());
        };
        if let Some(storage) = &self.storage {
            storage.write(vec![crate::storage::Write::json(
                root.join("pets.json"),
                self.saved.clone(),
            )])?;
            self.error = None;
            self.dirty = false;
            return Ok(());
        }
        crate::storage::atomic(&root.join("pets.json"), &self.saved)?;
        self.error = None;
        self.dirty = false;
        Ok(())
    }
    pub fn reset_connection(&mut self) {
        self.active = None;
        self.live_synced = false;
        self.live_progress.clear();
        self.zone = None;
        self.position = None;
        self.facing = None;
        self.mobs.clear();
        self.pending.clear();
        self.session = Session::default();
        self.revision = self.revision.saturating_add(1);
    }
    pub fn configure(&mut self, value: Value) -> Result<(), String> {
        let mut next: Config = serde_json::from_value(value).map_err(|e| e.to_string())?;
        validate(&next)?;
        if next.revision != self.saved.config.revision {
            return Err("Pet preferences revision changed. Refresh and try again.".into());
        }
        validate_route_changes(&self.saved.config, &next)?;
        let mut ids = BTreeSet::new();
        next.pinned_ids.retain(|id| ids.insert(*id));
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or("Pet revision overflow")?;
        let old = self.saved.config.clone();
        self.saved.config = next;
        if let Err(e) = self.persist() {
            self.saved.config = old;
            return Err(e);
        }
        self.revision = self.revision.saturating_add(1);
        Ok(())
    }
    pub fn receive(&mut self, events: Vec<Observation>, entities: &Entities, now: u64) {
        let identity = entities
            .local
            .and_then(|id| Some((entities.name(id)?.to_string(), entities.local_server_id()?)));
        let mut changed = false;
        if let Some((name, server)) = identity {
            let key = format!("{server}:{name}");
            if self.active.as_ref() != Some(&key) {
                if self.active.is_some() {
                    self.position = None;
                    self.facing = None;
                    self.zone = None;
                    self.mobs.clear();
                    self.pending.clear();
                }
                if !self.saved.profiles.contains_key(&key) && self.saved.profiles.len() >= 128 {
                    self.error = Some("Pet collection profile limit reached".into());
                    return;
                }
                self.saved
                    .profiles
                    .entry(key.clone())
                    .or_insert_with(|| Profile {
                        id: key.clone(),
                        name,
                        server_id: Some(server),
                        ..Default::default()
                    });
                self.active = Some(key.clone());
                self.session = Session {
                    profile_id: Some(key.clone()),
                    started_ms: Some(now),
                    ..Default::default()
                };
                self.saved.last_profile = Some(key);
                self.live_synced = false;
                self.live_progress.clear();
                changed = true;
            }
        }
        let mut all = Vec::new();
        if self.active.is_some() {
            all.extend(self.pending.drain(..));
        }
        all.extend(events);
        for event in all {
            match event {
                Observation::Spawn { entity, npc, x, y } => {
                    if pets_of(npc).is_empty() {
                        self.mobs.remove(&entity);
                    } else if self.mobs.len() < 4096 || self.mobs.contains_key(&entity) {
                        self.mobs.insert(
                            entity,
                            Mob {
                                npc,
                                x,
                                y,
                                seen: now,
                            },
                        );
                    }
                }
                Observation::Remove { entity } => {
                    self.mobs.remove(&entity);
                }
                Observation::Facing { entity, degrees } => {
                    if entities.local == Some(entity) && degrees.is_finite() {
                        self.facing = Some(Facing {
                            degrees: degrees.rem_euclid(360.0),
                            observed_ms: now,
                        });
                    }
                }
                Observation::Position { entity, x, y } => {
                    if entities.local == Some(entity) {
                        self.position = Some(Position {
                            zone_id: self.zone,
                            map_id: map_id(self.zone),
                            x,
                            y,
                            observed_ms: now,
                        });
                    } else if let Some(m) = self.mobs.get_mut(&entity) {
                        m.x = Some(x);
                        m.y = Some(y);
                        m.seen = now;
                    }
                }
                Observation::Zone { id, x, y } => {
                    if self.zone != Some(id) {
                        self.mobs.clear();
                        self.position = None;
                        self.facing = None;
                    }
                    self.zone = Some(id);
                    if let (Some(x), Some(y)) = (x, y) {
                        self.position = Some(Position {
                            zone_id: Some(id),
                            map_id: map_id(Some(id)),
                            x,
                            y,
                            observed_ms: now,
                        });
                    }
                }
                event => {
                    let Some(key) = self.active.clone() else {
                        if self.pending.len() < 2048 {
                            self.pending.push_back(event);
                        }
                        continue;
                    };
                    let profile = self.saved.profiles.get_mut(&key).unwrap();
                    match event {
                        Observation::Collection { active, states } => {
                            profile.progress = states
                                .into_iter()
                                .map(|s| {
                                    (
                                        s.pet_id,
                                        Progress {
                                            pet_id: s.pet_id,
                                            level: s.level,
                                            progress: s.progress,
                                            observed_ms: now,
                                        },
                                    )
                                })
                                .collect();
                            profile.synced_ms = Some(now);
                            for state in profile.progress.values() {
                                self.session.observe_level(state.pet_id, state.level, false);
                            }
                            profile.active_pet_id = active;
                            self.live_synced = true;
                            changed = true;
                        }
                        Observation::Progress { pet_id, gained } => {
                            if !known(pet_id) {
                                continue;
                            }
                            self.session.souls_gained =
                                self.session.souls_gained.saturating_add(gained as u64);
                            if let Some(s) = profile.progress.get_mut(&pet_id) {
                                if s.level < 3 {
                                    s.progress = s.progress.saturating_add(gained).min(1_000_000);
                                }
                                s.observed_ms = now;
                            }
                            self.saved.sequence = self.saved.sequence.saturating_add(1);
                            profile.gains.push_back(Gain {
                                id: format!("{}-{}", now, self.saved.sequence),
                                pet_id,
                                gained,
                                at_ms: now,
                            });
                            while profile.gains.len() > 100 {
                                profile.gains.pop_front();
                            }
                            changed = true;
                        }
                        Observation::Level { pet_id, level } => {
                            if !known(pet_id) || !(1..=3).contains(&level) {
                                continue;
                            }
                            self.session.observe_level(
                                pet_id,
                                level,
                                self.live_synced || self.live_progress.contains(&pet_id),
                            );
                            if !profile.progress.contains_key(&pet_id) {
                                self.live_progress.insert(pet_id);
                                profile.progress.insert(
                                    pet_id,
                                    Progress {
                                        pet_id,
                                        level,
                                        progress: 0,
                                        observed_ms: now,
                                    },
                                );
                                changed = true;
                            }
                            if let Some(s) = profile.progress.get_mut(&pet_id) {
                                if level > s.level {
                                    self.live_progress.insert(pet_id);
                                    *s = Progress {
                                        pet_id,
                                        level,
                                        progress: 0,
                                        observed_ms: now,
                                    };
                                    changed = true;
                                }
                            }
                        }
                        Observation::Added { pet_id, level } => {
                            if !known(pet_id) || !(1..=3).contains(&level) {
                                continue;
                            }
                            if !profile.progress.contains_key(&pet_id) {
                                self.live_progress.insert(pet_id);
                                self.session.observe_level(pet_id, level, self.live_synced);
                                profile.progress.insert(
                                    pet_id,
                                    Progress {
                                        pet_id,
                                        level,
                                        progress: 0,
                                        observed_ms: now,
                                    },
                                );
                                changed = true;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        self.mobs
            .retain(|_, m| now.saturating_sub(m.seen) <= 90_000);
        self.revision = self.revision.saturating_add(1);
        self.dirty |= changed;
        if self.dirty
            && !self.read_only
            && (changed || now.saturating_sub(self.last_save_attempt) >= 1000)
        {
            self.last_save_attempt = now;
            let result = if let (Some(storage), Some(root)) = (&self.storage, &self.root) {
                storage.checkpoint(crate::storage::Write::json(
                    root.join("pets.json"),
                    self.saved.clone(),
                ))
            } else {
                self.persist()
            };
            if let Err(e) = result {
                self.error = Some(format!("Pet state could not be saved: {e}"));
            }
        }
    }
    pub fn checkpoint(&mut self) -> Result<(), String> {
        if self.dirty && !self.read_only {
            if let (Some(storage), Some(root)) = (&self.storage, &self.root) {
                storage.checkpoint(crate::storage::Write::json(
                    root.join("pets.json"),
                    self.saved.clone(),
                ))?;
            } else {
                self.persist()?;
            }
        }
        Ok(())
    }
    /// Small, read-only spatial snapshot for visible maps; never serializes collections.
    pub fn motion_status(&self, profile_id: Option<&str>, running: bool, now: u64) -> Value {
        let active = running.then_some(self.active.as_deref()).flatten();
        let selected = profile_id.or(active).or(self.saved.last_profile.as_deref());
        let (position, last_position) = self.positions(selected, active, now);
        json!({"profile_id":selected,"active_profile_id":active,"running":running,
            "now_ms":now,"position":position,"last_position":last_position,
            "facing":self.facing(last_position.is_some(), now)})
    }
    fn facing(&self, live: bool, now: u64) -> Option<&Facing> {
        self.facing
            .as_ref()
            .filter(|f| live && now.saturating_sub(f.observed_ms) <= 10_000)
    }
    fn positions(
        &self,
        selected: Option<&str>,
        active: Option<&str>,
        now: u64,
    ) -> (Option<&Position>, Option<&Position>) {
        let live =
            selected.is_some_and(|id| self.saved.profiles.contains_key(id)) && selected == active;
        let last = self.position.as_ref().filter(|_| live);
        (
            last.filter(|p| now.saturating_sub(p.observed_ms) <= 15_000),
            last,
        )
    }
    pub fn status(
        &self,
        profile_id: Option<&str>,
        running: bool,
        phase: &str,
        message: &str,
        now: u64,
    ) -> Value {
        let active = running.then_some(self.active.as_deref()).flatten();
        let selected = profile_id.or(active).or(self.saved.last_profile.as_deref());
        let profile = selected.and_then(|id| self.saved.profiles.get(id));
        let session = if selected.is_some() && selected == self.session.profile_id.as_deref() {
            self.session.clone()
        } else {
            Session::default()
        };
        let live = profile.is_some() && selected == active;
        // Keep the map usable while stationary without presenting old coordinates as a
        // current distance or direction. Neither position is shared with saved profiles.
        let (position, last_position) = self.positions(selected, active, now);
        let mut nearby = Vec::new();
        if live {
            for (&entity, m) in &self.mobs {
                if now.saturating_sub(m.seen) > 90_000 {
                    continue;
                }
                let pet_ids = pets_of(m.npc);
                if !self.saved.config.show_maxed
                    && !self
                        .saved
                        .config
                        .farming_goal
                        .as_ref()
                        .is_some_and(|goal| pet_ids.contains(&goal.pet_id))
                    // A pin is an explicit choice: keep tracking it at max level.
                    && !pet_ids
                        .iter()
                        .any(|id| self.saved.config.pinned_ids.contains(id))
                    && profile.is_some_and(|p| {
                        pet_ids
                            .iter()
                            .all(|id| p.progress.get(id).is_some_and(|s| s.level == 3))
                    })
                {
                    continue;
                }
                let spatial = position.and_then(|p| Some((m.x? - p.x, m.y? - p.y)));
                let distance = spatial.map(|(x, y)| x.hypot(y) / 100.);
                if distance.is_some_and(|d| d > self.saved.config.nearby_radius) {
                    continue;
                }
                let bearing = spatial
                    .filter(|(x, y)| x.abs() + y.abs() > 0.01)
                    .map(|(x, y)| x.atan2(-y).to_degrees().rem_euclid(360.));
                nearby.push(json!({"entity_id":entity,"npc_id":m.npc,"name":npc_name(m.npc),"pet_ids":pet_ids,"x":m.x,"y":m.y,"distance":distance,"bearing":bearing,"observed_ms":m.seen}));
            }
        }
        nearby.sort_by(|a, b| {
            let goal = |v: &Value| {
                self.saved.config.farming_goal.as_ref().is_some_and(|goal| {
                    v["pet_ids"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|id| id.as_u64() == Some(goal.pet_id as u64))
                })
            };
            let pin = |v: &Value| {
                v["pet_ids"].as_array().unwrap().iter().any(|id| {
                    self.saved
                        .config
                        .pinned_ids
                        .contains(&(id.as_u64().unwrap() as u32))
                })
            };
            goal(b)
                .cmp(&goal(a))
                .then_with(|| pin(b).cmp(&pin(a)))
                .then_with(|| {
                    a["distance"]
                        .as_f64()
                        .unwrap_or(f64::INFINITY)
                        .total_cmp(&b["distance"].as_f64().unwrap_or(f64::INFINITY))
                })
                .then_with(|| a["entity_id"].as_u64().cmp(&b["entity_id"].as_u64()))
        });
        nearby.truncate(100);
        let progress = profile
            .map(|p| {
                p.progress
                    .values()
                    .map(|state| {
                        let mut value =
                            serde_json::to_value(state).expect("Pet progress is serializable");
                        value["progress_estimated"] = json!(
                            live && state.level < 3
                                && !self.live_synced
                                && !self.live_progress.contains(&state.pet_id)
                        );
                        value
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!({"revision":self.revision,"now_ms":now,"running":running,"phase":phase,"message":message,"profile_id":profile.map(|p|&p.id),"active_profile_id":active,"profiles":self.saved.profiles.values().map(|p|json!({"id":p.id,"name":p.name,"server_id":p.server_id,"synced_ms":p.synced_ms})).collect::<Vec<_>>(),"collection_synced":profile.is_some_and(|p|p.synced_ms.is_some()),"live_synced":live&&self.live_synced,"active_pet_id":profile.and_then(|p|p.active_pet_id),"progress":progress,"nearby":nearby,"position":position,"last_position":last_position,"facing":self.facing(last_position.is_some(), now),"gains":profile.map(|p|p.gains.iter().collect::<Vec<_>>()).unwrap_or_default(),"session":session,"config":self.saved.config,"error":self.root.as_ref().and_then(|root|self.storage.as_ref().and_then(|storage|storage.error_for(&root.join("pets.json")))).or_else(||self.error.clone()),"clock":"PC observation time","coordinate_units":"centimetres","bearing_reference":"Coordinate axes: -Y up, +X right"})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_core::wire::pets::PetState;
    // Catalogue/artwork assertions inspect the full public payload. Runtime lookups above
    // use the compact collector metadata instead of retaining this generic JSON tree.
    fn catalogue() -> &'static Value {
        static DATA: OnceLock<Value> = OnceLock::new();
        DATA.get_or_init(|| serde_json::from_str(crate::pet_catalogue()).unwrap())
    }
    fn entity() -> Entities {
        let mut e = Entities::default();
        let source = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../companion-core/tests/fixtures/self-identity-aahz.hex"
        ));
        let bytes: Vec<u8> = source
            .trim()
            .as_bytes()
            .chunks_exact(2)
            .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
            .collect();
        e.observe(&bytes).unwrap();
        e
    }
    fn collection() -> Observation {
        Observation::Collection {
            active: Some(1004),
            states: vec![PetState {
                pet_id: 1004,
                level: 2,
                progress: 32,
            }],
        }
    }
    #[test]
    fn catalogue_has_all_families_sources_and_finite_coordinates() {
        let c = catalogue();
        assert_eq!(c["pets"].as_array().unwrap().len(), 207);
        let families: BTreeSet<_> = c["pets"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["family"].as_str().unwrap())
            .collect();
        assert_eq!(families.len(), 5);
        assert!(c["maps"].as_array().unwrap().len() > 200);
        assert!(known(1004));
        assert!(!pets_of(2000000).is_empty());
        let growth: Value =
            serde_json::from_str(include_str!("../data/pet-growth-global.json")).unwrap();
        let rows = growth["rows"].as_array().unwrap();
        assert_eq!(rows.len(), c["pets"].as_array().unwrap().len());
        let mut checked = BTreeSet::new();
        for row in rows {
            let id = row["pet_id"].as_u64().unwrap() as u32;
            assert!(known(id) && checked.insert(id));
            assert_eq!(row["unlock_souls"], c["thresholds"]["0"]);
            for level in row["levels"].as_array().unwrap() {
                assert_eq!(level["souls"], c["thresholds"][level["level"].to_string()]);
            }
        }
        assert_eq!(c["thresholds"]["0"], 5);
    }
    #[test]
    fn farmed_mutated_spider_uses_its_game_identity() {
        // Global client-data database.getPet rows 1021/1025 and database.getItem
        // rows 534660020/534660024, checked 2026-10-22. Names and farm sources
        // were attached to the opposite spider; server progress IDs were correct.
        let mut pets = Pets::default();
        pets.receive(
            vec![Observation::Collection {
                active: None,
                states: vec![
                    PetState {
                        pet_id: 1021,
                        level: 1,
                        progress: 0,
                    },
                    PetState {
                        pet_id: 1025,
                        level: 3,
                        progress: 0,
                    },
                ],
            }],
            &entity(),
            10,
        );
        let status = pets.status(None, true, "running", "", 10);
        let progress = status["progress"].as_array().unwrap();
        let entries = catalogue()["pets"].as_array().unwrap();
        let mutated = entries
            .iter()
            .find(|p| p["name"] == "Mutated Aberrant Odyle Spider")
            .unwrap();
        assert_eq!(mutated["id"], 1025);
        assert_eq!(
            progress
                .iter()
                .find(|p| p["pet_id"] == mutated["id"])
                .unwrap()["level"],
            3
        );
        assert_eq!(mutated["soul_item_ids"], json!([534660020]));
        assert_eq!(mutated["shop_item_ids"], json!([534760020]));
        for npc in [2100030, 2100663, 2100745, 2400744] {
            assert_eq!(pets_of(npc), vec![1025]);
        }
        assert!(!mutated["spawns"].as_array().unwrap().is_empty());
        assert!(!mutated["regions"].as_array().unwrap().is_empty());

        let ordinary = entries
            .iter()
            .find(|p| p["name"] == "Aberrant Odyle Spider")
            .unwrap();
        assert_eq!(ordinary["id"], 1021);
        assert_eq!(
            progress
                .iter()
                .find(|p| p["pet_id"] == ordinary["id"])
                .unwrap()["level"],
            1
        );
        assert_eq!(ordinary["soul_item_ids"], json!([534660024]));
        assert_eq!(ordinary["shop_item_ids"], json!([534760024]));
        assert!(ordinary["npc_ids"].as_array().unwrap().is_empty());
        assert!(ordinary["spawns"].as_array().unwrap().is_empty());
        assert!(ordinary["regions"].as_array().unwrap().is_empty());
    }
    #[test]
    fn farming_goals_validate_map_membership_and_survive_save_round_trip() {
        let root = std::env::temp_dir().join(format!("aion-farm-goal-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let mut p = Pets::default();
        p.initialize(root.clone()).unwrap();
        let original: Config =
            serde_json::from_value(json!({"revision":0,"pinned_ids":[1004]})).unwrap();
        assert!(original.farming_goal.is_none());
        assert!(original.last_map_id.is_none());
        let map = catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pet| pet["id"] == 1012)
            .unwrap()["spawns"][0]["map_id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut next = original;
        next.farming_goal = Some(FarmingGoal {
            pet_id: 1012,
            map_id: map.clone(),
        });
        next.last_map_id = Some(map.clone());
        p.configure(serde_json::to_value(&next).unwrap()).unwrap();
        let mut q = Pets::default();
        q.initialize(root.clone()).unwrap();
        assert_eq!(q.saved.config.farming_goal, next.farming_goal);
        assert_eq!(q.saved.config.pinned_ids, vec![1004]);
        let mut invalid = q.saved.config.clone();
        invalid.farming_goal.as_mut().unwrap().pet_id = 1001;
        assert!(q.configure(serde_json::to_value(invalid).unwrap()).is_err());
        let mut invalid = q.saved.config.clone();
        invalid.last_map_id = Some("nonexistent/map".into());
        assert!(q.configure(serde_json::to_value(invalid).unwrap()).is_err());
        let mut stop = q.saved.config.clone();
        stop.farming_goal = None;
        q.configure(serde_json::to_value(stop).unwrap()).unwrap();
        assert_eq!(q.saved.config.pinned_ids, vec![1004]);
        assert_eq!(q.saved.config.last_map_id, Some(map));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn session_counts_only_observed_gains_and_nonduplicate_level_events() {
        let e = entity();
        let mut p = Pets::default();
        p.receive(
            vec![Observation::Level {
                pet_id: 1007,
                level: 2,
            }],
            &e,
            5,
        );
        assert_eq!(
            p.status(None, true, "running", "", 5)["session"]["level_ups"],
            0
        );
        p.receive(vec![collection()], &e, 10);
        p.receive(
            vec![
                Observation::Progress {
                    pet_id: 1004,
                    gained: 2,
                },
                Observation::Level {
                    pet_id: 1004,
                    level: 3,
                },
                Observation::Level {
                    pet_id: 1004,
                    level: 3,
                },
                Observation::Added {
                    pet_id: 1012,
                    level: 1,
                },
                Observation::Added {
                    pet_id: 1012,
                    level: 1,
                },
            ],
            &e,
            20,
        );
        let s = p.status(None, true, "running", "", 20);
        assert_eq!(s["session"]["started_ms"], 5);
        assert_eq!(s["session"]["souls_gained"], 2);
        assert_eq!(s["session"]["level_ups"], 1);
        assert_eq!(s["session"]["obtained"], 1);
        p.receive(
            vec![
                collection(),
                Observation::Level {
                    pet_id: 1004,
                    level: 3,
                },
            ],
            &e,
            30,
        );
        assert_eq!(
            p.status(None, true, "running", "", 30)["session"]["level_ups"],
            1
        );
        assert!(
            p.status(Some("other-profile"), true, "running", "", 30)["session"]["profile_id"]
                .is_null()
        );
        p.reset_connection();
        let s = p.status(None, false, "stopped", "", 40);
        assert!(s["session"]["started_ms"].is_null());
        assert_eq!(s["session"]["souls_gained"], 0);
    }
    #[test]
    fn farming_goal_is_not_dropped_when_nearby_output_is_bounded() {
        let e = entity();
        let mut p = Pets::default();
        let pet = catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pet| pet["id"] == 1012)
            .unwrap();
        let spawn = &pet["spawns"][0];
        p.saved.config.farming_goal = Some(FarmingGoal {
            pet_id: 1012,
            map_id: spawn["map_id"].as_str().unwrap().into(),
        });
        let mut events = vec![
            collection(),
            Observation::Position {
                entity: e.local.unwrap(),
                x: 0.,
                y: 0.,
            },
        ];
        for id in 1..=110 {
            events.push(Observation::Spawn {
                entity: id,
                npc: 2000000,
                x: Some(id as f64),
                y: Some(0.),
            });
        }
        events.push(Observation::Spawn {
            entity: 999,
            npc: spawn["npc_id"].as_u64().unwrap() as u32,
            x: Some(5000.),
            y: Some(0.),
        });
        p.receive(events, &e, 100);
        let s = p.status(None, true, "running", "", 100);
        assert_eq!(s["nearby"].as_array().unwrap().len(), 100);
        assert_eq!(s["nearby"][0]["entity_id"], 999);
    }
    #[test]
    fn explicit_farming_goal_remains_visible_after_the_pet_reaches_max_level() {
        let e = entity();
        let mut p = Pets::default();
        let pet = catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pet| pet["id"] == 1012)
            .unwrap();
        let spawn = &pet["spawns"][0];
        p.receive(
            vec![
                Observation::Collection {
                    active: None,
                    states: vec![PetState {
                        pet_id: 1012,
                        level: 3,
                        progress: 0,
                    }],
                },
                Observation::Spawn {
                    entity: 999,
                    npc: spawn["npc_id"].as_u64().unwrap() as u32,
                    x: Some(100.),
                    y: Some(100.),
                },
            ],
            &e,
            10,
        );
        assert!(p.status(None, true, "running", "", 10)["nearby"]
            .as_array()
            .unwrap()
            .is_empty());
        p.saved.config.farming_goal = Some(FarmingGoal {
            pet_id: 1012,
            map_id: spawn["map_id"].as_str().unwrap().into(),
        });
        assert_eq!(
            p.status(None, true, "running", "", 10)["nearby"][0]["entity_id"],
            999
        );
    }
    #[test]
    fn pinned_pet_remains_visible_after_it_reaches_max_level() {
        let e = entity();
        let mut p = Pets::default();
        let pet = catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pet| pet["id"] == 1012)
            .unwrap();
        let spawn = &pet["spawns"][0];
        p.receive(
            vec![
                Observation::Collection {
                    active: None,
                    states: vec![PetState {
                        pet_id: 1012,
                        level: 3,
                        progress: 0,
                    }],
                },
                Observation::Spawn {
                    entity: 999,
                    npc: spawn["npc_id"].as_u64().unwrap() as u32,
                    x: Some(100.),
                    y: Some(100.),
                },
            ],
            &e,
            10,
        );
        assert!(p.status(None, true, "running", "", 10)["nearby"]
            .as_array()
            .unwrap()
            .is_empty());
        p.saved.config.pinned_ids = vec![1012];
        assert_eq!(
            p.status(None, true, "running", "", 10)["nearby"][0]["entity_id"],
            999
        );
    }
    #[test]
    fn identity_late_snapshot_deltas_and_level_notices_are_independent() {
        let mut p = Pets::default();
        p.receive(vec![collection()], &Entities::default(), 10);
        assert_eq!(
            p.status(None, true, "running", "", 10)["collection_synced"],
            false
        );
        let e = entity();
        p.receive(vec![], &e, 20);
        assert_eq!(
            p.status(None, true, "running", "", 20)["progress"][0]["progress"],
            32
        );
        p.receive(
            vec![Observation::Progress {
                pet_id: 1004,
                gained: 2,
            }],
            &e,
            30,
        );
        let s = p.status(None, true, "running", "", 30);
        assert_eq!(s["progress"][0]["progress"], 34);
        assert_eq!(s["gains"].as_array().unwrap().len(), 1);
        p.receive(
            vec![Observation::Level {
                pet_id: 1004,
                level: 3,
            }],
            &e,
            40,
        );
        assert_eq!(
            p.status(None, true, "running", "", 40)["progress"][0]["level"],
            3
        );
        p.receive(vec![collection()], &e, 50);
        assert_eq!(
            p.status(None, true, "running", "", 50)["progress"][0]["progress"],
            32
        );
        assert_eq!(
            p.status(None, true, "running", "", 50)["gains"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn reconnect_removes_live_sightings_but_keeps_saved_collection() {
        let mut p = Pets::default();
        let e = entity();
        p.receive(
            vec![
                collection(),
                Observation::Spawn {
                    entity: 42,
                    npc: 2000000,
                    x: Some(100.),
                    y: Some(-100.),
                },
                Observation::Position {
                    entity: e.local.unwrap(),
                    x: 0.,
                    y: 0.,
                },
            ],
            &e,
            100,
        );
        let s = p.status(None, true, "running", "", 100);
        assert!((s["nearby"][0]["distance"].as_f64().unwrap() - 2f64.sqrt()).abs() < 0.001);
        assert_eq!(s["nearby"][0]["bearing"], 45.);
        assert!(p.status(None, false, "stopped", "", 100)["nearby"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(p.status(None, true, "running", "", 20_000)["position"].is_null());
        p.reset_connection();
        let s = p.status(None, true, "running", "", 101);
        assert!(s["nearby"].as_array().unwrap().is_empty());
        assert_eq!(s["progress"][0]["progress"], 32);
        assert_eq!(s["live_synced"], false);
    }
    #[test]
    fn another_caster_never_moves_the_local_player() {
        let mut p = Pets::default();
        let e = entity();
        let local = e.local.unwrap();
        p.receive(
            vec![
                collection(),
                Observation::Position {
                    entity: local + 1,
                    x: 2000.0,
                    y: -3000.0,
                },
            ],
            &e,
            100,
        );
        assert!(p.motion_status(None, true, 100)["position"].is_null());
        p.receive(
            vec![Observation::Position {
                entity: local,
                x: 4000.0,
                y: -5000.0,
            }],
            &e,
            101,
        );
        assert_eq!(p.motion_status(None, true, 101)["position"]["x"], 4000.0);
    }
    #[test]
    fn facing_is_owned_ephemeral_and_expires_independently_of_position() {
        let mut p = Pets::default();
        let e = entity();
        let local = e.local.unwrap();
        p.receive(
            vec![
                collection(),
                Observation::Position {
                    entity: local,
                    x: 4000.0,
                    y: -5000.0,
                },
                Observation::Facing {
                    entity: local + 1,
                    degrees: 90.0,
                },
            ],
            &e,
            100,
        );
        assert!(p.motion_status(None, true, 100)["facing"].is_null());
        p.receive(
            vec![Observation::Facing {
                entity: local,
                degrees: 0.0,
            }],
            &e,
            100,
        );
        let snapshot = p.motion_status(None, true, 100);
        assert_eq!(snapshot["facing"]["degrees"], 0.0);
        assert_eq!(
            snapshot["facing"],
            p.status(None, true, "running", "", 100)["facing"]
        );
        assert!(p.motion_status(None, false, 100)["facing"].is_null());
        assert!(p.motion_status(Some("other"), true, 100)["facing"].is_null());
        p.receive(
            vec![Observation::Position {
                entity: local,
                x: 4000.0,
                y: -5000.0,
            }],
            &e,
            10_100,
        );
        assert!(p.motion_status(None, true, 10_100)["facing"].is_object());
        assert!(p.motion_status(None, true, 10_101)["facing"].is_null());
        p.receive(
            vec![Observation::Facing {
                entity: local,
                degrees: -90.0,
            }],
            &e,
            10_102,
        );
        assert_eq!(
            p.motion_status(None, true, 10_102)["facing"]["degrees"],
            270.0
        );
        p.receive(
            vec![Observation::Zone {
                id: 7,
                x: Some(4000.0),
                y: Some(-5000.0),
            }],
            &e,
            10_103,
        );
        assert!(p.motion_status(None, true, 10_103)["facing"].is_null());
        p.receive(
            vec![Observation::Facing {
                entity: local,
                degrees: 90.0,
            }],
            &e,
            10_104,
        );
        p.reset_connection();
        p.receive(
            vec![
                collection(),
                Observation::Position {
                    entity: local,
                    x: 4000.0,
                    y: -5000.0,
                },
            ],
            &e,
            10_105,
        );
        assert!(p.motion_status(None, true, 10_105)["facing"].is_null());
        // A new turn is known even when the unchanged position is only last-known.
        p.receive(
            vec![Observation::Facing {
                entity: local,
                degrees: 90.0,
            }],
            &e,
            30_000,
        );
        let turned = p.motion_status(None, true, 30_000);
        assert!(turned["position"].is_null());
        assert!(turned["last_position"].is_object());
        assert_eq!(turned["facing"]["degrees"], 90.0);
        assert_eq!(
            turned["facing"],
            p.status(None, true, "running", "", 30_000)["facing"]
        );
    }
    #[test]
    fn last_known_position_keeps_map_context_without_stale_ranges_or_cross_profile_leaks() {
        let mut p = Pets::default();
        let e = entity();
        p.receive(
            vec![
                collection(),
                Observation::Zone {
                    id: 1,
                    x: Some(0.),
                    y: Some(0.),
                },
                Observation::Spawn {
                    entity: 42,
                    npc: 2000000,
                    x: Some(100.),
                    y: Some(-100.),
                },
            ],
            &e,
            100,
        );
        let current = p.status(None, true, "running", "", 15_100);
        let motion = p.motion_status(None, true, 15_100);
        assert_eq!(motion["position"], current["position"]);
        assert_eq!(motion["last_position"], current["last_position"]);
        assert!(motion.get("progress").is_none());
        assert!(p.motion_status(None, false, 15_100)["last_position"].is_null());
        assert_eq!(current["last_position"], current["position"]);
        assert!(current["nearby"][0]["distance"].is_number());
        let stale = p.status(None, true, "running", "", 15_101);
        assert!(stale["position"].is_null());
        assert_eq!(stale["last_position"]["observed_ms"], 100);
        assert_eq!(stale["last_position"]["zone_id"], 1);
        assert!(stale["nearby"][0]["distance"].is_null());
        assert!(stale["nearby"][0]["bearing"].is_null());
        assert!(p.status(None, false, "stopped", "", 15_101)["last_position"].is_null());
        p.saved.profiles.insert(
            "other".into(),
            Profile {
                id: "other".into(),
                ..Default::default()
            },
        );
        assert!(p.status(Some("other"), true, "running", "", 15_101)["last_position"].is_null());
        assert!(p.motion_status(Some("other"), true, 15_101)["last_position"].is_null());
        // A new zone without coordinates must not keep the old map/player marker.
        p.receive(
            vec![Observation::Zone {
                id: 2,
                x: None,
                y: None,
            }],
            &e,
            15_102,
        );
        assert!(p.status(None, true, "running", "", 15_102)["last_position"].is_null());
        p.receive(
            vec![Observation::Position {
                entity: e.local.unwrap(),
                x: 5.,
                y: 8.,
            }],
            &e,
            15_103,
        );
        assert_eq!(
            p.status(None, true, "running", "", 15_103)["last_position"]["zone_id"],
            2
        );
        p.reset_connection();
        assert!(p.status(None, true, "running", "", 15_104)["last_position"].is_null());
    }
    #[test]
    fn save_round_trip_revisions_and_corrupt_file_protection() {
        let root = std::env::temp_dir().join(format!("aion-pets-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let mut p = Pets::default();
        p.initialize(root.clone()).unwrap();
        let mut c = p.saved.config.clone();
        c.pinned_ids = vec![1004, 1004];
        p.configure(serde_json::to_value(c.clone()).unwrap())
            .unwrap();
        assert!(p.configure(serde_json::to_value(c).unwrap()).is_err());
        p.receive(vec![collection()], &entity(), 10);
        let mut q = Pets::default();
        q.initialize(root.clone()).unwrap();
        assert_eq!(q.saved.config.pinned_ids, vec![1004]);
        assert_eq!(
            q.status(None, false, "stopped", "", 11)["progress"][0]["progress"],
            32
        );
        fs::write(root.join("pets.json"), b"bad").unwrap();
        let mut bad = Pets::default();
        bad.initialize(root.clone()).unwrap();
        bad.receive(vec![collection()], &entity(), 30);
        assert_eq!(fs::read(root.join("pets.json")).unwrap(), b"bad");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn pickups_advance_cached_progress_and_new_levels_establish_exact_baselines() {
        let e = entity();
        let mut p = Pets::default();
        p.receive(vec![collection()], &e, 10);
        p.reset_connection();
        p.receive(
            vec![
                Observation::Progress {
                    pet_id: 1004,
                    gained: 2,
                },
                Observation::Level {
                    pet_id: 1007,
                    level: 2,
                },
            ],
            &e,
            20,
        );
        let s = p.status(None, true, "running", "", 20);
        assert_eq!(s["live_synced"], false);
        assert_eq!(s["progress"][0]["progress"], 34);
        assert_eq!(s["progress"][0]["progress_estimated"], true);
        assert_eq!(s["progress"][1]["level"], 2);
        assert_eq!(s["progress"][1]["progress_estimated"], false);
        assert_eq!(s["gains"][0]["gained"], 2);
        p.receive(
            vec![
                Observation::Progress {
                    pet_id: 1007,
                    gained: 3,
                },
                Observation::Level {
                    pet_id: 1007,
                    level: 2,
                },
            ],
            &e,
            25,
        );
        let s = p.status(None, true, "running", "", 25);
        assert_eq!(s["progress"][1]["progress"], 3);
        assert_eq!(s["progress"][1]["progress_estimated"], false);
        p.receive(
            vec![
                collection(),
                Observation::Progress {
                    pet_id: 1004,
                    gained: 1,
                },
            ],
            &e,
            30,
        );
        assert_eq!(
            p.status(None, true, "running", "", 30)["progress"][0]["progress"],
            33
        );
        assert_eq!(
            p.status(None, true, "running", "", 30)["progress"][0]["progress_estimated"],
            false
        );
    }
    #[test]
    fn retained_pickups_from_older_builds_recover_once_and_ignore_other_pets() {
        let mut profile = Profile::default();
        profile.progress.insert(
            1004,
            Progress {
                pet_id: 1004,
                level: 2,
                progress: 0,
                observed_ms: 10,
            },
        );
        for (pet_id, gained, at_ms) in [(1004, 9, 9), (1004, 2, 20), (1004, 3, 20), (1007, 8, 30)] {
            profile.gains.push_back(Gain {
                id: format!("{pet_id}-{gained}"),
                pet_id,
                gained,
                at_ms,
            });
        }
        assert!(recover_progress(&mut profile));
        assert_eq!(profile.progress[&1004].progress, 5);
        assert_eq!(profile.progress[&1004].observed_ms, 20);
        assert!(!recover_progress(&mut profile));
        assert_eq!(profile.progress[&1004].progress, 5);
    }
    #[test]
    fn removed_and_reused_mobs_do_not_leave_ghost_radar_entries() {
        let e = entity();
        let mut p = Pets::default();
        let spawn = Observation::Spawn {
            entity: 42,
            npc: 2000000,
            x: None,
            y: None,
        };
        p.receive(vec![spawn.clone()], &e, 10);
        assert_eq!(
            p.status(None, true, "running", "", 10)["nearby"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        p.receive(vec![Observation::Remove { entity: 42 }], &e, 11);
        assert!(p.status(None, true, "running", "", 11)["nearby"]
            .as_array()
            .unwrap()
            .is_empty());
        p.receive(
            vec![
                spawn,
                Observation::Spawn {
                    entity: 42,
                    npc: 9999999,
                    x: None,
                    y: None,
                },
            ],
            &e,
            12,
        );
        assert!(p.status(None, true, "running", "", 12)["nearby"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    /// The first catalogue spawn record on `map`: (pet, monster, x, y).
    fn spawn_on(map: &str, skip: &[u32]) -> (u32, u32, i64, i64) {
        catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| !skip.contains(&(p["id"].as_u64().unwrap() as u32)))
            .find_map(|p| {
                let s = p["spawns"]
                    .as_array()?
                    .iter()
                    .find(|s| s["map_id"] == map)?;
                Some((
                    p["id"].as_u64()? as u32,
                    s["npc_id"].as_u64()? as u32,
                    s["x"].as_i64()?,
                    s["y"].as_i64()?,
                ))
            })
            .unwrap()
    }
    fn route(map: &str, pet: u32, npc: u32, x: i64, y: i64) -> Value {
        json!({"id":"r1","name":"Morning loop","map_id":map,"pet_ids":[pet],
            "stops":[{"id":"s1","npc_id":npc,"x":x,"y":y,"pet_ids":[pet]}],
            "current_stop_id":"s1"})
    }
    fn with_routes(p: &Pets, routes: Value, active: Option<&str>) -> Value {
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"] = routes;
        c["active_route_id"] = json!(active);
        c
    }

    #[test]
    fn farm_maps_exist_and_older_configs_load_without_routes() {
        for id in FARM_MAPS {
            assert!(farm_map(id), "{id}");
        }
        let old: Config = serde_json::from_value(
            json!({"revision":4,"pinned_ids":[1004],"farming_goal":null,"last_map_id":null}),
        )
        .unwrap();
        assert!(old.routes.is_empty() && old.active_route_id.is_none());
        // Without routes the saved shape is the one older builds read.
        let saved = serde_json::to_value(&old).unwrap();
        assert!(saved.get("routes").is_none() && saved.get("active_route_id").is_none());
        let file = json!({"schema_version":1,"config":{"revision":2,"pinned_ids":[1004]}});
        validate_saved(file.to_string().as_bytes()).unwrap();
        assert!(validate_saved(b"bad").is_err());
        assert!(validate_saved(
            json!({"schema_version":2,"config":{"revision":0}})
                .to_string()
                .as_bytes()
        )
        .is_err());
    }

    #[test]
    fn routes_persist_order_current_stop_marks_and_stay_independent_of_goal_and_pins() {
        let root = std::env::temp_dir().join(format!("aion-routes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let mut p = Pets::default();
        p.initialize(root.clone()).unwrap();
        let map = FARM_MAPS[0];
        let (pet, npc, x, y) = spawn_on(map, &[]);
        let (other, onpc, ox, oy) = spawn_on(map, &[pet]);
        let mut r = route(map, pet, npc, x, y);
        r["pet_ids"] = json!([pet, other]);
        r["stops"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"s2","npc_id":onpc,"x":ox,"y":oy,"pet_ids":[other],"done":true}));
        let mut c = with_routes(&p, json!([r]), Some("r1"));
        c["pinned_ids"] = json!([other]);
        p.configure(c).unwrap();
        // Manual order: the second stop first, then the current stop advances.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][0]["stops"].as_array_mut().unwrap().reverse();
        c["routes"][0]["current_stop_id"] = json!("s2");
        c["routes"][0]["stops"][1]["done"] = json!(true);
        p.configure(c).unwrap();
        let mut q = Pets::default();
        q.initialize(root.clone()).unwrap();
        let saved = &q.saved.config;
        assert_eq!(saved.active_route_id.as_deref(), Some("r1"));
        let stops = &saved.routes[0].stops;
        assert_eq!(
            stops.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["s2", "s1"]
        );
        assert!(stops.iter().all(|s| s.done));
        assert_eq!(saved.routes[0].current_stop_id.as_deref(), Some("s2"));
        assert_eq!(saved.pinned_ids, vec![other]);
        assert!(saved.farming_goal.is_none());
        validate_saved(&fs::read(root.join("pets.json")).unwrap()).unwrap();
        // A goal set while following a route leaves the route untouched, and back.
        let mut c = serde_json::to_value(&q.saved.config).unwrap();
        c["farming_goal"] = json!({"pet_id":pet,"map_id":map});
        q.configure(c).unwrap();
        assert_eq!(q.saved.config.routes[0].stops.len(), 2);
        let mut c = serde_json::to_value(&q.saved.config).unwrap();
        c["active_route_id"] = json!(null);
        q.configure(c).unwrap();
        assert_eq!(
            q.saved.config.farming_goal,
            Some(FarmingGoal {
                pet_id: pet,
                map_id: map.into()
            })
        );
        assert_eq!(q.saved.config.pinned_ids, vec![other]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn routes_reject_unsupported_maps_cross_map_and_unrelated_stops() {
        let mut p = Pets::default();
        let map = FARM_MAPS[0];
        let (pet, npc, x, y) = spawn_on(map, &[]);
        let rejected = |p: &mut Pets, r: Value| {
            let before = p.saved.config.clone();
            let c = with_routes(p, json!([r]), None);
            assert!(p.configure(c).is_err());
            assert_eq!(p.saved.config, before);
        };
        // Another map with spawns that is not one of the three farming maps.
        let elsewhere = catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|p| p["spawns"].as_array().unwrap())
            .find(|s| !FARM_MAPS.iter().any(|m| s["map_id"] == *m))
            .unwrap();
        let (epet, enpc, ex, ey) = spawn_on(elsewhere["map_id"].as_str().unwrap(), &[]);
        rejected(
            &mut p,
            route(elsewhere["map_id"].as_str().unwrap(), epet, enpc, ex, ey),
        );
        // A stop anchored on Altgard inside a Verteron route.
        let (apet, anpc, ax, ay) = spawn_on(FARM_MAPS[1], &[]);
        let mut cross = route(map, pet, anpc, ax, ay);
        cross["pet_ids"] = json!([pet, apet]);
        cross["stops"][0]["pet_ids"] = json!([apet]);
        rejected(&mut p, cross);
        // Coordinates that are not a recorded spawn, or a monster other than the record's.
        rejected(&mut p, route(map, pet, npc, x + 1, y));
        rejected(&mut p, route(map, pet, npc + 1, x, y));
        // A stop serving a pet that is not a target of the route.
        let mut stray = route(map, pet, npc, x, y);
        stray["pet_ids"] = json!([]);
        rejected(&mut p, stray);
        // A covered pet must have a recorded point near the anchor.
        let far = catalogue()["pets"]
            .as_array()
            .unwrap()
            .iter()
            .find_map(|p| {
                let id = p["id"].as_u64()? as u32;
                let near = spawns_of(id, map).iter().any(|&(_, sx, sy)| {
                    ((sx - x) as f64).hypot((sy - y) as f64) <= STOP_RADIUS_CM as f64
                });
                (!spawns_of(id, map).is_empty() && !near).then_some(id)
            })
            .unwrap();
        let mut distant = route(map, pet, npc, x, y);
        distant["pet_ids"] = json!([pet, far]);
        distant["stops"][0]["pet_ids"] = json!([pet, far]);
        rejected(&mut p, distant);
        // Shape: duplicate stops, a missing current stop and blank names.
        let mut twice = route(map, pet, npc, x, y);
        let first = twice["stops"][0].clone();
        twice["stops"].as_array_mut().unwrap().push(first);
        rejected(&mut p, twice);
        let mut lost = route(map, pet, npc, x, y);
        lost["current_stop_id"] = json!("s9");
        rejected(&mut p, lost);
        let mut blank = route(map, pet, npc, x, y);
        blank["name"] = json!("  ");
        rejected(&mut p, blank);
        let c = with_routes(&p, json!([route(map, pet, npc, x, y)]), Some("nope"));
        assert!(p.configure(c).is_err());
        let c = with_routes(&p, json!([route(map, pet, npc, x, y)]), Some("r1"));
        p.configure(c).unwrap();
    }

    #[test]
    fn orphaned_routes_load_and_stay_repairable_after_catalogue_changes() {
        let root = std::env::temp_dir().join(format!("aion-orphans-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let map = FARM_MAPS[0];
        let (pet, npc, x, y) = spawn_on(map, &[]);
        let mut r = route(map, pet, npc, x, y);
        // A stop and a target the bundled catalogue no longer has, as after an update.
        r["pet_ids"] = json!([pet, 999_999]);
        r["stops"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"gone","npc_id":1,"x":12,"y":34,"pet_ids":[999_999]}));
        let mut orphan = r.clone();
        orphan["id"] = json!("r2");
        orphan["map_id"] = json!("World/Retired/Map");
        orphan["stops"] = json!([{"id":"old","npc_id":2,"x":0,"y":0,"pet_ids":[999_999]}]);
        orphan["current_stop_id"] = json!("old");
        let file = json!({"schema_version":1,"config":{"revision":7,"routes":[r,orphan],"active_route_id":"r2"}});
        let bytes = file.to_string();
        validate_saved(bytes.as_bytes()).unwrap();
        fs::write(root.join("pets.json"), &bytes).unwrap();
        let mut p = Pets::default();
        p.initialize(root.clone()).unwrap();
        assert!(!p.read_only && p.error.is_none());
        assert_eq!(p.saved.config.routes.len(), 2);
        // Unchanged orphans survive other saves: rename, reorder, marks.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][1]["name"] = json!("Retired loop");
        c["routes"][1]["stops"][0]["done"] = json!(true);
        c["routes"][0]["stops"].as_array_mut().unwrap().reverse();
        c["show_maxed"] = json!(true);
        p.configure(c).unwrap();
        assert_eq!(p.saved.config.routes[1].name, "Retired loop");
        assert_eq!(p.saved.config.routes[0].stops[0].id, "gone");
        // Editing an orphaned stop is a new reference, so it must be valid now.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][0]["stops"][0]["x"] = json!(13);
        assert!(p.configure(c).is_err());
        // Moving an orphaned route onto a farming map revalidates every stop.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][1]["map_id"] = json!(map);
        assert!(p.configure(c).is_err());
        // The repair is the user's: remove the stale stop and target.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][0]["stops"].as_array_mut().unwrap().remove(0);
        c["routes"][0]["pet_ids"] = json!([pet]);
        p.configure(c).unwrap();
        let mut q = Pets::default();
        q.initialize(root.clone()).unwrap();
        assert_eq!(q.saved.config.routes[0].stops.len(), 1);
        assert_eq!(q.saved.config.routes[1].map_id, "World/Retired/Map");
        assert_eq!(q.saved.config.active_route_id.as_deref(), Some("r2"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_coordinates_and_stray_stop_pets_are_rejected_without_panicking() {
        let map = FARM_MAPS[0];
        let (pet, npc, x, y) = spawn_on(map, &[]);
        for (bx, by) in [(i64::MIN, y), (x, i64::MIN), (i64::MAX, y), (10_000_001, y)] {
            let mut r = route(map, pet, npc, x, y);
            r["stops"][0]["x"] = json!(bx);
            r["stops"][0]["y"] = json!(by);
            let file = json!({"schema_version":1,"config":{"revision":0,"routes":[r.clone()]}});
            assert!(validate_saved(file.to_string().as_bytes()).is_err());
            let mut p = Pets::default();
            assert!(p.configure(with_routes(&p, json!([r]), None)).is_err());
        }
        // The edge of the range is still a valid shape.
        let mut edge = route(map, pet, npc, x, y);
        edge["stops"][0]["x"] = json!(-10_000_000);
        let file = json!({"schema_version":1,"config":{"revision":0,"routes":[edge]}});
        validate_saved(file.to_string().as_bytes()).unwrap();
        // An unknown target kept in the route may stay on its orphaned stop.
        let mut orphan = route(map, pet, npc, x, y);
        orphan["pet_ids"] = json!([pet, 999_999]);
        orphan["stops"][0]["pet_ids"] = json!([999_999]);
        let file = json!({"schema_version":1,"config":{"revision":0,"routes":[orphan]}});
        validate_saved(file.to_string().as_bytes()).unwrap();
    }

    #[test]
    fn removing_a_target_cannot_leave_an_unchanged_stop_serving_it() {
        let mut p = Pets::default();
        let map = FARM_MAPS[0];
        let (pet, npc, x, y) = spawn_on(map, &[]);
        let (other, onpc, ox, oy) = spawn_on(map, &[pet]);
        let mut r = route(map, pet, npc, x, y);
        r["pet_ids"] = json!([pet, other]);
        r["stops"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"s2","npc_id":onpc,"x":ox,"y":oy,"pet_ids":[other]}));
        p.configure(with_routes(&p, json!([r]), Some("r1")))
            .unwrap();
        let before = p.saved.config.clone();
        // The stop is unchanged, but its pet is no longer a target of the route.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][0]["pet_ids"] = json!([pet]);
        assert!(p.configure(c).is_err());
        assert_eq!(p.saved.config, before);
        // Removing the stop with its target is accepted.
        let mut c = serde_json::to_value(&p.saved.config).unwrap();
        c["routes"][0]["pet_ids"] = json!([pet]);
        c["routes"][0]["stops"].as_array_mut().unwrap().pop();
        p.configure(c).unwrap();
        assert_eq!(p.saved.config.routes[0].stops.len(), 1);
    }

    #[test]
    fn failed_route_writes_roll_back_and_keep_the_saved_file() {
        let root = std::env::temp_dir().join(format!("aion-route-fail-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("pets.json"),
            b"{\"schema_version\":1,\"config\":7}",
        )
        .unwrap();
        let mut p = Pets::default();
        p.initialize(root.clone()).unwrap();
        assert!(p.read_only);
        let map = FARM_MAPS[0];
        let (pet, npc, x, y) = spawn_on(map, &[]);
        let before = p.saved.config.clone();
        let c = with_routes(&p, json!([route(map, pet, npc, x, y)]), Some("r1"));
        assert!(p.configure(c).is_err());
        assert_eq!(p.saved.config, before);
        assert_eq!(
            fs::read(root.join("pets.json")).unwrap(),
            b"{\"schema_version\":1,\"config\":7}"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
