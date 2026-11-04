import { useEffect, useState } from 'react';
import { HoverCard, useHoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { Pressable } from '../../components/ui/Pressable';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { Board, ItemDetail, Skill } from '../../types/profile';
import { skillBonuses, skillGroups } from './model';
import {
  DetailPanel,
  Facts,
  OfficialArt,
  SectionTitle,
  TabBody,
  Unavailable,
  initial,
} from './parts';

/**
 * Words for a skill's level. Learned is the service's `acquired` flag alone: a learned skill
 * may be at level 0 (a stigma learned but not raised), and an unsent level is said to be
 * unknown, never taken as 0.
 */
function useSkillLevel() {
  const { t } = useTranslation('profile');
  return {
    long: (skill: Skill) =>
      skill.level !== null
        ? t(($) => $.skills.level, { level: skill.level })
        : t(($) => $.skills.levelUnknown),
    short: (skill: Skill) =>
      skill.level !== null
        ? t(($) => $.skills.levelShort, { level: skill.level })
        : t(($) => $.skills.levelUnknownShort),
  };
}

/** A skill as an icon with its level beneath; an unlearned one is dimmed with its lock. */
function SkillTile({
  skill,
  selected,
  characterLevel,
  onChoose,
  trigger,
}: {
  skill: Skill;
  selected: boolean;
  characterLevel: number | null;
  onChoose: () => void;
  trigger: ReturnType<ReturnType<typeof useHoverCard>['trigger']>;
}) {
  const { t } = useTranslation('profile');
  const level = useSkillLevel();
  const learned = skill.acquired;
  const tooLow = characterLevel !== null && characterLevel < skill.needLevel;
  return (
    <Pressable
      {...trigger}
      aria-pressed={selected}
      data-learned={learned || undefined}
      aria-label={t(($) => $.skills.tileLabel, {
        name: skill.name,
        state: learned ? level.long(skill) : t(($) => $.skills.notLearned),
      })}
      className={cn(
        'group flex w-14 flex-col items-center gap-0.5 rounded-sm p-1 hover:bg-row-hover',
        selected && 'bg-row-selected',
      )}
      onClick={onChoose}
    >
      <span
        className={cn(
          'relative rounded-sm border',
          skill.equipped ? 'border-accent-line' : 'border-line',
          selected && 'border-accent',
        )}
      >
        <OfficialArt
          url={skill.icon}
          size={40}
          fallback={initial(skill.name)}
          className={cn('rounded-xs', !learned && 'opacity-40 grayscale')}
        />
        {!learned && (
          <span className="absolute inset-0 flex items-center justify-center text-ink-2">
            <Icon name="lock" size={14} />
          </span>
        )}
        {skill.equipped && skill.category === 'stigma' && (
          <span
            className="absolute -top-1 -right-1 rounded-xs bg-accent px-0.5 text-4xs leading-tight font-bold text-accent-ink"
            aria-hidden="true"
          >
            {t(($) => $.skills.equippedMark)}
          </span>
        )}
      </span>
      <span
        className={cn(
          'text-3xs leading-tight figures',
          learned ? 'text-ink-2' : tooLow ? 'text-warn' : 'text-ink-4',
        )}
      >
        {learned ? level.short(skill) : t(($) => $.skills.needShort, { level: skill.needLevel })}
      </span>
    </Pressable>
  );
}

/**
 * Active, passive and stigma skills from the official list: level, learned and slotted
 * state and the level that unlocks each, with the level bonuses the official boards and
 * items name. NCSOFT's public services publish no skill descriptions, costs, cooldowns,
 * ranges or specialties, and not which specialties a character chose, so the detail says
 * so instead of showing any.
 */
export function SkillsTab({
  skills,
  characterLevel,
  boards,
  items,
  boardsLoading = false,
  onLoadBonuses,
}: {
  skills: Skill[];
  characterLevel: number | null;
  /** Boards already read, by name, for the level bonuses they grant. */
  boards: { name: string; board: Board }[];
  /** Item details already read, for their skill options. */
  items: ItemDetail[];
  /** True while an open board asked for by `onLoadBonuses` is not read yet. */
  boardsLoading?: boolean;
  /**
   * Reads the character's open boards while a skill's detail is shown. Keep it stable; a
   * new function (after a Refresh) reads them again.
   */
  onLoadBonuses?: (() => void) | undefined;
}) {
  const { t } = useTranslation('profile');
  const level = useSkillLevel();
  const hover = useHoverCard();
  const [chosen, setChosen] = useState<number | null>(null);
  const groups = skillGroups(skills);
  const byId = new Map(skills.map((s) => [s.id, s]));
  const skill = chosen !== null ? byId.get(chosen) : undefined;
  const preview = hover.shown ? byId.get(Number(hover.shown.key)) : undefined;
  const choose = (id: number) => setChosen((c) => (c === id ? null : id));
  const open = skill !== undefined;

  // An open detail reads the boards its bonuses come from, and again after a Refresh (which
  // hands down a new loader); the loader asks for each board once.
  useEffect(() => {
    if (open) onLoadBonuses?.();
  }, [open, onLoadBonuses]);

  const grid = (list: Skill[]) => (
    <ul className="m-0 flex list-none flex-wrap gap-0.5 p-0">
      {list.map((s) => (
        <li key={s.id}>
          <SkillTile
            skill={s}
            selected={chosen === s.id}
            characterLevel={characterLevel}
            trigger={hover.trigger(String(s.id))}
            onChoose={() => choose(s.id)}
          />
        </li>
      ))}
    </ul>
  );

  const bonuses = skill ? skillBonuses(skill, boards, items) : [];
  const learned = skill?.acquired ?? false;
  const detail = skill && (
    <DetailPanel
      label={t(($) => $.skills.detailLabel, { name: skill.name })}
      closeLabel={t(($) => $.actions.closeDetail)}
      onClose={() => setChosen(null)}
    >
      <article className="flex flex-col gap-2.5">
        <header className="flex items-start gap-2.5 pr-6">
          <OfficialArt
            url={skill.icon}
            size={48}
            fallback={initial(skill.name)}
            className={cn('rounded-sm', !learned && 'opacity-50 grayscale')}
          />
          <div className="min-w-0">
            <h3 className="m-0 text-md leading-tight font-semibold text-ink">{skill.name}</h3>
            <p className="m-0 mt-0.5 text-xs text-ink-3">
              {t(($) => $.skills.categoryName[skill.category as 'active'], {
                defaultValue: skill.category,
              })}
            </p>
          </div>
        </header>
        <Facts
          rows={[
            [
              t(($) => $.skills.facts.level),
              learned
                ? (skill.level ?? t(($) => $.skills.levelUnknown))
                : t(($) => $.skills.notLearned),
            ],
            [t(($) => $.skills.facts.needLevel), skill.needLevel],
            [
              t(($) => $.skills.facts.state),
              [
                skill.equipped ? t(($) => $.skills.equipped) : null,
                skill.acquired ? t(($) => $.skills.acquired) : t(($) => $.skills.notAcquired),
              ]
                .filter(Boolean)
                .join(' · '),
            ],
          ]}
        />
        <Unavailable>{t(($) => $.skills.unpublished)}</Unavailable>
        <p className="m-0 text-2xs text-ink-4">{t(($) => $.skills.specialtiesUnknown)}</p>
        <section className="border-t border-line-soft pt-2.5">
          <SectionTitle>{t(($) => $.skills.bonuses)}</SectionTitle>
          {bonuses.length ? (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
              {bonuses.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-ink-2">
                    {b.kind === 'board'
                      ? t(($) => $.skills.fromBoard, { board: b.source })
                      : t(($) => $.skills.fromItem, { item: b.source })}
                  </span>
                  <span className="text-accent figures">+{b.levels}</span>
                </li>
              ))}
            </ul>
          ) : boardsLoading ? null : (
            <p className="m-0 text-xs text-ink-4">{t(($) => $.skills.noBonuses)}</p>
          )}
          {boardsLoading && (
            <output className="m-0 mt-1 flex items-center gap-1.5 text-2xs text-ink-3">
              <Icon name="loader" size={12} className="animate-spin" />
              {t(($) => $.skills.bonusesLoading)}
            </output>
          )}
          <p className="m-0 mt-1 text-2xs text-ink-4">{t(($) => $.skills.bonusesScope)}</p>
        </section>
      </article>
    </DetailPanel>
  );

  const stigmaCount =
    groups.stigma.equipped.length + groups.stigma.learned.length + groups.stigma.locked.length;
  return (
    <TabBody detail={detail} onEscape={() => setChosen(null)}>
      <div className="flex flex-col gap-4">
        {skills.length === 0 && (
          <p className="m-0 text-sm text-ink-3">{t(($) => $.skills.empty)}</p>
        )}
        {groups.active.length > 0 && (
          <section aria-label={t(($) => $.skills.active)}>
            <SectionTitle count={groups.active.length}>{t(($) => $.skills.active)}</SectionTitle>
            {grid(groups.active)}
          </section>
        )}
        {groups.passive.length > 0 && (
          <section aria-label={t(($) => $.skills.passive)}>
            <SectionTitle count={groups.passive.length}>{t(($) => $.skills.passive)}</SectionTitle>
            {grid(groups.passive)}
          </section>
        )}
        {stigmaCount > 0 && (
          <section aria-label={t(($) => $.skills.stigma)}>
            <SectionTitle count={stigmaCount}>{t(($) => $.skills.stigma)}</SectionTitle>
            {(
              [
                ['equipped', groups.stigma.equipped],
                ['learned', groups.stigma.learned],
                ['locked', groups.stigma.locked],
              ] as const
            )
              .filter(([, list]) => list.length > 0)
              .map(([key, list]) => (
                <div key={key} className="mb-2">
                  <p className="m-0 mb-0.5 text-2xs text-ink-3">
                    {t(($) => $.skills.stigmaGroups[key])}{' '}
                    <span className="text-ink-4 figures">{list.length}</span>
                  </p>
                  {grid(list)}
                </div>
              ))}
          </section>
        )}
        {groups.other.length > 0 && (
          <section aria-label={t(($) => $.skills.other)}>
            <SectionTitle count={groups.other.length}>{t(($) => $.skills.other)}</SectionTitle>
            {grid(groups.other)}
          </section>
        )}
      </div>
      <HoverCard id={hover.id} anchor={preview ? (hover.shown?.anchor ?? null) : null} side="top">
        {preview && (
          <span className="flex max-w-72 flex-col gap-0.5 text-xs">
            <b className="font-semibold text-ink">{preview.name}</b>
            <span className="text-ink-3 figures">
              {preview.acquired
                ? level.long(preview)
                : t(($) => $.skills.needLevel, { level: preview.needLevel })}
              {preview.equipped && ` · ${t(($) => $.skills.equipped)}`}
            </span>
          </span>
        )}
      </HoverCard>
    </TabBody>
  );
}
