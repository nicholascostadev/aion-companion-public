import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import resourceArt from '../../data/resource-art.json';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import { classColor, UNKNOWN_CLASS_COLOR } from '../../lib/classColors';
import type { LiveStatus, OverlayStatus } from '../../types/companion';
import type { CombatReport, LogMeta, OfflineSettings, OfflineStatus } from '../../types/offline';
import { DpsOverlay } from './DpsOverlay';
import {
  aria,
  bleed,
  bryn,
  crush,
  layOutMeterList,
  manySkills,
  meterReport,
  strike,
} from './meterFixtures';
import type { MeterLibrary } from './MeterHistory';

afterEach(cleanup);

const status: LiveStatus = {
  running: true,
  phase: 'capturing',
  message: 'Collecting damage',
  duration_ms: 10_000,
  events: 6,
  stats: { gaps: 0 },
  players: [],
};
const overlay: OverlayStatus = {
  locked: true,
  ready: true,
  visible: true,
  can_lock: true,
  saved_path: '',
  errors: [],
};
const offline = (report: CombatReport | null, settings: OfflineSettings = SETTINGS_FALLBACK) =>
  ({
    settings,
    report,
    library_count: 0,
    trackers: [],
    alerts: [],
    catalogue: null,
    capabilities: {},
    error: null,
  }) satisfies OfflineStatus;

type Props = Parameters<typeof DpsOverlay>[0];
function props(extra: Partial<Props> = {}): Props {
  return {
    status,
    overlay,
    error: '',
    busy: false,
    onReset: vi.fn<() => void>(),
    onHide: vi.fn<() => void>(),
    onQuit: vi.fn<() => void>(),
    ...extra,
  };
}

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');
const cells = (row: HTMLElement) =>
  [...row.querySelectorAll('.meter-row > span:not(.meter-bar)')].map((c) => c.textContent);
const marks = () =>
  rows().map((row) =>
    (row.querySelector<HTMLElement>('.meter-bar')?.style.getPropertyValue('--mark') ?? '').trim(),
  );
const tab = (name: string) => screen.getByRole('button', { name });
const pressed = (name: string) => tab(name).getAttribute('aria-pressed');
const stat = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

