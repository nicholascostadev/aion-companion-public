import {
  PET_FAMILIES,
  type PetCatalogue,
  type PetEntry,
  type PetFacing,
  type PetFamily,
  type PetFarmingGoal,
  type PetFarmingRoute,
  type PetGain,
  type PetMap,
  type PetMapArt,
  type PetMapOverview,
  type PetMapTile,
  type PetMotion,
  type PetPosition,
  type PetProfile,
  type PetProgress,
  type PetRouteStop,
  type PetSession,
  type PetSighting,
  type PetSpawn,
  type PetsConfig,
  type PetsStatus,
  type PetWindowStatus,
} from '../types/pets';

/*
 * Native pet payloads are untrusted shapes. Unknown values stay null and invalid rows
 * are dropped; nothing about a collection is guessed.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const int = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && Number.isInteger(n) ? n : null;
};
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const bool = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : fallback);
const ints = (value: unknown) =>
  list(value).flatMap((n) => {
    const v = int(n);
    return v === null ? [] : [v];
  });

const rows = <T>(value: unknown, read: (row: unknown) => T | null): T[] =>
  list(value).flatMap((row) => {
    const next = read(row);
    return next ? [next] : [];
  });

/** Native defaults, used only until the first status arrives. */
export const PETS_CONFIG_FALLBACK: PetsConfig = {
  revision: 0,
  pinned_ids: [],
  show_maxed: false,
  nearby_radius: 250,
  opacity: 0.8,
  scale: 1,
  show_toasts: true,
  farming_goal: null,
  last_map_id: null,
  routes: [],
  active_route_id: null,
};
/** Native validation ranges for `pets_configure`. */
export const PETS_LIMITS = {
  nearby_radius: [10, 5000],
  opacity: [0.15, 1],
  scale: [0.7, 2],
} as const;
/** Game growth rules, used only where the catalogue omits a level: souls to leave each level. */
export const DEFAULT_THRESHOLDS: Record<number, number> = { 0: 5, 1: 25, 2: 75, 3: 0 };

const family = (value: unknown): PetFamily | null =>
  PET_FAMILIES.includes(value as PetFamily) ? (value as PetFamily) : null;

/**
 * One string per map id. The catalogue names a map in each of its ~20,000 spawn points, and
 * every parsed name is a copy of its own; every WebView keeps the catalogue it read.
 */
type Names = Map<string, string>;
const named = (names: Names, value: unknown) => {
  const id = str(value);
  if (!id) return id;
  const known = names.get(id);
  if (known !== undefined) return known;
  names.set(id, id);
  return id;
};

function spawn(value: unknown, names: Names): PetSpawn | null {
  const v = bag(value);
  const map = named(names, v.map_id);
  const npc = int(v.npc_id);
  const x = num(v.x);
  const y = num(v.y);
  if (!map || npc === null || x === null || y === null) return null;
  return { map_id: map, npc_id: npc, x, y, z: num(v.z) ?? 0 };
}

function pet(value: unknown, names: Names): PetEntry | null {
  const v = bag(value);
  const id = int(v.id);
  const name = str(v.name)?.trim();
  const group = family(v.family);
  if (id === null || !name || !group) return null;
  return {
    id,
    name,
    family: group,
    npc_ids: ints(v.npc_ids),
    soul_item_ids: ints(v.soul_item_ids),
    shop_item_ids: ints(v.shop_item_ids),
    spawns: list(v.spawns).flatMap((s) => {
      const row = spawn(s, names);
      return row ? [row] : [];
    }),
    regions: list(v.regions).flatMap((r) => {
      const row = bag(r);
      const map = named(names, row.map_id);
      const label = str(row.name);
      return map && label ? [{ map_id: map, name: label }] : [];
    }),
  };
}

/** Only bundled map images load; nothing is fetched from the network. */
const TILE_FILE = /^\/pet-map-art\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/;
/** Matches native atlas limits with headroom; anything larger is not a real map image. */
const MAX_ART = 32768;

function tile(value: unknown): PetMapTile | null {
  const v = bag(value);
  const file = str(v.file);
  const [x, y, width, height] = [v.x, v.y, v.width, v.height].map(num);
  if (!file || !TILE_FILE.test(file) || x == null || y == null || !width || !height) return null;
  if (width <= 0 || height <= 0) return null;
  return { file, x, y, width, height };
}

function overview(value: unknown): PetMapOverview | null {
  const v = bag(value);
  const file = str(v.file);
  const [width, height] = [v.width, v.height].map(num);
  if (!file || !TILE_FILE.test(file) || !width || !height) return null;
  if (width <= 0 || height <= 0 || width > MAX_ART || height > MAX_ART) return null;
  return { file, width, height };
}

