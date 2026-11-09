import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { GroupRun, LiveStatus, OverlayStatus } from '../../types/companion';
import type { CombatReport, PolledOfflineStatus } from '../../types/offline';
import type { GroupStatusData } from '../group/model';
import { Meter } from './meterHarness';
import { layOutMeter, METER_CHROME, meterReport } from './meterFixtures';

/*
 * The party room drawn inside the meter: its contents, switch, hit regions, focus and
 * height. Which sheet the meter shows when, and the saved fight across group changes, are
 * decided and tested in `meterState`.
 */

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

function props(group: GroupStatusData | null, extra: Partial<Parameters<typeof Meter>[0]> = {}) {
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
/** The pressed segment of the meter's Group and DPS switch; null without a switch. */
const pressedView = () => {
  const switched = viewSwitch();
  if (!switched) return null;
  return within(switched)
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent)
    .join('+');
};
/** The meter's fight controls on screen; the room draws none of them. */
const fightControls = () =>
  ['History', 'New fight', 'Copy summary', 'My DPS'].filter(
    (name) => screen.queryByRole('button', { name }) !== null,
  );

describe('the party room inside the DPS meter', () => {
  it('draws the group of a joined dungeon party before its run, and nothing of the fight', () => {
    render(<Meter {...props(room(outside))} />);
    expect(roomShown()).toBeTruthy();
    expect(pressedView()).toBe('Group');
    expect(fightShown()).toBeNull();
    expect(fightControls()).toEqual([]);
    // The full group: title, capacity, members, readiness and inspections.
    expect(screen.getByText('Deus Research Base')).toBeTruthy();
    expect(screen.getByText('Preparing')).toBeTruthy();
    const members = screen.getByRole('list', { name: 'Group members' });
    expect(within(members).getByText('Aria')).toBeTruthy();
    expect(within(members).getByText('Bryn')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Inspected profiles/ })).toBeTruthy();
  });

  it('shows the live DPS meter with its controls on DPS, and the room again on Group', () => {
    const onReset = vi.fn<() => void>();
    const onCopyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    render(<Meter {...props(room(outside), { onReset, onCopyText })} />);
    choose('DPS');
    expect(roomShown()).toBeNull();
    expect(pressedView()).toBe('DPS');
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
    expect(roomShown()).toBeTruthy();
    expect(pressedView()).toBe('Group');
    expect(fightControls()).toEqual([]);
  });

  it('offers no compact strip on the DPS view while the group prepares', () => {
    const strip = offline(meterReport(), { ...SETTINGS_FALLBACK, compact_strip: true });
    const onEnterStrip = vi.fn<() => void>();
    render(<Meter {...props(room(outside), { offline: strip, onEnterStrip })} />);
    expect(document.querySelector('[data-variant="strip"]')).toBeNull();
    choose('DPS');
    expect(document.querySelector('[data-variant="strip"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show compact strip' })).toBeNull();
  });

  it('marks the switch, room controls and members as clickable while the meter is locked', () => {
    render(<Meter {...props(room(outside), { overlay: { ...overlay, locked: true } })} />);
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

  it('hides with the meter while unlocked', () => {
    const onHide = vi.fn<() => void>();
    render(<Meter {...props(room(outside), { onHide })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide DPS meter' }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it('keeps keyboard focus on the switch when it changes the view', () => {
    render(<Meter {...props(room(outside))} />);
    segment('DPS').focus();
    choose('DPS');
    expect(pressedView()).toBe('DPS');
    expect(document.activeElement).toBe(segment('DPS'));
    choose('Group');
    expect(pressedView()).toBe('Group');
    expect(document.activeElement).toBe(segment('Group'));
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
    const view = render(<Meter {...props(roster(2, 3), { onFit })} />);
    expect(roomShown()).toBeTruthy();
    // Two members and an open place.
    expect(onFit).toHaveBeenLastCalledWith(tall(3));
    view.rerender(<Meter {...props(roster(3, 5), { onFit })} />);
    expect(onFit).toHaveBeenLastCalledWith(tall(5));
    // A raid of twelve in one column: five lines show, the rest of the room scrolls.
    view.rerender(<Meter {...props(roster(12, 12), { onFit })} />);
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
    const view = render(<Meter {...props(roster(8, 8), { onFit })} />);
    // Eight members in two columns are four lines.
    expect(onFit).toHaveBeenLastCalledWith(tall(4));
    view.rerender(<Meter {...props(roster(12, 12), { onFit })} />);
    expect(onFit).toHaveBeenLastCalledWith(tall(5));
  });
});
