import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { getI18n, setI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import type { AlertConfig, AlertDashboard } from '../../types/alerts';
import { AlertsPanel, type AlertsController } from './AlertsPanel';
import { NOW, catalogue, dashboard, delivery, rule, serverRow, serverStatus } from './fixtures';

let state: AlertDashboard;
let controller: AlertsController;
/** Applies every configure delta to the fixture so assertions see the saved config. */
let saved: AlertConfig[];

function makeController(patch: Partial<AlertsController> = {}): AlertsController {
  return {
    native: true,
    dashboard: state,
    error: '',
    busy: false,
    offsetMs: 0,
    configure: vi.fn<AlertsController['configure']>((change) => {
      saved.push(change(state.config));
      return Promise.resolve(true);
    }),
    action: vi.fn<AlertsController['action']>(() => Promise.resolve(true)),
    test: vi.fn<AlertsController['test']>(() => Promise.resolve(true)),
    now: () => Date.now(),
    ...patch,
  };
}

const renderPanel = (patch: Partial<AlertsController> = {}) => {
  controller = makeController(patch);
  return render(<AlertsPanel alerts={controller} active />);
};
const last = () => saved[saved.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  vi.setSystemTime(NOW);
  state = dashboard();
  saved = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AlertsPanel', () => {
  it('counts down upcoming alerts on the native clock', () => {
    renderPanel();
    const upcoming = screen.getByRole('list', { name: 'Upcoming alerts' });
    expect(within(upcoming).getByText('Shugo Festival')).toBeTruthy();
    expect(within(upcoming).getByLabelText('Time left').textContent).toBe('1:30');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(within(upcoming).getByLabelText('Time left').textContent).toBe('1:28');
  });

  it('turns the engine on and off and enables single rules as deltas', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }));
    expect(last().enabled).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Field boss watch' }));
    expect(last().rules.map((r) => [r.id, r.enabled])).toEqual([
      ['r1', true],
      ['r2', true],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Watchlist Shugo Festival' }));
    expect(last().rules[0]?.favorite).toBe(true);
  });

  it('validates a new alert before saving it', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New alert' }));
    const form = screen.getByRole('form', { name: 'New alert' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add alert' }));
    expect(within(form).getByText('Give the alert a name.')).toBeTruthy();
    expect(within(form).getByText('Add at least one time.')).toBeTruthy();
    expect(controller.configure).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Raid night' } });
    fireEvent.change(within(form).getByLabelText('Times (24-hour)'), {
      target: { value: '20:00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add time' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Fri' }));
    fireEvent.click(within(form).getByRole('button', { name: /^\+?\s*15m$/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Remove reminder 5 min before' }));
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Add alert' }));
    });
    const added = last().rules.find((r) => r.name === 'Raid night');
    expect(added?.schedule).toEqual({ type: 'calendar', times: ['20:00'], weekdays: [4] });
    expect([...(added?.lead_seconds ?? [])].sort((a, b) => a - b)).toEqual([0, 900]);
    expect(last().rules).toHaveLength(3);
    expect(screen.queryByRole('form', { name: 'New alert' })).toBeNull();
  });

  it('edits, duplicates and deletes rules', async () => {
    renderPanel();
    const rules = screen.getByRole('list', { name: 'Alert rules' });
    fireEvent.click(within(rules).getByRole('button', { name: 'Edit Shugo Festival' }));
    const form = screen.getByRole('form', { name: 'Edit Shugo Festival' });
    fireEvent.change(within(form).getByLabelText('Sound'), { target: { value: 'alarm' } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Save alert' }));
    });
    expect(last().rules.find((r) => r.id === 'r1')?.sound).toBe('alarm');

    fireEvent.click(within(rules).getByRole('button', { name: 'Duplicate Shugo Festival' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Shugo Festival (copy)');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(rules).getByRole('button', { name: 'Delete Field boss watch' }));
    fireEvent.click(within(rules).getByRole('button', { name: 'Delete?' }));
    expect(last().rules.map((r) => r.id)).toEqual(['r1']);
  });

  it('previews, skips, snoozes, dismisses, mutes and clears history', () => {
    state = dashboard({
      active: [delivery()],
      history: [delivery({ id: 'old', status: 'dismissed', fired_ms: NOW - 60_000 })],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Test Shugo Festival' }));
    expect(controller.test).toHaveBeenCalledWith('chime', 0.8, true);
    fireEvent.click(screen.getByRole('button', { name: 'Skip next Shugo Festival' }));
    expect(controller.action).toHaveBeenCalledWith('skip', 'r1');
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 5 min' }));
    expect(controller.action).toHaveBeenCalledWith('snooze', 'r1:1', 300);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(controller.action).toHaveBeenCalledWith('dismiss', 'r1:1');
    fireEvent.change(screen.getByLabelText('Mute alerts for'), { target: { value: '3600' } });
    expect(controller.action).toHaveBeenCalledWith('mute', null, 3600);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(controller.action).toHaveBeenCalledWith('clear_history');
  });

  it('offers a silent test toast only in confirmed development builds', async () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Test toast' })).toBeNull();
    cleanup();

    controller = makeController();
    render(<AlertsPanel alerts={controller} active development />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test toast' }));
      await Promise.resolve();
    });
    expect(controller.test).toHaveBeenCalledWith('none', 0, true);
    expect(saved).toEqual([]);
    expect(screen.getByText(/Test toast sent\. It shows for 10 seconds/)).toBeTruthy();
  });

  it('keeps the test toast disabled while busy and quiet when it fails', async () => {
    controller = makeController({ busy: true });
    const { rerender } = render(<AlertsPanel alerts={controller} active development />);
    const button = () => screen.getByRole('button', { name: 'Test toast' }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);

    controller = makeController({
      test: vi.fn<AlertsController['test']>(() => Promise.resolve(false)),
    });
    rerender(<AlertsPanel alerts={controller} active development />);
    await act(async () => {
      fireEvent.click(button());
      await Promise.resolve();
    });
    expect(controller.test).toHaveBeenCalledWith('none', 0, true);
    expect(screen.queryByText(/Test toast sent/)).toBeNull();
  });

  it('shows the mute state with an unmute action', () => {
    state = dashboard();
    state.config = { ...state.config, muted_until_ms: NOW + 600_000 };
    renderPanel();
    expect(screen.getByText(/Muted until/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(controller.action).toHaveBeenCalledWith('unmute');
  });

  it('filters custom alerts by search, category and watchlist once there are several', () => {
    renderPanel();
    expect(screen.queryByLabelText('Search alerts')).toBeNull();
    cleanup();
    state.config.rules.push(
      ...[3, 4, 5, 6].map((n) => rule({ id: `r${n}`, name: `Raid ${n}`, category: 'custom' })),
    );
    renderPanel();
    const rules = () => screen.getByRole('list', { name: 'Alert rules' });
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'field' } });
    expect(within(rules()).queryByText('Shugo Festival')).toBeNull();
    expect(within(rules()).getByText('Field boss watch')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    expect(within(rules()).queryByText('Field boss watch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Watchlist' }));
    expect(screen.getByText('No alerts match')).toBeTruthy();
  });

  it('labels unknown and unverified templates and never invents their time', () => {
    state = dashboard({
      templates: [
        {
          id: 'festival',
          name: 'Shugo Festival',
          category: 'event',
          schedule: null,
          duration_seconds: 0,
          regions: ['na-east'],
          source: 'In-game notice',
          notes: '',
          verified: false,
          npc_id: null,
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    const picker = screen.getByRole('region', { name: 'Built-in templates' });
    expect(within(picker).getByText('Unverified')).toBeTruthy();
    expect(within(picker).getByText(/Time unknown: set it for your server/)).toBeTruthy();
    expect(within(picker).getByText(/not listed for your region/)).toBeTruthy();
    fireEvent.click(within(picker).getByRole('button', { name: 'Use' }));
    const form = screen.getByRole('form', { name: 'New alert' });
    expect(within(form).getByText(/time is unknown, so this alert never fires/)).toBeTruthy();
    expect(within(form).getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('follows the character automatically and lets the user pick a region', () => {
    state = dashboard({
      clock_ready: false,
      clock_estimated: true,
      clock_source: 'fallback',
      effective_region: 'global',
      effective_timezone: 'UTC',
    });
    state.config = { ...state.config, region: 'global', timezone: 'UTC' };
    renderPanel();
    // The fallback clock is named as such, never as a detected server.
    expect(screen.getByText(/Server not detected yet/)).toBeTruthy();
    expect(screen.getByText('Fallback clock')).toBeTruthy();
    expect(screen.queryByText(/Following /)).toBeNull();
    expect(screen.getByRole('option', { name: 'Automatic (from your character)' })).toBeTruthy();
    expect(screen.getByLabelText('Timezone')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'na-east' } });
    expect(last()).toMatchObject({ region: 'na-east', timezone: 'America/New_York', server: '' });
    fireEvent.change(screen.getByLabelText('Server'), { target: { value: '1001' } });
    expect(last().server).toBe('1001');
  });

  it('lists catalogue countdowns in Next up with notifications off, without turning them on', () => {
    state = dashboard({
      catalogue: catalogue(),
      clock_ready: false,
      clock_estimated: true,
      clock_source: 'fallback',
      effective_region: 'global',
      effective_timezone: 'UTC',
      upcoming: [],
      catalogue_upcoming: [
        {
          entry_id: 'event-rift',
          rule_id: 'preset-event-rift',
          name: 'Spacetime Rift',
          category: 'event',
          due_ms: NOW + 120_000,
          remaining_ms: 120_000,
          state: 'scheduled',
          clock: 'fallback',
          timezone: 'UTC',
          basis: 'Bundled calendar on the fallback clock (UTC); server not detected',
          estimated: true,
          notify: 'off',
          server: null,
        },
        {
          entry_id: 'field-2100100',
          rule_id: 'preset-field-2100100',
          name: 'Test Guardian',
          category: 'field_boss',
          due_ms: null,
          remaining_ms: null,
          state: 'unknown',
          clock: 'observed',
          timezone: null,
          basis: 'Waiting for a game observation',
          estimated: false,
          notify: 'off',
          server: null,
        },
      ],
    });
    state.config = { ...state.config, enabled: false, region: 'global', timezone: 'UTC' };
    renderPanel();
    expect(screen.getByText(/Notifications are off. Countdowns keep running/)).toBeTruthy();
    const upcoming = screen.getByRole('list', { name: 'Upcoming alerts' });
    expect(within(upcoming).getByText('Spacetime Rift')).toBeTruthy();
    expect(within(upcoming).getByLabelText('Time left').textContent).toBe('~2:00');
    // The clock is named once in the header, not repeated on every row.
    expect(within(upcoming).queryByText('Fallback clock')).toBeNull();
    expect(screen.getByText(/Fallback clock UTC/)).toBeTruthy();
    expect(within(upcoming).getByText(/Countdown only/)).toBeTruthy();
    // No reminder exists, so nothing to skip; an unseen boss is never given a time.
    expect(within(upcoming).queryByRole('button', { name: /Skip next/ })).toBeNull();
    expect(within(upcoming).queryByText('Test Guardian')).toBeNull();
    // The catalogue row counts down while its notification stays off.
    const events = screen.getByRole('list', { name: 'Events' });
    expect(within(events).getByLabelText('Next Spacetime Rift').textContent).toBe('~2:00');
    expect(
      screen
        .getByRole('switch', { name: 'Notify me about Spacetime Rift' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    // Options from Next up open in place without saving anything.
    fireEvent.click(within(upcoming).getByRole('button', { name: 'Edit Spacetime Rift' }));
    expect(screen.getByRole('form', { name: 'Options for Spacetime Rift' })).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('marks a switched-on built-in reminder that waits for the server region', () => {
    state = dashboard({
      catalogue: catalogue(),
      clock_ready: false,
      clock_estimated: true,
      clock_source: 'fallback',
      upcoming: [],
      catalogue_upcoming: [
        {
          entry_id: 'event-rift',
          rule_id: 'preset-event-rift',
          name: 'Spacetime Rift',
          category: 'event',
          due_ms: NOW + 120_000,
          remaining_ms: 120_000,
          state: 'scheduled',
          clock: 'fallback',
          timezone: 'UTC',
          basis: 'Bundled calendar on the fallback clock (UTC); server not detected',
          estimated: true,
          notify: 'waiting_for_clock',
          server: null,
        },
      ],
    });
    state.config = {
      ...state.config,
      region: 'global',
      timezone: 'UTC',
      rules: [{ ...catalogue()[0]!.rule, enabled: true }],
    };
    renderPanel();
    const upcoming = screen.getByRole('list', { name: 'Upcoming alerts' });
    expect(within(upcoming).getByText(/waits until your server region/)).toBeTruthy();
    expect(within(upcoming).queryByRole('button', { name: /Skip next/ })).toBeNull();
    expect(screen.getByText('Notifies once your server region is known')).toBeTruthy();
  });

  it('saves quiet hours across midnight and the background sound choice', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('switch', { name: /Quiet hours/ }));
    expect(last().quiet_hours).toEqual({ start: '23:00', end: '07:00' });
    fireEvent.click(
      screen.getByRole('switch', { name: /Sound while the game is in the background/ }),
    );
    expect(last().background_sound).toBe(false);
  });

  it('watches an observed boss with only native ids', () => {
    state = dashboard({
      observed: [
        {
          id: 'o1',
          name: 'Test Guardian',
          category: 'field_boss',
          npc_id: 2_100_100,
          event_id: null,
          due_ms: NOW + 600_000,
          observed_ms: NOW - 60_000,
          server: 'eu/1001',
          state: 'defeated',
          basis: 'observed defeat + your respawn interval',
          estimated: true,
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    const form = screen.getByRole('form', { name: 'New alert' });
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('Test Guardian');
    expect((within(form).getByLabelText('Boss to watch') as HTMLSelectElement).value).toBe(
      '2100100',
    );
    expect(within(form).getByRole('button', { name: 'Observed', pressed: true })).toBeTruthy();
  });

  it('turns a stale field boss watch into its ready-made entry', () => {
    state = dashboard({
      catalogue: catalogue(),
      observed: [
        {
          id: 'o1',
          name: 'Test Guardian',
          category: 'field_boss',
          npc_id: 2_100_100,
          event_id: null,
          due_ms: null,
          observed_ms: NOW - 60_000,
          server: 'eu/1001',
          state: 'Spawned',
          basis: 'Observed boss spawn',
          estimated: false,
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(screen.queryByRole('form', { name: 'New alert' })).toBeNull();
    expect(last().rules.find((r) => r.preset_id === 'field-2100100')?.enabled).toBe(true);
  });

  it('explains when the native engine is not available', () => {
    controller = makeController({ dashboard: null, native: false });
    render(<AlertsPanel alerts={controller} active />);
    expect(screen.getByText('Alerts need the desktop app')).toBeTruthy();
  });
});

/** A Portuguese engine for one provider; the window's shared engine stays as it was. */
function portuguese() {
  const shared = getI18n();
  const i18n = createTestI18n('pt-BR');
  setI18n(shared);
  return i18n;
}

describe('AlertsPanel in Brazilian Portuguese', () => {
  it('renders the tab in Portuguese, keeping user and game names as they are', () => {
    state = dashboard({ catalogue: catalogue() });
    controller = makeController();
    render(
      <TranslationProvider i18n={portuguese()}>
        <AlertsPanel alerts={controller} active />
      </TranslationProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Alertas' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Notificações' })).toBeTruthy();
    const rules = screen.getByRole('list', { name: 'Regras de alerta' });
    // The user's own rule name and native's catalogue names are never translated.
    expect(within(rules).getByText('Shugo Festival')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Notificar sobre Spacetime Rift' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Chefes de campo de Verteron' })).toBeTruthy();
    expect(screen.getByText('2 personalizados · 1 ativo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo alerta' })).toBeTruthy();
    const upcoming = screen.getByRole('list', { name: 'Próximos alertas' });
    expect(within(upcoming).getByLabelText('Tempo restante').textContent).toBe('1:30');
  });

  it('switches language in place without losing the alert being written', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New alert' }));
    let form = screen.getByRole('form', { name: 'New alert' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add alert' }));
    expect(within(form).getByText('Give the alert a name.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Times (24-hour)'), {
      target: { value: '20:00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add time' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Fri' }));

    await act(async () => {
      await getI18n().changeLanguage('pt-BR');
    });
    form = screen.getByRole('form', { name: 'Novo alerta' });
    // The draft and the shown errors survive; the messages now read in Portuguese.
    expect(within(form).getByText('Dê um nome ao alerta.')).toBeTruthy();
    expect(within(form).getByText('20:00')).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'sex.', pressed: true })).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Raide de sexta' } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Adicionar alerta' }));
    });
    expect(last().rules.find((r) => r.name === 'Raide de sexta')?.schedule).toEqual({
      type: 'calendar',
      times: ['20:00'],
      weekdays: [4],
    });
  });
});

describe('AlertsPanel maintenance and held reminders', () => {
  const HOUR = 3_600_000;
  const notice = (patch = {}) => ({
    title: 'Scheduled maintenance for all Global servers',
    url: 'https://example.invalid/notice',
    starts_ms: NOW - HOUR,
    ends_ms: NOW + 2 * HOUR,
    completed: false,
    ...patch,
  });
  const maintenanceNow = () =>
    serverStatus({
      maintenance: notice(),
      servers: [
        serverRow({ status: 'maintenance' }),
        serverRow({ id: '2001', name: 'Server B', region: 'na-east', status: 'maintenance' }),
      ],
    });
  const chapter = () => within(screen.getByRole('region', { name: 'Maintenance' }));

  it('holds reminders while the game is closed and offers to alert anyway', () => {
    state = dashboard({ game_running: false, delivery_paused: 'game_closed' });
    renderPanel();
    expect(screen.getByText(/Reminders are paused while AION is closed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alert even when the game is closed' }));
    expect(last().alert_when_game_closed).toBe(true);
    const setting = screen.getByRole('switch', { name: /Alert while the game is closed/ });
    expect(setting.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/AION is closed now\./)).toBeTruthy();
  });

  it('pauses for an announced maintenance and links its official notice', () => {
    state = dashboard({ delivery_paused: 'server_down', server_status: maintenanceNow() });
    renderPanel();
    expect(
      screen.getByText(/paused for the scheduled maintenance, announced to end around ~/),
    ).toBeTruthy();
    const section = chapter();
    expect(section.getByText('Maintenance now')).toBeTruthy();
    expect(section.getByText(/announced to end in 2h 00m · the end is an estimate/)).toBeTruthy();
    expect(section.getByText('Announced for all 2 Global servers.')).toBeTruthy();
    const link = section.getByRole('link', { name: /Scheduled maintenance for all Global/ });
    expect(link.getAttribute('href')).toBe('https://example.invalid/notice');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('turns on the maintenance-complete notification on its own', () => {
    state = dashboard({ server_status: maintenanceNow() });
    state.config = { ...state.config, enabled: false };
    renderPanel();
    // Independent of the master switch: it stays usable with notifications off.
    const toggle = chapter().getByRole('switch', {
      name: /Notify me when maintenance is complete/,
    });
    expect(toggle.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(toggle);
    expect(last().notify_server_back).toBe(true);
    expect(last().enabled).toBe(false);
  });

  it('shows an old or failed check as uncertain, never as maintenance', () => {
    state = dashboard({
      server_status: { ...maintenanceNow(), stale: true, error: 'Request timed out' },
    });
    renderPanel();
    const section = chapter();
    expect(section.getByText('Uncertain')).toBeTruthy();
    expect(section.queryByText('Maintenance now')).toBeNull();
    expect(section.getByText(/Reminders are never paused on an uncertain check/)).toBeTruthy();
    expect(section.getByText('Request timed out')).toBeTruthy();
  });

  it('keeps a window past its estimated end unconfirmed until the notice completes it', () => {
    state = dashboard({
      server_status: serverStatus({ maintenance: notice({ ends_ms: NOW - 1 }) }),
    });
    renderPanel();
    const section = chapter();
    expect(section.getByText('Unconfirmed')).toBeTruthy();
    expect(section.getByText('Estimated end passed; awaiting official completion')).toBeTruthy();
    expect(section.queryByText('No maintenance announced.')).toBeNull();
    expect(section.getByRole('link', { name: /Scheduled maintenance/ })).toBeTruthy();
    // With no window at all, it says only that none is announced.
    cleanup();
    state = dashboard();
    renderPanel();
    expect(chapter().getByText('No maintenance announced.')).toBeTruthy();
  });

  it('words held deliveries and the maintenance-complete alert in Portuguese', () => {
    const back = delivery({
      id: 'maintenance-complete:1',
      rule_id: 'maintenance-complete',
      name: 'Official maintenance complete',
      category: 'custom',
      phase: 'recovery',
      lead_seconds: 0,
      due_ms: NOW,
    });
    state = dashboard({
      active: [back],
      history: [
        back,
        delivery({ id: 'h1', status: 'server_down', fired_ms: NOW - 60_000 }),
        delivery({ id: 'h2', status: 'game_closed', fired_ms: NOW - 120_000 }),
      ],
    });
    controller = makeController();
    render(
      <TranslationProvider i18n={portuguese()}>
        <AlertsPanel alerts={controller} active />
      </TranslationProvider>,
    );
    const history = within(screen.getByRole('list', { name: 'Histórico de alertas' }));
    expect(history.getByText('Manutenção concluída')).toBeTruthy();
    expect(history.getByText('Manutenção')).toBeTruthy();
    expect(history.getByText('Jogo fechado')).toBeTruthy();
    expect(screen.queryByText('Official maintenance complete')).toBeNull();
    // It happens once: there is nothing to snooze.
    expect(screen.queryByRole('button', { name: /Adiar/ })).toBeNull();
  });
});
