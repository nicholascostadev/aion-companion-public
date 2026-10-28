import { useCallback } from 'react';
import {
  configureOffline,
  readOfflineLiveStatus,
  readOfflineStatus,
  runOfflineAction,
} from '../services/offline';
import { commitUiPreference } from '../services/uiPreferences';
import type { OfflineActionName, OfflineSettings, PolledOfflineStatus } from '../types/offline';
import { useNativeState } from './useNativeState';

/**
 * Settings the native report is aggregated with: the target scope (every target, or
 * bosses and dummies while any were met) and the party filter.
 */
const REPORT_FILTERS = ['target_mode', 'party_only'] as const satisfies (keyof OfflineSettings)[];

interface Options {
  /** Lower bound for the poll interval; the user's refresh rate applies above it. */
  minIntervalMs?: number;
  /** Stop polling (e.g. a hidden panel), keeping the last status. */
  paused?: boolean;
  /**
   * A visible view draws the live report's events, buffs or HP (live analysis): poll the
   * full `offline_status`. Otherwise the compact `offline_live_status` is polled and its
   * report is a summary. Switching reads the other one at once and drops reads in flight.
   */
  detail?: boolean;
}

/**
 * Polls the offline status at the user's refresh rate. Until the first answer the
 * status is null and every consumer renders an "unavailable" state, never defaults.
 * Its report is a summary unless `detail` is on; narrow it by `detail_level`.
 */
export function useOffline(
  native: boolean,
  { minIntervalMs = 500, paused = false, detail = false }: Options = {},
) {
  const read: () => Promise<PolledOfflineStatus> = detail
    ? readOfflineStatus
    : readOfflineLiveStatus;
  const { state, busy, error, latest, act, refresh } = useNativeState<PolledOfflineStatus | null>(
    native,
    read,
    {
      initial: null,
      intervalMs: (status) =>
        Math.min(2000, Math.max(minIntervalMs, status?.settings?.refresh_ms ?? 500)),
      paused,
      readClearsActionError: true,
    },
  );

  const configure = useCallback(
    (settings: OfflineSettings) =>
      act(async () => {
        const before = latest.current?.settings ?? null;
        const saved = await configureOffline(settings);
        // This window shows the saved language now; other windows follow native's event.
        commitUiPreference(saved.locale);
        // Filters change what the native report aggregates: settings and report are
        // applied together from one fresh status, never new settings over an old report.
        // A fresh status is applied as is: its report belongs to its own settings, which may
        // already include another window's later change.
        if (REPORT_FILTERS.some((name) => before?.[name] !== saved[name])) return read();
        return latest.current ? { ...latest.current, settings: saved } : null;
      }),
    [act, latest, read],
  );
  // Answers at the detail level polled now, so an action never swaps detail for a summary.
  const action = useCallback(
    (name: OfflineActionName) => act(() => runOfflineAction(name, detail ? 'full' : 'summary')),
    [act, detail],
  );

  return { native, status: state, error, busy, configure, action, refresh };
}

export type OfflineState = ReturnType<typeof useOffline>;
