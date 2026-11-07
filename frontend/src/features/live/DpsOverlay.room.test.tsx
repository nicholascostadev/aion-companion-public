import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { GroupRun, LiveStatus, OverlayStatus } from '../../types/companion';
import type { CombatReport, LogMeta, PolledOfflineStatus } from '../../types/offline';
import type { GroupStatusData } from '../group/model';
import { DpsOverlay } from './DpsOverlay';
import { aria, bryn, layOutMeter, METER_CHROME, meterReport } from './meterFixtures';
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
const viewSwitch = () => screen.queryByRole('group', { name: 'Meter view' });
const segment = (name: 'Group' | 'DPS') =>
  within(screen.getByRole('group', { name: 'Meter view' })).getByRole('button', { name });
/** Chooses a view on the meter's Group and DPS switch. */
const choose = (name: 'Group' | 'DPS') => fireEvent.click(segment(name));
/**
 * What the meter shows, read from the page as a whole: `group` is the room with the switch
 * on Group and nothing of the fight (no fight controls, no saved fight); `dps` the live meter
 * with the switch on DPS; `fight` the meter with no switch, as no group prepares. Anything
 * else is described, so a failure says what was on screen.
 */
function meterShows() {
  const switched = viewSwitch();
  const pressed = switched
    ? within(switched)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
        .join('+')
    : null;
  const room = roomShown() !== null;
  const fight = fightShown() !== null;
  const fightControls = ['History', 'New fight', 'Copy summary', 'My DPS'].filter(
    (name) => screen.queryByRole('button', { name }) !== null,
  );
  const savedFight = screen.queryByText(/^Saved · /) !== null;
  if (room && !fight && pressed === 'Group' && !fightControls.length && !savedFight) return 'group';
  if (fight && !room && pressed === 'DPS') return 'dps';
  if (fight && !room && pressed === null) return 'fight';
  return JSON.stringify({ room, fight, pressed, fightControls, savedFight });
}

