import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogue, NOW, status } from '../features/pets/fixtures';
import { resetPetCatalogue } from '../hooks/usePets';
import { HIDDEN_RELEASE_MS } from '../hooks/useRecentlyShown';
import * as companion from '../services/companion';
import * as api from '../services/pets';
import type { PetCatalogue, PetsConfig, PetsStatus, PetWindowStatus } from '../types/pets';
import { PetsTab } from './PetsTab';

// Only Ashwolf has a portrait here, so cards with and without artwork are both covered.
vi.mock('../lib/petArt', () => ({
  petArt: (id: number) =>
    id === 1 ? { src: '/pet-art/ashwolf-test.png', width: 256, height: 256 } : null,
}));
vi.mock('../services/companion', () => ({ isNative: vi.fn<typeof companion.isNative>() }));
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
}));

let backend: PetsStatus;
let win: PetWindowStatus;

/** Like native IPC: the answer lands on a later task. */
const later = <T,>(value: () => T) =>
  new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(value());
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }, 5),
  );

function save(config: PetsConfig) {
  return later(() => {
    if (config.revision !== backend.config.revision)
      throw new Error('Pet preferences revision changed. Refresh and try again.');
    backend = { ...backend, config: { ...config, revision: config.revision + 1 } };
    return backend;
  });
}

