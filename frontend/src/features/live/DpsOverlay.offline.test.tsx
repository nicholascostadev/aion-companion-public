import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classArt, skillArt } from '../../lib/gameArt';
import { normalizeLiveStatus, SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LiveStatus, OverlayStatus } from '../../types/companion';
import type { PolledOfflineStatus } from '../../types/offline';
import { bossProjection } from '../offline/analysis';
import { nativeReport, report, reportSummary } from '../offline/fixtures';
import { DpsOverlay } from './DpsOverlay';

afterEach(cleanup);
const live: LiveStatus = {
  running: true,
  phase: 'capturing',
  message: 'Collecting damage',
  duration_ms: 30_000,
  events: 9,
  stats: {},
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
const alive = report({
  end_reason: null,
  targets: [
    {
      id: 50,
      name: 'Test Boss',
      boss: true,
      max_hp: 10000,
      current_hp: 5000,
      damage: 5000,
      berserk_seconds: 120,
    },
  ],
});
const offline = (patch: Partial<PolledOfflineStatus> = {}): PolledOfflineStatus => ({
  settings: SETTINGS_FALLBACK,
  report: alive,
  library_count: 0,
  trackers: [],
  alerts: [],
  catalogue: null,
  capabilities: {},
  error: null,
  ...patch,
});
function props(extra: Partial<Parameters<typeof DpsOverlay>[0]> = {}) {
  return {
    status: live,
    overlay,
    error: '',
    busy: false,
    onReset: vi.fn<() => void>(),
    onHide: vi.fn<() => void>(),
    onQuit: vi.fn<() => void>(),
    ...extra,
  };
}

/** Aria as a Chanter whose top skill is a catalogued variant of Spinning Strike. */
function chanterReport() {
  const [aria, bryn] = nativeReport.players;
  const [top, ...rest] = aria!.skills;
  return report({
    end_reason: null,
    players: [
      {
        ...aria!,
        class: 'Chanter',
        skills: [{ ...top!, id: 18290007, name: 'Spinning Strike' }, ...rest],
      },
      bryn!,
    ],
  });
}
const artOf = (text: string) =>
  screen.getByText(text).closest('.meter-name')?.querySelector('img')?.getAttribute('src') ?? null;

describe('DPS meter artwork', () => {
  it('shows class emblems in the ranking and skill icons by exact native id', () => {
    render(<DpsOverlay {...props({ offline: offline({ report: chanterReport() }) })} />);
    expect(artOf('Aria')).toBe(classArt('Chanter')!.src);
    expect(artOf('Bryn')).toBe(classArt('Cleric')!.src);
    fireEvent.click(screen.getByRole('button', { name: 'Skills of Aria' }));
    const skills = screen.getByRole('list', { name: 'Skills of Aria' });
    expect(skills.querySelectorAll('img')).toHaveLength(1);
    // The variant id resolves through its explicit base; Volley has no verified artwork.
    expect(artOf('Spinning Strike')).toBe(skillArt(18290000)!.src);
    expect(artOf('Volley')).toBeNull();
    // Pressing an icon still reaches the row, so whole-panel dragging keeps working.
    const img = skills.querySelector('img')!;
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.closest('.meter-row')).toBeTruthy();
  });

  it('keeps your own class private when names are hidden', () => {
    const settings = { ...SETTINGS_FALLBACK, hide_names: true };
    render(<DpsOverlay {...props({ offline: offline({ settings, report: chanterReport() }) })} />);
    expect(artOf('You')).toBeNull();
    expect(artOf('Cleric 2')).toBe(classArt('Cleric')!.src);
  });
});

/** The boss status block and its labelled figures. */
function bossBlock() {
  const block = screen.getByRole('region', { name: 'Boss status' });
  const figure = (label: RegExp) =>
    within(block).getByText(label, { selector: 'span' }).closest('span')!;
  return { block, kill: figure(/^Kill$/), rage: () => figure(/^Rage$/) };
}
const withBoss = (target: Record<string, unknown>, patch: Record<string, unknown> = {}) =>
  report({
    end_reason: null,
    targets: [{ id: 50, name: 'Test Boss', boss: true, damage: 5000, ...target }],
    ...patch,
  });

