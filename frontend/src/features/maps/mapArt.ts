import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { MapArtSnapshot, MapArtSource, MapArtView } from '../../types/mapArt';
import type { PetMapArt } from '../../types/pets';

/*
 * Original map art is downloaded per map on first use. The app provides where its maps get
 * their art (`MapArtProvider`, see `hooks/mapArtStore.ts`); a map view asks for its own with
 * `useMapArtDelivery` and only draws what it is told. Without a provider (tests, a plain
 * browser) every map's art is drawn at once from its logical path, which only the
 * development server answers.
 */

const NOTHING: MapArtSnapshot = { phase: null, downloaded: 0, total: 0, error: null, revision: 0 };
const none = () => undefined;

/** Art that is always there: outside the desktop app. */
export const ALWAYS_DRAWN: MapArtSource = {
  fetches: false,
  owner: () => null,
  subscribe: () => none,
  snapshot: () => NOTHING,
  watch: () => none,
  retry: none,
  failed: none,
  src: (file) => file,
};

const Context = createContext<MapArtSource>(ALWAYS_DRAWN);
export const MapArtProvider = Context.Provider;

/**
 * A map's art as a view should draw it. Only while `shown` (drawn on screen) does the source
 * hear of it, so a hidden map never starts a download.
 */
export function useMapArtDelivery(art: PetMapArt | null | undefined, shown: boolean): MapArtView {
  const source = useContext(Context);
  const owner = useMemo(() => (source.fetches ? source.owner(art) : null), [source, art]);
  const subscribe = useCallback(
    (onChange: () => void) => (owner === null ? none : source.subscribe(owner, onChange)),
    [source, owner],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (owner === null ? NOTHING : source.snapshot(owner)),
    () => NOTHING,
  );
  useEffect(() => {
    if (!shown || owner === null) return;
    return source.watch(owner);
  }, [source, owner, shown]);
  const retry = useCallback(() => {
    if (owner !== null) source.retry(owner);
  }, [source, owner]);
  const failed = useCallback(() => {
    if (owner !== null) source.failed(owner);
  }, [source, owner]);

  if (!source.fetches)
    return {
      ready: !!art,
      phase: null,
      progress: null,
      error: null,
      revision: 0,
      src: source.src,
      retry,
      failed,
    };
  const phase = owner === null ? null : (snapshot.phase ?? 'checking');
  return {
    ready: phase === 'ready',
    phase,
    progress:
      phase === 'downloading' && snapshot.total > 0 ? snapshot.downloaded / snapshot.total : null,
    error: phase === 'error' ? snapshot.error : null,
    revision: snapshot.revision,
    src: source.src,
    retry,
    failed,
  };
}
