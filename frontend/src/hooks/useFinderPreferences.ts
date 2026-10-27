import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  createFinderPreferencesStore,
  memoryFinderBackend,
  type FinderPreferencesControl,
  type FinderPreferencesStore,
} from '../lib/finderPreferences';
import { nativeFinderBackend } from '../services/finderPreferences';
import { DEFAULT_FINDER_PREFERENCES } from '../types/finderPreferences';
import { usePageVisible } from './usePageVisible';

/**
 * The saved Explore choices this window draws and edits, kept for the caller's lifetime (the
 * window's app), so a tab shown again starts from them. Native's are read once, then
 * followed through its change events, and read again as a hidden window shows (an event it
 * may have slept through). Without the desktop app the choices start shown and are kept in
 * this window only.
 */
export function useFinderPreferences(native: boolean): FinderPreferencesControl {
  const [store] = useState<FinderPreferencesStore>(() =>
    native
      ? createFinderPreferencesStore(nativeFinderBackend)
      : createFinderPreferencesStore(memoryFinderBackend(), {
          initial: DEFAULT_FINDER_PREFERENCES,
        }),
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => (native ? store.connect() : undefined), [native, store]);
  const visible = usePageVisible();
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (native && visible && !wasVisible.current) void store.refresh();
    wasVisible.current = visible;
  }, [native, visible, store]);
  return { ...snapshot, update: store.update, retry: () => void store.refresh() };
}