describe('DPS meter boss status', () => {
  it('shows a labelled HP bar, kill time and a live rage countdown', () => {
    render(<DpsOverlay {...props({ offline: offline() })} />);
    const { block, kill, rage } = bossBlock();
    expect(block.dataset.rage).toBe('countdown');
    expect(within(block).getByText('Boss')).toBeTruthy();
    expect(within(block).getByText('Test Boss')).toBeTruthy();
    expect(within(block).getByText('50.0%')).toBeTruthy();
    expect(within(block).queryByText(/HP 5K/)).toBeNull();
    expect(kill.textContent).toBe('Kill 10s');
    // 120 s of rage, 30 s into the fight; the kill estimate beats it.
    expect(rage().textContent).toBe('Rage 1:30');
    expect(rage().dataset.tone).toBe('good');
    expect(rage().title).toBe('Time left before the boss enrages');
    // The live report drives the ranking: two players dealt damage.
    expect(screen.getByRole('list', { name: 'Players by damage' })).toBeTruthy();
    expect(screen.getByText('Aria').title).toBe('Aria · Ranger · you');
  });

  it('keeps unseen HP unknown instead of reading it as zero', () => {
    const pending = withBoss({ max_hp: null, current_hp: null, berserk_seconds: 120 }, { hp: [] });
    render(<DpsOverlay {...props({ offline: offline({ report: pending }) })} />);
    const { block, kill, rage } = bossBlock();
    // Both the HP percentage and the kill estimate stay unknown.
    expect(within(block).getAllByText('—', { selector: 'b' })).toHaveLength(2);
    expect(within(block).queryByText('Defeated')).toBeNull();
    expect(block.querySelector('[data-state="unknown"]')).toBeTruthy();
    expect(kill.textContent).toBe('Kill —');
    // Rage still counts from the fight's start without any HP.
    expect(rage().textContent).toBe('Rage 1:30');
  });

  it('keeps rage visible as a dash when no timer is known', () => {
    const unknown = withBoss({ max_hp: 10000, current_hp: 5000, berserk_seconds: null });
    render(<DpsOverlay {...props({ offline: offline({ report: unknown }) })} />);
    const { block, rage } = bossBlock();
    expect(block.dataset.rage).toBe('unknown');
    expect(rage().textContent).toBe('Rage —');
    expect(rage().title).toBe('No rage timer is known for this boss');
    expect(rage().dataset.tone).toBeUndefined();
  });

  it('marks the boss enraged once the timer runs out', () => {
    const late = withBoss(
      { max_hp: 10000, current_hp: 5000, berserk_seconds: 20 },
      { duration_ms: 30_000 },
    );
    render(<DpsOverlay {...props({ offline: offline({ report: late }) })} />);
    const { block, rage } = bossBlock();
    expect(block.dataset.rage).toBe('enraged');
    expect(rage().textContent).toBe('Rage Enraged');
    expect(rage().dataset.tone).toBe('bad');
  });

  it('stops the rage countdown once the boss is defeated', () => {
    const killed = withBoss(
      { max_hp: 10000, current_hp: 0, dead: true, damage: 10000, berserk_seconds: 120 },
      { end_reason: 'kill' },
    );
    render(<DpsOverlay {...props({ offline: offline({ report: killed }) })} />);
    const { block, kill, rage } = bossBlock();
    expect(block.dataset.rage).toBe('stopped');
    expect(within(block).getByText('Defeated')).toBeTruthy();
    expect(kill.textContent).toBe('Kill done');
    expect(rage().textContent).toBe('Rage stopped');
    expect(rage().title).toBe('Boss defeated: its rage timer no longer runs');
    expect(within(block).queryByText(/1:30/)).toBeNull();
  });

  it('freezes rage and drops the kill estimate when a fight ends with the boss alive', () => {
    const wiped = withBoss(
      { max_hp: 10000, current_hp: 5000, berserk_seconds: 120 },
      { end_reason: 'idle' },
    );
    render(<DpsOverlay {...props({ offline: offline({ report: wiped }) })} />);
    const { kill, rage } = bossBlock();
    expect(kill.textContent).toBe('Kill —');
    expect(rage().textContent).toBe('Rage 1:30');
    expect(rage().title).toBe('Time that was left before rage when the fight ended');
    expect(rage().dataset.tone).toBeUndefined();
  });

  it('shows no rage for a training dummy, only its own timer', () => {
    const dummy = report({
      end_reason: null,
      targets: [
        { id: 50, name: 'Dummy', boss: false, dummy: true, max_hp: 10000, current_hp: 9000 },
      ],
    });
    const settings = { ...SETTINGS_FALLBACK, dummy_length_seconds: 180 };
    render(<DpsOverlay {...props({ offline: offline({ settings, report: dummy }) })} />);
    const { block } = bossBlock();
    expect(block.dataset.rage).toBe('none');
    expect(within(block).queryByText(/^Rage$/)).toBeNull();
    expect(within(block).getByText(/^Time$/).textContent).toBe('Time 2:30');
  });

  it('truncates the boss name so kill and rage stay whole in a narrow meter', () => {
    render(<DpsOverlay {...props({ offline: offline() })} />);
    const { block, kill, rage } = bossBlock();
    expect(within(block).getByText('Test Boss').className).toMatch(/\btruncate\b/);
    expect(kill.className).toMatch(/\bshrink-0\b/);
    expect(rage().className).toMatch(/\bshrink-0\b/);
    // Each label keeps a clear gap to its own value, more than a bare space.
    expect(kill.className).toMatch(/\binline-flex\b.*\bgap-1\.25\b/);
    expect(rage().className).toMatch(/\binline-flex\b.*\bgap-1\.25\b/);
  });

  it('shows no boss status before a report exists', () => {
    render(<DpsOverlay {...props({ offline: offline({ report: null }) })} />);
    expect(screen.queryByRole('region', { name: 'Boss status' })).toBeNull();
  });

  it('shows boss HP and rage in the compact strip', () => {
    const settings = { ...SETTINGS_FALLBACK, compact_strip: true };
    const view = render(<DpsOverlay {...props({ offline: offline({ settings }) })} />);
    const strip = screen.getByRole('region', { name: 'Live DPS overlay' });
    expect(within(strip).getByText('50%')).toBeTruthy();
    const rage = within(strip).getByText('1:30');
    expect(rage.dataset.tone).toBe('good');
    expect(rage.parentElement?.textContent).toBe('Rage 1:30');
    expect(rage.parentElement?.className).toMatch(/\binline-flex\b.*\bgap-1\b/);
    const unknown = withBoss({ max_hp: 10000, current_hp: 5000, berserk_seconds: null });
    view.rerender(<DpsOverlay {...props({ offline: offline({ settings, report: unknown }) })} />);
    expect(within(strip).getByText('—').parentElement?.textContent).toBe('Rage —');
    const killed = withBoss(
      { max_hp: 10000, current_hp: 0, dead: true, berserk_seconds: 120 },
      { end_reason: 'kill' },
    );
    view.rerender(<DpsOverlay {...props({ offline: offline({ settings, report: killed }) })} />);
    expect(within(strip).getByText('Dead')).toBeTruthy();
    expect(within(strip).getByText('stopped')).toBeTruthy();
  });
});

