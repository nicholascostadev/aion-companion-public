import { useState, useSyncExternalStore } from 'react';
import {
  createFinderPreferencesStore,
  memoryFinderBackend,
  type FinderPreferencesBackend,
  type FinderPreferencesControl,
  type FinderPreferencesStore,
} from '../../lib/finderPreferences';
import { DEFAULT_FINDER_PREFERENCES, type FinderPreferences } from '../../types/finderPreferences';

/*
 * TEST ONLY. Saved Explore choices for views under test: a real store over a backend kept
 * in memory (or one a test provides), ready at once unless asked to start unknown.
 */

export function testPrefsStore(
  initial: FinderPreferences | null = DEFAULT_FINDER_PREFERENCES,
  backend: FinderPreferencesBackend = memoryFinderBackend(initial ?? DEFAULT_FINDER_PREFERENCES),
): FinderPreferencesStore {
  return createFinderPreferencesStore(backend, { initial });
}

/** The control a view is given, over `store`. */
export function usePrefsControl(store: FinderPreferencesStore): FinderPreferencesControl {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, update: store.update, retry: () => void store.refresh() };
}

/** A store of this component's own, kept across rerenders. */
export function useTestPrefs(initial?: FinderPreferences | null): FinderPreferencesControl {
  const [store] = useState(() => testPrefsStore(initial));
  return usePrefsControl(store);
}
