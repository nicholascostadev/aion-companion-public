import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import * as companion from '../services/companion';
import * as offline from '../services/offline';
import type { OverlayStatus } from '../types/companion';
import type { OfflineLiveStatus } from '../types/offline';
import TrackerApp from './TrackerApp';

vi.mock('../services/companion', () => ({
  isNative: vi.fn<typeof companion.isNative>(),
  markTrackersReady: vi.fn<typeof companion.markTrackersReady>(),
  readOverlayStatus: vi.fn<typeof companion.readOverlayStatus>(),
  arrangeTrackers: vi.fn<typeof companion.arrangeTrackers>(),
}));
vi.mock('../services/offline', () => ({
  readOfflineStatus: vi.fn<typeof offline.readOfflineStatus>(),
  readOfflineLiveStatus: vi.fn<typeof offline.readOfflineLiveStatus>(),
  saveTrackerPositions: vi.fn<typeof offline.saveTrackerPositions>(),
  configureOffline: vi.fn<typeof offline.configureOffline>(),
  runOfflineAction: vi.fn<typeof offline.runOfflineAction>(),
}));

const bar = {
  id: 'b1',
  name: 'Burst',
  mode: 'cooldowns' as const,
  skills: [1],
  x: 100,
  y: 200,
  icon_size: 36,
  appearance: 'icons' as const,
  hidden: false,
};
const status: OfflineLiveStatus = {
  settings: {
    ...SETTINGS_FALLBACK,
    presets: [{ id: 'p1', name: 'Main', class: null, keybind: null, bars: [bar] }],
    active_preset: 'p1',
  },
  report: null,
  library_count: 0,
  trackers: [],
  alerts: [],
  catalogue: null,
  capabilities: {},
  error: null,
};
const overlay = (editing: boolean): OverlayStatus => ({
  locked: true,
  ready: true,
  visible: true,
  can_lock: true,
  saved_path: '',
  errors: [],
  trackers_editing: editing,
});

beforeEach(() => {
  vi.mocked(companion.isNative).mockReturnValue(true);
  vi.mocked(companion.markTrackersReady).mockResolvedValue();
  vi.mocked(companion.readOverlayStatus).mockResolvedValue(overlay(true));
  vi.mocked(offline.readOfflineLiveStatus).mockResolvedValue(status);
  vi.mocked(offline.saveTrackerPositions).mockResolvedValue(status.settings!);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const barEl = () => screen.getByRole('region', { name: 'Burst' });

describe('in-game tracker surface', () => {
  it('saves only the dropped bar’s position, and only when it moved', async () => {
    // Settle both initial native polls and their effect cleanup before dragging.
    await act(async () => {
      render(<TrackerApp />);
    });
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Arrange trackers' })).toBeTruthy(),
    );
    fireEvent.pointerDown(barEl(), { clientX: 110, clientY: 210 });
    fireEvent.pointerUp(screen.getByRole('main'));
    expect(offline.saveTrackerPositions).not.toHaveBeenCalled();
    fireEvent.pointerDown(barEl(), { clientX: 110, clientY: 210 });
    fireEvent.pointerMove(screen.getByRole('main'), { clientX: 160, clientY: 250 });
    fireEvent.pointerUp(screen.getByRole('main'));
    expect(offline.saveTrackerPositions).toHaveBeenCalledWith('p1', [
      { bar_id: 'b1', x: 150, y: 240 },
    ]);
  });

  it('never resumes or saves a drag from an arrange session that ended', async () => {
    await act(async () => {
      render(<TrackerApp />);
    });
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Arrange trackers' })).toBeTruthy(),
    );
    fireEvent.pointerDown(barEl(), { clientX: 110, clientY: 210 });
    fireEvent.pointerMove(screen.getByRole('main'), { clientX: 400, clientY: 400 });
    vi.mocked(companion.readOverlayStatus).mockResolvedValue(overlay(false));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull(), { timeout: 2000 });
    vi.mocked(companion.readOverlayStatus).mockResolvedValue(overlay(true));
    await waitFor(() => expect(screen.getByRole('complementary')).toBeTruthy(), { timeout: 2000 });
    // The abandoned override is gone and the old drag cannot complete.
    expect(barEl().style.left).toBe('100px');
    await act(async () => {
      fireEvent.pointerMove(screen.getByRole('main'), { clientX: 500, clientY: 500 });
      fireEvent.pointerUp(screen.getByRole('main'));
    });
    expect(offline.saveTrackerPositions).not.toHaveBeenCalled();
  });

  it('finishes arranging even if an older status read answers afterwards', async () => {
    await act(async () => {
      render(<TrackerApp />);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    // A status read is in flight when Done is pressed; native answers it from before Done.
    let stale!: (status: OverlayStatus) => void;
    const reads = vi.mocked(companion.readOverlayStatus).mock.calls.length;
    vi.mocked(companion.readOverlayStatus)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          stale = resolve;
        }),
      )
      .mockResolvedValue(overlay(false));
    await waitFor(
      () => expect(vi.mocked(companion.readOverlayStatus).mock.calls.length).toBe(reads + 1),
      { timeout: 2000 },
    );
    vi.mocked(companion.arrangeTrackers).mockResolvedValue(overlay(false));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });
    expect(companion.arrangeTrackers).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('complementary')).toBeNull();
    await act(async () => {
      stale(overlay(true));
    });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('shows why Done failed while still arranging', async () => {
    vi.mocked(companion.arrangeTrackers).mockRejectedValue(new Error('surface busy'));
    await act(async () => {
      render(<TrackerApp />);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });
    expect(screen.getByRole('complementary').textContent).toContain('surface busy');
  });

  it('stays click-through: no arrange controls outside arrange mode', async () => {
    vi.mocked(companion.readOverlayStatus).mockResolvedValue(overlay(false));
    render(<TrackerApp />);
    await waitFor(() => expect(barEl()).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle(/no timer observed yet/)).toBeTruthy();
  });

  it('polls only the compact status, never the live report details', async () => {
    vi.mocked(companion.readOverlayStatus).mockResolvedValue(overlay(false));
    render(<TrackerApp />);
    await waitFor(() => expect(barEl()).toBeTruthy());
    expect(offline.readOfflineLiveStatus).toHaveBeenCalled();
    expect(offline.readOfflineStatus).not.toHaveBeenCalled();
  });
});
