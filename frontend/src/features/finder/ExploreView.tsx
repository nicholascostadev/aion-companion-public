import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Badge, StatusDot } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { StatStrip, Stat } from '../../components/ui/Data';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Checkbox } from '../../components/ui/Field';
import { CubeIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Panel, Section } from '../../components/ui/Panel';
import { windowState, WindowSwitch } from '../../components/ui/WindowSwitch';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { FinderPreferencesControl } from '../../lib/finderPreferences';
import type { ActivityWindowToggle } from '../../types/activityWindows';
import type { CubesStatus } from '../../types/cubes';
import { MapChooser } from '../maps/MapChooser';
import { MarkGlyph } from '../maps/WorldMap';
import { toneOf, type CubeLayer } from '../cubes/map';
import { captureOf, elapsed, positionOf, splitCubes, type CubeCapture } from '../cubes/model';
import {
  CubeRow,
  CubeSummary,
  SpotSummary as CubeSpotSummary,
  useCaptureState,
} from '../cubes/parts';
import { hasCubeSpots } from '../cubes/spawns';
import { nearestSpots } from '../gathering/map';
import { NearRow, SpotSummary as GatheringSpotSummary } from '../gathering/parts';
import { ResourceFilter } from '../gathering/ResourceFilter';
import { FinderMap } from './FinderMap';
import { FINDER_LAYERS, type FinderFocus, type FinderLayer } from './layers';
import { useFinderMap, type FinderMapState } from './useFinderMap';

interface ViewProps {
  native: boolean;
  /** The cube finder's status: the capture context every finder draws with. */
  status: CubesStatus | null;
  /** Cubes received after this window's first snapshot of the session. */
  fresh: ReadonlySet<number>;
  /** The last failed read or Clear. */
  error: string;
  clearing: boolean;
  /** Forgets the received cubes; possible locations and filters are untouched. */
  onClear: () => void;
  /** The saved Explore choices, shared with the in-game Explore window. */
  prefs: FinderPreferencesControl;
  /** The in-game Explore window, which shows these same choices; absent until known. */
  overlay?: ActivityWindowToggle | undefined;
  /** A finder to bring into view (a link to it, or its old tab); its caller shows it. */
  focus?: FinderFocus | null;
  /** False while the tab is hidden: the map art is released and drawn again when shown. */
  drawArt?: boolean;
  /** False while hidden: you are drawn at your measured position, never moving. */
  animate?: boolean;
}

/** Nearest possible gathering locations listed under the map. */
const NEAREST = 5;

const groupTitle = 'm-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase';

/**
 * Explore: every finder on one world map. The map choice, the capture state and each finder as a
 * layer beside the map (shown or hidden on its own, with its own choices), the map with
 * everything shown on it, and under it each shown finder's list: the cubes received in
 * range (nearest first) and earlier this session, and the possible gathering locations
 * nearest you. Selecting a mark, a place or a row shows its details on the map. Beside the
 * map the panel stays in view and scrolls on its own; stacked, the map comes first. What is
 * shown is saved and drawn the same by the in-game Explore window, whose switch is here.
 */
