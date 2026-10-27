import { useMemo, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetMap, PetPosition } from '../../types/pets';
import type { NearbyRow, PetIndex, PetState } from './model';
import { SpawnMap } from './SpawnMap';

/** Which marks the farming map draws. */
export interface MapLayers {
  /** Static spawn points of the pets listed (the selection and goal always show). */
  spawns: boolean;
  /** Live sightings around the character. */
  live: boolean;
}

/**
 * The three farming maps (Elyos, Asmodian, Abyss) as one choice, each with the static points
 * of the pets drawn and a mark where the character stands.
 */
export function MapChooser({
  index,
  value,
  hereId,
  pets,
  onChange,
}: {
  index: PetIndex;
  value: string | null;
  hereId: string | null;
  pets: ReadonlySet<number>;
  onChange: (mapId: string) => void;
}) {
  const { t } = useTranslation('pets');
  const options = useMemo(
    () =>
      index.farmMaps.map(({ map, label, realm }) => {
        let points = 0;
        for (const s of index.spawns.get(map.id) ?? []) if (pets.has(s.pet)) points++;
        const here = map.id === hereId;
        const values = { map: label.label, points: t(($) => $.farm.points, { count: points }) };
        return {
          value: map.id,
          title: here
            ? t(($) => $.farm.chooser.titleHere, values)
            : t(($) => $.farm.chooser.title, values),
          label: (
            <>
              {here && <Icon name="locate" size={12} />}
              {realm}
              <span aria-hidden className="text-2xs tabular-nums opacity-75">
                {points}
              </span>
              <span className="sr-only">
                {' '}
                {here
                  ? t(($) => $.farm.chooser.srHere, values)
                  : t(($) => $.farm.chooser.sr, values)}
              </span>
            </>
          ),
        };
      }),
    [index, pets, hereId, t],
  );
  return (
    <SegmentedControl
      label={t(($) => $.farm.chooser.label)}
      size="sm"
      options={options}
      value={value ?? ''}
      onChange={onChange}
    />
  );
}

/** The grid of the Map tab for each pair of open side panels (literal so Tailwind sees it). */
const COLUMNS = {
  both: 'min-[1181px]:grid-cols-[16rem_minmax(0,1fr)_18.5rem]',
  picker: 'min-[1181px]:grid-cols-[16rem_minmax(0,1fr)]',
  detail: 'min-[1181px]:grid-cols-[minmax(0,1fr)_18.5rem]',
  none: 'min-[1181px]:grid-cols-1',
} as const;

/**
 * Map tab: the farming map is the stage, with the ranked picker on its left and the selected
 * pet's detail on its right. Either side can be folded away to give the map the room; the
 * map's own tools, fit and hover cards keep working because the sides never cover it. Each
 * column scrolls on its own so the page stays put; narrower windows move the detail below,
 * then stack everything.
 */
