/** A measured own position, as a map draws it; every field is native's and stays immutable. */
export interface MotionFix {
  zone_id: number | null;
  map_id: string | null;
  x: number;
  y: number;
  observed_ms: number;
  /**
   * Anything else movement must never be bridged across, such as a capture session: two fixes
   * of different sessions are never animated between, however continuous they look.
   */
  session?: string | null;
}

/** A fix as drawn: possibly a short, bounded estimate ahead of or towards the measured one. */
export type MapPosition<T extends MotionFix = MotionFix> = T & {
  estimated: boolean;
  /** Distance from the most recent measured fix, in metres; a visual uncertainty cue. */
  uncertainty_m: number;
};

const CORRECTION_MS = 200;
const MAX_GAP_MS = 2500;
const MAX_PREDICTION_MS = 1200;
const MAX_TRAVEL = 1500; // centimetres: prediction stops after 15 metres
const MAX_SPEED = 2.5; // centimetres/ms: reject implausible velocity, do not amplify it

/** A fix with finite coordinates and observation time; anything else is no fix at all. */
export const usableFix = <T extends MotionFix>(fix: T | null): T | null =>
  fix && Number.isFinite(fix.x) && Number.isFinite(fix.y) && Number.isFinite(fix.observed_ms)
    ? fix
    : null;

export const confirmedPosition = <T extends MotionFix>(
  position: T | null,
): MapPosition<T> | null => (position ? { ...position, estimated: false, uncertainty_m: 0 } : null);

const sameContext = (a: MotionFix, b: MotionFix) =>
  a.map_id === b.map_id && a.zone_id === b.zone_id && (a.session ?? null) === (b.session ?? null);

export function canAnimatePosition(from: MotionFix | null, to: MotionFix | null) {
  return (
    !!from &&
    !!to &&
    sameContext(from, to) &&
    to.observed_ms >= from.observed_ms &&
    to.observed_ms - from.observed_ms <= MAX_GAP_MS &&
    Math.hypot(to.x - from.x, to.y - from.y) <= 4000
  );
}

interface Motion<T extends MotionFix> {
  fix: T;
  from: MotionFix;
  received: number;
  age: number;
  duration: number;
  vx: number;
  vy: number;
  horizon: number;
}

/**
 * Display-only dead reckoning. Every input fix and its observation time stay immutable.
 * `now` is native's clock when the fix was read; without it the fix's age is unknown, so a
 * new fix is only eased towards, never predicted ahead.
 */
export class MapMotion<T extends MotionFix = MotionFix> {
  private motion: Motion<T> | null = null;

  reset(fix: T | null, time: number) {
    this.motion = fix
      ? { fix, from: fix, received: time, age: 0, duration: 0, vx: 0, vy: 0, horizon: 0 }
      : null;
  }

  accept(fix: T | null, now: number | null, time: number) {
    if (!fix) {
      this.motion = null;
      return;
    }
    const previous = this.motion?.fix ?? null;
    if (
      previous &&
      previous.x === fix.x &&
      previous.y === fix.y &&
      previous.observed_ms === fix.observed_ms &&
      sameContext(previous, fix)
    )
      return;
    const shown = this.sample(time).position;
    const gap = previous ? fix.observed_ms - previous.observed_ms : 0;
    const known = now !== null && Number.isFinite(now);
    const age = known ? now - fix.observed_ms : 0;
    const speed =
      previous && gap > 0 ? Math.hypot(fix.x - previous.x, fix.y - previous.y) / gap : 0;
    if (
      !previous ||
      !shown ||
      age < 0 ||
      age > MAX_GAP_MS ||
      gap <= 0 ||
      !canAnimatePosition(previous, fix) ||
      !canAnimatePosition(shown, fix) ||
      speed > MAX_SPEED
    ) {
      this.reset(fix, time);
      return;
    }
    // Very closely spaced readings are too noisy to establish a velocity.
    const predict = known && gap >= 100 && age < MAX_PREDICTION_MS;
    const vx = predict ? (fix.x - previous.x) / gap : 0;
    const vy = predict ? (fix.y - previous.y) / gap : 0;
    const duration =
      shown.x === fix.x && shown.y === fix.y && vx === 0 && vy === 0 ? 0 : CORRECTION_MS;
    this.motion = {
      fix,
      from: shown,
      received: time,
      age,
      duration,
      vx,
      vy,
      horizon: speed > 0 && predict ? Math.min(MAX_PREDICTION_MS, MAX_TRAVEL / speed) : 0,
    };
  }

  sample(time: number): { position: MapPosition<T> | null; active: boolean } {
    const state = this.motion;
    if (!state) return { position: null, active: false };
    const elapsed = Math.max(0, time - state.received);
    const age = state.age + elapsed;
    const ahead = Math.min(state.horizon, age);
    const blend = state.duration > 0 ? Math.min(1, elapsed / state.duration) : 1;
    const x = state.from.x + (state.fix.x + state.vx * ahead - state.from.x) * blend;
    const y = state.from.y + (state.fix.y + state.vy * ahead - state.from.y) * blend;
    const error = Math.hypot(x - state.fix.x, y - state.fix.y);
    return {
      position: { ...state.fix, x, y, estimated: error > 1, uncertainty_m: error / 100 },
      active: blend < 1 || ((state.vx !== 0 || state.vy !== 0) && age < state.horizon),
    };
  }
}