beforeEach(() => {
  resetPetCatalogue();
  backend = status();
  vi.mocked(api.readPetMotion).mockImplementation(() => Promise.resolve(backend));
  win = {
    requested: false,
    visible: false,
    ready: false,
    locked: true,
    game_active: false,
    errors: [],
  };
  vi.mocked(companion.isNative).mockReturnValue(true);
  vi.mocked(api.readPetsCatalogue).mockResolvedValue(catalogue());
  vi.mocked(api.readPetsStatus).mockImplementation((id) =>
    later(() =>
      id && id !== backend.profile_id
        ? {
            ...backend,
            profile_id: id,
            collection_synced: false,
            live_synced: false,
            progress: [],
            nearby: [],
          }
        : backend,
    ),
  );
  vi.mocked(api.configurePets).mockImplementation(save);
  vi.mocked(api.readPetWindowStatus).mockImplementation(() => later(() => win));
  vi.mocked(api.showPetWindow).mockImplementation(() =>
    later(() => (win = { ...win, requested: true })),
  );
  vi.mocked(api.hidePetWindow).mockImplementation(() =>
    later(() => (win = { ...win, requested: false })),
  );
  vi.mocked(api.lockPetWindow).mockImplementation((locked) =>
    later(() => (win = { ...win, locked })),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/* ---------- Helpers ---------- */

const ranked = () => screen.getByRole('list', { name: 'Ranked pets' });
const rankedNames = () =>
  within(ranked())
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.farm-pick-name > span:not(.farm-tag)')?.textContent);
/** The ranked picker row button of a pet. */
const pick = (name: string) =>
  within(ranked())
    .getAllByRole('button')
    .find((b) => b.classList.contains('farm-pick-main') && b.textContent?.includes(name))!;
const mapChooser = () => screen.getByRole('group', { name: 'Map' });
/** Title of the chosen farming map segment: `<map> · <points>[ · you are here]`. */
const shownMap = () =>
  within(mapChooser())
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true')
    ?.getAttribute('title');
const viewBox = () => document.querySelector('.pet-map-svg')?.getAttribute('viewBox');

const list = () => screen.getByRole('list', { name: 'Pets' });
const cards = () => within(list()).getAllByRole('listitem');
/** The card of a pet, by its exact name. */
const card = (name: string) =>
  cards().find((li) => li.querySelector('.pet-card-name')?.textContent === name)!;
/** The button that selects a card's pet (the other button pins it). */
const cardButton = (name: string) =>
  within(card(name))
    .getAllByRole('button')
    .find((b) => !/^(Pin|Unpin) /.test(b.getAttribute('aria-label') ?? ''))!;
const rowNames = () => cards().map((li) => li.querySelector('.pet-card-name')?.textContent);

/** Opens the tab on its farming view, once native state has arrived. */
async function open() {
  render(<PetsTab native active />);
  await screen.findByRole('list', { name: 'Ranked pets' });
  await waitFor(() =>
    expect(
      (within(ranked()).getByRole('button', { name: 'Pin Ashwolf' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
async function openCollection() {
  await open();
  fireEvent.click(screen.getByRole('tab', { name: 'Collection' }));
  await screen.findByRole('list', { name: 'Pets' });
}
const startFarming = () => screen.getByRole('button', { name: /^Start farming/ });
const overview = () => screen.getByRole('region', { name: 'Level 3 by pet type' });
/** A Level 3 tile of the overview: `all` or a family. */
const tile = (family: string) =>
  overview().querySelector<HTMLElement>(`[data-family="${family}"]`)!;
const liveLayer = () => screen.getByRole('button', { name: /^Live\s*\d*$/ });

/** A catalogue whose plains map is field-sized, so a camp is far smaller than the map. */
function fieldCatalogue(): PetCatalogue {
  const c = catalogue();
  const plains = c.maps[0]!;
  plains.bounds = [-100_000, -100_000, 100_000, 100_000];
  plains.art = { ...plains.art!, scale: 0.02 };
  c.pets[0]!.spawns = c.pets[0]!.spawns.map((s) =>
    s.map_id === plains.id ? { ...s, x: s.x * 100, y: s.y * 100 } : s,
  );
  return c;
}

describe('workspace Pets tab', () => {
  it('loads nothing until the tab is first shown', async () => {
    const { rerender } = render(<PetsTab native active={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.readPetsCatalogue).not.toHaveBeenCalled();
    expect(api.readPetsStatus).not.toHaveBeenCalled();
    rerender(<PetsTab native active />);
    await screen.findByRole('list', { name: 'Ranked pets' });
    expect(api.readPetsCatalogue).toHaveBeenCalledOnce();
  });

  it('opens on the farming view with one status line: totals and this session', async () => {
    await open();
    const line = document.querySelector('.pets-sync')!;
    expect(line.textContent).toContain('playing now · collection synced this session');
    expect(line.querySelector('.pets-figures')?.textContent).toContain('Owned 2/4');
    expect(line.querySelector('.pets-figures')?.textContent).not.toContain('Max');
    expect(tile('all').textContent).toBe('All types1 at Level 3of 4 pets');
    expect(line.querySelector('.pet-session')?.textContent).toMatch(
      /This session · 15 min.*6 souls.*1 level-up.*0 new pets/,
    );
    // "To farm" is the default list once the collection is synced: closest first.
    expect(screen.getByRole('button', { name: 'To farm' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(rankedNames()).toEqual(['Ashwolf', 'Dawn Drake', 'Barn Owl']);
    expect(pick('Ashwolf').textContent).toContain('0/5 · 5 souls to obtain');
    // You stand on the plains, which the map chooser shows; it offers the farming maps only.
    expect(shownMap()).toBe('Test Plains · 4 points · you are here');
    expect(
      within(mapChooser())
        .getAllByRole('button')
        .map((b) => b.getAttribute('title')?.split(' · ')[0]),
    ).toEqual(['Test Plains', 'Test Cave']);
    expect(within(mapChooser()).getByRole('button', { name: /^Elyos/ })).toBeTruthy();
    expect(within(mapChooser()).getByRole('button', { name: /^Abyss/ })).toBeTruthy();
  });

  it('has two places only, Map and Collection, and no routes anywhere', async () => {
    await open();
    const tabs = within(screen.getByRole('tablist', { name: 'Pet views' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Map', 'Collection']);
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText(/route|soul pickups/i)).toBeNull();
    expect(document.querySelector('[data-route]')).toBeNull();
  });

  it('keeps routes saved by an earlier version unchanged through every save, never shown', async () => {
    const routes = [
      {
        id: 'r1',
        name: 'Evening loop',
        map_id: 'World/World_L/World_L_A',
        pet_ids: [1, 2],
        stops: [
          { id: 's1', npc_id: 900, x: 100, y: -200, pet_ids: [1], done: true },
          // Orphaned by a catalogue update: kept as it is, not repaired or dropped.
          { id: 's2', npc_id: 999, x: 7, y: 7, pet_ids: [9], done: false },
        ],
        current_stop_id: 's2',
      },
    ];
    backend = status({
      config: { ...status().config, routes, active_route_id: 'r1' },
    });
    await open();
    expect(screen.queryByText(/Evening loop|route/i)).toBeNull();
    fireEvent.click(within(ranked()).getByRole('button', { name: 'Pin Ashwolf' }));
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([1]));
    fireEvent.click(pick('Barn Owl'));
    fireEvent.click(startFarming());
    await waitFor(() => expect(backend.config.farming_goal?.pet_id).toBe(2));
    expect(backend.config.routes).toEqual(routes);
    expect(backend.config.active_route_id).toBe('r1');
  });

  it('counts Level 3 by type over the whole collection, whatever the lists show', async () => {
    await open();
    // Copper Crab (Varia) is the one pet at level 3; no pet is Cognia.
    expect(tile('all').textContent).toBe('All types1 at Level 3of 4 pets');
    expect(tile('Varia').textContent).toBe('Varia1 at Level 3of 1 pet');
    expect(tile('Fera').textContent).toBe('Fera0 at Level 3of 1 pet');
    expect(tile('Cognia').textContent).toBe('Cognia0 at Level 3of 0 pets');
    expect(overview().textContent).toContain('Whole collectionsynced this session');
    const counts = () =>
      [...overview().querySelectorAll('[data-family]')].map((t) => t.textContent);
    const before = counts();
    // A type tile filters the map list and the collection to that type; its counts stay.
    fireEvent.click(tile('Natura'));
    expect(tile('Natura').getAttribute('aria-pressed')).toBe('true');
    expect(rankedNames()).toEqual(['Barn Owl']);
    expect(screen.getByText('Natura only')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Collection' }));
    expect(rowNames()).toEqual(['Barn Owl']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets' }), {
      target: { value: 'nothing like this' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Max level' }));
    expect(counts()).toEqual(before);
    // Choosing it again shows every type.
    fireEvent.click(tile('Natura'));
    expect(tile('all').getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets' }), {
      target: { value: '' },
    });
    expect(rowNames()).toEqual(['Copper Crab']);
  });

  it('counts only known levels while the collection is not synced, never as zero', async () => {
    // Not synced: only Barn Owl's level was observed on this connection.
    backend = status({
      collection_synced: false,
      live_synced: false,
      progress: [{ pet_id: 2, level: 3, progress: 0, observed_ms: NOW - 5000 }],
    });
    await open();
    expect(tile('Natura').textContent).toBe('Natura1 at Level 3of 1 pet');
    expect(tile('all').textContent).toBe('All types1+ at Level 3of 4 pets');
    expect(tile('all').getAttribute('title')).toContain('3 pets of this type have no known level');
    expect(tile('Fera').textContent).toBe('FeraLevel 3 unknown1 pet');
    expect(overview().textContent).toContain('Not syncedlevels of unseen pets unknown');
  });

  it('shows no session line for another profile', async () => {
    backend = status({ session: { ...status().session, profile_id: 'p2' } });
    await open();
    expect(document.querySelector('.pet-session')).toBeNull();
  });

  it('keeps an unsynced collection unknown with one banner, and farming still works', async () => {
    backend = status({ collection_synced: false, live_synced: false });
    await open();
    expect(screen.getAllByText(/levels of unseen pets are unknown, not unowned/)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'To farm' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(pick('Ashwolf').textContent).toContain('Level unknown · 3 points here');
    expect(pick('Ashwolf').querySelector('.farm-pick-bar')).toBeNull();
    fireEvent.click(pick('Ashwolf'));
    expect(screen.getByRole('article', { name: 'Ashwolf' }).textContent).not.toContain('0/5');
    fireEvent.click(startFarming());
    await waitFor(() =>
      expect(backend.config.farming_goal).toEqual({ pet_id: 1, map_id: 'World/World_L/World_L_A' }),
    );
  });

  it('warns in every view that an old saved collection is not current, and clears once it syncs', async () => {
    // Started after login: the last played profile from disk, never identified this session.
    const old = status();
    backend = status({
      active_profile_id: null,
      collection_synced: true,
      live_synced: false,
      profiles: [{ ...old.profiles[0]!, synced_ms: NOW - 4 * 3_600_000 }, old.profiles[1]!],
      position: null,
      last_position: null,
    });
    await open();
    const notice = () =>
      screen
        .queryAllByRole('status')
        .find((n) => n.textContent?.includes("Showing Tester's saved collection"));
    expect(notice()?.textContent).toContain('capture has not identified the character playing now');
    expect(notice()?.textContent).toContain('last full sync was 4h ago');
    expect(notice()?.textContent).toContain(
      'keep the companion open, return to character selection and log back in',
    );
    expect(notice()?.getAttribute('data-tone')).toBe('warn');
    const line = document.querySelector('.pets-sync')!;
    expect(line.textContent).toContain(
      'Tester · server 1001 · saved collection · not synced this session',
    );
    expect(line.textContent).toContain('last full sync 4h ago');
    // No fake sync action: passive capture cannot ask the game for the collection.
    expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
    expect(overview().textContent).toContain('Saved collectionnot synced this session');
    fireEvent.click(screen.getByRole('tab', { name: 'Collection' }));
    expect(notice()).toBeTruthy();
    // Logged back in: the game sent the full collection on this connection.
    backend = status();
    await waitFor(
      () =>
        expect(document.querySelector('.pets-sync')?.textContent).toContain(
          'playing now · collection synced this session',
        ),
      { timeout: 3000 },
    );
    expect(notice()).toBeUndefined();
    expect(screen.queryByText(/saved collection|not synced/)).toBeNull();
  });

  it('says the live character has no full collection this session, from its last full sync', async () => {
    backend = status({ live_synced: false });
    await open();
    expect(
      screen.getByText(
        /The game has not sent Tester's full collection this session\. .*last full sync, 1m ago, and may be out of date; souls picked up since show as ~ estimates\. To sync it, keep the companion open, return to character selection and log back in/,
      ),
    ).toBeTruthy();
    expect(document.querySelector('.pets-sync')?.textContent).toContain(
      'Tester · server 1001 · playing now · collection not synced this session',
    );
  });

  it('labels a chosen synced saved profile offline without asking to log in again', async () => {
    const old = status();
    vi.mocked(api.readPetsStatus).mockImplementation((id) =>
      later(() =>
        id === 'p2'
          ? {
              ...backend,
              profile_id: 'p2',
              live_synced: false,
              profiles: [
                old.profiles[0]!,
                { ...old.profiles[1]!, synced_ms: NOW - 3 * 86_400_000 },
              ],
              nearby: [],
            }
          : backend,
      ),
    );
    await open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), {
      target: { value: 'p2' },
    });
    await waitFor(() =>
      expect(document.querySelector('.pets-sync')?.textContent).toContain(
        'Alt · server 1002 · saved profile · offline',
      ),
    );
    expect(document.querySelector('.pets-sync')?.textContent).toContain('last full sync 3d ago');
    expect(screen.queryByText(/character selection|saved collection|not synced/)).toBeNull();
  });

  it('shows where to farm first: maps by points, same-named sources grouped, the rest folded', async () => {
    await open();
    fireEvent.click(pick('Ashwolf'));
    const detail = screen.getByRole('article', { name: 'Ashwolf' });
    const rows = [...detail.querySelectorAll<HTMLButtonElement>('button.farm-map-row')];
    expect(rows.map((r) => r.querySelector('.farm-map-row-name')?.textContent)).toEqual([
      'Test Plains',
      'Test Cave',
    ]);
    expect(rows[0]!.textContent).toContain('You are here');
    expect(rows[0]!.textContent).toContain('3 points');
    expect(rows[0]!.textContent).toContain('Test Wolf ×2 · 3');
    const unplaced = within(detail).getByText('3 more sources off these maps');
    expect(unplaced.closest('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(unplaced.closest('[data-ui="disclosure"]')?.textContent).toContain('Test Pup ×2');
    // Choosing a row shows that map.
    fireEvent.click(rows[1]!);
    expect(shownMap()).toMatch(/^Test Cave/);
    await waitFor(() =>
      expect(document.querySelector('.pet-map-count')?.textContent).toMatch(/^Coordinate chart/),
    );
    expect(document.querySelector('.pet-map-tiles')).toBeNull();
    expect(document.querySelector('.pet-map-player')).toBeNull();
  });

  it('starts farming in one action: saves the goal first, then requests the radar', async () => {
    await open();
    fireEvent.click(pick('Ashwolf'));
    expect(startFarming().textContent).toContain('on Test Plains');
    fireEvent.click(startFarming());
    await waitFor(() => expect(api.showPetWindow).toHaveBeenCalledOnce());
    expect(backend.config.farming_goal).toEqual({ pet_id: 1, map_id: 'World/World_L/World_L_A' });
    expect(backend.config.last_map_id).toBe('World/World_L/World_L_A');
    // The radar is only asked for once native accepted the goal.
    const saved = vi.mocked(api.configurePets).mock.invocationCallOrder[0]!;
    expect(vi.mocked(api.showPetWindow).mock.invocationCallOrder[0]).toBeGreaterThan(saved);
    const bar = await screen.findByRole('region', { name: 'Farming goal' });
    expect(bar.textContent).toContain('Farming Ashwolf on Test Plains');
    // Requested, but the game is not focused: it says so instead of claiming it shows.
    await waitFor(() =>
      expect(bar.textContent).toContain('Radar requested · it shows while AION is focused'),
    );
    expect(within(bar).getByRole('button', { name: /Stop farming/ })).toBeTruthy();
  });

  it('does not ask for the radar again when it is already requested', async () => {
    win = { ...win, requested: true, visible: true };
    await open();
    fireEvent.click(pick('Ashwolf'));
    fireEvent.click(startFarming());
    await waitFor(() => expect(backend.config.farming_goal?.pet_id).toBe(1));
    await screen.findByText(/Radar showing over the game/);
    expect(api.showPetWindow).not.toHaveBeenCalled();
  });

  it('reports a rejected goal and leaves the radar alone', async () => {
    vi.mocked(api.configurePets).mockImplementation(() =>
      later(() => {
        throw new Error('Farming goal map has no spawns of this pet');
      }),
    );
    await open();
    fireEvent.click(pick('Ashwolf'));
    fireEvent.click(startFarming());
    expect(await screen.findByText(/farming goal was not saved/)).toBeTruthy();
    expect(screen.getByText(/has no spawns of this pet/)).toBeTruthy();
    expect(api.showPetWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Farming goal' })).toBeNull();
  });

  it('says so when the radar cannot be requested after the goal saved', async () => {
    vi.mocked(api.showPetWindow).mockImplementation(() =>
      later(() => {
        throw new Error('Radar window failed');
      }),
    );
    await open();
    fireEvent.click(pick('Ashwolf'));
    fireEvent.click(startFarming());
    expect(await screen.findByText(/Goal saved, but the in-game radar could not be/)).toBeTruthy();
    expect(backend.config.farming_goal?.pet_id).toBe(1);
  });

  it('stops farming without touching pins or the last map', async () => {
    backend = status({
      config: {
        ...status().config,
        pinned_ids: [2],
        farming_goal: { pet_id: 1, map_id: 'World/World_L/World_L_A' },
        last_map_id: 'World/World_L/World_L_A',
      },
    });
    await open();
    // Pins lead the picker, then the goal, which is shown with no selection.
    expect(rankedNames().slice(0, 2)).toEqual(['Barn Owl', 'Ashwolf']);
    expect(screen.getByRole('article', { name: 'Ashwolf' }).textContent).toContain(
      'Farming on Test Plains',
    );
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Farming goal' })).getByRole('button', {
        name: /Stop farming/,
      }),
    );
    await waitFor(() => expect(backend.config.farming_goal).toBeNull());
    expect(backend.config.pinned_ids).toEqual([2]);
    expect(backend.config.last_map_id).toBe('World/World_L/World_L_A');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Farming goal' })).toBeNull());
  });

  it('never shows a map other than the farming maps, even where you stand or an old goal is', async () => {
    backend = status({
      position: { zone_id: null, map_id: 'Dungeon/Test_C', x: 20, y: 20, observed_ms: NOW - 1000 },
      config: {
        ...status().config,
        farming_goal: { pet_id: 1, map_id: 'Dungeon/Test_C' },
        last_map_id: 'Dungeon/Test_C',
      },
    });
    await open();
    // The farming map with most points instead, with nobody marked as standing on it.
    expect(shownMap()).toMatch(/^Test Plains · \d+ points$/);
    expect(within(mapChooser()).queryByRole('button', { name: /Test Den/ })).toBeNull();
    // The old goal can still be seen and stopped, but offers no map to jump to.
    const bar = screen.getByRole('region', { name: 'Farming goal' });
    expect(bar.textContent).toContain('Farming Ashwolf on Test Den');
    expect(within(bar).queryByRole('button', { name: /Show map/ })).toBeNull();
    // Starting again targets a farming map.
    const detail = screen.getByRole('article', { name: 'Ashwolf' });
    expect([...detail.querySelectorAll('.farm-map-row-name')].map((n) => n.textContent)).toEqual([
      'Test Plains',
      'Test Cave',
    ]);
  });

  it('fits the focused pet, offers the whole map, and refits on a new selection', async () => {
    vi.mocked(api.readPetsCatalogue).mockResolvedValue(fieldCatalogue());
    await open();
    const whole = '1024 1024 2048 2048';
    fireEvent.click(pick('Ashwolf'));
    const fitted = viewBox()!.split(' ').map(Number);
    // The camp, not the whole map: the minimum extent of 300 m is 600 px here.
    expect(fitted[2]).toBeCloseTo(600);
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    expect(viewBox()).toBe(whole);
    fireEvent.click(screen.getByRole('button', { name: 'Fit spawn points' }));
    expect(viewBox()!.split(' ').map(Number)[2]).toBeCloseTo(600);
    // A pet that never spawns here moves the view to its own map.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(pick('Copper Crab'));
    expect(shownMap()).toMatch(/^Test Cave/);
  });

  it('keeps a moved view across live polls', async () => {
    vi.mocked(api.readPetsCatalogue).mockResolvedValue(fieldCatalogue());
    await open();
    fireEvent.click(pick('Ashwolf'));
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    await new Promise((r) => setTimeout(r, 1200));
    expect(viewBox()).toBe('1024 1024 2048 2048');
  });

  it('finds maps by name and remembers the chosen map natively', async () => {
    await open();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets and maps' }), {
      target: { value: 'cave' },
    });
    const maps = screen.getByRole('list', { name: 'Matching maps' });
    fireEvent.click(within(maps).getByRole('button', { name: /Test Cave/ }));
    expect(shownMap()).toMatch(/^Test Cave/);
    await waitFor(() =>
      expect(backend.config.last_map_id).toBe('Intersever/Abyss/Abyss_Reshanta_A'),
    );
    // The search also finds pets by the maps they spawn on.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(rankedNames()).toEqual(['Ashwolf', 'Copper Crab']);
  });

  it('lists only pets farmable on the shown map when asked', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Farmable here' }));
    expect(rankedNames()).toEqual(['Ashwolf', 'Barn Owl']);
  });

  it('lists every pin in the pinned mode, even with no spawns on the shown map', async () => {
    // Copper Crab spawns only in the cave and is complete; Dawn Drake spawns nowhere.
    backend = status({ config: { ...status().config, pinned_ids: [3, 4, 2] } });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(rankedNames()).toEqual(['Copper Crab', 'Dawn Drake', 'Barn Owl', 'Ashwolf']);
    const farmable = screen.getByRole('checkbox', { name: 'Farmable here' });
    fireEvent.click(farmable);
    expect(rankedNames()).toEqual(['Barn Owl', 'Ashwolf']);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(rankedNames()).toEqual(['Copper Crab', 'Dawn Drake', 'Barn Owl']);
    expect(farmable.getAttribute('aria-disabled')).toBe('true');
    expect(farmable.getAttribute('aria-checked')).toBe('false');
    const note = (name: string) => pick(name).querySelector('.farm-pick-note')?.textContent;
    expect(note('Copper Crab')).toBe('Complete · not on this map');
    expect(note('Barn Owl')).toBe('10/25 · 15 souls to Lv 2');
    expect(screen.getByText('3 of 3 pinned pets')).toBeTruthy();
    // Back in the other lists, Farmable here applies again.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(farmable.getAttribute('aria-checked')).toBe('true');
    expect(rankedNames()).toEqual(['Barn Owl', 'Ashwolf']);
  });

  it('moves between ranked pets with the arrow keys and selects on click', async () => {
    await open();
    pick('Ashwolf').focus();
    fireEvent.keyDown(pick('Ashwolf'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(pick('Dawn Drake'));
    fireEvent.keyDown(pick('Dawn Drake'), { key: 'End' });
    expect(document.activeElement).toBe(pick('Barn Owl'));
    expect(pick('Barn Owl').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pick('Barn Owl'));
    expect(pick('Barn Owl').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows each pet in the collection as a card led by its original portrait', async () => {
    await openCollection();
    expect(rowNames()).toEqual(['Ashwolf', 'Barn Owl', 'Copper Crab', 'Dawn Drake']);
    const img = card('Ashwolf').querySelector('.pet-portrait img')!;
    expect(img.getAttribute('src')).toBe('/pet-art/ashwolf-test.png');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    const family = card('Ashwolf').querySelector('.pet-card-family')!;
    expect(family.querySelector('img')?.getAttribute('src')).toMatch(/^\/pet-type-art\//);
    expect(family.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(family.querySelector('svg')).toBeNull();
    expect(cardButton('Ashwolf').getAttribute('aria-pressed')).toBe('false');
    expect(card('Barn Owl').querySelector('.pet-portrait img')).toBeNull();
    expect(card('Barn Owl').textContent).toContain('No portrait');
    expect(screen.getByRole('button', { name: /^Barn Owl/ })).toBe(cardButton('Barn Owl'));
    expect(within(card('Barn Owl')).getByText('Active')).toBeTruthy();
    // Barn Owl: level 1 with 10 of 25 souls.
    expect(cardButton('Barn Owl').textContent).toContain('10/25');
  });

  it('marks stage, pin and selection on the cards', async () => {
    await openCollection();
    expect(card('Ashwolf').classList).toContain('is-unowned');
    expect(card('Barn Owl').classList).toContain('is-growing');
    expect(card('Copper Crab').classList).toContain('is-maxed');
    expect(card('Copper Crab').textContent).toContain('Complete');
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Dawn Drake' }));
    await waitFor(() => expect(card('Dawn Drake').classList).toContain('is-pinned'));
    expect(rowNames()[0]).toBe('Dawn Drake');
    fireEvent.click(cardButton('Barn Owl'));
    // Choosing a pet in the collection opens it on the map, ready to farm.
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('pet-detail-name')?.textContent).toBe('Barn Owl');
    expect(startFarming()).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Collection' }));
    expect(cardButton('Barn Owl').getAttribute('aria-pressed')).toBe('true');
    expect(cards().filter((li) => li.classList.contains('is-selected'))).toHaveLength(1);
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Ashwolf' }));
    expect(card('Ashwolf').classList).not.toContain('is-selected');
    await waitFor(() => expect(card('Ashwolf').classList).toContain('is-pinned'));
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([1, 4]));
  });

  it('shows a pin at once, before its save lands, and takes it back when the save fails', async () => {
    await openCollection();
    let release = () => {};
    vi.mocked(api.configurePets).mockImplementationOnce(
      (config) =>
        new Promise((resolve, reject) => {
          release = () => void save(config).then(resolve, reject);
        }),
    );
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Barn Owl' }));
    // Lit in this window straight away, while native has not answered yet.
    expect(card('Barn Owl').classList).toContain('is-pinned');
    expect(within(list()).getByRole('button', { name: 'Unpin Barn Owl' })).toBeTruthy();
    expect(backend.config.pinned_ids).toEqual([]);
    await waitFor(() => expect(api.configurePets).toHaveBeenCalledOnce());
    release();
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([2]));
    expect(card('Barn Owl').classList).toContain('is-pinned');
    // A refused save takes the optimistic pin back.
    vi.mocked(api.configurePets).mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Dawn Drake' }));
    expect(card('Dawn Drake').classList).toContain('is-pinned');
    await waitFor(() => expect(card('Dawn Drake').classList).not.toContain('is-pinned'));
    expect(backend.config.pinned_ids).toEqual([2]);
  });

  it('keeps an unknown collection in full colour, never greyed out as unowned', async () => {
    backend = status({ collection_synced: false, live_synced: false, progress: [] });
    await openCollection();
    for (const li of cards()) {
      expect(li.classList).toContain('is-unknown');
      expect(li.classList).not.toContain('is-unowned');
    }
    expect(cardButton('Ashwolf').textContent).toContain('Souls unknown');
    for (const name of ['Not owned', 'Incomplete', 'Max level'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves focus between cards with the arrow, Home and End keys', async () => {
    await openCollection();
    cardButton('Ashwolf').focus();
    fireEvent.keyDown(cardButton('Ashwolf'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cardButton('Barn Owl'));
    fireEvent.keyDown(cardButton('Barn Owl'), { key: 'End' });
    expect(document.activeElement).toBe(cardButton('Dawn Drake'));
    fireEvent.keyDown(cardButton('Dawn Drake'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cardButton('Copper Crab'));
    fireEvent.keyDown(cardButton('Copper Crab'), { key: 'Home' });
    expect(document.activeElement).toBe(cardButton('Ashwolf'));
    expect(cards().some((li) => li.classList.contains('is-selected'))).toBe(false);
  });

  it('keeps search, family and filter working on the cards, with the obtain rule from the catalogue', async () => {
    await openCollection();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets' }), {
      target: { value: 'crab' },
    });
    expect(rowNames()).toEqual(['Copper Crab']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets' }), {
      target: { value: 'test cave' },
    });
    expect(rowNames()).toEqual(['Ashwolf', 'Copper Crab']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets' }), {
      target: { value: '' },
    });
    const notOwned = screen.getByRole('button', { name: 'Not owned' });
    expect(notOwned.getAttribute('title')).toBe('Level 0: 5 souls obtain it');
    fireEvent.click(notOwned);
    expect(rowNames()).toEqual(['Ashwolf', 'Dawn Drake']);
    fireEvent.click(screen.getByRole('button', { name: /^Natura/ }));
    expect(screen.getByText('No pets match')).toBeTruthy();
  });

  it('pins first and keeps quick successive pins in order', async () => {
    await openCollection();
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Copper Crab' }));
    fireEvent.click(within(list()).getByRole('button', { name: 'Pin Ashwolf' }));
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([1, 3]));
    expect(backend.config.revision).toBe(6);
    await waitFor(() => expect(rowNames().slice(0, 2)).toEqual(['Ashwolf', 'Copper Crab']));
    fireEvent.click(within(list()).getByRole('button', { name: 'Unpin Ashwolf' }));
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([3]));
  });

  it('re-applies a pin on top of a change saved by another window', async () => {
    await open();
    // The radar window pinned Barn Owl after this tab last polled.
    backend = {
      ...backend,
      config: { ...backend.config, pinned_ids: [2], revision: backend.config.revision + 1 },
    };
    fireEvent.click(within(ranked()).getByRole('button', { name: 'Pin Ashwolf' }));
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([1, 2]));
    expect(api.configurePets).toHaveBeenCalledTimes(2);
  });

  it('keeps a goal saved by another window when pinning', async () => {
    await open();
    backend = {
      ...backend,
      config: {
        ...backend.config,
        farming_goal: { pet_id: 2, map_id: 'World/World_L/World_L_A' },
        revision: backend.config.revision + 1,
      },
    };
    fireEvent.click(within(ranked()).getByRole('button', { name: 'Pin Ashwolf' }));
    await waitFor(() => expect(backend.config.pinned_ids).toEqual([1]));
    expect(backend.config.farming_goal).toEqual({ pet_id: 2, map_id: 'World/World_L/World_L_A' });
  });

  it('switches to a saved profile read-only, with an unknown collection', async () => {
    await open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), {
      target: { value: 'p2' },
    });
    await waitFor(() => expect(api.readPetsStatus).toHaveBeenLastCalledWith('p2'));
    expect(await screen.findByText(/saved profile · offline/)).toBeTruthy();
    expect(liveLayer().getAttribute('title')).toContain('Showing a saved profile');
    // Its collection was never synced: every Level 3 count is unknown, never zero.
    await waitFor(() => expect(tile('all').textContent).toContain('Level 3 unknown'));
    // (No pet is Cognia here, so that tile counts none.)
    for (const family of ['all', 'Fera', 'Natura', 'Varia', 'Specia'])
      expect(tile(family).textContent).not.toMatch(/\d+ at Level 3/);
    expect(tile('Fera').textContent).toContain('1 pet');
    expect(overview().textContent).toContain('Saved profilenever synced');
  });

  it('draws live sightings as a map layer that can be hidden, apart from spawn points', async () => {
    const wolf = {
      entity_id: 5,
      npc_id: 900,
      name: 'Test Wolf',
      pet_ids: [1],
      x: 100,
      y: -200,
      distance: 42,
      bearing: 90,
      observed_ms: status().now_ms - 2000,
    };
    backend = status({ nearby: [{ ...wolf, entity_id: 6, distance: 80, bearing: 270 }, wolf] });
    await open();
    const sightings = () => document.querySelectorAll('[data-mark-key^="live:"]');
    expect(sightings()).toHaveLength(2);
    expect(liveLayer().textContent).toContain('2');
    fireEvent.click(liveLayer());
    expect(liveLayer().getAttribute('aria-pressed')).toBe('false');
    expect(sightings()).toHaveLength(0);
    // Spawn points are their own layer: hiding them keeps only the selection and goal.
    const spawns = () => document.querySelectorAll('[data-mark-key^="spawn:"]');
    expect(spawns().length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Spawns' }));
    expect(spawns()).toHaveLength(0);
    fireEvent.click(pick('Barn Owl'));
    expect(spawns()).toHaveLength(1);
  });

  it('saves a slider value captured when it settles', async () => {
    await open();
    expect(screen.queryByRole('slider', { name: /Nearby radius/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Radar settings' }));
    const slider = screen.getByRole('slider', { name: /Nearby radius/ });
    fireEvent.change(slider, { target: { value: '300' } });
    fireEvent.change(slider, { target: { value: '400' } });
    await waitFor(() => expect(backend.config.nearby_radius).toBe(400));
    expect(api.configurePets).toHaveBeenCalledOnce();
  });
});

describe('map art while the tab is off screen', () => {
  let pageState: DocumentVisibilityState = 'visible';
  beforeEach(() => {
    pageState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => pageState,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });
  const setPage = (next: DocumentVisibilityState) => {
    pageState = next;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  const pass = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  /** Map art images drawn in the farming map. */
  const artImages = () => document.querySelectorAll('.pet-map-svg .pet-map-tiles image').length;
  const pickSearch = () =>
    screen.getByRole('searchbox', { name: 'Search pets and maps' }) as HTMLInputElement;

  /** Opens the farming map on art with a pet chosen, the view moved and the picker searched. */
  async function chooseThings() {
    vi.mocked(api.readPetsCatalogue).mockResolvedValue(fieldCatalogue());
    const view = render(<PetsTab native active />);
    await screen.findByRole('list', { name: 'Ranked pets' });
    fireEvent.click(pick('Ashwolf'));
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    fireEvent.change(pickSearch(), { target: { value: 'ash' } });
    expect(artImages()).toBeGreaterThan(0);
    return view;
  }
  /** Every choice made in `chooseThings` is still in place. */
  const expectChoicesKept = () => {
    expect(viewBox()).toBe('1024 1024 2048 2048');
    expect(pickSearch().value).toBe('ash');
    expect(pick('Ashwolf').getAttribute('aria-pressed')).toBe('true');
  };

  it('releases the art once the tab stays hidden, keeping the view and every choice', async () => {
    const { rerender } = await chooseThings();
    vi.useFakeTimers();
    rerender(<PetsTab native active={false} />);
    // A quick look at another tab keeps the art, so coming back never redraws it.
    pass(HIDDEN_RELEASE_MS - 1);
    expect(artImages()).toBeGreaterThan(0);
    pass(1);
    expect(artImages()).toBe(0);
    // The panel stays mounted: the map, its view and the choices made in it are all there.
    expectChoicesKept();
    rerender(<PetsTab native active />);
    expect(artImages()).toBeGreaterThan(0);
    expectChoicesKept();
  });

  it('releases the art of a minimised workspace and draws it again when it shows', async () => {
    await chooseThings();
    vi.useFakeTimers();
    setPage('hidden');
    pass(HIDDEN_RELEASE_MS / 2);
    // Shown again before the grace ran out: still drawn, and a later hide starts over.
    setPage('visible');
    setPage('hidden');
    pass(HIDDEN_RELEASE_MS / 2);
    expect(artImages()).toBeGreaterThan(0);
    pass(HIDDEN_RELEASE_MS / 2);
    expect(artImages()).toBe(0);
    setPage('visible');
    expect(artImages()).toBeGreaterThan(0);
    expectChoicesKept();
  });
});

describe('farming map hover cards', () => {
  const marks = () => within(screen.getByRole('group', { name: /^Map marks/ }));
  const owlMark = () =>
    marks().getByRole('button', { name: 'Barn Owl (Natura): 1 static spawn point' });
  const tooltip = () => screen.queryByRole('tooltip');

  it('shows the pet of a spawn mark on hover, with no native tooltip beside it', async () => {
    await open();
    const owl = owlMark();
    expect(owl.querySelector('title')).toBeNull();
    fireEvent.pointerEnter(owl, { pointerType: 'mouse' });
    const card = await screen.findByRole('tooltip');
    expect(owl.getAttribute('aria-describedby')).toBe(card.id);
    expect(card.querySelector('.pet-portrait')).not.toBeNull();
    // The family with its written name, the collection state and what drops it here.
    expect(card.querySelector('.pet-family')?.textContent).toBe('Natura');
    expect(card.textContent).toContain('Barn Owl');
    expect(card.textContent).toContain('Level 1');
    expect(card.textContent).toMatch(/10\/25.*15 souls to Lv 2/);
    expect(card.textContent).toContain('Source here');
    expect(card.textContent).toContain('Test Owl');
    expect(card.textContent).toContain('1 static spawn point');
    expect(card.textContent).toContain('Active pet');
    expect(card.textContent).toContain('Click to select');
    fireEvent.pointerLeave(owl);
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  it('marks the goal and pins on the card, and a click still selects', async () => {
    backend = status({
      config: {
        ...status().config,
        pinned_ids: [2],
        farming_goal: { pet_id: 1, map_id: 'World/World_L/World_L_A' },
      },
    });
    await open();
    const wolf = marks().getAllByRole('button', { name: /^Ashwolf \(Fera\)/ })[0]!;
    fireEvent.pointerEnter(wolf, { pointerType: 'mouse' });
    const card = await screen.findByRole('tooltip');
    expect(card.textContent).toContain('Not owned');
    expect(card.textContent).toContain('5 souls to obtain');
    expect(card.textContent).toContain('Your goal');
    expect(card.textContent).not.toContain('Pinned');
    fireEvent.pointerLeave(wolf);
    fireEvent.pointerEnter(owlMark(), { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()?.textContent).toContain('Barn Owl'));
    expect(tooltip()?.textContent).toContain('Pinned');
    expect(tooltip()?.textContent).not.toContain('Your goal');
    fireEvent.click(owlMark());
    expect(document.getElementById('pet-detail-name')?.textContent).toBe('Barn Owl');
    expect(owlMark().getAttribute('aria-pressed')).toBe('true');
  });

  it('describes live sightings and your position the same way', async () => {
    backend = status({
      nearby: [
        {
          entity_id: 5,
          npc_id: 900,
          name: 'Test Wolf',
          pet_ids: [1],
          x: 50,
          y: -50,
          distance: 42,
          bearing: 90,
          observed_ms: status().now_ms - 20_000,
        },
      ],
    });
    await open();
    const sighting = marks().getByRole('button', { name: 'Live sighting: Test Wolf' });
    expect(sighting.querySelector('title')).toBeNull();
    fireEvent.pointerEnter(sighting, { pointerType: 'mouse' });
    const card = await screen.findByRole('tooltip');
    expect(card.textContent).toContain('Live sighting');
    expect(card.textContent).toContain('Seen 20s ago');
    expect(card.textContent).toContain('42 m');
    expect(card.textContent).toContain('Drops souls of');
    expect(card.textContent).toContain('Ashwolf');
    fireEvent.pointerLeave(sighting);
    const you = marks().getByRole('img', { name: /^Your last observed position/ });
    fireEvent.pointerEnter(you, { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()?.textContent).toContain('Your last observed position'));
    expect(tooltip()?.textContent).toContain('no facing direction');
  });

  it('is one tab stop: focus shows the card, arrows move, Enter selects, Escape dismisses', async () => {
    await open();
    const all = [...document.querySelectorAll('[data-mark-key]')];
    expect(all.filter((m) => m.getAttribute('tabindex') === '0')).toHaveLength(1);
    act(() => (owlMark() as unknown as SVGElement).focus());
    expect(tooltip()?.textContent).toContain('Barn Owl');
    fireEvent.keyDown(owlMark(), { key: 'Escape' });
    expect(tooltip()).toBeNull();
    // Right of the owl lies your position, nearer than the wolf's camp.
    fireEvent.keyDown(owlMark(), { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-mark-key')).toBe('you');
    expect(tooltip()?.textContent).toContain('Your last observed position');
    expect(owlMark().getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(owlMark());
    fireEvent.keyDown(owlMark(), { key: 'Enter' });
    expect(document.getElementById('pet-detail-name')?.textContent).toBe('Barn Owl');
  });
});
