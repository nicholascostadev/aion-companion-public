import bundled from '../../data/gathering-spawns.json';
import type { UiLocale } from '../../i18n/locale';
import { atlasMap } from '../maps/atlas';
import { placesOf, type Place, type SourcePoint } from '../maps/spots';

/*
 * Possible gathering locations from the game's own map data
 * (`frontend/src/data/gathering-spawns.json`, with its provenance). Every listed point is a
 * place a gathering node can appear, never a sighting: nothing here says one is there now,
 * when one returns, what it takes to gather or that it was gathered.
 *
 * File shape (version 1): `{ version: 1, resources: [{ id, category, name: { en, 'pt-BR' },
 * icon_key, item_id }], maps: [{ map_id, groups: [{ id, env_object_ids: [id], points:
 * [[x, y, z]] }] }] }`, world centimetres in the same frame as your position, maps by
 * catalogue id, each group of exactly one native resource (`env_object_ids`). Other fields
 * (provenance, sources) are not read.
 *
 * Several native resources can yield the same gathered item (the same name and icon); they
 * are one resource here, keyed by the item, so a filter never lists the same name twice.
 * Every native point is kept and counted.
 */

export const GATHERING_CATEGORIES = ['ore', 'gemstone', 'wood', 'herb', 'food', 'aether'] as const;
export type GatheringCategory = (typeof GATHERING_CATEGORIES)[number];

const isCategory = (v: unknown): v is GatheringCategory =>
  typeof v === 'string' && (GATHERING_CATEGORIES as readonly string[]).includes(v);

/** One gathered resource, as filters, legends and details show it. */
export interface GatheringResource {
  /** Stable across maps: the gathered item (`item:<id>`), else the native resource (`env:<id>`). */
  key: string;
  category: GatheringCategory;
  name: Readonly<Record<UiLocale, string>>;
  /** Exact native icon key; null when the game data names none or its art is unverified. */
  iconKey: string | null;
  /** Native resource ids (env objects) that yield it. */
  envIds: readonly number[];
}

/** The possible locations of one resource on one map. */
export interface ResourceSpots {
  resource: GatheringResource;
  /** Points merged into places (see `placesOf`), in file order. */
  places: Place[];
  /** Points listed: the sum of its places' counts. */
  points: number;
}

/** Possible gathering locations on one map. */
export interface GatheringSpots {
  mapId: string;
  /** By category (in `GATHERING_CATEGORIES` order), then English name. */
  resources: ResourceSpots[];
  /** Points listed for the map, every resource. */
  points: number;
}

export interface GatheringCatalogue {
  resources: ReadonlyMap<string, GatheringResource>;
  maps: ReadonlyMap<string, GatheringSpots>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/** `[x, y]` or `[x, y, z]` with finite x and y; anything else is skipped. */
function pointOf(v: unknown): { x: number; y: number } | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = v as unknown[];
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : null;
}

const nameOf = (v: unknown): Record<UiLocale, string> | null => {
  if (!isRecord(v) || typeof v.en !== 'string' || !v.en.trim()) return null;
  const pt = typeof v['pt-BR'] === 'string' && v['pt-BR'].trim() ? v['pt-BR'] : v.en;
  return { en: v.en, 'pt-BR': pt };
};

const order = (a: GatheringResource, b: GatheringResource) =>
  GATHERING_CATEGORIES.indexOf(a.category) - GATHERING_CATEGORIES.indexOf(b.category) ||
  a.name.en.localeCompare(b.name.en, 'en');

/**
 * The catalogue from the bundled file. Anything but version 1 is no catalogue. Resources
 * without an id, a known category or an English name are skipped; maps without original
 * art here, groups naming other than exactly one known resource and points without finite
 * x and y are skipped, so a bad entry never throws, lands on a guessed map or a guessed
 * resource. A map listed twice keeps its first entry.
 */
export function parseGatheringSpots(raw: unknown): GatheringCatalogue {
  const resources = new Map<string, GatheringResource>();
  const maps = new Map<string, GatheringSpots>();
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.resources))
    return { resources, maps };
  const byEnv = new Map<number, GatheringResource>();
  for (const entry of raw.resources) {
    if (!isRecord(entry) || !isId(entry.id) || byEnv.has(entry.id) || !isCategory(entry.category))
      continue;
    const name = nameOf(entry.name);
    if (!name) continue;
    const key = isId(entry.item_id) ? `item:${entry.item_id}` : `env:${entry.id}`;
    const iconKey = typeof entry.icon_key === 'string' && entry.icon_key ? entry.icon_key : null;
    const known = resources.get(key);
    const resource: GatheringResource = known
      ? {
          ...known,
          iconKey: known.iconKey ?? iconKey,
          envIds: [...known.envIds, entry.id],
        }
      : { key, category: entry.category, name, iconKey, envIds: [entry.id] };
    resources.set(key, resource);
    for (const id of resource.envIds) byEnv.set(id, resource);
  }
  if (!Array.isArray(raw.maps)) return { resources, maps };
  for (const entry of raw.maps) {
    if (!isRecord(entry) || typeof entry.map_id !== 'string' || !Array.isArray(entry.groups))
      continue;
    const mapId = entry.map_id;
    if (!atlasMap(mapId) || maps.has(mapId)) continue;
    const points = new Map<string, SourcePoint[]>();
    let ordinal = 0;
    for (const group of entry.groups) {
      if (!isRecord(group) || !Array.isArray(group.points) || !Array.isArray(group.env_object_ids))
        continue;
      const [id, ...more] = group.env_object_ids as unknown[];
      const resource = more.length === 0 && isId(id) ? byEnv.get(id) : undefined;
      if (!resource) continue;
      const listed = group.points.flatMap((p) => pointOf(p) ?? []);
      if (!listed.length) continue;
      ordinal++;
      const into = points.get(resource.key) ?? [];
      for (const p of listed) into.push({ ...p, group: ordinal });
      points.set(resource.key, into);
    }
    const spots: ResourceSpots[] = [...points].map(([key, list]) => ({
      // Read after every resource is known, so a merged resource has all its ids.
      resource: resources.get(key)!,
      places: placesOf(list),
      points: list.length,
    }));
    if (!spots.length) continue;
    spots.sort((a, b) => order(a.resource, b.resource));
    maps.set(mapId, { mapId, resources: spots, points: spots.reduce((n, s) => n + s.points, 0) });
  }
  return { resources, maps };
}

const CATALOGUE = parseGatheringSpots(bundled as unknown);

/** Possible gathering locations on a map; null when none are listed for it. */
export const gatheringSpots = (mapId: string): GatheringSpots | null =>
  CATALOGUE.maps.get(mapId) ?? null;

const RESOURCES = [...CATALOGUE.resources.values()].sort(order);

/** Every resource of the catalogue, whatever map lists it, by category then name. */
export const gatheringResources = (): readonly GatheringResource[] => RESOURCES;

/** Maps with possible gathering locations, in file order. */
export const gatheringMapIds = (): string[] => [...CATALOGUE.maps.keys()];

/** One or two letters of a name, written where its resource has no original icon. */
export const shortName = (name: string) => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1)
    return words
      .slice(0, 2)
      .map((w) => (letters(w)[0] ?? '').toLocaleUpperCase())
      .join('');
  const [first = '?', second = ''] = letters(words[0] ?? '');
  return first.toLocaleUpperCase() + second;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** The letters a reader sees, so an accented or combined letter is never split. */
const letters = (word: string) => Array.from(segmenter.segment(word), (s) => s.segment);