describe('compact DPS meter', () => {
  it('ranks a sole damager like any other, with no edit clutter', () => {
    render(<DpsOverlay {...props({ offline: offline(meterReport()) })} />);
    // One player dealing damage still gets the ordinary ranking row, never their skills.
    expect(pressed('My DPS')).toBe('false');
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
    expect(rows().map(cells)).toEqual([['Aria you', '74.6K', '7.5K', '100.0%']]);
    expect(screen.queryByText(/Current DPS|Avg DPS/)).toBeNull();
    expect(screen.getByText('0:10')).toBeTruthy();
    expect(screen.getByText('Training Golem')).toBeTruthy();
    expect(screen.getByText(/^Live · since \d{2}:\d{2}/)).toBeTruthy();
    // Locked: no window, capture or lock controls, no development footer.
    for (const name of ['Hide DPS meter', 'Quit Aion Companion', 'Lock', 'Stop & save', 'Start'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByText(/Experimental|events ·|gaps/)).toBeNull();
  });

  it("shows each player's observed combat power compactly beside them, and never when hidden", () => {
    const powered = meterReport({
      players: [
        { ...aria, gear_score: 2399, combat_power: 126_600 },
        { ...bryn, combat_power: 98_400 },
      ],
    });
    const view = render(<DpsOverlay {...props({ offline: offline(powered) })} />);
    expect(rows().map((row) => cells(row)[0])).toEqual(['Aria you 126.6K', 'Bryn 98.4K']);
    expect(screen.queryByText(/2,399|2\.4K/)).toBeNull();
    const settings = { ...SETTINGS_FALLBACK, hide_names: true };
    view.rerender(<DpsOverlay {...props({ offline: offline(powered, settings) })} />);
    expect(screen.queryByText(/126\.6K|98\.4K/)).toBeNull();
    // Unknown combat power shows no figure: never the gear score instead.
    const unknown = meterReport({
      players: [
        { ...aria, gear_score: 2399 },
        { ...bryn, combat_power: 98_400 },
      ],
    });
    view.rerender(<DpsOverlay {...props({ offline: offline(unknown) })} />);
    expect(rows().map((row) => cells(row)[0])).toEqual(['Aria you', 'Bryn 98.4K']);
  });

  it("opens a sole damager's skills from their ranking row", () => {
    render(<DpsOverlay {...props({ offline: offline(meterReport()) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    expect(pressed('My DPS')).toBe('true');
    // No ranking tab: My DPS toggles back to the ranking.
    expect(screen.queryByRole('button', { name: 'Players' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Skills of Aria' })).toBeTruthy();
    // Skills show damage and share only: no hits column.
    expect(rows().map(cells)).toEqual([
      ['Spinning Strike', '55.1K', '73.9%'],
      ['Rending Bleed', '9.8K', '13.1%'],
      ['Impactful Crush', '9.7K', '13.0%'],
    ]);
    // Your own line: average DPS only (no current DPS), damage and a solo share of 100%.
    expect(screen.queryByText('Current DPS')).toBeNull();
    expect(stat('Avg DPS')).toBe('7.5K/s');
    expect(stat('Damage')).toBe('74.6K');
    expect(stat('Share')).toBe('100.0%');
    // My DPS leads back to the ranking.
    fireEvent.click(tab('My DPS'));
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
  });

  it('fades after 30 idle seconds by default and returns on new damage', () => {
    vi.useFakeTimers();
    try {
      const view = render(<DpsOverlay {...props({ offline: offline(meterReport()) })} />);
      const meter = () => screen.getByLabelText('Live DPS overlay');
      act(() => {
        vi.advanceTimersByTime(29_000);
      });
      expect(meter().dataset.state).toBeUndefined();
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(meter().dataset.state).toBe('faded');
      expect(meter().style.opacity).toBe(String(SETTINGS_FALLBACK.fade_opacity));
      view.rerender(
        <DpsOverlay
          {...props({ offline: offline(meterReport()), status: { ...status, events: 7 } })}
        />,
      );
      expect(meter().dataset.state).toBeUndefined();
      expect(meter().style.opacity).toBe(String(SETTINGS_FALLBACK.opacity));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a finished boss fight readable instead of fading it', () => {
    vi.useFakeTimers();
    try {
      const boss = [{ id: 60, name: 'Tahabata', boss: true, dummy: false, damage: 74_600 }];
      const killed = meterReport({ end_reason: 'kill', targets: boss });
      const view = render(<DpsOverlay {...props({ offline: offline(killed) })} />);
      const meter = () => screen.getByLabelText('Live DPS overlay');
      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      expect(meter().dataset.state).toBeUndefined();
      expect(screen.getAllByText('Tahabata').length).toBeGreaterThan(0);
      // A cleared boss holds the same way.
      const cleared = meterReport({ end_reason: 'clear', targets: boss });
      view.rerender(<DpsOverlay {...props({ offline: offline(cleared) })} />);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(meter().dataset.state).toBeUndefined();
      // The next, still running fight fades after the usual idle time again.
      const next = meterReport({ id: 'fight-b', targets: boss });
      view.rerender(<DpsOverlay {...props({ offline: offline(next) })} />);
      act(() => {
        vi.advanceTimersByTime(31_000);
      });
      expect(meter().dataset.state).toBe('faded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the next fight the full idle time after a long-held boss fight', () => {
    vi.useFakeTimers();
    try {
      const boss = [{ id: 60, name: 'Tahabata', boss: true, dummy: false, damage: 74_600 }];
      const killed = meterReport({ end_reason: 'kill', targets: boss });
      const view = render(<DpsOverlay {...props({ offline: offline(killed) })} />);
      const meter = () => screen.getByLabelText('Live DPS overlay');
      // The finished boss stays readable for minutes without any new events.
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
      expect(meter().dataset.state).toBeUndefined();
      // The next fight starts with the same raw event count: its idle clock starts now.
      const next = meterReport({ id: 'fight-b', targets: boss });
      view.rerender(<DpsOverlay {...props({ offline: offline(next) })} />);
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(meter().dataset.state).toBeUndefined();
      act(() => {
        vi.advanceTimersByTime(28_000);
      });
      expect(meter().dataset.state).toBeUndefined();
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(meter().dataset.state).toBe('faded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('colours every player by their class, the same in every row', () => {
    const ranger = (id: number, name: string, damage: number) => ({
      ...bryn,
      id,
      name,
      class: 'Ranger',
      damage,
      healing: 0,
    });
    const twin = { ...bryn, id: 5, name: 'Cato', class: 'Cleric', damage: 20_000 };
    const report = meterReport({
      players: [aria, bryn, twin, ranger(6, 'Dara', 15_000), ranger(7, 'Eli', 10_000)],
    });
    render(<DpsOverlay {...props({ offline: offline(report) })} />);
    expect(marks()).toEqual([
      'var(--color-class-gladiator)',
      'var(--color-class-cleric)',
      'var(--color-class-cleric)',
      'var(--color-class-ranger)',
      'var(--color-class-ranger)',
    ]);
    // A player's skills keep their class colour.
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Dara' }));
    for (const mark of marks()) expect(mark).toBe(classColor('Ranger'));
  });

  it('never reveals a hidden local class through its colour', () => {
    const settings = { ...SETTINGS_FALLBACK, hide_names: true };
    render(
      <DpsOverlay
        {...props({ offline: offline(meterReport({ players: [aria, bryn] }), settings) })}
      />,
    );
    expect(marks()).toEqual([UNKNOWN_CLASS_COLOR, classColor('Cleric')]);
  });

  it('keeps the ranking as players join and a chosen view until a new fight', () => {
    const view = render(<DpsOverlay {...props({ offline: offline(meterReport()) })} />);
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
    view.rerender(
      <DpsOverlay {...props({ offline: offline(meterReport({ players: [aria, bryn] })) })} />,
    );
    expect(pressed('My DPS')).toBe('false');
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
    expect(rows().map(cells)).toEqual([
      ['Aria you', '74.6K', '7.5K', '74.6%'],
      ['Bryn', '25.4K', '2.5K', '25.4%'],
    ]);
    // No combined headline: each row carries its own DPS.
    expect(screen.queryByText(/Current DPS|Avg DPS/)).toBeNull();
    expect(screen.queryByText('10K/s')).toBeNull();
    // No crit column: the meter keeps damage, DPS and share; reports keep the crit detail.
    expect(screen.queryByText(/^Crit/)).toBeNull();
    // A choice in this fight holds when solo again…
    fireEvent.click(tab('My DPS'));
    view.rerender(<DpsOverlay {...props({ offline: offline(meterReport()) })} />);
    expect(pressed('My DPS')).toBe('true');
    expect(screen.getByRole('list', { name: 'Skills of Aria' })).toBeTruthy();
    // …until a new fight starts on the ranking, even with a single damager.
    view.rerender(<DpsOverlay {...props({ offline: offline(meterReport({ id: 'fight-b' })) })} />);
    expect(pressed('My DPS')).toBe('false');
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
  });

  it('drills into a player from the ranking and back, rows clickable while locked', () => {
    render(<DpsOverlay {...props({ offline: offline(meterReport({ players: [aria, bryn] })) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Bryn' }));
    expect(pressed('Bryn')).toBe('true');
    expect(rows().map(cells)).toEqual([['Smite', '25.4K', '100.0%']]);
    expect(stat('Share')).toBe('25.4%');
    expect(tab('Bryn').title).toBe('Skills of Bryn · Cleric · click for the player ranking');
    // The viewed player's chip leads back to the ranking…
    fireEvent.click(tab('Bryn'));
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bryn' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Bryn' }));
    fireEvent.click(tab('My DPS'));
    expect(screen.getByRole('list', { name: 'Skills of Aria' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bryn' })).toBeNull();
    // …and so does My DPS once it is on.
    expect(tab('My DPS').title).toBe('Back to the player ranking');
    fireEvent.click(tab('My DPS'));
    expect(pressed('My DPS')).toBe('false');
    expect(rows()).toHaveLength(2);
  });

  it('never calls another sole damager "My DPS"', () => {
    const solo = meterReport({ players: [{ ...bryn, local: false }] });
    render(<DpsOverlay {...props({ offline: offline(solo) })} />);
    expect(screen.queryByRole('button', { name: 'My DPS' })).toBeNull();
    expect(rows().map(cells)).toEqual([['Bryn', '25.4K', '2.5K', '100.0%']]);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Bryn' }));
    expect(pressed('Bryn')).toBe('true');
    expect(screen.getByRole('list', { name: 'Skills of Bryn' })).toBeTruthy();
  });

  it('keeps skills to damage and share even when hit counts are unknown', () => {
    const healer = {
      ...aria,
      healing: 500,
      damage_hits: null,
      damage_crits: null,
      damage_critical_hits_observed: null,
      skills: [
        // Old report: damage and healing hits mixed, no damage-only counters.
        {
          ...strike,
          healing: 500,
          damage_hits: null,
          damage_crits: null,
          damage_critical_hits_observed: null,
        },
        bleed,
        crush,
      ],
    };
    render(<DpsOverlay {...props({ offline: offline(meterReport({ players: [healer] })) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    expect(cells(rows()[0]!)).toEqual(['Spinning Strike', '55.1K', '73.9%']);
  });

  it('opens full details for the shown player of exactly this fight', () => {
    const onInspect = vi.fn<(reportId: string, player: string) => void>();
    render(<DpsOverlay {...props({ offline: offline(meterReport()), onInspect })} />);
    // The ranking itself opens nothing; the player's row leads to their skills first.
    expect(screen.queryByRole('button', { name: 'Full details' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    expect(onInspect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Full details' }));
    expect(onInspect).toHaveBeenLastCalledWith('fight-a', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Impactful Crush: full damage details' }));
    expect(onInspect).toHaveBeenCalledTimes(2);
    expect(onInspect).toHaveBeenLastCalledWith('fight-a', '1');
  });

  it('marks every locked control and row for native hit testing', () => {
    const library: MeterLibrary = {
      list: vi.fn<MeterLibrary['list']>(),
      read: vi.fn<MeterLibrary['read']>(),
    };
    const { container } = render(
      <DpsOverlay
        {...props({
          offline: offline(meterReport()),
          onInspect: vi.fn<(reportId: string, player: string) => void>(),
          onCopyText: vi.fn<(text: string) => Promise<void>>(),
          library,
        })}
      />,
    );
    const labels = () => {
      const buttons = screen.getAllByRole('button');
      // Every button of the locked meter takes clicks through a native hit region.
      expect(buttons.every((b) => b.hasAttribute('data-hit'))).toBe(true);
      return buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent);
    };
    expect(labels()).toEqual(['My DPS', 'History', 'Copy summary', 'New fight', 'Skills of Aria']);
    expect(container.querySelectorAll('[data-hit="row"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    expect(labels()).toEqual([
      'My DPS',
      'History',
      'Copy summary',
      'New fight',
      'Spinning Strike: full damage details',
      'Rending Bleed: full damage details',
      'Impactful Crush: full damage details',
      'Full details',
    ]);
    expect(container.querySelector('ol')!.hasAttribute('data-hit-clip')).toBe(true);
    expect(container.querySelectorAll('[data-hit="row"]')).toHaveLength(3);
  });

  it('offers window controls only when unlocked, never capture controls', () => {
    const controls = props({
      overlay: { ...overlay, locked: false },
      status: { ...status, running: true, phase: 'waiting_for_game', events: 0 },
    });
    render(<DpsOverlay {...controls} />);
    for (const name of [/start/i, /stop/i, /save/i, /pause/i])
      expect(screen.queryByRole('button', { name })).toBeNull();
    // Locking and the workspace live in the top menu and hotkeys, not a helper row.
    expect(screen.queryByText(/drag to move/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /lock|workspace/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide DPS meter' }));
    expect(controls.onHide).toHaveBeenCalledOnce();
    expect(controls.onQuit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Quit Aion Companion' }));
    expect(controls.onQuit).toHaveBeenCalledOnce();
    expect(screen.getByText('Waiting for game…')).toBeTruthy();
    expect(screen.getByText('Capture connects automatically once AION 2 is running.')).toBeTruthy();
  });

  it('reports background capture errors and keeps New fight available', () => {
    const controls = props({
      status: { ...status, running: false, phase: 'error', message: 'Npcap is not installed.' },
    });
    render(<DpsOverlay {...controls} />);
    expect(screen.getByRole('status', { name: 'Overlay status' }).textContent).toBe(
      'Npcap is not installed.',
    );
    expect(screen.getByText('Capture unavailable')).toBeTruthy();
    expect(screen.getByText('Capture retries automatically.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New fight' }));
    expect(controls.onReset).toHaveBeenCalledOnce();
  });

  it('shows as many whole rows as the meter fits and more as the window grows', async () => {
    const layout = layOutMeterList(100);
    onTestFinished(() => layout.restore());
    const skills = manySkills(10);
    const damage = skills.reduce((sum, s) => sum + s.damage, 0);
    const many = meterReport({ players: [{ ...aria, damage, skills }] });
    const onCopyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    render(<DpsOverlay {...props({ offline: offline(many), onCopyText })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    // 100px holds four 21px rows with their gaps; a fifth would be cut off.
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /top|all rows/i })).toBeNull();
    // Copy takes exactly the rows in view.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    });
    const text = onCopyText.mock.lastCall?.[0] ?? '';
    expect(text).toContain('4. Skill 4');
    expect(text).not.toContain('Skill 5');

    layout.resize(200);
    expect(rows()).toHaveLength(8);
    layout.resize(400);
    expect(rows()).toHaveLength(10);
    // Even a tiny window keeps the leader in view.
    layout.resize(10);
    expect(rows().map((row) => cells(row)[0])).toEqual(['Skill 1']);
  });

  it('fits the ranking too', () => {
    const layout = layOutMeterList(50);
    onTestFinished(() => layout.restore());
    render(<DpsOverlay {...props({ offline: offline(meterReport({ players: [aria, bryn] })) })} />);
    expect(rows().map((row) => cells(row)[0])).toEqual(['Aria you', 'Bryn']);
    layout.resize(30);
    expect(rows().map((row) => cells(row)[0])).toEqual(['Aria you']);
  });

  it('refits a lone row after the scale changes, stepping by its scaled gap', () => {
    const layout = layOutMeterList(30);
    onTestFinished(() => layout.restore());
    const report = meterReport({ players: [aria, bryn] });
    const view = render(<DpsOverlay {...props({ offline: offline(report) })} />);
    expect(rows()).toHaveLength(1);
    // At half scale, 30px holds two 10.5px rows and their 1px gaps.
    layout.zoom(0.5);
    const half = offline(report, { ...SETTINGS_FALLBACK, scale: 0.5 });
    view.rerender(<DpsOverlay {...props({ offline: half })} />);
    expect(rows().map((row) => cells(row)[0])).toEqual(['Aria you', 'Bryn']);
  });

  it('starts a new fight from the toolbar', () => {
    const controls = props({ offline: offline(meterReport()) });
    render(<DpsOverlay {...controls} />);
    fireEvent.click(screen.getByRole('button', { name: 'New fight' }));
    expect(controls.onReset).toHaveBeenCalledOnce();
  });

  it('copies exactly the shown rows with names hidden when asked', async () => {
    const onCopyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const settings = { ...SETTINGS_FALLBACK, hide_names: true };
    render(
      <DpsOverlay
        {...props({
          offline: offline(meterReport({ players: [aria, bryn] }), settings),
          onCopyText,
        })}
      />,
    );
    expect(rows().map((r) => cells(r)[0])).toEqual(['You', 'Cleric 2']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    });
    const text = onCopyText.mock.lastCall?.[0] ?? '';
    expect(text).toMatch(/^Damage dealt · Training Golem · 0:10/);
    expect(text).toContain('1. You 74.6K');
    expect(text).not.toMatch(/Aria|Bryn/);
    // The copy button confirms itself; the footer stays Odyle's.
    const button = screen.getByRole('button', { name: 'Copy summary' });
    expect(button.dataset.state).toBe('copied');
    expect(button.title).toBe('Summary copied to clipboard.');
    expect(screen.getByRole('status', { name: 'Overlay status' }).textContent).toBe('');
  });
});

describe('meter footer', () => {
  const odyle = () =>
    screen.getByTitle('Odyle energy · latest balance (+ bonus) reported by the game');
  /** The live status with the Odyle energy the game last reported. */
  const reported = (base: number, bonus: number): LiveStatus => ({
    ...status,
    odyle: { base, bonus, observed_ms: Date.UTC(2026, 9, 21, 12, 0) },
  });

  it('shows the captured Odyle balance followed by its bonus', () => {
    render(
      <DpsOverlay {...props({ status: reported(15, 275), offline: offline(meterReport()) })} />,
    );
    expect(odyle().textContent).toBe('15(+275)');
    expect(within(odyle()).getByRole('img', { name: 'Odyle' }).getAttribute('src')).toBe(
      `/resource-art/${resourceArt.odyle.file}`,
    );
  });

  it('tells a spent balance (zero) apart from an unknown one (dashes)', () => {
    const view = render(
      <DpsOverlay {...props({ status: reported(15, 275), offline: offline(meterReport()) })} />,
    );
    view.rerender(
      <DpsOverlay {...props({ status: reported(0, 0), offline: offline(meterReport()) })} />,
    );
    expect(odyle().textContent).toBe('0(+0)');
    view.rerender(
      <DpsOverlay
        {...props({ status: { ...status, odyle: null }, offline: offline(meterReport()) })}
      />,
    );
    expect(odyle().textContent).toBe('—(+—)');
    // A status from a build that does not send Odyle energy is unknown too.
    view.rerender(<DpsOverlay {...props({ offline: offline(meterReport()) })} />);
    expect(odyle().textContent).toBe('—(+—)');
  });

  it('says nothing about an ended encounter or when it ended', () => {
    render(
      <DpsOverlay
        {...props({
          status: { ...reported(15, 275), encounter_ended: true },
          offline: offline(meterReport({ end_reason: 'idle' })),
        })}
      />,
    );
    expect(screen.queryByText(/Encounter ended|Ended · since|^Live · since/)).toBeNull();
    expect(screen.getByRole('status', { name: 'Overlay status' }).textContent).toBe('');
    expect(odyle().textContent).toBe('15(+275)');
    // The fight's result and duration stay.
    expect(screen.getByText('Training Golem')).toBeTruthy();
    expect(screen.getByText('0:10')).toBeTruthy();
  });
});

describe('meter targets', () => {
  const trash = (id: number, name: string, damage: number) => ({
    id,
    name,
    boss: false,
    dummy: false,
    damage,
  });

  it('offers no target filter of its own: the scope is a setting', () => {
    const settings = { ...SETTINGS_FALLBACK, target_mode: 'all' as const };
    render(<DpsOverlay {...props({ offline: offline(meterReport(), settings) })} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'All targets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Boss' })).toBeNull();
  });

  it('names every target hit in the All scope, and only the bosses met in Bosses', () => {
    const report = meterReport({
      targets: [
        trash(51, 'Elyos Scout', 90_000),
        { id: 60, name: 'Tahabata', boss: true, dummy: false, damage: 70_000 },
        { id: 61, name: 'Ice Golem', boss: true, dummy: false, damage: 4_600 },
        trash(62, 'Asmodian Ranger', 0),
      ],
    });
    const scoped = (target_mode: 'all' | 'boss') =>
      props({ offline: offline(report, { ...SETTINGS_FALLBACK, target_mode }) });
    const view = render(<DpsOverlay {...scoped('all')} />);
    // Trash damage counts, so the caption never claims a boss.
    expect(screen.queryByText('Tahabata +1')).toBeNull();
    const all = screen.getByText('All targets');
    expect(all.getAttribute('title')).toBe('Elyos Scout, Tahabata, Ice Golem');

    view.rerender(<DpsOverlay {...scoped('boss')} />);
    expect(screen.queryByText('All targets')).toBeNull();
    expect(screen.getByText('Tahabata +1').getAttribute('title')).toBe('Tahabata, Ice Golem');
  });

  it('reads the Bosses scope as every target when no boss or dummy was met', () => {
    const report = meterReport({
      targets: [trash(51, 'Elyos Scout', 40_000), trash(52, 'Elyos Archer', 34_600)],
    });
    const settings = { ...SETTINGS_FALLBACK, target_mode: 'boss' as const };
    render(<DpsOverlay {...props({ offline: offline(report, settings) })} />);
    expect(screen.getByText('All targets')).toBeTruthy();
    expect(rows().map(cells)).toEqual([['Aria you', '74.6K', '7.5K', '100.0%']]);
    expect(screen.queryByText('No boss damage yet')).toBeNull();
  });

  it('says a met boss has no damage yet instead of waiting for combat', () => {
    const report = meterReport({
      players: [],
      targets: [{ id: 60, name: 'Tahabata', boss: true, dummy: false, damage: 0 }],
    });
    render(<DpsOverlay {...props({ offline: offline(report) })} />);
    // The boss bar names the boss met; the headline does not repeat it.
    const block = screen.getByLabelText('Boss status');
    expect(within(block).getByText('Tahabata')).toBeTruthy();
    expect(screen.getAllByText('Tahabata')).toHaveLength(1);
    expect(screen.getByText('No boss damage yet')).toBeTruthy();
    expect(screen.queryByText('Hit a target to see live damage.')).toBeNull();
    expect(screen.queryByText('Damage', { selector: 'dt' })).toBeNull();
  });

  it('waits for the native report rather than show unfiltered live totals', () => {
    const live: LiveStatus = {
      ...status,
      players: [
        {
          entity: 7,
          label: 'Aria',
          name: 'Aria',
          class: 'Chanter',
          is_local: true,
          damage: 900,
          dps: 90,
          current_dps: 10,
          share: 1,
          direct_hits: 3,
          critical_hits: 1,
          ticks: 0,
          skills: { 'Spinning Strike': 900 },
        },
      ],
    };
    const onCopyText = vi.fn<(text: string) => Promise<void>>();
    render(<DpsOverlay {...props({ status: live, offline: offline(null), onCopyText })} />);
    expect(screen.queryByText('Aria')).toBeNull();
    expect(screen.getByText('Waiting for combat…')).toBeTruthy();
    // Nothing to copy until native has counted the right targets.
    const copy = screen.getByRole<HTMLButtonElement>('button', { name: 'Copy summary' });
    expect(copy.disabled).toBe(true);
  });
});

describe('meter history', () => {
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
  const old = meterReport({
    id: 'fight-old',
    duration_ms: 65_000,
    end_reason: 'idle',
    players: [aria, bryn],
  });

  function library() {
    return {
      list: vi.fn<MeterLibrary['list']>().mockResolvedValue([saved]),
      read: vi.fn<MeterLibrary['read']>().mockResolvedValue(old),
    };
  }

  it("keeps the character's current Odyle energy while a saved fight is pinned", async () => {
    const odyle = { base: 15, bonus: 275, observed_ms: Date.UTC(2026, 9, 21, 12, 0) };
    render(
      <DpsOverlay
        {...props({
          status: { ...status, odyle },
          offline: offline(meterReport()),
          library: library(),
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const item = await screen.findByRole('menuitemradio', { name: /Golem run/ });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(screen.getByText(/^Saved · /)).toBeTruthy();
    // Energy is the character's balance now, not part of the saved fight.
    expect(
      screen.getByTitle('Odyle energy · latest balance (+ bonus) reported by the game').textContent,
    ).toBe('15(+275)');
  });

  it('pins a saved fight from the live ranking and returns to it', async () => {
    const lib = library();
    const onInspect = vi.fn<(reportId: string, player: string) => void>();
    const controls = props({ offline: offline(meterReport()), library: lib, onInspect });
    const view = render(<DpsOverlay {...controls} />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const item = await screen.findByRole('menuitemradio', { name: /Golem run/ });
    // The saved index DPS counts every target, so the list shows only time and duration.
    expect(item.textContent).toContain('1:05');
    expect(item.textContent).not.toContain('/s');
    expect(
      screen.getByRole('menuitemradio', { name: /Current fight/ }).getAttribute('aria-checked'),
    ).toBe('true');
    await act(async () => {
      fireEvent.click(item);
    });
    // The default scope reads the saved fight against every target.
    expect(lib.read).toHaveBeenLastCalledWith('fight-old', false);
    expect(screen.queryByRole('menu')).toBeNull();
    // The saved fight drives everything: its ranking, duration and saved DPS.
    expect(rows()).toHaveLength(2);
    expect(screen.getByText(/^Saved · /)).toBeTruthy();
    expect(screen.getByTitle('Saved fight duration').textContent).toBe('1:05');
    expect(screen.queryByText(/Current DPS|Avg DPS/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New fight' }).disabled).toBe(
      true,
    );
    // Details stay on the pinned fight, never the live one.
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Bryn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Full details' }));
    expect(onInspect).toHaveBeenLastCalledWith('fight-old', '2');

    // Choosing the Bosses scope reads the pinned fight again in it; it stays pinned.
    await act(async () => {
      view.rerender(
        <DpsOverlay
          {...controls}
          offline={offline(meterReport(), { ...SETTINGS_FALLBACK, target_mode: 'boss' })}
        />,
      );
    });
    expect(lib.read).toHaveBeenCalledTimes(2);
    expect(lib.read).toHaveBeenLastCalledWith('fight-old', true);
    expect(screen.getByText(/^Saved · /)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
    expect(screen.queryByText(/^Saved · /)).toBeNull();
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
    expect(rows()).toHaveLength(1);
  });

  it('keeps a picked boss fight readable, while a picked trash fight still fades', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const lib = library();
      const boss = [{ id: 60, name: 'Tahabata', boss: true, dummy: false, damage: 100_000 }];
      lib.read.mockResolvedValue(meterReport({ ...old, end_reason: 'kill', targets: boss }));
      const view = render(
        <DpsOverlay {...props({ offline: offline(meterReport()), library: lib })} />,
      );
      const meter = () => screen.getByLabelText('Live DPS overlay');
      const pick = async () => {
        fireEvent.click(screen.getByRole('button', { name: 'History' }));
        const item = await screen.findByRole('menuitemradio', { name: /Golem run/ });
        await act(async () => {
          fireEvent.click(item);
        });
      };
      await pick();
      expect(screen.getByText(/^Saved · /)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      expect(meter().dataset.state).toBeUndefined();

      fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
      lib.read.mockResolvedValue(old);
      view.rerender(
        <DpsOverlay
          {...props({ offline: offline(meterReport()), library: lib, status: { ...status } })}
        />,
      );
      await pick();
      act(() => {
        vi.advanceTimersByTime(31_000);
      });
      expect(meter().dataset.state).toBe('faded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never shows another fight than the one picked', async () => {
    const lib = library();
    lib.read.mockResolvedValue(meterReport({ id: 'fight-other' }));
    render(<DpsOverlay {...props({ offline: offline(meterReport()), library: lib })} />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const item = await screen.findByRole('menuitemradio', { name: /Golem run/ });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(screen.getByText('Native returned another fight')).toBeTruthy();
    expect(screen.getByText('Saved fight unavailable')).toBeTruthy();
  });
});

describe('meter dragging', () => {
  const unlocked = { ...overlay, locked: false };
  const pointer = { button: 0, buttons: 1, isPrimary: true, pointerId: 1 };
  const press = (element: Element) =>
    fireEvent.pointerDown(element, { ...pointer, clientX: 100, clientY: 100 });
  const travel = (dx: number, dy = 0) =>
    fireEvent.pointerMove(window, { ...pointer, clientX: 100 + dx, clientY: 100 + dy });
  const release = () => fireEvent.pointerUp(window, pointer);
  const meter = () => screen.getByRole('region', { name: 'Live DPS overlay' });

  it('moves an unlocked meter from the summary, caption, rows and empty space', () => {
    const onDrag = vi.fn<() => void>();
    render(
      <DpsOverlay {...props({ overlay: unlocked, offline: offline(meterReport()), onDrag })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    const starts = [
      screen.getByText('Avg DPS'),
      screen.getByText('Damage', { selector: 'dt' }),
      screen.getByText('Damage dealt'),
      screen.getByText('Spinning Strike'),
      meter(),
    ];
    for (const [index, start] of starts.entries()) {
      press(start);
      travel(2, 2);
      // Below the threshold a press is still a click.
      expect(onDrag).toHaveBeenCalledTimes(index);
      travel(6);
      travel(20);
      // One move per press.
      expect(onDrag).toHaveBeenCalledTimes(index + 1);
      release();
    }
  });

  it('keeps a still press on a row a click and swallows the click that ends a move', () => {
    const onDrag = vi.fn<() => void>();
    const onInspect = vi.fn<(reportId: string, player: string) => void>();
    render(
      <DpsOverlay
        {...props({
          overlay: unlocked,
          offline: offline(meterReport({ players: [aria, bryn] })),
          onDrag,
          onInspect,
        })}
      />,
    );
    const row = tab('Skills of Bryn');
    press(row);
    travel(10);
    release();
    fireEvent.click(row, { detail: 1 });
    expect(onDrag).toHaveBeenCalledOnce();
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();

    // A press that barely moves opens the row.
    press(row);
    travel(3);
    release();
    fireEvent.click(row, { detail: 1 });
    expect(onDrag).toHaveBeenCalledOnce();
    expect(pressed('Bryn')).toBe('true');

    // Dragging from a skill row never opens its details.
    const smite = tab('Smite: full damage details');
    press(smite);
    travel(0, -12);
    fireEvent.click(smite, { detail: 1 });
    expect(onDrag).toHaveBeenCalledTimes(2);
    expect(onInspect).not.toHaveBeenCalled();
    // Keyboard activation is never mistaken for the end of a move.
    fireEvent.click(smite, { detail: 0 });
    expect(onInspect).toHaveBeenCalledOnce();
  });

  it('never moves from controls, menus or a released press', () => {
    const onDrag = vi.fn<() => void>();
    const library: MeterLibrary = {
      list: vi.fn<MeterLibrary['list']>().mockResolvedValue([]),
      read: vi.fn<MeterLibrary['read']>(),
    };
    render(
      <DpsOverlay
        {...props({
          overlay: unlocked,
          offline: offline(meterReport()),
          onDrag,
          library,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    for (const name of [
      'My DPS',
      'History',
      'Hide DPS meter',
      'Quit Aion Companion',
      'New fight',
    ]) {
      press(tab(name));
      travel(30);
      release();
    }
    expect(onDrag).not.toHaveBeenCalled();
    fireEvent.click(tab('History'), { detail: 1 });
    press(screen.getByRole('menu', { name: 'Fight history' }));
    travel(30);
    release();
    expect(onDrag).not.toHaveBeenCalled();

    // Released before the threshold: later movement is not a drag.
    press(screen.getByText('Avg DPS'));
    release();
    travel(30);
    // Neither is a right press, nor a move after the button came up unseen.
    fireEvent.pointerDown(meter(), {
      ...pointer,
      button: 2,
      buttons: 2,
      clientX: 100,
      clientY: 100,
    });
    travel(30);
    press(meter());
    fireEvent.pointerMove(window, { ...pointer, buttons: 0, clientX: 130, clientY: 100 });
    travel(40);
    expect(onDrag).not.toHaveBeenCalled();
  });

  it('keeps a locked meter in place while its rows stay clickable', () => {
    const onDrag = vi.fn<() => void>();
    render(
      <DpsOverlay
        {...props({ offline: offline(meterReport({ players: [aria, bryn] })), onDrag })}
      />,
    );
    for (const start of [screen.getByText('Training Golem'), meter(), tab('Skills of Bryn')]) {
      press(start);
      travel(30);
      release();
    }
    expect(onDrag).not.toHaveBeenCalled();
    fireEvent.click(tab('Skills of Bryn'), { detail: 1 });
    expect(pressed('Bryn')).toBe('true');
  });

  it('moves the unlocked strip from any figure but not from its button', () => {
    const onDrag = vi.fn<() => void>();
    const strip = { ...SETTINGS_FALLBACK, compact_strip: true };
    const view = render(
      <DpsOverlay
        {...props({
          overlay: unlocked,
          offline: offline(meterReport(), strip),
          onDrag,
          onExitStrip: vi.fn<() => void>(),
        })}
      />,
    );
    press(tab('Show full meter'));
    travel(30);
    release();
    expect(onDrag).not.toHaveBeenCalled();
    press(screen.getByTitle('Total DPS'));
    travel(30);
    press(meter());
    travel(30);
    expect(onDrag).toHaveBeenCalledTimes(2);
    view.rerender(<DpsOverlay {...props({ offline: offline(meterReport(), strip), onDrag })} />);
    press(meter());
    travel(30);
    expect(onDrag).toHaveBeenCalledTimes(2);
  });
});
