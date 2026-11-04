import { useEffect, useState } from 'react';
import { HoverPopover, useHoverPopover } from '../../components/ui/HoverPopover';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  CharacterEquipment,
  Companion,
  EquippedItem,
  ItemDetail,
  Lazy,
} from '../../types/profile';
import { ItemDetailView, PlainDetail, companionFacts } from './ItemDetailView';
import { equipmentGroups, type EquipmentGroup } from './model';
import { DetailPanel, GradeArt, SectionTitle, TabBody } from './parts';
import { useSlotName } from './slots';

/** An item is chosen by its slot, so after a Refresh the detail follows what is in it now. */
type Chosen = { kind: 'item'; slot: number } | { kind: 'pet' | 'wing' | 'wingSkin' };

interface SlotsProps {
  equipment: CharacterEquipment;
  details: Record<string, Lazy<ItemDetail>>;
  itemKey: (item: EquippedItem) => string;
  onLoadItem: (item: EquippedItem, again?: boolean) => void;
}

/** The Equipment tab's groups; arcana have their own tab (`ArcanaTab`). */
const GEAR: readonly EquipmentGroup[] = ['weapons', 'armor', 'accessories', 'runes', 'other'];

/**
 * Every equipped slot by group except arcana, then pet and wings. Hovering or focusing a
 * slot shows its full detail in a popover: this character's own copy of the item (its
 * rolls, stones, breakthrough, set), read from the official service when the popover opens
 * and again after a Refresh. Choosing a slot pins the same detail beside the list, which
 * is optional.
 */
export function EquipmentTab(props: SlotsProps) {
  const { t } = useTranslation('profile');
  return <SlotsTab {...props} groups={GEAR} companions empty={t(($) => $.equipment.empty)} />;
}

