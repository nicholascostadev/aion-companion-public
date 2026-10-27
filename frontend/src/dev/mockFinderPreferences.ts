import { applyPatch, hiddenResourceKeys } from '../lib/finderPreferences';
import { DEFAULT_FINDER_PREFERENCES, type FinderPreferences } from '../types/finderPreferences';

/*
 * DEV ONLY. The saved Explore choices of the mock runtime, kept in this browser's storage and
 * broadcast to its other mock pages, so a workspace preview and an `?view=explore&mock`
 * preview show the same choices, like native's single file and change event.
 */

const KEY = 'aion-mock-finder-preferences';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(KEY);

const load = (): FinderPreferences => {
  try {
    const stored = localStorage.getItem(KEY);
    return stored ? (JSON.parse(stored) as FinderPreferences) : DEFAULT_FINDER_PREFERENCES;
  } catch {
    return DEFAULT_FINDER_PREFERENCES;
  }
};

export const finderPreferences = () => load();

/** Merges like native: nested parts field by field, hidden keys sorted and unique. */
export function updateFinderPreferences(
  patch: unknown,
  emit: (event: string, payload: unknown) => void,
): FinderPreferences {
  const p = (patch ?? {}) as Parameters<typeof applyPatch>[1];
  const current = load();
  const merged = applyPatch(current, p);
  const next: FinderPreferences = {
    ...merged,
    hidden_resources: hiddenResourceKeys(merged.hidden_resources),
    revision: current.revision + 1,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  emit('finder-preferences-changed', next);
  channel?.postMessage(next);
  return next;
}

/** Delivers other mock pages' saved changes as native's change event. */
export function followFinderPreferences(emit: (event: string, payload: unknown) => void) {
  channel?.addEventListener('message', (event: MessageEvent<unknown>) =>
    emit('finder-preferences-changed', event.data),
  );
}
