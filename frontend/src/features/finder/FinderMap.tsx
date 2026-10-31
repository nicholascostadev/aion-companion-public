import { useMemo, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { shownMotion } from '../../lib/worldMotion';
import type { CubesStatus } from '../../types/cubes';
import type { WorldMotionStatus } from '../../types/worldMotion';
import { parseSpotKey, spotKey, WorldMap, type MapPlayer, type SpotLayer } from '../maps/WorldMap';
import { useCubeMarkLabel, useCubeSpotLayer } from '../cubes/CubeMap';
import { cubeMarks, markKey, SPOT_LAYER, type CubeLayers } from '../cubes/map';
import { elapsed, type CubeCapture } from '../cubes/model';
import { useGatheringSpotLayer } from '../gathering/GatheringMap';
import { GATHERING_LAYER, NO_SPOTS, spotAt } from '../gathering/map';
import type { FinderMapState, FinderSelection } from './useFinderMap';
import { usePlayerMark } from './usePlayerMark';

const NO_CUBES: CubeLayers = { nearby: false, earlier: false, possible: false };

/** The selection's key on the map, as `WorldMap` draws it. */
const selectedKey = (selection: FinderSelection | null) => {
  if (!selection) return null;
  if (selection.kind === 'cube') return markKey(selection.cube.id);
  if (selection.kind === 'cubeSpot') return spotKey(SPOT_LAYER, selection.index);
  return spotKey(GATHERING_LAYER, selection.index);
};

/**
 * Every shown finder on one map: original art of the chosen map, the possible locations of
 * each shown finder grouped together (a group shared by several kinds keeps each kind's
 * glyph and count), the current context's received cubes over them and you (a fresh
 * position moving smoothly between fixes, else the last known one, with your fresh facing),
 * and a few words over it when you are elsewhere, last known, estimated or not known. Possible
 * locations stay whatever capture is doing; received cubes and you go with a failed read.
 * With `motion` you (and a following camera) move the moment native pushes a fix, while the
 * map, the cubes and every distance stay `status`'s (see `shownMotion`).
 */
export function FinderMap({
  state,
  status,
  motion = null,
  fresh,
  capture,
  interactive = true,
  hit = false,
  compact = false,
  drawArt = true,
  animate = true,
  className,
  children,
}: {
  state: FinderMapState;
  status: CubesStatus | null;
  /** Native's pushed motion, when this window listens to it; never measured from. */
  motion?: WorldMotionStatus | null;
  fresh: ReadonlySet<number>;
  capture: CubeCapture;
  /** False on a locked in-game window: the map neither pans nor zooms by pointer. */
  interactive?: boolean;
  /** Marks the map's controls as native hit regions (an in-game window). */
  hit?: boolean;
  /** The smaller controls and notes of an in-game window. */
  compact?: boolean;
  /** False while hidden: the map art is released and drawn again when shown. */
  drawArt?: boolean;
  /** False while hidden: you are drawn at your measured position, never moving. */
  animate?: boolean;
  className?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useTranslation('maps');
  const fmt = useFormat();
  const label = useCubeMarkLabel();
  const { context, map, visibility, cubeLayers, visible, selection } = state;
  const cubeSpots = useCubeSpotLayer(state.cubeSpots, visibility.cubes && cubeLayers.possible);
  const gatheringSpots = useGatheringSpotLayer(visibility.gathering ? visible : NO_SPOTS);
  const spots = useMemo<readonly SpotLayer[]>(
    () => [...cubeSpots, ...gatheringSpots],
    [cubeSpots, gatheringSpots],
  );
  const { marks } = cubeMarks({
    status,
    context,
    map,
    layers: visibility.cubes ? cubeLayers : NO_CUBES,
    fresh,
    label,
  });
  // You as drawn: from the newest validated fix, smoothed and briefly predicted, or last
  // known. Every distance and list keeps using `state.player`, the cube status's fresh fix.
  const own = shownMotion(status, motion);
  const you = usePlayerMark(own, context, map, drawArt && animate);
  const live = marks.filter((m) => m.tone !== 'past').length;
  const counts = [
    ...(visibility.cubes && (cubeLayers.nearby || cubeLayers.earlier)
      ? [t(($) => $.count.live, { count: live })]
      : []),
    ...(cubeSpots.length ? [t(($) => $.count.cubes, { count: state.cubeSpots?.points ?? 0 })] : []),
    ...(gatheringSpots.length ? [t(($) => $.count.gathering, { count: visible.points })] : []),
  ];
  return (
    <WorldMap
      map={map}
      marks={marks}
      spots={spots}
      player={you}
      selected={selectedKey(selection)}
      onSelect={(key) => {
        const spot = parseSpotKey(key);
        if (!key) state.clearSelection();
        else if (spot?.layer === SPOT_LAYER) state.selectCubeSpot(spot.index);
        else if (spot?.layer === GATHERING_LAYER)
          state.selectGathering(spotAt(visible, spot.index)?.ref ?? null);
        else state.selectCube(Number(key.slice(key.indexOf(':') + 1)));
      }}
      title={
        counts.length
          ? t(($) => $.map.title, { map: map.name, list: fmt.list(counts) })
          : t(($) => $.map.titleEmpty, { map: map.name })
      }
      interactive={interactive}
      follow={state.following}
      hit={hit}
      compact={compact}
      drawArt={drawArt}
      className={className}
    >
      <MapNotes
        state={state}
        you={you}
        ageMs={own?.position_age_ms ?? null}
        capture={capture}
        hit={hit}
        compact={compact}
      />
      {children}
    </WorldMap>
  );
}

/**
 * Chips over the map's top-left corner: why you are not shown, or where you are; a last
 * known or estimated position says so.
 */
function MapNotes({
  state,
  you,
  ageMs,
  capture,
  hit,
  compact,
}: {
  state: FinderMapState;
  you: MapPlayer | null;
  /** Age of your last own position, as native reports it. */
  ageMs: number | null;
  capture: CubeCapture;
  hit: boolean;
  compact: boolean;
}) {
  const { t } = useTranslation('maps');
  const fmt = useFormat();
  const { context, current, player } = state;
  const chip = cn(
    'max-w-full truncate rounded-full bg-veil backdrop-blur-sm',
    compact ? 'px-2 py-0.5 text-3xs' : 'px-2.5 py-1 text-2xs',
  );
  const note = (text: string, warn = false, title?: string) => (
    <span className={cn(chip, warn ? 'text-warn' : 'text-ink-2')} title={title ?? text}>
      {text}
    </span>
  );
  let body: ReactNode = null;
  if (context.kind === 'hidden')
    body = note(
      t(($) => $.map.hidden),
      true,
    );
  // Without a capture context the capture state is shown beside the map, not over it.
  else if (context.kind === 'none') body = null;
  else if (context.kind === 'unknown')
    body = note(
      t(($) => $.map.unknownShort),
      false,
      t(($) => $.map.unknown),
    );
  else if (!current)
    body = (
      <Button
        {...(hit ? { 'data-hit': '' } : {})}
        size={compact ? '2xs' : 'xs'}
        icon={<Icon name="locate" />}
        className="pointer-events-auto max-w-full bg-veil backdrop-blur-sm"
        title={t(($) => $.map.backTitle)}
        onClick={state.follow}
      >
        <span className="truncate">{t(($) => $.map.back, { map: context.map.name })}</span>
      </Button>
    );
  else if (you?.last)
    body = note(
      t(($) => $.map.lastKnown),
      true,
      ageMs === null
        ? t(($) => $.position.hint)
        : t(($) => $.map.lastKnownTitle, { age: elapsed(ageMs, fmt) }),
    );
  // Said by what is drawn: a newer pushed fix can show you before the cube status has one.
  else if (!you && !player && capture === 'capturing')
    body = note(
      t(($) => $.map.noPosition),
      true,
      t(($) => $.position.hint),
    );
  else if (you?.estimated)
    // Comes and goes with every step, so it is not announced; your mark's name says it.
    body = (
      <span
        className={cn(chip, 'text-ink-2')}
        title={t(($) => $.map.estimatedTitle)}
        data-chip="estimated-position"
        aria-hidden="true"
      >
        {t(($) => $.map.estimated)}
      </span>
    );
  if (!body) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute flex flex-col items-start gap-1',
        compact ? 'top-1 left-1 max-w-[calc(100%-8.5rem)]' : 'top-2 left-2 max-w-[calc(100%-4rem)]',
      )}
      aria-live="polite"
    >
      {body}
    </div>
  );
}