export function ExploreView({
  native,
  status,
  fresh,
  error,
  clearing,
  onClear,
  prefs,
  overlay,
  focus = null,
  drawArt = true,
  animate = true,
}: ViewProps) {
  const { t } = useTranslation('maps');
  const tg = useTranslation('gathering').t;
  const fmt = useFormat();
  const capture = captureOf(status, { native, error });
  const position = positionOf(status);
  const tone = useCaptureState()(capture, position).tone;
  const map = useFinderMap(status, error, prefs);
  const problem =
    error || (capture === 'error' ? status?.message || t(($) => $.capture.error) : '');
  const sections = useRef<Partial<Record<FinderLayer, HTMLElement | null>>>({});
  // A finder asked for is brought into view beside the map.
  useEffect(() => {
    if (focus) sections.current[focus.layer]?.scrollIntoView?.({ block: 'nearest' });
  }, [focus]);
  const { selection, visibility } = map;
  const shownAny = FINDER_LAYERS.some((layer) => visibility[layer]);
  const here = map.context.kind === 'map' ? map.context.map.id : null;
  const layerSections: Record<FinderLayer, ReactNode> = {
    cubes: (
      <CubeLayerSection
        state={map}
        status={status}
        clearing={clearing}
        native={native}
        onClear={onClear}
      />
    ),
    gathering: <GatheringLayerSection state={map} />,
  };
  const layerLists: Record<FinderLayer, ReactNode> = {
    cubes: <CubeLists state={map} status={status} fresh={fresh} capture={capture} />,
    gathering: <NearestList state={map} capture={capture} />,
  };
  return (
    <Section
      title={t(($) => $.title)}
      description={t(($) => $.description)}
      className="mb-16"
      actions={
        overlay && (
          <WindowSwitch
            on={overlay.known && overlay.requested}
            icon="compass"
            label={t(($) => $.overlay.window)}
            title={t(($) => $.overlay.windowTitle)}
            state={windowState({
              known: overlay.known,
              requested: overlay.requested,
              held: !overlay.visible,
            })}
            busy={overlay.busy}
            disabled={!native || !overlay.known}
            onClick={overlay.onToggle}
          />
        )
      }
    >
      {problem && (
        <Notice tone="error" className="mb-4">
          {problem}
        </Notice>
      )}
      <PreferencesNotice prefs={prefs} />
      <div className="grid items-start gap-4 min-[960px]:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 min-[960px]:col-start-2 min-[960px]:row-start-1">
          <FinderMap
            state={map}
            status={status}
            fresh={fresh}
            capture={capture}
            drawArt={drawArt}
            animate={animate}
            className="h-[clamp(22rem,62vh,46rem)]"
          >
            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end">
              {selection ? (
                <div className="pointer-events-auto w-[min(22rem,100%)]">
                  {selection.kind === 'cube' ? (
                    <CubeSummary
                      cube={selection.cube}
                      fresh={fresh.has(selection.cube.id)}
                      variant="card"
                      onClose={map.clearSelection}
                    />
                  ) : selection.kind === 'cubeSpot' ? (
                    <CubeSpotSummary
                      place={selection.place}
                      player={map.player}
                      variant="card"
                      onClose={map.clearSelection}
                    />
                  ) : (
                    <GatheringSpotSummary
                      resource={selection.resource}
                      place={selection.place}
                      player={map.player}
                      variant="card"
                      onClose={map.clearSelection}
                    />
                  )}
                </div>
              ) : (
                (!shownAny ||
                  (visibility.gathering && map.gatheringSpots && !map.visible.places.length)) && (
                  <span
                    className="mx-auto max-w-full rounded-full bg-veil px-3 py-1 text-xs text-ink-2 backdrop-blur-sm"
                    aria-live="polite"
                  >
                    {prefs.phase === 'loading'
                      ? t(($) => $.prefs.loading)
                      : prefs.phase === 'failed'
                        ? t(($) => $.prefs.unavailable)
                        : shownAny
                          ? tg(($) => $.possible.noneShown)
                          : t(($) => $.map.noneShown)}
                  </span>
                )
              )}
            </div>
          </FinderMap>
          <Legend state={map} />
        </div>
        <Panel
          padding="md"
          className="flex flex-col gap-5 min-[960px]:sticky min-[960px]:top-28 min-[960px]:col-start-1 min-[960px]:row-span-2 min-[960px]:row-start-1 min-[960px]:max-h-[calc(100vh-8rem)] min-[960px]:overflow-y-auto"
        >
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            <span className="flex items-center gap-2">
              <StatusDot
                tone={tone === 'live' ? 'accent' : tone === 'warn' ? 'warn' : 'neutral'}
                live={tone === 'live'}
              />
              <span className="font-semibold">{t(($) => $.capture[capture])}</span>
            </span>
            {capture === 'capturing' && (
              <span
                className={cn('pl-4 text-xs', position === 'fresh' ? 'text-ink-3' : 'text-warn')}
              >
                {position === 'fresh'
                  ? t(($) => $.position.fresh)
                  : position === 'stale' && status?.position_age_ms != null
                    ? t(($) => $.position.stale, {
                        age: elapsed(status.position_age_ms, fmt),
                      })
                    : t(($) => $.position.unknown)}
              </span>
            )}
          </div>
          <MapChooser choices={map.choices} shown={map.map.id} here={here} onChoose={map.choose} />
          <div>
            <h3 className={cn(groupTitle, 'mb-1')}>{t(($) => $.layers.label)}</h3>
            <div className="flex flex-col divide-y divide-line-soft">
              {FINDER_LAYERS.map((layer) => (
                <section
                  key={layer}
                  ref={(el) => {
                    sections.current[layer] = el;
                  }}
                  data-finder={layer}
                  data-shown={visibility[layer] || undefined}
                  aria-label={t(($) => $.layers[layer])}
                  className="py-3 last:pb-0"
                >
                  {layerSections[layer]}
                </section>
              ))}
            </div>
          </div>
        </Panel>
        {shownAny && (
          <div className="grid min-w-0 items-start gap-x-6 gap-y-8 min-[960px]:col-start-2 min-[960px]:row-start-2 min-[1180px]:grid-cols-2">
            {FINDER_LAYERS.map(
              (layer) =>
                visibility[layer] && (
                  <div key={layer} className="min-w-0" data-finder-list={layer}>
                    {layerLists[layer]}
                  </div>
                ),
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/** Why the saved choices are not shown or not saved, with a way to read them again. */
function PreferencesNotice({ prefs }: { prefs: FinderPreferencesControl }) {
  const { t } = useTranslation('maps');
  if (prefs.phase === 'failed')
    return (
      <Notice tone="error" className="mb-4">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="min-w-0">{t(($) => $.prefs.readFailed, { error: prefs.error })}</span>
          <Button
            size="xs"
            variant="secondary"
            icon={<Icon name="refresh" />}
            onClick={prefs.retry}
          >
            {t(($) => $.prefs.retry)}
          </Button>
        </span>
      </Notice>
    );
  if (prefs.error)
    return (
      <Notice tone="warn" className="mb-4">
        {t(($) => $.prefs.saveFailed, { error: prefs.error })}
      </Notice>
    );
  return null;
}

/** Hidden cubes: received cubes (nearby, earlier), possible locations, Clear and the caveats. */
function CubeLayerSection({
  state,
  status,
  native,
  clearing,
  onClear,
}: {
  state: FinderMapState;
  status: CubesStatus | null;
  native: boolean;
  clearing: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation('maps');
  const tc = useTranslation('cubes').t;
  const fmt = useFormat();
  const { active, past } = splitCubes(status?.cubes ?? []);
  const on = state.visibility.cubes;
  const layers = state.cubeLayers;
  const set = (layer: CubeLayer, next: boolean) => state.setCubeLayer(layer, next);
  const option = (layer: Exclude<CubeLayer, 'possible'>, count: number) => (
    <Checkbox
      checked={layers[layer]}
      onCheckedChange={(next) => set(layer, next)}
      label={
        <span className="flex items-center gap-2">
          <MarkGlyph kind="cube" tone={layer === 'nearby' ? 'live' : 'past'} />
          {tc(($) => $.layers[layer])}
          <span className="text-ink-3 tabular-nums">{fmt.integer.format(count)}</span>
        </span>
      }
      hint={tc(($) => $.layers.hint[layer])}
    />
  );
  return (
    <>
      <LayerTitle
        on={on}
        disabled={!state.ready}
        onChange={(next) => state.setVisible('cubes', next)}
        icon={<CubeIcon size={18} />}
        name={t(($) => $.layers.cubes)}
        title={t(($) => $.layers.cubesTitle)}
        badge={
          <Badge tone="accent" variant="outline" shape="tag" title={tc(($) => $.experimentalTitle)}>
            {tc(($) => $.experimental)}
          </Badge>
        }
        points={hasCubeSpots() ? (state.cubeSpots?.points ?? null) : undefined}
        map={state.map.name}
      />
      {on && (
        <div className="mt-3 flex flex-col gap-2.5 pl-6">
          {option('nearby', active.length)}
          {option('earlier', past.length)}
          <p className="m-0 text-2xs text-ink-3">{tc(($) => $.layers.captured)}</p>
          {hasCubeSpots() && (
            <Checkbox
              checked={layers.possible}
              onCheckedChange={(next) => set('possible', next)}
              label={
                <span className="flex items-center gap-2">
                  <MarkGlyph kind="cube" spot />
                  {tc(($) => $.possible.layer)}
                  <span className="text-ink-3 tabular-nums">
                    {fmt.integer.format(state.cubeSpots?.points ?? 0)}
                  </span>
                </span>
              }
              hint={state.cubeSpots ? tc(($) => $.possible.hint) : tc(($) => $.possible.none)}
            />
          )}
          <p className="m-0 text-2xs text-ink-3">{tc(($) => $.possible.source)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              icon={<Icon name="eraser" />}
              loading={clearing}
              disabled={!native || !status || clearing}
              title={tc(($) => $.clearTitle)}
              onClick={onClear}
            >
              {tc(($) => $.clear)}
            </Button>
          </div>
          <p className="m-0 text-2xs text-ink-3">{tc(($) => $.limitation)}</p>
        </div>
      )}
    </>
  );
}

/** Gathering: its resource filter and where its places come from. */
function GatheringLayerSection({ state }: { state: FinderMapState }) {
  const { t } = useTranslation('maps');
  const tg = useTranslation('gathering').t;
  const on = state.visibility.gathering;
  return (
    <>
      <LayerTitle
        on={on}
        disabled={!state.ready}
        onChange={(next) => state.setVisible('gathering', next)}
        icon={<Icon name="gathering" size={16} className="text-accent" />}
        name={t(($) => $.layers.gathering)}
        title={t(($) => $.layers.gatheringTitle)}
        points={state.gatheringSpots?.points ?? null}
        map={state.map.name}
      />
      {on && (
        <div className="mt-3 flex flex-col gap-3 pl-6">
          <ResourceFilter
            spots={state.gatheringSpots}
            hidden={state.hidden}
            setHidden={state.setHidden}
            shown={state.visible.resources.length}
          />
          <p className="m-0 text-2xs text-ink-3">{tg(($) => $.source)}</p>
        </div>
      )}
    </>
  );
}

/**
 * A finder's title beside the map: the checkbox that shows or hides it on the map, its
 * original art and name, and how many possible locations the shown map lists for it (a
 * count of its own, never mixed with another finder's).
 */
function LayerTitle({
  on,
  disabled,
  onChange,
  icon,
  name,
  title,
  badge,
  points,
  map,
}: {
  on: boolean;
  /** Until the saved choices are known. */
  disabled: boolean;
  onChange: (on: boolean) => void;
  icon: ReactNode;
  name: string;
  title: string;
  badge?: ReactNode;
  /** Possible locations on the shown map; null when none are listed, undefined to say nothing. */
  points: number | null | undefined;
  map: string;
}) {
  const { t } = useTranslation('maps');
  return (
    <Checkbox
      checked={on}
      disabled={disabled}
      onCheckedChange={onChange}
      title={title}
      label={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          {icon}
          {name}
          {badge}
        </span>
      }
      hint={
        points === undefined ? undefined : (
          <span data-points={points ?? 0} className="tabular-nums">
            {points === null
              ? t(($) => $.layers.noneHere, { map })
              : t(($) => $.layers.possibleHere, { count: points, map })}
            {!on && ` · ${t(($) => $.layers.off)}`}
          </span>
        )
      }
    />
  );
}

/** What the marks on the map are, for the finders shown. */
function Legend({ state }: { state: FinderMapState }) {
  const { t } = useTranslation('maps');
  const { visibility, cubeLayers } = state;
  const cubes = visibility.cubes;
  const items: { key: string; glyph: ReactNode; label: string }[] = [
    ...(cubes && cubeLayers.nearby
      ? [
          {
            key: 'live',
            glyph: <MarkGlyph kind="cube" tone="live" />,
            label: t(($) => $.legend.live),
          },
        ]
      : []),
    ...(cubes && cubeLayers.earlier
      ? [
          {
            key: 'earlier',
            glyph: <MarkGlyph kind="cube" tone="past" />,
            label: t(($) => $.legend.earlier),
          },
        ]
      : []),
    ...(cubes && cubeLayers.possible && hasCubeSpots()
      ? [
          {
            key: 'possibleCube',
            glyph: <MarkGlyph kind="cube" spot />,
            label: t(($) => $.legend.possibleCube),
          },
        ]
      : []),
    ...(visibility.gathering
      ? [
          {
            key: 'possibleGathering',
            glyph: <MarkGlyph kind="gathering" glyph={{ text: '' }} />,
            label: t(($) => $.legend.possibleGathering),
          },
        ]
      : []),
    ...((cubes && cubeLayers.possible) || visibility.gathering
      ? [
          {
            key: 'group',
            glyph: (
              <span
                className="inline-block h-3 w-6 rounded-xs border border-marker-possible bg-ink-inverse/80"
                aria-hidden="true"
              />
            ),
            label: t(($) => $.legend.group),
          },
        ]
      : []),
    {
      key: 'you',
      glyph: <MarkGlyph kind="you" />,
      label: t(($) => $.legend.you),
    },
  ];
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-1 p-0 text-xs text-ink-3">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5" data-legend={item.key}>
          {item.glyph}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The cubes of the current context: those in range (nearest first) and those seen earlier
 * this session, with the session figures. A row brings its cube's map back into view,
 * shows its layer and selects it.
 */
function CubeLists({
  state,
  status,
  fresh,
  capture,
}: {
  state: FinderMapState;
  status: CubesStatus | null;
  fresh: ReadonlySet<number>;
  capture: CubeCapture;
}) {
  const { t } = useTranslation('cubes');
  const fmt = useFormat();
  const position = positionOf(status);
  const { active, past } = splitCubes(status?.cubes ?? []);
  const newCount = active.filter((c) => fresh.has(c.id)).length;
  const selected = state.selection?.kind === 'cube' ? state.selection.cube.id : null;
  const pick = (id: number) => {
    if (selected === id) return state.selectCube(null);
    if (state.context.kind === 'map' && !state.current) state.follow();
    const cube = status?.cubes.find((c) => c.id === id);
    const layer = cube && toneOf(cube) === 'past' ? 'earlier' : 'nearby';
    if (!state.cubeLayers[layer]) state.setCubeLayer(layer, true);
    state.selectCube(id);
  };
  const rows = (list: typeof active, label: string, live: boolean) => (
    <ul aria-label={label} className="m-0 list-none border-y border-line-soft p-0">
      {list.map((cube) => (
        <CubeRow
          key={cube.id}
          cube={cube}
          fresh={live && fresh.has(cube.id)}
          selected={selected === cube.id}
          onSelect={() => pick(cube.id)}
        />
      ))}
    </ul>
  );
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <h3 className={groupTitle}>{t(($) => $.list)}</h3>
        {newCount > 0 && (
          <Badge tone="accent" shape="tag" dot="live">
            {t(($) => $.newCount, { count: newCount })}
          </Badge>
        )}
      </div>
      {capture === 'capturing' && position !== 'fresh' && active.length > 0 && (
        <p className="m-0 mb-2 text-xs text-warn">{t(($) => $.position.hint)}</p>
      )}
      {active.length > 0 ? (
        rows(
          active,
          t(($) => $.list),
          true,
        )
      ) : capture === 'capturing' ? (
        <EmptyState compact live icon={<CubeIcon size={28} />} title={t(($) => $.empty.title)}>
          {t(($) => $.empty.note)}
        </EmptyState>
      ) : (
        <EmptyState
          compact
          live={capture === 'loading' || capture === 'starting' || capture === 'waiting'}
          icon={capture === 'error' ? <Icon name="warning" size={20} /> : <CubeIcon size={28} />}
          title={t(($) => $.capture[capture])}
        />
      )}
      {past.length > 0 && (
        <>
          <h3 className={cn(groupTitle, 'mt-6 mb-2')}>{t(($) => $.earlier)}</h3>
          {rows(
            past,
            t(($) => $.earlier),
            false,
          )}
        </>
      )}
      {status && (
        <StatStrip variant="open" columns={3} className="mt-4 w-full">
          <Stat label={t(($) => $.stats.nearby)} value={fmt.integer.format(active.length)} />
          <Stat
            label={t(($) => $.stats.sightings)}
            value={fmt.integer.format(status.observed_total)}
          />
          <Stat
            label={t(($) => $.stats.openings)}
            value={fmt.integer.format(status.opened_total)}
            title={t(($) => $.stats.openingsHint)}
          />
        </StatStrip>
      )}
    </>
  );
}

/** The shown possible gathering locations nearest your fresh position on the shown map. */
function NearestList({ state, capture }: { state: FinderMapState; capture: CubeCapture }) {
  const { t } = useTranslation('gathering');
  const near = useMemo(
    () => nearestSpots(state.visible, state.player, NEAREST),
    [state.visible, state.player],
  );
  const selected = state.selection?.kind === 'gathering' ? state.selection.ref : null;
  return (
    <>
      <h3 className={cn(groupTitle, 'mb-2')}>{t(($) => $.nearest.title)}</h3>
      {near.length > 0 ? (
        <ul
          aria-label={t(($) => $.nearest.title)}
          className="m-0 list-none border-y border-line-soft p-0"
        >
          {near.map((spot) => {
            const on = selected?.key === spot.ref.key && selected.index === spot.ref.index;
            return (
              <NearRow
                key={`${spot.ref.key}:${spot.ref.index}`}
                spot={spot}
                selected={on}
                onSelect={() => state.selectGathering(on ? null : spot.ref)}
              />
            );
          })}
        </ul>
      ) : (
        <EmptyState
          compact
          live={capture === 'loading' || capture === 'starting' || capture === 'waiting'}
          icon={<Icon name="locate" size={20} />}
          title={
            state.player
              ? t(($) => $.nearest.none)
              : state.context.kind === 'map' && !state.current
                ? t(($) => $.nearest.otherMap)
                : t(($) => $.nearest.needPosition)
          }
        />
      )}
    </>
  );
}
