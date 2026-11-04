import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { GroupRun, LiveStatus, OverlayStatus } from '../../types/companion';
import type { CombatReport, LogMeta, PolledOfflineStatus } from '../../types/offline';
import type { GroupStatusData } from '../group/model';
import { DpsOverlay } from './DpsOverlay';
import { aria, bryn, meterReport } from './meterFixtures';
import type { MeterLibrary } from './MeterHistory';

afterEach(cleanup);

const live: LiveStatus = {
  running: true,
  phase: 'capturing',
  message: '',
  duration_ms: 30_000,
  events: 9,
  stats: {},
  players: [],
};
const overlay: OverlayStatus = {
  locked: false,
  ready: true,
  visible: true,
  can_lock: true,
  saved_path: '',
  errors: [],
};
const offline = (
  report: CombatReport | null = meterReport(),
  settings = SETTINGS_FALLBACK,
): PolledOfflineStatus => ({
  settings,
  report,
  library_count: 0,
  trackers: [],
  alerts: [],
  catalogue: null,
  capabilities: {},
  error: null,
});

const outside: GroupRun = {
  phase: 'outside',
  dungeon_id: null,
  run_id: null,
  zone_id: 1110,
};
const unknown: GroupRun = {
  phase: 'unknown',
  dungeon_id: null,
  run_id: null,
  zone_id: null,
};
const running = (run_id = 'run-1'): GroupRun => ({
  phase: 'running',
  dungeon_id: 600092,
  run_id,
  zone_id: 600092,
});
/**
 * A party room as native reports it. `preparing` follows native's rule (a dungeon group
 * with no run observed to start); the meter only reads it.
 */
function room(run: GroupRun, patch: Partial<GroupStatusData> = {}): GroupStatusData {
  const inRoom = patch.room ?? true;
  const dungeon = patch.dungeon_id === undefined ? 600092 : patch.dungeon_id;
  return {
    capture_id: 1,
    running: true,
    phase: 'capturing',
    message: '',
    roster_seen: true,
    roster_age_ms: 1000,
    lobby_name: 'Deus Research Base',
    capacity: 5,
    party_id: 41,
    members: [
      {
        name: 'Aria',
        server_id: 1001,
        class: 'Gladiator',
        level: 45,
        gear_score: 2950,
        combat_power: 412_000,
        leader: true,
        ready: true,
      },
      {
        name: 'Bryn',
        server_id: 1001,
        class: 'Cleric',
        level: 45,
        ready: false,
      },
    ],
    inspections: [],
    room: inRoom,
    dungeon_id: dungeon,
    run,
    preparing: inRoom && dungeon !== null && (run.phase === 'outside' || run.phase === 'unknown'),
    ...patch,
  };
}

function props(
  group: GroupStatusData | null,
  extra: Partial<Parameters<typeof DpsOverlay>[0]> = {},
) {
  return {
    status: live,
    overlay,
    error: '',
    busy: false,
    onReset: vi.fn<() => void>(),
    onHide: vi.fn<() => void>(),
    offline: offline(),
    group: { status: group, native: true },
    ...extra,
  };
}
const roomShown = () => screen.queryByRole('region', { name: 'Party room in the DPS meter' });
const fightShown = () => screen.queryByRole('list', { name: 'Players by damage' });
/** Nothing of the fight, and no way to reach it, while the group prepares. */
function expectOnlyTheRoom() {
  expect(roomShown()).toBeTruthy();
  expect(fightShown()).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByRole('tab')).toBeNull();
  for (const name of ['Fight', 'Party room', 'History', 'Reset', 'Copy', 'My DPS'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByText(/^Saved · /)).toBeNull();
}

