/**
 * Experimental nearby Hidden Cube observations, as native reports them (`cubes_status`).
 * Only objects this capture session has received are listed: a sighting is when a cube was
 * first received nearby, never when it spawned, and nothing is known about cubes out of range.
 */
export type CubeState = 'observed' | 'opening' | 'opened' | 'out_of_view' | 'removed' | 'stale';

export const CUBE_STATES: readonly CubeState[] = [
  'observed',
  'opening',
  'opened',
  'out_of_view',
  'removed',
  'stale',
];

export interface CubePosition {
  x: number;
  y: number;
  /** Null when the position record carried no height. */
  z: number | null;
  observed_ms: number;
}

/**
 * Your character's facing from its last own skill, in coordinate degrees: 0 = +X, 90 = +Y
 * (not the cube bearing's map-up zero). Native drops it 10 s after it was observed.
 */
export interface CubeFacing {
  degrees: number;
  observed_ms: number;
}

export interface CubeObservation {
  id: number;
  template_id: number;
  x: number;
  y: number;
  z: number;
  first_seen_ms: number;
  last_seen_ms: number;
  status: CubeState;
  /** Whether the local character opened it; null when unknown. */
  opened_by_local: boolean | null;
  /** Planar metres from a fresh confirmed position; null without one. */
  distance_m: number | null;
  /** Metres above (positive) or below (negative) you; null without a fresh height. */
  height_m: number | null;
  /** Coordinate direction from you: 0° = −Y (map up), 90° = +X; null without a position. */
  bearing_deg: number | null;
}

export interface CubesStatus {
  running: boolean;
  phase: string;
  message: string;
  experimental: true;
  session_id: string;
  revision: number;
  zone_id: number | null;
  map_id: string | null;
  /**
   * Native's clock when this status was read, the reference for every observation time in
   * it; null from a native that does not report it (then no facing is drawn).
   */
  now_ms: number | null;
  /** Null while stale, without a local identity or while capture is stopped. */
  position: CubePosition | null;
  /** Age of the last own position, which may remain after the position itself is dropped. */
  position_age_ms: number | null;
  /**
   * Your last own position in the current context, kept after `position` goes stale; null
   * without one. Never fresh enough for distances.
   */
  last_position: CubePosition | null;
  /** Your fresh facing (see `CubeFacing`); null when unknown or older than 10 s. */
  facing: CubeFacing | null;
  /** At most 128 rows, actionable nearest first, then most recent. */
  cubes: CubeObservation[];
  observed_total: number;
  opened_total: number;
}
