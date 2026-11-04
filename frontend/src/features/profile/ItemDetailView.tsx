import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { Companion, EquippedItem, ItemDetail, ItemStat, Lazy } from '../../types/profile';
import { gradeStyle } from './model';
import { ErrorLine } from './states';
import {
  Facts,
  GradeArt,
  GradeWord,
  OfficialArt,
  SectionTitle,
  Unavailable,
  initial,
} from './parts';

/** One block of the detail, under a caps title. */
function Block({
  title,
  count,
  children,
}: {
  title: ReactNode;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line-soft pt-2.5">
      <SectionTitle count={count}>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** `Attack 287 ~ 395 (+119)`: the rolled range, then the enchant bonus in the accent. */
function StatLine({ stat }: { stat: ItemStat }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="text-ink-2">{stat.name}</span>
      <span className="text-right text-ink figures">
        {stat.min ? `${stat.min} ~ ${stat.value}` : stat.value}
        {stat.extra && <span className="ml-1 text-accent">(+{stat.extra})</span>}
      </span>
    </li>
  );
}

/** Yes/no facts as words with a mark, never colour alone. */
function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-px text-2xs',
        on ? 'border-line text-ink-2' : 'border-line-soft text-ink-4 line-through',
      )}
    >
      <Icon name={on ? 'check' : 'close'} size={10} />
      {label}
    </li>
  );
}

