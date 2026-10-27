import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import manifest from '../data/pet-map-art.json';
import { normalizeMapArtStatus } from '../lib/mapArtNormalize';
import type { MapArtStatus } from '../types/mapArt';
import type { PetMapArt } from '../types/pets';

/*
 * Original map art is downloaded per map on first use (see `types/mapArt.ts`). The catalogue
 * and the manifest name each file logically, `/pet-map-art/<hash>.webp`; in the app it is
 * served from the verified cache by native's `map-art` protocol, by its file name alone.
 */

/** Native's custom protocol for verified cached map art. */
export const MAP_ART_PROTOCOL = 'map-art';

const LOGICAL = /^\/pet-map-art\/([a-f0-9]{20}\.webp)$/;

/** Every delivered file of the manifest, by logical path, with the map that owns it. */
const OWNERS: ReadonlyMap<string, string> = new Map([
  ...manifest.images.map((image) => ['/pet-map-art/' + image.file, image.map_ids[0]!] as const),
  ...manifest.overviews.map((o) => ['/pet-map-art/' + o.file, o.map_id] as const),
]);

/**
 * The map whose downloadable art this is (an instance layer borrows its parent's art), or
 * null when the art names a file the manifest does not deliver. Every file must belong to
 * the same map: mixed or unknown art is never fetched.
 */
export function mapArtOwner(art: PetMapArt | null | undefined): string | null {
  if (!art) return null;
  const files = [...(art.overview ? [art.overview.file] : []), ...art.tiles.map((t) => t.file)];
  const owner = files.length ? OWNERS.get(files[0]!) : undefined;
  return owner && files.every((file) => OWNERS.get(file) === owner) ? owner : null;
}

/**
 * The URL that loads one logical map art file. In the app, the native protocol by hash file
 * name, never a path; in a plain browser (tests, dev without the app) the logical path
 * itself, which only the development server answers.
 */
export function mapArtUrl(file: string): string {
  const name = LOGICAL.exec(file)?.[1];
  if (!name || !isTauri()) return file;
  return convertFileSrc(name, MAP_ART_PROTOCOL);
}

/** Cheap: what native knows about this map's art now; it never starts a download. */
export const readMapArtStatus = (mapId: string): Promise<MapArtStatus> =>
  invoke<unknown>('map_art_status', { mapId }).then((v) => normalizeMapArtStatus(v, mapId));

/**
 * Starts verifying the cache and, when needed, downloading this map's art in the background
 * (one run per map, shared by every window) and answers the status at once.
 */
export const ensureMapArt = (mapId: string): Promise<MapArtStatus> =>
  invoke<unknown>('map_art_ensure', { mapId }).then((v) => normalizeMapArtStatus(v, mapId));
