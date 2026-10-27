import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { PetPortrait } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import {
  age,
  metres,
  radarPoint,
  shortSoulsLabel,
  soulsLeftLabel,
  type LiveState,
  type NearbyGroup,
  type NearbyPet,
  type NearbyRow,
} from './model';
import { Bearing, FamilyLabel, LevelPips, PinButton } from './parts';

const MINUS = '−';
/** A group older than this shows how old its newest sighting is. */
const STALE_CHIP_MS = 10_000;

/** Why there is nothing live to show, in plain words. */
export function liveHint(live: LiveState, t: Translate<'pets'>): string | null {
  switch (live.kind) {
    case 'preview':
      return t(($) => $.live.preview);
    case 'connecting':
      return live.error
        ? t(($) => $.live.error, { error: live.error })
        : t(($) => $.live.connecting);
    case 'identifying':
      return t(($) => $.live.identifying);
    case 'saved':
      return t(($) => $.live.saved);
    case 'live':
      return live.positionFresh ? null : t(($) => $.live.stalePosition);
  }
}

/**
 * Coordinate radar: you at the centre, live source monsters by distance and coordinate
 * direction (−Y up, +X right). It is not rotated with the camera or the character. A slow
 * ripple spreads from you while it listens.
 */
export function RadarScope({
  rows,
  radius,
  selected,
  size = 132,
}: {
  rows: readonly NearbyRow[];
  radius: number;
  selected?: number | null;
  size?: number;
}) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  const plotted = rows.filter((r) => r.distance !== null && r.bearing !== null);
  return (
    <svg
      className="pet-scope block shrink-0 overflow-visible"
      viewBox="-1.18 -1.18 2.36 2.36"
      width={size}
      height={size}
    >
      <title>
        {t(($) => $.scope.title, {
          count: plotted.length,
          radius: metres(radius, fmt),
          hint: t(($) => $.bearing.compassHint),
        })}
      </title>
      <circle className="fill-accent/5 stroke-accent/35" r={1} strokeWidth={0.012} />
      <circle
        className="fill-none stroke-accent/20"
        r={0.5}
        strokeWidth={0.012}
        strokeDasharray="0.04 0.04"
      />
      <line className="stroke-line" x1={0} y1={-1} x2={0} y2={1} strokeWidth={0.008} />
      <line className="stroke-line" x1={-1} y1={0} x2={1} y2={0} strokeWidth={0.008} />
      <g className="fill-ink-3" fontSize={0.11} fontWeight={600} textAnchor="middle">
        <text x={0} y={-1.06}>
          {MINUS}Y
        </text>
        <text x={1.1} y={0.04}>
          +X
        </text>
        <text x={0} y={1.15}>
          +Y
        </text>
        <text x={-1.1} y={0.04}>
          {MINUS}X
        </text>
      </g>
      <circle
        className="origin-center animate-ripple fill-none stroke-accent/60 [transform-box:fill-box]"
        r={0.12}
        strokeWidth={0.012}
      />
      {plotted.map((row) => {
        const p = radarPoint(row.bearing ?? 0, row.distance ?? 0, radius);
        const on = row.sighting.pet_ids.includes(selected ?? -1);
        const big = row.goal || row.pinned || on;
        return (
          <circle
            key={row.sighting.entity_id}
            className={cn(
              'stroke-ink-inverse',
              row.needed === null
                ? 'fill-ink-4'
                : row.goal || on
                  ? 'fill-marker-goal stroke-ink'
                  : row.pinned
                    ? 'fill-marker-pinned'
                    : 'fill-marker-live',
            )}
            cx={p.x}
            cy={p.y}
            r={big ? 0.075 : 0.055}
            strokeWidth={row.goal || on ? 0.016 : 0.012}
          >
            <title>{`${row.sighting.name} · ${metres(row.distance ?? 0, fmt)}`}</title>
          </circle>
        );
      })}
      <circle className="fill-ink stroke-accent" r={0.06} strokeWidth={0.02} />
    </svg>
  );
}

/**
 * Live source monsters grouped per monster type (`×N`): the goal first, then pins, then
 * nearest. Distance and direction are both those of the nearest entity with a known
 * distance. A group seen a while ago says how long ago.
 */
