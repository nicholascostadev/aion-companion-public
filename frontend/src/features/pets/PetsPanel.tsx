import { useEffect, useMemo, useState } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../../components/ui/Collapsible';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { SearchInput, Select, Switch } from '../../components/ui/Field';
import { PetPortrait } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { TabList, TabPanel, Tabs } from '../../components/ui/Tabs';
import { WindowSwitch, windowState } from '../../components/ui/WindowSwitch';
import { Trans, useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { PETS_LIMITS } from '../../lib/petsNormalize';
import type {
  PetFamily,
  PetFarmingGoal,
  PetsConfig,
  PetsStatus,
  PetWindowStatus,
} from '../../types/pets';
import { FarmDetail, type FarmActions } from './FarmDetail';
import { bestFarmMap, farmPlan, goalValid, pickPets, searchMaps, type PickMode } from './farming';
import { FamilyOnly, FarmPicker } from './FarmPicker';
import { FarmView, type MapLayers } from './FarmView';
import { isFarmMap } from './maps';
import {
  ago,
  collectionNotice,
  collectionStates,
  collectionSync,
  familySummaries,
  filterPets,
  liveState,
  mapName,
  metres,
  nearbyRows,
  obtainHint,
  onMap,
  positionFresh,
  positionMap,
  soulsLeftLabel,
  stateOf,
  type CollectionSync,
  type PetFilter,
  type PetIndex,
  type PetState,
} from './model';
import { liveHint } from './Nearby';
import { PetCardGrid } from './PetCards';
import { LevelPips, SessionSummary } from './parts';
import { TypeOverview } from './TypeOverview';

type View = 'map' | 'collection';

function profileName(p: PetsStatus['profiles'][number], t: Translate<'pets'>) {
  const name = p.name || t(($) => $.panel.unnamed);
  return p.server_id === null ? name : t(($) => $.panel.profile, { name, server: p.server_id });
}

function profileLabel(status: PetsStatus | null, id: string | null, t: Translate<'pets'>) {
  const p = status?.profiles.find((x) => x.id === id);
  return p ? profileName(p, t) : null;
}

/** How current the collection shown is, after the character's name. */
function syncLabel(kind: CollectionSync['kind'], t: Translate<'pets'>) {
  switch (kind) {
    case 'none':
    case 'empty':
      return '';
    case 'current':
    case 'waiting':
    case 'cached':
    case 'saved':
      return t(($) => $.panel.sync[kind]);
  }
}

/**
 * One line: whose collection this is, how current it is, its totals and this session. The
 * Level 3 counts are the overview's.
 */
function StatusLine({
  status,
  sync,
  now,
  totals,
}: {
  status: PetsStatus | null;
  sync: CollectionSync;
  now: number;
  totals: { owned: number; total: number; toMax: number | null } | null;
}) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  if (!status) return null;
  const name = profileLabel(status, status.profile_id, t);
  const label = syncLabel(sync.kind, t);
  const synced = status.profiles.find((p) => p.id === status.profile_id)?.synced_ms ?? null;
  const tone =
    sync.kind === 'current'
      ? 'accent'
      : sync.kind === 'waiting' || sync.kind === 'cached'
        ? 'warn'
        : 'neutral';
  return (
    <div className="pets-sync flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-2">
      <StatusDot tone={tone} live={tone === 'accent'} />
      <span className="min-w-0">
        {!name ? (
          t(($) => $.panel.noCharacter)
        ) : (
          <>
            <b className="text-ink">{name}</b>
            {label && ` · ${label}`}
          </>
        )}
        {synced !== null && (
          <span className="text-xs text-ink-3" title={fmt.dateTime(synced)}>
            {' '}
            · {t(($) => $.panel.lastSync, { ago: ago(now - synced, t) })}
          </span>
        )}
      </span>
      {totals && (
        <span className="pets-figures inline-flex flex-wrap gap-x-2.5 gap-y-0.5 border-l border-line pl-2.5 text-ink-3 tabular-nums">
          <span>
            <Trans
              t={t}
              i18nKey={($) => $.panel.owned}
              values={{ owned: totals.owned, total: totals.total }}
              components={[<b key="n" className="text-ink" />]}
            />
          </span>
          {totals.toMax !== null && (
            <span title={t(($) => $.panel.toMaxTitle)}>
              <Trans
                t={t}
                i18nKey={($) => $.panel.toMax}
                count={totals.toMax}
                values={{
                  approx: status.progress.some((row) => row.progress_estimated && row.level < 3)
                    ? '~'
                    : '',
                }}
                components={[<b key="n" className="text-ink" />]}
              />
            </span>
          )}
        </span>
      )}
      <SessionSummary status={status} />
    </div>
  );
}

