import { Button } from '../../components/ui/Button';
import { GatheringIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { spotDistance, type Place } from '../maps/spots';
import { metres } from '../cubes/model';
import type { NearSpot } from './map';
import { useResourceName } from './GatheringMap';
import { shortName, type GatheringResource } from './spawns';

/**
 * A resource's original icon, fitted whole on a dashed round plate like its places on the
 * map (a possible location, never a sighting); its written short name without art.
 */
export function ResourceGlyph({
  resource,
  size = 'md',
}: {
  resource: GatheringResource;
  size?: 'sm' | 'md' | 'lg';
}) {
  const name = useResourceName()(resource);
  const px = { sm: 14, md: 18, lg: 22 }[size];
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-dashed border-marker-possible/70 bg-ink-inverse/40',
        { sm: 'size-5', md: 'size-6', lg: 'size-8' }[size],
      )}
      aria-hidden="true"
    >
      <GatheringIcon
        iconKey={resource.iconKey}
        short={shortName(name)}
        size={px}
        className="border-0"
      />
    </span>
  );
}

/**
 * A possible gathering location in a few words: its resource (original icon and name), that
 * it is only possible and, with your fresh position on its map, how far it is in a straight
 * line. Never a state, a time or a requirement: nothing is known about whether a node is
 * there now. `card` floats over the workspace map; `strip` sits under the in-game map.
 */
export function SpotSummary({
  resource,
  place,
  player,
  variant,
  onClose,
  hit = false,
}: {
  resource: GatheringResource;
  place: Place;
  /** Your fresh position on the same map; null shows no distance. */
  player: { x: number; y: number } | null;
  variant: 'card' | 'strip';
  onClose?: (() => void) | undefined;
  hit?: boolean;
}) {
  const { t } = useTranslation('gathering');
  const fmt = useFormat();
  const name = useResourceName()(resource);
  const card = variant === 'card';
  return (
    <div
      data-spot={resource.key}
      className={cn(
        'flex min-w-0 items-center gap-2.5',
        card && 'rounded-lg border border-line bg-veil p-3 shadow-2 backdrop-blur-sm',
      )}
    >
      <ResourceGlyph resource={resource} size={card ? 'lg' : 'sm'} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <b className={cn('truncate font-semibold', card ? 'text-base' : 'text-xs')}>{name}</b>
          {player && (
            <span
              className={cn('shrink-0 text-ink-2 tabular-nums', card ? 'text-sm' : 'text-2xs')}
              title={t(($) => $.details.distanceTitle)}
            >
              {t(($) => $.details.distance, { distance: metres(spotDistance(place, player), fmt) })}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-3">
          <span className="truncate">{t(($) => $.categories[resource.category])}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate" title={t(($) => $.possible.note)}>
            {place.count > 1
              ? t(($) => $.possible.count, { count: place.count })
              : t(($) => $.possible.short)}
          </span>
        </span>
        {card && <span className="text-2xs text-ink-4">{t(($) => $.possible.note)}</span>}
      </div>
      {onClose && (
        <Button
          {...(hit ? { 'data-hit': '' } : {})}
          iconOnly
          variant="ghost"
          size={card ? 'xs' : '2xs'}
          aria-label={t(($) => $.details.close)}
          title={t(($) => $.details.close)}
          onClick={onClose}
        >
          <Icon name="close" size={card ? 13 : 11} />
        </Button>
      )}
    </div>
  );
}

/** One of the nearest possible locations: its resource, distance and whether it is chosen. */
export function NearRow({
  spot,
  selected,
  onSelect,
}: {
  spot: NearSpot;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('gathering');
  const fmt = useFormat();
  const name = useResourceName()(spot.resource);
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Pressable
        aria-pressed={selected}
        className={selectableRow(
          selected,
          'flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-none px-3 py-1.5',
        )}
        onClick={onSelect}
      >
        <ResourceGlyph resource={spot.resource} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm text-ink">{name}</span>
          <span className="truncate text-2xs text-ink-3">
            {t(($) => $.categories[spot.resource.category])}
          </span>
        </span>
        <b
          className="shrink-0 text-sm font-semibold text-ink tabular-nums"
          title={t(($) => $.details.distanceTitle)}
        >
          {metres(spot.distance, fmt)}
        </b>
      </Pressable>
    </li>
  );
}
