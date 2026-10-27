import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertsController } from '../features/alerts/AlertsPanel';
import { resetPetCatalogue } from '../hooks/usePets';
import { DEFAULT_HOTKEYS } from '../lib/offlineNormalize';
import * as companion from '../services/companion';
import * as offline from '../services/offline';
import * as petsApi from '../services/pets';
import type { AlertDashboard, CatalogueCountdown } from '../types/alerts';
import type { LiveStatus } from '../types/companion';
import type { LogMeta } from '../types/offline';
import type { PetsStatus, PetWindowStatus } from '../types/pets';
import { dashboard, delivery, NOW, rule } from '../features/alerts/fixtures';
import { catalogue, status as petStatus } from '../features/pets/fixtures';
import type { HomeWindows } from '../features/home/HomePanel';
import { setupStatus } from '../features/setup/fixtures';
import type { SetupState, SetupStatus } from '../types/setup';
import { HomeTab, type HomeTabProps } from './HomeTab';

vi.mock('../lib/petArt', () => ({ petArt: () => null }));
vi.mock('../services/companion', () => ({ isNative: vi.fn<typeof companion.isNative>() }));
vi.mock('../services/offline', () => ({ listLogs: vi.fn<typeof offline.listLogs>() }));
vi.mock('../services/pets', () => ({
  readPetsCatalogue: vi.fn<typeof petsApi.readPetsCatalogue>(),
  readPetsStatus: vi.fn<typeof petsApi.readPetsStatus>(),
  configurePets: vi.fn<typeof petsApi.configurePets>(),
  readPetWindowStatus: vi.fn<typeof petsApi.readPetWindowStatus>(),
  markPetWindowReady: vi.fn<typeof petsApi.markPetWindowReady>(),
  showPetWindow: vi.fn<typeof petsApi.showPetWindow>(),
  hidePetWindow: vi.fn<typeof petsApi.hidePetWindow>(),
  lockPetWindow: vi.fn<typeof petsApi.lockPetWindow>(),
}));

const radarHidden: PetWindowStatus = {
  requested: false,
  visible: false,
  ready: true,
  locked: true,
  game_active: false,
  errors: [],
};

const waiting: LiveStatus = {
  running: true,
  phase: 'waiting_for_game',
  message: 'Waiting for AION 2.',
  duration_ms: 0,
  events: 0,
  players: [],
  stats: {},
};

/** A first run: no character, nothing chosen, nothing picked up. */
const freshPets = (): PetsStatus =>
  petStatus({
    profile_id: null,
    active_profile_id: null,
    profiles: [],
    collection_synced: false,
    progress: [],
    session: { profile_id: null, started_ms: null, souls_gained: 0, level_ups: 0, obtained: 0 },
  });

const countdown = (patch: Partial<CatalogueCountdown>): CatalogueCountdown => ({
  entry_id: 'event-rift',
  rule_id: 'preset-event-rift',
  name: 'Spacetime Rift',
  category: 'event',
  due_ms: NOW + 90_000,
  remaining_ms: 90_000,
  state: 'scheduled',
  clock: 'server',
  timezone: 'Europe/Berlin',
  basis: 'Calendar',
  estimated: false,
  notify: 'off',
  server: null,
  ...patch,
});

/** No reminder turned on yet, and one built-in countdown. */
const quietDashboard = (patch: Partial<AlertDashboard> = {}) =>
  dashboard({
    upcoming: [],
    catalogue_upcoming: [countdown({})],
    ...patch,
    config: { ...dashboard().config, rules: [rule({ enabled: false })] },
  });

const alertsController = (value: AlertDashboard | null): AlertsController => ({
  native: true,
  dashboard: value,
  error: '',
  busy: false,
  offsetMs: 0,
  configure: vi.fn<AlertsController['configure']>().mockResolvedValue(true),
  action: vi.fn<AlertsController['action']>().mockResolvedValue(true),
  test: vi.fn<AlertsController['test']>().mockResolvedValue(true),
  now: () => Date.now(),
});

