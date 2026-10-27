import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderPreferencesStore } from '../../lib/finderPreferences';
import { INITIAL_ACTIVITY_WINDOW } from '../../types/activityWindows';
import type { CubesStatus } from '../../types/cubes';
import { DEFAULT_FINDER_PREFERENCES } from '../../types/finderPreferences';
import { ALTGARD, VERTERON } from '../maps/atlas';
import { cubesStatus, NOW } from '../cubes/fixtures';
import type * as CubeSpawns from '../cubes/spawns';
import type * as GatheringSpawns from '../gathering/spawns';
import { ExploreOverlay } from './ExploreOverlay';
import { ExploreView } from './ExploreView';
import { testPrefsStore, usePrefsControl } from './fixtures';

// Synthetic possible locations, so these tests never depend on the bundled game data.
vi.mock('../cubes/spawns', async (importOriginal) => {
  const actual = await importOriginal<typeof CubeSpawns>();
  const { SPOTS_FILE } = await import('../cubes/fixtures');
  const catalogue = actual.parseCubeSpots(SPOTS_FILE);
  return {
    ...actual,
    cubeSpots: (id: string) => catalogue.get(id) ?? null,
    hasCubeSpots: () => catalogue.size > 0,
  };
});
vi.mock('../gathering/spawns', async (importOriginal) => {
  const actual = await importOriginal<typeof GatheringSpawns>();
  const { SPOTS_FILE } = await import('../gathering/fixtures');
  const catalogue = actual.parseGatheringSpots(SPOTS_FILE);
  const resources = [...catalogue.resources.values()];
  return {
    ...actual,
    gatheringSpots: (id: string) => catalogue.maps.get(id) ?? null,
    gatheringResources: () => resources,
    gatheringMapIds: () => [...catalogue.maps.keys()],
  };
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

/** On Verteron beside the synthetic gathering places, walking east, facing 30°. */
const walking = (x: number, observed: number, over: Partial<CubesStatus> = {}) => {
  const fix = { x, y: 150_000, z: 0, observed_ms: observed };
  return cubesStatus({
    now_ms: observed,
    position: fix,
    last_position: fix,
    facing: { degrees: 30, observed_ms: observed },
    cubes: [],
    ...over,
  });
};

/** The workspace's Explore tab and the window over the game, on the same saved choices. */
function Both({ status, store }: { status: CubesStatus; store: FinderPreferencesStore }) {
  const prefs = usePrefsControl(useState(() => store)[0]);
  const common = { native: true, status, fresh: new Set<number>(), error: '', clearing: false };
  return (
    <>
      <section data-window="workspace">
        <ExploreView {...common} prefs={prefs} onClear={() => undefined} />
      </section>
      <section data-window="overlay">
        <ExploreOverlay
          {...common}
          prefs={prefs}
          window={INITIAL_ACTIVITY_WINDOW}
          busy={false}
          onClear={() => undefined}
          onLock={() => undefined}
          onHide={() => undefined}
        />
      </section>
    </>
  );
}

const part = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLElement>(`[data-window="${name}"]`)!;
const you = (c: HTMLElement) => c.querySelector<SVGElement>('[data-mark="you"]');
/** Every distance shown, in order ("10 m", "5 m away"). */
const distances = (c: HTMLElement) =>
  [...(c.textContent ?? '').matchAll(/(\d[\d,.]*)\s?(k?m)(?![a-z])/g)].map(
    (m) => `${m[1]} ${m[2]}`,
  );

describe('your movement in Explore, the same in the workspace and over the game', () => {
  it('draws you smoothly with your facing in both, while every distance stays confirmed', () => {
    const store = testPrefsStore();
    const { container, rerender } = render(<Both status={walking(20_000, NOW)} store={store} />);
    const moved = walking(20_500, NOW + 500);
    rerender(<Both status={moved} store={store} />);
    const confirmed = {
      workspace: distances(part(container, 'workspace')),
      overlay: distances(part(container, 'overlay')),
    };
    expect(confirmed.workspace.length).toBeGreaterThan(0);
    expect(confirmed.overlay.length).toBeGreaterThan(0);
    frame(150);
    frame(5000);
    for (const name of ['workspace', 'overlay'] as const) {
      const mark = you(part(container, name))!;
      expect(mark.dataset.state).toBe('estimated');
      expect(mark.querySelector('[data-mark="you-facing"]')?.getAttribute('data-degrees')).toBe(
        '30',
      );
      expect(part(container, name).querySelector('[data-chip="estimated-position"]')).toBeTruthy();
      // The drawn estimate never reaches a distance, a nearest place or a list.
      expect(distances(part(container, name))).toEqual(confirmed[name]);
    }
    // One flow: both maps draw you at the very same place.
    expect(you(part(container, 'workspace'))!.getAttribute('transform')).toBe(
      you(part(container, 'overlay'))!.getAttribute('transform'),
    );
    // A fresh render of the confirmed fix lists the same distances.
    cleanup();
    const still = render(<Both status={moved} store={testPrefsStore()} />);
    expect(distances(part(still.container, 'workspace'))).toEqual(confirmed.workspace);
    expect(distances(part(still.container, 'overlay'))).toEqual(confirmed.overlay);
  });

  it('marks a last known position in both, unmoving, without distances', () => {
    const store = testPrefsStore();
    const last = { x: 20_000, y: 150_000, z: 0, observed_ms: NOW - 40_000 };
    const status = cubesStatus({
      now_ms: NOW,
      position: null,
      position_age_ms: 40_000,
      last_position: last,
      facing: null,
      cubes: [],
    });
    const { container } = render(<Both status={status} store={store} />);
    for (const name of ['workspace', 'overlay'] as const) {
      const mark = you(part(container, name))!;
      expect(mark.dataset.state).toBe('last');
      expect(mark.querySelector('[data-mark="you-facing"]')).toBeNull();
      expect(part(container, name).textContent).toContain('Last known position');
      expect(distances(part(container, name))).toEqual([]);
    }
    expect(callbacks.size).toBe(0);
  });

  it('lets the workspace browse another map while the window stays where you are', () => {
    const store = testPrefsStore({
      ...DEFAULT_FINDER_PREFERENCES,
      revision: 1,
      chosen_map: ALTGARD,
    });
    const { container } = render(<Both status={walking(20_000, NOW)} store={store} />);
    const map = (name: string) =>
      part(container, name).querySelector<HTMLElement>('.world-map')?.dataset.map;
    expect(map('workspace')).toBe(ALTGARD);
    expect(map('overlay')).toBe(VERTERON);
    // You are drawn only on the map you are on.
    expect(you(part(container, 'workspace'))).toBeNull();
    expect(you(part(container, 'overlay'))).toBeTruthy();
  });
});
