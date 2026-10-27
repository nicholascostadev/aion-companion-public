import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { Checkbox, SearchInput } from '../../components/ui/Field';
import { PetPortrait, PetTypeIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetFamily, PetMap } from '../../types/pets';
import type { PickMode, PickRow } from './farming';
import type { MapLabel } from './maps';
import { FAMILY_LABEL, soulsLeftLabel } from './model';
import { familyColor, LevelPips, PinButton } from './parts';

const MODES: readonly PickMode[] = ['farm', 'pinned', 'all'];

/**
 * The type filter chosen in the Level 3 overview, said where the list is, with the way back
 * to every type.
 */
export function FamilyOnly({ family, onClear }: { family: PetFamily; onClear: () => void }) {
  const { t } = useTranslation('pets');
  return (
    <p className="m-0 flex min-w-0 flex-none items-center gap-2 text-xs text-ink-2">
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <PetTypeIcon family={family} size={14} className="size-3.5" />
        {t(($) => $.overview.only, { family: FAMILY_LABEL[family] })}
      </span>
      <Button variant="link" className="ml-auto shrink-0 text-xs" onClick={onClear}>
        {t(($) => $.overview.clear)}
      </Button>
    </p>
  );
}

/**
 * Second line of a row: real progress when known, else plain spawn counts. A pin listed
 * although it does not spawn on the shown map says so in place of the souls left (the
 * figure and the bar still show them).
 */
function rowNote(row: PickRow, mapShown: boolean, offMap: boolean, t: Translate<'pets'>) {
  const { state } = row;
  if (state.stage === 'maxed')
    return offMap ? t(($) => $.picker.note.completeOffMap) : t(($) => $.souls.complete);
  if (state.stage !== 'unknown') {
    const values = { progress: state.progress ?? 0, needed: state.needed ?? 0 };
    return offMap
      ? t(($) => $.picker.note.progressOffMap, values)
      : t(($) => $.picker.note.progress, { ...values, left: soulsLeftLabel(state, t) });
  }
  if (offMap) return t(($) => $.picker.note.offMap);
  if (mapShown && row.here) return t(($) => $.picker.note.unknownHere, { count: row.here });
  return t(($) => $.picker.note.unknown, { count: row.points });
}

