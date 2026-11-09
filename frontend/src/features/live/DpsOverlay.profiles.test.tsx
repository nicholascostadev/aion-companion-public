import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { ShugoProfile } from '../../lib/shugo';
import type { LiveStatus, OverlayStatus } from '../../types/companion';
import type { LastDeath, PolledOfflineStatus } from '../../types/offline';
import { nativeReport, report } from '../offline/fixtures';
import { Meter } from './meterHarness';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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
const [aria, bryn] = nativeReport.players;
/** Aria on an EU server; Bryn on a Korean server, whose region a link cannot tell. */
const fight = report({
  end_reason: null,
  players: [
    { ...aria!, server_id: 2301 },
    { ...bryn!, server_id: 1001 },
  ],
});
const offline = (patch: Partial<PolledOfflineStatus> = {}): PolledOfflineStatus => ({
  settings: SETTINGS_FALLBACK,
  report: fight,
  library_count: 0,
  trackers: [],
  alerts: [],
  catalogue: null,
  capabilities: {},
  error: null,
  ...patch,
});
const death = (patch: Partial<LastDeath['last_hit'] & object> = {}, agoMs = 30_000) => ({
  at_ms: Date.now() - agoMs,
  last_hit: { name: 'Kaelith', server_id: 1101, class: 'Assassin', player: true, ...patch },
});
function show(status: PolledOfflineStatus) {
  const onOpenProfile = vi.fn<(profile: ShugoProfile) => void>();
  render(
    <Meter
      status={live}
      overlay={overlay}
      error=""
      busy={false}
      onReset={vi.fn<() => void>()}
      onHide={vi.fn<() => void>()}
      offline={status}
      onOpenProfile={onOpenProfile}
    />,
  );
  return onOpenProfile;
}
const shortcut = () => screen.queryByRole('region', { name: 'Your latest death' });

describe('DPS meter profile links', () => {
  it('opens the profile of an identified Global character without opening their skills', () => {
    const open = show(offline());
    const link = screen.getByRole('button', { name: "View Aria's character profile" });
    // Never inside the row's own button.
    expect(link.parentElement?.closest('button')).toBeNull();
    // It follows the name on the name's own line, not the row's far edge.
    expect(link.closest('[data-cell="name"]')).toBeTruthy();
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith({ name: 'Aria', serverId: 2301 });
    const ranking = screen.getByRole('list', { name: 'Players by damage' });
    // A Korean or Taiwanese server id names no region, so that row has no link.
    expect(screen.queryByRole('button', { name: "View Bryn's character profile" })).toBeNull();
    // A press on the name itself still opens the row's skills.
    fireEvent.click(within(ranking).getByText('Aria'));
    expect(screen.getByRole('list', { name: 'Skills of Aria' })).toBeTruthy();
  });

  it('shows no link or death shortcut while names are hidden', () => {
    show(offline({ settings: { ...SETTINGS_FALLBACK, hide_names: true }, last_death: death() }));
    expect(screen.queryByRole('button', { name: /character profile$/ })).toBeNull();
    expect(shortcut()).toBeNull();
  });
});

describe('DPS meter death shortcut', () => {
  it('names the last hit, not a killer, and opens that character profile', () => {
    const open = show(offline({ last_death: death() }));
    const strip = shortcut()!;
    expect(within(strip).getByText('Last hit')).toBeTruthy();
    expect(within(strip).getByText('Kaelith')).toBeTruthy();
    expect(strip.textContent).not.toMatch(/kill/i);
    fireEvent.click(
      within(strip).getByRole('button', { name: "View Kaelith's character profile" }),
    );
    expect(open).toHaveBeenCalledWith({ name: 'Kaelith', serverId: 1101 });
    fireEvent.click(within(strip).getByRole('button', { name: 'Dismiss' }));
    expect(shortcut()).toBeNull();
  });

  it('keeps the name without a link when no Global server was observed with it', () => {
    show(offline({ last_death: death({ server_id: null }) }));
    expect(within(shortcut()!).getByText('Kaelith')).toBeTruthy();
    expect(screen.queryByRole('button', { name: "View Kaelith's character profile" })).toBeNull();
  });

  it('offers nothing for a monster or an unidentified last hit', () => {
    show(offline({ last_death: death({ name: null, server_id: null, player: false }) }));
    expect(shortcut()).toBeNull();
    cleanup();
    show(offline({ last_death: { at_ms: Date.now(), last_hit: null } }));
    expect(shortcut()).toBeNull();
  });

  it('lapses ten minutes after the death, and an older one never shows', () => {
    vi.useFakeTimers();
    show(offline({ last_death: death({}, 9 * 60_000) }));
    expect(shortcut()).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_001);
    });
    expect(shortcut()).toBeNull();
    cleanup();
    show(offline({ last_death: death({}, 11 * 60_000) }));
    expect(shortcut()).toBeNull();
  });
});
