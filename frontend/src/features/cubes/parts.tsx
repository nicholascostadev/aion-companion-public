import { useCallback } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CubeIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { Ticking } from '../../components/ui/Ticking';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { CubeObservation } from '../../types/cubes';
import { spotDistance, type Place } from '../maps/spots';
import {
  actionable,
  elapsed,
  levelOf,
  metres,
  type CubeCapture,
  type CubePositionState,
} from './model';

/** The lifecycle word of a cube; an opening says whose when capture knows. */
export function useCubeStatusWord() {
  const { t } = useTranslation('cubes');
  return (cube: CubeObservation) => {
    const key =
      cube.status === 'opened' && cube.opened_by_local !== null
        ? cube.opened_by_local
          ? 'openedByYou'
          : 'openedByOther'
        : cube.status;
    return { word: t(($) => $.status[key]), title: t(($) => $.statusTitle[key]) };
  };
}

/** Caption tone and word for the capture and own-position state. */
export function useCaptureState() {
  const { t } = useTranslation('cubes');
  return (capture: CubeCapture, position: CubePositionState) => {
    if (capture === 'error') return { tone: 'warn' as const, word: t(($) => $.state.error) };
    if (capture === 'waiting') return { tone: 'muted' as const, word: t(($) => $.state.waiting) };
    if (capture !== 'capturing') return { tone: 'muted' as const, word: t(($) => $.state.idle) };
    return position === 'fresh'
      ? { tone: 'live' as const, word: t(($) => $.state.live) }
      : { tone: 'warn' as const, word: t(($) => $.state.noPosition) };
  };
}

/**
 * Distance and map direction from you. Unknown without a fresh position: a dash, never a
 * zero. The arrow turns from map up (−Y); it is not your camera or facing.
 */
export function CubeDistance({
  cube,
  size = 'sm',
}: {
  cube: Pick<CubeObservation, 'distance_m' | 'bearing_deg'>;
  size?: 'sm' | 'lg';
}) {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  const lg = size === 'lg';
  if (cube.distance_m === null)
    return (
      <span
        className={cn('shrink-0 text-ink-3 tabular-nums', lg ? 'text-xl' : 'text-sm')}
        title={t(($) => $.distanceUnknownTitle)}
      >
        {t(($) => $.distanceUnknown)}
      </span>
    );
  const bearing = cube.bearing_deg;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 tabular-nums"
      title={
        bearing === null
          ? undefined
          : t(($) => $.bearingTitle, { degrees: fmt.integer.format(Math.round(bearing)) })
      }
    >
      {bearing !== null && (
        <span
          className="inline-flex text-accent transition-transform duration-300 ease-grow"
          style={{ transform: `rotate(${bearing}deg)` }}
          aria-hidden="true"
        >
          <Icon name="heading" size={lg ? 18 : 13} strokeWidth={2.2} />
        </span>
      )}
      <b className={cn('font-semibold text-ink', lg ? 'text-xl tracking-tight' : 'text-sm')}>
        {metres(cube.distance_m, fmt)}
      </b>
    </span>
  );
}

/** Above, below or level with you; nothing when the height difference is unknown. */
export function CubeLevel({ height, short = false }: { height: number | null; short?: boolean }) {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  const level = levelOf(height);
  if (level === null || height === null) return null;
  const value = { height: metres(Math.abs(height), fmt) };
  const words = t(($) => $.level[level], value);
  return (
    <span
      data-level={level}
      className={cn(
        'inline-flex shrink-0 items-center text-2xs font-semibold whitespace-nowrap tabular-nums',
        level === 'level' ? 'text-ink-3' : 'text-ink-2',
      )}
      title={short ? words : undefined}
    >
      {short ? t(($) => $.levelShort[level], value) : words}
    </span>
  );
}

/** "12 s ago", ticking on its own. */
export function SeenAgo({ cube, className }: { cube: CubeObservation; className?: string }) {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  return (
    <span
      className={cn('shrink-0 text-2xs text-ink-3 tabular-nums', className)}
      title={t(($) => $.seenTitle, {
        first: fmt.timeOfDay(cube.first_seen_ms),
        last: fmt.timeOfDay(cube.last_seen_ms),
      })}
    >
      <Ticking>{(now) => t(($) => $.ago, { age: elapsed(now - cube.last_seen_ms, fmt) })}</Ticking>
    </span>
  );
}

/** The "New" tag of a cube received a moment ago. */
export function NewTag() {
  const { t } = useTranslation('cubes');
  return (
    <Badge tone="accent" shape="tag" dot="live" title={t(($) => $.newTitle)}>
      {t(($) => $.new)}
    </Badge>
  );
}

/**
 * One cube: direction and distance, height, its state and when it was last seen. A cube
 * that may still be there leads with where it is; one opened, gone or out of view leads
 * with what happened. A new arrival is lit and tagged, so it is seen without sound. With
 * `onSelect` the whole row selects the cube (its mark on the map and its details).
 */
