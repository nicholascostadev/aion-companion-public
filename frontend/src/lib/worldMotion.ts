import type { CubesStatus } from '../types/cubes';
import type { WorldMotionStatus } from '../types/worldMotion';
import { normalizeCubesStatus } from './cubesNormalize';

/**
 * A safe motion status from whatever native sent, by the very rules of a cube status (a
 * stale position measures nothing, a facing lasts 10 s by native's clock, capture that is not
 * running places nothing). Cubes and totals are not part of it, even if native sent them.
 */
export function normalizeWorldMotion(value: unknown): WorldMotionStatus {
  const s = normalizeCubesStatus(value);
  return {
    running: s.running,
    phase: s.phase,
    message: s.message,
    session_id: s.session_id,
    revision: s.revision,
    zone_id: s.zone_id,
    map_id: s.map_id,
    now_ms: s.now_ms,
    position: s.position,
    position_age_ms: s.position_age_ms,
    last_position: s.last_position,
    facing: s.facing,
  };
}

/** Native's `{capture epoch ms}:{context counter}`; null for any other id (e.g. a test's). */
function contextOf(sessionId: string | null): [number, number] | null {
  const match = sessionId ? /^(\d+):(\d+)$/.exec(sessionId) : null;
  if (!match) return null;
  const [epoch, counter] = [Number(match[1]), Number(match[2])];
  return Number.isSafeInteger(epoch) && Number.isSafeInteger(counter) ? [epoch, counter] : null;
}

/**
 * How `next`'s context is ordered against `previous`'s: negative when it is older, 0 when it
 * is the very same, positive when newer, null when nothing says. Within one capture every
 * Clear, zone change and reset counts the context up; a capture that starts again has a later
 * epoch. Ids native did not format fall back to native's clock, strictly.
 */
function contextOrder(next: WorldMotionStatus, previous: WorldMotionStatus): number | null {
  if (next.session_id === previous.session_id) return 0;
  const [a, b] = [contextOf(next.session_id), contextOf(previous.session_id)];
  if (a && b) return a[0] === b[0] ? Math.sign(a[1] - b[1]) : Math.sign(a[0] - b[0]);
  if (next.now_ms === null || previous.now_ms === null || next.now_ms === previous.now_ms) {
    return null;
  }
  return Math.sign(next.now_ms - previous.now_ms);
}

/**
 * True when `next` is known to be older native state than `previous`: of an older context (see
 * `contextOrder`; also when both were read in the same millisecond), or within one context of
 * an older revision (every own fix, Clear and cube change counts), then by native's clock (a
 * position or facing that expired since). Unordered contexts are not known to be older.
 */
export function isOlder(next: WorldMotionStatus, previous: WorldMotionStatus): boolean {
  const order = contextOrder(next, previous);
  if (order !== 0) return order !== null && order < 0;
  const clock = next.now_ms !== null && previous.now_ms !== null && next.now_ms < previous.now_ms;
  return next.revision < previous.revision || (next.revision === previous.revision && clock);
}

/** The same context with nothing of yours in it. */
const withoutYou = (status: WorldMotionStatus): WorldMotionStatus => ({
  ...status,
  position: null,
  position_age_ms: null,
  last_position: null,
  facing: null,
});

/**
 * Where you are drawn from: native's pushed motion while it is at least as new as the cube
 * status and of its very context (session, zone and map), else the cube status. The cube
 * status still owns the map, the cubes and every distance, so a late poll never moves you
 * back, and an older motion read never moves you either. Motion already in a newer context
 * (another zone, a Clear, a new capture), or one whose order is not known, hides you until
 * the cube status reaches it: neither your old position nor the new one is drawn with the
 * other context's map and cubes.
 */
export function shownMotion(
  status: CubesStatus | null,
  motion: WorldMotionStatus | null,
): WorldMotionStatus | null {
  if (!status || !motion) return status;
  const same =
    motion.session_id === status.session_id &&
    motion.zone_id === status.zone_id &&
    motion.map_id === status.map_id;
  if (same) return isOlder(motion, status) ? status : motion;
  return isOlder(motion, status) ? status : withoutYou(status);
}