/** The slots of the given groups (the sheet keeps every slot; a tab only filters). */
function SlotsTab({
  equipment,
  details,
  itemKey,
  onLoadItem,
  groups: shownGroups,
  companions: withCompanions = false,
  empty,
}: SlotsProps & {
  groups: readonly EquipmentGroup[];
  /** Adds the pet and wings after the slots. */
  companions?: boolean;
  empty: string;
}) {
  const { t } = useTranslation('profile');
  const slotName = useSlotName();
  const hover = useHoverPopover();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const groups = equipmentGroups(equipment.items).filter((g) => shownGroups.includes(g.group));
  const items = groups.flatMap((g) => g.items);
  const byKey = new Map(items.map((i) => [itemKey(i), i]));
  const chosenItem =
    chosen?.kind === 'item' ? (items.find((i) => i.slot === chosen.slot) ?? null) : null;
  const hovered = hover.shown ? (byKey.get(hover.shown.key) ?? null) : null;
  // An item whose read failed waits for its Retry instead of being read again on hover.
  const hoveredFailed = hovered ? details[itemKey(hovered)]?.state === 'error' : false;

  // The pinned item is read when chosen, the hovered one when its popover opens, and both
  // again when a Refresh hands down a new loader; the loader asks for each item once.
  useEffect(() => {
    if (chosenItem) onLoadItem(chosenItem);
  }, [chosenItem, onLoadItem]);
  useEffect(() => {
    if (hovered && !hoveredFailed) onLoadItem(hovered);
  }, [hovered, hoveredFailed, onLoadItem]);

  const same = (a: Chosen | null, b: Chosen) =>
    a?.kind === b.kind && (a.kind !== 'item' || b.kind !== 'item' || a.slot === b.slot);
  const choose = (next: Chosen) => {
    hover.hide({ immediate: true, dismiss: true });
    setChosen((current) => (same(current, next) ? null : next));
  };

  const companions: { kind: 'pet' | 'wing' | 'wingSkin'; value: Companion; label: string }[] = (
    withCompanions
      ? [
          equipment.pet && {
            kind: 'pet' as const,
            value: equipment.pet,
            label: t(($) => $.equipment.pet),
          },
          equipment.wing && {
            kind: 'wing' as const,
            value: equipment.wing,
            label: t(($) => $.equipment.wing),
          },
          equipment.wingSkin && {
            kind: 'wingSkin' as const,
            value: equipment.wingSkin,
            label: t(($) => $.equipment.wingSkin),
          },
        ]
      : []
  ).filter((c) => c !== null);
  const chosenCompanion =
    chosen && chosen.kind !== 'item' ? companions.find((c) => c.kind === chosen.kind) : undefined;
  const hoveredCompanion = companions.find((c) => hover.shown?.key === `companion:${c.kind}`);

  let detail = null;
  if (chosenItem)
    detail = (
      <DetailPanel
        label={t(($) => $.equipment.detailLabel, { name: chosenItem.name })}
        closeLabel={t(($) => $.actions.closeDetail)}
        onClose={() => setChosen(null)}
      >
        <ItemDetailView
          item={chosenItem}
          detail={details[itemKey(chosenItem)]}
          onRetry={() => onLoadItem(chosenItem, true)}
        />
      </DetailPanel>
    );
  else if (chosenCompanion)
    detail = (
      <DetailPanel
        label={t(($) => $.equipment.detailLabel, { name: chosenCompanion.value.name })}
        closeLabel={t(($) => $.actions.closeDetail)}
        onClose={() => setChosen(null)}
      >
        <PlainDetail
          kind={chosenCompanion.label}
          name={chosenCompanion.value.name}
          icon={chosenCompanion.value.icon}
          grade={chosenCompanion.value.grade}
          facts={companionFacts(chosenCompanion.value, t)}
        />
      </DetailPanel>
    );

  return (
    <TabBody
      detail={detail}
      onEscape={() =>
        hover.shown ? hover.hide({ immediate: true, dismiss: true }) : setChosen(null)
      }
    >
      <div className="flex flex-col gap-4" data-detail-open={detail ? '' : undefined}>
        {groups.map(({ group, items }) => (
          <section key={group} aria-label={t(($) => $.equipment.groups[group])}>
            <SectionTitle count={items.length}>{t(($) => $.equipment.groups[group])}</SectionTitle>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-1 p-0">
              {items.map((item) => {
                const key = itemKey(item);
                const selected = chosen?.kind === 'item' && chosen.slot === item.slot;
                return (
                  <li key={key}>
                    <Pressable
                      // The pinned slot's detail is already beside the list.
                      {...(selected ? {} : hover.trigger(key))}
                      aria-pressed={selected}
                      aria-label={t(($) => $.equipment.itemLabel, {
                        slot: slotName(item.slotName),
                        name: item.name,
                        enchant: item.enchant,
                        breakthrough: item.breakthrough,
                      })}
                      className={cn(
                        selectableRow(selected),
                        'flex w-full items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-row-hover',
                      )}
                      onClick={() => choose({ kind: 'item', slot: item.slot })}
                    >
                      <GradeArt
                        url={item.icon}
                        name={item.name}
                        grade={item.grade}
                        size={34}
                        enchant={item.enchant}
                        breakthrough={item.breakthrough}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-tight text-ink">
                          {item.name}
                        </span>
                        <span className="block truncate text-2xs text-ink-3">
                          {slotName(item.slotName)}
                        </span>
                      </span>
                    </Pressable>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {companions.length > 0 && (
          <section aria-label={t(($) => $.equipment.groups.companions)}>
            <SectionTitle count={companions.length}>
              {t(($) => $.equipment.groups.companions)}
            </SectionTitle>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-1 p-0">
              {companions.map((c) => {
                const selected = chosen?.kind === c.kind;
                return (
                  <li key={c.kind}>
                    <Pressable
                      {...(selected ? {} : hover.trigger(`companion:${c.kind}`))}
                      aria-pressed={selected}
                      className={cn(
                        selectableRow(selected),
                        'flex w-full items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-row-hover',
                      )}
                      onClick={() => choose({ kind: c.kind })}
                    >
                      <GradeArt
                        url={c.value.icon}
                        name={c.value.name}
                        grade={c.value.grade}
                        size={34}
                        enchant={c.value.enchant}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-tight text-ink">
                          {c.value.name}
                        </span>
                        <span className="block truncate text-2xs text-ink-3">
                          {c.label}
                          {c.value.level !== null &&
                            ` · ${t(($) => $.equipment.level, { level: c.value.level })}`}
                        </span>
                      </span>
                    </Pressable>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {groups.length === 0 && companions.length === 0 && (
          <p className="m-0 text-sm text-ink-3">{empty}</p>
        )}
      </div>
      <HoverPopover
        popover={hover.popover}
        label={t(($) => $.equipment.detailLabel, {
          name: hovered?.name ?? hoveredCompanion?.value.name ?? '',
        })}
      >
        {hovered ? (
          <ItemDetailView
            item={hovered}
            detail={details[itemKey(hovered)]}
            onRetry={() => onLoadItem(hovered, true)}
          />
        ) : (
          hoveredCompanion && (
            <PlainDetail
              kind={hoveredCompanion.label}
              name={hoveredCompanion.value.name}
              icon={hoveredCompanion.value.icon}
              grade={hoveredCompanion.value.grade}
              facts={companionFacts(hoveredCompanion.value, t)}
            />
          )
        )}
        <p className="m-0 mt-2.5 border-t border-line-soft pt-2 text-2xs text-ink-4">
          {t(($) => $.equipment.chooseHint)}
        </p>
      </HoverPopover>
    </TabBody>
  );
}
