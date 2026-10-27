import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FINDER_PREFERENCES, type FinderPreferences } from '../types/finderPreferences';
import {
  applyPatch,
  createFinderPreferencesStore,
  hiddenResourceKeys,
  mergePatches,
  normalizeFinderPreferences,
  type FinderPreferencesBackend,
} from './finderPreferences';

const prefs = (over: Partial<FinderPreferences> = {}): FinderPreferences => ({
  ...DEFAULT_FINDER_PREFERENCES,
  ...over,
});

/** A promise settled by the test. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A native stand-in whose reads, saves and events the test answers by hand. */
function manualBackend() {
  const reads: ReturnType<typeof deferred<FinderPreferences>>[] = [];
  const updates: { patch: unknown; answer: ReturnType<typeof deferred<FinderPreferences>> }[] = [];
  let emit: (prefs: FinderPreferences) => void = () => undefined;
  const backend: FinderPreferencesBackend = {
    read: () => {
      const answer = deferred<FinderPreferences>();
      reads.push(answer);
      return answer.promise;
    },
    update: (patch) => {
      const answer = deferred<FinderPreferences>();
      updates.push({ patch, answer });
      return answer.promise;
    },
    subscribe: (handler) => {
      emit = handler;
      return Promise.resolve(() => {
        emit = () => undefined;
      });
    },
  };
  return { backend, reads, updates, emit: (p: FinderPreferences) => emit(p) };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('saved Explore choices', () => {
  it('reads native strictly and never guesses a malformed answer', () => {
    expect(normalizeFinderPreferences(prefs({ revision: 3, chosen_map: 'World/x' }))).toEqual(
      prefs({ revision: 3, chosen_map: 'World/x' }),
    );
    for (const bad of [
      null,
      { ...prefs(), revision: -1 },
      { ...prefs(), revision: 1.5 },
      { ...prefs(), chosen_map: 3 },
      { ...prefs(), visibility: { cubes: true } },
      {
        ...prefs(),
        cube_layers: { nearby: true, earlier: 'yes', possible: true },
      },
      { ...prefs(), hidden_resources: [1] },
    ])
      expect(() => normalizeFinderPreferences(bad)).toThrow(/^Native returned no /);
  });

  it('merges nested changes field by field and keeps hidden keys as native does', () => {
    const base = prefs({ revision: 2 });
    expect(applyPatch(base, { visibility: { cubes: false } })).toEqual(
      prefs({ revision: 2, visibility: { cubes: false, gathering: true } }),
    );
    expect(
      mergePatches(
        { visibility: { cubes: false }, chosen_map: 'a' },
        { visibility: { gathering: false } },
      ),
    ).toEqual({ chosen_map: 'a', visibility: { cubes: false, gathering: false } });
    expect(mergePatches({ chosen_map: 'a' }, { chosen_map: null })).toEqual({ chosen_map: null });
    expect(hiddenResourceKeys(['item:20', 'env:4', 'item:3', 'item:20', 'item:x'])).toEqual([
      'item:20',
      'item:3',
    ]);
    expect(hiddenResourceKeys(Array.from({ length: 200 }, (_, i) => `item:${i}`))).toHaveLength(
      128,
    );
  });

  it('shows nothing and saves nothing until the first answer, which a newer event outranks', async () => {
    const native = manualBackend();
    const store = createFinderPreferencesStore(native.backend);
    expect(store.getSnapshot()).toMatchObject({ prefs: null, phase: 'loading' });
    store.update({ visibility: { cubes: false } });
    expect(native.updates).toHaveLength(0);
    const stop = store.connect();
    await flush();
    expect(native.reads).toHaveLength(1);
    // Another window saved while this read was in flight: its event is newer.
    native.emit(prefs({ revision: 5, visibility: { cubes: false, gathering: true } }));
    expect(store.getSnapshot()).toMatchObject({ phase: 'ready', prefs: { revision: 5 } });
    native.reads[0]!.resolve(prefs({ revision: 4 }));
    await flush();
    expect(store.getSnapshot().prefs).toEqual(
      prefs({ revision: 5, visibility: { cubes: false, gathering: true } }),
    );
    stop();
  });

  it('shows a change at once and keeps it over older answers until native answers it', async () => {
    const native = manualBackend();
    const store = createFinderPreferencesStore(native.backend, { initial: prefs({ revision: 1 }) });
    store.connect();
    await flush();
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    store.update({ visibility: { gathering: false } });
    expect(store.getSnapshot()).toMatchObject({
      saving: true,
      prefs: { visibility: { cubes: true, gathering: false } },
    });
    expect(listener).toHaveBeenCalled();
    // An event from another window (older than this save) never undoes the pending change.
    native.emit(
      prefs({ revision: 2, cube_layers: { nearby: false, earlier: true, possible: true } }),
    );
    expect(store.getSnapshot().prefs).toMatchObject({
      revision: 2,
      visibility: { gathering: false },
      cube_layers: { nearby: false },
    });
    // Saves are one at a time; later changes wait, merged into one.
    store.update({ visibility: { cubes: false } });
    store.update({ chosen_map: 'World/x' });
    expect(native.updates).toHaveLength(1);
    native.updates[0]!.answer.resolve(
      prefs({
        revision: 3,
        visibility: { cubes: true, gathering: false },
        cube_layers: { nearby: false, earlier: true, possible: true },
      }),
    );
    await flush();
    expect(native.updates).toHaveLength(2);
    expect(native.updates[1]!.patch).toEqual({
      visibility: { cubes: false },
      chosen_map: 'World/x',
    });
    // A late reply for the first save (older revision) is ignored.
    native.emit(prefs({ revision: 2 }));
    expect(store.getSnapshot().prefs).toMatchObject({
      chosen_map: 'World/x',
      visibility: { cubes: false, gathering: false },
    });
    native.updates[1]!.answer.resolve(
      prefs({
        revision: 4,
        chosen_map: 'World/x',
        visibility: { cubes: false, gathering: false },
        cube_layers: { nearby: false, earlier: true, possible: true },
      }),
    );
    await flush();
    expect(store.getSnapshot()).toMatchObject({ saving: false, error: '', prefs: { revision: 4 } });
  });

  it('drops a change native could not save, showing the saved choices and why', async () => {
    const native = manualBackend();
    const store = createFinderPreferencesStore(native.backend, {
      initial: prefs({ revision: 7, hidden_resources: ['item:1'] }),
    });
    store.update({ hidden_resources: ['item:1', 'item:2'] });
    store.update({ visibility: { cubes: false } });
    expect(store.getSnapshot().prefs?.hidden_resources).toEqual(['item:1', 'item:2']);
    native.updates[0]!.answer.reject(new Error('Could not write the file'));
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      error: 'Could not write the file',
      prefs: { revision: 7, hidden_resources: ['item:1'], visibility: { cubes: false } },
    });
    native.updates[1]!.answer.resolve(
      prefs({
        revision: 8,
        hidden_resources: ['item:1'],
        visibility: { cubes: false, gathering: true },
      }),
    );
    await flush();
    expect(store.getSnapshot()).toMatchObject({ error: '', saving: false, prefs: { revision: 8 } });
  });

  it('reports a failed first read and recovers on a later one', async () => {
    const native = manualBackend();
    const store = createFinderPreferencesStore(native.backend);
    const stop = store.connect();
    await flush();
    native.reads[0]!.reject(new Error('Native unavailable'));
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      phase: 'failed',
      prefs: null,
      error: 'Native unavailable',
    });
    const retry = store.refresh();
    // A second refresh while one runs reads again after it, never two at once.
    void store.refresh();
    native.reads[1]!.resolve(prefs({ revision: 1 }));
    await flush();
    expect(native.reads).toHaveLength(3);
    native.reads[2]!.resolve(prefs({ revision: 1 }));
    await retry;
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      error: '',
      prefs: { revision: 1 },
    });
    stop();
    // Disconnected, events no longer reach it.
    native.emit(prefs({ revision: 9 }));
    expect(store.getSnapshot().prefs?.revision).toBe(1);
  });
});