/** Setup as the workspace holds it; a working driver unless told otherwise. */
const setupController = (
  status: SetupStatus | null = setupStatus(),
  patch: Partial<SetupState> = {},
): SetupState => ({
  status,
  error: '',
  checking: false,
  recheck: vi.fn<SetupState['recheck']>().mockResolvedValue(),
  open: vi.fn<SetupState['open']>().mockResolvedValue(''),
  ...patch,
});

const windows = (patch: Partial<HomeWindows> = {}): HomeWindows => ({
  known: true,
  busy: false,
  dps: false,
  suspended: false,
  locked: false,
  group: false,
  trackers: false,
  onToggleDps: vi.fn<() => void>(),
  onLock: vi.fn<(locked: boolean) => void>(),
  onToggleGroup: vi.fn<() => void>(),
  onToggleTrackers: vi.fn<() => void>(),
  ...patch,
});

const props = (patch: Partial<HomeTabProps> = {}): HomeTabProps => ({
  native: true,
  live: waiting,
  captureError: '',
  liveTarget: null,
  windows: windows(),
  hotkeys: DEFAULT_HOTKEYS,
  autoSave: true,
  libraryCount: 0,
  alerts: alertsController(quietDashboard()),
  setup: setupController(),
  update: null,
  onNavigate: vi.fn<HomeTabProps['onNavigate']>(),
  onOpenLog: vi.fn<HomeTabProps['onOpenLog']>(),
  ...patch,
});

const log = (id: string, patch: Partial<LogMeta> = {}): LogMeta => ({
  id,
  label: null,
  started_ms: NOW - 9 * 60_000,
  duration_ms: 192_000,
  damage: 7_800_000,
  dps: 40_800,
  players: 6,
  player_names: [],
  boss: 'Soul Ruler Kashapa',
  zone_id: null,
  run_id: null,
  end_reason: 'kill',
  ...patch,
});

const step = (id: string) => document.querySelector<HTMLElement>(`[data-step="${id}"]`);

