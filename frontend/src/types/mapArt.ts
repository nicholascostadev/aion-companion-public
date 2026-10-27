import type { PetMapArt } from './pets';

/**
 * Original map art is not installed with the app: each map's verified pack is downloaded the
 * first time its art is shown and kept for offline use. Native owns the download, the
 * verification and the cache (`map_art_status`, `map_art_ensure`); this is its report.
 *
 * - `missing`: nothing usable is cached and no download is running.
 * - `downloading`: a download or a verification of the cache is running.
 * - `ready`: every file of the map is cached and verified; its art may be drawn.
 * - `error`: the last download or verification failed, or the cache was found corrupted.
 */
export type MapArtPhase = 'missing' | 'downloading' | 'ready' | 'error';

export const MAP_ART_PHASES: readonly MapArtPhase[] = ['missing', 'downloading', 'ready', 'error'];

export interface MapArtStatus {
  /** Catalogue id of the map that owns the art (an instance layer borrows its parent's). */
  map_id: string;
  phase: MapArtPhase;
  /** Bytes of this download so far; 0 when none is running. */
  downloaded_bytes: number;
  /** Size of the whole download; 0 while unknown. */
  total_bytes: number;
  /** Why the last attempt failed, in native's words; null unless `error`. */
  error: string | null;
}

/** One map's art as a window knows it; `phase` is null before native first answers. */
export interface MapArtSnapshot {
  phase: MapArtPhase | null;
  downloaded: number;
  total: number;
  error: string | null;
  /** Bumps each time the art must be requested anew (it became ready again). */
  revision: number;
}

/**
 * Where a window's maps get their art (provided by the app; see `features/maps/mapArt.ts`).
 * Views only read and call it: the store behind it owns native calls and polling.
 */
export interface MapArtSource {
  /** False outside the desktop app: art is always drawn, from the development server. */
  readonly fetches: boolean;
  /** The map whose downloadable art this is; null when there is nothing to fetch. */
  owner: (art: PetMapArt | null | undefined) => string | null;
  subscribe: (mapId: string, onChange: () => void) => () => void;
  snapshot: (mapId: string) => MapArtSnapshot;
  /** A view shows this map's art from now until the returned function is called. */
  watch: (mapId: string) => () => void;
  retry: (mapId: string) => void;
  /** An image of this map's art failed to load. */
  failed: (mapId: string) => void;
  /** The URL that loads a logical `/pet-map-art/<hash>.webp` file. */
  src: (file: string) => string;
}

/** `checking`: shown, but native has not answered yet. */
export type MapArtViewPhase = MapArtPhase | 'checking';

/** A map's art as one view draws it. */
export interface MapArtView {
  /** The art may be drawn: verified and cached (always outside the desktop app). */
  ready: boolean;
  /** Null when there is nothing to fetch: no art, or art the manifest does not deliver. */
  phase: MapArtViewPhase | null;
  /** 0..1 of a download of known size; null otherwise. */
  progress: number | null;
  /** Native's reason for the last failure, when it gave one. */
  error: string | null;
  /** Changes when the images must be requested anew; key the images with it. */
  revision: number;
  src: (file: string) => string;
  /** Downloads again after a failure, or starts a download native has not started. */
  retry: () => void;
  /** An image of the art failed to load: read the status again (a corrupted cache shows). */
  failed: () => void;
}
