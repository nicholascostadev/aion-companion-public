import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetPosition } from '../../types/pets';
import { useMapPosition } from './useMapPosition';

const fix = (x = 0, observed_ms = 1000): PetPosition => ({
  x,
  y: 100,
  observed_ms,
  zone_id: 7,
  map_id: 'test-map',
});
let callbacks: Map<number, FrameRequestCallback>;
beforeEach(() => {
  callbacks = new Map();
  let id = 0;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    callbacks.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const frame = (time: number) =>
  act(() => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const cb of pending) cb(time);
  });

describe('observed map movement', () => {
  it('predicts between fixes, stops at its horizon, and does not restart on polls', () => {
    const { result, rerender } = renderHook(
      ({ position, now }) => useMapPosition(position, true, now),
      { initialProps: { position: fix(), now: 1000 } },
    );
    rerender({ position: fix(1000, 1500), now: 1500 });
    expect(result.current?.x).toBe(0);
    frame(100);
    expect(result.current?.x).toBeCloseTo(600);
    frame(200);
    expect(result.current?.x).toBe(1400);
    frame(750);
    expect(result.current?.x).toBe(2500);
    expect(result.current?.estimated).toBe(true);
    expect(callbacks.size).toBe(0);
    rerender({ position: { ...fix(1000, 1500) }, now: 2000 });
    expect(callbacks.size).toBe(0);
    expect(result.current?.x).toBe(2500);
  });

  it('snaps teleports, map changes, and old fixes instead of moving through intervening terrain', () => {
    const { result, rerender } = renderHook(
      ({ position, now }) => useMapPosition(position, true, now),
      { initialProps: { position: fix(), now: 1000 } },
    );
    rerender({ position: fix(5000, 1500), now: 1500 });
    expect(result.current?.x).toBe(5000);
    rerender({ position: { ...fix(5100, 1600), zone_id: 9 }, now: 1600 });
    expect(result.current?.zone_id).toBe(9);
    rerender({ position: fix(5200, 1700), now: 10_000 });
    expect(result.current?.x).toBe(5200);
    expect(callbacks.size).toBe(0);
  });

  it('cancels pending animation when the position disappears or the map is hidden', () => {
    const initialProps: { position: PetPosition | null; enabled: boolean } = {
      position: fix(),
      enabled: true,
    };
    const { result, rerender } = renderHook(
      ({ position, enabled }: { position: PetPosition | null; enabled: boolean }) =>
        useMapPosition(position, enabled, 1500),
      { initialProps },
    );
    rerender({ position: fix(1000, 1500), enabled: true });
    expect(callbacks.size).toBe(1);
    rerender({ position: null, enabled: true });
    expect(result.current).toBeNull();
    expect(callbacks.size).toBe(0);
    rerender({ position: fix(1000, 1500), enabled: false });
    expect(result.current?.x).toBe(1000);
    expect(callbacks.size).toBe(0);
  });

  it('respects reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { result, rerender } = renderHook((position) => useMapPosition(position, true, 1500), {
      initialProps: fix(),
    });
    rerender(fix(1000, 1500));
    expect(result.current?.x).toBe(1000);
    expect(callbacks.size).toBe(0);
  });
});
