import { useState, type ReactNode } from 'react';
import { HoverPopover, useHoverPopover } from '../../components/ui/HoverPopover';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { Companion, EquippedItem } from '../../types/profile';
import { PlainDetail, companionFacts } from './ItemDetailView';
import { DetailPanel, GradeArt, GradeWord, SectionTitle, TabBody } from './parts';
import { useSlotName } from './slots';

interface Look {
  key: string;
  name: string;
  icon: string | null;
  grade: string | null;
  slot: string;
  /** Everything the official list says about it besides its name and grade. */
  facts: [ReactNode, ReactNode][];
}

/**
 * Appearance items worn over the equipment, one per slot: the same earrings in both ears
 * are two entries. The wing appearance comes from the pet-and-wings record. Hovering or
 * focusing one shows all the official list says about it (the item service publishes no
 * detail for appearances, so nothing more is read); choosing one pins it.
 */
export function CosmeticsTab({
  skins,
  wingSkin,
}: {
  skins: EquippedItem[];
  wingSkin: Companion | null;
}) {
  const { t } = useTranslation('profile');
  const slotName = useSlotName();
  const [chosen, setChosen] = useState<string | null>(null);
  const hover = useHoverPopover();
  const looks: Look[] = [
    ...skins.map((s) => ({
      key: `slot${s.slot}`,
      name: s.name,
      icon: s.icon,
      grade: s.grade || null,
      slot: slotName(s.slotName),
      facts: [
        [t(($) => $.cosmetics.slot), slotName(s.slotName)],
        ...(s.enchant > 0 ? [[t(($) => $.item.enchant), `+${s.enchant}`]] : []),
      ] as [ReactNode, ReactNode][],
    })),
    ...(wingSkin
      ? [
          {
            key: 'wing',
            name: wingSkin.name,
            icon: wingSkin.icon,
            grade: wingSkin.grade,
            slot: t(($) => $.equipment.wingSkin),
            facts: [
              [t(($) => $.cosmetics.slot), t(($) => $.equipment.wingSkin)],
              ...companionFacts(wingSkin, t),
            ] as [ReactNode, ReactNode][],
          },
        ]
      : []),
  ];
  const look = looks.find((l) => l.key === chosen);
  const hovered = looks.find((l) => l.key === hover.shown?.key);
  const choose = (key: string) => {
    hover.hide({ immediate: true, dismiss: true });
    setChosen((current) => (current === key ? null : key));
  };
  return (
    <TabBody
      onEscape={() =>
        hover.shown ? hover.hide({ immediate: true, dismiss: true }) : setChosen(null)
      }
      detail={
        look && (
          <DetailPanel
            label={t(($) => $.equipment.detailLabel, { name: look.name })}
            closeLabel={t(($) => $.actions.closeDetail)}
            onClose={() => setChosen(null)}
          >
            <PlainDetail
              kind={t(($) => $.cosmetics.kind)}
              name={look.name}
              icon={look.icon}
              grade={look.grade}
              facts={look.facts}
            />
          </DetailPanel>
        )
      }
    >
      <section aria-label={t(($) => $.cosmetics.title)}>
        <SectionTitle count={looks.length}>{t(($) => $.cosmetics.title)}</SectionTitle>
        {looks.length === 0 ? (
          <p className="m-0 text-sm text-ink-3">{t(($) => $.cosmetics.empty)}</p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-1 p-0">
            {looks.map((l) => {
              const selected = chosen === l.key;
              return (
                <li key={l.key}>
                  <Pressable
                    {...(selected ? {} : hover.trigger(l.key))}
                    aria-pressed={selected}
                    aria-label={t(($) => $.cosmetics.itemLabel, { slot: l.slot, name: l.name })}
                    className={cn(
                      selectableRow(selected),
                      'flex w-full items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-row-hover',
                    )}
                    onClick={() => choose(l.key)}
                  >
                    <GradeArt url={l.icon} name={l.name} grade={l.grade} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-tight text-ink">
                        {l.name}
                      </span>
                      <span className="block truncate text-2xs text-ink-3">
                        {l.slot}
                        {l.grade && (
                          <>
                            {' · '}
                            <GradeWord grade={l.grade} className="font-normal" />
                          </>
                        )}
                      </span>
                    </span>
                  </Pressable>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <HoverPopover
        popover={hover.popover}
        label={t(($) => $.equipment.detailLabel, { name: hovered?.name ?? '' })}
      >
        {hovered && (
          <PlainDetail
            kind={t(($) => $.cosmetics.kind)}
            name={hovered.name}
            icon={hovered.icon}
            grade={hovered.grade}
            facts={hovered.facts}
          />
        )}
        <p className="m-0 mt-2.5 border-t border-line-soft pt-2 text-2xs text-ink-4">
          {t(($) => $.equipment.chooseHint)}
        </p>
      </HoverPopover>
    </TabBody>
  );
}
