import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { PetPortrait } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Trans, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetEntry, PetPosition } from '../../types/pets';
import { ago, stageLabel, type NearbyRow, type PetState } from './model';
import { Bearing, FamilyLabel, LevelPips, SoulProgress } from './parts';

/*
 * The contents of the hover cards on the farming map: what a mark is, at a glance. They
 * reuse the pet parts of the cards and the detail, so a pet reads the same everywhere.
 */

/** Pets of a live sighting listed before `+N more`. */
const VISIBLE_PETS = 3;

const caps = 'text-2xs font-semibold tracking-caps text-ink-3 uppercase';

/** A pet's portrait, grey while unowned, with the golden band once complete. */
function Portrait({ id, state, className }: { id: number; state: PetState; className: string }) {
  return (
    <span className="relative block shrink-0">
      <PetPortrait
        id={id}
        className={cn(
          'rounded-lg ring-1 ring-line',
          state.stage === 'unowned' && '[&_img]:opacity-55 [&_img]:brightness-80 [&_img]:grayscale',
          className,
        )}
      />
      {state.stage === 'maxed' && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-pollen shadow-[0_0_8px_var(--color-pollen)]"
        />
      )}
    </span>
  );
}

function Tags({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-1">{children}</span>;
}

function Pinned() {
  const { t } = useTranslation('pets');
  return (
    <Badge
      shape="tag"
      tone="neutral"
      icon={<Icon name="pin" size={10} className="text-marker-pinned" />}
    >
      {t(($) => $.cards.pinned)}
    </Badge>
  );
}
function Goal() {
  const { t } = useTranslation('pets');
  return (
    <Badge shape="tag" tone="accent" icon={<Icon name="target" size={10} />}>
      {t(($) => $.cards.goal)}
    </Badge>
  );
}

/** The pet of a static spawn group: who it is, how far it has grown, and what drops it here. */
export function SpawnCard({
  id,
  pet,
  state,
  monsters,
  points,
  goal,
  pinned,
  selected,
  clearable = false,
  active,
}: {
  id: number;
  pet: PetEntry | undefined;
  state: PetState;
  /** Source monsters of the group. */
  monsters: string[];
  /** Static spawn points in the group. */
  points: number;
  goal: boolean;
  pinned: boolean;
  selected: boolean;
  /** Choosing the selected pet's mark again lets the selection go. */
  clearable?: boolean;
  active: boolean;
}) {
  const { t } = useTranslation('pets');
  const name = pet?.name ?? t(($) => $.petFallback, { id });
  return (
    <div className="flex w-60 flex-col gap-2.5" data-card="spawn">
      <div className="flex items-start gap-3">
        <Portrait id={id} state={state} className="w-14" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-md leading-tight font-semibold text-ink [overflow-wrap:anywhere]">
            {name}
          </span>
          {pet && <FamilyLabel family={pet.family} className="text-2xs text-ink-3" />}
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <LevelPips state={state} size="sm" />
            {stageLabel(state, t)}
          </span>
        </div>
      </div>
      <SoulProgress state={state} />
      <div className="flex flex-col gap-1 border-t border-line-soft pt-2">
        <span className={caps}>{t(($) => $.cards.sourcesHere, { count: monsters.length })}</span>
        <span className="text-xs text-ink-2">{monsters.join(' · ')}</span>
        <span className="text-2xs text-ink-3 tabular-nums">
          <Trans
            t={t}
            i18nKey={($) => $.cards.staticPoints}
            count={points}
            components={[<b key="n" className="font-semibold text-ink" />]}
          />
        </span>
      </div>
      {(goal || pinned || selected || active) && (
        <Tags>
          {goal && <Goal />}
          {pinned && <Pinned />}
          {active && (
            <Badge shape="tag" tone="accent" variant="outline">
              {t(($) => $.cards.activePet)}
            </Badge>
          )}
          {selected && (
            <Badge shape="tag" tone="neutral" icon={<Icon name="check" size={10} />}>
              {t(($) => $.cards.selected)}
            </Badge>
          )}
        </Tags>
      )}
      {(!selected || clearable) && (
        <span className="text-2xs text-ink-3">
          {selected ? t(($) => $.cards.clickToClear) : t(($) => $.cards.clickToSelect)}
        </span>
      )}
    </div>
  );
}

/** A source monster seen right now, and the pets it drops souls of. */
export function SightingCard({ row, now }: { row: NearbyRow; now: number }) {
  const { t } = useTranslation('pets');
  const { sighting } = row;
  const more = row.pets.length - VISIBLE_PETS;
  return (
    <div className="flex w-60 flex-col gap-2.5" data-card="sighting">
      <div className="flex flex-col gap-1">
        <span className={cn(caps, 'flex items-center gap-1.5 text-marker-live')}>
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rotate-45 rounded-none border-[1.5px] border-marker-live bg-marker-live/30"
          />
          {t(($) => $.cards.liveSighting)}
        </span>
        <span className="text-sm leading-tight font-semibold text-ink [overflow-wrap:anywhere]">
          {sighting.name}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-ink-3">
          <span>{t(($) => $.cards.seen, { ago: ago(now - sighting.observed_ms, t) })}</span>
          {row.distance !== null && <Bearing distance={row.distance} bearing={row.bearing} />}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line-soft pt-2">
        <span className={caps}>{t(($) => $.cards.dropsSoulsOf)}</span>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {row.pets.slice(0, VISIBLE_PETS).map(({ pet, state }) => (
            <li key={pet.id} className="flex min-w-0 items-center gap-2">
              <Portrait id={pet.id} state={state} className="w-8 rounded-md" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-xs font-semibold text-ink">{pet.name}</span>
                <span className="flex min-w-0 items-center justify-between gap-1.5">
                  <FamilyLabel family={pet.family} className="text-2xs text-ink-3" />
                  <LevelPips state={state} size="sm" />
                </span>
              </span>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <span className="text-2xs text-ink-3">{t(($) => $.cards.more, { count: more })}</span>
        )}
      </div>
      {(row.goal || row.pinned) && (
        <Tags>
          {row.goal && <Goal />}
          {row.pinned && <Pinned />}
        </Tags>
      )}
      <span className="text-2xs text-ink-3">{t(($) => $.cards.clickToSelectPet)}</span>
    </div>
  );
}

/** Your character's last observed position; native reports no facing direction. */
export function PositionCard({ position, now }: { position: PetPosition; now: number }) {
  const { t } = useTranslation('pets');
  return (
    <div className="flex w-52 flex-col gap-1" data-card="position">
      <span className={cn(caps, 'flex items-center gap-1.5 text-ink-2')}>
        <Icon name="locate" size={11} />
        {t(($) => $.cards.you)}
      </span>
      <span className="text-xs text-ink">{t(($) => $.cards.lastPosition)}</span>
      <span className="text-2xs text-ink-3">
        {t(($) => $.cards.observedNoFacing, { ago: ago(now - position.observed_ms, t) })}
      </span>
    </div>
  );
}
