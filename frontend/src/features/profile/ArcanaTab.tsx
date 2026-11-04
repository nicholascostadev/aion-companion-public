import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { HoverPopover, useHoverPopover } from '../../components/ui/HoverPopover';
import { Icon } from '../../components/ui/Icon';
import { Pressable } from '../../components/ui/Pressable';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { CharacterEquipment, EquippedItem, ItemDetail, Lazy } from '../../types/profile';
import { ItemDetailView } from './ItemDetailView';
import {
  ARCANA_SLOTS,
  arcanaEffects,
  arcanaPosition,
  gradeStyle,
  groupOf,
  type ArcanaEffects,
} from './model';
import { DetailPanel, OfficialArt, SectionTitle, TabBody, initial } from './parts';
import { useSlotName } from './slots';

interface Props {
  equipment: CharacterEquipment;
  details: Record<string, Lazy<ItemDetail>>;
  itemKey: (item: EquippedItem) => string;
  onLoadItem: (item: EquippedItem, again?: boolean) => void;
}

/**
 * Where each of the five slots sits, as the game lays its cards out: Arcana 1, 3 and 4 on
 * top, 2 and 5 below between them, each a little tilted. Cards never overlap, so every
 * one stays whole under the pointer.
 */
const PLACE: Record<number, string> = {
  1: 'col-start-1 row-start-1 -rotate-3 translate-y-2',
  2: 'col-start-2 row-start-2 rotate-3',
  3: 'col-start-3 row-start-1',
  4: 'col-start-5 row-start-1 rotate-4 translate-y-3',
  5: 'col-start-4 row-start-2 -rotate-2 translate-y-1',
};

/**
 * The arcana as the game shows them: five portrait cards of their original art (NCSOFT
 * publishes square card art, drawn whole above a name plate, never cropped into a taller
 * picture), and beside them the equipped effects and set effects the official details of
 * those cards add up to. Opening the tab reads the equipped cards' details, once each per
 * sheet; hovering or focusing a card shows its full detail, and choosing one pins it.
 */
