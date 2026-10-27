import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { report, reportSummary } from '../features/offline/fixtures';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import * as api from '../services/companion';
import * as offline from '../services/offline';
import type { DetailsSelection, OverlayStatus } from '../types/companion';
import type { CombatReport, OfflineLiveStatus } from '../types/offline';
import DetailsApp from './DetailsApp';

vi.mock('../services/companion', () => ({
  isNative: vi.fn<typeof api.isNative>(),
  readOverlayStatus: vi.fn<typeof api.readOverlayStatus>(),
  markDetailsReady: vi.fn<typeof api.markDetailsReady>(),
  hideDetails: vi.fn<typeof api.hideDetails>(),
  quitOverlay: vi.fn<typeof api.quitOverlay>(),
}));
vi.mock('../services/offline', () => ({
  readOfflineStatus: vi.fn<typeof offline.readOfflineStatus>(),
  readOfflineLiveStatus: vi.fn<typeof offline.readOfflineLiveStatus>(),
  inspectReport: vi.fn<typeof offline.inspectReport>(),
}));

const status: OfflineLiveStatus = {
  settings: SETTINGS_FALLBACK,
  report: null,
  library_count: 0,
  trackers: [],
  alerts: [],
  catalogue: null,
  capabilities: {},
  error: null,
};
function overlay(selection: DetailsSelection | null, visible = true): OverlayStatus {
  return {
    locked: true,
    ready: true,
    visible: true,
    can_lock: true,
    saved_path: '',
    errors: [],
    details_visible: visible,
    details_selection: selection,
  };
}
const select = (player: string, revision = 1, report_id: string | null = 'fight-1') =>
  vi.mocked(api.readOverlayStatus).mockResolvedValue(overlay({ revision, report_id, player }));
