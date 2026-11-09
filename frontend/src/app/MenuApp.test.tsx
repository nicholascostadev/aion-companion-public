import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../features/alerts/fixtures';
import * as alertsApi from '../services/alerts';
import * as api from '../services/companion';
import * as petsApi from '../services/pets';
import * as activityApi from '../services/activityWindows';
import {
  INITIAL_ACTIVITY_WINDOW,
  type ActivityWindowKind,
  type ActivityWindowStatus,
} from '../types/activityWindows';
import type { PetWindowStatus } from '../types/pets';
import { liveStatus } from '../test/companionStatus';
import type { OverlayStatus } from '../types/companion';
import MenuApp from './MenuApp';

vi.mock('../services/companion', () => ({
  isNative: vi.fn<typeof api.isNative>(),
  readLiveStatus: vi.fn<typeof api.readLiveStatus>(),
  readOverlayStatus: vi.fn<typeof api.readOverlayStatus>(),
  markMenuReady: vi.fn<typeof api.markMenuReady>(),
  fitMenu: vi.fn<typeof api.fitMenu>(),
  markOverlayReady: vi.fn<typeof api.markOverlayReady>(),
  showDpsOverlay: vi.fn<typeof api.showDpsOverlay>(),
  hideDpsOverlay: vi.fn<typeof api.hideDpsOverlay>(),
  lockDpsOverlay: vi.fn<typeof api.lockDpsOverlay>(),
  openWorkspace: vi.fn<typeof api.openWorkspace>(),
  quitOverlay: vi.fn<typeof api.quitOverlay>(),
}));

vi.mock('../services/pets', () => ({
  readPetWindowStatus: vi.fn<typeof petsApi.readPetWindowStatus>(),
  markPetWindowReady: vi.fn<typeof petsApi.markPetWindowReady>(),
  showPetWindow: vi.fn<typeof petsApi.showPetWindow>(),
  hidePetWindow: vi.fn<typeof petsApi.hidePetWindow>(),
  lockPetWindow: vi.fn<typeof petsApi.lockPetWindow>(),
}));

vi.mock('../services/activityWindows', () => ({
  readActivityWindowStatus: vi.fn<typeof activityApi.readActivityWindowStatus>(),
  markActivityWindowReady: vi.fn<typeof activityApi.markActivityWindowReady>(),
  showActivityWindow: vi.fn<typeof activityApi.showActivityWindow>(),
  hideActivityWindow: vi.fn<typeof activityApi.hideActivityWindow>(),
  lockActivityWindow: vi.fn<typeof activityApi.lockActivityWindow>(),
}));

vi.mock('../services/alerts', () => ({
  readAlertsStatus: vi.fn<typeof alertsApi.readAlertsStatus>(),
  configureAlerts: vi.fn<typeof alertsApi.configureAlerts>(),
  runAlertAction: vi.fn<typeof alertsApi.runAlertAction>(),
  testAlert: vi.fn<typeof alertsApi.testAlert>(),
  requestWorkspaceTab: vi.fn<typeof alertsApi.requestWorkspaceTab>(),
}));

