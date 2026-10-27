import type { CubeObservation, CubesStatus } from '../../types/cubes';
import { ALTGARD, VERTERON, type AtlasMap } from '../maps/atlas';
import {
  chooseMap,
  freshPlayer,
  mapChoices,
  mapContext,
  shownContext as shownMapContext,
  shownMap as shownAtlasMap,
  type MapContext,
} from '../maps/context';
import type { MapMark, MarkTone } from '../maps/WorldMap';
import { actionable } from './model';

/*
 * Cubes on the game's world maps. Received cubes are marked only on the map native names
 * for the current context: a cube is never placed on a map it was not received on, and
 * nothing is marked for an unknown area. Possible locations (`spawns.ts`) are a separate,
 * static layer of every map that lists them, whatever capture is doing.
 */

/** Maps always offered, Altgard first. */
export const CUBE_MAPS: readonly string[] = [ALTGARD, VERTERON];

/**
 * Where the cubes of a status belong (see `MapContext`): `hidden` after a failed read or
 * Clear, so nothing spatial is drawn.
 */
export type CubeContext = MapContext;

export const cubeContext: (status: CubesStatus | null, error: string) => CubeContext = mapContext;

/**
 * The context a map is shown for: the current one, except that a failed read keeps the map
 * last followed (`followed`), so a passing failure hides received cubes and you without
 * moving the map or its possible locations away.
 */
export const shownContext = (context: CubeContext, followed: string | null): CubeContext =>
  shownMapContext(context, followed);

/** Maps to choose from: the cube maps, plus the current map when it is another known one. */
export const cubeMapChoices = (context: CubeContext): AtlasMap[] => mapChoices(CUBE_MAPS, context);

/**
 * The map on screen: the one you picked, else the current context's, else Altgard. Picking
 * the current map again goes back to following the context (see `chooseMap`).
 */
export const shownMap = (chosen: string | null, context: CubeContext): AtlasMap =>
  shownAtlasMap(chosen, context, ALTGARD);

export { chooseMap, freshPlayer };

export type CubeLayer = 'nearby' | 'earlier' | 'possible';
export type CubeLayers = Readonly<Record<CubeLayer, boolean>>;
export const ALL_LAYERS: CubeLayers = { nearby: true, earlier: true, possible: true };

/** Id of the possible-locations layer on the map. */
export const SPOT_LAYER = 'cube';

export const markKey = (id: number) => `cube:${id}`;
export const toneOf = (cube: CubeObservation): MarkTone =>
  cube.status === 'opening' ? 'busy' : actionable(cube.status) ? 'live' : 'past';

/**
 * Marks and your position for `map`: empty unless it is the current context's map. Cubes
 * keep their own received coordinates, so they show without a fresh position of yours;
 * you are drawn only with one.
 */
export function cubeMarks({
  status,
  context,
  map,
  layers,
  fresh,
  label,
}: {
  status: CubesStatus | null;
  context: CubeContext;
  map: AtlasMap;
  layers: CubeLayers;
  fresh: ReadonlySet<number>;
  label: (cube: CubeObservation) => string;
}): { marks: MapMark[]; player: { x: number; y: number } | null } {
  if (!status || context.kind !== 'map' || context.map.id !== map.id)
    return { marks: [], player: null };
  const marks = status.cubes.flatMap((cube): MapMark[] => {
    const tone = toneOf(cube);
    if (!layers[tone === 'past' ? 'earlier' : 'nearby']) return [];
    return [
      {
        key: markKey(cube.id),
        kind: 'cube',
        x: cube.x,
        y: cube.y,
        tone,
        label: label(cube),
        // A new arrival is marked only while it may still be there.
        isNew: tone !== 'past' && fresh.has(cube.id),
      },
    ];
  });
  return { marks, player: freshPlayer(status, context, map) };
}