export function CubeRow({
  cube,
  fresh,
  dense = false,
  selected = false,
  onSelect,
}: {
  cube: CubeObservation;
  fresh: boolean;
  dense?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { t } = useTranslation('cubes');
  const status = useCubeStatusWord()(cube);
  const open = actionable(cube.status);
  const body = (
    <>
      <CubeGlyph cube={cube} dense={dense} />
      <span className="flex min-w-0 flex-1 items-center gap-x-2 gap-y-0.5 max-[320px]:flex-wrap">
        {open ? (
          <>
            <CubeDistance cube={cube} />
            <CubeLevel height={cube.height_m} short={dense} />
          </>
        ) : (
          <span className="truncate text-sm text-ink-2" title={status.title}>
            {status.word}
          </span>
        )}
        {!dense && (
          <span className="min-w-0 truncate text-2xs text-ink-4">
            {t(($) => $.cubeLabel, { id: cube.id })}
          </span>
        )}
      </span>
      {fresh && <NewTag />}
      {open && cube.status === 'opening' && (
        <span className="shrink-0 text-2xs font-semibold text-warn" title={status.title}>
          {status.word}
        </span>
      )}
      <SeenAgo cube={cube} />
    </>
  );
  const row = cn(
    'flex w-full min-w-0 items-center gap-2',
    dense ? 'min-h-8 px-3 py-1' : 'min-h-11 px-3 py-1.5',
  );
  return (
    <li
      data-state={cube.status}
      data-new={fresh || undefined}
      data-selected={selected || undefined}
      className={cn(
        'border-b border-line-soft last:border-b-0',
        fresh && 'animate-alight bg-accent-soft',
        cube.status === 'opening' && 'bg-warn-soft',
      )}
    >
      {onSelect ? (
        <Pressable
          aria-pressed={selected}
          className={selectableRow(selected, cn(row, 'rounded-none'))}
          onClick={onSelect}
        >
          {body}
        </Pressable>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

/** A cube's round badge, its original artwork: lit while it may still be there, faded after. */
function CubeGlyph({ cube, dense }: { cube: CubeObservation; dense: boolean }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border',
        dense ? 'size-5' : 'size-7',
        actionable(cube.status) ? 'border-accent-line bg-accent-soft' : 'border-line',
      )}
      aria-hidden="true"
    >
      <CubeIcon
        size={dense ? 14 : 20}
        className={actionable(cube.status) ? undefined : 'opacity-50'}
      />
    </span>
  );
}

/**
 * One cube in a few words: where it is (or what happened to it), its state and when it was
 * seen. `card` floats over the workspace map; `strip` sits under the in-game map.
 */
export function CubeSummary({
  cube,
  fresh,
  variant,
  onClose,
  hit = false,
}: {
  cube: CubeObservation;
  fresh: boolean;
  variant: 'card' | 'strip';
  onClose?: (() => void) | undefined;
  hit?: boolean;
}) {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  const status = useCubeStatusWord()(cube);
  const open = actionable(cube.status);
  const card = variant === 'card';
  return (
    <div
      data-cube={cube.id}
      className={cn(
        'flex min-w-0 items-center gap-2.5',
        card && 'rounded-lg border border-line bg-veil p-3 shadow-2 backdrop-blur-sm',
      )}
    >
      <CubeGlyph cube={cube} dense={!card} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {open ? (
            <>
              <CubeDistance cube={cube} size={card ? 'lg' : 'sm'} />
              <CubeLevel height={cube.height_m} short={!card} />
            </>
          ) : (
            <b className="truncate text-sm font-semibold" title={status.title}>
              {status.word}
            </b>
          )}
          {fresh && open && <NewTag />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-3">
          {open && (
            <span
              className={cn('truncate', cube.status === 'opening' && 'font-semibold text-warn')}
              title={status.title}
            >
              {status.word}
            </span>
          )}
          {open && <span aria-hidden="true">·</span>}
          <span className="truncate">{t(($) => $.cubeLabel, { id: cube.id })}</span>
          <span aria-hidden="true">·</span>
          <SeenAgo cube={cube} />
        </span>
        {card && (
          <span className="text-2xs text-ink-4 tabular-nums">
            {t(($) => $.firstSeen, { time: fmt.timeOfDay(cube.first_seen_ms) })}
          </span>
        )}
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

/** The spawn groups of a possible location, by their ordinals (the file's names are internal). */
export function useSpotGroups() {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  return useCallback(
    (groups: readonly number[]) =>
      groups.length === 1
        ? t(($) => $.possible.groupOne, { n: fmt.integer.format(groups[0]!) })
        : t(($) => $.possible.groupMany, {
            list: fmt.list(groups.map((g) => fmt.integer.format(g))),
          }),
    [t, fmt],
  );
}

/**
 * A possible cube location in a few words: that it is only possible, its spawn group and,
 * with your fresh position on its map, how far it is in a straight line. Never a state,
 * a time or an opening: nothing is known about whether a cube is there now.
 */
export function SpotSummary({
  place,
  player,
  variant,
  onClose,
  hit = false,
}: {
  place: Place;
  /** Your fresh position on the same map; null shows no distance. */
  player: { x: number; y: number } | null;
  variant: 'card' | 'strip';
  onClose?: (() => void) | undefined;
  hit?: boolean;
}) {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  const groups = useSpotGroups()(place.groups);
  const card = variant === 'card';
  return (
    <div
      data-spot
      className={cn(
        'flex min-w-0 items-center gap-2.5',
        card && 'rounded-lg border border-line bg-veil p-3 shadow-2 backdrop-blur-sm',
      )}
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-md border border-dashed border-line-strong',
          card ? 'size-7' : 'size-5',
        )}
        aria-hidden="true"
      >
        <CubeIcon size={card ? 20 : 14} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <b className={cn('truncate font-semibold', card ? 'text-base' : 'text-xs')}>
            {t(($) => $.possible.title, { count: place.count })}
          </b>
          {player && (
            <span
              className={cn('shrink-0 text-ink-2 tabular-nums', card ? 'text-sm' : 'text-2xs')}
              title={t(($) => $.possible.distanceTitle)}
            >
              {t(($) => $.possible.distance, {
                distance: metres(spotDistance(place, player), fmt),
              })}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-3">
          <span className="truncate">{groups}</span>
          {!card && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate" title={t(($) => $.possible.note)}>
                {t(($) => $.possible.short)}
              </span>
            </>
          )}
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