export function NearbyList({
  groups,
  now,
  selected,
  onSelect,
  onPin,
  pinDisabled = false,
  hit = false,
  compact = false,
}: {
  groups: readonly NearbyGroup[];
  now: number;
  selected?: number | null;
  onSelect?: (pet: number) => void;
  onPin: (pet: number, pinned: boolean) => void;
  pinDisabled?: boolean;
  /** Pin buttons stay clickable on the locked radar window. */
  hit?: boolean;
  /** The in-game radar's dense rows: the monster, then one line per pet. */
  compact?: boolean;
}) {
  const { t } = useTranslation('pets');
  if (compact)
    return (
      <ul className="m-0 flex list-none flex-col gap-px p-0" aria-label={t(($) => $.nearby.label)}>
        {groups.map((group) => (
          <CompactGroup
            key={group.key}
            group={group}
            now={now}
            onPin={onPin}
            pinDisabled={pinDisabled}
            hit={hit}
          />
        ))}
      </ul>
    );
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={t(($) => $.nearby.label)}>
      {groups.map((group) => {
        const lead = group.pets[0]?.pet;
        const seenAgo = now - group.observedMs;
        return (
          <li
            key={group.key}
            className={cn(
              'pet-nearby-row flex items-start gap-2.5 rounded-lg border border-line-soft bg-surface-2 px-2.5 py-2',
              group.goal && 'is-goal border-accent-line bg-accent-soft',
              // A pinned edge on the leading side, kept beside the goal's own colours.
              group.pinned && 'is-pinned border-l-2 border-l-marker-pinned pl-2.25',
              group.pinned && !group.goal && 'border-marker-pinned/45',
            )}
          >
            {(lead || group.pinned) && (
              // A pinned group wears its word under the portrait, where it costs the name no room.
              <div className="flex shrink-0 flex-col items-center gap-1">
                {lead && (
                  <PetPortrait
                    id={lead.id}
                    className={cn(
                      'w-8 rounded-full ring-1',
                      group.pinned ? 'ring-marker-pinned' : 'ring-line-strong',
                    )}
                  />
                )}
                {group.pinned && (
                  <span
                    className="pet-pinned-tag rounded-full bg-marker-pinned/15 px-1 text-4xs leading-3.5 font-bold tracking-caps text-marker-pinned uppercase"
                    title={t(($) => $.nearby.pinnedTitle)}
                  >
                    {t(($) => $.nearby.pinned)}
                  </span>
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                {/* The monster name keeps a full line even at the radar's minimum width. */}
                <span
                  className="min-w-0 basis-full text-sm font-semibold break-words text-ink"
                  title={t(($) => $.nearby.groupTitle, { name: group.name, id: group.npcId })}
                >
                  {group.name}
                  {group.rows.length > 1 && (
                    <span className="font-medium text-ink-3"> ×{group.rows.length}</span>
                  )}
                </span>
                {seenAgo > STALE_CHIP_MS && (
                  <span
                    className="shrink-0 rounded-full bg-surface-3 px-1.5 text-3xs leading-4 text-ink-3 tabular-nums"
                    title={t(($) => $.nearby.newest)}
                  >
                    {t(($) => $.nearby.ago, { age: age(seenAgo) })}
                  </span>
                )}
                <Bearing
                  distance={group.nearest?.distance ?? null}
                  bearing={group.nearest?.bearing ?? null}
                />
              </div>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {group.pets.map(({ pet, state, pinned }) => {
                  const isSelected = selected === pet.id;
                  return (
                    <li
                      key={pet.id}
                      className="grid min-h-7 grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-2 text-xs"
                    >
                      {/* The name keeps its line; in a narrow window the souls drop under it. */}
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                        {onSelect ? (
                          <Button
                            variant="link"
                            className={cn(
                              'min-w-0 max-w-full justify-start font-normal',
                              isSelected ? 'text-accent' : 'text-ink-2 enabled:hover:text-accent',
                            )}
                            onClick={() => onSelect(pet.id)}
                            title={t(($) => $.nearby.show, { name: pet.name })}
                          >
                            <span className="truncate">{pet.name}</span>
                          </Button>
                        ) : (
                          <span
                            className={cn(
                              'min-w-0 truncate',
                              isSelected ? 'text-accent' : 'text-ink-2',
                            )}
                            title={pet.name}
                          >
                            {pet.name}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          <LevelPips state={state} />
                          <span
                            className={cn(
                              'whitespace-nowrap tabular-nums',
                              state.stage === 'growing' || state.stage === 'unowned'
                                ? 'text-ink-2'
                                : 'text-ink-3',
                            )}
                          >
                            {soulsLeftLabel(state, t)}
                          </span>
                        </span>
                      </span>
                      <PinButton
                        size="xs"
                        pinned={pinned}
                        name={pet.name}
                        disabled={pinDisabled}
                        hit={hit}
                        onChange={(next) => onPin(pet.id, next)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The leading stem and wash of a dense radar row: gold for the goal, blue for a pin. */
export function compactRowClass(tone: 'goal' | 'pinned' | null) {
  return cn(
    'relative grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-2 rounded-md py-0.5 pr-0.5 pl-2',
    'before:absolute before:inset-y-1 before:left-0.5 before:w-0.5 before:rounded-full',
    tone === 'goal'
      ? 'bg-accent-soft before:bg-accent'
      : tone === 'pinned'
        ? 'bg-marker-pinned/10 before:bg-marker-pinned'
        : 'before:bg-transparent',
  );
}

/**
 * One line per pet in a dense radar row: name, type (original symbol and written name, kept
 * whole while the name truncates), level pips, souls left (full words in the tooltip) and
 * its pin.
 */
export function CompactPetLine({
  pet,
  state,
  pinned,
  pinDisabled,
  hit,
  onPin,
  named = true,
  children,
}: {
  pet: NearbyPet['pet'];
  state: NearbyPet['state'];
  pinned: boolean;
  pinDisabled: boolean;
  hit: boolean;
  onPin: (pet: number, pinned: boolean) => void;
  /** False when the line above already names the pet. */
  named?: boolean;
  /** Extra words after the souls, e.g. where the pet spawns. */
  children?: ReactNode;
}) {
  const { t } = useTranslation('pets');
  return (
    <span className="flex h-5 min-w-0 items-center gap-1.5 text-2xs text-ink-3 tabular-nums">
      {named && (
        <span className="min-w-0 shrink truncate text-ink-2" title={pet.name}>
          {pet.name}
        </span>
      )}
      <FamilyLabel family={pet.family} className="shrink-0 font-semibold text-ink-2" />
      <LevelPips state={state} size="sm" />
      <span
        className={cn(
          'shrink-0 whitespace-nowrap',
          (state.stage === 'growing' || state.stage === 'unowned') && 'text-ink-2',
        )}
        title={soulsLeftLabel(state, t)}
      >
        {shortSoulsLabel(state, t)}
      </span>
      {children}
      <PinButton
        size="2xs"
        className="ml-auto shrink-0"
        pinned={pinned}
        name={pet.name}
        disabled={pinDisabled}
        hit={hit}
        onChange={(next) => onPin(pet.id, next)}
      />
    </span>
  );
}

/** A nearby monster type in two dense lines: name, count and nearest bearing; its pets. */
export function CompactGroup({
  group,
  now,
  onPin,
  pinDisabled,
  hit,
}: {
  group: NearbyGroup;
  now: number;
  onPin: (pet: number, pinned: boolean) => void;
  pinDisabled: boolean;
  hit: boolean;
}) {
  const { t } = useTranslation('pets');
  const lead = group.pets[0]?.pet;
  const seenAgo = now - group.observedMs;
  return (
    <li
      className={cn(
        'pet-nearby-row',
        compactRowClass(group.goal ? 'goal' : group.pinned ? 'pinned' : null),
        group.goal && 'is-goal',
        group.pinned && 'is-pinned',
      )}
    >
      {lead ? (
        <PetPortrait
          id={lead.id}
          className={cn(
            'mt-0.5 w-6 rounded-full ring-1',
            group.goal
              ? 'ring-accent-line'
              : group.pinned
                ? 'ring-marker-pinned'
                : 'ring-line-strong',
          )}
        />
      ) : (
        <span />
      )}
      <div className="min-w-0">
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          {group.goal && (
            <span className="inline-flex shrink-0 text-accent" title={t(($) => $.nearby.goalTitle)}>
              <Icon name="target" size={11} />
              <span className="sr-only">{t(($) => $.nearby.goal)}</span>
            </span>
          )}
          {group.pinned && (
            <span
              className="pet-pinned-tag inline-flex shrink-0 text-marker-pinned"
              title={t(($) => $.nearby.pinnedTitle)}
            >
              <Icon name="pin" size={10} />
              <span className="sr-only">{t(($) => $.nearby.pinned)}</span>
            </span>
          )}
          <span
            className="min-w-0 flex-1 truncate text-xs font-semibold text-ink"
            title={t(($) => $.nearby.groupTitle, { name: group.name, id: group.npcId })}
          >
            {group.name}
            {group.rows.length > 1 && (
              <span className="font-medium text-ink-3"> ×{group.rows.length}</span>
            )}
          </span>
          {seenAgo > STALE_CHIP_MS && (
            <span
              className="shrink-0 text-3xs text-ink-3 tabular-nums"
              title={t(($) => $.nearby.newestAgo, { age: age(seenAgo) })}
            >
              {age(seenAgo)}
            </span>
          )}
          <Bearing
            compact
            distance={group.nearest?.distance ?? null}
            bearing={group.nearest?.bearing ?? null}
          />
        </div>
        <ul className="m-0 list-none p-0">
          {group.pets.map(({ pet, state, pinned }) => (
            <li key={pet.id}>
              <CompactPetLine
                pet={pet}
                state={state}
                pinned={pinned}
                pinDisabled={pinDisabled}
                hit={hit}
                onPin={onPin}
              />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