/** Range input that saves once it stops changing; the saved value is fixed at that moment. */
function RangeSetting({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  // A draft belongs to the native value it started from; once native moves on (this save
  // landed, or another window saved), the draft is dropped and native is shown again.
  const [draft, setDraft] = useState<{ base: number; value: number } | null>(null);
  const pending =
    draft !== null && draft.base === value && draft.value !== value ? draft.value : null;
  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => onCommit(pending), 350);
    return () => clearTimeout(timer);
  }, [pending, onCommit]);
  const shown = pending ?? value;
  return (
    <label className={cn('flex flex-col gap-1 text-xs text-ink-2', disabled && 'opacity-60')}>
      <span className="flex items-baseline justify-between gap-2 font-semibold">
        {label} <b className="font-semibold text-ink tabular-nums">{format(shown)}</b>
      </span>
      <input
        type="range"
        data-ui="range"
        className="h-6 w-full cursor-pointer accent-accent disabled:cursor-default"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        onChange={(event) => setDraft({ base: value, value: Number(event.target.value) })}
      />
    </label>
  );
}

function radarText(radar: PetsPanelProps['radar'], t: Translate<'pets'>) {
  if (!radar.known) return '';
  if (!radar.status.requested) return t(($) => $.panel.radarText.hidden);
  return radar.status.visible
    ? t(($) => $.panel.radarText.showing)
    : t(($) => $.panel.radarText.requested);
}

/** The in-game radar's settings, folded under the header: lock, range, look and filter. */
function RadarSettings({
  radar,
  config,
  disabled,
  native,
  configure,
}: {
  radar: PetsPanelProps['radar'];
  config: PetsConfig | null;
  disabled: boolean;
  native: boolean;
  configure: PetsPanelProps['pets']['configure'];
}) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  const commit = useMemo(
    () => ({
      radius: (value: number) => void configure((c) => ({ ...c, nearby_radius: value })),
      opacity: (value: number) => void configure((c) => ({ ...c, opacity: value })),
      scale: (value: number) => void configure((c) => ({ ...c, scale: value })),
    }),
    [configure],
  );
  return (
    <Panel variant="flat" padding="none" className="flex flex-col gap-3 p-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="m-0 min-w-0 flex-1 basis-72 text-xs leading-snug text-ink-3">
          <b className="font-semibold text-ink-2">
            {!radar.status.requested
              ? t(($) => $.panel.inGame.hidden)
              : radar.status.visible
                ? t(($) => $.panel.inGame.showing)
                : t(($) => $.panel.inGame.waiting)}
          </b>{' '}
          · {t(($) => $.panel.inGame.body)}
        </p>
        <Button
          size="xs"
          aria-pressed={!radar.status.locked}
          disabled={!native || !radar.known || radar.busy}
          icon={<Icon name={radar.status.locked ? 'unlock' : 'lock'} size={12} />}
          onClick={() => void radar.lock(!radar.status.locked)}
        >
          {radar.status.locked ? t(($) => $.panel.inGame.unlock) : t(($) => $.panel.inGame.lock)}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] items-start gap-x-5 gap-y-3 border-t border-line-soft pt-3">
        <RangeSetting
          label={t(($) => $.panel.settings.radius)}
          value={config?.nearby_radius ?? 250}
          min={PETS_LIMITS.nearby_radius[0]}
          max={1000}
          step={10}
          format={(v) => metres(v, fmt)}
          disabled={disabled}
          onCommit={commit.radius}
        />
        <RangeSetting
          label={t(($) => $.panel.settings.background)}
          value={config?.opacity ?? 0.8}
          min={PETS_LIMITS.opacity[0]}
          max={PETS_LIMITS.opacity[1]}
          step={0.05}
          format={(v) => fmt.pct(v, 0)}
          disabled={disabled}
          onCommit={commit.opacity}
        />
        <RangeSetting
          label={t(($) => $.panel.settings.size)}
          value={config?.scale ?? 1}
          min={PETS_LIMITS.scale[0]}
          max={1.6}
          step={0.05}
          format={(v) => fmt.pct(v, 0)}
          disabled={disabled}
          onCommit={commit.scale}
        />
        <Switch
          label={t(($) => $.panel.settings.maxed)}
          hint={t(($) => $.panel.settings.maxedHint)}
          checked={config?.show_maxed ?? false}
          disabled={disabled}
          onCheckedChange={(checked) => void configure((c) => ({ ...c, show_maxed: checked }))}
        />
      </div>
    </Panel>
  );
}

