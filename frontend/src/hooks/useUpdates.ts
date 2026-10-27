import { useCallback, useEffect, useRef, useState } from 'react';
import { BUSY_PHASES, readUpdateStatus, runUpdateAction } from '../services/updates';
import type { UpdateAction, UpdatePhase, UpdateStatus, UpdatesState } from '../types/updates';

const isBusy = (phase: UpdatePhase | null | undefined) => !!phase && BUSY_PHASES.includes(phase);

/**
 * Update status while `active` (the Updates view is visible): polls quickly while native is
 * working, slowly otherwise, and not at all while hidden. Native owns the operation, so hiding
 * the view never cancels a check or download; showing it again picks the progress back up from
 * status. Results older than the newest one shown are dropped, and nothing is applied after
 * unmount.
 */
export function useUpdates(
  native: boolean,
  { active = true, busyMs = 1000, idleMs = 5000 } = {},
): UpdatesState {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<UpdateAction | null>(null);
  const alive = useRef(false);
  const issued = useRef(0);
  const applied = useRef(0);
  const phase = useRef<UpdatePhase | null>(null);
  const inflight = useRef<UpdateAction | null>(null);
  const pollNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((ticket: number, next: UpdateStatus) => {
    if (!alive.current || ticket < applied.current) return;
    applied.current = ticket;
    phase.current = next.phase;
    setStatus(next);
    setError('');
  }, []);

  const polling = native && active;
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (reading) return;
      reading = true;
      clearTimeout(timer);
      const ticket = ++issued.current;
      try {
        apply(ticket, await readUpdateStatus());
      } catch (cause) {
        if (!stopped && ticket >= applied.current) setError(String(cause));
      } finally {
        reading = false;
      }
      if (stopped) return;
      const busy = inflight.current !== null || isBusy(phase.current);
      timer = setTimeout(() => void poll(), busy ? busyMs : idleMs);
    };
    pollNow.current = () => void poll();
    void poll();
    return () => {
      stopped = true;
      pollNow.current = null;
      clearTimeout(timer);
    };
  }, [polling, busyMs, idleMs, apply]);

  /** Runs one step; ignored while another step is running here or natively. */
  const run = useCallback(
    async (action: UpdateAction) => {
      if (!native || phase.current === 'development' || inflight.current || isBusy(phase.current))
        return false;
      inflight.current = action;
      setPending(action);
      setError('');
      try {
        const result = runUpdateAction(action);
        // Native flips to a busy phase as soon as it starts; show it without waiting.
        pollNow.current?.();
        const next = await result;
        apply(++issued.current, next);
        return next.phase !== 'error';
      } catch (cause) {
        if (alive.current) setError(String(cause));
        return false;
      } finally {
        inflight.current = null;
        if (alive.current) setPending(null);
      }
    },
    [native, apply],
  );

  return {
    status,
    error,
    pending,
    busy: pending !== null || isBusy(status?.phase),
    check: useCallback(() => run('check'), [run]),
    download: useCallback(() => run('download'), [run]),
    install: useCallback(() => run('install'), [run]),
  };
}
