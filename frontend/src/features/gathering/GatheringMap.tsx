import { useMemo } from 'react';
import { gatheringArtSrc } from '../../components/ui/GameArt';
import { useFormat, useLocale, useTranslation } from '../../i18n/provider';
import type { Place } from '../maps/spots';
import { GROUP_GLYPHS, type SpotGlyph, type SpotLayer } from '../maps/WorldMap';
import { GATHERING_LAYER, resourcesAt, type VisibleSpots } from './map';
import { shortName, type GatheringResource } from './spawns';

/** A resource's name in the interface language. */
export function useResourceName() {
  const locale = useLocale();
  return (resource: GatheringResource) => resource.name[locale];
}

/** A resource's glyph on the map: its original icon, else the start of its name. */
const glyphOf = (resource: GatheringResource, name: string): SpotGlyph => {
  const src = gatheringArtSrc(resource.iconKey);
  return src ? { src } : { text: shortName(name) };
};

/** The possible-locations layer of `visible`; stable while it and the language are. */
export function useGatheringSpotLayer(visible: VisibleSpots): readonly SpotLayer[] {
  const { t } = useTranslation('gathering');
  const fmt = useFormat();
  const locale = useLocale();
  return useMemo(() => {
    if (!visible.places.length) return [];
    const glyphs = visible.resources.map(({ resource }) =>
      glyphOf(resource, resource.name[locale]),
    );
    /** The resources at `members`, most points first, the fourth and later as "and N more". */
    const names = (members: readonly number[]) => {
      const all = resourcesAt(visible, members).map((r) => r.resource.name[locale]);
      return all.length > 3
        ? t(($) => $.map.groupMore, {
            list: fmt.list(all.slice(0, 3)),
            more: all.length - 3,
          })
        : fmt.list(all);
    };
    return [
      {
        id: GATHERING_LAYER,
        kind: 'gathering' as const,
        places: visible.places,
        // A tag of two overlapped glyphs and a count is about 50 px wide.
        clusterPx: 26,
        glyph: (index: number) => glyphs[visible.owner[index]!]!,
        groupGlyphs: (members: readonly number[]) =>
          resourcesAt(visible, members)
            .slice(0, GROUP_GLYPHS)
            .map(({ index }) => glyphs[index]!),
        label: (place: Place, index: number) =>
          t(($) => $.map.place, {
            name: visible.resources[visible.owner[index]!]!.resource.name[locale],
            count: place.count,
          }),
        groupLabel: (count: number, members: readonly number[]) =>
          t(($) => $.map.group, { list: names(members), count }),
        partLabel: (count: number, members: readonly number[]) =>
          t(($) => $.map.part, { list: names(members), count }),
      },
    ];
  }, [visible, t, fmt, locale]);
}