export interface PetsPanelProps {
  native: boolean;
  index: PetIndex | null;
  catalogueError: string;
  /** Saved profile shown; null follows the character playing now. */
  profileId: string | null;
  onProfile: (id: string | null) => void;
  pets: {
    status: PetsStatus | null;
    error: string;
    /** Applies a preference delta to the newest native config. */
    configure: (change: (config: PetsConfig) => PetsConfig) => Promise<boolean>;
    setPinned: (pet: number, pinned: boolean) => Promise<boolean>;
  };
  radar: {
    status: PetWindowStatus;
    known: boolean;
    busy: boolean;
    error: string;
    toggle: () => Promise<boolean>;
    show: () => Promise<boolean>;
    lock: (locked: boolean) => Promise<boolean>;
  };
  farming: {
    phase: FarmActions['phase'];
    busy: boolean;
    notice: string;
    start: (goal: PetFarmingGoal) => Promise<boolean>;
    stop: () => Promise<boolean>;
  };
  /**
   * False while the tab has been off screen for a while: map art is released, and every
   * choice made here (view, selection, map, zoom, filters) stays.
   */
  drawArt?: boolean;
}

/**
 * Workspace Pets tab: Level 3 by type over the whole collection, then two places. Map is the
 * farming atlas (ranked picker, original map, the selected pet's farming detail); Collection
 * is the portrait gallery, whose pets open on the map.
 */
