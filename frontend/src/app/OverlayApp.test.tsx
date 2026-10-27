import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../features/alerts/fixtures';
import { reportSummary } from '../features/offline/fixtures';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import * as alerts from '../services/alerts';
import * as companion from '../services/companion';
import * as offline from '../services/offline';
import type { LiveStatus } from '../types/companion';
import OverlayApp from './OverlayApp';

// Only native reads are replaced; everything else is the real module.
vi.mock('../services/companion', async (original) => ({
  ...(await original<typeof companion>()),
  isNative: vi.fn<typeof companion.isNative>(),
  readLiveStatus: vi.fn<typeof companion.readLiveStatus>(),
  readOverlayStatus: vi.fn<typeof companion.readOverlayStatus>(),
  markOverlayReady: vi.fn<typeof companion.markOverlayReady>(),
  setRowRegions: vi.fn<typeof companion.setRowRegions>(),
}));
vi.mock('../services/alerts', async (original) => ({
  ...(await original<typeof alerts>()),
  readAlertsStatus: vi.fn<typeof alerts.readAlertsStatus>(),
}));
vi.mock('../services/offline', async (original) => ({
  ...(await original<typeof offline>()),
  readOfflineStatus: vi.fn<typeof offline.readOfflineStatus>(),
  readOfflineLiveStatus: vi.fn<typeof offline.readOfflineLiveStatus>(),
}));

const live: LiveStatus = {
  running: true,
  phase: 'capturing',
  message: 'Collecting damage',
  duration_ms: 30_000,
  events: 9,
  stats: {},
  players: [],
};
const observed = (base: number, bonus: number): LiveStatus => ({
  ...live,
  odyle: { base, bonus, observed_ms: Date.now() },
});
const ODYLE_TITLE = 'Odyle energy · latest balance (+ bonus) reported by the game';
/** Three polls apart at most: the live status refreshes every 500 ms. */
const POLLS = { timeout: 2000 };

beforeEach(() => {
  vi.mocked(companion.isNative).mockReturnValue(true);
  vi.mocked(companion.markOverlayReady).mockResolvedValue();
  vi.mocked(companion.setRowRegions).mockResolvedValue(0);
  vi.mocked(companion.readOverlayStatus).mockResolvedValue({
    locked: false,
    ready: true,
    visible: true,
    can_lock: true,
    saved_path: '',
    errors: [],
  });
  vi.mocked(companion.readLiveStatus).mockResolvedValue(live);
  vi.mocked(alerts.readAlertsStatus).mockResolvedValue(dashboard({ now_ms: Date.now() }));
  vi.mocked(offline.readOfflineLiveStatus).mockResolvedValue({
    settings: SETTINGS_FALLBACK,
    report: reportSummary({ end_reason: null }),
    library_count: 0,
    trackers: [],
    alerts: [],
    catalogue: null,
    capabilities: {},
    error: null,
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('DPS meter window', () => {
  it('ranks players from the compact live status and never polls report details', async () => {
    render(<OverlayApp />);
    expect((await screen.findByText('Aria')).title).toBe('Aria · Ranger · you');
    await waitFor(() =>
      expect(vi.mocked(offline.readOfflineLiveStatus).mock.calls.length).toBeGreaterThan(1),
    );
    expect(offline.readOfflineStatus).not.toHaveBeenCalled();
  });

  it("shows the game's captured Odyle balance from the live status", async () => {
    vi.mocked(companion.readLiveStatus).mockResolvedValue(observed(15, 275));
    render(<OverlayApp />);
    const odyle = screen.getByTitle(ODYLE_TITLE);
    await waitFor(() => expect(odyle.textContent).toBe('15(+275)'));
  });

  it('follows the observed balance down to zero, then back to unknown', async () => {
    vi.mocked(companion.readLiveStatus)
      .mockResolvedValueOnce(observed(15, 275))
      .mockResolvedValueOnce(observed(0, 0))
      .mockResolvedValue({ ...live, odyle: null });
    render(<OverlayApp />);
    const odyle = screen.getByTitle(ODYLE_TITLE);
    await waitFor(() => expect(odyle.textContent).toBe('15(+275)'), POLLS);
    // A spent balance is a real zero…
    await waitFor(() => expect(odyle.textContent).toBe('0(+0)'), POLLS);
    // …and once native no longer knows it (e.g. a character switch), dashes, never zero.
    await waitFor(() => expect(odyle.textContent).toBe('—(+—)'), POLLS);
  });

  it('shows Odyle energy as unknown, not stale, while the live status cannot be read', async () => {
    vi.mocked(companion.readLiveStatus)
      .mockResolvedValueOnce(observed(15, 275))
      .mockRejectedValueOnce(new Error('capture unavailable'))
      .mockResolvedValue(observed(12, 275));
    render(<OverlayApp />);
    const odyle = screen.getByTitle(ODYLE_TITLE);
    const problem = screen.getByRole('status', { name: 'Overlay status' });
    await waitFor(() => expect(odyle.textContent).toBe('15(+275)'), POLLS);
    await waitFor(() => expect(problem.textContent).toContain('capture unavailable'), POLLS);
    expect(odyle.textContent).toBe('—(+—)');
    // The next good read brings back what the game reports now.
    await waitFor(() => expect(odyle.textContent).toBe('12(+275)'), POLLS);
    expect(problem.textContent).toBe('');
  });

  it('keeps Odyle energy unknown when native sends none (older status)', async () => {
    render(<OverlayApp />);
    await waitFor(() => expect(companion.readLiveStatus).toHaveBeenCalled());
    expect(screen.getByTitle(ODYLE_TITLE).textContent).toBe('—(+—)');
  });
});
