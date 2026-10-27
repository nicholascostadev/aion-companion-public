import { useCallback, useRef, useState } from 'react';
import {
  freshIds,
  NO_DETECTIONS,
  trackDetections,
  type DetectionTracker,
} from '../features/cubes/model';
import { withoutGeometry } from '../lib/cubesNormalize';
import { clearCubes, readCubesStatus } from '../services/cubes';
import type { CubesStatus } from '../types/cubes';
import { useNativePoll } from './useNativePoll';

interface Options {
  /** Stop reading (hidden window or tab); the last status stays until the next read. */
  paused?: boolean;
  intervalMs?: number;
}

/**
 * Nearby cube observations, read every `intervalMs` while shown. Clear is one at a time:
 * reads already in flight are dropped and the poll waits until Clear answers, so an older
 * snapshot never brings cleared rows back. Within a session an older revision is ignored.
 * `fresh` holds the cubes that arrived after this window's first snapshot of the session.
 * A failed read keeps the rows but drops every measurement from you (position, distance,
 * height, direction), so an old distance is never shown as current.
 */
export function useCubes(native: boolean, { paused = false, intervalMs = 250 }: Options = {}) {
  const [status, setStatus] = useState<CubesStatus | null>(null);
  const [error, setError] = useState('');
  const [detections, setDetections] = useState<{
    tracker: DetectionTracker;
    fresh: ReadonlySet<number>;
  }>({ tracker: NO_DETECTIONS, fresh: new Set() });
  const [clearing, setClearing] = useState(false);
  const latest = useRef<CubesStatus | null>(null);
  const busy = useRef(false);

  const apply = useCallback((next: CubesStatus) => {
    const previous = latest.current;
    if (previous?.session_id === next.session_id && next.revision < previous.revision) return;
    latest.current = next;
    setStatus(next);
    setError('');
    const now = Date.now();
    // Marks expire on the next read; nothing changes while no cube arrives or expires.
    setDetections((current) => {
      const tracker = trackDetections(current.tracker, next, now);
      return tracker === current.tracker ? current : { tracker, fresh: freshIds(tracker, now) };
    });
  }, []);

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus((current) => current && withoutGeometry(current));
    // Marks expire only on a successful read, so a failing one lets them go at once.
    setDetections((current) =>
      current.tracker.arrived.size === 0
        ? current
        : { tracker: { ...current.tracker, arrived: new Map() }, fresh: new Set() },
    );
  }, []);

  const { invalidate } = useNativePoll(readCubesStatus, {
    enabled: native && !paused,
    intervalMs,
    onData: apply,
    onError: fail,
    skip: () => busy.current,
  });

  const clear = useCallback(async () => {
    if (!native || busy.current) return;
    busy.current = true;
    setClearing(true);
    invalidate();
    try {
      const next = await clearCubes();
      invalidate();
      latest.current = null;
      apply(next);
    } catch (cause) {
      fail(String(cause));
    } finally {
      busy.current = false;
      setClearing(false);
    }
  }, [native, invalidate, apply, fail]);

  return { status: native ? status : null, error, fresh: detections.fresh, clearing, clear };
}

export type CubesController = ReturnType<typeof useCubes>;
