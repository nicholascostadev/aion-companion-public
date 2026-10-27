import { ALTGARD, VERTERON } from '../maps/atlas';

/*
 * The finders Explore draws together, each one layer of a single map with one map choice.
 * Each is shown or hidden on its own; a hidden finder keeps its own choices (sub-layers,
 * filters) for when it is shown again. The choices are saved and shared by every window
 * that draws Explore (see `FinderPreferences`).
 *
 * A finder is added by naming it here and in the saved choices, then giving it its state in
 * `useFinderMap`, its marks or spot layer in `FinderMap` and its section in `ExploreView`.
 */

/** Finders in drawing and listing order: earlier ones draw first and list first. */
export const FINDER_LAYERS = ['cubes', 'gathering'] as const;
export type FinderLayer = (typeof FINDER_LAYERS)[number];

export const isFinderLayer = (value: string): value is FinderLayer =>
  (FINDER_LAYERS as readonly string[]).includes(value);

/** Which finders are shown on the map. */
export type FinderVisibility = Readonly<Record<FinderLayer, boolean>>;

/** No finder shown: while the saved choices are not known yet, nothing is guessed. */
export const NO_FINDERS: FinderVisibility = { cubes: false, gathering: false };

/**
 * A request to bring a finder to the front (a link or an older tab name): it is shown, and
 * each new `request` asks again even for the same finder.
 */
export interface FinderFocus {
  layer: FinderLayer;
  request: number;
}

/** Maps always offered, Altgard first: every finder lists both. */
export const FINDER_MAPS: readonly string[] = [ALTGARD, VERTERON];
