import { useMemo, useState } from 'react';
import { hiddenResourceKeys, type FinderPreferencesControl } from '../../lib/finderPreferences';
import type { CubeObservation, CubesStatus } from '../../types/cubes';
import { ALTGARD } from '../maps/atlas';
import {
  chooseMap,
  freshPlayer,
  mapChoices,
  mapContext,
  shownContext,
  shownMap,
} from '../maps/context';
import type { Place } from '../maps/spots';
import { toneOf, type CubeLayer, type CubeLayers } from '../cubes/map';
import { cubeSpots } from '../cubes/spawns';
import { layerIndex, shownSpots, spotAt, type Hidden, type SpotRef } from '../gathering/map';
import { gatheringSpots, type GatheringResource } from '../gathering/spawns';
import { FINDER_MAPS, NO_FINDERS, type FinderLayer, type FinderVisibility } from './layers';

/** What was picked on the map, by identity: never by a layer index that a filter moves. */
type Pick =
  | { kind: 'cube'; session: string; id: number }
  | { kind: 'cubeSpot'; map: string; index: number }
  | { kind: 'gathering'; map: string; ref: SpotRef };

/** The selection as it stands now: what it is and where it is drawn. */
export type FinderSelection =
  | { kind: 'cube'; cube: CubeObservation }
  | { kind: 'cubeSpot'; index: number; place: Place }
  | {
      kind: 'gathering';
      ref: SpotRef;
      /** Index among the shown gathering places, as the map draws them. */
      index: number;
      place: Place;
      resource: GatheringResource;
    };

const NO_CUBES: CubeLayers = { nearby: false, earlier: false, possible: false };

/**
 * One map for every finder, drawn from the saved Explore choices (`prefs`): the map chosen by
 * hand or followed, which finders are shown, the cube sub-layers and the hidden resources.
 * Every change is saved, so each window drawing Explore shows the same layers; until the
 * saved choices are known nothing is drawn and nothing can be changed. In the workspace the
 * map follows the trusted current map until you pick another, and stays on the last trusted
 * one through a failed read, an unknown area or capture going off: only you and your
 * sightings are gone then. The in-game window follows instead (see `follow` below).
 *
 * The camera and the selection are this window's own. One selection at a time, of any
 * finder, held by identity: a received cube by its session and id, a possible location by
 * its map and place. It lets go once that is no longer drawn (another session, another
 * map, a failed read or an unknown area for a received cube, a hidden layer or resource).
 *
 * `status` is the cube finder's: it carries the capture context and position every finder
 * draws with, so one read serves them all.
 *
 * With `follow` (the in-game window) the map is always the one you are on: the saved map
 * choice is the workspace's and is neither read nor changed here, and without a trusted
 * current map nothing is drawn or listed (`onMap`). A failed read keeps the map last
 * followed, without you on it. Layers, cube sub-layers and hidden resources stay shared.
 */
export function useFinderMap(
  status: CubesStatus | null,
  error: string,
  prefs: FinderPreferencesControl,
  { follow = false }: { follow?: boolean } = {},
) {
  const context = mapContext(status, error);
  const saved = prefs.prefs;
  const ready = saved !== null;
  const { update } = prefs;
  const visibility: FinderVisibility = saved?.visibility ?? NO_FINDERS;
  const cubeLayers: CubeLayers = saved?.cube_layers ?? NO_CUBES;
  // One set while the saved keys are the same, so the gathering layer is not rebuilt.
  const hiddenKey = saved?.hidden_resources.join(' ') ?? '';
  const hidden = useMemo<Hidden>(() => new Set(hiddenKey ? hiddenKey.split(' ') : []), [hiddenKey]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  if (context.kind === 'map' && context.map.id !== followed) setFollowed(context.map.id);
  // Following, only a failed read keeps the map last followed (without you on it); there is
  // no map at all without a trusted current one.
  const display = follow
    ? shownContext(context, followed, ['hidden'])
    : shownContext(context, followed, ['hidden', 'unknown', 'none']);
  const onMap = !follow || display.kind === 'map';
  const map = shownMap(follow ? null : (saved?.chosen_map ?? null), display, ALTGARD);
  const cubes = onMap ? cubeSpots(map.id) : null;
  const gathering = onMap ? gatheringSpots(map.id) : null;
  const visible = shownSpots(gathering, hidden);
  const session = status?.session_id ?? null;

  // Received cubes are drawn only on the trusted current map: on another map, after a
  // failed read or in an unknown area a cube is not drawn, so it is not selected either.
  const current = context.kind === 'map' && context.map.id === map.id;
  let selection: FinderSelection | null = null;
  if (pick?.kind === 'cube' && current && visibility.cubes && pick.session === session) {
    const cube = status?.cubes.find((c) => c.id === pick.id);
    if (cube && cubeLayers[toneOf(cube) === 'past' ? 'earlier' : 'nearby'])
      selection = { kind: 'cube', cube };
  } else if (
    pick?.kind === 'cubeSpot' &&
    pick.map === map.id &&
    visibility.cubes &&
    cubeLayers.possible
  ) {
    const place = cubes?.places[pick.index];
    if (place) selection = { kind: 'cubeSpot', index: pick.index, place };
  } else if (pick?.kind === 'gathering' && pick.map === map.id && visibility.gathering) {
    const index = layerIndex(visible, pick.ref);
    const found = index === null ? null : spotAt(visible, index);
    if (found && index !== null) selection = { kind: 'gathering', index, ...found };
  }
  if (pick && !selection) setPick(null);

  return {
    context,
    map,
    /**
     * False only while following without a trusted current map: then `map` is a placeholder
     * that is not drawn and no place on it is listed.
     */
    onMap,
    /** True when the map always follows the one you are on (an in-game window). */
    following: follow,
    choices: follow ? [] : mapChoices(FINDER_MAPS, display),
    /** True while the map on screen is the one you are on. */
    current,
    /** The saved choices are known, so they can be changed. */
    ready,
    choose: (id: string) => update({ chosen_map: chooseMap(id, display) }),
    /** Back to following the map you are on. */
    follow: () => update({ chosen_map: null }),
    visibility,
    setVisible: (layer: FinderLayer, on: boolean) => update({ visibility: { [layer]: on } }),
    /** Which received cubes and whether possible cube locations are marked. */
    cubeLayers,
    setCubeLayer: (layer: CubeLayer, on: boolean) => update({ cube_layers: { [layer]: on } }),
    /** Possible cube locations listed for the shown map; null when none are. */
    cubeSpots: cubes,
    /** Possible gathering locations listed for the shown map, every resource. */
    gatheringSpots: gathering,
    /** The gathering places of the resources not hidden. */
    visible,
    hidden,
    setHidden: (next: Hidden) => update({ hidden_resources: hiddenResourceKeys(next) }),
    selection,
    selectCube: (id: number | null) =>
      setPick(id === null || session === null ? null : { kind: 'cube', session, id }),
    selectCubeSpot: (index: number | null) =>
      setPick(index === null ? null : { kind: 'cubeSpot', map: map.id, index }),
    selectGathering: (ref: SpotRef | null) =>
      setPick(ref && { kind: 'gathering', map: map.id, ref }),
    clearSelection: () => setPick(null),
    /** Your fresh position on the shown map; null otherwise (see `freshPlayer`). */
    player: freshPlayer(status, context, map),
  };
}

export type FinderMapState = ReturnType<typeof useFinderMap>;
