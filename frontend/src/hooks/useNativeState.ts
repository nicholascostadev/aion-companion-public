import { useCallback, useEffect, useRef, useState } from 'react';
import { useNativePoll } from './useNativePoll';

interface Options<S> {
  /** Shown until the first read; `known` stays false until then. */
  initial: S;
  /** Fixed, or derived from the state shown now (e.g. a refresh-rate setting). */
  intervalMs: number | ((state: S) => number);
  /** Stop reading, keeping the last state. Actions still run. */
  paused?: boolean;
  /** Re-read at once after a failed action, so the view shows what native actually did. */
  refreshAfterError?: boolean;
  /**
   * A successful read also clears a failed action's message. By default an action's
   * message stays until the next successful action, and a read's until the next read.
   */
  readClearsActionError?: boolean;
  /** Also receives action failures, e.g. to surface them in a page status. */
  onActionError?: ((message: string) => void) | undefined;
  /** Reported once natively while mounted (e.g. `overlay_ready`); keep it stable. */
  markReady?: (() => Promise<void>) | undefined;
}

/**
 * Native state that is polled and changed by one action at a time. `state` always follows
 * native, so changes made by hotkeys, the tray or other windows are picked up; polls wait
 * while an action runs, and a read that started before an action settled is dropped, so
 * the action's answer is never overwritten by an older one. A `refresh` asked for while an
 * action runs is held and read once it settles (several requests share that one read).
 */
export function useNativeState<S>(
  native: boolean,
  read: () => Promise<S>,
  {
    initial,
    intervalMs,
    paused = false,
    refreshAfterError = false,
    readClearsActionError = false,
    onActionError,
    markReady,
  }: Options<S>,
) {
  const [state, setState] = useState<S>(initial);
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  /** The state shown now, for actions that depend on it (e.g. a toggle). */
  const latest = useRef(state);
  const acting = useRef(false);
  /** Settles a `refresh` asked for while an action ran, once its held read is done. */
  const held = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const mounted = useRef(false);
  const onActionErrorRef = useRef(onActionError);
  useEffect(() => {
    onActionErrorRef.current = onActionError;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A failed ready report stays shown like a failed action: nothing retries it.
  useEffect(() => {
    if (!native || !markReady) return;
    let cancelled = false;
    void markReady().catch((cause: unknown) => {
      if (!cancelled) setActionError(String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [native, markReady]);

  const apply = useCallback((next: S) => {
    latest.current = next;
    if (!mounted.current) return;
    setState(next);
    setKnown(true);
  }, []);

  const { invalidate, refresh: readNow } = useNativePoll(read, {
    enabled: native && !paused,
    intervalMs: typeof intervalMs === 'function' ? intervalMs(state) : intervalMs,
    skip: () => acting.current,
    onData: (next) => {
      apply(next);
      setReadError('');
      if (readClearsActionError) setActionError('');
    },
    onError: setReadError,
  });

  /** Reads once now, or right after the running action settles. */
  const refresh = useCallback((): Promise<void> => {
    if (!acting.current) return readNow();
    if (!held.current) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      held.current = { promise, resolve };
    }
    return held.current.promise;
  }, [readNow]);

  /** Runs one action at a time; a `null` result keeps the current state (e.g. quit). */
  const act = useCallback(
    async (operation: () => Promise<S | null>) => {
      if (!native || acting.current) return false;
      acting.current = true;
      invalidate();
      setBusy(true);
      try {
        const next = await operation();
        if (next !== null) apply(next);
        if (mounted.current) setActionError('');
        return true;
      } catch (cause) {
        const message = String(cause);
        if (mounted.current) setActionError(message);
        onActionErrorRef.current?.(message);
        if (refreshAfterError) {
          // Still part of the action, so no other read lands in between.
          try {
            apply(await read());
          } catch {
            // The next poll retries.
          }
        }
        return false;
      } finally {
        // Any read that started while the action ran answers for older state.
        invalidate();
        acting.current = false;
        if (mounted.current) setBusy(false);
        const waiting = held.current;
        held.current = null;
        if (waiting) void readNow().then(waiting.resolve);
      }
    },
    [native, invalidate, readNow, apply, read, refreshAfterError],
  );

  return {
    state,
    known,
    busy,
    error: actionError || readError,
    /** The last read failed, so `state` is the last one native answered, not now's. */
    readFailed: readError !== '',
    latest,
    act,
    refresh,
  };
}
