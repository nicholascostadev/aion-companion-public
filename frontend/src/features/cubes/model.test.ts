import { describe, expect, it } from 'vitest';
import { cube, cubesStatus, NOW } from './fixtures';
import {
  captureOf,
  freshIds,
  levelOf,
  NEW_MS,
  NO_DETECTIONS,
  positionOf,
  SEEN_LIMIT,
  splitCubes,
  trackDetections,
} from './model';

describe('cube capture state', () => {
  const at = (overrides: Parameters<typeof cubesStatus>[0], error = '') =>
    captureOf(cubesStatus(overrides), { native: true, error });

  it('names each capture phase distinctly', () => {
    expect(captureOf(null, { native: false, error: '' })).toBe('preview');
    expect(captureOf(null, { native: true, error: '' })).toBe('loading');
    expect(at({})).toBe('capturing');
    // The worker may already run while it waits for the game.
    expect(at({ phase: 'waiting_for_game' })).toBe('waiting');
    expect(at({ phase: 'error', running: false })).toBe('error');
    expect(at({ phase: 'stopped', running: false })).toBe('stopped');
    expect(at({ phase: 'idle', running: false })).toBe('starting');
    expect(at({ phase: 'starting' })).toBe('starting');
    expect(at({}, 'IPC failed')).toBe('error');
  });

  it('tells a fresh position from a last known one and from none', () => {
    expect(positionOf(cubesStatus())).toBe('fresh');
    expect(positionOf(cubesStatus({ position: null, position_age_ms: 40_000 }))).toBe('stale');
    expect(positionOf(cubesStatus({ position: null, position_age_ms: null }))).toBe('unknown');
    expect(positionOf(null)).toBe('unknown');
  });
});

describe('cube rows', () => {
  it('splits cubes that may still be there from past ones, keeping native order', () => {
    const rows = [
      cube({ id: 1, status: 'opened' }),
      cube({ id: 2 }),
      cube({ id: 3, status: 'out_of_view' }),
      cube({ id: 4, status: 'opening' }),
    ];
    const { active, past } = splitCubes(rows);
    expect(active.map((c) => c.id)).toEqual([2, 4]);
    expect(past.map((c) => c.id)).toEqual([1, 3]);
  });

  it('says above, below or level only when the height is known', () => {
    expect(levelOf(null)).toBeNull();
    expect(levelOf(0)).toBe('level');
    expect(levelOf(1.5)).toBe('level');
    expect(levelOf(6)).toBe('above');
    expect(levelOf(-6)).toBe('below');
  });
});

describe('new cube detection', () => {
  const snapshot = (ids: number[], overrides: Parameters<typeof cubesStatus>[0] = {}) =>
    cubesStatus({ cubes: ids.map((id) => cube({ id })), ...overrides });

  it('never marks the first snapshot of a session as new', () => {
    const first = trackDetections(NO_DETECTIONS, snapshot([1, 2]), NOW);
    expect(freshIds(first, NOW).size).toBe(0);
  });

  it('marks a cube arriving later, until the mark expires', () => {
    const first = trackDetections(NO_DETECTIONS, snapshot([1]), NOW);
    const next = trackDetections(first, snapshot([1, 2]), NOW + 1000);
    expect([...freshIds(next, NOW + 1000)]).toEqual([2]);
    const later = trackDetections(next, snapshot([1, 2]), NOW + 1000 + NEW_MS);
    expect(freshIds(later, NOW + 1000 + NEW_MS).size).toBe(0);
  });

  it('does not mark a cube that returns to view, or one first seen already opened', () => {
    let t = trackDetections(NO_DETECTIONS, snapshot([1]), NOW);
    t = trackDetections(t, snapshot([]), NOW + 500);
    t = trackDetections(t, snapshot([1]), NOW + 1000);
    t = trackDetections(
      t,
      cubesStatus({ cubes: [cube({ id: 1 }), cube({ id: 9, status: 'opened' })] }),
      NOW + 1500,
    );
    expect(freshIds(t, NOW + 1500).size).toBe(0);
  });

  it('starts again without marks after Clear or a new capture session', () => {
    let t = trackDetections(NO_DETECTIONS, snapshot([1]), NOW);
    t = trackDetections(t, snapshot([1, 2]), NOW + 100);
    t = trackDetections(t, snapshot([3, 4], { session_id: 's2' }), NOW + 200);
    expect(freshIds(t, NOW + 200).size).toBe(0);
  });

  it('stays the same object while nothing arrives or expires', () => {
    const first = trackDetections(NO_DETECTIONS, snapshot([1]), NOW);
    expect(trackDetections(first, snapshot([1]), NOW + 250)).toBe(first);
  });

  it('remembers a bounded number of ids without re-marking ones still listed', () => {
    let t = trackDetections(NO_DETECTIONS, snapshot([0]), NOW);
    for (let start = 1; start <= SEEN_LIMIT + 256; start += 128) {
      const ids = [0, ...Array.from({ length: 127 }, (_, i) => start + i)];
      t = trackDetections(t, snapshot(ids), NOW + start);
    }
    expect(t.seen.size).toBeLessThanOrEqual(SEEN_LIMIT);
    expect(t.seen.has(0)).toBe(true);
    const again = trackDetections(t, snapshot([0]), NOW + 10 * NEW_MS);
    expect(freshIds(again, NOW + 10 * NEW_MS).has(0)).toBe(false);
  });
});
