import type { CubeObservation, CubeState, CubesStatus } from '../types/cubes';
import { FAILING, FRESH, LONG, STILL } from './mockScenario';

/*
 * DEV ONLY. A native-shaped nearby-cube session: the character walks a loop (22 s walking,
 * 8 s standing, using a skill every 4 s so its facing is known) while cubes arrive in range every 15 s (a few already there when the window opens), some
 * are opened (by you or another player), some leave view. Opened and gone rows drop after
 * 30 s and every row after 5 min, like native. `?mock=fresh` waits for the game,
 * `?mock=still` has no fresh position (distances unknown), `?mock=failing` is a capture
 * error and `?mock=long` keeps many cubes in range.
 */

const START = Date.now();
/** World units per metre (about 100). */
const UNITS = 100;
const EVERY_S = LONG ? 2 : 15;
const HISTORY_S = 300;
const TERMINAL_S = 30;

let session = 1;
let clearedS = -Infinity;
let revision = 0;

/** Deterministic noise in [0, 1) for spot `k`. */
const noise = (k: number, salt: number) => {
  const v = Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** Walking seconds in every 30 s, and the loop's radius in world units. */
const WALK_S = 22;
const RADIUS = 2500;

/** Angle along the loop at `t` s: one loop per minute of walking. */
function along(t: number) {
  const cycle = Math.floor(t / 30);
  const walked = cycle * WALK_S + Math.min(t - cycle * 30, WALK_S);
  return (walked / 60) * Math.PI * 2;
}

function player(t: number) {
  const a = along(t);
  return { x: -50_000 + Math.cos(a) * RADIUS, y: 126_000 + Math.sin(a) * RADIUS, z: 15_200 };
}

/** The facing of the last skill, in coordinate degrees (0 = +X, 90 = +Y), and when. */
function facing(t: number) {
  const at = Math.floor(t / 4) * 4;
  const a = along(at);
  // Along the walk; a quarter turn to the right while standing.
  const standing = at - Math.floor(at / 30) * 30 >= WALK_S;
  const degrees = (Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI + (standing ? 90 : 0);
  return { degrees: ((degrees % 360) + 360) % 360, observed_ms: START + at * 1000 };
}

interface Spot {
  k: number;
  appear: number;
  x: number;
  y: number;
  z: number;
}

const spot = (k: number): Spot => {
  const angle = noise(k, 1) * Math.PI * 2;
  const reach = (25 + noise(k, 2) * 110) * UNITS;
  const origin = player(-90 + k * EVERY_S);
  return {
    k,
    appear: -90 + k * EVERY_S,
    x: origin.x + Math.sin(angle) * reach,
    y: origin.y - Math.cos(angle) * reach,
    z: origin.z + (noise(k, 3) - 0.45) * 30 * UNITS,
  };
};

/** Lifecycle of spot `k` at `t` s, and when it last changed. */
function lifecycle(s: Spot, t: number): { state: CubeState; at: number; local: boolean | null } {
  const kind = s.k % 4;
  if (kind === 1) {
    if (t >= s.appear + 24) return { state: 'opened', at: s.appear + 24, local: s.k % 8 === 1 };
    if (t >= s.appear + 20) return { state: 'opening', at: s.appear + 20, local: null };
  }
  if (kind === 2 && t >= s.appear + 40)
    return { state: 'out_of_view', at: s.appear + 40, local: null };
  return { state: 'observed', at: t, local: null };
}

const actionable = (state: CubeState) => state === 'observed' || state === 'opening';

export function cubesStatus(): CubesStatus {
  const t = (Date.now() - START) / 1000;
  revision += 1;
  const base = {
    experimental: true as const,
    session_id: `mock-${session}`,
    revision,
    zone_id: 1010,
    map_id: 'World/World_L/World_L_A',
    now_ms: Date.now(),
  };
  if (FRESH)
    return {
      ...base,
      running: true,
      phase: 'waiting_for_game',
      message: '',
      position: null,
      position_age_ms: null,
      last_position: null,
      facing: null,
      cubes: [],
      observed_total: 0,
      opened_total: 0,
    };
  if (FAILING)
    return {
      ...base,
      running: false,
      phase: 'error',
      message: 'Capture failed to open the network adapter (mock)',
      position: null,
      position_age_ms: 42_000,
      last_position: null,
      facing: null,
      cubes: [],
      observed_total: 0,
      opened_total: 0,
    };
  const me = player(t);
  const rows: CubeObservation[] = [];
  let observed = 0;
  let opened = 0;
  const last = Math.floor((t + 90) / EVERY_S);
  for (let k = Math.max(0, last - Math.ceil(HISTORY_S / EVERY_S)); k <= last; k++) {
    const s = spot(k);
    if (s.appear > t || s.appear <= clearedS) continue;
    const life = lifecycle(s, t);
    observed += 1;
    if (life.state === 'opened') opened += 1;
    if (!actionable(life.state) && t - life.at > TERMINAL_S) continue;
    const fresh = !STILL && actionable(life.state);
    const dx = s.x - me.x;
    const dy = s.y - me.y;
    const now = START + t * 1000;
    rows.push({
      id: 70_000 + k,
      template_id: k % 3 === 0 ? 1200041 : 1200039,
      x: s.x,
      y: s.y,
      z: s.z,
      first_seen_ms: START + s.appear * 1000,
      last_seen_ms: actionable(life.state) ? now : START + life.at * 1000,
      status: life.state,
      opened_by_local: life.state === 'opened' ? life.local : null,
      distance_m: fresh ? Math.hypot(dx, dy) / UNITS : null,
      height_m: fresh ? (s.z - me.z) / UNITS : null,
      bearing_deg: fresh ? ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 : null,
    });
  }
  rows.sort((a, b) => {
    const aa = actionable(a.status);
    const ba = actionable(b.status);
    if (aa !== ba) return aa ? -1 : 1;
    if (aa && a.distance_m !== null && b.distance_m !== null) return a.distance_m - b.distance_m;
    return b.last_seen_ms - a.last_seen_ms;
  });
  // Received 200 ms ago; standing still last seen 42 s before the session began.
  const seen = player(t - 0.2);
  const here = { x: seen.x, y: seen.y, z: seen.z, observed_ms: Date.now() - 200 };
  const before = player(-42);
  const earlier = { x: before.x, y: before.y, z: before.z, observed_ms: START - 42_000 };
  return {
    ...base,
    running: true,
    phase: 'capturing',
    message: '',
    position: STILL ? null : here,
    position_age_ms: STILL ? 42_000 + t * 1000 : 200,
    last_position: STILL ? earlier : here,
    facing: STILL ? null : facing(t),
    cubes: rows.slice(0, 128),
    observed_total: observed,
    opened_total: opened,
  };
}

/** Forgets the tracked cubes; only cubes arriving from now on are listed. */
export function clearCubes(): CubesStatus {
  session += 1;
  clearedS = (Date.now() - START) / 1000;
  return cubesStatus();
}