function art(value: unknown): PetMapArt | null {
  const v = bag(value);
  const [width, height, scale, x, y] = [v.width, v.height, v.scale, v.offset_x, v.offset_y].map(
    num,
  );
  if (!width || !height || !scale || x == null || y == null) return null;
  if (width <= 0 || height <= 0 || width > MAX_ART || height > MAX_ART || scale <= 0) return null;
  const tiles = rows(v.tiles, tile);
  if (!tiles.length) return null;
  return {
    width,
    height,
    scale,
    offset_x: x,
    offset_y: y,
    tiles,
    overview: overview(v.overview),
    approximate: v.approximate === true,
  };
}

function map(value: unknown): PetMap | null {
  const v = bag(value);
  const id = str(v.id);
  const bounds = list(v.bounds).map(num);
  if (!id || bounds.length !== 4 || bounds.some((b) => b === null)) return null;
  const [minX, minY, maxX, maxY] = bounds as [number, number, number, number];
  if (!(maxX > minX && maxY > minY)) return null;
  return {
    id,
    name: str(v.name)?.trim() || id,
    zone_ids: ints(v.zone_ids),
    bounds: [minX, minY, maxX, maxY],
    art: art(v.art),
  };
}

const LAYER = '/InstanceLayer/';

/**
 * An instance layer (`<map>/InstanceLayer/<layer>`) shares its parent map's coordinates, so
 * a layer without art of its own is drawn on the parent's map.
 */
function withLayerArt(maps: PetMap[]): PetMap[] {
  const art = new Map(maps.map((m) => [m.id, m.art]));
  return maps.map((m) => {
    const at = m.id.indexOf(LAYER);
    const parent = at > 0 ? art.get(m.id.slice(0, at)) : null;
    return !m.art && parent ? { ...m, art: parent } : m;
  });
}

export function normalizeCatalogue(value: unknown): PetCatalogue {
  const v = bag(value);
  const names: Names = new Map();
  const thresholds: Record<number, number> = { ...DEFAULT_THRESHOLDS };
  for (const [key, needed] of Object.entries(bag(v.thresholds))) {
    const level = Number(key);
    const n = int(needed);
    if (Number.isInteger(level) && n !== null && n >= 0) thresholds[level] = n;
  }
  return {
    version: int(v.version) ?? 0,
    pets: list(v.pets).flatMap((p) => {
      const row = pet(p, names);
      return row ? [row] : [];
    }),
    maps: withLayerArt(
      list(v.maps).flatMap((m) => {
        const row = map(m);
        return row ? [row] : [];
      }),
    ),
    npcs: list(v.npcs).flatMap((n) => {
      const row = bag(n);
      const id = int(row.id);
      const name = str(row.name);
      return id !== null && name ? [{ id, name }] : [];
    }),
    thresholds,
  };
}

function farmingGoal(value: unknown): PetFarmingGoal | null {
  const v = bag(value);
  const pet = int(v.pet_id);
  const map = str(v.map_id);
  return pet !== null && pet > 0 && map ? { pet_id: pet, map_id: map } : null;
}

/*
 * Legacy routes are read for their shape only and never shown. Every stop and target is kept
 * as it is, so the next save of any preference sends them back unchanged rather than dropping
 * saved data silently.
 */
function routeStop(value: unknown): PetRouteStop | null {
  const v = bag(value);
  const id = str(v.id);
  const npc = int(v.npc_id);
  const x = int(v.x);
  const y = int(v.y);
  if (!id || npc === null || x === null || y === null) return null;
  return { id, npc_id: npc, x, y, pet_ids: ints(v.pet_ids), done: v.done === true };
}

function route(value: unknown): PetFarmingRoute | null {
  const v = bag(value);
  const id = str(v.id);
  const name = str(v.name);
  const map = str(v.map_id);
  if (!id || name === null || !map) return null;
  const stops = rows(v.stops, routeStop);
  const current = str(v.current_stop_id);
  return {
    id,
    name,
    map_id: map,
    pet_ids: ints(v.pet_ids),
    stops,
    current_stop_id: current && stops.some((s) => s.id === current) ? current : null,
  };
}

export function normalizeConfig(value: unknown): PetsConfig {
  const v = bag(value);
  const f = PETS_CONFIG_FALLBACK;
  const routes = rows(v.routes, route);
  const active = str(v.active_route_id);
  return {
    revision: int(v.revision) ?? f.revision,
    pinned_ids: [...new Set(ints(v.pinned_ids))],
    show_maxed: bool(v.show_maxed, f.show_maxed),
    nearby_radius: num(v.nearby_radius) ?? f.nearby_radius,
    opacity: num(v.opacity) ?? f.opacity,
    scale: num(v.scale) ?? f.scale,
    show_toasts: bool(v.show_toasts, f.show_toasts),
    farming_goal: farmingGoal(v.farming_goal),
    last_map_id: str(v.last_map_id) || null,
    routes,
    active_route_id: active && routes.some((r) => r.id === active) ? active : null,
  };
}