/** Lets polls and pending promises settle under fake timers. */
const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.isNative).mockReturnValue(true);
  vi.mocked(api.markDetailsReady).mockResolvedValue();
  vi.mocked(api.hideDetails).mockResolvedValue();
  vi.mocked(offline.readOfflineLiveStatus).mockResolvedValue(status);
  vi.mocked(offline.inspectReport).mockResolvedValue(report());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('damage details window', () => {
  it('opens the full report of the pinned fight on exactly the clicked player', async () => {
    select('2');
    render(<DetailsApp />);
    await flush();
    expect(api.markDetailsReady).toHaveBeenCalledOnce();
    expect(offline.inspectReport).toHaveBeenCalledWith('fight-1');
    expect(screen.getByRole('heading', { name: /Test Boss/ })).toBeTruthy();
    // Skills tab, on Bryn rather than the local player the report would default to.
    expect(screen.getByRole('tab', { name: 'Skills' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Player' }).value).toBe('2');
    expect(screen.queryByRole('table', { name: 'Aria skill breakdown' })).toBeNull();
    expect(screen.getByText('Fight ended')).toBeTruthy();
  });

  it('never shows another player when the clicked one is missing', async () => {
    select('77');
    render(<DetailsApp />);
    await flush();
    expect(screen.getByText(/Player #77 has no recorded entry/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: /skill breakdown/ })).toBeNull();
    expect(screen.queryByText('Snipe')).toBeNull();
    // Other players only on an explicit choice.
    fireEvent.click(screen.getByRole('button', { name: 'Browse this fight’s players' }));
    expect(screen.getByRole('table', { name: /skill breakdown/ })).toBeTruthy();
  });

  it('closes by hiding its own window, never quitting the app', async () => {
    select('1');
    render(<DetailsApp />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Close damage details' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(api.hideDetails).toHaveBeenCalledTimes(2);
    expect(api.quitOverlay).not.toHaveBeenCalled();
  });

  it('applies a newer selection even while an older load is still pending', async () => {
    const slow = deferred<CombatReport>();
    vi.mocked(offline.inspectReport).mockReturnValueOnce(slow.promise);
    select('1', 1, 'fight-1');
    render(<DetailsApp />);
    await flush();
    expect(offline.inspectReport).toHaveBeenLastCalledWith('fight-1');
    vi.mocked(offline.inspectReport).mockResolvedValue(report({ id: 'fight-2', label: 'Second' }));
    select('2', 2, 'fight-2');
    await flush(500);
    expect(offline.inspectReport).toHaveBeenLastCalledWith('fight-2');
    expect(screen.getByRole('heading', { name: /Second/ })).toBeTruthy();
    // The first fight answering late must not replace the newer selection.
    slow.resolve(report());
    await flush();
    expect(screen.getByRole('heading', { name: /Second/ })).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Player' }).value).toBe('2');
  });

  it('follows only the pinned live fight while visible and keeps its snapshot after', async () => {
    vi.mocked(offline.inspectReport).mockResolvedValue(report({ end_reason: null }));
    select('1');
    render(<DetailsApp />);
    await flush();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(offline.inspectReport).toHaveBeenCalledTimes(1);
    await flush(2000);
    expect(offline.inspectReport).toHaveBeenCalledTimes(2);
    expect(offline.inspectReport).toHaveBeenLastCalledWith('fight-1');

    // Hidden (closed or focus-hidden): no full-report refreshes, the snapshot stays.
    vi.mocked(api.readOverlayStatus).mockResolvedValue(
      overlay({ revision: 1, report_id: 'fight-1', player: '1' }, false),
    );
    await flush(500);
    const calls = vi.mocked(offline.inspectReport).mock.calls.length;
    await flush(6000);
    expect(offline.inspectReport).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole('heading', { name: /Test Boss/ })).toBeTruthy();

    // Shown again: refreshing resumes for the same fight; once it can no longer be read
    // the last snapshot stays rather than switching to another fight.
    select('1');
    await flush(500);
    vi.mocked(offline.inspectReport).mockRejectedValue(new Error('Log not found'));
    await flush(2000);
    expect(screen.getByText(/can no longer be refreshed/)).toBeTruthy();
    expect(screen.getByText('Snapshot')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Test Boss/ })).toBeTruthy();
    const after = vi.mocked(offline.inspectReport).mock.calls.length;
    await flush(6000);
    expect(offline.inspectReport).toHaveBeenCalledTimes(after);
    expect(new Set(vi.mocked(offline.inspectReport).mock.calls.map(([id]) => id))).toEqual(
      new Set(['fight-1']),
    );
  });

  it('pins a row opened before any report id to the fight current at that moment', async () => {
    vi.mocked(offline.readOfflineLiveStatus).mockResolvedValue({
      ...status,
      report: reportSummary(),
    });
    select('1', 1, null);
    render(<DetailsApp />);
    await flush();
    expect(offline.inspectReport).toHaveBeenCalledWith('fight-1');
  });

  it('applies a privacy change made while hidden without reloading the fight', async () => {
    select('2');
    render(<DetailsApp />);
    await flush();
    expect(screen.getByRole('option', { name: 'Bryn · Cleric' })).toBeTruthy();
    vi.mocked(api.readOverlayStatus).mockResolvedValue(
      overlay({ revision: 1, report_id: 'fight-1', player: '2' }, false),
    );
    await flush(500);
    vi.mocked(offline.readOfflineLiveStatus).mockResolvedValue({
      ...status,
      settings: { ...SETTINGS_FALLBACK, hide_names: true },
    });
    select('2');
    await flush(500);
    expect(screen.queryByText(/Bryn/)).toBeNull();
    expect(screen.getByRole('option', { name: 'Cleric 2 · Cleric' })).toBeTruthy();
    // Same fight and player, never reloaded.
    expect(offline.inspectReport).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Player' }).value).toBe('2');
  });

  it('takes the fight in full from offline_inspect and never polls the full live status', async () => {
    select('1');
    render(<DetailsApp />);
    await flush(6000);
    expect(offline.inspectReport).toHaveBeenCalledWith('fight-1');
    expect(offline.readOfflineLiveStatus).toHaveBeenCalled();
    expect(offline.readOfflineStatus).not.toHaveBeenCalled();
  });
});
