import { useEffect, useState } from 'react';
import { readTimersStatus } from '../services/timers';
import type { TimersStatus } from '../types/timers';

interface Options {
  intervalMs?: number;
  paused?: boolean;
}
/** Keep native time anchored to elapsed time; wake/reconnect always fetch a new snapshot. */
export function useTimers(native: boolean, { intervalMs = 15_000, paused = false }: Options = {}) {
  const [snapshot, setSnapshot] = useState<{
    status: TimersStatus;
    received: number;
    monotonic: number;
  } | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(false);
  const [source, setSource] = useState({ native, paused });
  // A resumed overlay needs a new snapshot before showing any live state.
  if (source.native !== native || source.paused !== paused) {
    setSource({ native, paused });
    setFresh(false);
  }

  useEffect(() => {
    if (!native || paused) return;
    let cancelled = false;
    let inFlight = false;
    const read = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const status = await readTimersStatus();
        if (!cancelled) {
          setSnapshot({ status, received: Date.now(), monotonic: performance.now() });
          setNow(status.now_ms);
          setError(status.error ?? '');
          setFresh(!status.error);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(String(cause));
          setFresh(false);
        }
      } finally {
        inFlight = false;
      }
    };
    const wake = () => {
      setFresh(false);
      void read();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    void read();
    const poll = setInterval(() => void read(), intervalMs);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [native, intervalMs, paused]);

  useEffect(() => {
    if (!snapshot || paused || !native) return;
    const tick = () => {
      // Wall time includes system sleep; monotonic time resists a local clock correction.
      const elapsed = Math.max(
        0,
        performance.now() - snapshot.monotonic,
        Date.now() - snapshot.received,
      );
      setNow(snapshot.status.now_ms + elapsed);
      if (elapsed > Math.max(45_000, intervalMs * 3)) setFresh(false);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [snapshot, intervalMs, paused, native]);

  return { status: snapshot?.status ?? null, now, error, stale: !fresh || paused || !native };
}
