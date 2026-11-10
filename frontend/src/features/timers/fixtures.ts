import type { TimerRow, TimersStatus } from '../../types/timers';

export const NOW = Date.UTC(2026, 9, 19, 13, 0);
export const timer = (overrides: Partial<TimerRow> = {}): TimerRow => ({
  id: 'festival',
  name: 'Shugo Festival',
  category: 'event',
  due_ms: NOW + 60_000,
  ends_ms: null,
  state: 'scheduled',
  estimated: false,
  basis: 'Bundled calendar',
  timezone: 'UTC',
  map_id: null,
  ...overrides,
});
/** Field bosses of a normal-world map and an Abyss map, as native groups them. */
export const VERTERON = {
  id: 1010,
  name: 'Verteron',
  rows: [
    timer({
      id: 'field-2101074',
      name: 'Eternal Gartua',
      category: 'field_boss',
      due_ms: NOW + 45 * 60_000,
      estimated: true,
      basis: 'Respawn estimated from a local observation',
      map_id: 1010,
    }),
    timer({
      id: 'field-2100003',
      name: 'Neikel of the East',
      category: 'field_boss',
      state: 'unknown',
      due_ms: null,
      map_id: 1010,
    }),
  ],
};
export const LOWER_RESHANTA = {
  id: 20,
  name: 'Chaotic Lower Reshanta',
  rows: [
    timer({
      id: 'field-2600068',
      name: 'Argo, the Spirit King',
      category: 'field_boss',
      due_ms: NOW + 5 * 60_000,
      map_id: 20,
    }),
  ],
};
export const timersStatus = (overrides: Partial<TimersStatus> = {}): TimersStatus => ({
  now_ms: NOW,
  region: 'TW',
  region_name: 'Taiwan',
  timezone: 'Asia/Taipei',
  clock_ready: true,
  clock_estimated: false,
  rows: [
    timer(),
    timer({
      id: 'watcher',
      name: 'Watcher Kaira',
      category: 'world_boss',
      state: 'open',
      due_ms: NOW - 60_000,
      ends_ms: NOW + 17 * 60_000,
    }),
    timer({
      id: 'observed',
      name: 'Observed boss',
      category: 'field_boss',
      state: 'alive',
      due_ms: null,
    }),
    timer({
      id: 'unknown',
      name: 'Unobserved boss',
      category: 'field_boss',
      state: 'unknown',
      due_ms: null,
    }),
  ],
  current_map: { id: LOWER_RESHANTA.id, name: LOWER_RESHANTA.name },
  maps: [VERTERON, LOWER_RESHANTA],
  resets: {
    daily_ms: NOW + 17 * 3600_000,
    weekly_ms: NOW + 41 * 3600_000,
    timezone: 'Asia/Taipei',
    basis: 'Server reset schedule',
  },
  error: null,
  ...overrides,
});
