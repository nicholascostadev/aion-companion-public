import { useCallback } from 'react';
import { isNative } from '../services/companion';
import { useNativeState } from './useNativeState';

/** The fields every in-game window reports. */
export interface InGameWindowStatus {
  /** User asked for the window; it still only shows while the game is focused. */
  requested: boolean;
  visible: boolean;
  locked: boolean;
}

/** Native commands of one in-game window. Keep the object stable (module constant or memo). */
export interface InGameWindowApi<S> {
  read: () => Promise<S>;
  /** Called by the window itself once it can render. */
  ready: () => Promise<void>;
  show: () => Promise<S>;
  hide: () => Promise<S>;
  lock: (locked: boolean) => Promise<S>;
}

export interface WindowControllerOptions {
  /** The window itself reports ready once. */
  markReady?: boolean;
  intervalMs?: number;
  /** Stop polling, keeping the last state. */
  paused?: boolean;
}

/**
 * Native state of an in-game window, with one-at-a-time show, hide and lock actions.
 * `status` always follows native, so changes from other windows are picked up.
 */
export function useWindowController<S extends InGameWindowStatus>(
  api: InGameWindowApi<S>,
  initial: S,
  { markReady = false, intervalMs = 750, paused = false }: WindowControllerOptions = {},
) {
  const native = isNative();
  const { state, known, busy, error, latest, act } = useNativeState(native, api.read, {
    initial,
    intervalMs,
    paused,
    markReady: markReady ? api.ready : undefined,
  });
  const show = useCallback(() => act(api.show), [act, api]);
  const hide = useCallback(() => act(api.hide), [act, api]);
  const toggle = useCallback(
    () => act(() => (latest.current.requested ? api.hide() : api.show())),
    [act, api, latest],
  );
  const lock = useCallback((locked: boolean) => act(() => api.lock(locked)), [act, api]);
  return { native, status: state, known, busy, error, show, hide, toggle, lock };
}
