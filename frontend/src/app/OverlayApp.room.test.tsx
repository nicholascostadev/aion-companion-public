import { act, cleanup, render, screen, within } from '@testing-library/react';
import * as tauri from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../features/alerts/fixtures';
import { nativeReport } from '../features/offline/fixtures';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import OverlayApp from './OverlayApp';

// The real services, hooks and normalizers run; only the Tauri bridge answers as native would.
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<typeof tauri>()),
  isTauri: () => true,
  invoke: vi.fn<typeof tauri.invoke>(),
}));

/** `group_status` exactly as `LiveCapture::group_snapshot` serializes it. */
const roster = {
  capture_id: 1_762_000_000_000,
  running: true,
  phase: 'capturing',
  message: 'Collecting damage',
  roster_seen: true,
  roster_age_ms: 1200,
  members: [
    {
      character_id: '9001',
      slot: 1,
      group_index: null,
      ready_observed_ms: null,
      name: 'Aria',
      server_id: 1001,
      class: 'Ranger',
      level: 45,
      gear_score: 2950,
      combat_power: 412_000,
      leader: true,
      ready: null,
    },
    {
      character_id: '9002',
      slot: 2,
      group_index: null,
      ready_observed_ms: null,
      name: 'Bryn',
      server_id: 1001,
      class: 'Cleric',
      level: 45,
      gear_score: 2810,
      combat_power: 398_000,
      leader: false,
      ready: null,
    },
  ],
  inspections: [],
  lobby_name: 'Es geht sofort los.',
  capacity: 5,
  party_id: 41,
  room: true,
  dungeon_id: 600092,
  ready_check: {
    active: null,
    started_ms: null,
    observed_ms: null,
    oldest_observed_ms: null,
    expires_ms: null,
    source: 'observed lobby member readiness',
    supported: true,
  },
};
const run = (phase: string, run_id: string | null = null) => ({
  phase,
  dungeon_id: run_id ? 600092 : null,
  run_id,
  zone_id: phase === 'unknown' ? null : 600092,
});
/** Joined mid-session: native has seen no zone or dungeon state, and the group prepares. */
const joined = { ...roster, run: run('unknown'), preparing: true };
const started = { ...roster, run: run('running', 'run-1'), preparing: false };
const left = {
  ...roster,
  members: [],
  lobby_name: null,
  capacity: null,
  party_id: null,
  room: false,
  dungeon_id: null,
  run: run('outside'),
  preparing: false,
};

let group: unknown = joined;
let locked = false;
let compact = false;
// The live report already holds damage dealt in the lobby.
let report: unknown = {
  ...nativeReport,
  detail_level: 'summary',
  events: [],
  buffs: [],
  hp: [],
  end_reason: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(tauri.invoke).mockImplementation(async (command) => {
    switch (command) {
      case 'group_status':
        return group;
      case 'live_status':
        return {
          running: true,
          phase: 'capturing',
          message: 'Collecting damage',
          duration_ms: 30_000,
          events: 40,
          stats: {},
          players: [],
        };
      case 'overlay_status':
        return {
          locked,
          ready: true,
          visible: true,
          can_lock: true,
          saved_path: '',
          errors: [],
        };
      case 'offline_live_status':
        return {
          settings: { ...SETTINGS_FALLBACK, compact_strip: compact },
          report,
          library_count: 0,
          trackers: [],
          alerts: [],
          capabilities: {},
        };
      case 'alerts_status':
        return dashboard({ now_ms: Date.now() });
      case 'overlay_hit_regions':
        return 0;
      default:
        return null;
    }
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  group = joined;
  locked = false;
  compact = false;
});

const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const roomShown = () => screen.queryByRole('region', { name: 'Party room in the DPS meter' });
const fightShown = () => screen.queryByRole('list', { name: 'Players by damage' });
const regionReports = () =>
  vi.mocked(tauri.invoke).mock.calls.filter(([command]) => command === 'overlay_hit_regions')
    .length;

describe('DPS meter window in a dungeon group', () => {
  it('shows only the group from native group_status before the run, and the fight once it starts', async () => {
    render(<OverlayApp />);
    await tick();
    // No click: the joined group is the meter's only content, despite the lobby damage.
    expect(roomShown()).toBeTruthy();
    expect(fightShown()).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
    expect(screen.getByText('Es geht sofort los.')).toBeTruthy();
    const members = screen.getByRole('list', { name: 'Group members' });
    expect(within(members).getByText('Aria')).toBeTruthy();
    expect(within(members).getByText('Bryn')).toBeTruthy();

    group = started;
    await tick(1000);
    expect(roomShown()).toBeNull();
    expect(fightShown()).toBeTruthy();
    // A reset leaves no report; the run keeps the meter.
    report = null;
    await tick(1000);
    expect(roomShown()).toBeNull();

    // Leaving shows the meter; joining another dungeon group shows its room again.
    group = left;
    await tick(1000);
    expect(roomShown()).toBeNull();
    group = { ...joined, party_id: 77, run: run('outside') };
    await tick(1000);
    expect(roomShown()).toBeTruthy();
  });

  it('replaces the compact strip and keeps the locked room clickable until the run starts', async () => {
    locked = true;
    compact = true;
    const view = render(<OverlayApp />);
    await tick(1000);
    expect(roomShown()).toBeTruthy();
    expect(view.container.querySelector('[data-variant="strip"]')).toBeNull();
    expect(regionReports()).toBeGreaterThan(0);

    group = started;
    await tick(1000);
    expect(roomShown()).toBeNull();
    expect(view.container.querySelector('[data-variant="strip"]')).toBeTruthy();
    // The strip has no controls: nothing stays clickable once the run shows it.
    vi.mocked(tauri.invoke).mockClear();
    await tick(1000);
    expect(regionReports()).toBe(0);
  });
});