export function ArcanaTab({ equipment, details, itemKey, onLoadItem }: Props) {
  const { t } = useTranslation('profile');
  const slotName = useSlotName();
  const hover = useHoverPopover();
  const [chosen, setChosen] = useState<number | null>(null);
  const cards = useMemo(
    () => equipment.items.filter((item) => groupOf(item) === 'arcana'),
    [equipment.items],
  );
  const placed = new Map<number, EquippedItem>();
  const unplaced: EquippedItem[] = [];
  for (const item of cards) {
    const at = arcanaPosition(item);
    if (at !== null && !placed.has(at)) placed.set(at, item);
    else unplaced.push(item);
  }
  const byKey = new Map(cards.map((i) => [itemKey(i), i]));
  const chosenItem = chosen !== null ? (cards.find((i) => i.slot === chosen) ?? null) : null;
  const hovered = hover.shown ? (byKey.get(hover.shown.key) ?? null) : null;

  // Every equipped card is read when the tab opens and again after a Refresh hands down a
  // new loader; the loader asks for each once, and a card whose read failed waits for Retry.
  useEffect(() => {
    for (const item of cards) if (details[itemKey(item)]?.state !== 'error') onLoadItem(item);
  }, [cards, details, itemKey, onLoadItem]);

  const effects = arcanaEffects(
    cards.map((item) => {
      const lazy = details[itemKey(item)];
      return lazy?.state === 'ready' ? lazy.data : null;
    }),
  );
  const failed = cards.filter((item) => details[itemKey(item)]?.state === 'error');
  const loading = cards.some((item) => {
    const state = details[itemKey(item)]?.state;
    return state === undefined || state === 'loading';
  });

  const choose = (item: EquippedItem) => {
    hover.hide({ immediate: true, dismiss: true });
    setChosen((current) => (current === item.slot ? null : item.slot));
  };

  const card = (item: EquippedItem) => {
    const key = itemKey(item);
    const lazy = details[key];
    const selected = chosen === item.slot;
    const label = t(($) => $.equipment.itemLabel, {
      slot: slotName(item.slotName),
      name: item.name,
      enchant: item.enchant,
      breakthrough: item.breakthrough,
    });
    return (
      <ArcanaCard
        item={item}
        category={lazy?.data?.category ?? ''}
        slot={slotName(item.slotName)}
        state={lazy?.state ?? 'loading'}
        selected={selected}
        label={lazy?.state === 'error' ? t(($) => $.arcana.failedCard, { label }) : label}
        // The pinned card's detail is already beside the cards.
        trigger={selected ? {} : hover.trigger(key)}
        onChoose={() => choose(item)}
      />
    );
  };

  const detail = chosenItem && (
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

  return (
    <TabBody
      detail={detail}
      onEscape={() =>
        hover.shown ? hover.hide({ immediate: true, dismiss: true }) : setChosen(null)
      }
    >
      {cards.length === 0 ? (
        <p className="m-0 text-sm text-ink-3">{t(($) => $.arcana.empty)}</p>
      ) : (
        // The tab's own height bounds the effects: beside the cards they scroll in their
        // column, and stacked under them they keep the rest of the tab (never less than a
        // short list), so a long list never stretches the cards' area.
        <div className="h-full @container">
          <div className="grid h-full grid-rows-[auto_minmax(12rem,1fr)] items-start gap-4 @min-[38rem]:grid-cols-[minmax(0,1fr)_14.5rem] @min-[38rem]:grid-rows-[minmax(0,1fr)]">
            <section aria-label={t(($) => $.arcana.cards)} className="min-w-0">
              <ul className="m-0 mx-auto grid w-full max-w-xl list-none grid-cols-6 gap-x-3 gap-y-2 px-2 pt-1 pb-4">
                {ARCANA_SLOTS.map((at) => {
                  const item = placed.get(at);
                  return (
                    <li
                      key={at}
                      className={cn(
                        'col-span-2 motion-safe:transition-[rotate,translate] motion-safe:duration-300 motion-safe:ease-grow',
                        PLACE[at],
                        item && 'focus-within:rotate-0 hover:rotate-0',
                      )}
                    >
                      {item ? card(item) : <EmptyCard slot={slotName(`Arcana${at}`)} />}
                    </li>
                  );
                })}
              </ul>
              {unplaced.length > 0 && (
                <ul className="m-0 mx-auto grid w-full max-w-xl list-none grid-cols-3 gap-3 px-2 pb-4">
                  {unplaced.map((item) => (
                    <li key={itemKey(item)}>{card(item)}</li>
                  ))}
                </ul>
              )}
            </section>
            <EffectsPanel
              effects={effects}
              loading={loading}
              failed={failed.length}
              onRetry={() => {
                for (const item of failed) onLoadItem(item, true);
              }}
            />
          </div>
        </div>
      )}
      <HoverPopover
        popover={hover.popover}
        label={t(($) => $.equipment.detailLabel, { name: hovered?.name ?? '' })}
      >
        {hovered && (
          <ItemDetailView
            item={hovered}
            detail={details[itemKey(hovered)]}
            onRetry={() => onLoadItem(hovered, true)}
          />
        )}
        <p className="m-0 mt-2.5 border-t border-line-soft pt-2 text-2xs text-ink-4">
          {t(($) => $.arcana.chooseHint)}
        </p>
      </HoverPopover>
    </TabBody>
  );
}

/**
 * One card: the original art whole in a frame edged by its grade, the enchant level as a
 * coin on its lower edge (`+0` too, as the game prints it), then its name and slot.
 */
function ArcanaCard({
  item,
  category,
  slot,
  state,
  selected,
  label,
  trigger,
  onChoose,
}: {
  item: EquippedItem;
  category: string;
  slot: string;
  state: Lazy<ItemDetail>['state'];
  selected: boolean;
  label: string;
  trigger: Partial<ReturnType<ReturnType<typeof useHoverPopover>['trigger']>>;
  onChoose: () => void;
}) {
  const grade = gradeStyle(item.grade);
  return (
    <Pressable
      {...trigger}
      aria-pressed={selected}
      aria-label={label}
      onClick={onChoose}
      className={cn(
        'group relative block w-full rounded-md transition duration-200',
        'motion-safe:hover:-translate-y-1 motion-safe:focus-visible:-translate-y-1',
      )}
    >
      <span
        className={cn(
          'flex flex-col rounded-md border-2 bg-linear-to-b from-surface-3 via-surface-2 to-sunken p-1 shadow-2 transition-shadow duration-200',
          grade.edge,
          selected ? 'shadow-glow' : 'group-hover:shadow-glow',
        )}
      >
        <span className="relative block">
          <span className="block aspect-square overflow-hidden rounded-sm border border-shade/70 bg-sunken">
            <OfficialArt
              url={item.icon}
              size={160}
              fill
              fallback={<span className="text-xl">{initial(item.name)}</span>}
            />
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-full left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 bg-shade text-sm font-semibold text-ink shadow-2 figures',
              '@min-[30rem]:size-10 @min-[30rem]:text-base',
              grade.edge,
            )}
          >
            +{item.enchant}
          </span>
          {state !== 'ready' && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 grid place-items-center rounded-full bg-shade/85 p-0.5"
            >
              {state === 'error' ? (
                <Icon name="warning" size={12} className="text-warn" />
              ) : (
                <Icon name="loader" size={12} className="animate-spin text-ink-3" />
              )}
            </span>
          )}
        </span>
        <span className="flex min-h-12 flex-col items-center justify-start px-0.5 pt-5 pb-1 text-center @min-[30rem]:pt-6">
          <span className={cn('line-clamp-2 text-xs leading-tight font-semibold', grade.ink)}>
            {item.name}
          </span>
          <span className="mt-0.5 block max-w-full truncate text-3xs text-ink-3">
            {category ? `${slot} · ${category}` : slot}
          </span>
          {item.breakthrough > 0 && (
            <span aria-hidden="true" className="mt-1 flex h-1.5 gap-0.5">
              {Array.from({ length: item.breakthrough }, (_, i) => (
                <span key={i} className="size-1.5 rotate-45 bg-ember" />
              ))}
            </span>
          )}
        </span>
      </span>
    </Pressable>
  );
}

