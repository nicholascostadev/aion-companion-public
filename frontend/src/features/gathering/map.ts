import { ALTGARD, VERTERON } from '../maps/atlas';
import { spotDistance, type Place } from '../maps/spots';
import {
  GATHERING_CATEGORIES,
  type GatheringCategory,
  type GatheringResource,
  type GatheringSpots,
  type ResourceSpots,
} from './spawns';

/*
 * What the gathering map shows: every possible location of the resources you have not
 * hidden, as one layer, so places of different resources group together as the view zooms
 * out and the drawing stays bounded by the screen, not by the catalogue. A filter is the
 * set of hidden resources, kept by resource key, so it carries over between maps.
 */

/** Maps always offered, Altgard first (as the cube finder). */
export const GATHERING_MAPS: readonly string[] = [ALTGARD, VERTERON];

/** Id of the possible-locations layer on the map. */
export const GATHERING_LAYER = 'gathering';

export type Hidden = ReadonlySet<string>;
export const NONE_HIDDEN: Hidden = new Set();

/** The places drawn: those of the shown resources, concatenated in resource order. */
export interface VisibleSpots {
  resources: readonly ResourceSpots[];
  places: readonly Place[];
  /** For each place, the index of its resource in `resources`. */
  owner: readonly number[];
  /** Index of each shown resource's first place in `places`, by resource key. */
  offsets: ReadonlyMap<string, number>;
  /** Points the shown places stand for. */
  points: number;
}

export const NO_SPOTS: VisibleSpots = {
  resources: [],
  places: [],
  owner: [],
  offsets: new Map(),
  points: 0,
};

const lastShown = new WeakMap<GatheringSpots, { hidden: Hidden; visible: VisibleSpots }>();

/**
 * `visibleSpots`, the same object again while the map's spots and the hidden set are, so
 * the layer and its grouping are rebuilt only when a filter or map changes.
 */
export function shownSpots(spots: GatheringSpots | null, hidden: Hidden): VisibleSpots {
  if (!spots) return NO_SPOTS;
  const last = lastShown.get(spots);
  if (last?.hidden === hidden) return last.visible;
  const visible = visibleSpots(spots, hidden);
  lastShown.set(spots, { hidden, visible });
  return visible;
}

/** The resources of `spots` not hidden, with their places as one layer. */
export function visibleSpots(spots: GatheringSpots | null, hidden: Hidden): VisibleSpots {
  if (!spots) return NO_SPOTS;
  const resources = spots.resources.filter((r) => !hidden.has(r.resource.key));
  const places: Place[] = [];
  const owner: number[] = [];
  const offsets = new Map<string, number>();
  let points = 0;
  resources.forEach((r, i) => {
    offsets.set(r.resource.key, places.length);
    for (const p of r.places) {
      places.push(p);
      owner.push(i);
    }
    points += r.points;
  });
  return { resources, places, owner, offsets, points };
}

/** The shown resources at `members`, most points first (ties in resource order). */
export function resourcesAt(visible: VisibleSpots, members: readonly number[]) {
  const counts = new Map<number, number>();
  for (const m of members) {
    const i = visible.owner[m];
    if (i === undefined) continue;
    counts.set(i, (counts.get(i) ?? 0) + (visible.places[m]?.count ?? 0));
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([index, points]) => ({ index, resource: visible.resources[index]!.resource, points }));
}

/** A place of one resource: stable while filters change, since it is not a layer index. */
export interface SpotRef {
  key: string;
  index: number;
}

/** The layer index of `ref` among the shown places; null when its resource is hidden. */
export function layerIndex(visible: VisibleSpots, ref: SpotRef): number | null {
  const offset = visible.offsets.get(ref.key);
  if (offset === undefined) return null;
  const owner = visible.resources[visible.owner[offset]!];
  return owner && ref.index < owner.places.length ? offset + ref.index : null;
}

/** The place and resource at a layer index. */
export function spotAt(
  visible: VisibleSpots,
  index: number,
): { ref: SpotRef; place: Place; resource: GatheringResource } | null {
  const i = visible.owner[index];
  const place = visible.places[index];
  if (i === undefined || !place) return null;
  const resource = visible.resources[i]!.resource;
  return {
    ref: { key: resource.key, index: index - visible.offsets.get(resource.key)! },
    place,
    resource,
  };
}

