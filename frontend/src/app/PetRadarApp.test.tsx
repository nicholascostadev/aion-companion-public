import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogue, NOW, status } from '../features/pets/fixtures';
import { resetPetCatalogue } from '../hooks/usePets';
import { HIDDEN_RELEASE_MS } from '../hooks/useRecentlyShown';
import * as companion from '../services/companion';
import * as api from '../services/pets';
import type { PetsConfig, PetsStatus, PetWindowStatus } from '../types/pets';
import PetRadarApp from './PetRadarApp';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startResizeDragging: () => Promise.resolve() }),
}));
vi.mock('../services/companion', () => ({
  isNative: vi.fn<typeof companion.isNative>(),
  startWindowDrag: vi.fn<typeof companion.startWindowDrag>(),
}));
vi.mock('../services/pets', () => ({
  readPetsCatalogue: vi.fn<typeof api.readPetsCatalogue>(),
  readPetsStatus: vi.fn<typeof api.readPetsStatus>(),
  readPetMotion: vi.fn<typeof api.readPetMotion>(),
  configurePets: vi.fn<typeof api.configurePets>(),
  readPetWindowStatus: vi.fn<typeof api.readPetWindowStatus>(),
  markPetWindowReady: vi.fn<typeof api.markPetWindowReady>(),
  showPetWindow: vi.fn<typeof api.showPetWindow>(),
  hidePetWindow: vi.fn<typeof api.hidePetWindow>(),
  lockPetWindow: vi.fn<typeof api.lockPetWindow>(),
  setPetHitRegions: vi.fn<typeof api.setPetHitRegions>(),
}));

let backend: PetsStatus;
let win: PetWindowStatus;

const wolf = {
  entity_id: 5,
  npc_id: 900,
  name: 'Test Wolf',
  pet_ids: [1],
  x: 100,
  y: -200,
  distance: 42,
  bearing: 180,
  observed_ms: NOW - 2000,
};