export function FarmView({
  index,
  picker,
  detail,
  pickerOpen,
  detailOpen,
  onPickerOpen,
  onDetailOpen,
  layers,
  onLayers,
  liveCount,
  liveNote,
  shownMap,
  hereId,
  drawn,
  selected,
  goal,
  pinned,
  position,
  sightings,
  states,
  now,
  activeId,
  fitKey,
  listed,
  drawArt = true,
  onChooseMap,
  onSelect,
  onClear,
}: {
  index: PetIndex;
  picker: ReactNode;
  detail: ReactNode;
  pickerOpen: boolean;
  detailOpen: boolean;
  onPickerOpen: (open: boolean) => void;
  onDetailOpen: (open: boolean) => void;
  /** Which marks the map draws: the listed pets' static points and live sightings. */
  layers: MapLayers;
  onLayers: (layers: MapLayers) => void;
  /** Live sightings with coordinates on the shown map, drawn or not; null when not live. */
  liveCount: number | null;
  /** Why nothing live can show, if so. */
  liveNote: string | null;
  shownMap: PetMap | null;
  hereId: string | null;
  /** Pets whose spawns are drawn. */
  drawn: ReadonlySet<number>;
  selected: number | null;
  goal: number | null;
  pinned: ReadonlySet<number>;
  /** Fresh own position on the shown map, or null. */
  position: PetPosition | null;
  /** Fresh live sightings with coordinates on the shown map, when drawn. */
  sightings: NearbyRow[];
  states: Map<number, PetState>;
  now: number;
  activeId: number | null;
  fitKey: string;
  /** Pets listed in the picker. */
  listed: number;
  /** False while off screen: the map's art is released. */
  drawArt?: boolean;
  onChooseMap: (mapId: string) => void;
  onSelect: (pet: number) => void;
  /** Lets the selection go: the selected pet's own mark chosen again. */
  onClear: () => void;
}) {
  const { t } = useTranslation('pets');
  const label = shownMap ? index.labels.get(shownMap.id) : undefined;
  const columns = pickerOpen
    ? detailOpen
      ? COLUMNS.both
      : COLUMNS.picker
    : detailOpen
      ? COLUMNS.detail
      : COLUMNS.none;
  return (
    <div
      className={cn(
        'grid gap-3 *:min-h-0 *:min-w-0',
        columns,
        'min-[1181px]:h-[clamp(420px,calc(100vh-350px),980px)]',
        // Narrower: the picker beside the map, the detail below; then everything stacked.
        pickerOpen ? 'grid-cols-[16.25rem_minmax(0,1fr)]' : 'grid-cols-1',
        'max-[1180px]:*:h-[clamp(420px,calc(100vh-330px),820px)] max-[1180px]:*:data-[side=detail]:h-auto',
        'max-[760px]:grid-cols-1',
        // Stacked, a shorter list leaves the map in sight.
        pickerOpen && 'max-[760px]:*:first:h-[22.5rem]',
      )}
    >
      {pickerOpen && picker}
      <Panel
        as="section"
        padding="none"
        aria-label={t(($) => $.farm.mapPanel)}
        className="@container flex flex-col gap-2.5 p-3"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-expanded={pickerOpen}
            aria-label={pickerOpen ? t(($) => $.panel.picker.hide) : t(($) => $.panel.picker.show)}
            title={pickerOpen ? t(($) => $.panel.picker.hide) : t(($) => $.panel.picker.show)}
            icon={<Icon name={pickerOpen ? 'panelLeftClose' : 'panelLeftOpen'} size={14} />}
            onClick={() => onPickerOpen(!pickerOpen)}
          />
          <MapChooser
            index={index}
            value={shownMap?.id ?? null}
            hereId={hereId}
            pets={drawn}
            onChange={onChooseMap}
          />
          <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
            <legend className="sr-only">{t(($) => $.panel.layers.label)}</legend>
            <Chip
              size="xs"
              pressed={layers.spawns}
              title={t(($) => $.panel.layers.spawnsTitle)}
              icon={<Icon name="layers" size={12} />}
              onPressedChange={(spawns) => onLayers({ ...layers, spawns })}
            >
              {t(($) => $.panel.layers.spawns)}
            </Chip>
            <Chip
              size="xs"
              pressed={layers.live}
              title={[t(($) => $.panel.layers.liveTitle), liveNote].filter(Boolean).join('\n')}
              icon={<Icon name="radar" size={12} />}
              count={liveCount}
              onPressedChange={(live) => onLayers({ ...layers, live })}
            >
              {t(($) => $.panel.layers.live)}
            </Chip>
          </fieldset>
          <span className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden min-w-0 truncate text-xs text-ink-3 @3xl:inline">
              {label && <b className="font-semibold text-ink-2">{label.label} · </b>}
              {t(($) => $.farm.listed, { count: listed })}
            </span>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              aria-expanded={detailOpen}
              aria-label={
                detailOpen ? t(($) => $.panel.detail.hide) : t(($) => $.panel.detail.show)
              }
              title={detailOpen ? t(($) => $.panel.detail.hide) : t(($) => $.panel.detail.show)}
              icon={<Icon name={detailOpen ? 'panelRightClose' : 'panelRightOpen'} size={14} />}
              onClick={() => onDetailOpen(!detailOpen)}
            />
          </span>
        </div>
        {shownMap ? (
          <SpawnMap
            index={index}
            map={shownMap}
            pets={drawn}
            selected={selected}
            goal={goal}
            pinned={pinned}
            position={position}
            sightings={sightings}
            states={states}
            now={now}
            activeId={activeId}
            fitKey={fitKey}
            drawArt={drawArt}
            onSelect={onSelect}
            onClear={onClear}
          />
        ) : (
          <EmptyState
            className="flex-1 justify-center"
            icon={<Icon name="map" size={18} />}
            title={t(($) => $.farm.noMap.title)}
          >
            {t(($) => $.farm.noMap.body)}
          </EmptyState>
        )}
      </Panel>
      {detailOpen && (
        <div
          data-side="detail"
          className="overflow-auto max-[1180px]:col-span-full max-[1180px]:overflow-visible"
        >
          {detail}
        </div>
      )}
    </div>
  );
}
