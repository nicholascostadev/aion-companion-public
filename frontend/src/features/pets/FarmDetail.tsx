import { useMemo, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { PetPortrait } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { Pressable } from '../../components/ui/Pressable';
import { Trans, useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetEntry, PetFarmingGoal, PetsStatus } from '../../types/pets';
import { bestFarmMap, farmPlan, type FarmMapRow } from './farming';
import { mapContext } from './maps';
import {
  ago,
  mapName,
  metres,
  positionFresh,
  SIGHTING_FRESH_MS,
  stageLabel,
  type PetIndex,
  type PetState,
} from './model';
import { FamilyLabel, LevelPips, PinButton, SoulProgress } from './parts';

/** Source names shown per map row before `+N`. */
const VISIBLE_SOURCES = 2;

export interface FarmActions {
  /** Native preferences can be saved now. */
  enabled: boolean;
  busy: boolean;
  phase: 'idle' | 'saving' | 'opening';
  notice: string;
  onStart: (goal: PetFarmingGoal) => void;
  onStop: () => void;
}

function MapRow({
  row,
  shown,
  goal,
  onFocus,
}: {
  row: FarmMapRow;
  shown: boolean;
  goal: boolean;
  onFocus: () => void;
}) {
  const { t } = useTranslation('pets');
  const label = row.label?.label ?? row.map.name;
  const more = row.sources.length - VISIBLE_SOURCES;
  return (
    <li>
      <Pressable
        className={cn(
          'farm-map-row relative flex w-full flex-col items-stretch gap-1 overflow-hidden rounded-lg border border-line-soft bg-surface-2 px-3 py-2',
          'transition-[background-color,border-color] duration-150 ease-grow hover:border-line',
          'aria-pressed:border-accent-line aria-pressed:bg-accent-soft',
          // The goal's map grows a stem on its leading edge.
          goal &&
            'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent',
        )}
        aria-pressed={shown}
        title={t(($) => $.farm.detail.showMap, { map: label })}
        onClick={onFocus}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="farm-map-row-name min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {label}
          </span>
          <span className="shrink-0 text-2xs text-ink-3 tabular-nums">
            <Trans
              t={t}
              i18nKey={($) => $.farm.detail.points}
              count={row.points}
              components={[<b key="n" className="font-semibold text-ink" />]}
            />
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-ink-3">
          {row.here && (
            <Badge shape="tag" tone="neutral" className="farm-tag">
              {t(($) => $.farm.youAreHere)}
            </Badge>
          )}
          {goal && (
            <Badge shape="tag" tone="accent" className="farm-tag">
              {t(($) => $.farm.goal)}
            </Badge>
          )}
          {row.label && <span>{mapContext(row.label, t)}</span>}
          {!row.map.art && <span>{t(($) => $.farm.detail.chart)}</span>}
        </span>
        <span className="flex flex-wrap gap-x-2.5 text-2xs text-ink-2">
          {row.sources.slice(0, VISIBLE_SOURCES).map((s) => (
            <span key={s.name}>
              {s.name}
              {s.npcIds.length > 1 && <span className="text-ink-3"> ×{s.npcIds.length}</span>}
              <span className="text-ink-3"> · {s.points}</span>
            </span>
          ))}
          {more > 0 && (
            <span className="text-ink-3">
              {t(($) => $.farm.detail.moreSources, { count: more })}
            </span>
          )}
        </span>
      </Pressable>
    </li>
  );
}

/**
 * The selected pet: which of the three farming maps to farm it on first (the current map,
 * then most spawn points), one Start farming action, and its collection state. Sources off
 * those maps and long lists fold away.
 */
export function FarmDetail({
  index,
  pet,
  state,
  status,
  pinned,
  pinDisabled,
  now,
  hereMapId,
  shownMapId,
  goal,
  farm,
  onPin,
  onFocusMap,
  clearable = false,
  onClear,
}: {
  index: PetIndex;
  pet: PetEntry;
  state: PetState;
  status: PetsStatus | null;
  pinned: boolean;
  pinDisabled: boolean;
  now: number;
  /** Map the live character stands on. */
  hereMapId: string | null;
  /** Map drawn in the farming view. */
  shownMapId: string | null;
  goal: PetFarmingGoal | null;
  farm: FarmActions;
  onPin: (pinned: boolean) => void;
  onFocusMap: (mapId: string) => void;
  /** The pet shown is the selection, not the goal shown while nothing is selected. */
  clearable?: boolean;
  /** Lets the selection go. */
  onClear?: () => void;
}) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  const plan = useMemo(() => farmPlan(index, pet, hereMapId), [index, pet, hereMapId]);
  const target = bestFarmMap(plan, shownMapId);
  const farming = goal?.pet_id === pet.id;
  const regions = [...new Set(pet.regions.map((r) => r.name))];
  const fresh = !!status && positionFresh(status);
  const seen =
    status && status.profile_id === status.active_profile_id
      ? status.nearby.filter(
          (s) => s.pet_ids.includes(pet.id) && status.now_ms - s.observed_ms <= SIGHTING_FRESH_MS,
        )
      : [];
  const nearest = fresh
    ? seen.reduce<number | null>(
        (min, s) => (s.distance === null ? min : Math.min(min ?? Infinity, s.distance)),
        null,
      )
    : null;
  const unplacedCount = plan.unplaced.reduce((sum, s) => sum + s.npcIds.length, 0);
  const row = (r: FarmMapRow) => (
    <MapRow
      key={r.map.id}
      row={r}
      shown={r.map.id === shownMapId}
      goal={farming && goal?.map_id === r.map.id}
      onFocus={() => onFocusMap(r.map.id)}
    />
  );

  const more = (summary: string, children: ReactNode) => (
    <Disclosure
      variant="plain"
      summary={summary}
      summaryClassName="py-1.5 text-xs"
      bodyClassName="pt-1 pb-2 pl-5.5"
    >
      {children}
    </Disclosure>
  );

  return (
    <Panel as="article" padding="none" className="min-h-full p-4" aria-labelledby="pet-detail-name">
      <header className="mb-4 flex items-start gap-3.5">
        <PetPortrait
          key={pet.id}
          id={pet.id}
          className={cn(
            'w-20 animate-sprout rounded-xl shadow-2 ring-1 ring-line',
            state.stage === 'unowned' &&
              '[&_img]:opacity-55 [&_img]:brightness-80 [&_img]:grayscale',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <h3
            id="pet-detail-name"
            className="m-0 text-xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]"
          >
            {pet.name}
          </h3>
          <span className="text-xs text-ink-3">
            <FamilyLabel family={pet.family} />
            {status?.active_pet_id === pet.id && ` · ${t(($) => $.farm.detail.activePet)}`}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <LevelPips state={state} /> {stageLabel(state, t)}
          </span>
          <SoulProgress state={state} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <PinButton pinned={pinned} name={pet.name} disabled={pinDisabled} onChange={onPin} />
          {clearable && onClear && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="text-ink-3"
              aria-label={t(($) => $.farm.detail.clear)}
              title={t(($) => $.farm.detail.clearTitle)}
              icon={<Icon name="close" size={14} />}
              onClick={onClear}
            />
          )}
        </div>
      </header>

      <div className="mb-1">
        {farming && goal ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2">
            <p className="m-0 flex items-center gap-2 text-sm text-accent">
              <span className="relative grid size-4 place-items-center">
                <span className="absolute inset-0 animate-ripple rounded-full border border-accent" />
                <Icon name="target" size={14} />
              </span>
              <span>
                <Trans
                  t={t}
                  i18nKey={($) => $.farm.detail.farmingOn}
                  values={{ map: mapName(index, goal.map_id) }}
                  components={[<b key="map" className="text-ink" />]}
                />
              </span>
            </p>
            <Button
              size="sm"
              disabled={!farm.enabled || farm.busy}
              icon={<Icon name="stop" size={14} />}
              onClick={farm.onStop}
            >
              {t(($) => $.farm.stop)}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            className="h-auto w-full justify-start gap-3 rounded-lg px-3.5 py-2.5 text-left whitespace-normal"
            disabled={!farm.enabled || farm.busy || !target}
            aria-busy={farm.phase !== 'idle' || undefined}
            title={!target ? t(($) => $.farm.detail.noTarget) : t(($) => $.farm.detail.startTitle)}
            icon={
              <Icon
                name={farm.phase === 'idle' ? 'target' : 'loader'}
                size={16}
                className={farm.phase === 'idle' ? undefined : 'animate-spin'}
              />
            }
            onClick={() => target && farm.onStart({ pet_id: pet.id, map_id: target.id })}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="text-md font-semibold">
                {farm.phase === 'saving'
                  ? t(($) => $.farm.detail.savingGoal)
                  : farm.phase === 'opening'
                    ? t(($) => $.farm.detail.openingRadar)
                    : t(($) => $.farm.start)}
              </b>
              <small className="truncate text-xs font-medium opacity-80">
                {target
                  ? t(($) => $.farm.detail.onMap, { map: mapName(index, target.id) })
                  : t(($) => $.farm.detail.notOnFarmMap)}
              </small>
            </span>
          </Button>
        )}
        {farm.notice && (
          <output className="mt-2 block text-left text-xs text-warn">{farm.notice}</output>
        )}
      </div>

      {seen.length > 0 && (
        <p className="mt-2.5 mb-0 flex items-center gap-2 text-sm text-marker-live">
          <span className="relative grid size-3.5 place-items-center">
            <span className="absolute inset-0 animate-ripple rounded-full border border-marker-live" />
            <Icon name="radar" size={13} />
          </span>
          <span>
            {nearest !== null
              ? t(($) => $.farm.detail.nearYouNearest, {
                  count: seen.length,
                  distance: metres(nearest, fmt),
                })
              : t(($) => $.farm.detail.nearYou, { count: seen.length })}
          </span>
        </p>
      )}

      <section className="mt-4 border-t border-line-soft pt-4" aria-labelledby="farm-where">
        <h4
          id="farm-where"
          className="m-0 mb-2.5 text-2xs font-semibold tracking-caps text-ink-2 uppercase"
        >
          {t(($) => $.farm.detail.where)}
          {plan.rows.length > 0 && (
            <span className="font-normal tracking-normal text-ink-3 normal-case">
              {' '}
              ·{' '}
              {t(($) => $.farm.detail.whereSummary, {
                maps: t(($) => $.farm.detail.maps, { count: plan.rows.length }),
                points: t(($) => $.farm.points, { count: plan.points }),
              })}
            </span>
          )}
        </h4>
        {plan.rows.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{plan.rows.map(row)}</ul>
        ) : (
          <p className="m-0 text-xs text-ink-3">{t(($) => $.farm.detail.noPoints)}</p>
        )}
        <div className="mt-2 flex flex-col">
          {unplacedCount > 0 &&
            more(
              plan.rows.length
                ? t(($) => $.farm.detail.unplacedMore, { count: unplacedCount })
                : t(($) => $.farm.detail.unplaced, { count: unplacedCount }),
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-ink-2">
                {plan.unplaced.map((s) => (
                  <li key={s.name} title={s.npcIds.map((id) => `#${id}`).join(', ')}>
                    {s.name}
                    {s.npcIds.length > 1 && <span className="text-ink-3"> ×{s.npcIds.length}</span>}
                  </li>
                ))}
              </ul>,
            )}
          {!pet.npc_ids.length && (
            <p className="m-0 text-xs text-ink-3">{t(($) => $.farm.detail.noSources)}</p>
          )}
          {regions.length > 0 &&
            more(
              t(($) => $.farm.detail.regions, { count: regions.length }),
              <p className="m-0 text-xs text-ink-2">{regions.join(' · ')}</p>,
            )}
        </div>
      </section>
      {state.observedMs !== null && (
        <p className="mt-3 mb-0 text-2xs text-ink-3" title={fmt.dateTime(state.observedMs)}>
          {t(($) => $.farm.detail.levelObserved, { ago: ago(now - state.observedMs, t) })}
        </p>
      )}
    </Panel>
  );
}
