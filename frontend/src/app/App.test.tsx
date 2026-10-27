import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../features/alerts/fixtures';
import { report, reportSummary } from '../features/offline/fixtures';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import * as alertsApi from '../services/alerts';
import * as api from '../services/companion';
import * as activityApi from '../services/activityWindows';
import * as cubesApi from '../services/cubes';
import { cubesStatus } from '../features/cubes/fixtures';
import { applyPatch } from '../lib/finderPreferences';
import {
  DEFAULT_FINDER_PREFERENCES,
  type FinderPreferences,
  type FinderPreferencesPatch,
} from '../types/finderPreferences';
import * as offlineApi from '../services/offline';
import * as setupApi from '../services/setup';
import * as updateAccessApi from '../services/updateAccess';
import * as updatesApi from '../services/updates';
import { setupStatus } from '../features/setup/fixtures';
import {
  INITIAL_ACTIVITY_WINDOW,
  type ActivityWindowKind,
  type ActivityWindowStatus,
} from '../types/activityWindows';
import type { Recording, Snapshot } from '../types/companion';
import type { OfflineStatus } from '../types/offline';
import type { UpdatePhase, UpdateStatus } from '../types/updates';
import App from './App';

vi.mock('../services/companion', () => ({
  isNative: vi.fn<typeof api.isNative>(),
  loadRecording: vi.fn<typeof api.loadRecording>(),
  readSnapshot: vi.fn<typeof api.readSnapshot>(),
  saveRecording: vi.fn<typeof api.saveRecording>(),
  readLiveStatus: vi.fn<typeof api.readLiveStatus>(),
  resetLive: vi.fn<typeof api.resetLive>(),
  configureLive: vi.fn<typeof api.configureLive>(),
  saveLiveComparison: vi.fn<typeof api.saveLiveComparison>(),
  showDpsOverlay: vi.fn<typeof api.showDpsOverlay>(),
  hideDpsOverlay: vi.fn<typeof api.hideDpsOverlay>(),
  readOverlayStatus: vi.fn<typeof api.readOverlayStatus>(),
  markOverlayReady: vi.fn<typeof api.markOverlayReady>(),
  markMenuReady: vi.fn<typeof api.markMenuReady>(),
  quitOverlay: vi.fn<typeof api.quitOverlay>(),
}));