export function PetsPanel({
  native,
  index,
  catalogueError,
  profileId,
  onProfile,
  pets,
  radar,
  farming,
  drawArt = true,
}: PetsPanelProps) {
  const { t } = useTranslation('pets');
  const { status, configure, setPinned } = pets;

  const [view, setView] = useState<View>('map');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);
  // One type filter, chosen in the overview, for the map and the collection alike.
  const [family, setFamily] = useState<PetFamily | 'all'>('all');
  // Map tab.
  const [mode, setMode] = useState<PickMode | null>(null);
  const [hereOnly, setHereOnly] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);
  const [layers, setLayers] = useState<MapLayers>({ spawns: true, live: true });
  // Collection tab.
  const [filter, setFilter] = useState<PetFilter>('all');
  const [search, setSearch] = useState('');
  // Relative times follow native time, refreshed by each status poll.
  const [opened] = useState(() => Date.now());
  const now = status?.now_ms ?? opened;

  const states = useMemo(
    () => (index ? collectionStates(index.catalogue, status) : new Map<number, PetState>()),
    [index, status],
  );
  const config = status?.config ?? null;
  const pinnedIds = useMemo(() => config?.pinned_ids ?? [], [config]);
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const synced = !!status?.profile_id && status.collection_synced;
  const live = liveState(status, native);
  const sync = collectionSync(status, native, profileId);
  const rows = useMemo(
    () => (index ? nearbyRows(index, states, status, native) : []),
    [index, states, status, native],
  );
  const goal =
    index && config && goalValid(index, config.farming_goal) ? config.farming_goal : null;
  const goalId = goal?.pet_id ?? null;

  // Where the character is, and which farming map the Map tab shows: only the three farming
  // maps are ever shown, whatever map the character, the goal or old choices are on.
  const hereMap = useMemo(
    () => (index && live.kind === 'live' && status ? positionMap(index, status.position) : null),
    [index, live.kind, status],
  );
  const hereId = hereMap && isFarmMap(hereMap.id) ? hereMap.id : null;
  const busiest = useMemo(() => {
    let best: string | null = null;
    let most = 0;
    for (const { map } of index?.farmMaps ?? []) {
      const points = index?.spawns.get(map.id)?.length ?? 0;
      if (points > most) {
        best = map.id;
        most = points;
      }
    }
    return best ?? index?.farmMaps[0]?.map.id ?? null;
  }, [index]);
  const lastMap =
    isFarmMap(config?.last_map_id) && index?.maps.has(config.last_map_id)
      ? config.last_map_id
      : null;
  const goalMap = isFarmMap(goal?.map_id) ? goal.map_id : null;
  const shownMapId = mapId ?? hereId ?? lastMap ?? goalMap ?? busiest;
  const shownMap = shownMapId && index ? (index.maps.get(shownMapId) ?? null) : null;

  const pickMode: PickMode = mode ?? (synced ? 'farm' : 'all');
  const effectiveMode = pickMode === 'farm' && !synced ? 'all' : pickMode;
  const picks = useMemo(
    () =>
      index
        ? pickPets(index, states, {
            mode: effectiveMode,
            hereOnly: hereOnly && !!shownMapId,
            mapId: shownMapId,
            family,
            search: pickSearch,
            pinned: pinnedIds,
            goal: goalId,
          })
        : [],
    [index, states, effectiveMode, hereOnly, shownMapId, family, pickSearch, pinnedIds, goalId],
  );
  const mapMatches = useMemo(
    () => (index ? searchMaps(index, pickSearch) : []),
    [index, pickSearch],
  );
  // The spawn layer draws the listed pets; the selection and the goal always show.
  const drawn = useMemo(() => {
    const ids = new Set(layers.spawns ? picks.map((p) => p.pet.id) : []);
    if (selected !== null) ids.add(selected);
    if (goalId !== null) ids.add(goalId);
    return ids;
  }, [layers.spawns, picks, selected, goalId]);

  const listed = useMemo(
    () =>
      index
        ? filterPets(index, states, {
            family,
            filter,
            search,
            pinned: pinnedIds,
          })
        : [],
    [index, states, family, filter, search, pinnedIds],
  );
  // The whole collection, whatever the search, list or map shows.
  const summaries = useMemo(
    () => (index ? familySummaries(index.catalogue, states) : []),
    [index, states],
  );

  const position = status && live.kind === 'live' && positionFresh(status) ? status.position : null;
  const onShown = !!(shownMap && position && onMap(position, shownMap));
  const sightingsOnMap = onShown
    ? rows.filter((r) => r.sighting.x !== null && r.sighting.y !== null)
    : [];

  // The pet in focus: the selection, else the farming goal.
  const focusId = selected ?? goalId;
  const focusPet = focusId === null ? null : (index?.pets.get(focusId) ?? null);

  const setPin = (id: number, pin: boolean) => void setPinned(id, pin);
  const pinDisabled = !native || !status;
  const chooseMap = (id: string) => {
    setMapId(id);
    setFitTick((n) => n + 1);
    if (native && status && config?.last_map_id !== id)
      void configure((c) => ({ ...c, last_map_id: id }));
  };
  /** Selects a pet and shows it: on the shown map when it spawns there, else its best map. */
  const selectPet = (id: number, switchView = false) => {
    setSelected(id);
    setDetailOpen(true);
    setFitTick((n) => n + 1);
    if (switchView) setView('map');
    const pet = index?.pets.get(id);
    if (!index || !pet || pet.spawns.some((s) => s.map_id === shownMapId)) return;
    const best = bestFarmMap(farmPlan(index, pet, hereId), shownMapId);
    if (best) setMapId(best.id);
  };
  /**
   * Lets the selection go: the detail and the map's focus return to the farming goal, or to
   * nothing. The selection is never saved, so the goal, pins and map stay as they are.
   */
  const clearSelection = () => setSelected(null);
  /** The picker's rows and the map's marks are toggles: the selected pet chosen again lets go. */
  const toggleSelection = (id: number) => (id === selected ? clearSelection() : selectPet(id));
  const focusMap = (id: string) => {
    chooseMap(id);
    setView('map');
  };
  const farm: FarmActions = {
    enabled: native && !!status,
    busy: farming.busy,
    phase: farming.phase,
    notice: farming.notice,
    onStart: (next) => {
      setSelected(next.pet_id);
      setMapId(next.map_id);
      setFitTick((n) => n + 1);
      void farming.start(next);
    },
    onStop: () => void farming.stop(),
  };

  const all = summaries[0];
  const totalToMax = index
    ? index.catalogue.pets.reduce<number | null>((sum, pet) => {
        const left = stateOf(states, pet.id).toMax;
        return sum === null || left === null ? null : sum + left;
      }, 0)
    : null;
  const syncNotice = collectionNotice(
    sync,
    now,
    t,
    status?.profile_id ? status.progress.length : 0,
  );
  const error = catalogueError || pets.error || status?.error || '';
  const goalPet = goal && index ? (index.pets.get(goal.pet_id) ?? null) : null;

  const filters: { value: PetFilter; label: string; title: string }[] = [
    {
      value: 'all',
      label: t(($) => $.family.all),
      title: t(($) => $.picker.modes.all.title),
    },
    {
      value: 'unowned',
      label: t(($) => $.stage.unowned),
      title: index
        ? obtainHint(index.catalogue.thresholds, t)
        : t(($) => $.stage.level, { level: 0 }),
    },
    {
      value: 'incomplete',
      label: t(($) => $.panel.filters.incomplete),
      title: t(($) => $.panel.filters.incompleteTitle),
    },
    {
      value: 'maxed',
      label: t(($) => $.stage.maxed),
      title: t(($) => $.stage.level, { level: 3 }),
    },
    {
      value: 'pinned',
      label: t(($) => $.picker.modes.pinned.label),
      title: t(($) => $.picker.modes.pinned.title),
    },
  ];
  const views = [
    { id: 'map' as const, label: t(($) => $.panel.views.map) },
    { id: 'collection' as const, label: t(($) => $.panel.views.collection) },
  ];

  return (
    <section aria-labelledby="pets-heading" className="flex flex-col gap-3 pb-12">
      <Collapsible
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        className="flex flex-col gap-3"
      >
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-96 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 id="pets-heading" className="m-0 text-xl">
              {t(($) => $.panel.heading)}
            </h2>
            <StatusLine
              status={status}
              sync={sync}
              now={now}
              totals={
                synced && all ? { owned: all.owned, total: all.total, toMax: totalToMax } : null
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t(($) => $.panel.character)}
              wrapperClassName="w-60 max-w-full"
              value={profileId ?? ''}
              disabled={!native}
              onChange={(event) => onProfile(event.target.value || null)}
            >
              <option value="">{t(($) => $.panel.playingNow)}</option>
              {status?.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === status.active_profile_id
                    ? t(($) => $.panel.playing, { name: profileName(p, t) })
                    : profileName(p, t)}
                </option>
              ))}
            </Select>
            <WindowSwitch
              on={radar.known && radar.status.requested}
              icon="paw"
              label={t(($) => $.radar.label)}
              state={windowState({
                known: radar.known,
                requested: radar.status.requested,
                held: !radar.status.visible,
              })}
              busy={radar.busy}
              disabled={!native || !radar.known}
              title={t(($) => $.panel.radarSwitchTitle)}
              onClick={() => void radar.toggle()}
            />
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={t(($) => $.panel.radarSettings)}
                  title={t(($) => $.panel.radarSettingsTitle)}
                  icon={<Icon name="sliders" size={14} />}
                />
              }
            />
          </div>
        </header>
        <CollapsiblePanel>
          <RadarSettings
            radar={radar}
            config={config}
            disabled={pinDisabled}
            native={native}
            configure={configure}
          />
        </CollapsiblePanel>
      </Collapsible>
      {(!native || error || radar.error || syncNotice) && (
        <div className="flex flex-col gap-2 [&>[data-ui=notice]]:my-0">
          {!native && <Notice tone="info">{t(($) => $.panel.needsNative)}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {radar.error && <Notice tone="error">{radar.error}</Notice>}
          {syncNotice && <Notice tone={syncNotice.tone}>{syncNotice.text}</Notice>}
        </div>
      )}
      {!index ? (
        native &&
        !catalogueError && (
          <EmptyState live icon={<Icon name="paw" size={18} />} title={t(($) => $.radar.loading)} />
        )
      ) : (
        <>
          <TypeOverview
            summaries={summaries}
            sync={sync}
            now={now}
            family={family}
            onFamily={setFamily}
          />
          <Tabs value={view} onValueChange={setView} className="block">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
              <TabList
                label={t(($) => $.panel.viewsLabel)}
                variant="sub"
                className="border-b-0"
                items={views}
              />
              {goalPet && goal && (
                <section
                  aria-label={t(($) => $.nearby.goal)}
                  className="mb-1 flex max-w-full min-w-0 items-center gap-2 rounded-xl border border-accent-line bg-accent-soft py-1 pr-1 pl-1 text-xs max-[760px]:w-full"
                >
                  <span className="relative shrink-0">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 animate-ripple rounded-full border border-accent-line"
                    />
                    <PetPortrait id={goalPet.id} className="relative w-8 rounded-full" />
                  </span>
                  {/* The goal on one line; its souls and the radar's state, in words, below. */}
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="min-w-0 truncate text-ink-2">
                      <Trans
                        t={t}
                        i18nKey={($) => $.panel.farmingGoal}
                        values={{ name: goalPet.name, map: mapName(index, goal.map_id) }}
                        components={[<b key="pet" className="text-ink" />]}
                      />
                    </span>
                    <span
                      className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-3"
                      title={radarText(radar, t)}
                    >
                      <LevelPips state={stateOf(states, goalPet.id)} size="sm" />
                      <span className="min-w-0 truncate">
                        {soulsLeftLabel(stateOf(states, goalPet.id), t)} · {radarText(radar, t)}
                      </span>
                    </span>
                  </span>
                  {goalMap &&
                    (view !== 'map' || shownMapId !== goalMap || focusId !== goal.pet_id) && (
                      <Button
                        variant="link"
                        className="shrink-0 text-xs"
                        icon={<Icon name="map" size={12} />}
                        onClick={() => {
                          selectPet(goal.pet_id);
                          focusMap(goalMap);
                        }}
                      >
                        {t(($) => $.panel.showMap)}
                      </Button>
                    )}
                  {radar.known && !radar.status.requested && (
                    <Button
                      variant="link"
                      className="shrink-0 text-xs"
                      disabled={!native || radar.busy}
                      icon={<Icon name="paw" size={12} />}
                      onClick={() => void radar.show()}
                    >
                      {t(($) => $.panel.showRadar)}
                    </Button>
                  )}
                  <Button
                    size="xs"
                    className="shrink-0"
                    disabled={!native || farming.busy}
                    icon={<Icon name="stop" size={12} />}
                    onClick={() => void farming.stop()}
                  >
                    {t(($) => $.farm.stop)}
                  </Button>
                </section>
              )}
            </div>
            {/* The map stays mounted, so its zoom, pan and fit survive a visit to Collection. */}
            <TabPanel value="map" keepMounted className="pt-3">
              <FarmView
                key={status?.profile_id ?? ''}
                index={index}
                shownMap={shownMap}
                hereId={hereId}
                drawn={drawn}
                selected={selected}
                goal={goalId}
                pinned={pinned}
                position={onShown ? position : null}
                sightings={layers.live ? sightingsOnMap : []}
                liveCount={live.kind === 'live' ? sightingsOnMap.length : null}
                liveNote={liveHint(live, t)}
                layers={layers}
                onLayers={setLayers}
                pickerOpen={pickerOpen}
                detailOpen={detailOpen}
                onPickerOpen={setPickerOpen}
                onDetailOpen={setDetailOpen}
                states={states}
                now={now}
                activeId={status?.active_pet_id ?? null}
                fitKey={String(fitTick)}
                listed={picks.length}
                drawArt={drawArt}
                onChooseMap={chooseMap}
                onSelect={(id) => selectPet(id)}
                onClear={clearSelection}
                picker={
                  <FarmPicker
                    rows={picks}
                    total={index.catalogue.pets.length}
                    mode={effectiveMode}
                    hereOnly={hereOnly && !!shownMap}
                    family={family}
                    search={pickSearch}
                    synced={synced}
                    shownMap={shownMap}
                    mapMatches={mapMatches}
                    selected={selected}
                    goal={goalId}
                    pinned={pinned}
                    pinDisabled={pinDisabled}
                    onMode={setMode}
                    onHereOnly={setHereOnly}
                    onFamily={setFamily}
                    onSearch={setPickSearch}
                    onPickMap={chooseMap}
                    onSelect={toggleSelection}
                    onPin={setPin}
                  />
                }
                detail={
                  focusPet ? (
                    <FarmDetail
                      index={index}
                      pet={focusPet}
                      state={stateOf(states, focusPet.id)}
                      status={status}
                      pinned={pinned.has(focusPet.id)}
                      pinDisabled={pinDisabled}
                      now={now}
                      hereMapId={hereId}
                      shownMapId={shownMapId}
                      goal={goal}
                      farm={farm}
                      onPin={(pin) => setPin(focusPet.id, pin)}
                      onFocusMap={focusMap}
                      // Letting the goal go would show the goal again: nothing to clear there.
                      clearable={selected !== null && selected !== goalId}
                      onClear={clearSelection}
                    />
                  ) : (
                    <Panel padding="sm" className="min-h-full">
                      <EmptyState
                        icon={<Icon name="paw" size={18} />}
                        title={t(($) => $.panel.selectPet)}
                      >
                        {t(($) => $.panel.selectFarm)}
                      </EmptyState>
                    </Panel>
                  )
                }
              />
            </TabPanel>
            <TabPanel value="collection" className="pt-3">
              <Panel padding="none" className="flex min-w-0 flex-col gap-3 p-4 max-[760px]:p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <SearchInput
                    wrapperClassName="min-w-40 flex-1 basis-52"
                    aria-label={t(($) => $.panel.search)}
                    placeholder={t(($) => $.picker.searchPlaceholder)}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <SegmentedControl
                    size="sm"
                    label={t(($) => $.panel.filterLabel)}
                    value={filter}
                    onChange={setFilter}
                    options={filters.map((f) => ({
                      ...f,
                      disabled: f.value !== 'all' && f.value !== 'pinned' && !synced,
                      title:
                        f.value !== 'all' && f.value !== 'pinned' && !synced
                          ? t(($) => $.picker.needsSync)
                          : f.title,
                    }))}
                  />
                </div>
                {family !== 'all' && (
                  <FamilyOnly family={family} onClear={() => setFamily('all')} />
                )}
                {listed.length ? (
                  <PetCardGrid
                    pets={listed}
                    states={states}
                    pinned={pinned}
                    selected={selected}
                    activeId={status?.active_pet_id ?? null}
                    pinDisabled={pinDisabled}
                    onSelect={(id) => selectPet(id, true)}
                    onPin={setPin}
                  />
                ) : (
                  <EmptyState
                    compact
                    icon={<Icon name="paw" size={18} />}
                    title={t(($) => $.panel.noMatch.title)}
                  >
                    {t(($) => $.panel.noMatch.body)}
                  </EmptyState>
                )}
                <p className="m-0 flex flex-wrap justify-between gap-x-3 gap-y-1 text-2xs text-ink-3 tabular-nums">
                  <span>
                    {t(($) => $.picker.count.all, {
                      shown: listed.length,
                      count: index.catalogue.pets.length,
                    })}
                  </span>
                  <span>{t(($) => $.panel.openOnMap)}</span>
                </p>
              </Panel>
            </TabPanel>
          </Tabs>
        </>
      )}
    </section>
  );
}
