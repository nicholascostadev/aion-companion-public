import bundled from '../../data/cube-spawns.json';
import { atlasMap } from '../maps/atlas';
import { placesOf, type Place, type SourcePoint } from '../maps/spots';

/*
 * Possible Hidden Cube locations from the game's own map data
 * (`frontend/src/data/cube-spawns.json`, with its provenance). Each listed point is a
 * place a cube can appear, never a sighting: nothing here says a cube is there now, when one
 * returns or that one was opened.
 *
 * File shape (version 1): `{ version: 1, maps: [{ map_id, groups: [{ id, points: [[x, y, z]] }] }] }`,
 * world centimetres in the same frame as received cubes, maps by catalogue id. Other fields
 * (provenance, native object ids) are not read. Group ids are internal names, so groups are
 * shown by their ordinal only.
 */

/** Possible cube locations on one map. */
export interface CubeSpots {
  mapId: string;
  /** Points merged into places (see `placesOf`), in file order. */
  places: Place[];
  /** Points listed for the map: the sum of its places' counts. */
  points: number;
  /** Source groups listed for the map. */
  groups: number;
}

export type CubeSpotCatalogue = ReadonlyMap<string, CubeSpots>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `[x, y]` or `[x, y, z]` with finite x and y; anything else is skipped. */
function pointOf(v: unknown): { x: number; y: number } | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = v as unknown[];
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : null;
}

/**
 * The catalogue from the bundled file. Anything but version 1 is no catalogue; maps without
 * original art here, malformed groups and points without finite x and y are skipped, so a
 * bad entry never throws or lands on a guessed map. A map listed twice keeps its first entry.
 */
export function parseCubeSpots(raw: unknown): CubeSpotCatalogue {
  const catalogue = new Map<string, CubeSpots>();
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.maps)) return catalogue;
  for (const entry of raw.maps) {
    if (!isRecord(entry) || typeof entry.map_id !== 'string' || !Array.isArray(entry.groups))
      continue;
    const mapId = entry.map_id;
    if (!atlasMap(mapId) || catalogue.has(mapId)) continue;
    const points: SourcePoint[] = [];
    let groups = 0;
    for (const group of entry.groups) {
      if (!isRecord(group) || typeof group.id !== 'string' || !Array.isArray(group.points))
        continue;
      const listed = group.points.flatMap((p) => pointOf(p) ?? []);
      if (!listed.length) continue;
      groups++;
      for (const p of listed) points.push({ ...p, group: groups });
    }
    if (points.length)
      catalogue.set(mapId, { mapId, places: placesOf(points), points: points.length, groups });
  }
  return catalogue;
}

const CATALOGUE = parseCubeSpots(bundled as unknown);

/** Possible cube locations on a map; null when none are listed for it. */
export const cubeSpots = (mapId: string): CubeSpots | null => CATALOGUE.get(mapId) ?? null;

/** True when any map has possible cube locations. */
export const hasCubeSpots = () => CATALOGUE.size > 0;
