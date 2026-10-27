import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CubeFacing, CubesStatus } from '../../types/cubes';
import { cubesStatus, NOW } from '../cubes/fixtures';
import { ALTGARD, atlasMap, VERTERON, type AtlasMap } from '../maps/atlas';
import { mapContext } from '../maps/context';
import { nativeNow, usePlayerMark } from './usePlayerMark';

const verteron = atlasMap(VERTERON) as AtlasMap;
const altgard = atlasMap(ALTGARD) as AtlasMap;

/** You at `x` (centimetres east), observed `observed` and read at `now`. */
const at = (
  x: number,
  observed: number,
  now = observed,
  over: Partial<CubesStatus> = {},
): CubesStatus => {
  const fix = { x, y: 150_000, z: 0, observed_ms: observed };
  return cubesStatus({ now_ms: now, position: fix, last_position: fix, ...over });
};

let callbacks: Map<number, FrameRequestCallback>;
let reduce = false;
beforeEach(() => {
  callbacks = new Map();
  reduce = false;
  let id = 0;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    callbacks.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const frame = (time: number) =>
  act(() => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const cb of pending) cb(time);
  });

function mark(initial: CubesStatus | null, { map = verteron, enabled = true, error = '' } = {}) {
  return renderHook(
    ({ status, shown, failed }) => usePlayerMark(status, mapContext(status, failed), map, shown),
    { initialProps: { status: initial, shown: enabled, failed: error } },
  );
}

describe('your mark on the Explore map', () => {
  it('moves smoothly with a bounded, estimated prediction from the confirmed fixes', () => {
    const { result, rerender } = mark(at(0, NOW));
    expect(result.current).toMatchObject({ x: 0, estimated: false });
    rerender({ status: at(1000, NOW + 500), shown: true, failed: '' });
    frame(100);
    expect(result.current?.x).toBeCloseTo(600);
    frame(200);
    expect(result.current?.x).toBe(1400);
    expect(result.current?.estimated).toBe(true);
    frame(5000);
    // Never more than 15 m (or 1.2 s) ahead of the last fix; then it stops.
    expect(result.current?.x).toBe(2500);
    expect(callbacks.size).toBe(0);
    // The same fix read again neither restarts nor extends the prediction.
    rerender({ status: at(1000, NOW + 500, NOW + 900), shown: true, failed: '' });
    expect(callbacks.size).toBe(0);
    expect(result.current?.x).toBe(2500);
  });

  it('turns the arrow on a newer facing alone, without touching your movement', () => {
    const facing = (degrees: number, observed: number): Partial<CubesStatus> => ({
      facing: { degrees, observed_ms: observed },
    });
    const { result, rerender } = mark(at(0, NOW, NOW, facing(0, NOW)));
    expect(result.current?.facing).toBe(0);
    rerender({ status: at(1000, NOW + 500, NOW + 500, facing(0, NOW)), shown: true, failed: '' });
    frame(100);
    const moving = result.current?.x;
    // A skill turned you: only the facing (and the read time) is new.
    rerender({
      status: at(1000, NOW + 500, NOW + 600, facing(90, NOW + 600)),
      shown: true,
      failed: '',
    });
    expect(result.current?.facing).toBe(90);
    expect(result.current?.x).toBe(moving);
    frame(200);
    expect(result.current?.x).toBe(1400);
    expect(callbacks.size).toBe(1);
  });

  it('lets a facing go 10 s after it was observed, even without another read', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const facing: CubeFacing = { degrees: 45, observed_ms: NOW - 4_000 };
    const { result } = mark(at(0, NOW, NOW, { facing }));
    expect(result.current?.facing).toBe(45);
    act(() => {
      vi.advanceTimersByTime(5_990);
    });
    expect(result.current?.facing).toBe(45);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current?.facing).toBeNull();
    expect(result.current?.x).toBe(0);
  });

  it('draws a last known position where it was, never predicted, with a fresh facing', () => {
    const { result, rerender } = mark(at(0, NOW));
    rerender({ status: at(1000, NOW + 500), shown: true, failed: '' });
    frame(100);
    const last = { x: 1000, y: 150_000, z: 0, observed_ms: NOW + 500 };
    rerender({
      status: cubesStatus({
        now_ms: NOW + 16_000,
        position: null,
        position_age_ms: 15_500,
        last_position: last,
        facing: { degrees: 180, observed_ms: NOW + 15_000 },
      }),
      shown: true,
      failed: '',
    });
    expect(result.current).toEqual({ x: 1000, y: 150_000, last: true, facing: 180 });
    expect(callbacks.size).toBe(0);
  });

  it('never bridges movement across a new session (Clear), a jump or another map', () => {
    const { result, rerender } = mark(at(0, NOW));
    rerender({
      status: at(1000, NOW + 500, NOW + 500, { session_id: 's2' }),
      shown: true,
      failed: '',
    });
    expect(result.current).toMatchObject({ x: 1000, estimated: false });
    expect(callbacks.size).toBe(0);
    // A teleport snaps.
    rerender({
      status: at(9000, NOW + 900, NOW + 900, { session_id: 's2' }),
      shown: true,
      failed: '',
    });
    expect(result.current).toMatchObject({ x: 9000, estimated: false });
    expect(callbacks.size).toBe(0);
    // On another map you are not on this one.
    rerender({
      status: at(9000, NOW + 1000, NOW + 1000, { session_id: 's2', map_id: ALTGARD }),
      shown: true,
      failed: '',
    });
    expect(result.current).toBeNull();
  });

  it('draws nothing of yours after a failed read, in an unknown area or on a map you browse', () => {
    expect(mark(at(0, NOW), { error: 'gone' }).result.current).toBeNull();
    expect(mark(at(0, NOW, NOW, { map_id: 'World/Nowhere' })).result.current).toBeNull();
    expect(mark(at(0, NOW), { map: altgard }).result.current).toBeNull();
    expect(mark(at(0, NOW, NOW, { running: false })).result.current).toBeNull();
  });

  it('draws the measured fix as it is while hidden or with reduced motion', () => {
    const hidden = mark(at(0, NOW), { enabled: false });
    hidden.rerender({ status: at(1000, NOW + 500), shown: false, failed: '' });
    expect(hidden.result.current).toMatchObject({ x: 1000, estimated: false });
    expect(callbacks.size).toBe(0);
    cleanup();
    reduce = true;
    const still = mark(at(0, NOW));
    still.rerender({ status: at(1000, NOW + 500), shown: true, failed: '' });
    expect(still.result.current).toMatchObject({ x: 1000, estimated: false });
    expect(callbacks.size).toBe(0);
  });

  it("uses native's clock, else an older native's position age, else predicts nothing", () => {
    expect(nativeNow(at(0, NOW - 100, NOW))).toBe(NOW);
    expect(nativeNow(at(0, NOW - 100, NOW, { now_ms: null, position_age_ms: 300 }))).toBe(
      NOW + 200,
    );
    expect(nativeNow(cubesStatus({ now_ms: null, position: null }))).toBeNull();
    // Without a clock a new fix is eased towards, never predicted past.
    const { result, rerender } = mark(at(0, NOW, NOW, { now_ms: null, position_age_ms: null }));
    rerender({
      status: at(1000, NOW + 500, NOW + 500, { now_ms: null, position_age_ms: null }),
      shown: true,
      failed: '',
    });
    frame(100);
    expect(result.current?.x).toBeCloseTo(500);
    frame(400);
    expect(result.current?.x).toBe(1000);
    expect(callbacks.size).toBe(0);
  });
});
