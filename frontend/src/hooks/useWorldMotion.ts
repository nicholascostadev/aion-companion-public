import { useCallback, useEffect, useRef, useState } from 'react';
import { isOlder } from '../lib/worldMotion';
import { onWorldMotion, readWorldMotion } from '../services/worldMotion';
import type { WorldMotionStatus } from '../types/worldMotion';
import { useNativeEvent } from './useNativeEvent';
import { useNativePoll } from './useNativePoll';

interface Options {
  /** Stop listening and reading (hidden window); what was received is forgotten. */
  paused?: boolean;
  /** A read now and then while listening, in case an event was missed. */
  resyncMs?: number;
  /** How often to read instead once the event could not be listened to. */
  fallbackMs?: number;
}

/**
 * Your position as native pushes it (`world-motion-updated`), the moment capture validates a
 * fix, changes context or lets a position or facing expire. Native does not replay events, so
 * it is read once the listener is registered and again every `resyncMs`. Reads and events
 * race: an event drops every read already in flight (it answers with state as new as theirs),
 * so neither a late read nor a late read failure undoes it, and whatever else is older than
 * the motion already held (see `isOlder`) is dropped, so you never move back. A failed read
 * with no event since forgets the motion: its last fix is not kept alive as if it were
 * current. Paused or unmounted, it stops and forgets.
 */
export function useWorldMotion(
  native: boolean,
  { paused = false, resyncMs = 1000, fallbackMs = 250 }: Options = {},
): WorldMotionStatus | null {
  const enabled = native && !paused;
  const [motion, setMotion] = useState<WorldMotionStatus | null>(null);
  const [listening, setListening] = useState(true);
  /** False while paused: a read started before the pause settles into nothing. */
  const live = useRef(false);

  const apply = useCallback((next: WorldMotionStatus) => {
    if (!live.current) return;
    setMotion((previous) => (previous && isOlder(next, previous) ? previous : next));
  }, []);
  const forget = useCallback(() => setMotion(null), []);

  // Nothing received before a pause is drawn again after it. Declared first, so the
  // schedule's first read and the listener already count as live.
  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    return () => {
      live.current = false;
      setMotion(null);
    };
  }, [enabled]);

  const { invalidate, refresh } = useNativePoll(readWorldMotion, {
    enabled,
    intervalMs: listening ? resyncMs : fallbackMs,
    onData: apply,
    onError: forget,
  });
  const pushed = (next: WorldMotionStatus) => {
    invalidate();
    apply(next);
  };
  useNativeEvent(onWorldMotion, pushed, {
    enabled,
    onReady: () => {
      setListening(true);
      void refresh();
    },
    onError: () => setListening(false),
  });

  return enabled ? motion : null;
}
