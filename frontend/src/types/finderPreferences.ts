/**
 * What Explore shows, saved by native and shared by every window that draws it (the
 * workspace's Explore tab and the in-game Explore window). Only display choices are kept:
 * a search, the camera and a selection stay with each window.
 */
export interface FinderPreferences {
  /** Increases with every saved change during a run; an older one is never shown. */
  revision: number;
  /** A map chosen by hand; null follows the map you are on. */
  chosen_map: string | null;
  visibility: { cubes: boolean; gathering: boolean };
  cube_layers: { nearby: boolean; earlier: boolean; possible: boolean };
  /** Gathered resources hidden from the map, by their stable `item:<id>` key. */
  hidden_resources: readonly string[];
}

/** A change to some of the choices; native merges it into the saved ones atomically. */
export interface FinderPreferencesPatch {
  chosen_map?: string | null;
  visibility?: Partial<FinderPreferences['visibility']>;
  cube_layers?: Partial<FinderPreferences['cube_layers']>;
  hidden_resources?: readonly string[];
}

/** A clean start: every layer shown, following the map you are on. */
export const DEFAULT_FINDER_PREFERENCES: FinderPreferences = {
  revision: 0,
  chosen_map: null,
  visibility: { cubes: true, gathering: true },
  cube_layers: { nearby: true, earlier: true, possible: true },
  hidden_resources: [],
};