beforeEach(() => {
  resetPetCatalogue();
  localStorage.clear();
  vi.mocked(companion.isNative).mockReturnValue(true);
  vi.mocked(offline.listLogs).mockResolvedValue([]);
  vi.mocked(petsApi.readPetsCatalogue).mockResolvedValue(catalogue());
  vi.mocked(petsApi.readPetsStatus).mockResolvedValue(freshPets());
  vi.mocked(petsApi.readPetWindowStatus).mockResolvedValue(radarHidden);
  vi.mocked(petsApi.showPetWindow).mockResolvedValue({ ...radarHidden, requested: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('Home tab', () => {
  it('guides a first run with steps ticked off by real state', async () => {
    const first = props();
    const { rerender } = render(<HomeTab {...first} />);
    await waitFor(() => expect(screen.getByText('No saved fights yet')).toBeTruthy());
    // The page opens with an h2 greeting; nothing is known about the character yet.
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /^(Good morning|Good afternoon|Good evening|Welcome back)$/,
      }),
    ).toBeTruthy();
    expect(screen.getByText('Waiting for game')).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5);
    expect(step('game')?.dataset.state).toBe('next');
    expect(step('meter')?.dataset.state).toBe('todo');
    // The pets step already points to Pets, so the empty pet card stays away.
    expect(screen.queryByRole('region', { name: 'Pet farming' })).toBeNull();

    // Buttons in the list act; they never tick a step themselves.
    fireEvent.click(screen.getByRole('button', { name: 'Show the meter' }));
    expect(first.windows.onToggleDps).toHaveBeenCalledOnce();
    expect(step('meter')?.dataset.state).toBe('todo');
    fireEvent.click(within(steps).getByRole('button', { name: 'Choose a pet' }));
    expect(first.onNavigate).toHaveBeenCalledWith('pets');
    fireEvent.click(screen.getByRole('button', { name: 'Choose alerts' }));
    expect(first.onNavigate).toHaveBeenCalledWith('alerts');

    // The game connects and the meter shows: both steps tick off.
    rerender(
      <HomeTab
        {...first}
        live={{ ...waiting, phase: 'capturing' }}
        windows={windows({ dps: true })}
        libraryCount={2}
      />,
    );
    expect(step('game')?.dataset.state).toBe('done');
    expect(step('meter')?.dataset.state).toBe('done');
    expect(step('fight')?.dataset.state).toBe('done');
    expect(step('alerts')?.dataset.state).toBe('next');
    expect(screen.getByText('3 of 5 done')).toBeTruthy();
    expect(screen.getByText('Capturing')).toBeTruthy();
  });

  it('hides the steps on request and remembers it', async () => {
    render(<HomeTab {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide getting started' }));
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
    cleanup();
    render(<HomeTab {...props()} />);
    await waitFor(() => expect(screen.getByText('No farming goal yet')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
  });

  it('counts down on its own tick, without a new dashboard', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    const later = countdown({
      entry_id: 'event-invasion',
      rule_id: 'preset-event-invasion',
      name: 'Invasion',
      due_ms: NOW + 45 * 60_000,
    });
    render(
      <HomeTab
        {...props({
          alerts: alertsController(quietDashboard({ catalogue_upcoming: [countdown({}), later] })),
        })}
      />,
    );
    const first = screen.getByLabelText('Time until Spacetime Rift');
    expect(first.textContent).toBe('1:30');
    expect(screen.getByLabelText('Time until Invasion').textContent).toBe('45:00');
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByLabelText('Time until Spacetime Rift').textContent).toBe('1:25');
    expect(screen.getByLabelText('Time until Invasion').textContent).toBe('44:55');
  });

  it('opens a saved fight and every section links to its tab', async () => {
    vi.mocked(offline.listLogs).mockResolvedValue([
      log('fight-2', { label: 'Kashapa — clean kill', dps: 44_000 }),
      log('fight-1', { started_ms: NOW - 86_400_000, dps: 40_000, end_reason: 'reset' }),
    ]);
    const p = props({ libraryCount: 2 });
    render(<HomeTab {...p} />);
    const open = await screen.findByRole('button', { name: 'Open Kashapa — clean kill report' });
    expect(offline.listLogs).toHaveBeenCalledWith({ sort: 'newest', limit: 40 });
    expect(within(open).getByText('Kill')).toBeTruthy();
    expect(within(open).getByText('Best')).toBeTruthy();
    expect(within(open).getByText('10%')).toBeTruthy();
    expect(screen.getByText('Boss reset')).toBeTruthy();
    fireEvent.click(open);
    expect(p.onOpenLog).toHaveBeenCalledWith('fight-2');
    for (const [name, tab] of [
      ['All logs', 'logs'],
      ['All alerts', 'alerts'],
      ['Live meter', 'live'],
      ['Trackers', 'trackers'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(p.onNavigate).toHaveBeenLastCalledWith(tab);
    }
  });

  it('answers ringing alerts in place', async () => {
    const alerts = alertsController(
      quietDashboard({
        active: [
          delivery({ id: 'a:1', name: 'Spacetime Rift' }),
          delivery({ id: 'b:1', name: 'Shugo Festival', phase: 'start' }),
        ],
      }),
    );
    render(<HomeTab {...props({ alerts })} />);
    const ringing = screen.getByRole('region', { name: 'Ringing now' });
    fireEvent.click(
      within(ringing).getByRole('button', { name: 'Snooze Spacetime Rift for 5 minutes' }),
    );
    expect(alerts.action).toHaveBeenLastCalledWith('snooze', 'a:1', 300);
    fireEvent.click(within(ringing).getByRole('button', { name: 'Dismiss Shugo Festival' }));
    expect(alerts.action).toHaveBeenLastCalledWith('dismiss', 'b:1');
    fireEvent.click(within(ringing).getByRole('button', { name: 'Dismiss all' }));
    expect(alerts.action).toHaveBeenLastCalledWith('dismiss_all');
    await waitFor(() => expect(petsApi.readPetWindowStatus).toHaveBeenCalled());
  });

  it('shows and hides every in-game window from one place', async () => {
    const w = windows({ dps: true });
    render(<HomeTab {...props({ windows: w })} />);
    const panel = screen.getByRole('region', { name: 'Windows over the game' });
    expect(
      within(panel).getByRole('switch', { name: 'DPS meter' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(panel).getByRole('switch', { name: 'DPS meter' }));
    expect(w.onToggleDps).toHaveBeenCalledOnce();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Group' }));
    expect(w.onToggleGroup).toHaveBeenCalledOnce();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Trackers' }));
    expect(w.onToggleTrackers).toHaveBeenCalledOnce();
    fireEvent.click(within(panel).getByRole('button', { name: 'Lock the meter' }));
    expect(w.onLock).toHaveBeenCalledWith(true);
    const radar = within(panel).getByRole<HTMLButtonElement>('switch', { name: 'Pet radar' });
    await waitFor(() => expect(radar.disabled).toBe(false));
    fireEvent.click(radar);
    await waitFor(() => expect(petsApi.showPetWindow).toHaveBeenCalledOnce());
    expect(within(panel).getByText('Ctrl+Shift+F9')).toBeTruthy();
  });

  it.each([
    { enabled: true, requested: false, suspended: false, state: 'Waiting for raid room' },
    { enabled: true, requested: false, suspended: true, state: 'Waiting for raid room' },
    { enabled: true, requested: true, suspended: false, state: 'Shown' },
    { enabled: true, requested: true, suspended: true, state: 'Auto-hidden' },
    { enabled: false, requested: false, suspended: false, state: 'Hidden' },
    { enabled: false, requested: true, suspended: true, state: 'Hidden' },
  ])(
    'reports Group $state for enabled=$enabled, eligible=$requested, unfocused=$suspended',
    ({ enabled, requested, suspended, state }) => {
      render(
        <HomeTab
          {...props({
            windows: windows({ group: enabled, groupRequested: requested, suspended }),
          })}
        />,
      );
      const group = screen.getByRole('switch', { name: 'Group' });
      expect(group.getAttribute('aria-checked')).toBe(String(enabled));
      expect(group.querySelector('[data-ui="window-state"]')?.textContent).toBe(state);
      expect(group.title).toContain(
        `${enabled ? 'Disable' : 'Enable'} automatic Group panel display in raid rooms`,
      );
    },
  );

  it('keeps Group enabled as a raid room is entered and left', () => {
    const p = props({ windows: windows({ group: true, groupRequested: false }) });
    const { rerender } = render(<HomeTab {...p} />);
    const group = screen.getByRole('switch', { name: 'Group' });
    expect(group.getAttribute('aria-checked')).toBe('true');
    expect(group.textContent).toContain('Waiting for raid room');
    rerender(<HomeTab {...p} windows={{ ...p.windows, groupRequested: true }} />);
    expect(group.getAttribute('aria-checked')).toBe('true');
    expect(group.textContent).toContain('Shown');
    rerender(<HomeTab {...p} />);
    expect(group.getAttribute('aria-checked')).toBe('true');
    expect(group.textContent).toContain('Waiting for raid room');
    fireEvent.click(group);
    expect(p.windows.onToggleGroup).toHaveBeenCalledOnce();
  });

  it('uses the legacy Group request when eligibility is unavailable', () => {
    render(<HomeTab {...props({ windows: windows({ group: true }) })} />);
    expect(screen.getByRole('switch', { name: 'Group' }).textContent).toContain('Shown');
  });

  it('leads with the farming goal and its radar', async () => {
    vi.mocked(petsApi.readPetsStatus).mockResolvedValue(
      petStatus({
        config: {
          ...petStatus().config,
          farming_goal: { pet_id: 2, map_id: 'World/World_L/World_L_A' },
          pinned_ids: [2, 3],
        },
        gains: [{ id: 'g1', pet_id: 2, gained: 2, at_ms: NOW - 30_000 }],
      }),
    );
    const p = props({ live: { ...waiting, phase: 'capturing' } });
    render(<HomeTab {...p} />);
    const card = await screen.findByRole('region', { name: 'Pet farming' });
    // The goal, and again in the latest pickups.
    await waitFor(() => expect(within(card).getAllByText('Barn Owl')).toHaveLength(2));
    expect(within(card).getByText('Farming goal')).toBeTruthy();
    expect(within(card).getByText(/15 souls to Lv 2/)).toBeTruthy();
    expect(within(card).getByText('Copper Crab')).toBeTruthy();
    expect(within(card).getByText('+2')).toBeTruthy();
    expect(within(card).getByText('6')).toBeTruthy();
    const show = within(card).getByRole<HTMLButtonElement>('button', { name: 'Show radar' });
    await waitFor(() => expect(show.disabled).toBe(false));
    fireEvent.click(show);
    await waitFor(() => expect(petsApi.showPetWindow).toHaveBeenCalledOnce());
    fireEvent.click(within(card).getByRole('button', { name: 'Change goal' }));
    expect(p.onNavigate).toHaveBeenLastCalledWith('pets');
  });

  it('mentions a waiting update and opens Settings', () => {
    const p = props({ update: { version: '0.7.0', ready: false } });
    render(<HomeTab {...p} />);
    expect(screen.getByText('0.7.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See the update' }));
    expect(p.onNavigate).toHaveBeenCalledWith('settings');
  });

  it('puts a missing capture driver first, even with the steps hidden', async () => {
    const setup = setupController(setupStatus('missing'));
    const p = props({ setup, live: { ...waiting, phase: 'error', message: 'Npcap missing' } });
    render(<HomeTab {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide getting started' }));
    const band = screen.getByRole('region', { name: 'Live capture needs Npcap' });
    expect(within(band).getByText('Before you start')).toBeTruthy();
    // What still works is said up front; the native reason is kept for reference.
    expect(within(band).getByText(/Saved logs, Replay, reminders and Timers work/)).toBeTruthy();
    expect(within(band).getByText(/The specified module could not be found/)).toBeTruthy();
    expect(within(band).queryByRole('button', { name: 'Npcap troubleshooting' })).toBeNull();

    fireEvent.click(within(band).getByRole('button', { name: 'Get Npcap' }));
    await waitFor(() => expect(setup.open).toHaveBeenCalledWith('npcap'));
    fireEvent.click(within(band).getByRole('button', { name: 'Check again' }));
    expect(setup.recheck).toHaveBeenCalledOnce();
    fireEvent.click(within(band).getByRole('button', { name: 'Setup details' }));
    expect(p.onNavigate).toHaveBeenCalledWith('setup');
    // Before installing anything, the band explains what Npcap is, folded until asked.
    const summary = within(band).getByText(/What is Npcap\?/);
    const about = summary.closest<HTMLElement>('[data-ui="disclosure"]')!;
    expect(summary.closest('button')?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary);
    expect(about.textContent).toContain('Npcap is optional');
    fireEvent.click(within(about).getByRole('button', { name: "Npcap User's Guide" }));
    await waitFor(() => expect(setup.open).toHaveBeenLastCalledWith('npcap_help'));
  });

  it('treats a missing driver as setup to do, not a capture error', () => {
    const loader =
      'Npcap could not load: LoadLibraryExW failed. Install Npcap from npcap.com. Retrying automatically in 10 seconds.';
    const failing: LiveStatus = { ...waiting, running: false, phase: 'error', message: loader };
    const p = props({ setup: setupController(setupStatus('missing')), live: failing });
    const { rerender } = render(<HomeTab {...p} />);
    const line = () => document.querySelector<HTMLElement>('[data-home="capture"]')!;
    expect(line().dataset.state).toBe('setup');
    expect(within(line()).getByText('Needs Npcap')).toBeTruthy();
    expect(within(line()).getByText('· Install Npcap to start live capture.')).toBeTruthy();
    // Neither the loader's reason nor the retry wait leads the page; the band says what to do.
    expect(screen.queryByText('Capture error')).toBeNull();
    expect(screen.queryByText(/LoadLibraryExW|Retrying automatically/)).toBeNull();
    expect(step('game')?.textContent).toContain('Install Npcap to start live capture.');
    expect(screen.getByRole('region', { name: 'Live capture needs Npcap' })).toBeTruthy();
    // The reconnect between retries keeps the same line rather than flickering.
    rerender(<HomeTab {...p} live={{ ...waiting, phase: 'starting', message: 'Reconnecting' }} />);
    expect(line().dataset.state).toBe('setup');

    // Driver probed ready: a fault is a real capture error again, with its retry.
    rerender(<HomeTab {...p} setup={setupController(setupStatus('ready'))} />);
    expect(line().dataset.state).toBe('error');
    expect(within(line()).getByText('Capture error')).toBeTruthy();
    expect(within(line()).getByText(/LoadLibraryExW failed.*Retrying automatically/)).toBeTruthy();
    expect(step('game')?.textContent).toContain('Retrying automatically');
    // Before the first probe answers, or when it fails, nothing is assumed either.
    rerender(<HomeTab {...p} setup={setupController(null, { checking: true })} />);
    expect(within(line()).getByText('Capture error')).toBeTruthy();
    rerender(<HomeTab {...p} setup={setupController(null, { error: 'Error: probe failed' })} />);
    expect(within(line()).getByText(/Retrying automatically/)).toBeTruthy();
    // A recheck that fails keeps the old status; it no longer confirms anything.
    const stale = setupController(setupStatus('missing'), { error: 'Error: probe failed' });
    rerender(<HomeTab {...p} setup={stale} />);
    expect(line().dataset.state).toBe('error');
    expect(within(line()).getByText(/LoadLibraryExW failed.*Retrying automatically/)).toBeTruthy();
    expect(step('game')?.textContent).toContain('Retrying automatically');
    // Status that cannot be read at all is its own fault, whatever the probe says.
    rerender(<HomeTab {...p} captureError="Error: status unavailable" />);
    expect(within(line()).getByText('Capture error')).toBeTruthy();
    expect(within(line()).getByText('· Error: status unavailable')).toBeTruthy();
    // Waiting for the game proves the driver loads, so a stale probe never hides that.
    rerender(<HomeTab {...p} live={waiting} />);
    expect(within(line()).getByText('Waiting for game')).toBeTruthy();
  });

  it('tells an installed but unusable driver apart and offers official troubleshooting', async () => {
    const setup = setupController(setupStatus('unavailable'), {
      open: vi.fn<SetupState['open']>().mockResolvedValue('Error: no browser'),
    });
    render(<HomeTab {...props({ setup })} />);
    const band = screen.getByRole('region', {
      name: 'Npcap is installed, but capture cannot use it',
    });
    expect(within(band).queryByRole('button', { name: 'Get Npcap' })).toBeNull();
    expect(within(band).queryByText(/administrator/i)).toBeTruthy();
    expect(within(band).queryByText(/run (it )?as administrator/i)).toBeNull();
    fireEvent.click(within(band).getByRole('button', { name: 'Npcap troubleshooting' }));
    expect(setup.open).toHaveBeenCalledWith('npcap_help');
    // A page that cannot open says why beside the button.
    expect((await within(band).findByRole('alert')).textContent).toContain('no browser');
  });

  it('shows the probe running and leaves the band out once capture works', () => {
    const setup = setupController(setupStatus('missing'), { checking: true });
    const p = props({ setup });
    const { rerender } = render(<HomeTab {...p} />);
    const check = screen.getByRole<HTMLButtonElement>('button', { name: 'Checking…' });
    expect(check.disabled).toBe(true);
    expect(check.getAttribute('aria-busy')).toBe('true');
    // Capture connected: the driver evidently works, whatever the last probe said.
    rerender(<HomeTab {...p} live={{ ...waiting, phase: 'capturing' }} />);
    expect(screen.queryByRole('region', { name: 'Live capture needs Npcap' })).toBeNull();
    rerender(<HomeTab {...p} setup={setupController(setupStatus('ready'))} />);
    expect(document.querySelector('[data-home="setup"]')).toBeNull();
    rerender(<HomeTab {...p} setup={setupController(null, { error: 'Error: probe failed' })} />);
    expect(document.querySelector('[data-home="setup"]')).toBeNull();
  });

  it('says plainly when live capture cannot run on this system', () => {
    render(<HomeTab {...props({ setup: setupController(setupStatus('unsupported')) })} />);
    const band = screen.getByRole('region', { name: 'Live capture is not available on this PC' });
    // Nothing to install here, so there is no driver to explain.
    expect(within(band).queryByText(/What is Npcap\?/)).toBeNull();
    expect(within(band).queryByRole('button', { name: 'Get Npcap' })).toBeNull();
    expect(within(band).getByText(/still work/)).toBeTruthy();
  });
});