describe('the party room inside the DPS meter', () => {
  it('shows only the group of a joined dungeon party before its run, without a click, even as hits arrive', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    expectOnlyTheRoom();
    // The full group: title, capacity, members, readiness and inspections.
    expect(screen.getByText('Deus Research Base')).toBeTruthy();
    expect(screen.getByText('Preparing')).toBeTruthy();
    const members = screen.getByRole('list', { name: 'Group members' });
    expect(within(members).getByText('Aria')).toBeTruthy();
    expect(within(members).getByText('Bryn')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Inspected profiles/ })).toBeTruthy();
    // The live report already counts damage dealt in the lobby; it never starts the run.
    view.rerender(
      <DpsOverlay
        {...props(room(outside), {
          status: { ...live, events: 40 },
          offline: offline(meterReport({ duration_ms: 60_000 })),
        })}
      />,
    );
    expectOnlyTheRoom();
  });

  it('prepares when the run state is unknown, as when the app started after joining', () => {
    render(<DpsOverlay {...props(room(unknown))} />);
    expectOnlyTheRoom();
    expect(screen.getByText('Preparing')).toBeTruthy();
  });

  it('switches to the fight once native observes the run start, and stays through resets, idle and the clear', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    expectOnlyTheRoom();
    view.rerender(<DpsOverlay {...props(room(running()))} />);
    expect(roomShown()).toBeNull();
    expect(fightShown()).toBeTruthy();
    // No way back to the room during the run either.
    expect(screen.queryByRole('button', { name: 'Party room' })).toBeNull();
    // A reset (no report yet), an ended pull and an idle meter are all still the run.
    view.rerender(<DpsOverlay {...props(room(running()), { offline: offline(null) })} />);
    expect(roomShown()).toBeNull();
    view.rerender(
      <DpsOverlay
        {...props(room(running()), {
          offline: offline(meterReport({ end_reason: 'idle' })),
          status: { ...live, events: 0 },
        })}
      />,
    );
    expect(roomShown()).toBeNull();
    // A clear keeps the result until the player leaves the dungeon.
    view.rerender(<DpsOverlay {...props(room({ ...running(), phase: 'cleared' }))} />);
    expect(roomShown()).toBeNull();
    expect(fightShown()).toBeTruthy();
    // Back outside with the group still joined: it prepares for the next run.
    view.rerender(<DpsOverlay {...props(room(outside))} />);
    expectOnlyTheRoom();
  });

  it('shows the fight outside a dungeon group, after leaving, and the group again on rejoining', () => {
    const view = render(<DpsOverlay {...props(room(outside, { dungeon_id: null }))} />);
    // A party formed for no dungeon is not a dungeon group.
    expect(roomShown()).toBeNull();
    expect(fightShown()).toBeTruthy();
    view.rerender(<DpsOverlay {...props(room(outside, { room: false }))} />);
    expect(roomShown()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Party room' })).toBeNull();
    view.rerender(<DpsOverlay {...props(room(outside, { party_id: 77 }))} />);
    expectOnlyTheRoom();
  });

  it('never shows the room without native run state, as with an older native build', () => {
    const { run: _run, preparing: _preparing, room: _room, ...older } = room(outside);
    render(<DpsOverlay {...props(older)} />);
    expect(roomShown()).toBeNull();
    expect(fightShown()).toBeTruthy();
  });

  it('shows the room in full instead of the compact strip, and the strip returns with the run', () => {
    const strip = offline(meterReport(), {
      ...SETTINGS_FALLBACK,
      compact_strip: true,
    });
    const view = render(<DpsOverlay {...props(room(outside), { offline: strip })} />);
    expectOnlyTheRoom();
    expect(document.querySelector('[data-variant="strip"]')).toBeNull();
    view.rerender(<DpsOverlay {...props(room(running()), { offline: strip })} />);
    expect(roomShown()).toBeNull();
    expect(document.querySelector('[data-variant="strip"]')).toBeTruthy();
  });

  it('marks the room controls and members as clickable while the meter is locked', () => {
    render(<DpsOverlay {...props(room(outside), { overlay: { ...overlay, locked: true } })} />);
    expect(
      screen.getByRole('button', { name: /Inspected profiles/ }).hasAttribute('data-hit'),
    ).toBe(true);
    const member = screen.getByRole('list', { name: 'Group members' }).querySelector('li');
    expect(member?.dataset.hit).toBe('row');
    expect(member?.closest('[data-hit-clip]')).toBeTruthy();
    // Locked: no hide control, as on the fight.
    expect(screen.queryByRole('button', { name: 'Hide DPS meter' })).toBeNull();
  });

  it('replaces an opened saved fight while the group prepares, and the run starts on the live meter', async () => {
    const saved: LogMeta = {
      id: 'fight-old',
      label: 'Golem run',
      started_ms: new Date(2026, 9, 16, 21, 5).getTime(),
      duration_ms: 65_000,
      damage: 100_000,
      dps: 1_538,
      players: 2,
      player_names: [],
      boss: null,
      zone_id: null,
      run_id: null,
      end_reason: 'idle',
    };
    const library: MeterLibrary = {
      list: vi.fn<MeterLibrary['list']>().mockResolvedValue([saved]),
      read: vi.fn<MeterLibrary['read']>().mockResolvedValue(
        meterReport({
          id: 'fight-old',
          end_reason: 'idle',
          players: [aria, bryn],
        }),
      ),
    };
    const view = render(<DpsOverlay {...props(room(running()), { library })} />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const item = await screen.findByRole('menuitemradio', {
      name: /Golem run/,
    });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(screen.getByText(/^Saved · /)).toBeTruthy();
    // The run ends and the group prepares for the next one: only the room shows.
    view.rerender(<DpsOverlay {...props(room(outside), { library })} />);
    expectOnlyTheRoom();
    // The next run starts on the live meter, not the saved fight.
    view.rerender(<DpsOverlay {...props(room(running('run-2')), { library })} />);
    expect(fightShown()).toBeTruthy();
    expect(screen.queryByText(/^Saved · /)).toBeNull();
  });
});
