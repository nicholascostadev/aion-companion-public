import { useEffect, useRef, useState } from 'react';
import {
  readLiveStatus,
  resetLive,
  configureLive,
  saveLiveComparison,
} from '../services/companion';
import type { LiveStatus } from '../types/companion';
import { useNativeState } from './useNativeState';

/**
 * Native capture starts with the app; until its first status arrives it is connecting.
 * The placeholder carries no message: views word the connecting state themselves.
 */
const emptyLive: LiveStatus = {
  running: false,
  phase: 'starting',
  message: '',
  duration_ms: 0,
  events: 0,
  players: [],
  stats: {},
};

interface Options {
  /** Stop polling (e.g. a minimised workspace), keeping the last status. */
  paused?: boolean;
}

export function useLiveCapture(native: boolean, { paused = false }: Options = {}) {
  const { state, busy, error, readFailed, act } = useNativeState(native, readLiveStatus, {
    initial: emptyLive,
    intervalMs: 500,
    paused,
  });
  const [comparisonPath, setComparisonPath] = useState('');
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return {
    live: state,
    busy,
    error,
    /** The last poll failed: `live` is the last status native answered. */
    readFailed,
    comparisonPath,
    reset: () => act(resetLive),
    configure: (autoEnd: boolean, partyOnly: boolean) =>
      act(() => configureLive(autoEnd, partyOnly)),
    saveComparison: () =>
      act(async () => {
        const path = await saveLiveComparison();
        if (mounted.current) setComparisonPath(path);
        return readLiveStatus();
      }),
  };
}