beforeEach(() => {
  resetPetCatalogue();
  backend = status({ nearby: [wolf] });
  win = {
    requested: true,
    visible: true,
    ready: true,
    locked: true,
    game_active: true,
    errors: [],
  };
  vi.mocked(companion.isNative).mockReturnValue(true);
  vi.mocked(api.readPetsCatalogue).mockResolvedValue(catalogue());
  vi.mocked(api.readPetsStatus).mockImplementation(() => Promise.resolve(backend));
  vi.mocked(api.readPetMotion).mockImplementation(() => Promise.resolve(backend));
  vi.mocked(api.configurePets).mockImplementation((config: PetsConfig) => {
    if (config.revision !== backend.config.revision) return Promise.reject(new Error('revision'));
    backend = { ...backend, config: { ...config, revision: config.revision + 1 } };
    return Promise.resolve(backend);
  });
  vi.mocked(api.readPetWindowStatus).mockImplementation(() => Promise.resolve(win));
  vi.mocked(api.markPetWindowReady).mockResolvedValue();
  vi.mocked(api.hidePetWindow).mockImplementation(() =>
    Promise.resolve((win = { ...win, requested: false, visible: false })),
  );
  vi.mocked(api.lockPetWindow).mockImplementation((locked) =>
    Promise.resolve((win = { ...win, locked })),
  );
  vi.mocked(api.setPetHitRegions).mockResolvedValue(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('in-game pet radar', () => {
  it('reports ready once and keeps its controls clickable while locked', async () => {
    render(<PetRadarApp />);
    const nearby = await screen.findByRole('list', { name: 'Nearby source monsters' });
    expect(api.markPetWindowReady).toHaveBeenCalledOnce();
    expect(within(nearby).getByText('Test Wolf')).toBeTruthy();
    expect(within(nearby).getByText('+Y')).toBeTruthy();
    // The radar opens unlocked by default; this window's saved lock arrives with native status.
    const lock = await screen.findByRole('button', { name: /Unlock pet radar/ });
    expect(lock.dataset.hit).toBe('lock');
    expect(screen.getByRole('button', { name: 'Hide pet radar' }).dataset.hit).toBe('hide');
    expect(screen.getByRole('button', { name: 'Pin Ashwolf' }).dataset.hit).toBe('pin');
    await waitFor(() => expect(api.setPetHitRegions).toHaveBeenCalled());
    // Locked: no drag handlers and no resize grip.
    expect(screen.queryByRole('button', { name: 'Resize pet radar' })).toBeNull();
  });

  it('pins from the locked radar and lists every pin above the rest, nearby or not', async () => {
    render(<PetRadarApp />);
    const pin = await screen.findByRole('button', { name: 'Pin Ashwolf' });
    await waitFor(() => expect((pin as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pin);
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([1]));
    backend = { ...backend, config: { ...backend.config, pinned_ids: [2, 1] } };
    // Pins in pin order, newest first: Barn Owl is not near and says where it spawns...
    const pinned = await screen.findByRole('list', { name: 'Pinned pets' });
    await waitFor(() => expect(pinned.children).toHaveLength(2));
    const [far, wolfRow] = [...pinned.children] as HTMLElement[];
    expect(far!.textContent).toContain('Barn Owl');
    expect(far!.textContent).toContain('Not nearby');
    expect(far!.textContent).toContain('1 point on this map');
    // ...and a near pin stays in its monster's row, with its distance and direction.
    expect(wolfRow!.classList).toContain('is-pinned');
    expect(within(wolfRow!).getByText('42 m')).toBeTruthy();
    expect(within(wolfRow!).getByText('+Y')).toBeTruthy();
    // Nothing unpinned is near, so there is no other list.
    expect(screen.queryByRole('list', { name: 'Nearby source monsters' })).toBeNull();
    // Every unpin stays clickable on the locked window.
    expect(within(wolfRow!).getByRole('button', { name: 'Unpin Ashwolf' }).dataset.hit).toBe('pin');
    expect(within(far!).getByRole('button', { name: 'Unpin Barn Owl' }).dataset.hit).toBe('pin');
  });

  it('keeps a pinned goal and every pin above the rest, in pin order whatever the distance', async () => {
    backend = status({
      nearby: [wolf, { ...wolf, entity_id: 8, npc_id: 902, name: 'Test Crab', pet_ids: [3] }],
      config: {
        ...status().config,
        pinned_ids: [3, 4, 2, 1],
        farming_goal: { pet_id: 2, map_id: 'World/World_L/World_L_A' },
        show_maxed: false,
      },
    });
    render(<PetRadarApp />);
    const goal = await screen.findByRole('region', { name: 'Farming goal: Barn Owl' });
    expect(within(goal).getByRole('button', { name: 'Unpin Barn Owl' })).toBeTruthy();
    // The near Copper Crab monster, the absent Dawn Drake, then the near Ashwolf monster;
    // the pinned goal keeps its own row above them.
    const pinned = screen.getByRole('list', { name: 'Pinned pets' });
    const rows = [...pinned.children] as HTMLElement[];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Test Crab'),
      expect.stringContaining('Dawn Drake'),
      expect.stringContaining('Test Wolf'),
    ]);
    expect(rows[1]!.textContent).toContain('Not on this map');
    expect(within(rows[2]!).getByRole('button', { name: 'Unpin Ashwolf' })).toBeTruthy();
    expect(goal.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Nearby source monsters' })).toBeNull();
  });

  it('lists a complete pin without sightings as not nearby, like any other pin', async () => {
    backend = status({
      nearby: [wolf],
      config: { ...status().config, pinned_ids: [3], show_maxed: false },
    });
    render(<PetRadarApp />);
    const pinned = await screen.findByRole('list', { name: 'Pinned pets' });
    const [crab] = [...pinned.children] as HTMLElement[];
    // Copper Crab is complete; native keeps tracking a pin at max level, so none is near.
    expect(crab!.dataset.stage).toBe('maxed');
    expect(crab!.textContent).toContain('Not nearby');
    expect(crab!.textContent).not.toContain('not tracked');
  });

  it('keeps a pin and a complete goal listed when their monsters leave, age out or the map changes', async () => {
    const owl = { ...wolf, entity_id: 7, npc_id: 901, name: 'Test Owl', pet_ids: [2] };
    const crab = { ...wolf, entity_id: 8, npc_id: 902, name: 'Test Crab', pet_ids: [3] };
    const config = {
      ...status().config,
      pinned_ids: [2],
      show_maxed: false,
      farming_goal: { pet_id: 3, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' },
    };
    const polled = async () => {
      const calls = vi.mocked(api.readPetsStatus).mock.calls.length;
      await waitFor(
        () => expect(vi.mocked(api.readPetsStatus).mock.calls.length).toBeGreaterThan(calls + 1),
        { timeout: 3000 },
      );
    };
    const stillTracked = () => {
      const pinned = screen.getByRole('list', { name: 'Pinned pets' });
      expect(pinned.textContent).toContain('Barn Owl');
      expect(screen.getByRole('region', { name: 'Farming goal: Copper Crab' })).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Nearby source monsters' })).toBeNull();
    };
    backend = status({ nearby: [owl, crab], config });
    render(<PetRadarApp />);
    // Both near: the pin and the complete goal in their monsters' rows.
    const pinned = await screen.findByRole('list', { name: 'Pinned pets' });
    expect(pinned.textContent).toContain('Test Owl');
    const nearby = screen.getByRole('list', { name: 'Nearby source monsters' });
    expect(nearby.textContent).toContain('Test Crab');
    // Sightings age out: both stay, as not nearby and not seen, without a made-up distance.
    const old = NOW - 120_000;
    backend = status({
      nearby: [
        { ...owl, observed_ms: old },
        { ...crab, observed_ms: old },
      ],
      config,
    });
    await waitFor(() => stillTracked(), { timeout: 3000 });
    expect(screen.getByRole('list', { name: 'Pinned pets' }).textContent).toContain('Not nearby');
    expect(screen.getByRole('region', { name: /Copper Crab/ }).textContent).toContain('Not seen');
    expect(screen.queryByText('42 m')).toBeNull();
    // Out of range: native drops monsters past the radius, so none is sighted at all.
    backend = status({ nearby: [], config });
    await polled();
    stillTracked();
    // Another map: both stay.
    backend = status({
      nearby: [],
      config,
      position: {
        zone_id: null,
        map_id: 'World/World_L/World_L_A',
        x: 10,
        y: 10,
        observed_ms: NOW - 500,
      },
    });
    await polled();
    stillTracked();
  }, 15_000);

  it('puts a far pin above a nearer goal and moves a new pin to the top at once', async () => {
    backend = status({
      nearby: [
        wolf,
        { ...wolf, entity_id: 7, npc_id: 901, name: 'Test Owl', pet_ids: [2], distance: 80 },
      ],
      config: {
        ...status().config,
        pinned_ids: [4],
        farming_goal: { pet_id: 1, map_id: 'World/World_L/World_L_A' },
      },
    });
    render(<PetRadarApp />);
    const nearby = await screen.findByRole('list', { name: 'Nearby source monsters' });
    const pinned = screen.getByRole('list', { name: 'Pinned pets' });
    // The absent Dawn Drake pin leads the near goal (42 m) and the unpinned owl (80 m).
    expect(pinned.compareDocumentPosition(nearby) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned.textContent).toContain('Dawn Drake');
    expect([...nearby.children].map((r) => r.textContent)).toEqual([
      expect.stringContaining('Test Wolf'),
      expect.stringContaining('Test Owl'),
    ]);
    // A new pin moves up before the save answers, ahead of older pins.
    const pin = within(nearby).getByRole('button', { name: 'Pin Barn Owl' });
    await waitFor(() => expect((pin as HTMLButtonElement).disabled).toBe(false));
    vi.mocked(api.configurePets).mockImplementation(() => new Promise(() => {}));
    fireEvent.click(pin);
    await waitFor(() =>
      expect([...pinned.children].map((r) => r.textContent)).toEqual([
        expect.stringContaining('Test Owl'),
        expect.stringContaining('Dawn Drake'),
      ]),
    );
    const rest = screen.getByRole('list', { name: 'Nearby source monsters' });
    expect([...rest.children].map((r) => r.textContent)).toEqual([
      expect.stringContaining('Test Wolf'),
    ]);
  });

  it('marks nearby monsters of a pinned pet with a labelled pinned edge', async () => {
    backend = status({
      nearby: [wolf, { ...wolf, entity_id: 7, npc_id: 901, name: 'Test Owl', pet_ids: [2] }],
      config: { ...status().config, pinned_ids: [1] },
    });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    const rows = [...document.querySelectorAll<HTMLElement>('.pet-nearby-row')];
    const wolfRow = rows.find((r) => r.textContent?.includes('Test Wolf'))!;
    const owlRow = rows.find((r) => r.textContent?.includes('Test Owl'))!;
    expect(wolfRow.closest('ul')?.getAttribute('aria-label')).toBe('Pinned pets');
    expect(wolfRow.classList).toContain('is-pinned');
    expect(wolfRow.querySelector('.pet-pinned-tag')?.textContent).toBe('Pinned');
    const unpin = within(wolfRow).getByRole('button', { name: 'Unpin Ashwolf' });
    expect(unpin.getAttribute('aria-pressed')).toBe('true');
    expect(owlRow.classList).not.toContain('is-pinned');
    expect(owlRow.querySelector('.pet-pinned-tag')).toBeNull();
  });

  it('polls at once when shown again, so pins made elsewhere appear without waiting', async () => {
    win = { ...win, visible: false };
    render(<PetRadarApp />);
    await waitFor(() => expect(api.readPetWindowStatus).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    // Hidden: no status polls past the first, unknown-window one.
    const before = vi.mocked(api.readPetsStatus).mock.calls.length;
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    expect(vi.mocked(api.readPetsStatus).mock.calls.length).toBe(before);
    backend = { ...backend, config: { ...backend.config, pinned_ids: [2] } };
    win = { ...win, visible: true };
    const pinned = await screen.findByRole('list', { name: 'Pinned pets' }, { timeout: 3000 });
    expect(pinned.textContent).toContain('Barn Owl');
  });

  it('unlocks to move and resize, and hides instead of closing', async () => {
    render(<PetRadarApp />);
    const lock = await screen.findByRole('button', { name: /Unlock pet radar/ });
    await waitFor(() => expect((lock as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(lock);
    await waitFor(() => expect(api.lockPetWindow).toHaveBeenCalledWith(false));
    expect(await screen.findByRole('button', { name: 'Resize pet radar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide pet radar' }));
    await waitFor(() => expect(api.hidePetWindow).toHaveBeenCalledOnce());
  });

  it('names each pet type with its original symbol on every kind of row', async () => {
    backend = status({
      nearby: [wolf],
      config: {
        ...status().config,
        pinned_ids: [4],
        farming_goal: { pet_id: 2, map_id: 'World/World_L/World_L_A' },
      },
    });
    render(<PetRadarApp />);
    const near = await screen.findByRole('list', { name: 'Nearby source monsters' });
    const goal = screen.getByRole('region', { name: 'Farming goal: Barn Owl' });
    const pinned = screen.getByRole('list', { name: 'Pinned pets' });
    for (const [row, family] of [
      [near, 'Fera'],
      [goal, 'Natura'],
      [pinned, 'Specia'],
    ] as const) {
      const type = row.querySelector('.pet-family')!;
      expect(type.textContent).toBe(family);
      expect(type.querySelector('img')?.getAttribute('src')).toMatch(/^\/pet-type-art\//);
      expect(type.querySelector('svg')).toBeNull();
    }
  });

  it('updates facing from motion polls while the character stays stationary', async () => {
    backend = status({ facing: { degrees: 0, observed_ms: NOW } });
    render(<PetRadarApp />);
    const arrow = () => document.querySelector('[data-mark="player-facing"]');
    await waitFor(() => expect(arrow()?.getAttribute('transform')).toContain('rotate(0)'));
    // Leave the full status unchanged: the lightweight poll alone must carry a turn.
    vi.mocked(api.readPetMotion).mockResolvedValue({
      ...backend,
      now_ms: NOW + 150,
      facing: { degrees: 90, observed_ms: NOW + 150 },
    });
    await waitFor(() => expect(arrow()?.getAttribute('transform')).toContain('rotate(90)'));
    vi.mocked(api.readPetMotion).mockResolvedValue({
      ...backend,
      now_ms: NOW + 10_151,
      facing: null,
    });
    await waitFor(() => expect(arrow()).toBeNull());
  });

  it('shows no pickup notices, only the rows and map', async () => {
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    await act(async () => {
      backend = {
        ...backend,
        now_ms: NOW + 1500,
        gains: [{ id: 'new', pet_id: 1, gained: 1, at_ms: NOW + 1000 }],
      };
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(screen.queryByText('+1')).toBeNull();
    expect(document.querySelector('[aria-live]')).toBeNull();
  });

  it('says why nothing is live instead of showing stale distances', async () => {
    backend = status({ nearby: [wolf], running: false });
    render(<PetRadarApp />);
    expect(await screen.findByText('Connecting to the game…')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Nearby source monsters' })).toBeNull();
    cleanup();
    backend = status({ nearby: [wolf], position: null });
    render(<PetRadarApp />);
    const row = await screen.findByRole('list', { name: 'Nearby source monsters' });
    expect(within(row).getByText('— m')).toBeTruthy();
    expect(document.querySelector('.pet-radar-caption')?.textContent).toContain('No position');
  });

  it('says briefly when the collection is not current, apart from the position state', async () => {
    backend = status({ active_profile_id: null, live_synced: false });
    render(<PetRadarApp />);
    const cached = await screen.findByText('Saved collection, may be outdated');
    expect(cached.getAttribute('title')).toMatch(
      /^Showing Tester's saved collection: capture has not identified .* return to character selection and log back in/,
    );
    cleanup();
    // Live and positioned, but no full collection on this connection.
    backend = status({ live_synced: false });
    render(<PetRadarApp />);
    expect(await screen.findByText('Collection not synced this session')).toBeTruthy();
    expect(document.querySelector('.pet-radar-caption')?.textContent).toContain('Live');
    cleanup();
    backend = status({ nearby: [wolf] });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    expect(screen.queryByText(/Saved collection|Collection not synced/)).toBeNull();
  });

  it('keeps the last known map without presenting it as a current distance', async () => {
    backend = status({
      nearby: [wolf],
      position: null,
      last_position: { zone_id: 7, map_id: null, x: 0, y: 0, observed_ms: NOW - 65_000 },
    });
    render(<PetRadarApp />);
    const row = await screen.findByRole('list', { name: 'Nearby source monsters' });
    expect(within(row).getByText('— m')).toBeTruthy();
    const caption = document.querySelector<HTMLElement>('.pet-radar-caption')!;
    expect(caption.textContent).toContain('Test Plains');
    expect(caption.textContent).toContain('Last known');
    expect(caption.querySelector('.pet-age')?.textContent).toBe('65 s');
    const map = document.querySelector<HTMLElement>('.pet-local-map')!;
    expect(map.dataset.source).toBe('last');
    expect(map.querySelector('title')?.textContent).toContain('around your last known position');
    // A hollow last-known marker and no range ring; recorded points and the live sighting stay.
    expect(map.querySelector('[data-mark="player-last"]')).toBeTruthy();
    expect(map.querySelector('[data-mark="player"]')).toBeNull();
    expect(map.querySelector('[data-mark="range"]')).toBeNull();
    expect(map.querySelectorAll('[data-mark="spawn"]').length).toBeGreaterThan(0);
    expect(map.querySelector('[data-mark="live-live"]')).toBeTruthy();
    expect(within(map).getByTitle(/last observed position, 65 s ago/).textContent).toBe(
      'Last known',
    );
    expect(within(map).getByRole('list', { name: 'Map key' }).textContent).toBe('SpawnsLive');
  });

  it('leads with the farming goal and says honestly when none of its monsters is near', async () => {
    backend = status({
      nearby: [wolf],
      config: {
        ...status().config,
        farming_goal: { pet_id: 2, map_id: 'World/World_L/World_L_A' },
      },
    });
    render(<PetRadarApp />);
    const goal = await screen.findByRole('region', { name: 'Farming goal: Barn Owl' });
    expect(goal.textContent).toContain('Not seen');
    // On the goal's own map, its recorded points are here.
    expect(goal.textContent).toContain('1 point here');
    expect(within(goal).getAllByTitle('1 point on Test Plains')).toHaveLength(2);
    expect(within(goal).getByTitle('15 souls to Lv 2').textContent).toBe('15 to Lv 2');
    // The goal comes before the nearby list.
    const nearby = screen.getByRole('list', { name: 'Nearby source monsters' });
    expect(goal.compareDocumentPosition(nearby) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the nearest goal monster with its own distance and bearing', async () => {
    backend = status({
      nearby: [wolf, { ...wolf, entity_id: 6, distance: 12, bearing: 90 }],
      config: {
        ...status().config,
        farming_goal: { pet_id: 1, map_id: 'World/World_L/World_L_A' },
      },
    });
    render(<PetRadarApp />);
    const nearby = await screen.findByRole('list', { name: 'Nearby source monsters' });
    const row = await waitFor(() => {
      const first = nearby.querySelector<HTMLElement>('.pet-nearby-row')!;
      expect(first.classList).toContain('is-goal');
      return first;
    });
    // A near goal leads the nearby rows instead of repeating itself in a separate row.
    expect(screen.queryByRole('region', { name: /Farming goal/ })).toBeNull();
    expect(within(row).getByText('×2', { exact: false })).toBeTruthy();
    expect(within(row).getByText('12 m')).toBeTruthy();
    expect(within(row).getByText('+X')).toBeTruthy();
    expect(within(row).getByText('Farming goal')).toBeTruthy();
  });

  it('says the goal map is elsewhere and that sightings are not live when capture stops', async () => {
    backend = status({
      position: {
        zone_id: null,
        map_id: 'Intersever/Abyss/Abyss_Reshanta_A',
        x: 50,
        y: 50,
        observed_ms: NOW - 500,
      },
      config: {
        ...status().config,
        farming_goal: { pet_id: 2, map_id: 'World/World_L/World_L_A' },
      },
    });
    render(<PetRadarApp />);
    const goal = await screen.findByRole('region', { name: 'Farming goal: Barn Owl' });
    expect(goal.textContent).toContain('on Test Plains');
    expect(within(goal).getByTitle(/you are on Test Cave/)).toBeTruthy();
    cleanup();
    backend = { ...backend, running: false };
    render(<PetRadarApp />);
    const stopped = await screen.findByRole('region', { name: 'Farming goal: Barn Owl' });
    expect(stopped.textContent).toContain('Not live');
    expect(stopped.textContent).toContain('1 point on Test Plains');
    expect(within(stopped).queryByTitle(/you are on/)).toBeNull();
    // Stopped: the farming map without any player marker.
    const map = document.querySelector<HTMLElement>('.pet-local-map')!;
    expect(map.dataset.source).toBe('goal');
    expect(map.querySelector('[data-mark^="player"]')).toBeNull();
    expect(map.querySelector('[data-mark="goal"]')).toBeTruthy();
  });

  it('keeps position freshness while omitting overlay totals and help sections', async () => {
    backend = status({
      nearby: [wolf],
      config: { ...status().config, pinned_ids: [2] },
      progress: [
        {
          pet_id: 2,
          level: 1,
          progress: 10,
          progress_estimated: true,
          observed_ms: NOW - 5000,
        },
      ],
    });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    expect(document.querySelector('.pet-radar .pet-session')).toBeNull();
    expect(document.querySelector('.pet-radar-caption .pet-age')?.textContent).toBe('1 s');
    expect(screen.queryByText(/around ·/)).toBeNull();
    expect(screen.queryByText(/counts use saved progress/)).toBeNull();
    expect(screen.queryByText('About directions')).toBeNull();
    const pinned = await screen.findByRole('list', { name: 'Pinned pets' });
    expect(within(pinned).getByTitle('~15 souls to Lv 2').textContent).toBe('~15 to Lv 2');
  });

  it('draws only the original map tiles around a fresh position, with its range', async () => {
    const c = catalogue();
    const plains = c.maps[0]!;
    plains.art = {
      ...plains.art!,
      scale: 0.02,
      tiles: Array.from({ length: 4 }, (_, i) => ({
        file: '/pet-map-art/0123456789abcdef0123.webp',
        x: (i % 2) * 2048,
        y: Math.floor(i / 2) * 2048,
        width: 2048,
        height: 2048,
      })),
    };
    vi.mocked(api.readPetsCatalogue).mockResolvedValue(c);
    // 250 m at 0.02 px/cm is a 500 px ring around (1048, 1048). Fitted with a margin across
    // the 340 × 160 frame, the view stays inside the first tile.
    backend = status({
      nearby: [wolf],
      position: { zone_id: 7, map_id: null, x: -50_000, y: -50_000, observed_ms: NOW - 1000 },
    });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    const map = await waitFor(() => document.querySelector<HTMLElement>('.pet-local-map')!);
    const svg = map.querySelector('svg')!;
    expect(svg.querySelector('title')?.textContent).toMatch(
      /^Original map of Test Plains around your position, −Y up/,
    );
    expect([...svg.querySelectorAll('image')].map((i) => i.getAttribute('x'))).toEqual(['0']);
    expect(map.dataset.source).toBe('here');
    expect(map.querySelector('[data-mark="range"]')).toBeTruthy();
    expect(map.querySelector('[data-mark="player"]')).toBeTruthy();
  });

  it('releases its map art once hidden for a while, and draws it again as it shows', async () => {
    backend = status({
      nearby: [wolf],
      position: { zone_id: 7, map_id: null, x: 0, y: 0, observed_ms: NOW - 1000 },
    });
    // Fake from the start, so the window poll runs on them; real time still moves the setup.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    const art = () => document.querySelectorAll('.pet-local-map .pet-map-tiles image').length;
    await waitFor(() => expect(art()).toBeGreaterThan(0));
    win = { ...win, visible: false };
    // The window poll notices the hide; the art outlives a short alt-tab...
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS / 2));
    expect(art()).toBeGreaterThan(0);
    // ...and is let go when the radar stays hidden, while its map and rows remain.
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS));
    expect(art()).toBe(0);
    expect(document.querySelector('.pet-local-map')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Nearby source monsters' })).toBeTruthy();
    win = { ...win, visible: true };
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(art()).toBeGreaterThan(0);
  });

  it('opens 300 metres across and keeps close zoom independent of far sightings', async () => {
    const c = catalogue();
    const plains = c.maps[0]!;
    plains.art = {
      ...plains.art!,
      scale: 0.02,
      tiles: [
        {
          file: '/pet-map-art/0123456789abcdef0123.webp',
          x: 0,
          y: 0,
          width: 4096,
          height: 4096,
        },
      ],
    };
    vi.mocked(api.readPetsCatalogue).mockResolvedValue(c);
    const position = { zone_id: 7, map_id: null, x: -50_000, y: -50_000, observed_ms: NOW - 1000 };
    const width = () => {
      const svg = document.querySelector('.pet-local-map svg')!;
      return Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    };
    // 300 metres across = 600 original canvas pixels at scale 0.02.
    backend = status({ nearby: [{ ...wolf, x: -48_000, y: -50_000, distance: 20 }], position });
    const { unmount } = render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    await waitFor(() => expect(width()).toBeCloseTo(600));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(width()).toBeCloseTo(600 / 1.6);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(width()).toBeCloseTo(600);
    unmount();
    // A sighting 240 m east stays in the list but does not zoom the map back out.
    backend = status({ nearby: [{ ...wolf, x: -26_000, y: -50_000, distance: 240 }], position });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    await waitFor(() => expect(width()).toBeCloseTo(600));
    expect(document.querySelector('.pet-local-map [data-mark^="live-"]')).toBeNull();
  });

  it('draws a labelled chart without art, and no map without any map to show', async () => {
    backend = status({
      nearby: [wolf],
      position: {
        zone_id: null,
        map_id: 'Intersever/Abyss/Abyss_Reshanta_A',
        x: 50,
        y: 50,
        observed_ms: NOW - 500,
      },
    });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    const chart = document.querySelector<HTMLElement>('.pet-local-map')!;
    expect(chart.dataset.ground).toBe('chart');
    expect(chart.querySelector('title')?.textContent).toMatch(/^Coordinate chart of Test Cave/);
    expect(within(chart).getByText('Chart')).toBeTruthy();
    // Copper Crab is complete: only Ashwolf's recorded point is worth farming here.
    expect(chart.querySelectorAll('[data-mark="spawn"]')).toHaveLength(1);
    expect(chart.querySelector('[data-mark="player"]')).toBeTruthy();
    cleanup();
    backend = status({ nearby: [wolf], position: null });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    expect(document.querySelector('.pet-local-map')).toBeNull();
  });

  it('draws one mark for catalogue records repeating a pet at the same spot', async () => {
    const c = catalogue();
    const ashwolf = c.pets[0]!;
    // The bundled catalogue repeats some records exactly, or under another source monster.
    ashwolf.spawns.push(
      {
        map_id: 'Intersever/Abyss/Abyss_Reshanta_A',
        npc_id: 900,
        x: 50,
        y: 50,
        z: 0,
      },
      {
        map_id: 'Intersever/Abyss/Abyss_Reshanta_A',
        npc_id: 903,
        x: 50,
        y: 50,
        z: 0,
      },
    );
    vi.mocked(api.readPetsCatalogue).mockResolvedValue(c);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    backend = status({
      nearby: [wolf],
      position: {
        zone_id: null,
        map_id: 'Intersever/Abyss/Abyss_Reshanta_A',
        x: 50,
        y: 50,
        observed_ms: NOW - 500,
      },
    });
    render(<PetRadarApp />);
    await screen.findByRole('list', { name: 'Nearby source monsters' });
    const chart = document.querySelector<HTMLElement>('.pet-local-map')!;
    expect(chart.querySelectorAll('[data-mark="spawn"]')).toHaveLength(1);
    expect(chart.querySelector('title')?.textContent).toContain('1 recorded spawn point');
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    errors.mockRestore();
  });
});