vi.mock('../services/alerts', () => ({
  readAlertsStatus: vi.fn<typeof alertsApi.readAlertsStatus>(),
  configureAlerts: vi.fn<typeof alertsApi.configureAlerts>(),
  runAlertAction: vi.fn<typeof alertsApi.runAlertAction>(),
  testAlert: vi.fn<typeof alertsApi.testAlert>(),
  onWorkspaceTab: vi.fn<typeof alertsApi.onWorkspaceTab>(),
}));
vi.mock('../services/cubes', () => ({
  readCubesStatus: vi.fn<typeof cubesApi.readCubesStatus>(),
  clearCubes: vi.fn<typeof cubesApi.clearCubes>(),
}));
/** Native's saved Explore choices, shared by every window, and its change listeners. */
const explore = vi.hoisted(() => ({
  state: null as unknown as FinderPreferences,
  listeners: new Set<(prefs: FinderPreferences) => void>(),
  save(patch: FinderPreferencesPatch) {
    this.state = { ...applyPatch(this.state, patch), revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  },
}));
vi.mock('../services/finderPreferences', () => ({
  nativeFinderBackend: {
    read: () => Promise.resolve(explore.state),
    update: (patch: FinderPreferencesPatch) => Promise.resolve(explore.save(patch)),
    subscribe: (handler: (prefs: FinderPreferences) => void) => {
      explore.listeners.add(handler);
      return Promise.resolve(() => explore.listeners.delete(handler));
    },
  },
}));
vi.mock('../services/activityWindows', () => ({
  readActivityWindowStatus: vi.fn<typeof activityApi.readActivityWindowStatus>(),
  markActivityWindowReady: vi.fn<typeof activityApi.markActivityWindowReady>(),
  showActivityWindow: vi.fn<typeof activityApi.showActivityWindow>(),
  hideActivityWindow: vi.fn<typeof activityApi.hideActivityWindow>(),
  lockActivityWindow: vi.fn<typeof activityApi.lockActivityWindow>(),
}));
// Only the status reads are replaced; every other offline command stays as it is.
vi.mock('../services/offline', async (original) => ({
  ...(await original<typeof offlineApi>()),
  readOfflineStatus: vi.fn<typeof offlineApi.readOfflineStatus>(),
  readOfflineLiveStatus: vi.fn<typeof offlineApi.readOfflineLiveStatus>(),
}));
vi.mock('../services/updates', async (original) => ({
  ...(await original<typeof updatesApi>()),
  readUpdateStatus: vi.fn<typeof updatesApi.readUpdateStatus>(),
  runUpdateAction: vi.fn<typeof updatesApi.runUpdateAction>(),
}));
vi.mock('../services/updateAccess', async (original) => ({
  ...(await original<typeof updateAccessApi>()),
  readUpdateAccessStatus: vi.fn<typeof updateAccessApi.readUpdateAccessStatus>(),
  runUpdateAccessAction: vi.fn<typeof updateAccessApi.runUpdateAccessAction>(),
}));
vi.mock('../services/setup', () => ({
  readSetupStatus: vi.fn<typeof setupApi.readSetupStatus>(),
  openSetupLink: vi.fn<typeof setupApi.openSetupLink>(),
}));
let openTab: (tab: string) => void = () => undefined;

const updateStatus = (phase: UpdatePhase): UpdateStatus => ({
  channel: 'stable',
  current_version: '0.7.7',
  latest_version: '0.7.8',
  phase,
  error: null,
  checked_ms: 1_760_000_000_000,
  release_url: null,
  notes: null,
  restart_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
});

/** A private copy whose GitHub CLI is installed but not signed in. */
const signedOut = {
  phase: 'checked' as const,
  cli_installed: true,
  authenticated: false,
  repository_access: null,
  checked_ms: 1_760_000_000_000,
  error: null,
  login_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
};

const hiddenOverlay = {
  locked: false,
  ready: true,
  visible: false,
  can_lock: true,
  saved_path: '',
  errors: [],
};

const recording: Recording = {
  schema_version: 1,
  source: 'Test recording',
  duration_ms: 1000,
  events: [
    { kind: 'damage', at_ms: 200, source: 'Scout', target: 'Boss', skill: 'Strike', amount: 3000 },
  ],
};
const snapshot = (time: number): Snapshot => ({
  at_ms: time,
  players: {},
  positions: {},
  counters: [],
  pets: [],
  gaps: [],
});

beforeEach(() => {
  const activity: Record<ActivityWindowKind, ActivityWindowStatus> = {
    timers: { ...INITIAL_ACTIVITY_WINDOW },
    explore: { ...INITIAL_ACTIVITY_WINDOW },
  };
  vi.mocked(activityApi.readActivityWindowStatus).mockImplementation((kind) =>
    Promise.resolve({ ...activity[kind] }),
  );
  vi.mocked(activityApi.showActivityWindow).mockImplementation((kind) =>
    Promise.resolve((activity[kind] = { ...activity[kind], requested: true, visible: true })),
  );
  vi.mocked(activityApi.hideActivityWindow).mockImplementation((kind) =>
    Promise.resolve((activity[kind] = { ...activity[kind], requested: false, visible: false })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(api.isNative).mockReturnValue(true);
  vi.mocked(offlineApi.readOfflineStatus).mockRejectedValue(new Error('offline engine offline'));
  vi.mocked(offlineApi.readOfflineLiveStatus).mockRejectedValue(
    new Error('offline engine offline'),
  );
  vi.mocked(alertsApi.readAlertsStatus).mockResolvedValue(dashboard({ now_ms: Date.now() }));
  vi.mocked(updatesApi.readUpdateStatus).mockRejectedValue(new Error('updates offline'));
  vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('ready'));
  vi.mocked(setupApi.openSetupLink).mockResolvedValue();
  vi.mocked(updateAccessApi.readUpdateAccessStatus).mockResolvedValue(signedOut);
  vi.mocked(updateAccessApi.runUpdateAccessAction).mockResolvedValue(signedOut);
  explore.state = DEFAULT_FINDER_PREFERENCES;
  explore.listeners.clear();
  vi.mocked(cubesApi.readCubesStatus).mockResolvedValue(cubesStatus());
  vi.mocked(cubesApi.clearCubes).mockResolvedValue(cubesStatus({ cubes: [] }));
  vi.mocked(alertsApi.onWorkspaceTab).mockImplementation((handler) => {
    openTab = handler;
    return Promise.resolve(() => undefined);
  });
  vi.mocked(api.loadRecording).mockResolvedValue(recording);
  vi.mocked(api.readSnapshot).mockImplementation((time) => Promise.resolve(snapshot(time)));
  vi.mocked(api.saveRecording).mockResolvedValue('recordings/test.json');
  vi.mocked(api.readOverlayStatus).mockResolvedValue(hiddenOverlay);
  vi.mocked(api.readLiveStatus).mockResolvedValue({
    running: false,
    phase: 'idle',
    message: 'Ready',
    duration_ms: 0,
    events: 0,
    players: [],
    stats: {},
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/*
 * Live and Replay stay mounted (hidden) on every tab, so their controls are driven in place
 * with `hidden: true`, without switching to their tab.
 */

/** Switches the workspace to another section, as a click on its tab. */
const goTo = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

async function loadApp() {
  render(<App />);
  const demo = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Load synthetic demo',
    hidden: true,
  });
  await waitFor(() => expect(demo.disabled).toBe(false));
  fireEvent.click(demo);
  await waitFor(() =>
    expect(
      screen.getByRole('status', { name: 'Recording status', hidden: true }).textContent,
    ).toContain('events loaded'),
  );
}

describe('React companion', () => {
  it.each<ActivityWindowKind>(['timers', 'explore'])(
    'shows and hides %s from the Home switch',
    async (kind) => {
      render(<App />);
      const label = { timers: 'Timers', explore: 'Explore' }[kind];
      const home = screen.getByRole<HTMLButtonElement>('switch', { name: label });
      await waitFor(() => expect(home.disabled).toBe(false));
      fireEvent.click(home);
      await waitFor(() => expect(activityApi.showActivityWindow).toHaveBeenCalledWith(kind));
      await waitFor(() => expect(home.getAttribute('aria-checked')).toBe('true'));
      fireEvent.click(home);
      await waitFor(() => expect(activityApi.hideActivityWindow).toHaveBeenCalledWith(kind));
      await waitFor(() => expect(home.getAttribute('aria-checked')).toBe('false'));
    },
  );
  it('opens on Home, which leads to the other sections', async () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab')[0]?.textContent).toBe('Home');
    expect(screen.getByRole('region', { name: 'Windows over the game' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Next up' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Live meter' }));
    expect(screen.getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe('true');
    // Home is not kept alive while hidden, so its polling stops with it.
    expect(screen.queryByRole('region', { name: 'Windows over the game' })).toBeNull();
    act(() => openTab('home'));
    expect(screen.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows a waiting update in the header from any tab and opens App updates', async () => {
    const scroll = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scroll;
    try {
      vi.mocked(updatesApi.readUpdateStatus).mockResolvedValue(updateStatus('current'));
      render(<App />);
      goTo('Settings');
      await waitFor(() => expect(screen.getByText('You have the latest version')).toBeTruthy());
      expect(screen.queryByRole('button', { name: /^Update/ })).toBeNull();
      // Native finds a release while another tab is shown; the header picks it up there.
      vi.mocked(updatesApi.readUpdateStatus).mockResolvedValue(updateStatus('available'));
      goTo('Logs');
      const pill = await screen.findByRole('button', { name: 'Update available v0.7.8' });
      fireEvent.click(pill);
      expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe(
        'true',
      );
      const section = document.getElementById('app-updates');
      expect(section).toBeTruthy();
      expect(document.activeElement).toBe(section);
      expect(scroll).toHaveBeenCalledWith({ block: 'start' });
      expect(screen.getByRole('button', { name: 'Download update' })).toBeTruthy();
      // Opening it never starts a step by itself.
      expect(updatesApi.runUpdateAction).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('guides a private copy to GitHub access, but never a copy the updater found public', async () => {
    // The setup probe says private in both cases; only the updater knows the releases.
    vi.mocked(updatesApi.readUpdateStatus).mockResolvedValue(updateStatus('error'));
    const { unmount } = render(<App />);
    goTo('Settings');
    expect(await screen.findByRole('region', { name: 'GitHub access for updates' })).toBeTruthy();
    await waitFor(() =>
      expect(updateAccessApi.runUpdateAccessAction).toHaveBeenCalledExactlyOnceWith('check'),
    );
    expect(screen.getByText('Not signed in')).toBeTruthy();
    unmount();
    vi.mocked(updateAccessApi.readUpdateAccessStatus).mockClear();
    vi.mocked(updateAccessApi.runUpdateAccessAction).mockClear();

    vi.mocked(updatesApi.readUpdateStatus).mockResolvedValue({
      ...updateStatus('current'),
      distribution: 'public',
    });
    render(<App />);
    goTo('Settings');
    await waitFor(() => expect(screen.getByText('You have the latest version')).toBeTruthy());
    expect(screen.getByText(/read from GitHub directly, with no sign-in/)).toBeTruthy();
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(screen.queryByRole('region', { name: 'GitHub access for updates' })).toBeNull();
    expect(screen.queryByText('GitHub CLI')).toBeNull();
    expect(screen.queryByText('gh auth login')).toBeNull();
    expect(updateAccessApi.readUpdateAccessStatus).not.toHaveBeenCalled();
    expect(updateAccessApi.runUpdateAccessAction).not.toHaveBeenCalled();
  });

  it('leads a missing capture driver from Home to Setup and probes again once capture connects', async () => {
    const scroll = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scroll;
    try {
      vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('missing'));
      render(<App />);
      const band = await screen.findByRole('region', { name: 'Live capture needs Npcap' });
      fireEvent.click(within(band).getByRole('button', { name: 'Get Npcap' }));
      await waitFor(() => expect(setupApi.openSetupLink).toHaveBeenCalledWith('npcap'));
      fireEvent.click(within(band).getByRole('button', { name: 'Setup details' }));
      expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe(
        'true',
      );
      const section = document.getElementById('app-setup');
      expect(document.activeElement).toBe(section);
      expect(scroll).toHaveBeenCalledWith({ block: 'start' });
      expect(within(section!).getByText('Not installed')).toBeTruthy();
      expect(setupApi.readSetupStatus).toHaveBeenCalledOnce();

      // Capture retries by itself; once it connects, the stale problem is probed again.
      vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('ready'));
      vi.mocked(api.readLiveStatus).mockResolvedValue({
        running: true,
        phase: 'capturing',
        message: 'Capturing',
        duration_ms: 0,
        events: 0,
        players: [],
        stats: {},
      });
      await waitFor(() => expect(setupApi.readSetupStatus).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(within(section!).queryByText('Not installed')).toBeNull());
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('probes the driver again when capture fails differently, so a stale problem masks nothing', async () => {
    const status = (phase: string, message: string) => ({
      running: phase !== 'error',
      phase,
      message,
      duration_ms: 0,
      events: 0,
      players: [],
      stats: {},
    });
    let current = status('error', 'Npcap could not load. Retrying automatically in 10 seconds.');
    vi.mocked(api.readLiveStatus).mockImplementation(() => Promise.resolve(current));
    vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('missing'));
    render(<App />);
    const line = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-home="capture"]');
      expect(found?.dataset.state).toBe('setup');
      return found!;
    });
    expect(within(line).getByText('Needs Npcap')).toBeTruthy();
    // Each retry repeats the same failure; that alone never probes again.
    await act(() => new Promise((done) => setTimeout(done, 1200)));
    expect(setupApi.readSetupStatus).toHaveBeenCalledOnce();

    // Npcap was installed meanwhile and capture now fails for another reason.
    vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('ready'));
    current = status(
      'error',
      'Windows TCP table failed (87). Retrying automatically in 10 seconds.',
    );
    await waitFor(() => expect(setupApi.readSetupStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(line.dataset.state).toBe('error'));
    expect(within(line).getByText(/Windows TCP table failed/)).toBeTruthy();
    expect(document.querySelector('[data-home="setup"]')).toBeNull();

    // Capture recovers and waits for the game; nothing is left over from the old problem.
    current = status('waiting_for_game', 'Waiting for AION2.exe');
    await waitFor(() => expect(line.dataset.state).toBe('waiting'));
    expect(within(line).getByText('Waiting for game')).toBeTruthy();
  });

  it('probes again once capture waits for the game, so a stale missing driver clears', async () => {
    let current = {
      running: false,
      phase: 'error',
      message: 'Npcap could not load. Retrying automatically in 10 seconds.',
      duration_ms: 0,
      events: 0,
      players: [],
      stats: {},
    };
    vi.mocked(api.readLiveStatus).mockImplementation(() => Promise.resolve(current));
    vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('missing'));
    render(<App />);
    await screen.findByRole('region', { name: 'Live capture needs Npcap' });
    vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('ready'));
    current = { ...current, running: true, phase: 'waiting_for_game', message: 'Waiting' };
    await waitFor(() => expect(setupApi.readSetupStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('[data-home="setup"]')).toBeNull());
    const line = document.querySelector<HTMLElement>('[data-home="capture"]')!;
    expect(line.dataset.state).toBe('waiting');
    expect(within(line).getByText('Waiting for game')).toBeTruthy();
  });

  it('shows a different capture error when the probe that would confirm the old problem fails', async () => {
    let current = {
      running: false,
      phase: 'error',
      message: 'Npcap could not load. Retrying automatically in 10 seconds.',
      duration_ms: 0,
      events: 0,
      players: [],
      stats: {},
    };
    vi.mocked(api.readLiveStatus).mockImplementation(() => Promise.resolve(current));
    vi.mocked(setupApi.readSetupStatus).mockResolvedValue(setupStatus('missing'));
    render(<App />);
    const line = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-home="capture"]');
      expect(found?.dataset.state).toBe('setup');
      return found!;
    });
    // The recheck fails, so the earlier "missing" is kept but no longer confirmed.
    vi.mocked(setupApi.readSetupStatus).mockRejectedValue(new Error('probe failed'));
    current = { ...current, message: 'Windows TCP table failed (87). Retrying automatically.' };
    await waitFor(() => expect(setupApi.readSetupStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(line.dataset.state).toBe('error'));
    expect(within(line).getByText('Capture error')).toBeTruthy();
    expect(within(line).getByText(/Windows TCP table failed/)).toBeTruthy();
  });

  it('has an Alerts tab that another window can open', async () => {
    render(<App />);
    await waitFor(() => expect(alertsApi.onWorkspaceTab).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Trackers' })).toBeTruthy();
    act(() => openTab('alerts'));
    expect(screen.getByRole('tab', { name: 'Alerts' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Events & bosses' })).toBeTruthy(),
    );
    act(() => openTab('not-a-tab'));
    expect(screen.getByRole('tab', { name: 'Alerts' }).getAttribute('aria-selected')).toBe('true');
  });

  it('has one Explore tab for every finder, opened by its earlier names too', async () => {
    window.history.replaceState(null, '', '/?tab=gathering');
    try {
      render(<App />);
      const tab = screen.getByRole('tab', { name: 'Explore' });
      expect(tab.getAttribute('aria-selected')).toBe('true');
      for (const name of ['Maps', 'Cubes', 'Gathering'])
        expect(screen.queryByRole('tab', { name })).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Explore' })).toBeTruthy();
      // One switch for the one in-game window; none per finder.
      expect(screen.getByRole('switch', { name: 'Explore over the game' })).toBeTruthy();
      expect(screen.queryByRole('switch', { name: /Cubes over|Gathering over/ })).toBeNull();
      // One read serves the whole map: the cube status carries the shared context.
      await waitFor(() => expect(cubesApi.readCubesStatus).toHaveBeenCalled());
      const gathering = () => screen.getByRole('checkbox', { name: /^Gathering/ });
      await waitFor(() => expect(gathering().getAttribute('aria-checked')).toBe('true'));
      fireEvent.click(gathering());
      expect(gathering().getAttribute('aria-checked')).toBe('false');
      await waitFor(() => expect(explore.state.visibility.gathering).toBe(false));
      // Shown again later, the tab starts from the saved choices, not from defaults.
      goTo('Home');
      expect(screen.queryByRole('checkbox', { name: /^Gathering/ })).toBeNull();
      goTo('Explore');
      expect(gathering().getAttribute('aria-checked')).toBe('false');
      // Another window (the in-game Explore) changing a choice is followed here.
      act(() => void explore.save({ visibility: { cubes: false } }));
      await waitFor(() =>
        expect(
          screen.getByRole('checkbox', { name: /^Hidden cubes/ }).getAttribute('aria-checked'),
        ).toBe('false'),
      );
      // Another window asking for an old tab shows its layer again, and saves it.
      act(() => openTab('home'));
      act(() => openTab('gathering'));
      expect(tab.getAttribute('aria-selected')).toBe('true');
      await waitFor(() => expect(gathering().getAttribute('aria-checked')).toBe('true'));
      expect(explore.state.visibility.gathering).toBe(true);
      act(() => openTab('home'));
      act(() => openTab('maps'));
      expect(tab.getAttribute('aria-selected')).toBe('true');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  }, 15_000);

  it('provides an explicit app exit and reports shutdown failures', async () => {
    vi.mocked(api.quitOverlay).mockRejectedValue(new Error('Could not save before quitting'));
    await loadApp();
    fireEvent.click(screen.getByRole('button', { name: 'Quit Aion Companion' }));
    await waitFor(() => expect(api.quitOverlay).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Recording status', hidden: true }).textContent,
      ).toContain('Could not save before quitting'),
    );
  });

  it('shows and hides the DPS meter from Home based on its actual state', async () => {
    vi.mocked(api.showDpsOverlay).mockResolvedValue({ ...hiddenOverlay, visible: true });
    vi.mocked(api.hideDpsOverlay).mockImplementation(() => {
      vi.mocked(api.readOverlayStatus).mockResolvedValue(hiddenOverlay);
      return Promise.resolve();
    });
    await loadApp();
    const toggle = () => screen.getByRole<HTMLButtonElement>('switch', { name: 'DPS meter' });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(api.markOverlayReady).not.toHaveBeenCalled();
    vi.mocked(api.readOverlayStatus).mockResolvedValue({ ...hiddenOverlay, visible: true });
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    expect(api.showDpsOverlay).toHaveBeenCalledOnce();
    await waitFor(() => expect(toggle().disabled).toBe(false));
    fireEvent.click(toggle());
    await waitFor(() => expect(api.hideDpsOverlay).toHaveBeenCalledOnce());
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
  });

  it('flags a click-through DPS meter in the header', async () => {
    vi.mocked(api.readOverlayStatus).mockResolvedValue({
      ...hiddenOverlay,
      visible: true,
      locked: true,
    });
    await loadApp();
    await waitFor(() =>
      expect(
        screen.getByTitle('Click-through: the DPS meter ignores the mouse until unlocked')
          .textContent,
      ).toContain('Click-through'),
    );
  });

  it('starts without opening a recording until a native source is chosen', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Load synthetic demo', hidden: true })
          .disabled,
      ).toBe(false),
    );
    expect(api.loadRecording).not.toHaveBeenCalled();
    expect(
      screen.getByRole('status', { name: 'Recording status', hidden: true }).textContent,
    ).toContain('No recording open');
  });

  it('loads the demo, seeks and saves the recording locally', async () => {
    await loadApp();
    expect(api.loadRecording).toHaveBeenCalledWith({ kind: 'demo' });
    fireEvent.change(screen.getByLabelText('Replay time'), { target: { value: '500' } });
    await waitFor(() => expect(api.readSnapshot).toHaveBeenLastCalledWith(500));
    await waitFor(() => expect(screen.getByText('0.5 s')).toBeTruthy());
    fireEvent.click(screen.getByText('Save recording locally'));
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Recording status', hidden: true }).textContent,
      ).toContain('recordings/test.json'),
    );
  });

  it('reads one snapshot at a time and ends on the newest position', async () => {
    await loadApp();
    let resolveOld: (value: Snapshot) => void = () => {
      throw new Error('Snapshot request was not started');
    };
    vi.mocked(api.readSnapshot).mockImplementation((time) =>
      time === 100
        ? new Promise<Snapshot>((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(snapshot(time)),
    );
    fireEvent.change(screen.getByLabelText('Replay time'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Replay time'), { target: { value: '800' } });
    // The newer position is read once the slow one answered, so it is always shown last.
    expect(api.readSnapshot).toHaveBeenLastCalledWith(100);
    await act(async () => {
      resolveOld(snapshot(100));
    });
    await waitFor(() => expect(screen.getByText('0.8 s')).toBeTruthy());
    expect(api.readSnapshot).toHaveBeenLastCalledWith(800);
  });

  it('stops playback at the end and clears timers on unmount', async () => {
    await loadApp();
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('Play'));
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText('Play')).toBeTruthy();
    expect(screen.getByText('1.0 s')).toBeTruthy();
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('imports JSON and reports oversized file errors', async () => {
    await loadApp();
    const input = screen.getByLabelText('Import replay');
    const file = new File(['{"schema_version":1}'], 'fight.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('{"schema_version":1}') });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.loadRecording).toHaveBeenCalledWith({
        kind: 'import',
        json: '{"schema_version":1}',
      }),
    );
    const oversized = new File([], 'large.json');
    Object.defineProperty(oversized, 'size', { value: 129 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [oversized] } });
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Recording status', hidden: true }).textContent,
      ).toContain('exceeds 128 MiB'),
    );
  });

  it('renders a browser preview without making native calls', () => {
    vi.mocked(api.isNative).mockReturnValue(false);
    render(<App />);
    expect(
      screen.getByRole('status', { name: 'Recording status', hidden: true }).textContent,
    ).toContain('UI preview only');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Load synthetic demo', hidden: true })
        .disabled,
    ).toBe(true);
    expect(api.loadRecording).not.toHaveBeenCalled();
    expect(api.readLiveStatus).not.toHaveBeenCalled();
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reset live totals', hidden: true })
        .disabled,
    ).toBe(true);
  });

  it('collects in the background without capture controls and opens an ended fight', async () => {
    const live = {
      running: true,
      phase: 'capturing',
      message: 'Independent capture active',
      duration_ms: 2000,
      events: 2,
      stats: { packets: 10 },
      encounter_ended: false,
      players: [
        {
          entity: 42,
          label: 'Ranger #42',
          damage: 4000,
          dps: 2000,
          current_dps: 800,
          share: 1,
          direct_hits: 2,
          critical_hits: 1,
          ticks: 0,
          skills: { 'Skill #14000100': 4000 },
        },
      ],
    };
    vi.mocked(api.readLiveStatus).mockResolvedValue(live);
    await loadApp();
    goTo('Live');
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Ranger #42' })).toBeTruthy());
    expect(screen.getByText('Capturing')).toBeTruthy();
    expect(screen.getByText('50.0%')).toBeTruthy();
    for (const name of [/start/i, /stop/i, /pause/i])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByLabelText(/server port/i)).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Open live recording' }).disabled,
    ).toBe(true);
    // The fight ends on its own; capture keeps running.
    vi.mocked(api.readLiveStatus).mockResolvedValue({ ...live, encounter_ended: true });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Open live recording' }).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByText('Open live recording'));
    await waitFor(() => expect(api.loadRecording).toHaveBeenLastCalledWith({ kind: 'live' }));
  });

  it('reports waiting and background capture failures honestly', async () => {
    vi.mocked(api.readLiveStatus).mockResolvedValue({
      running: true,
      phase: 'waiting_for_game',
      message: 'Waiting for the game connection.',
      duration_ms: 0,
      events: 0,
      players: [],
      stats: {},
    });
    render(<App />);
    goTo('Live');
    await waitFor(() => expect(screen.getByText('Waiting for game')).toBeTruthy());
    vi.mocked(api.readLiveStatus).mockResolvedValue({
      running: false,
      phase: 'error',
      message: 'Npcap unavailable',
      duration_ms: 0,
      events: 0,
      players: [],
      stats: {},
    });
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Live capture status', hidden: true }).textContent,
      ).toBe('Npcap unavailable'),
    );
    expect(screen.getByText('Capture error')).toBeTruthy();
  });

  it('configures PvE fights, opens an archived encounter and saves comparison data while capturing', async () => {
    const live = {
      running: true,
      phase: 'capturing',
      message: 'Collecting',
      duration_ms: 2000,
      events: 2,
      players: [],
      stats: {},
      roster_seen: true,
      party_only: false,
      auto_end: true,
      history: [{ id: 3, duration_ms: 2000, events: 2 }],
    };
    // Like the backend, keep the configured options so later status polls report them.
    let current = live;
    vi.mocked(api.readLiveStatus).mockImplementation(() => Promise.resolve(current));
    vi.mocked(api.configureLive).mockImplementation((autoEnd, partyOnly) => {
      current = { ...current, auto_end: autoEnd, party_only: partyOnly };
      return Promise.resolve(current);
    });
    vi.mocked(api.saveLiveComparison).mockResolvedValue('comparisons/test.comparison.json');
    await loadApp();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'End fights after 10s without damage', hidden: true }),
    );
    await waitFor(() => expect(api.configureLive).toHaveBeenLastCalledWith(false, false));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Save comparison report',
          hidden: true,
        }).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Confirmed party / self only', hidden: true }),
    );
    await waitFor(() => expect(api.configureLive).toHaveBeenLastCalledWith(false, true));
    fireEvent.click(screen.getByText('Completed fights (1)'));
    fireEvent.click(screen.getByText('Replay encounter 3 · 2.0s'));
    await waitFor(() =>
      expect(api.loadRecording).toHaveBeenLastCalledWith({ kind: 'live', id: 3 }),
    );
    fireEvent.click(screen.getByText('Save comparison report'));
    await waitFor(() =>
      expect(
        screen.getByText('Comparison report saved to comparisons/test.comparison.json'),
      ).toBeTruthy(),
    );
  });

  it('ignores a status poll that was issued before resetting the fight', async () => {
    vi.useFakeTimers();
    const fighting = {
      running: true,
      phase: 'capturing',
      message: 'Collecting',
      duration_ms: 4000,
      events: 3,
      players: [],
      stats: {},
    };
    vi.mocked(api.readLiveStatus).mockResolvedValue(fighting);
    render(<App />);
    await act(async () => {});
    let resolveOld: (value: Awaited<ReturnType<typeof api.readLiveStatus>>) => void = () => {
      throw new Error('No poll pending');
    };
    vi.mocked(api.readLiveStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    vi.mocked(api.resetLive).mockResolvedValue({
      ...fighting,
      message: 'New fight',
      duration_ms: 0,
      events: 0,
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Reset live totals'));
    });
    await act(async () => {
      resolveOld({ ...fighting, message: 'Old status' });
    });
    expect(api.resetLive).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('status', { name: 'Live capture status', hidden: true }).textContent,
    ).toBe('New fight');
  });

  it('polls the compact live status and reads report details only on the Live tab', async () => {
    const envelope = {
      settings: SETTINGS_FALLBACK,
      library_count: 0,
      trackers: [],
      alerts: [],
      catalogue: null,
      capabilities: {},
      error: null,
    };
    vi.mocked(offlineApi.readOfflineLiveStatus).mockResolvedValue({
      ...envelope,
      report: reportSummary(),
    });
    const full = deferred<OfflineStatus>();
    vi.mocked(offlineApi.readOfflineStatus).mockReturnValue(full.promise);
    render(<App />);
    for (const tab of ['Home', 'Logs', 'Compare', 'Trackers', 'Settings']) {
      goTo(tab);
      await waitFor(() => expect(offlineApi.readOfflineLiveStatus).toHaveBeenCalled());
    }
    expect(offlineApi.readOfflineStatus).not.toHaveBeenCalled();

    goTo('Live');
    await waitFor(() => expect(offlineApi.readOfflineStatus).toHaveBeenCalled());
    // The summary already polled is never drawn as a fight without events or buffs.
    expect(screen.getByText('Loading the full breakdown…')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Timeline' })).toBeNull();
    await act(async () => {
      full.resolve({ ...envelope, report: report() });
      await full.promise;
    });
    expect(await screen.findByRole('tab', { name: 'Timeline' })).toBeTruthy();

    goTo('Home');
    const calls = vi.mocked(offlineApi.readOfflineStatus).mock.calls.length;
    const compact = vi.mocked(offlineApi.readOfflineLiveStatus).mock.calls.length;
    await waitFor(() =>
      expect(vi.mocked(offlineApi.readOfflineLiveStatus).mock.calls.length).toBeGreaterThan(
        compact,
      ),
    );
    expect(offlineApi.readOfflineStatus).toHaveBeenCalledTimes(calls);
  });

  it('reads nothing while the workspace is minimised and catches up when it shows', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const setVisibility = (next: DocumentVisibilityState) =>
      act(async () => {
        visibility = next;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    const reads = () => [
      vi.mocked(api.readLiveStatus).mock.calls.length,
      vi.mocked(api.readOverlayStatus).mock.calls.length,
      vi.mocked(alertsApi.readAlertsStatus).mock.calls.length,
      vi.mocked(activityApi.readActivityWindowStatus).mock.calls.length,
    ];
    render(<App />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(reads().every((n) => n > 0)).toBe(true);

    await setVisibility('hidden');
    const hidden = reads();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(reads()).toEqual(hidden);

    await setVisibility('visible');
    expect(reads().every((n, i) => n > hidden[i]!)).toBe(true);
  });
});