export interface NearSpot {
  ref: SpotRef;
  place: Place;
  resource: GatheringResource;
  /** Straight-line planar metres from your fresh position. */
  distance: number;
}

/**
 * The `limit` shown places nearest a fresh position in a straight line, nearest first.
 * Nothing is known about whether a node is there now, so this is only geometry.
 */
export function nearestSpots(
  visible: VisibleSpots,
  from: { x: number; y: number } | null,
  limit: number,
): NearSpot[] {
  if (!from || limit <= 0) return [];
  const best: { index: number; distance: number }[] = [];
  visible.places.forEach((place, index) => {
    const distance = spotDistance(place, from);
    if (best.length === limit && distance >= best[limit - 1]!.distance) return;
    let at = best.length;
    while (at > 0 && best[at - 1]!.distance > distance) at--;
    best.splice(at, 0, { index, distance });
    if (best.length > limit) best.pop();
  });
  return best.flatMap(({ index, distance }) => {
    const spot = spotAt(visible, index);
    return spot ? [{ ...spot, distance }] : [];
  });
}

/** Shown, partly shown or hidden: how a category's resources on a map stand. */
export type Shown = 'all' | 'some' | 'none';

export function categoryShown(
  spots: GatheringSpots | null,
  hidden: Hidden,
  category: GatheringCategory,
): Shown {
  const keys = (spots?.resources ?? [])
    .filter((r) => r.resource.category === category)
    .map((r) => r.resource.key);
  const shown = keys.filter((k) => !hidden.has(k)).length;
  return shown === 0 ? 'none' : shown === keys.length ? 'all' : 'some';
}

/** Categories present on a map, in display order, with their resources and points. */
export function categoriesOf(spots: GatheringSpots | null) {
  return GATHERING_CATEGORIES.flatMap((category) => {
    const resources = (spots?.resources ?? []).filter((r) => r.resource.category === category);
    return resources.length
      ? [
          {
            category,
            resources,
            points: resources.reduce((n, r) => n + r.points, 0),
          },
        ]
      : [];
  });
}

/** `hidden` with `keys` shown (`on`) or hidden. */
export function setShown(hidden: Hidden, keys: readonly string[], on: boolean): Hidden {
  const next = new Set(hidden);
  for (const k of keys) {
    if (on) next.delete(k);
    else next.add(k);
  }
  return next;
}

/** Every resource in `all` hidden but `keys`, so the choice holds on every map. */
export function onlyShown(all: readonly GatheringResource[], keys: readonly string[]): Hidden {
  const keep = new Set(keys);
  return new Set(all.map((r) => r.key).filter((k) => !keep.has(k)));
}

/** Keys of the resources in `all` of `category`. */
export const categoryKeys = (all: readonly GatheringResource[], category: GatheringCategory) =>
  all.filter((r) => r.category === category).map((r) => r.key);

/**
 * One choice, as the in-game window offers it: every resource, one category or one
 * resource, over the whole catalogue (`all`), so it reads the same on every map. `custom`
 * is any other mix (from the workspace's checklist).
 */
export type FilterChoice =
  | 'all'
  | `category:${GatheringCategory}`
  | `resource:${string}`
  | 'custom';

export function filterChoice(all: readonly GatheringResource[], hidden: Hidden): FilterChoice {
  const shown = all.filter((r) => !hidden.has(r.key));
  if (shown.length === all.length) return 'all';
  const category = shown[0]?.category;
  if (category && shown.length === categoryKeys(all, category).length) {
    if (shown.every((r) => r.category === category)) return `category:${category}`;
  }
  return shown.length === 1 ? `resource:${shown[0]!.key}` : 'custom';
}

/** The hidden set that makes `choice` true; `custom` keeps `hidden`. */
export function hiddenFor(
  all: readonly GatheringResource[],
  choice: FilterChoice,
  hidden: Hidden,
): Hidden {
  if (choice === 'all') return NONE_HIDDEN;
  if (choice === 'custom') return hidden;
  if (choice.startsWith('category:'))
    return onlyShown(all, categoryKeys(all, choice.slice('category:'.length) as GatheringCategory));
  return onlyShown(all, [choice.slice('resource:'.length)]);
}

/** Text folded for search: lower case, no accents. */
export const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
