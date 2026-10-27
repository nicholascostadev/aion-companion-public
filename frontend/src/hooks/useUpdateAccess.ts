import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUSY_ACCESS_PHASES,
  readUpdateAccessStatus,
  runUpdateAccessAction,
} from '../services/updateAccess';
import { updateAccessStep } from '../lib/updateAccess';
import type {
  UpdateAccessAction,
  UpdateAccessPhase,
  UpdateAccessState,
  UpdateAccessStatus,
} from '../types/updateAccess';

const isBusy = (phase: UpdateAccessPhase | null | undefined) =>
  !!phase && BUSY_ACCESS_PHASES.includes(phase);

/**
 * GitHub access for private release updates while `active` (App updates is on screen in a
 * stable private build). Reading status only returns native's cached snapshot, so it polls
 * quickly while a check or sign-in runs and slowly otherwise, never while hidden. Each time
 * it becomes active it probes once by itself unless the last probe already confirmed access,
 * so installing the CLI or accepting an invitation is picked up on the way back; ordinary
 * polls never probe. Check access and Sign in are explicit, and neither starts while the other
 * runs here or natively. Results older than the newest one shown are dropped, and nothing is
 * applied after unmount.
 */
export function useUpdateAccess(
  native: boolean,
  { active = true, busyMs = 1000, idleMs = 5000 } = {},
): UpdateAccessState {
  const [status, setStatus] = useState<UpdateAccessStatus | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<UpdateAccessAction | null>(null);
  const alive = useRef(false);
  const issued = useRef(0);
  const applied = useRef(0);
  const latest = useRef<UpdateAccessStatus | null>(null);
  const inflight = useRef<UpdateAccessAction | null>(null);
  const pollNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((ticket: number, next: UpdateAccessStatus) => {
    if (!alive.current || ticket < applied.current) return;
    applied.current = ticket;
    latest.current = next;
    setStatus(next);
    setError('');
  }, []);

  /** Runs one step; ignored while another runs here or natively, and in development. */
  const run = useCallback(
    async (action: UpdateAccessAction) => {
      const phase = latest.current?.phase;
      if (!native || phase === 'development' || inflight.current || isBusy(phase)) return false;
      if (action === 'login' && latest.current?.login_supported === false) return false;
      inflight.current = action;
      setPending(action);
      setError('');
      try {
        const result = runUpdateAccessAction(action);
        // Native flips to checking or signing_in as soon as it starts; show it without waiting.
        pollNow.current?.();
        const next = await result;
        apply(++issued.current, next);
        // The step finished cleanly, whatever it found; a cancelled sign-in carries an error.
        return next.error === null;
      } catch (cause) {
        if (alive.current) setError(String(cause) || 'Error');
        return false;
      } finally {
        inflight.current = null;
        if (alive.current) setPending(null);
      }
    },
    [native, apply],
  );

  const polling = native && active;
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let reading = false;
    // This activation's own probe, made once the cached status says one is needed.
    let probe = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (reading) return;
      reading = true;
      clearTimeout(timer);
      const ticket = ++issued.current;
      try {
        apply(ticket, await readUpdateAccessStatus());
      } catch (cause) {
        if (!stopped && ticket >= applied.current) setError(String(cause) || 'Error');
      } finally {
        reading = false;
      }
      if (stopped) return;
      const now = latest.current;
      if (probe && now && ticket >= applied.current) {
        // Native already working, development or confirmed access: nothing to probe.
        probe = false;
        const settled =
          now.phase === 'development' || isBusy(now.phase) || updateAccessStep(now) === 'ready';
        if (!settled && !inflight.current) void run('check');
      }
      const busy = inflight.current !== null || isBusy(latest.current?.phase);
      // The probe above may have read status already; keep a single timer either way.
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), busy ? busyMs : idleMs);
    };
    pollNow.current = () => void poll();
    void poll();
    return () => {
      stopped = true;
      pollNow.current = null;
      clearTimeout(timer);
    };
  }, [polling, busyMs, idleMs, apply, run]);

  return {
    status,
    error,
    pending,
    busy: pending !== null || isBusy(status?.phase),
    check: useCallback(() => run('check'), [run]),
    login: useCallback(() => run('login'), [run]),
  };
}
