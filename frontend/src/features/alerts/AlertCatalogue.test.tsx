import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertConfig, AlertDashboard, ObservedTimer } from '../../types/alerts';
import { AlertsPanel, type AlertsController } from './AlertsPanel';
import { NOW, catalogue, dashboard } from './fixtures';

let state: AlertDashboard;
let controller: AlertsController;
let saved: AlertConfig[];

function renderPanel() {
  controller = {
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
  };
  return render(<AlertsPanel alerts={controller} active />);
}
const last = () => saved[saved.length - 1]!;
const rift = () => catalogue()[0]!;

const sighting = (patch: Partial<ObservedTimer>): ObservedTimer => ({
  id: 'npc-2100100',
  name: 'Test Guardian',
  category: 'field_boss',
  npc_id: 2_100_100,
  event_id: null,
  due_ms: null,
  observed_ms: NOW - 12 * 60_000,
  server: 'eu/1001',
  state: 'Spawned',
  basis: 'Observed boss spawn',
  estimated: false,
  ...patch,
});

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  vi.setSystemTime(NOW);
  state = dashboard({ catalogue: catalogue() });
  saved = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ready-made alerts', () => {
  it('lists every event and boss from the first open, with no name to fill in', () => {
    renderPanel();
    expect(
      within(screen.getByRole('list', { name: 'Events' })).getByText('Spacetime Rift'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'World bosses' })).getByText('Siege Bosses'),
    ).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Verteron field bosses' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Altgard field bosses' })).toBeTruthy();
    expect(screen.getByText(/Every 3 h · 02:00, 05:00, … · open 10 min/)).toBeTruthy();
    expect(screen.getByText(/Executor Tamasa, Executor Argo \+1/)).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(saved).toEqual([]);
  });

  it('switches an entry on in one click and turns alerts on the first time', () => {
    state.config = { ...state.config, enabled: false, rules: [] };
    renderPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Notify me about Spacetime Rift' }));
    expect(last().enabled).toBe(true);
    expect(last().rules).toEqual([
      expect.objectContaining({
        id: 'preset-event-rift',
        preset_id: 'event-rift',
        name: 'Spacetime Rift',
        enabled: true,
        lead_seconds: [300, 0],
      }),
    ]);
  });

  it('customises the reminder, sound and preview inline, keeping them when off', () => {
    state.config = { ...state.config, volume: 0.5, rules: [{ ...rift().rule, enabled: true }] };
    renderPanel();
    fireEvent.change(screen.getByLabelText('Reminder for Spacetime Rift'), {
      target: { value: '600' },
    });
    expect(last().rules[0]?.lead_seconds).toEqual([600, 0]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also when it starts' }));
    expect(last().rules[0]?.lead_seconds).toEqual([300]);
    fireEvent.change(screen.getByLabelText('Sound for Spacetime Rift'), {
      target: { value: 'ping' },
    });
    expect(last().rules[0]?.sound).toBe('ping');
    // Native applies the master volume to previews itself: the alert's own volume is sent.
    fireEvent.click(screen.getByRole('button', { name: 'Test Spacetime Rift' }));
    expect(controller.test).toHaveBeenCalledWith('chime', 0.6, true);
    fireEvent.click(screen.getByRole('switch', { name: 'Notify me about Spacetime Rift' }));
    expect(last().rules).toHaveLength(1);
    expect(last().rules[0]).toMatchObject({ enabled: false, preset_id: 'event-rift' });
  });

  it('opens More options without a name field and can take over the schedule', async () => {
    state.config = { ...state.config, rules: [{ ...rift().rule, enabled: true }] };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'More options for Spacetime Rift' }));
    const form = screen.getByRole('form', { name: 'Options for Spacetime Rift' });
    expect(within(form).queryByLabelText('Name')).toBeNull();
    expect(within(form).queryByLabelText('Times (24-hour)')).toBeNull();
    fireEvent.click(within(form).getByRole('switch', { name: /Use my own schedule/ }));
    expect(within(form).getByLabelText('Times (24-hour)')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Save alert' }));
    });
    expect(last().rules[0]).toMatchObject({
      preset_id: 'event-rift',
      name: 'Spacetime Rift',
      schedule_override: true,
    });
  });

  it('follows the character faction, and finds bosses by name or map', () => {
    state = dashboard({ catalogue: catalogue(), effective_faction: 'elyos' });
    renderPanel();
    expect(screen.getByRole('list', { name: 'Verteron field bosses' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Altgard field bosses' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Automatic (Elyos)' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Faction'), { target: { value: 'all' } });
    expect(last().faction).toBe('all');

    const search = screen.getByLabelText('Search events and bosses');
    fireEvent.change(search, { target: { value: 'argo' } });
    expect(screen.getByText('Siege Bosses')).toBeTruthy();
    expect(screen.queryByText('Spacetime Rift')).toBeNull();
    fireEvent.change(search, { target: { value: 'verteron' } });
    expect(screen.getByRole('list', { name: 'Verteron field bosses' })).toBeTruthy();
    expect(screen.queryByText('Siege Bosses')).toBeNull();
  });

  it('collapses a map and shows only what is on', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Verteron/ }));
    expect(screen.queryByRole('list', { name: 'Verteron field bosses' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Notifying', pressed: false }));
    expect(screen.getByText('No notifications on yet')).toBeTruthy();
  });

  it('shows what was seen in game, never a guessed state', () => {
    const verteron = () => screen.getByRole('list', { name: 'Verteron field bosses' });
    state.observed = [sighting({ observed_ms: NOW - 30_000 })];
    renderPanel();
    expect(within(verteron()).getByText(/^Up since /)).toBeTruthy();
    // Two minutes after the sighting nothing says it is still up.
    act(() => {
      vi.advanceTimersByTime(91_000);
    });
    expect(within(verteron()).queryByText(/Up since/)).toBeNull();
    expect(within(verteron()).getByText(/^Last seen /)).toBeTruthy();
    cleanup();
    vi.setSystemTime(NOW);

    // A spawn seen long ago (an old saved record) is only a past sighting.
    state.observed = [sighting({ observed_ms: NOW - 3 * 86_400_000 })];
    renderPanel();
    const old = within(verteron()).getByText(/^Last seen /);
    expect(old.closest('[title]')?.getAttribute('title')).toMatch(/still up is unknown/);
    expect(within(verteron()).queryByText(/Up since/)).toBeNull();
    cleanup();

    // Nor while native says capture is not observing, however fresh.
    state.observed = [sighting({ observed_ms: NOW - 10_000 })];
    state.live_observations = false;
    renderPanel();
    expect(within(verteron()).getByText(/^Last seen /)).toBeTruthy();
    delete state.live_observations;
    cleanup();

    state.observed = [sighting({ state: 'Defeated' })];
    renderPanel();
    expect(within(verteron()).getByText(/^Defeated /)).toBeTruthy();
    cleanup();

    state.observed = [sighting({ state: 'Defeated', due_ms: NOW + 90_000, estimated: true })];
    renderPanel();
    expect(within(verteron()).getByLabelText('Next Test Guardian').textContent).toBe('~1:30');
    cleanup();

    // The in-game Field Boss list gives an exact next spawn while the boss is down.
    const list = { basis: 'In-game Field Boss list', observed_ms: NOW - 3 * 3_600_000 };
    state.observed = [sighting({ ...list, state: 'Respawning', due_ms: NOW + 4 * 60_000 })];
    renderPanel();
    expect(within(verteron()).getByLabelText('Next Test Guardian').textContent).toBe('4:00');
    expect(within(verteron()).queryByText(/Up since/)).toBeNull();
    cleanup();
    // Once that time passes without a newer list, nothing claims it is up.
    state.observed = [sighting({ ...list, state: 'Respawning', due_ms: NOW - 60_000 })];
    renderPanel();
    expect(within(verteron()).queryByLabelText('Next Test Guardian')).toBeNull();
    expect(within(verteron()).queryByText(/Up since/)).toBeNull();
    cleanup();

    state.observed = [sighting({ state: 'Game state 3' })];
    renderPanel();
    expect(within(verteron()).getByText(/^Seen /)).toBeTruthy();
    expect(within(verteron()).queryByText(/Up since|Defeated/)).toBeNull();
    cleanup();

    state.observed = [];
    state.config = { ...state.config, rules: [{ ...catalogue()[2]!.rule, enabled: true }] };
    renderPanel();
    expect(within(verteron()).getByText('No reports yet')).toBeTruthy();
  });

  it('keeps what is known visible with notifications off, never inventing a boss time', () => {
    const base = {
      remaining_ms: null,
      timezone: null,
      estimated: false,
      notify: 'off' as const,
      server: null,
    };
    state.config = { ...state.config, enabled: false, rules: [] };
    state.catalogue_upcoming = [
      {
        ...base,
        entry_id: 'event-rift',
        rule_id: 'preset-event-rift',
        name: 'Spacetime Rift',
        category: 'event',
        due_ms: NOW,
        state: 'open',
        clock: 'server',
        timezone: 'Europe/Berlin',
        basis: 'Bundled regional calendar on the server clock',
      },
      {
        ...base,
        entry_id: 'world-siege',
        rule_id: 'preset-world-siege',
        name: 'Siege Bosses',
        category: 'world_boss',
        due_ms: NOW + 3_600_000,
        state: 'scheduled',
        clock: 'server',
        timezone: 'Europe/Berlin',
        basis: 'Bundled regional calendar on the server clock',
      },
      {
        ...base,
        entry_id: 'field-2100100',
        rule_id: 'preset-field-2100100',
        name: 'Test Guardian',
        category: 'field_boss',
        due_ms: null,
        state: 'unknown',
        clock: 'observed',
        basis: 'Waiting for a game observation',
      },
    ];
    renderPanel();
    expect(within(screen.getByRole('list', { name: 'Events' })).getByText('Open now')).toBeTruthy();
    expect(screen.getByLabelText('Next Siege Bosses').textContent).toBe('1h 00m');
    const verteron = screen.getByRole('list', { name: 'Verteron field bosses' });
    expect(within(verteron).getByText('No reports yet')).toBeTruthy();
    expect(within(verteron).queryByLabelText('Next Test Guardian')).toBeNull();
    expect(screen.getByText('Countdowns only')).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('saves the master volume once the slider settles', () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: 'Master volume' });
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(saved).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(saved).toHaveLength(1);
    expect(last().volume).toBe(0.4);
  });

  it('opens a ready-made alert from Next up in place', () => {
    state.config = { ...state.config, rules: [{ ...rift().rule, enabled: true }] };
    state.upcoming = [{ ...state.upcoming[0]!, rule_id: rift().rule.id, name: 'Spacetime Rift' }];
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Spacetime Rift' }));
    expect(screen.getByRole('form', { name: 'Options for Spacetime Rift' })).toBeTruthy();
  });

  it('keeps custom alerts, including ones made before the list existed', () => {
    renderPanel();
    const custom = screen.getByRole('list', { name: 'Alert rules' });
    expect(within(custom).getByText('Shugo Festival')).toBeTruthy();
    expect(within(custom).getByText('Field boss watch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New alert' })).toBeTruthy();
  });
});
