import type { Formatters } from '../../i18n/formatters';
import type { CubeObservation, CubeState, CubesStatus } from '../../types/cubes';

/** How long a newly received cube keeps its "new" mark. */
export const NEW_MS = 8_000;
/** A height difference smaller than this reads as the same level. */
export const LEVEL_M = 2;
/**
 * Ids remembered per session to tell a new cube from one coming back into view. The oldest
 * are forgotten past this, so a very long session stays bounded; a forgotten id that
 * returns only counts as new once more.
 */
export const SEEN_LIMIT = 2048;

/** Where capture is, in the words the cube finder shows. */
export type CubeCapture =
  | 'preview'
  | 'loading'
  | 'starting'
  | 'waiting'
  | 'stopped'
  | 'error'
  | 'capturing';

/**
 * Capture state from the status and the last read failure. `running` may already be true
 * while native waits for the game, so the phase decides the waiting word.
 */
export function captureOf(
  status: Pick<CubesStatus, 'running' | 'phase'> | null,
  { native, error }: { native: boolean; error: string },
): CubeCapture {
  if (!native) return 'preview';
  if (error) return 'error';
  if (!status) return 'loading';
  if (status.phase === 'error') return 'error';
  if (status.phase === 'waiting_for_game') return 'waiting';
  if (status.phase === 'stopped') return 'stopped';
  if (status.running && status.phase === 'capturing') return 'capturing';
  return 'starting';
}

/** Own position: fresh (distances are live), last known (only its age) or never seen. */
export type CubePositionState = 'fresh' | 'stale' | 'unknown';

export function positionOf(
  status: Pick<CubesStatus, 'position' | 'position_age_ms'> | null,
): CubePositionState {
  if (status?.position) return 'fresh';
  return status?.position_age_ms !== null && status?.position_age_ms !== undefined
    ? 'stale'
    : 'unknown';
}

/** A cube that may still be there to open. */
export const actionable = (state: CubeState) => state === 'observed' || state === 'opening';

/** Rows split for display, keeping native's order (actionable nearest first, then recent). */
export function splitCubes(cubes: readonly CubeObservation[]) {
  return {
    active: cubes.filter((c) => actionable(c.status)),
    past: cubes.filter((c) => !actionable(c.status)),
  };
}

/** Which cubes this window has seen arrive, per native session. */
export interface DetectionTracker {
  session: string | null;
  seen: ReadonlySet<number>;
  /** Cube id → local time it first arrived after the first snapshot. */
  arrived: ReadonlyMap<number, number>;
}

export const NO_DETECTIONS: DetectionTracker = {
  session: null,
  seen: new Set(),
  arrived: new Map(),
};

/**
 * Marks cubes that first appear after the first snapshot of a session. The first snapshot
 * of every session (a new window, Clear, a reconnect) never counts as new, and an id that
 * comes back into view in the same session is not new again. Marks expire after `NEW_MS`.
 * Returns the same object when nothing changed.
 */
export function trackDetections(
  tracker: DetectionTracker,
  status: CubesStatus,
  now: number,
): DetectionTracker {
  if (tracker.session !== status.session_id)
    return {
      session: status.session_id,
      seen: new Set(status.cubes.map((c) => c.id).slice(0, SEEN_LIMIT)),
      arrived: new Map(),
    };
  let seen: Set<number> | null = null;
  let arrived: Map<number, number> | null = null;
  for (const c of status.cubes) {
    if (tracker.seen.has(c.id)) continue;
    seen ??= new Set(tracker.seen);
    arrived ??= new Map(tracker.arrived);
    seen.add(c.id);
    if (actionable(c.status)) arrived.set(c.id, now);
  }
  for (const [id, at] of arrived ?? tracker.arrived) {
    if (now - at < NEW_MS) continue;
    arrived ??= new Map(tracker.arrived);
    arrived.delete(id);
  }
  if (seen && seen.size > SEEN_LIMIT) {
    // Oldest first, never one native still lists, so a listed cube never flashes again.
    const listed = new Set(status.cubes.map((c) => c.id));
    for (const id of seen) {
      if (seen.size <= SEEN_LIMIT) break;
      if (!listed.has(id)) seen.delete(id);
    }
  }
  if (!seen && !arrived) return tracker;
  return {
    session: tracker.session,
    seen: seen ?? tracker.seen,
    arrived: arrived ?? tracker.arrived,
  };
}

/** Ids still wearing the "new" mark at `now`. */
export function freshIds(tracker: DetectionTracker, now: number): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const [id, at] of tracker.arrived) if (now - at < NEW_MS) ids.add(id);
  return ids;
}

/** Metres or kilometres for a known distance. */
export function metres(distance: number, fmt: Formatters) {
  if (distance < 1000) return `${fmt.integer.format(Math.round(distance))} m`;
  const digits = distance >= 10_000 ? 0 : 1;
  const km = fmt.numberWith({ minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${km.format(distance / 1000)} km`;
}

export type Level = 'above' | 'below' | 'level';

/** Above, below or level with you; null when the height difference is unknown. */
export function levelOf(height: number | null): Level | null {
  if (height === null) return null;
  if (Math.abs(height) < LEVEL_M) return 'level';
  return height > 0 ? 'above' : 'below';
}

/** Short elapsed time: 12 s, 4 min, 2 h. */
export function elapsed(ms: number, fmt: Formatters) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${fmt.integer.format(s)} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${fmt.integer.format(m)} min`;
  return `${fmt.integer.format(Math.round(m / 60))} h`;
}