const base: OverlayStatus = {
  locked: false,
  ready: true,
  visible: false,
  can_lock: true,
  saved_path: '',
  errors: [],
  menu_ready: true,
  menu_visible: true,
};
let backend: OverlayStatus;
let petWindow: PetWindowStatus;

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
    Promise.resolve(
      (activity[kind] = {
        ...activity[kind],
        requested: false,
        visible: false,
      }),
    ),
  );
  backend = { ...base };
  petWindow = {
    requested: false,
    visible: false,
    ready: false,
    locked: true,
    game_active: true,
    errors: [],
  };
  vi.mocked(petsApi.readPetWindowStatus).mockImplementation(() =>
    Promise.resolve({ ...petWindow }),
  );
  vi.mocked(petsApi.showPetWindow).mockImplementation(() => {
    petWindow = { ...petWindow, requested: true, visible: true };
    return Promise.resolve({ ...petWindow });
  });
  vi.mocked(petsApi.hidePetWindow).mockImplementation(() => {
    petWindow = { ...petWindow, requested: false, visible: false };
    return Promise.resolve({ ...petWindow });
  });
  vi.mocked(api.isNative).mockReturnValue(true);
  vi.mocked(alertsApi.readAlertsStatus).mockResolvedValue(dashboard({ now_ms: Date.now() }));
  vi.mocked(alertsApi.requestWorkspaceTab).mockResolvedValue();
  vi.mocked(api.markMenuReady).mockResolvedValue();
  vi.mocked(api.readOverlayStatus).mockImplementation(() => Promise.resolve({ ...backend }));
  vi.mocked(api.readLiveStatus).mockResolvedValue(
    liveStatus({
      running: true,
      phase: 'capturing',
      message: 'Collecting',
      duration_ms: 83_000,
      events: 3,
    }),
  );
  vi.mocked(api.showDpsOverlay).mockImplementation(() => {
    backend = { ...backend, visible: true, requested_visible: true };
    return Promise.resolve({ ...backend });
  });
  vi.mocked(api.hideDpsOverlay).mockImplementation(() => {
    backend = { ...backend, visible: false, requested_visible: false };
    return Promise.resolve();
  });
  vi.mocked(api.lockDpsOverlay).mockImplementation((locked) => {
    backend = { ...backend, locked };
    return Promise.resolve({ ...backend });
  });
  vi.mocked(api.openWorkspace).mockResolvedValue();
  vi.mocked(api.quitOverlay).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

const toggle = () => screen.getByRole<HTMLButtonElement>('button', { name: 'DPS meter' });
async function ready(checked: boolean) {
  await waitFor(() => expect(toggle().getAttribute('aria-pressed')).toBe(String(checked)));
  await waitFor(() => expect(toggle().disabled).toBe(false));
}