function PickItem({
  row,
  selected,
  goal,
  pinned,
  pinDisabled,
  mapShown,
  offMap,
  onSelect,
  onPin,
  onKeyDown,
}: {
  row: PickRow;
  selected: boolean;
  goal: boolean;
  pinned: boolean;
  pinDisabled: boolean;
  mapShown: boolean;
  /** Listed although it has no spawns on the shown map. */
  offMap: boolean;
  onSelect: () => void;
  onPin: (pin: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation('pets');
  const { pet, state } = row;
  const fraction =
    state.stage === 'growing' || state.stage === 'unowned'
      ? state.needed
        ? (state.progress ?? 0) / state.needed
        : 0
      : state.stage === 'maxed'
        ? 1
        : null;
  return (
    <li
      // The selected pet is lit and grows a small stem on its leading edge.
      className={selectableRow(selected, 'flex items-center')}
      data-pet-id={pet.id}
    >
      <Pressable
        className="farm-pick-main flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pr-1 pl-2 focus-visible:outline-offset-[-2px]"
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <PetPortrait
          id={pet.id}
          lazy
          className={cn(
            'w-10 rounded-sm',
            state.stage === 'unowned' &&
              '[&_img]:opacity-60 [&_img]:brightness-80 [&_img]:grayscale',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="farm-pick-name flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
            <PetTypeIcon family={pet.family} size={12} className="size-3" />
            {/* A long name takes a second line before it is cut. */}
            <span className="line-clamp-2 min-w-0 break-words" title={pet.name}>
              {pet.name}
            </span>
            {goal && (
              <Badge shape="tag" tone="accent" className="farm-tag">
                {t(($) => $.farm.goal)}
              </Badge>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-3 tabular-nums">
            <LevelPips state={state} size="sm" />
            <span
              className="farm-pick-note truncate"
              title={offMap ? t(($) => $.picker.note.offMapTitle) : undefined}
            >
              {rowNote(row, mapShown, offMap, t)}
            </span>
          </span>
          {fraction !== null && (
            <Meter
              size="xs"
              className="farm-pick-bar mt-0.5 h-[3px] w-full flex-none"
              fraction={fraction}
              color={familyColor(pet.family)}
              label={rowNote(row, mapShown, offMap, t)}
            />
          )}
        </span>
      </Pressable>
      <PinButton
        size="xs"
        className="mr-1"
        pinned={pinned}
        name={pet.name}
        disabled={pinDisabled}
        onChange={onPin}
      />
    </li>
  );
}

/**
 * Ranked farming list beside the map: portraits, souls to the next level (closest first)
 * when the collection is known, spawn counts otherwise. Up and down arrows move between
 * pets; Enter or Space selects, and on the selected pet clears the selection (the caller
 * decides, through `onSelect`).
 */
export function FarmPicker({
  rows,
  total,
  mode,
  hereOnly,
  family,
  search,
  synced,
  shownMap,
  mapMatches,
  selected,
  goal,
  pinned,
  pinDisabled,
  onMode,
  onHereOnly,
  onFamily,
  onSearch,
  onPickMap,
  onSelect,
  onPin,
}: {
  rows: PickRow[];
  total: number;
  mode: PickMode;
  hereOnly: boolean;
  family: PetFamily | 'all';
  search: string;
  synced: boolean;
  shownMap: PetMap | null;
  mapMatches: { map: PetMap; label: MapLabel; points: number }[];
  selected: number | null;
  goal: number | null;
  pinned: ReadonlySet<number>;
  pinDisabled: boolean;
  onMode: (mode: PickMode) => void;
  onHereOnly: (on: boolean) => void;
  onFamily: (family: PetFamily | 'all') => void;
  onSearch: (search: string) => void;
  onPickMap: (mapId: string) => void;
  onSelect: (id: number) => void;
  onPin: (id: number, pin: boolean) => void;
}) {
  const { t } = useTranslation('pets');
  const list = useRef<HTMLUListElement>(null);
  // The pinned mode lists every pin, whatever the map.
  const pinsOnly = mode === 'pinned';

  // A pet chosen elsewhere (map, radar, pickups) is scrolled into sight.
  useEffect(() => {
    if (selected === null) return;
    list.current
      ?.querySelector(`[data-pet-id="${selected}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!list.current) return;
    const items = [...list.current.querySelectorAll<HTMLButtonElement>('.farm-pick-main')];
    const at = items.indexOf(event.currentTarget);
    const next =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null;
    if (next === null || at < 0) return;
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
  };

  return (
    <Panel
      as="aside"
      padding="none"
      aria-label={t(($) => $.picker.label)}
      className="flex flex-col gap-2.5 overflow-hidden p-3"
    >
      <SearchInput
        wrapperClassName="flex-none"
        aria-label={t(($) => $.picker.search)}
        placeholder={t(($) => $.picker.searchPlaceholder)}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      {mapMatches.length > 0 && (
        <ul
          className="m-0 flex list-none flex-col gap-0.5 p-0"
          aria-label={t(($) => $.picker.matchingMaps)}
        >
          {mapMatches.map(({ map, label, points }) => (
            <li key={map.id}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                aria-pressed={shownMap?.id === map.id}
                icon={<Icon name="map" size={13} />}
                onClick={() => onPickMap(map.id)}
              >
                <span className="min-w-0 flex-1 truncate text-left">{label.label}</span>
                <span className="text-ink-3 tabular-nums">{points}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          label={t(($) => $.picker.modesLabel)}
          value={mode}
          onChange={onMode}
          options={MODES.map((value) => {
            const off = value === 'farm' && !synced;
            return {
              value,
              label: t(($) => $.picker.modes[value].label),
              title: off ? t(($) => $.picker.needsSync) : t(($) => $.picker.modes[value].title),
              disabled: off,
            };
          })}
        />
        <span
          title={
            !shownMap
              ? t(($) => $.picker.chooseMapFirst)
              : pinsOnly
                ? t(($) => $.picker.pinsAlwaysListed)
                : undefined
          }
        >
          <Checkbox
            className="items-center text-xs whitespace-nowrap"
            label={<span className="text-xs text-ink-2">{t(($) => $.picker.farmableHere)}</span>}
            checked={hereOnly && !pinsOnly}
            disabled={!shownMap || pinsOnly}
            onCheckedChange={(checked) => onHereOnly(checked)}
          />
        </span>
      </div>
      {family !== 'all' && <FamilyOnly family={family} onClear={() => onFamily('all')} />}
      {rows.length ? (
        <ul
          ref={list}
          className="-mx-1 m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-auto p-0 px-1"
          aria-label={t(($) => $.picker.ranked)}
        >
          {rows.map((row) => (
            <PickItem
              key={row.pet.id}
              row={row}
              selected={selected === row.pet.id}
              goal={goal === row.pet.id}
              pinned={pinned.has(row.pet.id)}
              pinDisabled={pinDisabled}
              mapShown={!!shownMap}
              offMap={pinsOnly && !!shownMap && row.here === 0}
              onSelect={() => onSelect(row.pet.id)}
              onPin={(pin) => onPin(row.pet.id, pin)}
              onKeyDown={onKeyDown}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 flex-1 px-0.5 py-2 text-sm text-ink-3">
          {pinsOnly && !pinned.size
            ? t(($) => $.picker.empty.noPins)
            : hereOnly && !pinsOnly
              ? t(($) => $.picker.empty.noMatchHere)
              : t(($) => $.picker.empty.noMatch)}
        </p>
      )}
      <p className="m-0 flex-none text-2xs text-ink-3 tabular-nums">
        {pinsOnly
          ? t(($) => $.picker.count.pinned, { shown: rows.length, count: pinned.size })
          : hereOnly && shownMap
            ? t(($) => $.picker.count.onMap, { shown: rows.length, count: total })
            : t(($) => $.picker.count.all, { shown: rows.length, count: total })}
      </p>
    </Panel>
  );
}
