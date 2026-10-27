/*
 * Spots: fixed places on a world map where something may be found (possible cube locations
 * today, gathering nodes later). A spot is never a sighting. Points closer than `PLACE_CM`
 * are one place, so a place carries how many points it stands for; places are grouped on
 * screen as the view zooms out, and no point is ever left out of a count.
 */

/** Points this close, in world units (centimetres), are drawn and chosen as one place. */
export const PLACE_CM = 200;
/** Screen pixels a grouping cell spans at least: places closer than this share a group. */
export const CLUSTER_PX = 22;

/** One place in world units: the first point's position and how many points it holds. */
export interface Place {
  x: number;
  y: number;
  /** Points merged into this place (≥ 1). */
  count: number;
  /** One-based ordinals of the source groups its points belong to, ascending. */
  groups: readonly number[];
}

/** A point in world units with the one-based ordinal of its source group. */
export interface SourcePoint {
  x: number;
  y: number;
  group: number;
}

/**
 * Points merged into places: a point within `PLACE_CM` of an earlier place joins it,
 * keeping that place's position, so nothing drifts and every point is counted once.
 */
export function placesOf(points: readonly SourcePoint[], within = PLACE_CM): Place[] {
  const places: { x: number; y: number; count: number; groups: number[] }[] = [];
  const cells = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / within);
  for (const p of points) {
    const cx = cellOf(p.x);
    const cy = cellOf(p.y);
    let found: (typeof places)[number] | undefined;
    search: for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const k of cells.get(`${cx + i}:${cy + j}`) ?? []) {
          const q = places[k]!;
          if (Math.hypot(q.x - p.x, q.y - p.y) <= within) {
            found = q;
            break search;
          }
        }
    if (found) {
      found.count++;
      if (!found.groups.includes(p.group)) found.groups.push(p.group);
      continue;
    }
    const key = `${cx}:${cy}`;
    const list = cells.get(key);
    if (list) list.push(places.length);
    else cells.set(key, [places.length]);
    places.push({ x: p.x, y: p.y, count: 1, groups: [p.group] });
  }
  for (const p of places) p.groups.sort((a, b) => a - b);
  return places;
}

/**
 * Grouping cell, in drawing units, for a view drawing `unit` drawing units per screen pixel:
 * at least `px` (by default `CLUSTER_PX`) on screen, in power-of-two steps so groups stay put while the view
 * zooms within one step. The closest view groups nothing (a cell of zero).
 */
export const clusterCell = (unit: number, px = CLUSTER_PX) => 2 ** Math.ceil(Math.log2(px * unit));

/** Places drawn as one: a single place (`members` of one) or a group with its total. */
export interface SpotCluster {
  key: string;
  /** Drawing-space centre: the place itself, or the mean of its members. */
  x: number;
  y: number;
  /** Indices of the places drawn here. */
  members: number[];
  /** Points it stands for: the sum of its places' counts. */
  count: number;
}

/**
 * Places in drawing space (`drawn`, parallel to `places`) grouped by cells of `cell`
 * drawing units; `keep` (the selected place) always stands alone. A count tag (the cube and
 * up to three digits) is about twice as wide as a cell, so every group within a cell twice
 * the size is drawn as one tag, together with the single places there; single places
 * elsewhere stay on their own. Every place is in exactly one cluster, so the counts always
 * add up to the whole layer.
 */
export function clusterPlaces(
  drawn: readonly (readonly [number, number])[],
  places: readonly Place[],
  cell: number,
  keep: number | null = null,
): SpotCluster[] {
  const single = (i: number): SpotCluster => ({
    key: `p${i}`,
    x: drawn[i]![0],
    y: drawn[i]![1],
    members: [i],
    count: places[i]!.count,
  });
  if (!(cell > 0)) return places.map((_, i) => single(i));
  const cells = new Map<string, { members: number[]; sx: number; sy: number; count: number }>();
  const out: SpotCluster[] = [];
  places.forEach((place, i) => {
    if (i === keep) {
      out.push(single(i));
      return;
    }
    const [x, y] = drawn[i]!;
    const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    const group = cells.get(key);
    if (group) {
      group.members.push(i);
      group.sx += x;
      group.sy += y;
      group.count += place.count;
    } else cells.set(key, { members: [i], sx: x, sy: y, count: place.count });
  });
  // Cells twice the size that hold a group, each drawn as one tag.
  const wide = (key: string) =>
    key
      .split(':')
      .map((n) => Math.floor(Number(n) / 2))
      .join(':');
  const tags = new Map<string, { members: number[]; sx: number; sy: number; count: number }>();
  for (const [key, g] of cells)
    if (g.members.length > 1) tags.set(wide(key), { members: [], sx: 0, sy: 0, count: 0 });
  for (const [key, g] of cells) {
    const tag = tags.get(wide(key));
    if (!tag) {
      out.push(single(g.members[0]!));
      continue;
    }
    tag.members.push(...g.members);
    tag.sx += g.sx;
    tag.sy += g.sy;
    tag.count += g.count;
  }
  for (const [key, g] of tags)
    out.push({
      key: `c${cell * 2}:${key}`,
      x: g.sx / g.members.length,
      y: g.sy / g.members.length,
      members: g.members,
      count: g.count,
    });
  return separate(out, cell, keep);
}

/**
 * Tags drawn at their members' centre can still lie over a neighbour from the next wide
 * cell. A tag is about two cells wide and under one cell tall, so any group overlapping
 * another cluster that closely takes it in (keeping its own key), until none do. The kept
 * place is never taken in. Counts still add up: members only move between clusters.
 */
function separate(list: SpotCluster[], cell: number, keep: number | null): SpotCluster[] {
  const w = cell * 2;
  const h = cell;
  const kept = (c: SpotCluster) => keep !== null && c.members.length === 1 && c.members[0] === keep;
  let items = list;
  for (let merged = true; merged;) {
    merged = false;
    const grid = new Map<string, number[]>();
    const result: SpotCluster[] = [];
    for (const c of items) {
      const gx = Math.floor(c.x / w);
      const gy = Math.floor(c.y / h);
      let into: SpotCluster | null = null;
      if (!kept(c))
        search: for (let i = -1; i <= 1; i++)
          for (let j = -1; j <= 1; j++)
            for (const k of grid.get(`${gx + i}:${gy + j}`) ?? []) {
              const o = result[k]!;
              if (kept(o) || (o.members.length === 1 && c.members.length === 1)) continue;
              if (Math.abs(o.x - c.x) < w && Math.abs(o.y - c.y) < h) {
                into = o;
                break search;
              }
            }
      if (!into) {
        const key = `${gx}:${gy}`;
        const at = grid.get(key);
        if (at) at.push(result.length);
        else grid.set(key, [result.length]);
        result.push({ ...c, members: [...c.members] });
        continue;
      }
      const a = into.members.length;
      const b = c.members.length;
      // The tag with more places names the merged one, so the larger tag keeps its key.
      if (b > a) into.key = c.key;
      into.x = (into.x * a + c.x * b) / (a + b);
      into.y = (into.y * a + c.y * b) / (a + b);
      into.members.push(...c.members);
      into.count += c.count;
      merged = true;
    }
    items = result;
  }
  return items;
}

/** Planar metres between a place and a position, both in world units. */
export const spotDistance = (place: Place, from: { x: number; y: number }) =>
  Math.hypot(place.x - from.x, place.y - from.y) / 100;