describe('the party room inside the DPS meter', () => {
  it('opens on the group of a joined dungeon party before its run, without a click, even as hits arrive', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    expect(meterShows()).toBe('group');
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
    expect(meterShows()).toBe('group');
  });

  it('prepares when the run state is unknown, as when the app started after joining', () => {
    render(<DpsOverlay {...props(room(unknown))} />);
    expect(meterShows()).toBe('group');
    expect(screen.getByText('Preparing')).toBeTruthy();
  });

  it('shows the live DPS meter with its controls on DPS, and the room again on Group', () => {
    const onReset = vi.fn<() => void>();
    const onCopyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    render(<DpsOverlay {...props(room(outside), { onReset, onCopyText })} />);
    expect(meterShows()).toBe('group');
    choose('DPS');
    expect(meterShows()).toBe('dps');
    // Your own live damage, with the meter's own controls.
    const ranking = screen.getByRole('list', { name: 'Players by damage' });
    expect(within(ranking).getByText('Aria')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'My DPS' }));
    expect(screen.getByRole('list', { name: /^Skills of Aria/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New fight' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    expect(onCopyText).toHaveBeenCalledTimes(1);
    choose('Group');
    expect(meterShows()).toBe('group');
  });

  it('keeps a chosen DPS view through roster, readiness and damage updates of the same group', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    choose('DPS');
    expect(meterShows()).toBe('dps');
    // Polls of the same group: a member readies, another joins, the roster ages, the
    // title changes and damage arrives. None of them takes the meter back to the room.
    const later = room(outside, {
      roster_age_ms: 4000,
      lobby_name: 'Deus Research Base · fast run',
      members: [
        ...room(outside).members.map((m) => ({ ...m, ready: true })),
        { name: 'Cato', server_id: 1001, class: 'Sorcerer', level: 45, ready: false },
      ],
    });
    view.rerender(
      <DpsOverlay
        {...props(later, {
          status: { ...live, events: 80 },
          offline: offline(meterReport({ duration_ms: 90_000 })),
        })}
      />,
    );
    expect(meterShows()).toBe('dps');
    view.rerender(<DpsOverlay {...props(room(unknown))} />);
    expect(meterShows()).toBe('dps');
  });

  it('chooses the group again on joining another group or another dungeon', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    choose('DPS');
    view.rerender(<DpsOverlay {...props(room(outside, { party_id: 77 }))} />);
    expect(meterShows()).toBe('group');
    choose('DPS');
    view.rerender(<DpsOverlay {...props(room(outside, { party_id: 77, dungeon_id: 600120 }))} />);
    expect(meterShows()).toBe('group');
  });

  it('switches to the fight once native observes the run start, and stays through resets, idle and the clear', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    expect(meterShows()).toBe('group');
    view.rerender(<DpsOverlay {...props(room(running()))} />);
    // No way back to the room during the run.
    expect(meterShows()).toBe('fight');
    // A reset (no report yet), an ended pull and an idle meter are all still the run.
    view.rerender(<DpsOverlay {...props(room(running()), { offline: offline(null) })} />);
    expect(roomShown()).toBeNull();
    expect(viewSwitch()).toBeNull();
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
    expect(meterShows()).toBe('fight');
    // Back outside with the group still joined: it prepares for the next run, on the room.
    view.rerender(<DpsOverlay {...props(room(outside))} />);
    expect(meterShows()).toBe('group');
  });

  it('opens the next preparation on the group even after DPS was chosen for the last one', () => {
    const view = render(<DpsOverlay {...props(room(outside))} />);
    choose('DPS');
    view.rerender(<DpsOverlay {...props(room(running()))} />);
    expect(meterShows()).toBe('fight');
    view.rerender(<DpsOverlay {...props(room(outside))} />);
    expect(meterShows()).toBe('group');
  });

  it('shows the fight outside a dungeon group, after leaving, and the group again on rejoining', () => {
    const view = render(<DpsOverlay {...props(room(outside, { dungeon_id: null }))} />);
    // A party formed for no dungeon is not a dungeon group.
    expect(meterShows()).toBe('fight');
    view.rerender(<DpsOverlay {...props(room(outside))} />);
    expect(meterShows()).toBe('group');
    choose('DPS');
    // Leaving shows the fight without a switch.
    view.rerender(<DpsOverlay {...props(room(outside, { room: false }))} />);
    expect(meterShows()).toBe('fight');
    // Rejoining the same group chooses it again.
    view.rerender(<DpsOverlay {...props(room(outside))} />);
    expect(meterShows()).toBe('group');
    view.rerender(<DpsOverlay {...props(null)} />);
    expect(meterShows()).toBe('fight');
    view.rerender(<DpsOverlay {...props(room(outside, { party_id: 77 }))} />);
    expect(meterShows()).toBe('group');
  });

  it('never shows the room without native run state, as with an older native build', () => {
    const { run: _run, preparing: _preparing, room: _room, ...older } = room(outside);
    render(<DpsOverlay {...props(older)} />);
    expect(meterShows()).toBe('fight');
  });

  it('keeps the full meter instead of the compact strip while the group prepares, and the strip returns with the run', () => {
    const strip = offline(meterReport(), {
      ...SETTINGS_FALLBACK,
      compact_strip: true,
    });
    const onEnterStrip = vi.fn<() => void>();
    const view = render(<DpsOverlay {...props(room(outside), { offline: strip, onEnterStrip })} />);
    expect(meterShows()).toBe('group');
    expect(document.querySelector('[data-variant="strip"]')).toBeNull();
    // The DPS view keeps the full meter, so the switch stays in reach; the strip waits.
    choose('DPS');
    expect(meterShows()).toBe('dps');
    expect(document.querySelector('[data-variant="strip"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show compact strip' })).toBeNull();
    view.rerender(<DpsOverlay {...props(room(running()), { offline: strip, onEnterStrip })} />);
    expect(roomShown()).toBeNull();
    expect(viewSwitch()).toBeNull();
    expect(document.querySelector('[data-variant="strip"]')).toBeTruthy();
  });

  it('marks the switch, room controls and members as clickable while the meter is locked', () => {
    render(<DpsOverlay {...props(room(outside), { overlay: { ...overlay, locked: true } })} />);
    expect(segment('Group').hasAttribute('data-hit')).toBe(true);
    expect(segment('DPS').hasAttribute('data-hit')).toBe(true);
    expect(
      screen.getByRole('button', { name: /Inspected profiles/ }).hasAttribute('data-hit'),
    ).toBe(true);
    const member = screen.getByRole('list', { name: 'Group members' }).querySelector('li');
    expect(member?.dataset.hit).toBe('row');
    expect(member?.closest('[data-hit-clip]')).toBeTruthy();
    // Locked: no hide control, as on the fight.
    expect(screen.queryByRole('button', { name: 'Hide DPS meter' })).toBeNull();
    choose('DPS');
    expect(segment('Group').hasAttribute('data-hit')).toBe(true);
    expect(segment('DPS').hasAttribute('data-hit')).toBe(true);
  });

  it('keeps keyboard focus on the switch when it changes the view', () => {
    render(<DpsOverlay {...props(room(outside))} />);
    segment('DPS').focus();
    choose('DPS');
    expect(meterShows()).toBe('dps');
    expect(document.activeElement).toBe(segment('DPS'));
    choose('Group');
    expect(meterShows()).toBe('group');
    expect(document.activeElement).toBe(segment('Group'));
  });

  it('starts every preparation and run on the live meter, whatever saved fight was open', async () => {
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
    const openSaved = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      const item = await screen.findByRole('menuitemradio', {
        name: /Golem run/,
      });
      await act(async () => {
        fireEvent.click(item);
      });
      expect(screen.getByText(/^Saved · /)).toBeTruthy();
    };
    const view = render(<DpsOverlay {...props(room(running()), { library })} />);
    await openSaved();
    // The run ends and the group prepares for the next one: the room, and on DPS the live fight.
    view.rerender(<DpsOverlay {...props(room(outside), { library })} />);
    expect(meterShows()).toBe('group');
    choose('DPS');
    expect(meterShows()).toBe('dps');
    expect(screen.queryByText(/^Saved · /)).toBeNull();
    // History works on the DPS view while the group prepares, and the room closes it.
    await openSaved();
    choose('Group');
    expect(meterShows()).toBe('group');
    expect(screen.queryByRole('menu')).toBeNull();
    choose('DPS');
    expect(screen.getByText(/^Saved · /)).toBeTruthy();
    // The next run starts on the live meter, not the saved fight.
    view.rerender(<DpsOverlay {...props(room(running('run-2')), { library })} />);
    expect(meterShows()).toBe('fight');
    expect(screen.queryByText(/^Saved · /)).toBeNull();
  });
});

