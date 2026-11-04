import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../features/alerts/fixtures';
import { nativeReport, reportSummary } from '../features/offline/fixtures';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import * as alerts from '../services/alerts';
import * as companion from '../services/companion';
import * as offline from '../services/offline';
import * as profile from '../services/profile';
import * as shugo from '../services/shugo';
import type { GroupStatus, LiveStatus } from '../types/companion';
import { INITIAL_PROFILE_WINDOW } from '../types/profile';
import OverlayApp from './OverlayApp';

// Only native reads are replaced; everything else is the real module.
vi.mock('../services/companion', async (original) => ({
  ...(await original<typeof companion>()),
  isNative: vi.fn<typeof companion.isNative>(),
  readLiveStatus: vi.fn<typeof companion.readLiveStatus>(),
  readOverlayStatus: vi.fn<typeof companion.readOverlayStatus>(),
  readGroupStatus: vi.fn<typeof companion.readGroupStatus>(),
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

vi.mock('../services/profile', async (original) => ({
  ...(await original<typeof profile>()),
  openProfileWindow: vi.fn<typeof profile.openProfileWindow>(),
}));
vi.mock('../services/shugo', () => ({ openShugoProfile: vi.fn<typeof shugo.openShugoProfile>() }));

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
/** Native's party room report; outside a room by default. */
const group = (patch: Partial<GroupStatus> = {}): GroupStatus => ({
  capture_id: 1,
  running: true,
  phase: 'capturing',
  message: '',
  roster_seen: false,
  roster_age_ms: null,
  members: [],
  inspections: [],
  room: false,
  run: { phase: 'outside', dungeon_id: null, run_id: null, zone_id: 1110 },
  preparing: false,
  ...patch,
});
const ODYLE_TITLE = 'Odyle energy · latest balance (+ bonus) reported by the game';
const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.mocked(companion.readGroupStatus).mockResolvedValue(group());
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
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('DPS meter window', () => {
  it('ranks players from the compact live status and never polls report details', async () => {
    render(<OverlayApp />);
    await tick();
    expect(within(screen.getByRole('list')).getByText('Aria').title).toBe('Aria · Ranger · you');
    await tick(500);
    expect(vi.mocked(offline.readOfflineLiveStatus).mock.calls.length).toBeGreaterThan(1);
    expect(offline.readOfflineStatus).not.toHaveBeenCalled();
  });

  it("shows the game's captured Odyle balance from the live status", async () => {
    vi.mocked(companion.readLiveStatus).mockResolvedValue(observed(15, 275));
    render(<OverlayApp />);
    const odyle = screen.getByTitle(ODYLE_TITLE);
    await tick();
    expect(odyle.textContent).toBe('15(+275)');
  });

  it('follows the observed balance down to zero, then back to unknown', async () => {
    vi.mocked(companion.readLiveStatus)
      .mockResolvedValueOnce(observed(15, 275))
      .mockResolvedValueOnce(observed(0, 0))
      .mockResolvedValue({ ...live, odyle: null });
    render(<OverlayApp />);
    const odyle = screen.getByTitle(ODYLE_TITLE);
    await tick();
    expect(odyle.textContent).toBe('15(+275)');
    // A spent balance is a real zero…
    await tick(500);
    expect(odyle.textContent).toBe('0(+0)');
    // …and once native no longer knows it (e.g. a character switch), dashes, never zero.
    await tick(500);
    expect(odyle.textContent).toBe('—(+—)');
  });

  it('shows Odyle energy as unknown, not stale, while the live status cannot be read', async () => {
    vi.mocked(companion.readLiveStatus)
      .mockResolvedValueOnce(observed(15, 275))
      .mockRejectedValueOnce(new Error('capture unavailable'))
      .mockResolvedValue(observed(12, 275));
    render(<OverlayApp />);
    const odyle = screen.getByTitle(ODYLE_TITLE);
    const problem = screen.getByRole('status', { name: 'Overlay status' });
    await tick();
    expect(odyle.textContent).toBe('15(+275)');
    await tick(500);
    expect(problem.textContent).toContain('capture unavailable');
    expect(odyle.textContent).toBe('—(+—)');
    // The next good read brings back what the game reports now.
    await tick(500);
    expect(odyle.textContent).toBe('12(+275)');
    expect(problem.textContent).toBe('');
  });

  it('keeps Odyle energy unknown when native sends none (older status)', async () => {
    render(<OverlayApp />);
    await tick();
    expect(companion.readLiveStatus).toHaveBeenCalled();
    expect(screen.getByTitle(ODYLE_TITLE).textContent).toBe('—(+—)');
  });

  it('keeps every row of a crowded locked meter clickable, its profile link included', async () => {
    // A full roster of linked Global characters; native accepts only 32 click regions.
    const players = Array.from({ length: 20 }, (_, i) => ({
      ...nativeReport.players[1],
      id: 100 + i,
      name: `Member${i}`,
      server_id: 2301,
      damage: 5000 - i * 10,
    }));
    vi.mocked(companion.readOverlayStatus).mockResolvedValue({
      locked: true,
      ready: true,
      visible: true,
      can_lock: true,
      saved_path: '',
      errors: [],
    });
    vi.mocked(offline.readOfflineLiveStatus).mockResolvedValue({
      settings: SETTINGS_FALLBACK,
      report: reportSummary({ end_reason: null, players }),
      library_count: 0,
      trackers: [],
      alerts: [],
      catalogue: null,
      capabilities: {},
      error: null,
    });
    // Rows stack down the list, 24 px apart, each link a small mark inside its row; the
    // meter's other controls sit in the caption above; the meter and its list span it.
    const top = (row: Element) => 40 + [...row.parentElement!.children].indexOf(row) * 24;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const row = this.closest('[data-meter-row]');
      const [left, y, width, height] = !row
        ? this.hasAttribute('data-hit')
          ? [0, 0, 20, 20]
          : [0, 0, 360, 600]
        : this.closest('[aria-label$="character profile"]')
          ? [120, top(row) + 3, 16, 16]
          : [6, top(row), 348, 22];
      return { left, top: y, right: left + width, bottom: y + height, width, height } as DOMRect;
    });
    render(<OverlayApp />);
    await tick();
    await tick(500);
    const ranking = screen.getByRole('list', { name: 'Players by damage' });
    const rows = within(ranking).getAllByRole('listitem');
    expect(rows).toHaveLength(20);
    expect(within(ranking).getAllByRole('button', { name: /character profile$/ })).toHaveLength(20);
    const regions = vi.mocked(companion.setRowRegions).mock.lastCall![0];
    const covered = (x: number, y: number) =>
      regions.some(([rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);
    for (const row of rows) {
      // The name opens the row's skills and the link its profile; both must take clicks.
      expect(covered(60, top(row) + 11)).toBe(true);
      expect(covered(128, top(row) + 11)).toBe(true);
    }
    // The mark opens the in-game profile window on that character, never the browser.
    vi.mocked(profile.openProfileWindow).mockResolvedValue(INITIAL_PROFILE_WINDOW);
    fireEvent.click(
      within(ranking).getByRole('button', { name: "View Member3's character profile" }),
    );
    expect(profile.openProfileWindow).toHaveBeenCalledWith({ name: 'Member3', serverId: 2301 });
    expect(shugo.openShugoProfile).not.toHaveBeenCalled();
  });
});
