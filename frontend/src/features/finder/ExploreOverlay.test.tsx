import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cubeArtSrc } from '../../components/ui/GameArt';
import { withoutGeometry } from '../../lib/cubesNormalize';
import type { FinderPreferencesBackend, FinderPreferencesStore } from '../../lib/finderPreferences';
import { INITIAL_ACTIVITY_WINDOW } from '../../types/activityWindows';
import type { CubesStatus } from '../../types/cubes';
import { DEFAULT_FINDER_PREFERENCES } from '../../types/finderPreferences';
import { ALTGARD, VERTERON } from '../maps/atlas';
import { cube, cubesStatus, NOW } from '../cubes/fixtures';
import type * as CubeSpawns from '../cubes/spawns';
import type * as GatheringSpawns from '../gathering/spawns';
import { ExploreOverlay } from './ExploreOverlay';
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Capturing on Verteron beside the synthetic gathering places, one cube received nearby. */
const here = (over: Partial<CubesStatus> = {}) =>
  cubesStatus({ position: { x: 20_000, y: 150_000, z: 0, observed_ms: NOW - 200 }, ...over });

const props = () => ({
  native: true,
  status: here(),
  fresh: new Set<number>() as ReadonlySet<number>,
  window: INITIAL_ACTIVITY_WINDOW,
  busy: false,
  clearing: false,
  error: '',
  onClear: vi.fn<() => void>(),
  onLock: vi.fn<(locked: boolean) => void>(),
  onHide: vi.fn<() => void>(),
  onDrag: vi.fn<() => void>(),
  onResize: vi.fn<() => void>(),
});

/** The window over saved choices of its own, or the given `store` (shared with Explore). */
function Overlay({
  store,
  ...props
}: Omit<ComponentProps<typeof ExploreOverlay>, 'prefs'> & {
  store?: FinderPreferencesStore;
}) {
  const [own] = useState(() => store ?? testPrefsStore());
  return <ExploreOverlay {...props} prefs={usePrefsControl(own)} />;
}

const frame = (c: HTMLElement) => c.querySelector<HTMLElement>('.world-map')!;
const marks = (c: HTMLElement) => [...c.querySelectorAll('[data-mark-key]')];
const you = (c: HTMLElement) => c.querySelector('[data-mark="you"]');
const spots = (c: HTMLElement) => [...c.querySelectorAll<SVGElement>('[data-spot-key]')];
/** Points drawn for each finder, whether alone or grouped with the other's. */
const counted = (c: HTMLElement) => {
  const by = { cube: 0, gathering: 0 };
  for (const el of spots(c)) {
    if (el.dataset.group === undefined) {
      by[el.dataset.spotKey!.split(':')[1] as 'cube' | 'gathering'] += Number(el.dataset.count);
      continue;
    }
    for (const part of el.dataset.counts!.split(' ')) {
      const [layer, n] = part.split(':') as ['cube' | 'gathering', string];
      by[layer] += Number(n);
    }
  }
  return by;
};
/** Zoomed out as far as the followed view goes: this window has no whole-map control. */
const whole = () => {
  const out = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' });
  for (let i = 0; i < 16 && !out.disabled; i++) fireEvent.click(out);
};
const chip = (name: string) => screen.getByRole('button', { name });