describe('DPS meter with offline analysis', () => {
  it('draws the same meter from the compact live summary', () => {
    const summary = reportSummary({
      end_reason: null,
      targets: [
        {
          id: 50,
          name: 'Test Boss',
          boss: true,
          max_hp: 10000,
          current_hp: 5000,
          damage: 5000,
          berserk_seconds: 120,
        },
      ],
    });
    render(<DpsOverlay {...props({ offline: offline({ report: summary }) })} />);
    expect(screen.getByText('50.0%')).toBeTruthy();
    expect(screen.getByText('Aria').title).toBe('Aria · Ranger · you');
    // Without HP samples the kill time is estimated, and labelled, from recorded damage.
    expect(screen.getByTitle('Kill time from recorded damage')).toBeTruthy();
  });

  it('projects the HP-slope kill time from the summary’s two HP endpoints', () => {
    // Recorded damage alone would give 200/s and a 25 s kill; the HP drop gives 30 s.
    const boss = { id: 50, name: 'Test Boss', boss: true, max_hp: 10000, current_hp: 5000 };
    const targets = [{ ...boss, damage: 6000, berserk_seconds: 120 }];
    const history = [
      { entity: 50, at_ms: 0, current: 10000, max: 10000 },
      { entity: 50, at_ms: 5000, current: 9500, max: null },
      { entity: 50, at_ms: 10000, current: 8000, max: null },
      { entity: 50, at_ms: 20000, current: 6500, max: null },
      { entity: 50, at_ms: 28000, current: 5000, max: null },
    ];
    const full = bossProjection(report({ end_reason: null, targets, hp: history }))!;
    // Native keeps the first and last samples of the 20 s ending at the latest one.
    const wire = {
      ...nativeReport,
      detail_level: 'summary',
      end_reason: null,
      targets,
      events: [],
      buffs: [],
      hp: [history[2], history[4]],
    };
    const summary = normalizeLiveStatus({ settings: SETTINGS_FALLBACK, report: wire }).report!;
    const compact = bossProjection(summary)!;
    expect(compact.dpsSource).toBe('hp');
    expect(compact.ttkMs).toBe(30_000);
    expect(compact).toEqual(full);

    render(<DpsOverlay {...props({ offline: offline({ report: summary }) })} />);
    expect(screen.getByTitle('Kill time from the HP drop over the last 20 seconds')).toBeTruthy();
  });

  it('moves the boss HP bar with current-only HP updates', () => {
    const updating = report({
      end_reason: null,
      targets: [
        { id: 50, name: 'Test Boss', boss: true, max_hp: 1000, current_hp: 600, damage: 400 },
      ],
      hp: [
        { entity: 50, at_ms: 0, current: 1000, max: 1000 },
        { entity: 50, at_ms: 2000, current: 800, max: null },
        { entity: 50, at_ms: 4000, current: 600, max: null },
      ],
    });
    render(<DpsOverlay {...props({ offline: offline({ report: updating }) })} />);
    expect(screen.getByText('60.0%')).toBeTruthy();
  });

  it('uses active DPS for a player when that mode is selected', () => {
    render(
      <DpsOverlay
        {...props({
          offline: offline({ settings: { ...SETTINGS_FALLBACK, dps_mode: 'active' } }),
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'My DPS' }));
    expect(screen.getByText('Active DPS', { selector: 'dt' }).nextElementSibling?.textContent).toBe(
      '450/s',
    );
  });

  it('renders the compact strip and applies opacity and scale', () => {
    const exit = vi.fn<() => void>();
    const view = render(
      <DpsOverlay
        {...props({
          overlay: { ...overlay, locked: false },
          offline: offline({
            settings: { ...SETTINGS_FALLBACK, compact_strip: true, opacity: 0.6, scale: 1.25 },
          }),
          onExitStrip: exit,
        })}
      />,
    );
    const strip = screen.getByRole('region', { name: 'Live DPS overlay' });
    expect(strip.dataset.variant).toBe('strip');
    expect(strip.style.opacity).toBe('0.6');
    expect(strip.style.zoom).toBe('1.25');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show full meter' }));
    expect(exit).toHaveBeenCalledOnce();
    view.rerender(
      <DpsOverlay
        {...props({
          offline: offline({ settings: { ...SETTINGS_FALLBACK, compact_strip: true } }),
        })}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows tracker chips only when the in-game tracker surface is not in use', () => {
    const tracker = {
      bar_id: 'b',
      skill: 1,
      name: 'Burst',
      remaining_ms: 4000,
      kind: 'cooldown' as const,
      source: 1,
      target: null,
      estimated: true,
      basis: null,
    };
    const view = render(<DpsOverlay {...props({ offline: offline({ trackers: [tracker] }) })} />);
    expect(screen.getByText('~4.0s')).toBeTruthy();
    view.rerender(
      <DpsOverlay
        {...props({
          overlay: { ...overlay, trackers_requested: true },
          offline: offline({ trackers: [tracker] }),
        })}
      />,
    );
    expect(screen.queryByText('~4.0s')).toBeNull();
  });

  it('uses the configured hotkeys in its hints', () => {
    render(
      <DpsOverlay
        {...props({
          overlay: { ...overlay, locked: false },
          offline: offline({
            settings: {
              ...SETTINGS_FALLBACK,
              hotkeys: { ...SETTINGS_FALLBACK.hotkeys, toggle_overlay: 'Alt+H', reset: 'Alt+R' },
            },
          }),
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Hide DPS meter' }).title).toBe(
      'Hide DPS meter · Alt+H shows it again',
    );
    expect(screen.getByRole('button', { name: 'New fight' }).title).toBe('New fight · Alt+R');
  });
});
