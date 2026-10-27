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
  ...overrides,
});
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
  resets: {
    daily_ms: NOW + 17 * 3600_000,
    weekly_ms: NOW + 41 * 3600_000,
    timezone: 'Asia/Taipei',
    basis: 'Server reset schedule',
  },
  error: null,
  ...overrides,
});
