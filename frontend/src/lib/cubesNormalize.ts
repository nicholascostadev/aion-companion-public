import {
  CUBE_STATES,
  type CubeFacing,
  type CubeObservation,
  type CubePosition,
  type CubeState,
  type CubesStatus,
} from '../types/cubes';

/*
 * Native cube payloads are untrusted shapes. Unknown values stay null, rows without an
 * identity or coordinates are dropped and nothing about distance or height is guessed.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const int = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && Number.isInteger(n) ? n : null;
};
const nonNegative = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
};
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Native reports at most this many rows. */
export const MAX_CUBE_ROWS = 128;

const isState = (value: unknown): value is CubeState =>
  typeof value === 'string' && (CUBE_STATES as readonly string[]).includes(value);

/** Coordinates beyond this many centimetres from the origin are not a place on any map. */
const MAX_COORDINATE = 10_000_000;
/** Native keeps a facing this long after the skill that showed it. */
export const FACING_TTL_MS = 10_000;
/** An own position older than this is no longer fresh enough to measure from. */
export const POSITION_FRESH_MS = 15_000;

const coordinate = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && Math.abs(n) <= MAX_COORDINATE ? n : null;
};

/** Observed at or before `now` (native's clock), when that is known; never in the future. */
const past = (observed: number, now: number | null) =>
  observed >= 0 && (now === null || observed <= now);

function position(value: unknown, now: number | null): CubePosition | null {
  const p = bag(value);
  const x = coordinate(p.x);
  const y = coordinate(p.y);
  const observed = num(p.observed_ms);
  if (x === null || y === null || observed === null || !past(observed, now)) return null;
  return { x, y, z: coordinate(p.z), observed_ms: observed };
}

/**
 * Coordinate yaw (0 = +X, 90 = +Y) turned into [0, 360). Only a facing native's own clock
 * shows to be at most 10 s old is kept: without that clock its age is unknown.
 */
function facing(value: unknown, now: number | null): CubeFacing | null {
  const f = bag(value);
  const degrees = num(f.degrees);
  const observed = num(f.observed_ms);
  if (degrees === null || Math.abs(degrees) > 720 || observed === null || now === null) return null;
  if (!past(observed, now) || now - observed > FACING_TTL_MS) return null;
  return { degrees: ((degrees % 360) + 360) % 360, observed_ms: observed };
}

/** A cube that may still be there; only these are measured from you. */
const measurable = (state: CubeState) => state === 'observed' || state === 'opening';

/**
 * The same status with no measurement from you: no own position (fresh or last), no facing
 * and no distance, height or direction on any row. Rows, lifecycle and the last position's
 * age stay.
 */
export function withoutGeometry(status: CubesStatus): CubesStatus {
  return {
    ...status,
    position: null,
    last_position: null,
    facing: null,
    cubes: status.cubes.map((c) => ({ ...c, distance_m: null, height_m: null, bearing_deg: null })),
  };
}

function cube(value: unknown, measured: boolean): CubeObservation | null {
  const c = bag(value);
  const id = int(c.id);
  const template = int(c.template_id);
  const x = num(c.x);
  const y = num(c.y);
  const z = num(c.z);
  const first = num(c.first_seen_ms);
  if (id === null || template === null || x === null || y === null || z === null || first === null)
    return null;
  // An unrecognised lifecycle word is not claimed to be anything better than stale.
  const status = isState(c.status) ? c.status : 'stale';
  // Measurements need a fresh own position and a cube that may still be there.
  const geometry = measured && measurable(status);
  const distance = geometry ? nonNegative(c.distance_m) : null;
  const bearing = geometry && distance !== null ? num(c.bearing_deg) : null;
  return {
    id,
    template_id: template,
    x,
    y,
    z,
    first_seen_ms: first,
    last_seen_ms: Math.max(first, num(c.last_seen_ms) ?? first),
    status,
    opened_by_local: typeof c.opened_by_local === 'boolean' ? c.opened_by_local : null,
    distance_m: distance,
    height_m: geometry && distance !== null ? num(c.height_m) : null,
    bearing_deg: bearing === null ? null : ((bearing % 360) + 360) % 360,
  };
}

/** A safe status from whatever native sent; capture that is not running lists nothing. */
export function normalizeCubesStatus(value: unknown): CubesStatus {
  const s = bag(value);
  const running = s.running === true;
  const now = nonNegative(s.now_ms);
  const reported = running ? position(s.position, now) : null;
  // Fresh only while at most 15 s old: by native's clock, else (an older native) by the age
  // it reported. A stale one measures nothing and is not kept as your last position either.
  const age =
    reported && (now !== null ? now - reported.observed_ms : nonNegative(s.position_age_ms));
  const own = reported && (age === null || age <= POSITION_FRESH_MS) ? reported : null;
  const last = running ? position(s.last_position, now) : null;
  const seen = new Set<number>();
  const cubes: CubeObservation[] = [];
  // Only the first rows native may send are read, however large the payload.
  const input = running && Array.isArray(s.cubes) ? s.cubes : [];
  for (let i = 0; i < input.length && i < MAX_CUBE_ROWS; i++) {
    const next = cube(input[i], own !== null);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    cubes.push(next);
  }
  return {
    running,
    phase: str(s.phase) ?? '',
    message: str(s.message) ?? '',
    experimental: true,
    session_id: str(s.session_id) ?? '',
    revision: int(s.revision) ?? 0,
    zone_id: int(s.zone_id),
    map_id: str(s.map_id) || null,
    now_ms: now,
    position: own,
    position_age_ms: nonNegative(s.position_age_ms),
    // A fresh position is also the last one, whatever an older native sent.
    last_position: last ?? own,
    // Your facing belongs to a position of yours in this context; it never stands alone.
    facing: running && (own || last) ? facing(s.facing, now) : null,
    cubes,
    observed_total: Math.max(0, int(s.observed_total) ?? 0),
    opened_total: Math.max(0, int(s.opened_total) ?? 0),
  };
}

export const EMPTY_CUBES_STATUS: CubesStatus = normalizeCubesStatus({});
