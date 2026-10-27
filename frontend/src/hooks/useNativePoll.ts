import { useCallback, useEffect, useRef } from 'react';

export interface PollOptions<T> {
  /** Reads only while true; false stops the schedule and keeps whatever was applied. */
  enabled: boolean;
  intervalMs: number;
  /** Receives every read that is still current (see `invalidate`). */
  onData: (value: T) => void;
  onError: (message: string) => void;
  /** Checked before each scheduled read, e.g. to wait while a write is in flight. */
  skip?: () => boolean;
}

/**
 * Reads native state at once and then every `intervalMs` while `enabled`. Scheduled reads
 * never overlap. Every read, scheduled or `refresh`, is numbered when it starts and only
 * the newest one to settle reaches a handler: a read is dropped if a later read already
 * settled (success or failure), if it settles after `invalidate()` (a write that started
 * meanwhile answers with newer state), after `read` was replaced, after its schedule
 * stopped or after unmount. A new `read` (e.g. another profile) restarts the schedule at
 * once; keep it stable with `useCallback`. The handlers may change on every render.
 */
export function useNativePoll<T>(
  read: () => Promise<T>,
  { enabled, intervalMs, onData, onError, skip }: PollOptions<T>,
) {
  /** Number of the newest read started. */
  const issued = useRef(0);
  /** Reads numbered up to here are dropped: invalidated, replaced or already overtaken. */
  const floor = useRef(0);
  const current = useRef(read);
  const mounted = useRef(false);
  const handlers = useRef({ onData, onError, skip });
  useEffect(() => {
    handlers.current = { onData, onError, skip };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Declared before the schedule so its first read already counts as current.
  useEffect(() => {
    if (current.current === read) return;
    current.current = read;
    floor.current = issued.current;
  }, [read]);

  /** Runs one numbered read of `source`; `live` says whether its caller still wants it. */
  const run = useCallback(async (source: () => Promise<T>, live: () => boolean) => {
    const request = ++issued.current;
    const wanted = () => live() && source === current.current && request > floor.current;
    try {
      const value = await source();
      if (!wanted()) return;
      floor.current = request;
      handlers.current.onData(value);
    } catch (cause) {
      if (!wanted()) return;
      floor.current = request;
      handlers.current.onError(String(cause));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let reading = false;
    const tick = async () => {
      if (stopped || reading || handlers.current.skip?.()) return;
      reading = true;
      try {
        await run(read, () => !stopped);
      } finally {
        reading = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, read, run]);

  /** Drops every read already in flight; call it when a write starts and when it settles. */
  const invalidate = useCallback(() => {
    floor.current = issued.current;
  }, []);

  /**
   * One read of the current `read` outside the schedule (e.g. after a save elsewhere),
   * also while the schedule is disabled; ordered and dropped like any other read.
   */
  const refresh = useCallback(() => run(current.current, () => mounted.current), [run]);

  return { invalidate, refresh };
}