const count = (value: unknown) => Math.max(0, int(value) ?? 0);

/** A missing or malformed session reads as no session, never as invented pickups. */
export function normalizeSession(value: unknown): PetSession {
  const v = bag(value);
  const started = num(v.started_ms);
  return {
    profile_id: str(v.profile_id) || null,
    started_ms: started !== null && started >= 0 ? started : null,
    souls_gained: count(v.souls_gained),
    level_ups: count(v.level_ups),
    obtained: count(v.obtained),
  };
}

function profile(value: unknown): PetProfile | null {
  const v = bag(value);
  const id = str(v.id);
  if (!id) return null;
  return {
    id,
    // Empty when native sent no name; views word the fallback in the interface language.
    name: str(v.name)?.trim() ?? '',
    server_id: int(v.server_id),
    synced_ms: num(v.synced_ms),
  };
}

function progress(value: unknown): PetProgress | null {
  const v = bag(value);
  const id = int(v.pet_id);
  const level = int(v.level);
  if (id === null || level === null || level < 0 || level > 3) return null;
  return {
    pet_id: id,
    level,
    progress: Math.max(0, int(v.progress) ?? 0),
    observed_ms: num(v.observed_ms) ?? 0,
    progress_estimated: v.progress_estimated === true,
  };
}

function sighting(value: unknown): PetSighting | null {
  const v = bag(value);
  const entity = int(v.entity_id);
  const npc = int(v.npc_id);
  if (entity === null || npc === null) return null;
  const distance = num(v.distance);
  const bearing = num(v.bearing);
  return {
    entity_id: entity,
    npc_id: npc,
    name: str(v.name)?.trim() ?? '',
    pet_ids: ints(v.pet_ids),
    x: num(v.x),
    y: num(v.y),
    distance: distance !== null && distance >= 0 ? distance : null,
    bearing: bearing === null ? null : ((bearing % 360) + 360) % 360,
    observed_ms: num(v.observed_ms) ?? 0,
  };
}

function position(value: unknown): PetPosition | null {
  const v = bag(value);
  const x = num(v.x);
  const y = num(v.y);
  if (x === null || y === null) return null;
  return {
    zone_id: int(v.zone_id),
    map_id: str(v.map_id),
    x,
    y,
    observed_ms: num(v.observed_ms) ?? 0,
  };
}

function facing(value: unknown): PetFacing | null {
  const v = bag(value);
  const degrees = num(v.degrees);
  const observed = num(v.observed_ms);
  return degrees !== null && Math.abs(degrees) <= 720 && observed !== null && observed >= 0
    ? { degrees: ((degrees % 360) + 360) % 360, observed_ms: observed }
    : null;
}

function gain(value: unknown): PetGain | null {
  const v = bag(value);
  const id = str(v.id);
  const pet = int(v.pet_id);
  const gained = int(v.gained);
  const at = num(v.at_ms);
  if (!id || pet === null || gained === null || gained <= 0 || at === null) return null;
  return { id, pet_id: pet, gained, at_ms: at };
}

export function normalizeMotion(value: unknown): PetMotion {
  const v = bag(value);
  return {
    profile_id: str(v.profile_id),
    active_profile_id: str(v.active_profile_id),
    running: bool(v.running),
    now_ms: num(v.now_ms) ?? 0,
    position: position(v.position),
    last_position: position(v.last_position),
    facing: facing(v.facing),
  };
}

export function normalizeStatus(value: unknown): PetsStatus {
  const v = bag(value);
  return {
    revision: int(v.revision) ?? 0,
    now_ms: num(v.now_ms) ?? Date.now(),
    running: bool(v.running),
    phase: str(v.phase) ?? '',
    message: str(v.message) ?? '',
    profile_id: str(v.profile_id),
    active_profile_id: str(v.active_profile_id),
    profiles: rows(v.profiles, profile),
    collection_synced: bool(v.collection_synced),
    live_synced: bool(v.live_synced),
    active_pet_id: int(v.active_pet_id),
    progress: rows(v.progress, progress),
    nearby: rows(v.nearby, sighting),
    position: position(v.position),
    last_position: position(v.last_position),
    facing: facing(v.facing),
    gains: rows(v.gains, gain),
    session: normalizeSession(v.session),
    config: normalizeConfig(v.config),
    error: str(v.error) || null,
    bearing_reference: str(v.bearing_reference) ?? '',
  };
}

export function normalizeWindowStatus(value: unknown): PetWindowStatus {
  const v = bag(value);
  return {
    requested: bool(v.requested),
    visible: bool(v.visible),
    ready: bool(v.ready),
    locked: bool(v.locked),
    game_active: bool(v.game_active),
    errors: list(v.errors).flatMap((e) => (typeof e === 'string' && e ? [e] : [])),
  };
}