/** A slot with no card: its outline and its name, so the five stay in place. */
function EmptyCard({ slot }: { slot: string }) {
  const { t } = useTranslation('profile');
  return (
    <div className="flex flex-col rounded-md border-2 border-dashed border-line p-1 text-ink-4">
      <span className="grid aspect-square place-items-center rounded-sm bg-sunken/60">
        <Icon name="card" size={22} />
      </span>
      <span className="flex min-h-12 flex-col items-center px-0.5 pt-2 pb-1 text-center">
        <span className="text-xs font-semibold">{t(($) => $.arcana.emptySlot)}</span>
        <span className="mt-0.5 text-3xs">{slot}</span>
      </span>
    </div>
  );
}

/** What the cards add up to, and what is still unknown about it. */
function EffectsPanel({
  effects,
  loading,
  failed,
  onRetry,
}: {
  effects: ArcanaEffects;
  loading: boolean;
  failed: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation('profile');
  const fmt = useFormat();
  const figure = fmt.numberWith({ maximumFractionDigits: 2 });
  const partial = effects.read < effects.equipped;
  const nothingYet = effects.read === 0 && loading;
  return (
    <section
      aria-label={t(($) => $.arcana.effectsLabel)}
      aria-busy={loading}
      className="flex max-h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-md border border-line-soft bg-surface-2 p-3"
    >
      {partial && (
        <div className="flex flex-col gap-1.5 text-2xs text-ink-3">
          <p className="m-0 flex items-center gap-1.5">
            {loading && <Icon name="loader" size={12} className="animate-spin" />}
            {t(($) => $.arcana.partial, { read: effects.read, equipped: effects.equipped })}
          </p>
          {failed > 0 && (
            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-warn">
              <span>{t(($) => $.arcana.failed, { count: failed })}</span>
              <Button size="xs" icon={<Icon name="refresh" size={12} />} onClick={onRetry}>
                {t(($) => $.actions.retry)}
              </Button>
            </p>
          )}
        </div>
      )}

      <section>
        <SectionTitle className="justify-center border-b border-line-soft pb-1.5">
          {t(($) => $.arcana.effects)}
        </SectionTitle>
        {nothingYet ? (
          <EmptyState
            compact
            icon={<Icon name="loader" size={16} className="animate-spin" />}
            title={t(($) => $.arcana.reading)}
          />
        ) : effects.stats.length === 0 && effects.skills.length === 0 ? (
          effects.read > 0 && (
            <p className="m-0 text-xs text-ink-3">{t(($) => $.arcana.noEffects)}</p>
          )
        ) : (
          <>
            {effects.stats.length > 0 && (
              <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-xs">
                {effects.stats.map((s) => (
                  <div key={s.key} className="contents">
                    <dt className="py-1 text-ink-2">{s.name}</dt>
                    <dd className="m-0 py-1 text-right font-semibold text-ink figures">
                      {figure.format(s.total)}
                      {s.unit}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {effects.skills.length > 0 && (
              <ul className="m-0 mt-1 flex list-none flex-col p-0">
                {effects.skills.map((s) => (
                  <li key={s.key} className="flex items-center gap-2 py-1 text-xs">
                    <OfficialArt
                      url={s.icon}
                      size={18}
                      fallback={initial(s.name)}
                      className="rounded-xs"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink-2">{s.name}</span>
                    {s.levels !== null && (
                      <span className="text-accent figures">
                        {t(($) => $.arcana.skillLevel, { levels: s.levels })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {(effects.sets.length > 0 || (effects.read > 0 && !partial)) && (
        <section>
          <SectionTitle className="justify-center border-b border-line-soft pb-1.5">
            {t(($) => $.arcana.sets)}
          </SectionTitle>
          {effects.sets.length === 0 ? (
            <p className="m-0 text-xs text-ink-3">{t(($) => $.arcana.noSets)}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {effects.sets.map((set) => (
                <li key={set.key}>
                  <p className="m-0 text-sm leading-tight font-semibold text-accent">{set.name}</p>
                  <p className="m-0 mt-0.5 text-2xs text-ink-3 figures">
                    {set.official
                      ? t(($) => $.arcana.setWorn, { count: set.count })
                      : t(($) => $.arcana.setRead, { count: set.count })}
                  </p>
                  <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                    {set.bonuses.map((b, i) => (
                      <li
                        key={i}
                        className={cn('flex gap-2 text-xs', b.active ? 'text-ink-2' : 'text-ink-4')}
                      >
                        {b.degree !== null && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-0.5 grid size-4 shrink-0 rotate-45 place-items-center rounded-xs border',
                              b.active
                                ? 'border-accent-line bg-accent-soft text-accent-ink'
                                : 'border-line text-ink-4',
                            )}
                          >
                            <span className="-rotate-45 text-3xs font-semibold figures">
                              {b.degree}
                            </span>
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="sr-only">
                            {b.degree !== null
                              ? t(($) => $.item.setBonus, { count: b.degree })
                              : t(($) => $.item.setBonusAny)}
                            {', '}
                            {b.active ? t(($) => $.item.setActive) : t(($) => $.arcana.setInactive)}
                            {': '}
                          </span>
                          {b.descriptions.map((d, j) => (
                            <span key={j} className="block">
                              {d}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