describe('room height', () => {
  /** `count` members of a room for `capacity`, every one a Cleric. */
  const roster = (count: number, capacity: number) =>
    room(outside, {
      capacity,
      members: Array.from({ length: count }, (_, i) => ({
        name: `Member${i + 1}`,
        server_id: 1001,
        class: 'Cleric',
        level: 45,
        leader: i === 0,
      })),
    });
  /** The chrome and `lines` lines of `layOutMeter`: 50 + 2 + 23 per line. */
  const tall = (lines: number) => METER_CHROME + 2 + lines * 23;

  it('grows with the party, open places included, up to five lines, then scrolls', () => {
    const layout = layOutMeter(300);
    onTestFinished(() => layout.restore());
    const onFit = vi.fn<(height: number) => void>();
    const view = render(<DpsOverlay {...props(roster(2, 3), { onFit })} />);
    expect(meterShows()).toBe('group');
    // Two members and an open place.
    expect(onFit).toHaveBeenLastCalledWith(tall(3));
    view.rerender(<DpsOverlay {...props(roster(3, 5), { onFit })} />);
    expect(onFit).toHaveBeenLastCalledWith(tall(5));
    // A raid of twelve in one column: five lines show, the rest of the room scrolls.
    view.rerender(<DpsOverlay {...props(roster(12, 12), { onFit })} />);
    expect(screen.getAllByText(/^Member\d+$/)).toHaveLength(12);
    expect(onFit).toHaveBeenLastCalledWith(tall(5));
    const viewport = screen
      .getByRole('list', { name: 'Group members' })
      .closest('[data-meter-viewport]')!;
    expect(viewport.className).toContain('overflow-y-auto');
    expect(viewport.hasAttribute('data-hit-clip')).toBe(true);
    // The live DPS under the switch takes its own height, and the room its own again.
    choose('DPS');
    expect(onFit).toHaveBeenLastCalledWith(tall(1));
    choose('Group');
    expect(onFit).toHaveBeenLastCalledWith(tall(5));
  });

  it('counts a raid side by side as one line per pair', () => {
    // Wide enough for two columns of six: six lines, so still five lines tall.
    const layout = layOutMeter(300, { columns: 2 });
    onTestFinished(() => layout.restore());
    const onFit = vi.fn<(height: number) => void>();
    const view = render(<DpsOverlay {...props(roster(8, 8), { onFit })} />);
    // Eight members in two columns are four lines.
    expect(onFit).toHaveBeenLastCalledWith(tall(4));
    view.rerender(<DpsOverlay {...props(roster(12, 12), { onFit })} />);
    expect(onFit).toHaveBeenLastCalledWith(tall(5));
  });
});