/** The item as this character has it, in the order the game's own tooltip reads. */
export function ItemDetailView({
  item,
  detail,
  onRetry,
}: {
  item: EquippedItem;
  detail: Lazy<ItemDetail> | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation('profile');
  const fmt = useFormat();
  const data = detail?.data ?? null;
  const name = data?.name || item.name;
  const grade = data?.grade || item.grade;
  const accessory = data?.type === 'Accessory';
  const main = data?.mainStats.filter((s) => !s.breakthrough) ?? [];
  const exceed = data?.mainStats.filter((s) => s.breakthrough) ?? [];
  const flags = data
    ? (
        [
          ['storable', data.flags.storable],
          ['storableGuild', data.flags.storableGuild],
          ['tradable', data.flags.tradable],
          ['tradablePersonal', data.flags.tradablePersonal],
          ['enchantable', data.flags.enchantable],
          ['decomposable', data.flags.decomposable],
        ] as const
      ).filter((f): f is [(typeof f)[0], boolean] => f[1] !== null)
    : [];
  const facts: [ReactNode, ReactNode][] = [];
  const add = (show: unknown, term: ReactNode, value: ReactNode) => {
    if (show) facts.push([term, value]);
  };
  if (data) {
    add(
      data.level !== null,
      t(($) => $.item.level),
      <>
        {data.level}
        {data.levelBonus ? <span className="text-accent"> (+{data.levelBonus})</span> : null}
      </>,
    );
    add(
      data.maxEnchant !== null,
      t(($) => $.item.enchant),
      t(($) => $.item.ofMax, { value: item.enchant, max: data.maxEnchant ?? 0 }),
    );
    add(
      (data.maxBreakthrough ?? 0) > 0,
      t(($) => $.item.breakthrough),
      t(($) => $.item.ofMax, { value: item.breakthrough, max: data.maxBreakthrough ?? 0 }),
    );
    add(
      data.safeEnchant !== null,
      t(($) => $.item.safeEnchant),
      data.safeEnchant,
    );
    add(
      (data.equipLevel ?? 0) > 1,
      data.type === 'Usable' ? t(($) => $.item.useLevel) : t(($) => $.item.equipLevel),
      data.equipLevel,
    );
    add(
      data.race,
      t(($) => $.item.race),
      data.race,
    );
    add(
      data.classes.length > 0,
      t(($) => $.item.classes),
      fmt.list(data.classes),
    );
    add(
      data.soulBindRate,
      t(($) => $.item.soulBind),
      t(($) => $.item.percent, { value: data.soulBindRate ?? '' }),
    );
    const { durationMin: min, durationMax: max } = data;
    add(
      min !== null || max !== null,
      t(($) => $.item.duration),
      min !== null && max !== null
        ? `${fmt.integer.format(min)} ~ ${fmt.integer.format(max)}`
        : fmt.maybe(min ?? max, fmt.integer),
    );
    add(
      data.coolTime !== null,
      t(($) => $.item.coolTime),
      fmt.maybe(data.coolTime, fmt.integer),
    );
  }
  return (
    <article className="flex flex-col gap-2.5" aria-busy={!detail || detail.state === 'loading'}>
      <header className="flex items-start gap-2.5 pr-6">
        <GradeArt
          url={data?.icon ?? item.icon}
          name={name}
          grade={grade}
          size={52}
          enchant={item.enchant}
          breakthrough={item.breakthrough}
        />
        <div className="min-w-0">
          <h3 className={cn('m-0 text-md leading-tight font-semibold', gradeStyle(grade).ink)}>
            {name}
          </h3>
          <p className="m-0 mt-0.5 text-xs text-ink-3">
            <GradeWord grade={grade} />
            {data?.category && <> · {data.category}</>}
          </p>
          <p className="m-0 mt-0.5 text-xs text-ink-2 figures">
            {t(($) => $.item.enchantLine, { enchant: item.enchant })}
            {item.breakthrough > 0 && (
              <> · {t(($) => $.item.breakthroughLine, { count: item.breakthrough })}</>
            )}
          </p>
        </div>
      </header>

      {(!detail || detail.state === 'loading') && !data && (
        <EmptyState
          compact
          icon={<Icon name="loader" size={16} className="animate-spin" />}
          title={t(($) => $.item.loading)}
        />
      )}
      {detail?.state === 'error' && (
        <ErrorLine error={detail.error} onRetry={onRetry} what={t(($) => $.item.what)} />
      )}

      {data && (
        <>
          <Facts rows={facts} />

          {main.length > 0 && (
            <Block title={t(($) => $.item.mainStats)}>
              <ul className="m-0 list-none p-0">
                {main.map((s, i) => (
                  <StatLine key={`${s.id}${i}`} stat={s} />
                ))}
              </ul>
            </Block>
          )}

          {exceed.length > 0 && (
            <Block title={t(($) => $.item.breakthroughBonus)}>
              <ul className="m-0 list-none p-0">
                {exceed.map((s, i) => (
                  <li key={`${s.id}${i}`} className="flex justify-between gap-3 py-0.5 text-xs">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <span className="size-1.5 rotate-45 bg-ember" aria-hidden="true" />
                      {s.name}
                    </span>
                    <span className="text-ember-ink figures">+{s.extra ?? s.value}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {(data.subStats.length > 0 || data.subSkills.length > 0) && (
            <Block
              title={t(($) => $.item.subStats)}
              count={
                data.subStatCount !== null && data.subStats.length > 0
                  ? t(($) => $.item.ofMax, { value: data.subStats.length, max: data.subStatCount })
                  : undefined
              }
            >
              {data.subStatRandom && data.subStats.length > 0 && (
                <p className="m-0 mb-1 text-2xs text-ink-3">{t(($) => $.item.subStatsRandom)}</p>
              )}
              <ul className="m-0 list-none p-0">
                {data.subStats.map((s, i) => (
                  <StatLine key={`${s.id}${i}`} stat={s} />
                ))}
              </ul>
              {data.subSkills.length > 0 && (
                <>
                  <p className="m-0 mt-2 mb-1 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
                    {t(($) => $.item.subSkills)}
                    {data.subSkillMax !== null && (
                      <span className="ml-1.5 text-ink-4 figures">
                        {t(($) => $.item.ofMax, {
                          value: data.subSkills.length,
                          max: data.subSkillMax,
                        })}
                      </span>
                    )}
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {data.subSkills.map((s, i) => (
                      <li key={`${s.name}${i}`} className="flex items-center gap-2 text-xs">
                        <OfficialArt
                          url={s.icon}
                          size={20}
                          fallback={initial(s.name)}
                          className="rounded-xs"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink-2">{s.name}</span>
                        {s.level !== null && (
                          <span className="text-accent figures">+{s.level}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Block>
          )}

          {(data.sockets.length > 0 || (data.socketSlots ?? 0) > 0) && (
            <Block
              title={accessory ? t(($) => $.item.soulStones) : t(($) => $.item.manastones)}
              count={
                data.socketSlots !== null
                  ? t(($) => $.item.ofMax, { value: data.sockets.length, max: data.socketSlots })
                  : undefined
              }
            >
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.sockets.map((s) => (
                  <li key={s.slot} className="flex items-center gap-2 text-xs">
                    <OfficialArt
                      url={s.icon}
                      size={20}
                      fallback={initial(s.name)}
                      className="rounded-xs"
                    />
                    <span className={cn('min-w-0 flex-1 truncate', gradeStyle(s.grade).ink)}>
                      {s.name}
                    </span>
                    <GradeWord grade={s.grade} className="text-2xs font-normal" />
                    <span className="w-10 text-right text-ink figures">{s.value}</span>
                  </li>
                ))}
                {Array.from(
                  { length: Math.max(0, (data.socketSlots ?? 0) - data.sockets.length) },
                  (_, i) => (
                    <li key={`empty${i}`} className="flex items-center gap-2 text-xs text-ink-4">
                      <span
                        className="size-5 rounded-xs border border-dashed border-line"
                        aria-hidden="true"
                      />
                      {t(($) => $.item.emptySocket)}
                    </li>
                  ),
                )}
              </ul>
            </Block>
          )}

          {(data.godstones.length > 0 || (data.godstoneSlots ?? 0) > 0) && (
            <Block
              title={t(($) => $.item.godstones)}
              count={
                data.godstoneSlots !== null
                  ? t(($) => $.item.ofMax, {
                      value: data.godstones.length,
                      max: data.godstoneSlots,
                    })
                  : undefined
              }
            >
              {data.godstones.length === 0 ? (
                <p className="m-0 text-xs text-ink-4">{t(($) => $.item.noGodstone)}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {data.godstones.map((g, i) => (
                    <li key={`${g.name}${i}`} className="flex gap-2 text-xs">
                      <OfficialArt
                        url={g.icon}
                        size={24}
                        fallback={initial(g.name)}
                        className="rounded-xs"
                      />
                      <span className="min-w-0">
                        <b className={cn('font-semibold', gradeStyle(g.grade).ink)}>{g.name}</b>
                        {g.description && (
                          <span className="block whitespace-pre-line text-ink-2">
                            {g.description}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          )}

          {data.set && (
            <Block
              title={t(($) => $.item.set)}
              count={
                data.set.equippedCount !== null
                  ? t(($) => $.item.ofMax, {
                      value: data.set.equippedCount,
                      max: data.set.items.length,
                    })
                  : undefined
              }
            >
              {data.set.name && (
                <p className="m-0 mb-1 text-sm font-semibold text-ink">{data.set.name}</p>
              )}
              <ul className="m-0 mb-2 flex list-none flex-col gap-0.5 p-0">
                {data.set.items.map((piece, i) => (
                  <li
                    key={`${piece.name}${i}`}
                    className={cn(
                      'flex items-center gap-1.5 text-xs',
                      piece.equipped ? 'text-ink' : 'text-ink-4',
                    )}
                  >
                    <Icon name={piece.equipped ? 'check' : 'minus'} size={11} />
                    <span className={cn(piece.equipped && gradeStyle(piece.grade).ink)}>
                      {piece.name}
                    </span>
                    <span className="sr-only">
                      {piece.equipped ? t(($) => $.item.setWorn) : t(($) => $.item.setMissing)}
                    </span>
                  </li>
                ))}
              </ul>
              {data.set.bonuses.map((b, i) => {
                const active =
                  b.degree !== null &&
                  data.set?.equippedCount != null &&
                  data.set.equippedCount >= b.degree;
                return (
                  <div key={i} className="mt-1 text-xs">
                    <p
                      className={cn(
                        'm-0 text-2xs font-semibold tracking-caps uppercase',
                        active ? 'text-accent' : 'text-ink-4',
                      )}
                    >
                      {b.degree !== null
                        ? t(($) => $.item.setBonus, { count: b.degree })
                        : t(($) => $.item.setBonusAny)}
                      {active && (
                        <span className="ml-1.5 normal-case">· {t(($) => $.item.setActive)}</span>
                      )}
                    </p>
                    {b.descriptions.map((d, j) => (
                      <p key={j} className={cn('m-0', active ? 'text-ink-2' : 'text-ink-4')}>
                        {d}
                      </p>
                    ))}
                  </div>
                );
              })}
            </Block>
          )}

          {data.description && (
            <Block title={t(($) => $.item.description)}>
              <p className="m-0 text-xs whitespace-pre-line text-ink-2">{data.description}</p>
            </Block>
          )}

          {data.costumes.length > 0 && (
            <Block title={t(($) => $.item.costumes)}>
              <p className="m-0 text-xs text-ink-2">{fmt.list(data.costumes)}</p>
            </Block>
          )}

          {data.sources.length > 0 && (
            <Block title={t(($) => $.item.sources)}>
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                {data.sources.map((s) => (
                  <li
                    key={s}
                    className="rounded-xs border border-line px-1.5 py-px text-2xs text-ink-2"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {flags.length > 0 && (
            <Block title={t(($) => $.item.handling)}>
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                {flags.map(([key, on]) => (
                  <Flag key={key} on={on} label={t(($) => $.item.flags[key])} />
                ))}
              </ul>
            </Block>
          )}

          {data.other.length > 0 && (
            <Block title={t(($) => $.item.other)}>
              <Facts rows={data.other.map(([k, v]) => [k, v])} />
            </Block>
          )}

          <div className="flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              icon={<Icon name="refresh" size={12} />}
              onClick={onRetry}
            >
              {t(($) => $.item.reload)}
            </Button>
          </div>
        </>
      )}
    </article>
  );
}

/** A pet, wing or appearance item: the official service publishes only what the list shows. */
export function PlainDetail({
  kind,
  name,
  icon,
  grade,
  facts,
}: {
  kind: string;
  name: string;
  icon: string | null;
  grade: string | null;
  facts: [ReactNode, ReactNode][];
}) {
  const { t } = useTranslation('profile');
  return (
    <article className="flex flex-col gap-2.5">
      <header className="flex items-start gap-2.5 pr-6">
        <GradeArt url={icon} name={name} grade={grade} size={52} />
        <div className="min-w-0">
          <h3 className={cn('m-0 text-md leading-tight font-semibold', gradeStyle(grade).ink)}>
            {name}
          </h3>
          <p className="m-0 mt-0.5 text-xs text-ink-3">
            {kind}
            {grade && (
              <>
                {' · '}
                <GradeWord grade={grade} />
              </>
            )}
          </p>
        </div>
      </header>
      <Facts rows={facts} />
      <Unavailable>{t(($) => $.item.noDetail)}</Unavailable>
    </article>
  );
}

export const companionFacts = (
  companion: Companion,
  t: ReturnType<typeof useTranslation<'profile'>>['t'],
): [ReactNode, ReactNode][] =>
  [
    companion.level !== null &&
      ([t(($) => $.item.petLevel), companion.level] as [ReactNode, ReactNode]),
    companion.enchant !== null &&
      companion.enchant > 0 &&
      ([t(($) => $.item.enchant), `+${companion.enchant}`] as [ReactNode, ReactNode]),
  ].filter((r): r is [ReactNode, ReactNode] => Array.isArray(r));
