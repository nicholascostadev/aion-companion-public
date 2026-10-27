import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { PetPortrait } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetsStatus, PetWindowStatus } from '../../types/pets';
import {
  ago,
  collectionStates,
  duration,
  recentGains,
  mapName,
  sessionOf,
  stageLabel,
  stateOf,
  type PetIndex,
} from '../pets/model';
import { FamilyLabel, LevelPips, SoulProgress } from '../pets/parts';

/** What Home needs from the pets status poll. */
export interface HomePets {
  status: PetsStatus | null;
}

/** The in-game pet radar window, as its controls report it. */
export interface HomeRadar {
  status: PetWindowStatus;
  /** False until the first native answer. */
  known: boolean;
  busy: boolean;
  show: () => Promise<boolean>;
  toggle: () => Promise<boolean>;
}

const PINS_SHOWN = 3;
const GAINS_SHOWN = 3;

/** The latest souls picked up on this connection, newest first, each with its pet. */
function Pickups({ pets, index }: { pets: HomePets; index: PetIndex }) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  const status = pets.status;
  if (!status?.gains.length) return null;
  return (
    <div className="mt-4 border-t border-line-soft pt-3">
      <h3 className="m-0 mb-1.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
        {t(($) => $.home.latest)}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {recentGains(status.gains, GAINS_SHOWN).map((g) => {
          const pet = index.pets.get(g.pet_id);
          return (
            <li key={g.id} className="flex min-w-0 items-center gap-2.5 text-sm">
              <PetPortrait id={g.pet_id} lazy className="w-7 rounded-full" />
              <b className="w-8 flex-none font-semibold text-accent tabular-nums">+{g.gained}</b>
              <span className="min-w-0 flex-1 truncate text-ink" title={pet?.name}>
                {pet?.name ?? t(($) => $.petFallback, { id: g.pet_id })}
              </span>
              <time
                className="flex-none text-xs text-ink-3 tabular-nums"
                dateTime={new Date(g.at_ms).toISOString()}
                title={fmt.dateTime(g.at_ms)}
              >
                {ago(status.now_ms - g.at_ms, t)}
              </time>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** This capture session's pickups, as observed; nothing before a session belongs to the profile. */
function Session({ pets }: { pets: HomePets }) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  const status = pets.status;
  const session = sessionOf(status);
  if (!status || !session || session.started_ms === null) return null;
  const figure = (value: number, label: string) => (
    <span className="flex flex-col">
      <b className="text-lg leading-tight font-semibold text-ink tabular-nums">
        {fmt.integer.format(value)}
      </b>
      <span className="text-2xs text-ink-3">{label}</span>
    </span>
  );
  return (
    <div
      className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2 border-t border-line-soft pt-3"
      title={t(($) => $.home.sessionTitle)}
    >
      <span className="mr-auto flex flex-col">
        <span className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">
          {t(($) => $.home.session)}
        </span>
        <span className="text-xs text-ink-2 tabular-nums">
          {duration(status.now_ms - session.started_ms)}
        </span>
      </span>
      {figure(
        session.souls_gained,
        t(($) => $.home.souls, { count: session.souls_gained }),
      )}
      {figure(
        session.level_ups,
        t(($) => $.home.levelUps, { count: session.level_ups }),
      )}
      {figure(
        session.obtained,
        t(($) => $.home.obtained, { count: session.obtained }),
      )}
    </div>
  );
}

/**
 * The pet being farmed, with souls to the next level and the radar one click
 * away; then the pinned pets. Before a goal is chosen it points to the farm picker.
 */
export function PetFarmingCard({
  pets,
  radar,
  index,
  onOpenPets,
  className,
}: {
  pets: HomePets;
  radar: HomeRadar;
  index: PetIndex | null;
  onOpenPets: () => void;
  className?: string;
}) {
  const status = pets.status;
  const goal = status?.config.farming_goal ?? null;
  const states = useMemo(
    () => (index ? collectionStates(index.catalogue, status) : null),
    [index, status],
  );
  const pet = goal && index ? (index.pets.get(goal.pet_id) ?? null) : null;
  const pins = index
    ? (status?.config.pinned_ids ?? [])
        .filter((id) => id !== goal?.pet_id)
        .flatMap((id) => index.pets.get(id) ?? [])
    : [];
  const { t } = useTranslation('pets');
  const radarOn = radar.known && radar.status.requested;
  return (
    <Card
      title={t(($) => $.home.title)}
      className={cn('mb-0', className)}
      actions={
        <Button variant="link" size="sm" onClick={onOpenPets}>
          {t(($) => $.home.open)} <Icon name="arrowRight" size={13} />
        </Button>
      }
    >
      {goal && pet && states ? (
        <div data-home="goal">
          <div className="flex items-center gap-4">
            <PetPortrait id={pet.id} className="w-24 flex-none rounded-xl shadow-2" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">
                {t(($) => $.nearby.goal)}
              </span>
              <b className="text-xl leading-tight font-semibold tracking-tight text-balance break-words text-ink">
                {pet.name}
              </b>
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-2">
                <FamilyLabel family={pet.family} />
                <span className="inline-flex items-center gap-1.5">
                  <LevelPips state={stateOf(states, pet.id)} size="sm" />
                  {stageLabel(stateOf(states, pet.id), t)}
                </span>
              </span>
              <SoulProgress state={stateOf(states, pet.id)} />
              <span className="flex min-w-0 items-center gap-1 text-xs text-ink-3">
                <Icon name="map" size={12} />
                <span className="truncate" title={mapName(index!, goal.map_id)}>
                  {mapName(index!, goal.map_id)}
                </span>
              </span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {radarOn ? (
              <Button size="sm" icon={<Icon name="radar" size={14} />} onClick={onOpenPets}>
                {t(($) => $.home.farmView)}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<Icon name="radar" size={14} />}
                loading={radar.busy}
                disabled={!radar.known}
                onClick={() => void radar.show()}
              >
                {t(($) => $.panel.showRadar)}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onOpenPets}>
              {t(($) => $.home.changeGoal)}
            </Button>
          </div>
        </div>
      ) : goal && !index ? (
        <p className="m-0 py-6 text-center text-sm text-ink-3">{t(($) => $.home.reading)}</p>
      ) : (
        <EmptyState compact icon={<Icon name="paw" size={18} />} title={t(($) => $.home.noGoal)}>
          {t(($) => $.home.noGoalBody)}
          <span className="mt-3 flex justify-center">
            <Button size="sm" variant="primary" onClick={onOpenPets}>
              {t(($) => $.home.choose)}
            </Button>
          </span>
        </EmptyState>
      )}
      <Session pets={pets} />
      {index && <Pickups pets={pets} index={index} />}
      {pins.length > 0 && states && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <h3 className="m-0 mb-1.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
            {t(($) => $.mapKey.pinned)}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {pins.slice(0, PINS_SHOWN).map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-2.5">
                <PetPortrait id={p.id} lazy className="w-8 rounded-full" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-sm font-semibold text-ink" title={p.name}>
                    {p.name}
                  </b>
                  <SoulProgress state={stateOf(states, p.id)} compact />
                </span>
                <LevelPips state={stateOf(states, p.id)} size="sm" />
              </li>
            ))}
          </ul>
          {pins.length > PINS_SHOWN && (
            <p className="mt-1.5 mb-0 text-xs text-ink-3">
              {t(($) => $.home.morePins, { count: pins.length - PINS_SHOWN })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