describe('Explore window over the game', () => {
  it('draws both finders on one map, each counted apart, with the nearest cube under it', () => {
    const { container } = render(<Overlay {...props()} />);
    expect(screen.getByRole('region', { name: 'Explore' })).toBeTruthy();
    expect(container.querySelectorAll('.world-map')).toHaveLength(1);
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(container.querySelector('.pet-map-tiles')).toBeTruthy();
    expect(chip('Hidden cubes').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Gathering').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Possible').getAttribute('aria-pressed')).toBe('true');
    expect(marks(container)).toHaveLength(1);
    expect(you(container)).toBeTruthy();
    whole();
    expect(counted(container)).toEqual({ cube: 4, gathering: 8 });
    // The cube keeps its original artwork among gathering places.
    const art = [...container.querySelectorAll('[data-spot-key] image')].map((i) =>
      i.getAttribute('href'),
    );
    expect(art).toContain(cubeArtSrc);
    expect(frame(container).querySelector('svg title')?.textContent).toBe(
      'Verteron: 1 cube that may still be there, 4 possible cube locations, and 8 possible gathering locations',
    );
    expect(screen.getByText('Cube #65509')).toBeTruthy();
    expect(screen.getByText(/ received · .+ opened$/)).toBeTruthy();
  });

  it('shares the layer choices but always follows the map you are on', () => {
    const store = testPrefsStore({
      ...DEFAULT_FINDER_PREFERENCES,
      revision: 3,
      chosen_map: ALTGARD,
      cube_layers: { nearby: true, earlier: true, possible: false },
    });
    const { container } = render(<Overlay {...props()} store={store} />);
    // The workspace browses Altgard; this window stays on Verteron, where you are.
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(screen.queryByRole('radiogroup', { name: 'Map' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Altgard|Back to/ })).toBeNull();
    expect(container.querySelector('[data-map-name]')?.textContent).toBe('Verteron');
    expect(chip('Possible').getAttribute('aria-pressed')).toBe('false');
    whole();
    expect(counted(container)).toEqual({ cube: 0, gathering: 8 });
    fireEvent.click(chip('Possible'));
    expect(store.getSnapshot().prefs?.cube_layers.possible).toBe(true);
    expect(counted(container)).toEqual({ cube: 4, gathering: 8 });
    fireEvent.click(chip('Gathering'));
    expect(store.getSnapshot().prefs?.visibility).toEqual({ cubes: true, gathering: false });
    expect(counted(container)).toEqual({ cube: 4, gathering: 0 });
    // The workspace's map choice is neither used nor changed here.
    expect(store.getSnapshot().prefs?.chosen_map).toBe(ALTGARD);
  });

  it('follows you to another map and draws no map without a trusted current one', () => {
    const p = props();
    const { container, rerender } = render(<Overlay {...p} />);
    expect(frame(container).dataset.map).toBe(VERTERON);
    rerender(<Overlay {...p} status={here({ map_id: ALTGARD, cubes: [] })} />);
    expect(frame(container).dataset.map).toBe(ALTGARD);
    // An area without a map here: no fallback map and no possible location listed.
    rerender(<Overlay {...p} status={here({ map_id: 'World/Unknown', cubes: [] })} />);
    expect(container.querySelector('.world-map')).toBeNull();
    expect(container.querySelector('[data-map="none"]')?.textContent).toContain(
      "This area isn't on these maps",
    );
    expect(spots(container)).toHaveLength(0);
    expect(screen.queryByText('Nearest')).toBeNull();
    // Capture off: the same, with the capture state.
    rerender(
      <Overlay
        {...p}
        status={here({ running: false, phase: 'stopped', cubes: [], position: null })}
      />,
    );
    expect(container.querySelector('.world-map')).toBeNull();
    expect(container.querySelector('[data-map="none"]')?.textContent).toContain(
      'Capture is stopped.',
    );
  });

  it('chooses all, a category or one resource, shared with the Explore filter', () => {
    const store = testPrefsStore();
    const { container } = render(<Overlay {...props()} store={store} />);
    fireEvent.click(chip('Hidden cubes'));
    whole();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Resources' });
    expect(select.value).toBe('all');
    fireEvent.change(select, { target: { value: 'category:ore' } });
    expect(counted(container).gathering).toBe(3);
    expect(store.getSnapshot().prefs?.hidden_resources.length).toBeGreaterThan(0);
    fireEvent.change(select, { target: { value: 'resource:item:300' } });
    expect(counted(container).gathering).toBe(1);
    expect(spots(container)[0]?.querySelector('[data-glyph="text"]')?.textContent).toBe('Ku');
    fireEvent.change(select, { target: { value: 'all' } });
    expect(store.getSnapshot().prefs?.hidden_resources).toEqual([]);
  });

  it('stays an empty map that says so when every layer is hidden', () => {
    const store = testPrefsStore({
      ...DEFAULT_FINDER_PREFERENCES,
      revision: 1,
      visibility: { cubes: false, gathering: false },
    });
    const { container } = render(<Overlay {...props()} store={store} />);
    whole();
    expect(spots(container)).toHaveLength(0);
    expect(marks(container)).toHaveLength(0);
    expect(you(container)).toBeTruthy();
    expect(container.querySelector('.pet-map-tiles')).toBeTruthy();
    expect(screen.getAllByText('No layer shown').length).toBeGreaterThan(0);
    expect(screen.getByText('Turn on a layer above or in the Explore tab.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Resources' })).toBeNull();
    fireEvent.click(chip('Gathering'));
    expect(counted(container).gathering).toBe(8);
  });

  it('draws nothing and offers no change until the saved choices are known', () => {
    const store = testPrefsStore(null, {
      read: () => new Promise(() => undefined),
      update: vi.fn<FinderPreferencesBackend['update']>(),
      subscribe: () => Promise.resolve(() => undefined),
    });
    const { container } = render(<Overlay {...props()} store={store} />);
    whole();
    expect(spots(container)).toHaveLength(0);
    expect(marks(container)).toHaveLength(0);
    expect(screen.getAllByText('Reading your Explore choices…').length).toBeGreaterThan(0);
    expect((chip('Hidden cubes') as HTMLButtonElement).disabled).toBe(true);
    expect((chip('Gathering') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides every mark after a failed read, keeping the map and its possible locations', () => {
    const p = props();
    const { container, rerender } = render(<Overlay {...p} />);
    rerender(<Overlay {...p} status={withoutGeometry(here())} error="Native gone" />);
    expect(screen.getByRole('status').textContent).toBe('Native gone');
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(marks(container)).toHaveLength(0);
    expect(you(container)).toBeNull();
    expect(screen.getByText(/hidden until capture answers again/)).toBeTruthy();
    whole();
    expect(counted(container)).toEqual({ cube: 4, gathering: 8 });
  });

  it('selects a cube, a possible cube location or a gathering place for the summary', () => {
    const status = here({ cubes: [cube({ id: 1 }), cube({ id: 2, distance_m: 80 })] });
    const { container } = render(<Overlay {...props()} status={status} />);
    fireEvent.click(container.querySelector('[data-mark-key="cube:2"]')!);
    expect(screen.getByText('80 m')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByText('80 m')).toBeNull();
    fireEvent.click(chip('Gathering'));
    whole();
    fireEvent.click(container.querySelector('[data-spot-key="spot:cube:0"]')!);
    expect(screen.getByText('Not a sighting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    // With no cube shown, the nearest gathering place leads.
    fireEvent.click(chip('Gathering'));
    fireEvent.click(chip('Hidden cubes'));
    expect(screen.getByText('Nearest')).toBeTruthy();
    expect(screen.getAllByText('Orichalcum').length).toBeGreaterThan(0);
  });

  it('keeps waiting, idle and failure states distinct', () => {
    const p = props();
    const { rerender } = render(
      <Overlay {...p} status={here({ phase: 'waiting_for_game', cubes: [], position: null })} />,
    );
    fireEvent.click(chip('Gathering'));
    expect(screen.getByText('Waiting for AION 2.')).toBeTruthy();
    rerender(
      <Overlay
        {...p}
        status={here({ running: false, phase: 'stopped', cubes: [], position: null })}
      />,
    );
    expect(screen.getAllByText('Capture is stopped.').length).toBeGreaterThan(0);
    rerender(
      <Overlay
        {...p}
        status={here({ running: false, phase: 'error', message: 'Adapter lost', cubes: [] })}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Adapter lost');
  });

  it('stays centred on you: a drag neither pans the map nor moves the window', () => {
    const p = props();
    const { container } = render(<Overlay {...p} />);
    const svg = frame(container).querySelector('svg')!;
    const before = svg.getAttribute('viewBox');
    const pointer = { button: 0, buttons: 1, isPrimary: true, pointerId: 1 };
    fireEvent.pointerDown(svg, { ...pointer, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { ...pointer, clientX: 140, clientY: 120 });
    fireEvent.pointerMove(window, { ...pointer, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(svg, pointer);
    expect(p.onDrag).not.toHaveBeenCalled();
    expect(svg.getAttribute('viewBox')).toBe(before);
    fireEvent.wheel(svg, { deltaY: -300, clientX: 10, clientY: 10 });
    expect(svg.getAttribute('viewBox')).toBe(before);
    expect(frame(container).dataset.camera).toBe('follow');
    // Zooming keeps you in the centre.
    const centre = (box: string | null) => {
      const [x, y, w, h] = (box ?? '').split(' ').map(Number) as [number, number, number, number];
      return [x + w / 2, y + h / 2] as const;
    };
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(svg.getAttribute('viewBox')).not.toBe(before);
    const [bx, by] = centre(before);
    const [ax, ay] = centre(svg.getAttribute('viewBox'));
    expect(ax).toBeCloseTo(bx, 3);
    expect(ay).toBeCloseTo(by, 3);
    expect(screen.queryByRole('button', { name: 'Follow you' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Whole map' })).toBeNull();
    fireEvent.pointerDown(container.querySelector('footer')!, {
      ...pointer,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { ...pointer, clientX: 140, clientY: 100 });
    expect(p.onDrag).toHaveBeenCalledOnce();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Explore' }));
    expect(p.onResize).toHaveBeenCalledOnce();
  });

  it('keeps only its controls hit-testable while locked; the map is click-through', () => {
    const p = props();
    const store = testPrefsStore();
    const { container, rerender } = render(
      <Overlay {...p} store={store} window={{ ...p.window, locked: true }} />,
    );
    const map = frame(container);
    expect(map.hasAttribute('data-hit')).toBe(false);
    expect(map.querySelector('svg [data-hit], svg[data-hit]')).toBeNull();
    const svg = map.querySelector('svg')!;
    const before = svg.getAttribute('viewBox');
    const pointer = { button: 0, buttons: 1, isPrimary: true, pointerId: 1 };
    fireEvent.pointerDown(svg, { ...pointer, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { ...pointer, clientX: 160, clientY: 100 });
    expect(svg.getAttribute('viewBox')).toBe(before);
    expect(container.querySelector('[data-mark-key][tabindex="0"]')).toBeNull();
    for (const name of ['Zoom in', 'Zoom out', 'Clear'])
      expect(screen.getByRole('button', { name }).hasAttribute('data-hit')).toBe(true);
    for (const name of ['Hidden cubes', 'Gathering', 'Possible'])
      expect(chip(name).hasAttribute('data-hit')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Resources' }).hasAttribute('data-hit')).toBe(true);
    // Locked, a layer switch still works and is saved.
    fireEvent.click(chip('Gathering'));
    expect(store.getSnapshot().prefs?.visibility.gathering).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(p.onClear).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Explore' }));
    expect(p.onLock).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Explore' }));
    expect(p.onHide).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Resize Explore' })).toBeNull();
    rerender(<Overlay {...p} store={store} clearing />);
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('releases the map art while hidden', () => {
    const { container } = render(<Overlay {...props()} drawArt={false} />);
    expect(container.querySelector('.pet-map-tiles')).toBeNull();
    expect(marks(container)).toHaveLength(1);
  });
});
