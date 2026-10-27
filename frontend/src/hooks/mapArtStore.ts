import { ensureMapArt, mapArtOwner, mapArtUrl, readMapArtStatus } from '../services/mapArt';
import type { MapArtPhase, MapArtSnapshot, MapArtSource, MapArtStatus } from '../types/mapArt';

/**
 * Status reads per phase while a map's art is on screen: often while it downloads, rarely
 * once ready (to notice a cache found corrupted), and now and then after a failure (another
 * window may have retried). Nothing is read while no map shows its art or the page is hidden.
 */
export const MAP_ART_POLL_MS: Readonly<Record<MapArtPhase, number>> = {
  missing: 1000,
  downloading: 500,
  ready: 15_000,
  error: 5000,
};
/**
 * Times one showing re-requests the images of a ready map whose images failed to load; after
 * that the map reads as failed here (Retry), whatever native says, never as ready and blank.
 */
const IMAGE_RETRIES = 2;

const INITIAL: MapArtSnapshot = { phase: null, downloaded: 0, total: 0, error: null, revision: 0 };

/**
 * One map's art in this window, shared by every view that shows it: one schedule and one
 * ensure per showing however many views draw it. Reads are numbered when they start and
 * only a newer read than the last applied one is applied, so a slow reply never overwrites
 * a fresher one (an ensure answering after a later status read, a map switch, a retry).
 */
interface Entry {
  id: string;
  snapshot: MapArtSnapshot;
  issued: number;
  applied: number;
  /** Views showing this map's art now. */
  watchers: number;
  /** An ensure was sent during the current showing since the art was last ready. */
  ensured: boolean;
  /** An image failed to load and its status is being read again. */
  checking: boolean;
  imageRetries: number;
  /** Images kept failing although native reported ready: shown as failed until Retry. */
  imagesFailed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

function entryOf(id: string): Entry {
  let entry = entries.get(id);
  if (!entry) {
    entry = {
      id,
      snapshot: INITIAL,
      issued: 0,
      applied: 0,
      watchers: 0,
      ensured: false,
      checking: false,
      imageRetries: 0,
      imagesFailed: false,
      timer: null,
      listeners: new Set(),
    };
    entries.set(id, entry);
  }
  return entry;
}

function publish(entry: Entry, next: MapArtSnapshot) {
  const prev = entry.snapshot;
  if (
    prev.phase === next.phase &&
    prev.downloaded === next.downloaded &&
    prev.total === next.total &&
    prev.error === next.error &&
    prev.revision === next.revision
  )
    return;
  entry.snapshot = next;
  for (const listener of entry.listeners) listener();
}

function apply(entry: Entry, status: MapArtStatus | null, failure: string | null) {
  const prev = entry.snapshot;
  let phase = status?.phase ?? 'error';
  let revision = prev.revision;
  if (phase === 'ready' && entry.checking) {
    // Native still vouches for the files: request the images again, a bounded number of times.
    if (entry.imageRetries < IMAGE_RETRIES) {
      entry.imageRetries++;
      revision++;
    } else entry.imagesFailed = true;
  }
  if (phase === 'ready' && entry.imagesFailed) phase = 'error';
  else if (phase === 'ready' && prev.phase !== null && prev.phase !== 'ready') revision++;
  publish(entry, {
    phase,
    downloaded: status?.downloaded_bytes ?? 0,
    total: status?.total_bytes ?? 0,
    error: status ? status.error : failure,
    revision,
  });
}

function stopTimer(entry: Entry) {
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = null;
}

function schedule(entry: Entry) {
  stopTimer(entry);
  if (!entry.watchers || !pageVisible()) return;
  entry.timer = setTimeout(
    () => {
      entry.timer = null;
      void request(entry, 'status');
    },
    MAP_ART_POLL_MS[entry.snapshot.phase ?? 'missing'],
  );
}

function request(entry: Entry, kind: 'ensure' | 'status'): Promise<void> {
  if (kind === 'ensure') entry.ensured = true;
  stopTimer(entry);
  const number = ++entry.issued;
  const settle = (status: MapArtStatus | null, failure: string | null) => {
    if (number > entry.applied) {
      entry.applied = number;
      apply(entry, status, failure);
      // Ready art may be ensured again if it later goes missing (bounded: once per loss).
      if (entry.snapshot.phase === 'ready') entry.ensured = false;
      // Art that went missing while shown is fetched again, once; a hidden page never starts
      // a download (it is ensured when the page shows again).
      if (entry.watchers && pageVisible() && status?.phase === 'missing' && !entry.ensured) {
        void request(entry, 'ensure');
        return;
      }
    }
    if (number === entry.issued) schedule(entry);
  };
  return (kind === 'ensure' ? ensureMapArt : readMapArtStatus)(entry.id).then(
    (status) => settle(status, null),
    (cause: unknown) => settle(null, String(cause)),
  );
}

/** A showing starts (or the page shows again): cached art only needs its status. */
function wake(entry: Entry) {
  entry.ensured = false;
  entry.imageRetries = 0;
  entry.imagesFailed = false;
  void request(entry, entry.snapshot.phase === 'ready' ? 'status' : 'ensure');
}

let followingPage = false;
/** A hidden page reads nothing; shown again, every watched map wakes. */
function followPage() {
  if (followingPage || typeof document === 'undefined') return;
  followingPage = true;
  document.addEventListener('visibilitychange', () => {
    for (const entry of entries.values()) {
      if (!entry.watchers) continue;
      if (pageVisible()) wake(entry);
      else stopTimer(entry);
    }
  });
}

/** Forgets every map's state; for tests. */
export function resetMapArtStore() {
  for (const entry of entries.values()) stopTimer(entry);
  entries.clear();
}

/**
 * The desktop app's map art: native ensures each map once when a view first shows its art
 * (never at startup or for a hidden map or page) and is polled only while it is shown.
 */
export const nativeMapArt: MapArtSource = {
  fetches: true,
  owner: mapArtOwner,
  src: mapArtUrl,
  subscribe(mapId, onChange) {
    const entry = entryOf(mapId);
    entry.listeners.add(onChange);
    return () => entry.listeners.delete(onChange);
  },
  snapshot: (mapId) => entryOf(mapId).snapshot,
  watch(mapId) {
    followPage();
    const entry = entryOf(mapId);
    entry.watchers++;
    if (entry.watchers === 1 && pageVisible()) wake(entry);
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      entry.watchers--;
      if (!entry.watchers) stopTimer(entry);
    };
  },
  retry(mapId) {
    const entry = entryOf(mapId);
    // A stale callback (the map since hidden, switched or unmounted, or the page hidden)
    // never starts a download.
    if (!entry.watchers || !pageVisible()) return;
    entry.imageRetries = 0;
    entry.imagesFailed = false;
    void request(entry, 'ensure');
  },
  failed(mapId) {
    const entry = entryOf(mapId);
    // Every tile of a broken map fails at once; one read answers them all.
    if (entry.checking || !entry.watchers || !pageVisible()) return;
    entry.checking = true;
    void request(entry, 'status').finally(() => {
      entry.checking = false;
    });
  },
};
