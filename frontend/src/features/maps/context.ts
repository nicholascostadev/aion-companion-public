import { atlasMap, type AtlasMap } from './atlas';

/*
 * Which world map a capture status belongs to, for any feature that draws on the atlas.
 * Only the map native names for the current context is trusted: nothing of yours is placed
 * on a map it was not observed on, and nothing at all for an unknown area.
 */

/** What a context needs from a native status. */
export interface ContextStatus {
  running: boolean;
  map_id: string | null;
  /** Your fresh position; null while stale, unknown or capture is stopped. */
  position: { x: number; y: number } | null;
}

/**
 * Where a status belongs. `hidden`: the last read failed, so nothing of yours is drawn;
 * `none`: no capture context; `unknown`: capturing in an area without a map here; `map`:
 * the map the current status and position belong to.
 */
export type MapContext =
  | { kind: 'hidden' }
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'map'; map: AtlasMap };

export function mapContext(
  status: Pick<ContextStatus, 'running' | 'map_id'> | null,
  error: string,
): MapContext {
  if (error) return { kind: 'hidden' };
  if (!status?.running) return { kind: 'none' };
  const map = atlasMap(status.map_id);
  return map ? { kind: 'map', map } : { kind: 'unknown' };
}

/**
 * The context a map is shown for: the current one, except that the kinds in `keep` (a
 * failed read, by default) show the map last followed (`followed`) instead, so they hide
 * your own position without moving the map away.
 */
export function shownContext(
  context: MapContext,
  followed: string | null,
  keep: readonly MapContext['kind'][] = ['hidden'],
): MapContext {
  if (!keep.includes(context.kind)) return context;
  const map = atlasMap(followed);
  return map ? { kind: 'map', map } : context;
}

/** Maps to choose from: `ids`, plus the current map when it is another known one. */
export function mapChoices(ids: readonly string[], context: MapContext): AtlasMap[] {
  const all = [...ids];
  if (context.kind === 'map' && !all.includes(context.map.id)) all.push(context.map.id);
  return all.flatMap((id) => atlasMap(id) ?? []);
}

/**
 * The map on screen: the one you picked, else the shown context's, else `fallback`.
 * Picking the current map again goes back to following the context (see `chooseMap`).
 */
export function shownMap(chosen: string | null, context: MapContext, fallback: string): AtlasMap {
  return (
    atlasMap(chosen) ??
    (context.kind === 'map' ? context.map : null) ??
    (atlasMap(fallback) as AtlasMap)
  );
}

/** The manual choice after picking `id`: none when it is the shown context's map. */
export const chooseMap = (id: string, context: MapContext): string | null =>
  context.kind === 'map' && context.map.id === id ? null : id;

/**
 * Your fresh position on `map`, in world units: only while it is the current context's map
 * (never after a failed read or in an unknown area) and native reports a fresh position.
 */
export function freshPlayer(
  status: Pick<ContextStatus, 'position'> | null,
  context: MapContext,
  map: AtlasMap,
): { x: number; y: number } | null {
  if (!status?.position || context.kind !== 'map' || context.map.id !== map.id) return null;
  return { x: status.position.x, y: status.position.y };
}
