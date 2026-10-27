import { useMemo } from 'react';
import {
  hideActivityWindow,
  lockActivityWindow,
  markActivityWindowReady,
  readActivityWindowStatus,
  showActivityWindow,
} from '../services/activityWindows';
import {
  INITIAL_ACTIVITY_WINDOW,
  type ActivityWindowKind,
  type ActivityWindowStatus,
} from '../types/activityWindows';
import {
  useWindowController,
  type InGameWindowApi,
  type WindowControllerOptions,
} from './useWindowController';

/**
 * Native state of an in-game activity window, with one-at-a-time show, hide and lock
 * actions. `status` always follows native, so changes from other windows are picked up.
 */
export function useActivityWindow(kind: ActivityWindowKind, options: WindowControllerOptions = {}) {
  const api = useMemo<InGameWindowApi<ActivityWindowStatus>>(
    () => ({
      read: () => readActivityWindowStatus(kind),
      ready: () => markActivityWindowReady(kind),
      show: () => showActivityWindow(kind),
      hide: () => hideActivityWindow(kind),
      lock: (locked) => lockActivityWindow(kind, locked),
    }),
    [kind],
  );
  return useWindowController(api, INITIAL_ACTIVITY_WINDOW, options);
}

export type ActivityWindowController = ReturnType<typeof useActivityWindow>;
