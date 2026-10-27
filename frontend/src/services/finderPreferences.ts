import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  normalizeFinderPreferences,
  type FinderPreferencesBackend,
} from '../lib/finderPreferences';
import type { FinderPreferences, FinderPreferencesPatch } from '../types/finderPreferences';

/** Native's fresh choices after every saved change, from any window. */
export const FINDER_PREFERENCES_CHANGED = 'finder-preferences-changed';

/** The saved Explore choices; native's only durable home for them. */
export const readFinderPreferences = (): Promise<FinderPreferences> =>
  invoke<unknown>('finder_preferences').then(normalizeFinderPreferences);

/** Merges `patch` into the saved choices and answers them as saved. */
export const updateFinderPreferences = (
  patch: FinderPreferencesPatch,
): Promise<FinderPreferences> =>
  invoke<unknown>('finder_preferences_update', { patch }).then(normalizeFinderPreferences);

export const onFinderPreferencesChanged = (
  handler: (prefs: FinderPreferences) => void,
): Promise<() => void> =>
  listen<unknown>(FINDER_PREFERENCES_CHANGED, (event) => {
    // A malformed event is skipped; the next read or event brings the choices back.
    let prefs: FinderPreferences;
    try {
      prefs = normalizeFinderPreferences(event.payload);
    } catch {
      return;
    }
    handler(prefs);
  });

export const nativeFinderBackend: FinderPreferencesBackend = {
  read: readFinderPreferences,
  update: updateFinderPreferences,
  subscribe: onFinderPreferencesChanged,
};
