import { useCallback, useRef } from 'react';
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

  // What this hook has started and not settled yet: a patch waits for all of it instead of
  // being refused as busy. `act` never rejects, so every entry settles.
  const running = useRef(new Set<Promise<boolean>>());
  const started = useCallback((run: Promise<boolean>) => {
    running.current.add(run);
    void run.finally(() => running.current.delete(run));
    return run;
  }, []);
  /** The last patch asked for, so patches run one after another in the order asked. */
  const lastPatch = useRef<Promise<unknown>>(Promise.resolve());

  const configure = useCallback(
    (settings: OfflineSettings) =>
      started(
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
      ),
    [act, latest, read, started],
  );
  /**
   * Saves one change to the settings as saved now, never to a draft: they are read afresh
   * first, so a setting changed elsewhere since the last poll (or by an earlier patch) is
   * kept. `change` returns null when nothing needs saving. Patches run one at a time, in the
   * order asked, each after any save or action already started here has settled, so quick
   * changes in a row are all saved rather than refused as busy. Resolves false only when the
   * save failed (`error` says why).
   */
  const patch = useCallback(
    (change: (settings: OfflineSettings) => OfflineSettings | null) => {
      const before = lastPatch.current;
      const run = (async () => {
        await before;
        // A save or action started meanwhile is waited for too, until none is running.
        while (running.current.size > 0) await Promise.allSettled([...running.current]);
        return act(async () => {
          const current = (await readOfflineLiveStatus()).settings;
          if (!current) throw new Error('Native returned no settings');
          const next = change(current);
          if (!next) return null;
          const saved = await configureOffline(next);
          commitUiPreference(saved.locale);
          if (REPORT_FILTERS.some((name) => current[name] !== saved[name])) return read();
          return latest.current ? { ...latest.current, settings: saved } : null;
        });
      })();
      lastPatch.current = run;
      return run;
    },
    [act, latest, read],
  );
  // Answers at the detail level polled now, so an action never swaps detail for a summary.
  const action = useCallback(
    (name: OfflineActionName) =>
      started(act(() => runOfflineAction(name, detail ? 'full' : 'summary'))),
    [act, detail, started],
  );

  return { native, status: state, error, busy, configure, patch, action, refresh };
}

export type OfflineState = ReturnType<typeof useOffline>;
