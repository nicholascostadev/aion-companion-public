import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cubeArtSrc } from '../../components/ui/GameArt';
import { withoutGeometry } from '../../lib/cubesNormalize';
import type { CubesStatus } from '../../types/cubes';
import { ALTGARD, VERTERON } from '../maps/atlas';
import { cube, cubesStatus, NOW } from '../cubes/fixtures';
import type * as CubeSpawns from '../cubes/spawns';
import type * as GatheringSpawns from '../gathering/spawns';
import type { FinderPreferencesStore } from '../../lib/finderPreferences';
import { DEFAULT_FINDER_PREFERENCES } from '../../types/finderPreferences';
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

/** The view with saved choices of its own, or the given `store` (shared by several views). */
function View({
  store,
  ...props
}: Omit<ComponentProps<typeof ExploreView>, 'prefs'> & {
  store?: FinderPreferencesStore;
}) {
  const [own] = useState(() => store ?? testPrefsStore());
  return <ExploreView {...props} prefs={usePrefsControl(own)} />;
}

const toggle = () => ({
  requested: false,
  visible: false,
  known: true,
  busy: false,
  onToggle: vi.fn<() => void>(),
});
const props = () => ({
  native: true,
  status: here(),
  fresh: new Set<number>() as ReadonlySet<number>,
  error: '',
  clearing: false,
  onClear: vi.fn<() => void>(),
  overlay: toggle(),
});

const frame = (c: HTMLElement) => c.querySelector<HTMLElement>('.world-map')!;
const spots = (c: HTMLElement) => [...c.querySelectorAll<SVGElement>('[data-spot-key]')];
const total = (c: HTMLElement) => spots(c).reduce((n, el) => n + Number(el.dataset.count), 0);
const marks = (c: HTMLElement) => c.querySelectorAll('[data-mark-key]');
const you = (c: HTMLElement) => c.querySelector('[data-mark="you"]');
const viewBox = (c: HTMLElement) => c.querySelector('svg')!.getAttribute('viewBox');
const layer = (name: RegExp) => screen.getByRole('checkbox', { name });
const CUBES = /^Hidden cubes/;
const GATHERING = /^Gathering/;
const whole = () => fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));

