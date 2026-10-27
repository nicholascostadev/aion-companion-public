import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { PetPortrait } from '../../components/ui/GameArt';
import { Pressable } from '../../components/ui/Pressable';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetEntry } from '../../types/pets';
import { stateOf, type PetState } from './model';
import { FamilyLabel, LevelPips, PinButton, SoulProgress } from './parts';

function PetCard({
  pet,
  state,
  pinned,
  selected,
  active,
  onSelect,
  onPin,
  pinDisabled,
  onKeyDown,
}: {
  pet: PetEntry;
  state: PetState;
  pinned: boolean;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
  onPin: (pinned: boolean) => void;
  pinDisabled: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation('pets');
  return (
    <li
      className={cn(
        `is-${state.stage}`,
        'group/card relative flex min-w-0 rounded-lg border border-line-soft bg-surface-2',
        'transition-[translate,border-color,background-color,box-shadow] duration-200 ease-grow',
        'hover:-translate-y-px hover:border-line hover:shadow-2',
        pinned && 'is-pinned border-warn-line/60',
        selected && 'is-selected border-accent-line bg-row-selected shadow-glow hover:shadow-glow',
      )}
      data-pet-id={pet.id}
    >
      <Pressable
        className="pet-card-main flex min-w-0 flex-1 flex-col items-stretch rounded-[inherit] p-1.5 focus-visible:outline-offset-1"
        aria-pressed={selected}
        title={pet.name}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span className="relative block">
          <PetPortrait
            id={pet.id}
            lazy
            className={cn(
              'w-full rounded-sm [&_img]:transition-[scale] [&_img]:duration-300 [&_img]:ease-grow group-hover/card:[&_img]:scale-[1.04]',
              state.stage === 'unowned' &&
                '[&_img]:opacity-55 [&_img]:brightness-80 [&_img]:grayscale',
            )}
          />
          {/* A complete pet wears a thin golden band under its portrait. */}
          {state.stage === 'maxed' && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-pollen shadow-[0_0_8px_var(--color-pollen)]"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 px-0.5 pt-1.5 pb-0.5">
          <span
            className={cn(
              'pet-card-name line-clamp-2 text-xs leading-tight font-semibold [overflow-wrap:anywhere]',
              state.stage === 'unknown' ? 'text-ink-2' : 'text-ink',
            )}
          >
            {pet.name}
          </span>
          <span className="mt-auto flex min-w-0 items-center justify-between gap-1">
            <FamilyLabel
              family={pet.family}
              className="pet-card-family gap-1 text-2xs text-ink-3"
            />
            <LevelPips state={state} size="sm" />
          </span>
          <SoulProgress state={state} compact />
        </span>
        {active && (
          <Badge
            shape="tag"
            tone="accent"
            className="absolute top-2.5 left-2.5 bg-veil backdrop-blur-sm"
          >
            {t(($) => $.cards.active)}
          </Badge>
        )}
      </Pressable>
      <PinButton
        size="xs"
        className={cn(
          'absolute top-2.5 right-2.5 bg-veil opacity-50 backdrop-blur-sm transition-opacity',
          'group-focus-within/card:opacity-100 group-hover/card:opacity-100 focus-visible:opacity-100',
          'enabled:hover:bg-surface-3 aria-pressed:bg-veil aria-pressed:opacity-100',
        )}
        pinned={pinned}
        name={pet.name}
        disabled={pinDisabled}
        onChange={onPin}
      />
    </li>
  );
}

/** Columns the grid lays out right now; one when the layout is unknown. */
function columnsOf(list: HTMLElement) {
  const tracks = getComputedStyle(list).gridTemplateColumns.trim();
  return tracks && tracks !== 'none' ? tracks.split(/\s+/).length : 1;
}

/**
 * Dense, scrollable grid of pet cards. Arrow keys move focus between cards (up and
 * down by one row), Home and End jump to the first and last; Enter or Space selects.
 */
export function PetCardGrid({
  pets,
  states,
  pinned,
  selected,
  activeId,
  pinDisabled,
  onSelect,
  onPin,
}: {
  pets: PetEntry[];
  states: Map<number, PetState>;
  pinned: Set<number>;
  selected: number | null;
  activeId: number | null;
  pinDisabled: boolean;
  onSelect: (id: number) => void;
  onPin: (id: number, pinned: boolean) => void;
}) {
  const { t } = useTranslation('pets');
  const list = useRef<HTMLUListElement>(null);

  // A pet chosen elsewhere (radar, pickups, map) is scrolled into sight.
  useEffect(() => {
    if (selected === null) return;
    const card = list.current?.querySelector(`[data-pet-id="${selected}"]`);
    card?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!list.current) return;
    const cards = [...list.current.querySelectorAll<HTMLButtonElement>('.pet-card-main')];
    const at = cards.indexOf(event.currentTarget);
    if (at < 0) return;
    const step = columnsOf(list.current);
    const next =
      event.key === 'ArrowRight'
        ? at + 1
        : event.key === 'ArrowLeft'
          ? at - 1
          : event.key === 'ArrowDown'
            ? at + step
            : event.key === 'ArrowUp'
              ? at - step
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? cards.length - 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
  };

  return (
    <ul
      ref={list}
      className="-mx-1 m-0 grid max-h-[max(360px,calc(100vh-250px))] list-none auto-rows-auto grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] gap-2.5 overflow-auto p-1"
      aria-label={t(($) => $.cards.grid)}
    >
      {pets.map((pet) => (
        <PetCard
          key={pet.id}
          pet={pet}
          state={stateOf(states, pet.id)}
          pinned={pinned.has(pet.id)}
          selected={selected === pet.id}
          active={activeId === pet.id}
          onSelect={() => onSelect(pet.id)}
          onPin={(pin) => onPin(pet.id, pin)}
          pinDisabled={pinDisabled}
          onKeyDown={onKeyDown}
        />
      ))}
    </ul>
  );
}
