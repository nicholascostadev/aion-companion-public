import { useMemo } from 'react';
import { useFormat, useTranslation } from '../../i18n/provider';
import type { CubeObservation } from '../../types/cubes';
import type { Place } from '../maps/spots';
import type { SpotLayer } from '../maps/WorldMap';
import { SPOT_LAYER } from './map';
import { metres } from './model';
import { useCubeStatusWord, useSpotGroups } from './parts';
import type { CubeSpots } from './spawns';

/** Accessible name of a cube's mark: its state, id and, when known, distance. */
export function useCubeMarkLabel() {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  const statusWord = useCubeStatusWord();
  return (cube: CubeObservation) => {
    const base = t(($) => $.map.mark, { id: cube.id, state: statusWord(cube).word });
    return cube.distance_m === null ? base : `${base} · ${metres(cube.distance_m, fmt)}`;
  };
}

/** Accessible names of possible locations: one place, and places drawn as one. */
function useSpotLabels() {
  const { t } = useTranslation('cubes');
  const groups = useSpotGroups();
  return useMemo(
    () => ({
      label: (place: Place) =>
        `${t(($) => $.possible.mark, { count: place.count })} · ${groups(place.groups)}`,
      groupLabel: (count: number) => t(($) => $.possible.group, { count }),
      partLabel: (count: number) => t(($) => $.possible.part, { count }),
    }),
    [t, groups],
  );
}

/** The possible-locations layer of `spots`; stable while they and the language are. */
export function useCubeSpotLayer(spots: CubeSpots | null, shown: boolean): readonly SpotLayer[] {
  const labels = useSpotLabels();
  return useMemo(
    () =>
      spots && shown
        ? [
            {
              id: SPOT_LAYER,
              kind: 'cube' as const,
              places: spots.places,
              ...labels,
            },
          ]
        : [],
    [spots, shown, labels],
  );
}
