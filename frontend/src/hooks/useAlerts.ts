import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/provider';
import { playSound } from '../lib/sound';
import { configureAlerts, readAlertsStatus, runAlertAction, testAlert } from '../services/alerts';
import type { AlertActionName, AlertConfig, AlertDashboard, AlertSound } from '../types/alerts';
import { useNativePoll } from './useNativePoll';

/** Native rejection of a save based on an older revision. */
const STALE = /changed in another window|revision/i;
/** The browser preview could not play its tone; worded at render time. */
const PREVIEW_FAILED = Symbol('preview sound failed');
class PreviewSoundFailed extends Error {}

interface Options {
  intervalMs?: number;
  /** Stop polling, keeping the last dashboard. */
  paused?: boolean;
}

/**
 * Polls the lightweight `alerts_status`. Edits are deltas: each one is applied to the
 * newest native config, and on a revision conflict (another window saved first) it is
 * re-applied once to a fresh config instead of overwriting the other change. Writes run
 * one at a time in order, so quick successive toggles are never lost.
 */
export function useAlerts(native: boolean, { intervalMs = 1000, paused = false }: Options = {}) {
  const [dashboard, setDashboard] = useState<AlertDashboard | null>(null);
  const { t } = useTranslation('alerts');
  /** Raw native error text, shown verbatim, or a failure this hook words itself. */
  const [error, setError] = useState<string | typeof PREVIEW_FAILED>('');
  const [busy, setBusy] = useState(false);
  const latest = useRef<AlertDashboard | null>(null);
  /** Native clock minus this PC's clock, so countdowns follow native time. */
  const offset = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((next: AlertDashboard) => {
    offset.current = next.now_ms - Date.now();
    latest.current = next;
    if (mounted.current) {
      setDashboard(next);
      setOffsetMs(Math.round(offset.current));
    }
  }, []);

  const { invalidate } = useNativePoll(readAlertsStatus, {
    enabled: native && !paused,
    intervalMs,
    skip: () => pending.current > 0,
    onData: (next) => {
      apply(next);
      setError('');
    },
    onError: setError,
  });

  const run = useCallback(
    (operation: () => Promise<AlertDashboard | null>): Promise<boolean> => {
      if (!native) return Promise.resolve(false);
      pending.current += 1;
      invalidate();
      setBusy(true);
      const next = queue.current.then(async () => {
        try {
          const result = await operation();
          if (result) apply(result);
          if (mounted.current) setError('');
          return true;
        } catch (cause) {
          if (mounted.current) setError(String(cause));
          return false;
        } finally {
          pending.current -= 1;
          invalidate();
          if (mounted.current && pending.current === 0) setBusy(false);
        }
      });
      queue.current = next;
      return next;
    },
    [native, apply, invalidate],
  );

  const configure = useCallback(
    (change: (config: AlertConfig) => AlertConfig) =>
      run(async () => {
        const base = latest.current ?? (await readAlertsStatus());
        try {
          return await configureAlerts(change(base.config));
        } catch (cause) {
          if (!STALE.test(String(cause))) throw cause;
          const fresh = await readAlertsStatus();
          apply(fresh);
          return configureAlerts(change(fresh.config));
        }
      }),
    [run, apply],
  );

  const action = useCallback(
    (name: AlertActionName, id: string | null = null, seconds: number | null = null) =>
      run(() => runAlertAction(name, id, seconds)),
    [run],
  );

  /**
   * Preview: the native sound and popup path in the desktop app (the popup appears over
   * the focused game only); a local tone in a browser preview. `volume` is the alert's own;
   * the master volume is applied once, by native or here for the browser tone.
   */
  const test = useCallback(
    async (sound: AlertSound, volume: number, popup: boolean) => {
      try {
        if (native) await testAlert(sound, volume, popup);
        else if (
          sound !== 'none' &&
          !(await playSound(sound, volume * (latest.current?.config.volume ?? 1)))
        )
          throw new PreviewSoundFailed();
        if (mounted.current) setError('');
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(cause instanceof PreviewSoundFailed ? PREVIEW_FAILED : String(cause));
        return false;
      }
    },
    [native],
  );

  const now = useCallback(() => Date.now() + offset.current, []);

  return {
    native,
    dashboard,
    error: error === PREVIEW_FAILED ? t(($) => $.previewSoundFailed) : error,
    busy,
    offsetMs,
    configure,
    action,
    test,
    now,
  };
}

export type AlertsController = ReturnType<typeof useAlerts>;
