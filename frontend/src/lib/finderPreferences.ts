import {
  DEFAULT_FINDER_PREFERENCES,
  type FinderPreferences,
  type FinderPreferencesPatch,
} from '../types/finderPreferences';

/*
 * The saved Explore choices as one window sees them: native's newest answer, with this
 * window's changes that native has not answered yet drawn over it, so a toggle shows at
 * once and an older answer (a late read, a reordered event) never undoes it.
 */

/** Hidden resource keys native accepts: a gathered item's stable id. */
const RESOURCE_KEY = /^item:\d+$/;
/** Most resources native keeps hidden. */
export const MAX_HIDDEN_RESOURCES = 128;

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Native returned no ${what}`);
  return value as Record<string, unknown>;
};
const flag = (from: Record<string, unknown>, key: string): boolean => {
  const value = from[key];
  if (typeof value !== 'boolean') throw new Error(`Native returned no Explore ${key}`);
  return value;
};

/** Native's answer, checked field by field; anything malformed is an error, never a guess. */
export function normalizeFinderPreferences(value: unknown): FinderPreferences {
  const raw = record(value, 'Explore preferences');
  const revision = raw.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Native returned no Explore preferences revision');
  const chosen = raw.chosen_map;
  if (chosen !== null && typeof chosen !== 'string')
    throw new Error('Native returned no Explore map choice');
  const visibility = record(raw.visibility, 'Explore layers');
  const layers = record(raw.cube_layers, 'Explore cube layers');
  const hidden = raw.hidden_resources;
  if (!Array.isArray(hidden) || hidden.some((key) => typeof key !== 'string'))
    throw new Error('Native returned no hidden resources');
  return {
    revision,
    chosen_map: chosen,
    visibility: { cubes: flag(visibility, 'cubes'), gathering: flag(visibility, 'gathering') },
    cube_layers: {
      nearby: flag(layers, 'nearby'),
      earlier: flag(layers, 'earlier'),
      possible: flag(layers, 'possible'),
    },
    hidden_resources: hidden as string[],
  };
}

/** Hidden resources as native keeps them: valid keys only, unique and sorted, at most 128. */
export const hiddenResourceKeys = (keys: Iterable<string>): string[] =>
  [...new Set([...keys].filter((key) => RESOURCE_KEY.test(key)))]
    .sort()
    .slice(0, MAX_HIDDEN_RESOURCES);

/** `prefs` with `patch` over it; the revision is kept (only native moves it). */
export function applyPatch(
  prefs: FinderPreferences,
  patch: FinderPreferencesPatch,
): FinderPreferences {
  return {
    revision: prefs.revision,
    chosen_map: patch.chosen_map === undefined ? prefs.chosen_map : patch.chosen_map,
    visibility: patch.visibility ? { ...prefs.visibility, ...patch.visibility } : prefs.visibility,
    cube_layers: patch.cube_layers
      ? { ...prefs.cube_layers, ...patch.cube_layers }
      : prefs.cube_layers,
    hidden_resources: patch.hidden_resources ?? prefs.hidden_resources,
  };
}

/** One patch that does what `a` then `b` do. */
export function mergePatches(
  a: FinderPreferencesPatch,
  b: FinderPreferencesPatch,
): FinderPreferencesPatch {
  const merged: FinderPreferencesPatch = { ...a };
  if (b.chosen_map !== undefined) merged.chosen_map = b.chosen_map;
  if (b.visibility) merged.visibility = { ...a.visibility, ...b.visibility };
  if (b.cube_layers) merged.cube_layers = { ...a.cube_layers, ...b.cube_layers };
  if (b.hidden_resources) merged.hidden_resources = b.hidden_resources;
  return merged;
}

export interface FinderPreferencesBackend {
  read: () => Promise<FinderPreferences>;
  update: (patch: FinderPreferencesPatch) => Promise<FinderPreferences>;
  /** Native's fresh state after every saved change, from any window. */
  subscribe: (handler: (prefs: FinderPreferences) => void) => Promise<() => void>;
}

export interface FinderPreferencesSnapshot {
  /** The saved choices with this window's unsaved changes over them; null until known. */
  prefs: FinderPreferences | null;
  /** `loading` until the first answer; `failed` when that could not be read. */
  phase: 'loading' | 'ready' | 'failed';
  /** A change is being saved. */
  saving: boolean;
  /** The last failed read or save; cleared by the next success. */
  error: string;
}

export interface FinderPreferencesStore {
  getSnapshot: () => FinderPreferencesSnapshot;
  /** For `useSyncExternalStore`: called after every change of the snapshot. */
  subscribe: (listener: () => void) => () => void;
  /** Listens for native's changes, then reads once; returns the disconnect. */
  connect: () => () => void;
  /** Reads again (one at a time): to recover, or as the window shows again. */
  refresh: () => Promise<void>;
  /**
   * Saves a change; shown at once and kept over any older answer until native answers it.
   * Ignored until the saved choices are known, so defaults never replace them.
   */
  update: (patch: FinderPreferencesPatch) => void;
}

/**
 * Keeps one window's view of the saved Explore choices. Native answers (reads, saves and
 * change events) are full states: each is taken only when newer than the one held, so
 * replies and events may arrive in any order. Saves run one at a time, in order; changes
 * made while one runs are merged into the next. A failed save drops its change, and what
 * is shown falls back to the saved choices (with any later change still over them).
 */
export function createFinderPreferencesStore(
  backend: FinderPreferencesBackend,
  {
    report,
    initial = null,
  }: {
    report?: (source: string, cause: unknown) => void;
    /** Choices already known (a store kept in this window only): ready at once. */
    initial?: FinderPreferences | null;
  } = {},
): FinderPreferencesStore {
  let confirmed: FinderPreferences | null = initial;
  /** Unsaved changes in order; the first is being saved while `writing`. */
  let queue: FinderPreferencesPatch[] = [];
  let writing = false;
  let failedRead = false;
  let error = '';
  let reading: Promise<void> | null = null;
  let again = false;
  let snapshot: FinderPreferencesSnapshot = {
    prefs: initial,
    phase: initial ? 'ready' : 'loading',
    saving: false,
    error: '',
  };
  const listeners = new Set<() => void>();

  const publish = () => {
    const prefs = confirmed && queue.reduce(applyPatch, confirmed);
    snapshot = {
      prefs,
      phase: confirmed ? 'ready' : failedRead ? 'failed' : 'loading',
      saving: queue.length > 0,
      error,
    };
    for (const listener of listeners) listener();
  };

  const receive = (next: FinderPreferences) => {
    if (confirmed && next.revision <= confirmed.revision) return false;
    confirmed = next;
    return true;
  };

  const fail = (source: string, cause: unknown) => {
    error = cause instanceof Error ? cause.message : String(cause);
    report?.(source, cause);
  };

  const readLatest = async () => {
    do {
      again = false;
      try {
        receive(await backend.read());
        failedRead = false;
        error = '';
      } catch (cause) {
        if (!confirmed) failedRead = true;
        fail('explore:read', cause);
      }
      publish();
    } while (again);
  };

  const refresh = () => {
    if (reading) {
      again = true;
      return reading;
    }
    reading = readLatest().finally(() => {
      reading = null;
    });
    return reading;
  };

  const pump = async () => {
    writing = true;
    while (queue.length) {
      const patch = queue[0]!;
      try {
        receive(await backend.update(patch));
        error = '';
      } catch (cause) {
        fail('explore:save', cause);
      }
      queue = queue.slice(1);
      publish();
    }
    writing = false;
  };

  const update = (patch: FinderPreferencesPatch) => {
    if (!confirmed) return;
    // A change waiting behind the one being saved is merged with it: one save, in order.
    const last = queue.length - 1;
    if (last >= (writing ? 1 : 0))
      queue = [...queue.slice(0, last), mergePatches(queue[last]!, patch)];
    else queue = [...queue, patch];
    publish();
    if (!writing) void pump();
  };

  const connect = () => {
    let active = true;
    let stop: (() => void) | null = null;
    void backend
      .subscribe((next) => {
        if (active && receive(next)) {
          failedRead = false;
          publish();
        }
      })
      .then(
        (unsubscribe) => {
          if (active) stop = unsubscribe;
          else unsubscribe();
        },
        (cause: unknown) => {
          if (active) {
            fail('explore:listen', cause);
            publish();
          }
        },
      )
      // Registered first, so no change saved between the read and the listener is missed.
      .finally(() => {
        if (active) void refresh();
      });
    return () => {
      active = false;
      stop?.();
    };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect,
    refresh,
    update,
  };
}

/** A backend kept in this window only: previews without the desktop app, and tests. */
export function memoryFinderBackend(
  initial: FinderPreferences = DEFAULT_FINDER_PREFERENCES,
): FinderPreferencesBackend {
  let state = initial;
  return {
    read: () => Promise.resolve(state),
    update: (patch) => {
      state = { ...applyPatch(state, patch), revision: state.revision + 1 };
      return Promise.resolve(state);
    },
    subscribe: () => Promise.resolve(() => undefined),
  };
}

/** What a view is given to draw and edit the saved choices (see `useFinderPreferences`). */
export interface FinderPreferencesControl extends FinderPreferencesSnapshot {
  update: (patch: FinderPreferencesPatch) => void;
  /** Reads the saved choices again, after a failed read. */
  retry: () => void;
}
