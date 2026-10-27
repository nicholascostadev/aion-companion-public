/* Pet collection and live radar payloads (native `pets_*` commands). */

export const PET_FAMILIES = ['Cognia', 'Fera', 'Natura', 'Varia', 'Specia'] as const;
export type PetFamily = (typeof PET_FAMILIES)[number];

/** One static spawn record from the catalogue: game coordinates in centimetres. */
export interface PetSpawn {
  map_id: string;
  npc_id: number;
  x: number;
  y: number;
  z: number;
}

export interface PetEntry {
  id: number;
  name: string;
  family: PetFamily;
  /** Source monsters whose defeat can drop this pet's souls. */
  npc_ids: number[];
  soul_item_ids: number[];
  shop_item_ids: number[];
  spawns: PetSpawn[];
  regions: { map_id: string; name: string }[];
}

/** One original map image, placed in map-image pixels. */
export interface PetMapTile {
  /** Bundled local image: `/pet-map-art/<hash>.webp`. */
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The whole map canvas downsampled from its original tiles, drawn over the full canvas while
 * the native tiles would add no detail on screen.
 */
export interface PetMapOverview {
  /** Bundled local image: `/pet-map-art/<hash>.webp`. */
  file: string;
  /** Intrinsic image size in pixels. */
  width: number;
  height: number;
}

/**
 * Original map imagery and its calibration: pixel = offset + scale × world coordinate, in
 * native canvas pixels. The tiles are the game's own map textures at native resolution.
 */
export interface PetMapArt {
  /** Native canvas size in pixels; the drawing space of the map. */
  width: number;
  height: number;
  scale: number;
  offset_x: number;
  offset_y: number;
  tiles: PetMapTile[];
  /** Low-resolution copy of the whole canvas; null draws the native tiles at every zoom. */
  overview: PetMapOverview | null;
  /** The calibration is a provisional fit, not verified against the canvas. */
  approximate: boolean;
}

export interface PetMap {
  id: string;
  name: string;
  /** Verified numeric zone ids; empty when no unambiguous match exists. */
  zone_ids: number[];
  /** `[min_x, min_y, max_x, max_y]` in game coordinates. */
  bounds: [number, number, number, number];
  /** Original map art (an instance layer borrows its parent's); null draws a chart. */
  art: PetMapArt | null;
}

export interface PetCatalogue {
  version: number;
  pets: PetEntry[];
  maps: PetMap[];
  npcs: { id: number; name: string }[];
  /** Souls needed to leave each level; level 3 is the maximum (0). */
  thresholds: Record<number, number>;
}

export interface PetProfile {
  id: string;
  /** Character name; empty when native sent none. */
  name: string;
  server_id: number | null;
  synced_ms: number | null;
}

export interface PetProgress {
  pet_id: number;
  level: number;
  progress: number;
  observed_ms: number;
  /** True when advancing a saved baseline before a current-connection collection sync. */
  progress_estimated?: boolean;
}

/** A live source monster seen by capture; distance in metres, bearing in coordinate degrees. */
export interface PetSighting {
  entity_id: number;
  npc_id: number;
  /** Monster name; empty when native sent none (see `nearbyRows`). */
  name: string;
  pet_ids: number[];
  x: number | null;
  y: number | null;
  distance: number | null;
  bearing: number | null;
  observed_ms: number;
}

export interface PetPosition {
  zone_id: number | null;
  map_id: string | null;
  x: number;
  y: number;
  observed_ms: number;
}

/** Last own skill's facing in coordinate degrees: 0 = +X, 90 = +Y. */
export interface PetFacing {
  degrees: number;
  observed_ms: number;
}

/** Lightweight spatial state, refreshed separately from collection and preferences. */
export interface PetMotion {
  profile_id: string | null;
  active_profile_id: string | null;
  running: boolean;
  now_ms: number;
  position: PetPosition | null;
  last_position: PetPosition | null;
  /** Absent on older native builds. Independent of position freshness. */
  facing?: PetFacing | null;
}

export interface PetGain {
  id: string;
  pet_id: number;
  gained: number;
  at_ms: number;
}

/** A pet the user is farming on one map; shared by every window. */
export interface PetFarmingGoal {
  pet_id: number;
  map_id: string;
}

/**
 * One stop of a saved farming route (legacy: the app no longer shows or edits routes), as
 * native stores it, anchored to a catalogue spawn record on the route's map.
 */
export interface PetRouteStop {
  id: string;
  npc_id: number;
  /** Game centimetres, exactly as in the catalogue. */
  x: number;
  y: number;
  /** Route targets with a static point within the stop radius of the anchor. */
  pet_ids: number[];
  /** Marked done by the user. */
  done: boolean;
}

/** A farming route saved by an earlier version; kept only so saves never drop it. */
export interface PetFarmingRoute {
  id: string;
  name: string;
  map_id: string;
  /** Pets the route farms. */
  pet_ids: number[];
  stops: PetRouteStop[];
  current_stop_id: string | null;
}

export interface PetsConfig {
  revision: number;
  pinned_ids: number[];
  show_maxed: boolean;
  /** Metres. */
  nearby_radius: number;
  opacity: number;
  scale: number;
  show_toasts: boolean;
  /** Native requires the pet to spawn on the map; null when not farming. */
  farming_goal: PetFarmingGoal | null;
  /** Map last chosen in the workspace; null when none was chosen. */
  last_map_id: string | null;
  /**
   * Routes saved by an earlier version, kept as native sent them so a save of any other
   * preference sends them back unchanged. The app no longer shows, follows or edits them.
   */
  routes: PetFarmingRoute[];
  /** Legacy route marked as followed, kept unchanged like `routes`. */
  active_route_id: string | null;
}

/**
 * Pickups of the current capture connection for one profile. Collection syncs only set
 * the baseline; nothing here is estimated.
 */
export interface PetSession {
  /** Profile counted; null when no session belongs to the status profile. */
  profile_id: string | null;
  started_ms: number | null;
  souls_gained: number;
  level_ups: number;
  /** Pets that went from not owned to owned. */
  obtained: number;
}

export interface PetsStatus {
  facing?: PetFacing | null;
  revision: number;
  now_ms: number;
  running: boolean;
  phase: string;
  message: string;
  /** Profile this status describes; null when none is known. */
  profile_id: string | null;
  /** Profile of the character currently logged in, while capture identifies it. */
  active_profile_id: string | null;
  profiles: PetProfile[];
  /** The full collection of `profile_id` was received at least once. */
  collection_synced: boolean;
  /** A complete collection was received on the current connection. */
  live_synced: boolean;
  active_pet_id: number | null;
  progress: PetProgress[];
  nearby: PetSighting[];
  /** Own position observed in the last 15 s; distances and directions need it. */
  position: PetPosition | null;
  /**
   * Last observed own position of the character playing now, on this connection, however
   * old; null when stopped, for another profile, or after a reconnect or zone change without
   * coordinates. Only for a last-known map and marker, never for distances or directions.
   * Absent from older native builds, read as null.
   */
  last_position: PetPosition | null;
  gains: PetGain[];
  session: PetSession;
  config: PetsConfig;
  error: string | null;
  bearing_reference: string;
}

/** Native state of the in-game pet radar window. */
export interface PetWindowStatus {
  /** User asked for the window; it still only shows while the game is focused. */
  requested: boolean;
  visible: boolean;
  ready: boolean;
  /** Click-through except its own controls. */
  locked: boolean;
  /** AION (or one of our overlays over it) is focused. */
  game_active: boolean;
  errors: string[];
}
