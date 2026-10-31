import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderPreferencesStore } from '../../lib/finderPreferences';
import { INITIAL_ACTIVITY_WINDOW } from '../../types/activityWindows';
import type { CubesStatus } from '../../types/cubes';
import { DEFAULT_FINDER_PREFERENCES } from '../../types/finderPreferences';
import type { WorldMotionStatus } from '../../types/worldMotion';
import { normalizeWorldMotion } from '../../lib/worldMotion';
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
  const common = {
    native: true,
    status,
    fresh: new Set<number>(),
    error: '',
    clearing: false,
  };
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

/** Native's pushed motion: the same walk, without cubes. */
const pushed = (x: number, observed: number, over: Partial<CubesStatus> = {}): WorldMotionStatus =>
  normalizeWorldMotion(walking(x, observed, over));

/** The window over the game, drawing you from `motion` and everything else from `status`. */
function Overlay({
  status,
  motion = null,
  error = '',
  animate = true,
  store,
}: {
  status: CubesStatus;
  motion?: WorldMotionStatus | null;
  error?: string;
  animate?: boolean;
  store: FinderPreferencesStore;
}) {
  const prefs = usePrefsControl(useState(() => store)[0]);
  return (
    <ExploreOverlay
      native
      status={status}
      motion={motion}
      fresh={new Set<number>()}
      error={error}
      clearing={false}
      prefs={prefs}
      window={INITIAL_ACTIVITY_WINDOW}
      busy={false}
      animate={animate}
      onClear={() => undefined}
      onLock={() => undefined}
      onHide={() => undefined}
    />
  );
}

/** Where the window draws you for a cube status alone, unmoving. */
const drawnFor = (status: CubesStatus) => {
  const { container, unmount } = render(
    <Overlay status={status} animate={false} store={testPrefsStore()} />,
  );
  const at = you(container)?.getAttribute('transform') ?? null;
  unmount();
  return at;
};

describe('your pushed position in the window over the game', () => {
  it('moves you and the map at once, before the next poll, without touching a distance', () => {
    const store = testPrefsStore();
    const status = walking(20_000, NOW);
    const { container, rerender } = render(
      <Overlay status={status} animate={false} store={store} />,
    );
    const confirmed = distances(container);
    expect(confirmed.length).toBeGreaterThan(0);
    const before = you(container)!.getAttribute('transform');
    rerender(
      <Overlay
        status={status}
        motion={pushed(20_500, NOW + 100, { revision: 2 })}
        animate={false}
        store={store}
      />,
    );
    const after = you(container)!.getAttribute('transform');
    expect(after).not.toBe(before);
    expect(after).toBe(drawnFor(walking(20_500, NOW + 100)));
    // The pushed fix is drawn only: every distance is still the cube status's.
    expect(distances(container)).toEqual(confirmed);
    expect(you(container)!.dataset.state).toBe('fresh');
  });

  it('eases towards a pushed fix and keeps the estimate labelled', () => {
    const store = testPrefsStore();
    const status = walking(20_000, NOW);
    const { container, rerender } = render(<Overlay status={status} store={store} />);
    rerender(
      <Overlay status={status} motion={pushed(20_150, NOW + 150, { revision: 2 })} store={store} />,
    );
    frame(50);
    expect(you(container)!.dataset.state).toBe('estimated');
    expect(container.querySelector('[data-chip="estimated-position"]')).toBeTruthy();
    expect(callbacks.size).toBeGreaterThan(0);
  });

  it('never moves you back for a late poll of an older revision', () => {
    const store = testPrefsStore();
    const motion = pushed(20_500, NOW + 300, { revision: 5 });
    const { container, rerender } = render(
      <Overlay status={walking(20_000, NOW)} motion={motion} animate={false} store={store} />,
    );
    const shown = you(container)!.getAttribute('transform');
    rerender(
      <Overlay
        status={walking(20_200, NOW + 100, { revision: 4, now_ms: NOW + 350 })}
        motion={motion}
        animate={false}
        store={store}
      />,
    );
    expect(you(container)!.getAttribute('transform')).toBe(shown);
    // A poll that is newer than the motion (an event was missed) does move you.
    const newer = walking(20_700, NOW + 500, { revision: 6 });
    rerender(<Overlay status={newer} motion={motion} animate={false} store={store} />);
    expect(you(container)!.getAttribute('transform')).toBe(drawnFor(newer));
  });

  it('draws your pushed facing, and lets it go with the motion', () => {
    const store = testPrefsStore();
    const status = walking(20_000, NOW, { facing: null });
    const motion = pushed(20_000, NOW + 50, {
      revision: 2,
      facing: { degrees: 90, observed_ms: NOW + 50 },
    });
    const { container, rerender } = render(
      <Overlay status={status} motion={motion} animate={false} store={store} />,
    );
    const facing = () => you(container)?.querySelector('[data-mark="you-facing"]');
    expect(facing()?.getAttribute('data-degrees')).toBe('90');
    rerender(
      <Overlay
        status={status}
        motion={{ ...motion, revision: 3, now_ms: NOW + 60, facing: null }}
        animate={false}
        store={store}
      />,
    );
    expect(facing()).toBeNull();
  });

  it('hides you while the push is already in another zone than the map and cubes', () => {
    const store = testPrefsStore();
    const status = walking(20_000, NOW);
    const zoned = pushed(10_000, NOW + 200, {
      session_id: 's2',
      zone_id: 2020,
      map_id: ALTGARD,
    });
    const { container } = render(<Overlay status={status} motion={zoned} store={store} />);
    // Still the map and cubes of the cube status, but neither your old nor your new place.
    expect(container.querySelector<HTMLElement>('.world-map')?.dataset.map).toBe(VERTERON);
    expect(you(container)).toBeNull();
    expect(callbacks.size).toBe(0);
  });

  it('hides you after a failed read, whatever was pushed', () => {
    const store = testPrefsStore();
    const motion = pushed(20_500, NOW + 100, { revision: 2 });
    const { container } = render(
      <Overlay status={walking(20_000, NOW)} motion={motion} error="IPC down" store={store} />,
    );
    expect(you(container)).toBeNull();
  });

  it('marks a pushed stale position as last known, unmoving and unmeasured', () => {
    const store = testPrefsStore();
    const last = { x: 20_000, y: 150_000, z: 0, observed_ms: NOW };
    const motion = normalizeWorldMotion({
      ...walking(20_000, NOW),
      revision: 2,
      now_ms: NOW + 20_000,
      position: null,
      position_age_ms: 20_000,
      last_position: last,
      facing: null,
    });
    const { container } = render(
      <Overlay status={walking(20_000, NOW)} motion={motion} store={store} />,
    );
    expect(you(container)!.dataset.state).toBe('last');
    expect(container.textContent).toContain('Last known position');
    expect(callbacks.size).toBe(0);
  });
});
