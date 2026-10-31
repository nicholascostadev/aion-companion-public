import { useMemo, type Ref } from 'react';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Select } from '../../components/ui/Field';
import { CubeIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import {
  CaptionState,
  CaptionTitle,
  OverlayCaption,
  overlayWindow,
  WindowButton,
} from '../../components/ui/Overlay';
import { useFormat, useLocale, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { FinderPreferencesControl } from '../../lib/finderPreferences';
import type { ActivityWindowStatus } from '../../types/activityWindows';
import type { CubesStatus } from '../../types/cubes';
import type { WorldMotionStatus } from '../../types/worldMotion';
import { useWindowDrag } from '../live/windowDrag';
import { MarkGlyph } from '../maps/WorldMap';
import { captureOf, elapsed, positionOf, splitCubes } from '../cubes/model';
import { CubeSummary, SpotSummary as CubeSpotSummary, useCaptureState } from '../cubes/parts';
import { hasCubeSpots } from '../cubes/spawns';
import {
  categoriesOf,
  filterChoice,
  hiddenFor,
  nearestSpots,
  type FilterChoice,
} from '../gathering/map';
import { SpotSummary as GatheringSpotSummary } from '../gathering/parts';
import { gatheringResources } from '../gathering/spawns';
import { FinderMap } from './FinderMap';
import { FINDER_LAYERS } from './layers';
import { useFinderMap } from './useFinderMap';

interface Props {
  native: boolean;
  /** The cube finder's status: the capture context every layer draws with. */
  status: CubesStatus | null;
  /** Native's pushed motion: moves you and the map the moment a fix is validated. */
  motion?: WorldMotionStatus | null;
  /** Cubes received after this window's first snapshot of the session. */
  fresh: ReadonlySet<number>;
  /** The saved Explore choices, shared with the workspace's Explore tab. */
  prefs: FinderPreferencesControl;
  window: ActivityWindowStatus;
  busy: boolean;
  clearing: boolean;
  /** The last failed read or Clear. */
  error: string;
  /** A failed show, hide or lock. */
  windowError?: string;
  /** False while hidden: the map art is released and drawn again when shown. */
  drawArt?: boolean;
  /** False while hidden: you are drawn at your measured position, never moving. */
  animate?: boolean;
  onClear: () => void;
  onLock: (locked: boolean) => void;
  onHide: () => void;
  onDrag?: () => void;
  onResize?: () => void;
  hitRef?: Ref<HTMLElement>;
}

/** Below these window heights the filters, the summary, then the footer give their room to the map. */
const FILTERS = '[@media(max-height:239px)]:hidden';
const SUMMARY = '[@media(max-height:279px)]:hidden';
const FOOTER = '[@media(max-height:199px)]:hidden';

/**
 * The in-game Explore window: a minimap of the map you are on, centred on you, with the
 * workspace's Explore layers (its layers, cube sub-layers and hidden resources, all saved
 * and shared). The workspace's map choice is its own: this window always follows the
 * current map and your position, and without a trusted current map (an unknown area,
 * capture off) it draws no map and lists no place, saying why; a failed read keeps the map
 * last followed, without you. A caption with the capture state; the current map's name and
 * the layer switches; the filters of the shown layers; the map with possible locations, the
 * current cubes and you (moving smoothly with your facing, or last known); the selected place
 * or cube (else the nearest cube, else the nearest gathering place) under it and Clear in the
 * footer. Every layer change made here is saved and shown in the Explore tab too. With every
 * layer hidden the map stays, empty, and says so. The map never pans: its zoom controls (and
 * a group of places) zoom about you, and the window moves by its caption or footer. Locked,
 * the map is click-through; the caption buttons, switches, map controls and Clear stay
 * clickable.
 */
export function ExploreOverlay({
  native,
  status,
  motion = null,
  fresh,
  prefs,
  window: win,
  busy,
  clearing,
  error,
  windowError = '',
  drawArt = true,
  animate = true,
  onClear,
  onLock,
  onHide,
  onDrag,
  onResize,
  hitRef,
}: Props) {
  const { t } = useTranslation('maps');
  const tc = useTranslation('cubes').t;
  const tg = useTranslation('gathering').t;
  const fmt = useFormat();
  const locale = useLocale();
  const drag = useWindowDrag(native && !win.locked ? onDrag : undefined);
  const capture = captureOf(status, { native, error });
  const position = positionOf(status);
  const state = useCaptureState()(capture, position);
  // Always the map you are on; the workspace's map choice is its own.
  const map = useFinderMap(status, error, prefs, { follow: true });
  const { visibility, cubeLayers, selection } = map;
  const shownAny = FINDER_LAYERS.some((layer) => visibility[layer]);
  const cubesOn = visibility.cubes;
  const receivedOn = cubesOn && (cubeLayers.nearby || cubeLayers.earlier);
  const { active } = splitCubes(status?.cubes ?? []);
  const nearestCube = receivedOn && cubeLayers.nearby && map.current ? (active[0] ?? null) : null;
  const nearestPlace = useMemo(
    () => (visibility.gathering ? (nearestSpots(map.visible, map.player, 1)[0] ?? null) : null),
    [visibility.gathering, map.visible, map.player],
  );
  const problem =
    error ||
    windowError ||
    win.errors[0] ||
    (prefs.phase === 'failed' ? t(($) => $.prefs.unavailable) : '') ||
    (prefs.error ? t(($) => $.prefs.saveFailed, { error: prefs.error }) : '') ||
    (capture === 'error' ? status?.message || tc(($) => $.capture.error) : '');
  // The gathering choice reads over the whole catalogue, so it is the same on every map.
  const all = gatheringResources();
  const choice = filterChoice(all, map.hidden);
  const categories = categoriesOf(map.gatheringSpots);
  const listed = new Set<string>([
    'all',
    ...categories.flatMap((c) => [
      `category:${c.category}`,
      ...c.resources.map((r) => `resource:${r.resource.key}`),
    ]),
  ]);
  const elsewhere = all.find((r) => choice === `resource:${r.key}`);
  const showPossible = cubesOn && hasCubeSpots();
  const showFilter = visibility.gathering && map.gatheringSpots !== null;
  const disabled = !map.ready;
  return (
    <section
      ref={hitRef}
      className={overlayWindow({ glass: 'deep', editing: !win.locked })}
      aria-label={t(($) => $.overlay.title)}
      {...drag}
    >
      <OverlayCaption className="gap-1 pl-3">
        <CaptionTitle label={t(($) => $.overlay.title)} icon={<Icon name="compass" size={13} />} />
        <CaptionState tone={state.tone} title={problem || undefined}>
          {state.word}
        </CaptionState>
        <WindowButton
          data-hit
          aria-label={win.locked ? t(($) => $.overlay.unlock) : t(($) => $.overlay.lock)}
          title={win.locked ? t(($) => $.overlay.unlockTitle) : t(($) => $.overlay.lock)}
          aria-pressed={win.locked}
          disabled={!native || busy}
          onClick={() => onLock(!win.locked)}
        >
          <Icon name={win.locked ? 'lock' : 'unlock'} size={12} />
        </WindowButton>
        <WindowButton
          data-hit
          close
          aria-label={t(($) => $.overlay.hide)}
          title={t(($) => $.overlay.hide)}
          disabled={!native || busy}
          onClick={onHide}
        >
          <Icon name="close" size={13} />
        </WindowButton>
      </OverlayCaption>
      {problem && (
        <output
          className="m-0 block truncate border-b border-line-soft px-3 py-1 text-2xs text-warn"
          title={problem}
        >
          {problem}
        </output>
      )}
      <div className="flex flex-none items-center gap-1.5 px-2 pt-1.5 pb-1">
        {/* The map you are on, followed: there is no other to choose here. */}
        {map.onMap && (
          <p
            className={cn(
              'm-0 flex min-w-0 items-center gap-1 text-xs font-semibold',
              map.current ? 'text-ink' : 'text-ink-3',
            )}
            title={t(($) => $.overlay.follows)}
            data-map-name
          >
            <Icon
              name="locate"
              size={11}
              className={cn('shrink-0', map.current ? 'text-accent' : 'text-ink-3')}
            />
            <span className="truncate">{map.map.name}</span>
          </p>
        )}
        <fieldset
          aria-label={t(($) => $.overlay.layers)}
          className="m-0 ml-auto flex min-w-0 border-0 p-0 flex-none items-center gap-1"
        >
          <Chip
            data-hit
            size="xs"
            pressed={visibility.cubes}
            onPressedChange={(on) => map.setVisible('cubes', on)}
            disabled={disabled}
            icon={<CubeIcon size={14} />}
            aria-label={t(($) => $.layers.cubes)}
            title={t(($) => $.overlay.cubesTitle)}
            className="px-1.5"
          />
          <Chip
            data-hit
            size="xs"
            pressed={visibility.gathering}
            onPressedChange={(on) => map.setVisible('gathering', on)}
            disabled={disabled}
            icon={<Icon name="gathering" size={12} />}
            aria-label={t(($) => $.layers.gathering)}
            title={t(($) => $.overlay.gatheringTitle)}
            className="px-1.5"
          />
        </fieldset>
      </div>
      {(showPossible || showFilter) && (
        <div className={cn('flex flex-none items-center gap-1.5 px-2 pb-1', FILTERS)}>
          {showPossible && (
            <Chip
              data-hit
              size="xs"
              pressed={cubeLayers.possible}
              onPressedChange={(on) => map.setCubeLayer('possible', on)}
              disabled={disabled}
              icon={<MarkGlyph kind="cube" spot className="size-3.5" />}
              title={t(($) => $.overlay.possibleTitle)}
              className="shrink-0"
            >
              {t(($) => $.overlay.possible)}
            </Chip>
          )}
          {showFilter && (
            <Select
              data-hit
              size="sm"
              aria-label={tg(($) => $.filter.choose)}
              title={tg(($) => $.filter.choose)}
              value={choice}
              disabled={disabled}
              onChange={(e) =>
                map.setHidden(hiddenFor(all, e.target.value as FilterChoice, map.hidden))
              }
              wrapperClassName="ml-auto min-w-0 flex-1 basis-28"
              className="h-6 text-2xs"
            >
              <option value="all">{tg(($) => $.filter.everything)}</option>
              {choice === 'custom' && (
                <option value="custom" disabled>
                  {tg(($) => $.filter.custom)}
                </option>
              )}
              {elsewhere && !listed.has(choice) && (
                <option value={choice}>{elsewhere.name[locale]}</option>
              )}
              {categories.map(({ category, resources }) => (
                <optgroup key={category} label={tg(($) => $.categories[category])}>
                  <option value={`category:${category}`}>
                    {tg(($) => $.filter.category, { category: tg(($) => $.categories[category]) })}
                  </option>
                  {resources.map((r) => (
                    <option key={r.resource.key} value={`resource:${r.resource.key}`}>
                      {r.resource.name[locale]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </div>
      )}
      {!map.onMap ? (
        // No trusted current map: nothing to follow, so no map (and no place) is drawn.
        <div
          className="mx-2 mb-2 flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-md border border-line bg-paper px-3 text-center inset-shadow-well"
          data-map="none"
          aria-live="polite"
        >
          <Icon name="compass" size={18} className="text-ink-3" />
          <b className="max-w-full truncate text-xs font-semibold text-ink-2">
            {map.context.kind === 'unknown'
              ? t(($) => $.map.unknownShort)
              : map.context.kind === 'hidden'
                ? t(($) => $.map.hidden)
                : capture === 'capturing'
                  ? t(($) => $.overlay.noMap)
                  : t(($) => $.capture[capture])}
          </b>
          <span className="max-w-full truncate text-2xs text-ink-3">
            {map.context.kind === 'unknown'
              ? t(($) => $.overlay.unknownHint)
              : t(($) => $.overlay.follows)}
          </span>
        </div>
      ) : (
        <FinderMap
          state={map}
          status={status}
          motion={motion}
          fresh={fresh}
          capture={capture}
          interactive={!win.locked}
          hit
          compact
          drawArt={drawArt}
          animate={animate}
          className="mx-2 mb-2 min-h-12 flex-1"
        >
          {(!shownAny ||
            (visibility.gathering &&
              !cubesOn &&
              map.gatheringSpots &&
              !map.visible.places.length)) && (
            // Said under the map too while the summary has room; over it once it has not.
            <div
              className={cn(
                'pointer-events-none absolute inset-x-1 bottom-1 flex justify-center',
                '[@media(min-height:280px)]:hidden',
              )}
            >
              <span
                className="max-w-full truncate rounded-full bg-veil px-2 py-0.5 text-3xs text-ink-2 backdrop-blur-sm"
                aria-live="polite"
              >
                {prefs.phase === 'loading'
                  ? t(($) => $.prefs.loading)
                  : prefs.phase === 'failed'
                    ? t(($) => $.prefs.unavailable)
                    : shownAny
                      ? tg(($) => $.possible.noneShown)
                      : t(($) => $.overlay.noneShown)}
              </span>
            </div>
          )}
        </FinderMap>
      )}
      <div
        className={cn(
          'flex min-h-10 flex-none items-center border-t border-line-soft px-3 py-1.5',
          SUMMARY,
        )}
        aria-live="polite"
      >
        {selection?.kind === 'cube' ? (
          <div className="min-w-0 flex-1">
            <CubeSummary
              cube={selection.cube}
              fresh={fresh.has(selection.cube.id)}
              variant="strip"
              hit
              onClose={map.clearSelection}
            />
          </div>
        ) : selection?.kind === 'cubeSpot' ? (
          <div className="min-w-0 flex-1">
            <CubeSpotSummary
              place={selection.place}
              player={map.player}
              variant="strip"
              hit
              onClose={map.clearSelection}
            />
          </div>
        ) : selection?.kind === 'gathering' ? (
          <div className="min-w-0 flex-1">
            <GatheringSpotSummary
              resource={selection.resource}
              place={selection.place}
              player={map.player}
              variant="strip"
              hit
              onClose={map.clearSelection}
            />
          </div>
        ) : !shownAny ? (
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-xs font-semibold">
              {prefs.phase === 'ready'
                ? t(($) => $.overlay.noneShown)
                : prefs.phase === 'loading'
                  ? t(($) => $.prefs.loading)
                  : t(($) => $.prefs.unavailable)}
            </b>
            {prefs.phase === 'ready' && (
              <span className="truncate text-2xs text-ink-3">
                {t(($) => $.overlay.noneShownHint)}
              </span>
            )}
          </div>
        ) : nearestCube && capture === 'capturing' ? (
          <div className="min-w-0 flex-1">
            <CubeSummary cube={nearestCube} fresh={fresh.has(nearestCube.id)} variant="strip" hit />
          </div>
        ) : nearestPlace ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-4xs font-semibold tracking-caps text-ink-3 uppercase">
              {t(($) => $.overlay.nearest)}
            </span>
            <div className="min-w-0 flex-1">
              <GatheringSpotSummary
                resource={nearestPlace.resource}
                place={nearestPlace.place}
                player={map.player}
                variant="strip"
                hit
              />
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-xs font-semibold">
              {capture !== 'capturing'
                ? t(($) => $.capture[capture])
                : receivedOn
                  ? tc(($) => $.empty.title)
                  : t(($) => $.capture.capturing)}
            </b>
            <span className="truncate text-2xs text-ink-3">
              {position === 'stale' && status?.position_age_ms != null
                ? t(($) => $.position.stale, {
                    age: elapsed(status.position_age_ms, fmt),
                  })
                : map.context.kind === 'map' && !map.current
                  ? tg(($) => $.nearest.otherMap)
                  : position === 'fresh'
                    ? receivedOn
                      ? tc(($) => $.limitation)
                      : tg(($) => $.possible.note)
                    : t(($) => $.position.unknown)}
            </span>
          </div>
        )}
      </div>
      <footer
        className={cn(
          'flex h-8 flex-none items-center gap-2 border-t border-line-strong pr-4 pl-3 text-2xs text-ink-3',
          FOOTER,
        )}
      >
        <span
          className="min-w-0 flex-1 truncate tabular-nums"
          title={
            status && receivedOn
              ? tc(($) => $.totals, {
                  observed: status.observed_total,
                  opened: status.opened_total,
                })
              : undefined
          }
        >
          {status && receivedOn
            ? tc(($) => $.sessionTotals, {
                observed: status.observed_total,
                opened: status.opened_total,
              })
            : visibility.gathering
              ? tg(($) => $.possible.count, { count: map.visible.points })
              : ''}
        </span>
        {receivedOn && (
          <Button
            data-hit
            variant="ghost"
            size="2xs"
            icon={<Icon name="eraser" />}
            loading={clearing}
            disabled={!native || !status || clearing}
            title={tc(($) => $.clearTitle)}
            onClick={onClear}
          >
            {tc(($) => $.clear)}
          </Button>
        )}
      </footer>
      {native && !win.locked && onResize && (
        <WindowButton
          data-hit
          aria-label={t(($) => $.overlay.resize)}
          title={t(($) => $.overlay.resizeTitle)}
          className="absolute right-0 bottom-0 size-3 cursor-se-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResize();
          }}
        >
          <Icon name="grip" size={10} />
        </WindowButton>
      )}
    </section>
  );
}