describe('Top menu', () => {
  it.each<ActivityWindowKind>(['timers', 'explore'])(
    'toggles %s through the shared native controller',
    async (kind) => {
      render(<MenuApp />);
      const label = { timers: 'Timers', explore: 'Explore' }[kind];
      const button = screen.getByRole<HTMLButtonElement>('button', {
        name: label,
      });
      await waitFor(() => expect(button.disabled).toBe(false));
      expect(button.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(button);
      await waitFor(() => expect(activityApi.showActivityWindow).toHaveBeenCalledWith(kind));
      await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
      fireEvent.click(button);
      await waitFor(() => expect(activityApi.hideActivityWindow).toHaveBeenCalledWith(kind));
      await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    },
  );
  it('offers one Explore button for the map finders, never one per finder', async () => {
    render(<MenuApp />);
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Explore' }).disabled).toBe(
        false,
      ),
    );
    for (const name of [/cube/i, /gathering/i, /^Maps$/])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(activityApi.readActivityWindowStatus).not.toHaveBeenCalledWith('cubes');
    expect(activityApi.readActivityWindowStatus).not.toHaveBeenCalledWith('gathering');
  });
  it('shows and hides the pet radar from the paw button without touching other panels', async () => {
    render(<MenuApp />);
    await ready(false);
    const paw = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Pet radar',
    });
    await waitFor(() => expect(paw.disabled).toBe(false));
    expect(paw.getAttribute('aria-pressed')).toBe('false');
    expect(paw.querySelector('svg')).toBeTruthy();
    fireEvent.click(paw);
    await waitFor(() => expect(paw.getAttribute('aria-pressed')).toBe('true'));
    expect(petsApi.showPetWindow).toHaveBeenCalledOnce();
    // The menu never reports the radar ready; only the radar window does.
    expect(petsApi.markPetWindowReady).not.toHaveBeenCalled();
    await waitFor(() => expect(paw.disabled).toBe(false));
    fireEvent.click(paw);
    await waitFor(() => expect(paw.getAttribute('aria-pressed')).toBe('false'));
    expect(petsApi.hidePetWindow).toHaveBeenCalledOnce();
    expect(api.showDpsOverlay).not.toHaveBeenCalled();
  });

  it('follows a radar closed from its own window', async () => {
    vi.useFakeTimers();
    petWindow = { ...petWindow, requested: true, visible: true };
    render(<MenuApp />);
    const paw = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Pet radar',
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(paw.getAttribute('aria-pressed')).toBe('true');
    petWindow = { ...petWindow, requested: false, visible: false };
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(paw.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the Alerts workspace from the bell and reflects ringing alerts', async () => {
    const d = dashboard({ now_ms: Date.now() });
    vi.mocked(alertsApi.readAlertsStatus).mockResolvedValue({
      ...d,
      active: [
        {
          id: 'r1:1',
          rule_id: 'r1',
          name: 'Shugo Festival',
          category: 'event',
          due_ms: Date.now(),
          fired_ms: Date.now(),
          lead_seconds: 0,
          phase: 'start',
          sound: 'chime',
          volume: 0.8,
          popup: true,
          status: 'delivered',
        },
      ],
    });
    render(<MenuApp />);
    const bell = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Alerts (1 ringing)',
    });
    await waitFor(() => expect(bell.disabled).toBe(false));
    fireEvent.click(bell);
    await waitFor(() => expect(api.openWorkspace).toHaveBeenCalledOnce());
    expect(alertsApi.requestWorkspaceTab).toHaveBeenCalledWith('alerts');
    expect(vi.mocked(alertsApi.requestWorkspaceTab).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.openWorkspace).mock.invocationCallOrder[0]!,
    );
  });

  it('shows a silenced bell while alerts are muted', async () => {
    const d = dashboard({ now_ms: Date.now() });
    vi.mocked(alertsApi.readAlertsStatus).mockResolvedValue({
      ...d,
      config: { ...d.config, muted_until_ms: Date.now() + 600_000 },
    });
    render(<MenuApp />);
    expect(await screen.findByRole('button', { name: 'Alerts (muted)' })).toBeTruthy();
  });

  it('toggles saved visibility choices while focus temporarily hides the windows', async () => {
    backend = {
      ...backend,
      visible: false,
      requested_visible: true,
      focus_suppressed: true,
    };
    render(<MenuApp />);
    await ready(true);
    fireEvent.click(toggle());
    await waitFor(() => expect(api.hideDpsOverlay).toHaveBeenCalledOnce());
    await ready(false);
    expect(api.showDpsOverlay).not.toHaveBeenCalled();
  });
  it('reports menu readiness only and shows brand, capture state and actions', async () => {
    render(<MenuApp />);
    await ready(false);
    expect(api.markMenuReady).toHaveBeenCalledOnce();
    expect(api.markOverlayReady).not.toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: 'Aion Companion menu' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(toggle().querySelector('svg')).toBeTruthy();
    expect(toggle().title).toBe('Show the DPS meter · Ctrl+Shift+F9');
    // Group is part of the DPS meter now, not a toolbar window of its own.
    expect(screen.queryByRole('button', { name: /group/i })).toBeNull();
    await waitFor(() => expect(screen.getByText('1:23')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quit Aion Companion' })).toBeTruthy();
  });

  // The toolbar as laid out mid-fold: the pill is everything around the drawer plus the
  // drawer's animated width, and the drawn actions keep their full width inside it.
  const AROUND = 62;
  const ACTIONS = 446;
  function layout() {
    const fold = { drawer: ACTIONS, resized: () => {} };
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly changed: () => void) {}
        observe() {
          observers.push(this.changed);
          this.changed();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const drawer = this.id !== '' && document.querySelector(`[aria-controls="${this.id}"]`);
      const width = drawer
        ? fold.drawer
        : this.parentElement?.hasAttribute('id') && this.parentElement.matches('nav > div')
          ? this.childElementCount && ACTIONS
          : this.firstElementChild?.tagName === 'NAV'
            ? AROUND + fold.drawer
            : 0;
      return { width } as DOMRect;
    });
    fold.resized = () => {
      for (const changed of observers) changed();
    };
    vi.mocked(api.fitMenu).mockResolvedValue();
    localStorage.clear();
    return fold;
  }
  const arrow = () =>
    screen.getByRole('button', {
      name: /^(Collapse to the logo|Expand the menu)$/,
    });

  it('folds to the logo and back, remembering the choice and fitting the window', async () => {
    const fold = layout();
    const first = render(<MenuApp />);
    await ready(false);
    expect(api.fitMenu).toHaveBeenLastCalledWith(AROUND + ACTIONS);
    const way = arrow();
    expect(way.getAttribute('aria-label')).toBe('Collapse to the logo');
    expect(way.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(way);
    // The same arrow turns, so focus stays on it; the fading actions can no longer be reached.
    expect(arrow()).toBe(way);
    expect(way.getAttribute('aria-label')).toBe('Expand the menu');
    expect(way.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.getByRole('button', { name: 'Quit Aion Companion' }).closest('[inert]'),
    ).toBeTruthy();
    // Each frame of the fold keeps the window as it is: one native fit, after it settles.
    const fits = vi.mocked(api.fitMenu).mock.calls.length;
    fold.drawer = 200;
    fold.resized();
    expect(api.fitMenu).toHaveBeenCalledTimes(fits);
    fold.drawer = 0;
    await waitFor(() => expect(api.fitMenu).toHaveBeenLastCalledWith(AROUND));
    expect(api.fitMenu).toHaveBeenCalledTimes(fits + 1);
    // Only the logo and the way back stay; the wordmark and every action are out of the hit area.
    expect(screen.queryByRole('button', { name: 'DPS meter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quit Aion Companion' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Menu status' })).toBeNull();
    expect(screen.queryByText('Companion')).toBeNull();
    expect(screen.getByTitle('Drag to move').querySelector('svg')).toBeTruthy();
    first.unmount();

    render(<MenuApp />);
    expect(screen.queryByText('Companion')).toBeNull();
    expect(arrow().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(arrow());
    // The window widens before the toolbar grows into it.
    expect(api.fitMenu).toHaveBeenLastCalledWith(AROUND + ACTIONS);
    await ready(false);
    expect(screen.getByText('Companion')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Quit Aion Companion' }).closest('[inert]'),
    ).toBeNull();
    expect(localStorage.getItem('aion-companion.menu.collapsed')).toBe('0');
  });

  it('keeps the window wide through rapid folds and settles once on the final width', async () => {
    const fold = layout();
    render(<MenuApp />);
    await ready(false);
    const fits = vi.mocked(api.fitMenu).mock.calls.length;
    for (const drawer of [300, 120, 260]) {
      fireEvent.click(arrow());
      fold.drawer = drawer;
      fold.resized();
    }
    expect(api.fitMenu).toHaveBeenCalledTimes(fits);
    fold.drawer = 0;
    await waitFor(() => expect(api.fitMenu).toHaveBeenLastCalledWith(AROUND));
    expect(api.fitMenu).toHaveBeenCalledTimes(fits + 1);
    expect(localStorage.getItem('aion-companion.menu.collapsed')).toBe('1');
  });

  it('folds at once when the system asks for reduced motion', () => {
    const fold = layout();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    render(<MenuApp />);
    fold.drawer = 0;
    fireEvent.click(arrow());
    expect(api.fitMenu).toHaveBeenLastCalledWith(AROUND);
    expect(screen.queryByRole('button', { name: 'Quit Aion Companion' })).toBeNull();
  });

  it('shows and hides only the DPS meter, following backend visibility', async () => {
    render(<MenuApp />);
    await ready(false);
    fireEvent.click(toggle());
    await ready(true);
    expect(api.showDpsOverlay).toHaveBeenCalledOnce();
    expect(toggle().title).toBe('Hide the DPS meter · Ctrl+Shift+F9');
    fireEvent.click(toggle());
    await ready(false);
    expect(api.hideDpsOverlay).toHaveBeenCalledOnce();
    expect(api.quitOverlay).not.toHaveBeenCalled();
  });

  it('picks up visibility changes made by hotkeys or the tray', async () => {
    vi.useFakeTimers();
    render(<MenuApp />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().disabled).toBe(false);
    backend = { ...backend, visible: true };
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggle().disabled).toBe(false);
    expect(toggle().title).toBe('Hide the DPS meter · Ctrl+Shift+F9');
    backend = { ...backend, visible: false };
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().disabled).toBe(false);
    expect(api.showDpsOverlay).not.toHaveBeenCalled();
  });

  it('ignores rapid repeated clicks while a toggle is in flight', async () => {
    let finish: (state: OverlayStatus) => void = () => {
      throw new Error('Show was not requested');
    };
    vi.mocked(api.showDpsOverlay).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<MenuApp />);
    await ready(false);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-busy')).toBe('true');
    expect(api.showDpsOverlay).toHaveBeenCalledOnce();
    expect(api.hideDpsOverlay).not.toHaveBeenCalled();
    backend = { ...backend, visible: true };
    await act(async () => finish({ ...backend }));
    await ready(true);
  });

  it('names background capture states instead of offering a start', async () => {
    const waiting = liveStatus({
      running: true,
      phase: 'waiting_for_game',
      message: 'Waiting for the game connection.',
      duration_ms: 0,
      events: 0,
    });
    vi.mocked(api.readLiveStatus).mockResolvedValue(waiting);
    render(<MenuApp />);
    const status = () => screen.getByRole('status', { name: 'Menu status' });
    await waitFor(() => expect(status().textContent).toBe('Waiting for game'));
    vi.mocked(api.readLiveStatus).mockResolvedValue({
      ...waiting,
      running: false,
      phase: 'error',
      message: 'Npcap unavailable',
    });
    await waitFor(() => expect(status().textContent).toContain('Npcap unavailable'));
    expect(screen.queryByRole('button', { name: /start|stop/i })).toBeNull();
  });

  it('reports failures and resyncs to the actual window state', async () => {
    vi.mocked(api.showDpsOverlay).mockRejectedValue('Overlay window failed');
    render(<MenuApp />);
    await ready(false);
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Menu status' }).textContent).toContain(
        'Overlay window failed',
      ),
    );
    await ready(false);
  });

  it('can unlock a click-through DPS meter', async () => {
    backend = { ...backend, visible: true, locked: true };
    render(<MenuApp />);
    await ready(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock DPS meter' }));
    await waitFor(() => expect(api.lockDpsOverlay).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lock DPS meter (click-through)' })).toBeTruthy(),
    );
  });

  it('disables locking while hidden or without the unlock hotkey', async () => {
    backend = { ...backend, visible: true, can_lock: false };
    render(<MenuApp />);
    await ready(true);
    const lock = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Lock DPS meter (click-through)',
    });
    expect(lock.disabled).toBe(true);
  });

  it('opens the workspace and quits with one click', async () => {
    render(<MenuApp />);
    await ready(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    await waitFor(() => expect(api.openWorkspace).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Quit Aion Companion' }));
    await waitFor(() => expect(api.quitOverlay).toHaveBeenCalledOnce());
  });

  it('preserves the native lock state when showing a hidden meter', async () => {
    backend = { ...backend, locked: true };
    render(<MenuApp />);
    await ready(false);
    fireEvent.click(toggle());
    await ready(true);
    expect(screen.getByRole('button', { name: 'Unlock DPS meter' })).toBeTruthy();
    expect(api.lockDpsOverlay).not.toHaveBeenCalled();
  });

  it('renders a disabled preview outside the native app', () => {
    vi.mocked(api.isNative).mockReturnValue(false);
    render(<MenuApp />);
    expect(toggle().disabled).toBe(true);
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(api.readOverlayStatus).not.toHaveBeenCalled();
    expect(api.markMenuReady).not.toHaveBeenCalled();
  });
});