describe('Explore workspace tab', () => {
  it('shows every finder on one map by default, each counted on its own', () => {
    const { container } = render(<View {...props()} native={false} status={null} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Explore' })).toBeTruthy();
    // One map, Altgard by default, every finder shown.
    expect(container.querySelectorAll('.world-map')).toHaveLength(1);
    expect(frame(container).dataset.map).toBe(ALTGARD);
    expect(layer(CUBES).getAttribute('aria-checked')).toBe('true');
    expect(layer(GATHERING).getAttribute('aria-checked')).toBe('true');
    const count = (name: string) =>
      container.querySelector(`[data-finder="${name}"] [data-points]`)?.textContent;
    expect(count('cubes')).toBe('1 possible location on Altgard');
    expect(count('gathering')).toBe('3 possible locations on Altgard');
    whole();
    expect(total(container)).toBe(4);
    expect(you(container)).toBeNull();
    // The cube is always the original red cube artwork.
    const art = [...container.querySelectorAll('[data-spot-key] image')].map((i) =>
      i.getAttribute('href'),
    );
    expect(art).toContain(cubeArtSrc);
    fireEvent.click(screen.getByRole('button', { name: 'Verteron' }));
    expect(count('cubes')).toBe('4 possible locations on Verteron');
    expect(count('gathering')).toBe('8 possible locations on Verteron');
    const text = container.textContent ?? '';
    for (const word of [/respawn timer/i, /depleted/i, /required/i]) expect(text).not.toMatch(word);
  });

  it('follows the map you are on with its cubes, you and the nearest gathering places', () => {
    const { container } = render(<View {...props()} />);
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(marks(container)).toHaveLength(1);
    expect(you(container)).toBeTruthy();
    expect(screen.getByText('Position confirmed')).toBeTruthy();
    const cubes = within(screen.getByRole('list', { name: 'Nearby cubes' }));
    expect(cubes.getByText('42 m')).toBeTruthy();
    expect(cubes.getByText('6 m above')).toBeTruthy();
    const near = within(screen.getByRole('list', { name: 'Nearest possible locations' }));
    expect(near.getAllByRole('button')[0]?.textContent).toContain('Orichalcum');
    expect(near.getAllByRole('button')[0]?.textContent).toContain('5 m');
    expect(screen.getByText('Recent sightings')).toBeTruthy();
    expect(screen.getByText(/Detection range is not exact/)).toBeTruthy();
  });

  it('shows and hides each finder on its own, keeping the map, the view and its choices', () => {
    const { container } = render(<View {...props()} />);
    whole();
    const view = viewBox(container);
    expect(frame(container).dataset.camera).toBe('free');
    expect(total(container)).toBe(12);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Food/ }));
    expect(screen.getByText('3 of 5 shown')).toBeTruthy();
    fireEvent.click(layer(GATHERING));
    expect(total(container)).toBe(4);
    expect(screen.queryByRole('list', { name: 'Nearest possible locations' })).toBeNull();
    expect(screen.queryByText('3 of 5 shown')).toBeNull();
    expect(viewBox(container)).toBe(view);
    fireEvent.click(layer(CUBES));
    expect(total(container)).toBe(0);
    expect(marks(container)).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Nearby cubes' })).toBeNull();
    expect(screen.getByText(/Every layer is hidden/)).toBeTruthy();
    // You are still shown, the view and the map are unchanged.
    expect(you(container)).toBeTruthy();
    expect(viewBox(container)).toBe(view);
    expect(frame(container).dataset.map).toBe(VERTERON);
    // Shown again, a finder keeps its own choices.
    fireEvent.click(layer(GATHERING));
    expect(screen.getByText('3 of 5 shown')).toBeTruthy();
    expect(total(container)).toBe(5);
    expect(viewBox(container)).toBe(view);
  });

  it('filters the received and possible cube layers', () => {
    const status = here({
      cubes: [cube({ id: 1 }), cube({ id: 2, status: 'opened', distance_m: null })],
    });
    const { container } = render(<View {...props()} status={status} />);
    const tones = () => [...marks(container)].map((m) => m.getAttribute('data-tone'));
    expect(tones()).toEqual(['past', 'live']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Earlier this session/ }));
    expect(tones()).toEqual(['live']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Nearby now/ }));
    expect(tones()).toEqual([]);
    whole();
    expect(total(container)).toBe(12);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Possible locations/ }));
    expect(total(container)).toBe(8);
    expect(screen.getByText(/a pin is a place to check, not a sighting/)).toBeTruthy();
  });

  it('filters gathering by category, search and Only, and shows all again', () => {
    const { container } = render(<View {...props()} />);
    fireEvent.click(layer(CUBES));
    whole();
    expect(total(container)).toBe(8);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Food/ }));
    expect(total(container)).toBe(5);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search resources' }), {
      target: { value: 'rubi' },
    });
    // Both languages' names are searched.
    expect(container.querySelector('[data-resource="item:400"]')).toBeTruthy();
    expect(container.querySelector('[data-resource="item:100"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show only matches' }));
    expect(total(container)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(total(container)).toBe(8);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search resources' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show only Kukuru' }));
    expect(total(container)).toBe(1);
    expect(spots(container)[0]?.querySelector('[data-glyph="text"]')?.textContent).toBe('Ku');
  });

  it('lists each gathered item once with its original icon, else its written label', () => {
    const { container } = render(<View {...props()} />);
    const cypri = container.querySelector('[data-resource="item:200"]')!;
    expect(container.querySelectorAll('[data-resource="item:200"]')).toHaveLength(1);
    expect(cypri.textContent).toContain('Cypri');
    expect(cypri.textContent).toContain('2');
    expect(cypri.querySelector('img')?.getAttribute('src')).toMatch(/^\/resource-art\//);
    const kukuru = container.querySelector('[data-resource="item:300"]')!;
    expect(kukuru.querySelector('img')).toBeNull();
    expect(kukuru.querySelector('[data-art="label"]')?.textContent).toBe('Ku');
  });

  it('never marks your cubes on another map, and a row brings their map back', () => {
    const { container } = render(<View {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Altgard' }));
    expect(frame(container).dataset.map).toBe(ALTGARD);
    expect(container.querySelector('.pet-map-tiles')).toBeTruthy();
    expect(marks(container)).toHaveLength(0);
    expect(you(container)).toBeNull();
    expect(screen.getByText(/You are not on this map/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Verteron' }));
    expect(frame(container).dataset.map).toBe(VERTERON);
    fireEvent.click(screen.getByRole('button', { name: 'Altgard' }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Nearby cubes' })).getByRole('button'));
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(
      container.querySelector('[data-mark-key="cube:65509"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Close details' })).toBeTruthy();
  });

  it('keeps the map and its possible locations after a failed read, without you or distances', () => {
    const p = props();
    const { container, rerender } = render(<View {...p} />);
    rerender(<View {...p} status={withoutGeometry(p.status)} error="Native unavailable" />);
    expect(screen.getByRole('alert').textContent).toContain('Native unavailable');
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(marks(container)).toHaveLength(0);
    expect(you(container)).toBeNull();
    expect(screen.getByText(/hidden until capture answers again/)).toBeTruthy();
    whole();
    expect(total(container)).toBe(12);
    // Rows stay, every measurement from you is gone.
    expect(screen.queryByText('42 m')).toBeNull();
    expect(screen.getAllByText('— m').length).toBeGreaterThan(0);
    expect(screen.queryByRole('list', { name: 'Nearest possible locations' })).toBeNull();
  });

  it('keeps browsing the last trusted map in an unknown area and with capture off', () => {
    const p = props();
    const { container, rerender } = render(<View {...p} />);
    rerender(<View {...p} status={here({ zone_id: 999, map_id: null, position: null })} />);
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(marks(container)).toHaveLength(0);
    expect(you(container)).toBeNull();
    expect(screen.getByText("This area isn't on these maps")).toBeTruthy();
    // The cube is still listed.
    expect(
      within(screen.getByRole('list', { name: 'Nearby cubes' })).getByText('42 m'),
    ).toBeTruthy();
    rerender(
      <View
        {...p}
        status={here({ running: false, phase: 'stopped', position: null, cubes: [] })}
      />,
    );
    expect(frame(container).dataset.map).toBe(VERTERON);
    expect(screen.getAllByText('Capture is stopped.').length).toBeGreaterThan(0);
    expect(spots(container).length).toBeGreaterThan(0);
  });

  it('says how old the last position is when it is no longer fresh', () => {
    render(<View {...props()} status={withoutGeometry(here({ position_age_ms: 75_000 }))} />);
    expect(screen.getByText('Your position is 75 s old')).toBeTruthy();
    expect(screen.getByText(/Distance and direction return when a fresh position/)).toBeTruthy();
  });

  it('says nothing has been observed rather than that no cube exists', () => {
    render(<View {...props()} status={here({ cubes: [] })} />);
    expect(screen.getByText('No cubes observed yet')).toBeTruthy();
  });

  it('counts new arrivals; Clear forgets received cubes only; one switch for the window', () => {
    const p = props();
    const { container } = render(
      <View
        {...p}
        status={here({ cubes: [cube({ id: 1 }), cube({ id: 2 })] })}
        fresh={new Set([2])}
      />,
    );
    expect(screen.getByText('1 new')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /^Food/ }));
    whole();
    const before = total(container);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(p.onClear).toHaveBeenCalledOnce();
    // Possible locations and the gathering filter are untouched.
    expect(total(container)).toBe(before);
    expect(screen.getByText('3 of 5 shown')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    fireEvent.click(screen.getByRole('switch', { name: 'Explore over the game' }));
    expect(p.overlay.onToggle).toHaveBeenCalledOnce();
  });

  it('details one selection at a time, of any finder, held by its identity', () => {
    const p = props();
    const { container, rerender } = render(<View {...p} />);
    // A gathering place, with its distance while fresh.
    const near = within(screen.getByRole('list', { name: 'Nearest possible locations' }));
    fireEvent.click(near.getAllByRole('button')[0]!);
    const card = () => container.querySelector('[data-spot="item:100"]');
    expect(card()?.textContent).toContain('Orichalcum');
    expect(card()?.textContent).toContain('5 m away');
    expect(card()?.querySelector('img')).toBeTruthy();
    // Another resource hidden keeps it; its own hidden lets it go.
    fireEvent.click(screen.getByRole('checkbox', { name: /^Food/ }));
    expect(card()).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /^Ore/ }));
    expect(card()).toBeNull();
    // A received cube replaces any other selection (and is brought into view); a new
    // session lets it go.
    fireEvent.click(within(screen.getByRole('list', { name: 'Nearby cubes' })).getByRole('button'));
    expect(container.querySelector('[data-cube="65509"]')).toBeTruthy();
    expect(
      container.querySelector('[data-mark-key="cube:65509"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    rerender(<View {...p} status={here({ session_id: 's2' })} />);
    expect(container.querySelector('[data-cube="65509"]')).toBeNull();
    // A possible cube location stands alone among the places of every finder, and goes
    // with its layer.
    fireEvent.click(layer(GATHERING));
    whole();
    fireEvent.click(container.querySelector('[data-spot-key="spot:cube:1"]')!);
    expect(screen.getByText('A cube may or may not be here now.')).toBeTruthy();
    fireEvent.click(layer(GATHERING));
    expect(
      container.querySelector('[data-spot-key="spot:cube:1"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText('A cube may or may not be here now.')).toBeTruthy();
    fireEvent.click(layer(CUBES));
    expect(screen.queryByText('A cube may or may not be here now.')).toBeNull();
  });

  it('lets a received cube go once it is not drawn: another map, a failed read, an unknown area', () => {
    const p = props();
    const { container, rerender } = render(<View {...p} />);
    const pick = () =>
      fireEvent.click(
        within(screen.getByRole('list', { name: 'Nearby cubes' })).getByRole('button'),
      );
    const card = () => container.querySelector('[data-cube="65509"]');
    pick();
    expect(card()?.textContent).toContain('42 m');
    // Browsing another map: no mark there, so no details of it over that map either.
    fireEvent.click(screen.getByRole('button', { name: 'Altgard' }));
    expect(marks(container)).toHaveLength(0);
    expect(card()).toBeNull();
    // Back on its map the selection stays let go.
    fireEvent.click(screen.getByRole('button', { name: 'Back to Verteron' }));
    expect(card()).toBeNull();
    pick();
    expect(card()).toBeTruthy();
    rerender(<View {...p} status={withoutGeometry(p.status)} error="Native unavailable" />);
    expect(card()).toBeNull();
    rerender(<View {...p} />);
    expect(card()).toBeNull();
    pick();
    expect(card()).toBeTruthy();
    rerender(<View {...p} status={here({ zone_id: 999, map_id: null, position: null })} />);
    expect(marks(container)).toHaveLength(0);
    expect(card()).toBeNull();
  });

  it('draws the saved choices, mirrored in every view that shares them', () => {
    const store = testPrefsStore({
      ...DEFAULT_FINDER_PREFERENCES,
      revision: 4,
      cube_layers: { nearby: true, earlier: true, possible: false },
      hidden_resources: ['item:300'],
    });
    const p = props();
    const { container } = render(
      <>
        <div data-testid="a">
          <View {...p} store={store} />
        </div>
        <div data-testid="b">
          <View {...p} store={store} />
        </div>
      </>,
    );
    const maps = () =>
      [...container.querySelectorAll<HTMLElement>('.world-map')].map((m) => m.dataset.map);
    expect(maps()).toEqual([VERTERON, VERTERON]);
    const inA = within(screen.getByTestId('a'));
    const inB = within(screen.getByTestId('b'));
    const kukuru = () =>
      [...container.querySelectorAll('[data-resource="item:300"] [role="checkbox"]')].map((c) =>
        c.getAttribute('aria-checked'),
      );
    expect(kukuru()).toEqual(['false', 'false']);
    expect(
      inA.getByRole('checkbox', { name: /^Possible locations/ }).getAttribute('aria-checked'),
    ).toBe('false');
    // A change in one is shown at once in the other: layers, filters and the map choice.
    fireEvent.click(inA.getByRole('checkbox', { name: /^Gathering/ }));
    expect(inB.getByRole('checkbox', { name: /^Gathering/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(inA.getByRole('checkbox', { name: /^Gathering/ }));
    fireEvent.click(inB.getByRole('checkbox', { name: /^Possible locations/ }));
    expect(
      inA.getByRole('checkbox', { name: /^Possible locations/ }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(inB.getByRole('button', { name: 'Altgard' }));
    expect(maps()).toEqual([ALTGARD, ALTGARD]);
    expect(store.getSnapshot().prefs?.chosen_map).toBe(ALTGARD);
    // Back to the map you are on follows you again rather than pinning it.
    fireEvent.click(inA.getByRole('button', { name: 'Back to Verteron' }));
    expect(maps()).toEqual([VERTERON, VERTERON]);
    expect(store.getSnapshot().prefs?.chosen_map).toBeNull();
  });

  it('shows nothing, and changes nothing, until the saved choices are known', async () => {
    let answer: (prefs: typeof DEFAULT_FINDER_PREFERENCES) => void = () => undefined;
    let fail: (cause: Error) => void = () => undefined;
    const update = vi.fn<() => Promise<typeof DEFAULT_FINDER_PREFERENCES>>();
    const reads: Promise<typeof DEFAULT_FINDER_PREFERENCES>[] = [];
    const backend = {
      read: () => {
        const read = new Promise<typeof DEFAULT_FINDER_PREFERENCES>((resolve, reject) => {
          answer = resolve;
          fail = reject;
        });
        reads.push(read);
        return read;
      },
      update,
      subscribe: () => Promise.resolve(() => undefined),
    };
    const store = testPrefsStore(null, backend);
    const { container } = render(<View {...props()} store={store} />);
    const stop = store.connect();
    whole();
    expect(total(container)).toBe(0);
    expect(marks(container)).toHaveLength(0);
    expect(screen.getByText('Reading your Explore choices…')).toBeTruthy();
    expect(layer(CUBES).hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(layer(CUBES));
    expect(update).not.toHaveBeenCalled();
    // A failed read says so, shows nothing (never every layer) and reads again on request.
    await act(async () => {
      while (!reads.length) await Promise.resolve();
      fail(new Error('Native unavailable'));
      await reads[0]!.catch(() => undefined);
    });
    expect(screen.getByRole('alert').textContent).toContain('could not be read');
    expect(total(container)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      answer({
        ...DEFAULT_FINDER_PREFERENCES,
        revision: 2,
        visibility: { cubes: false, gathering: true },
      });
      await reads[1];
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(layer(CUBES).getAttribute('aria-checked')).toBe('false');
    expect(layer(GATHERING).getAttribute('aria-checked')).toBe('true');
    expect(total(container)).toBe(8);
    stop();
  });

  it('says every layer is hidden when both are, keeping the map and you', () => {
    const store = testPrefsStore({
      ...DEFAULT_FINDER_PREFERENCES,
      revision: 1,
      visibility: { cubes: false, gathering: false },
    });
    const { container } = render(<View {...props()} store={store} />);
    whole();
    expect(total(container)).toBe(0);
    expect(marks(container)).toHaveLength(0);
    expect(you(container)).toBeTruthy();
    expect(screen.getByText(/Every layer is hidden/)).toBeTruthy();
    expect(container.querySelector('[data-legend="possibleCube"]')).toBeNull();
    expect(container.querySelector('[data-legend="possibleGathering"]')).toBeNull();
  });
});
