import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { KeyValueList, type KeyValue } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { tableCell, tableHead, tableRow, tableScroll } from '../../../components/ui/Table';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import type { EntityId, ReportSkill, SkillSpecialty } from '../../../types/offline';
import { critRate, rate, type PositionalFlag, type SkillRow } from '../analysis';
import {
  detailStart,
  hitHas,
  hitResults,
  paginate,
  skillHits,
  summarizeHits,
  type HitResult,
  type SkillKind,
} from '../breakdown';
import { useReport } from './context';
import { InlineSelect, Note, SubHeading, ViewTools } from './parts';
import { CastCount } from './PlayerViews';

const PAGE = 50;
const FLAGS = ['critical', 'back', 'front', 'perfect', 'double', 'parry', 'tick'] as const;
const POSITIONAL: readonly PositionalFlag[] = ['back', 'front', 'perfect', 'double', 'parry'];

/**
 * The specialties native reported for a skill, as it reported them: the slot, then the name
 * and description when the catalogue has them, or the game's own variant choice number when
 * it does not. Nothing here is decoded or guessed beyond that.
 */
function Specialties({ items }: { items: SkillSpecialty[] }) {
  const { t } = useTranslation('reports');
  return (
    <div data-ui="specialties">
      <SubHeading className="mb-0.5">{t(($) => $.skills.detail.specialties)}</SubHeading>
      <Note className="mb-2.5">{t(($) => $.skills.detail.specialtiesNote)}</Note>
      <div className="flex flex-col gap-1.5 text-sm">
        {items.map((item, index) => (
          <div key={index} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {item.slot !== null && (
              <Badge shape="tag" variant="outline" title={t(($) => $.skills.detail.slot)}>
                S{item.slot}
              </Badge>
            )}
            {item.name && <span className="min-w-0 wrap-anywhere text-ink">{item.name}</span>}
            {item.count !== null && (
              <span className="text-xs text-ink-3 figures">
                {t(($) => $.skills.uses, { count: item.count })}
              </span>
            )}
            {item.description && (
              <span className="basis-full text-xs leading-snug text-ink-3">{item.description}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One skill of the selected player, hit by hit, unfolded under its row. Two sets of figures
 * sit side by side and never mix: the fight totals native counted over the whole fight, and
 * the hits this report actually holds in detail for the selection (target, time window, and
 * for a live report only its latest events). The specialties native reported for the skill
 * sit beside them; the hit list takes the other half on a wide row.
 */
export function SkillDetail({
  row,
  native,
  kind,
  target,
  filtered,
  onClose,
}: {
  /** The skill as its row names it; name and specialties come from native's catalogue. */
  row: Pick<SkillRow, 'id' | 'name' | 'specialties'>;
  /** Native's whole-fight row of this skill, when it has one. */
  native: ReportSkill | null;
  kind: SkillKind;
  target: EntityId | null;
  /** A target or time filter narrows the selection. */
  filtered: boolean;
  onClose: () => void;
}) {
  const { report, player, names, window, total, scopeTargets, goTo } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const [result, setResult] = useState<HitResult | ''>('');
  const [order, setOrder] = useState<'time' | 'amount'>('time');
  const [pageState, setPageState] = useState({ filter: '', page: 0 });
  const windowed = window.from > 0 || window.to < total;
  const source = player?.id ?? null;

  const hits = useMemo(
    () =>
      source === null
        ? []
        : skillHits(report, {
            source,
            skill: row.id,
            kind,
            target,
            window: windowed ? window : null,
            // The report's target scope, as in the skill rows: a Bosses read lists boss hits.
            scope: scopeTargets,
          }),
    [report, source, row.id, kind, target, window, windowed, scopeTargets],
  );
  const summary = useMemo(() => summarizeHits(hits), [hits]);
  const results = useMemo(() => hitResults(hits), [hits]);
  // A result that no longer occurs (another window, a live refresh) filters nothing.
  const chosen = result && results.includes(result) ? result : '';
  const listed = useMemo(() => {
    const matching = chosen ? hits.filter((hit) => hitHas(hit, chosen)) : hits;
    return order === 'amount'
      ? [...matching].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      : matching;
  }, [hits, chosen, order]);
  // Changing any filter returns to the first page.
  const filterKey = `${chosen}|${order}|${window.from}|${window.to}|${String(target)}`;
  const paged = paginate(listed, pageState.filter === filterKey ? pageState.page : 0, PAGE);
  const setPage = (page: number) => setPageState({ filter: filterKey, page });

  const name = names.skill(row.id, row.name);
  const value = (skill: Pick<ReportSkill, 'damage' | 'healing'>) =>
    kind === 'damage' ? skill.damage : skill.healing;
  const valueLabel = kind === 'damage' ? t(($) => $.columns.damage) : t(($) => $.columns.healing);
  // Native counts one hit per event. Damage has its own counter; `hits` counts a skill's
  // damage and healing together, so its heals are what the damage counter leaves.
  const fightHits = !native
    ? null
    : kind === 'damage'
      ? (native.damage_hits ?? native.hits)
      : native.hits !== null && native.damage_hits !== null
        ? native.hits - native.damage_hits
        : native.hits;
  const first = hits[0]?.at_ms;
  const truncatedFrom = detailStart(report);
  const truncated = report.events_truncated && truncatedFrom > 0;
  const partial =
    // Fewer hits in detail than native counted, in the same target scope. Never the reverse,
    // which would say nothing about missing detail.
    !filtered && !truncated && fightHits !== null && summary.count < fightHits
      ? { listed: fmt.integer.format(summary.count), total: fmt.integer.format(fightHits) }
      : null;
  const ofObserved = (count: number, observed: number) =>
    observed > 0
      ? t(($) => $.skills.detail.ofObserved, {
          hits: fmt.integer.format(count),
          observed: fmt.integer.format(observed),
          rate: fmt.pct(rate(count, observed)),
        })
      : UNKNOWN;

  const fightTotals: (KeyValue | false)[] = native
    ? [
        { label: valueLabel, value: fmt.number.format(value(native)) },
        {
          label: t(($) => $.columns.casts),
          title: t(($) => $.skills.castsTitle),
          value: <CastCount casts={native.casts} inferred={native.inferred_casts} />,
        },
        {
          label: t(($) => $.columns.hits),
          title: t(($) => $.skills.hitsTitle),
          value: fmt.maybe(fightHits),
        },
        {
          label: t(($) => $.skills.direct),
          title: t(($) => $.skills.directTitle),
          value: fmt.maybe(native.direct_hits),
        },
        {
          label: t(($) => $.columns.crit),
          title: t(($) => $.damage.critTitle),
          value:
            critRate(native) === null
              ? UNKNOWN
              : ofObserved(native.crits ?? 0, native.critical_hits_observed ?? 0),
        },
        { label: t(($) => $.skills.min), value: fmt.maybe(native.min) },
        { label: t(($) => $.columns.avg), value: fmt.maybe(native.avg) },
        { label: t(($) => $.skills.max), value: native.hits ? fmt.maybe(native.max) : UNKNOWN },
      ]
    : [];
  const recorded: (KeyValue | false)[] = [
    { label: valueLabel, value: fmt.number.format(summary.total) },
    {
      label: t(($) => $.columns.hits),
      title: t(($) => $.skills.hitsTitle),
      value:
        summary.ticks > 0
          ? `${fmt.integer.format(summary.count)} · ${t(($) => $.skills.detail.directTicks, {
              direct: fmt.integer.format(summary.direct),
              ticks: fmt.integer.format(summary.ticks),
            })}`
          : fmt.integer.format(summary.count),
    },
    {
      label: t(($) => $.columns.crit),
      title: t(($) => $.damage.critTitle),
      value: ofObserved(summary.crits, summary.critObserved),
    },
    ...POSITIONAL.map(
      (flag): KeyValue | false =>
        summary.flagsObserved > 0 && {
          label: t(($) => $.skills.flag[flag]),
          title: t(($) => $.skills.flagTitle[flag]),
          value: ofObserved(summary[flag], summary.flagsObserved),
        },
    ),
    summary.multi > 0 && {
      label: t(($) => $.skills.multi),
      title: t(($) => $.skills.multiTitle),
      value: ofObserved(summary.multi, summary.direct),
    },
    { label: t(($) => $.skills.min), value: fmt.maybe(summary.min) },
    { label: t(($) => $.columns.avg), value: fmt.maybe(summary.avg) },
    { label: t(($) => $.skills.max), value: fmt.maybe(summary.max) },
  ];
  const cell = cn(tableCell, 'px-2 py-1.5 text-left');
  const specialties = native?.specialties ?? row.specialties;

  return (
    <section className="@container min-w-0" aria-label={t(($) => $.skills.detail.label, { name })}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h4 className="m-0 text-sm font-semibold text-ink">{t(($) => $.skills.detail.title)}</h4>
        <span className="flex flex-wrap items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => goTo('rotation', first)}>
            {t(($) => $.tabs.rotation)}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => goTo('timeline', first)}>
            {t(($) => $.tabs.timeline)}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={t(($) => $.skills.detail.close)}
            title={t(($) => $.skills.detail.close)}
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </Button>
        </span>
      </header>
      <div className="grid items-start gap-x-10 gap-y-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-x-6 gap-y-5">
            {native && (
              <div>
                <SubHeading className="mb-0.5">{t(($) => $.skills.detail.fightTotals)}</SubHeading>
                <Note className="mb-2.5">{t(($) => $.skills.detail.fightTotalsNote)}</Note>
                <KeyValueList items={fightTotals} />
              </div>
            )}
            <div>
              <SubHeading className="mb-0.5">{t(($) => $.skills.detail.recorded)}</SubHeading>
              <Note className="mb-2.5">{t(($) => $.skills.detail.recordedNote)}</Note>
              <KeyValueList items={recorded} />
            </div>
            {specialties.length > 0 && <Specialties items={specialties} />}
          </div>
          {truncated && (
            <Note className="mt-4 max-w-3xl">
              {t(($) => $.skills.detail.truncated, { start: fmt.preciseClock(truncatedFrom) })}
            </Note>
          )}
          {partial && (
            <Note className="mt-4 max-w-3xl">{t(($) => $.skills.detail.partial, partial)}</Note>
          )}
        </div>
        <div className="min-w-0">
          <ViewTools className="mb-2.5">
            <InlineSelect
              label={t(($) => $.skills.detail.result)}
              value={chosen}
              onChange={(e) => setResult(e.target.value as HitResult | '')}
            >
              <option value="">{t(($) => $.skills.detail.allHits)}</option>
              {results.map((option) => (
                <option key={option} value={option}>
                  {t(($) => $.skills.detail.resultOption[option])} (
                  {fmt.integer.format(hits.filter((hit) => hitHas(hit, option)).length)})
                </option>
              ))}
            </InlineSelect>
            <SegmentedControl
              size="sm"
              label={t(($) => $.skills.detail.order)}
              value={order}
              onChange={setOrder}
              options={[
                { value: 'time', label: t(($) => $.skills.detail.byTime) },
                { value: 'amount', label: t(($) => $.skills.detail.byAmount) },
              ]}
            />
            <span className="ml-auto text-xs text-ink-3 figures" aria-live="polite">
              {paged.pages > 1
                ? t(($) => $.skills.detail.hitsPaged, {
                    count: listed.length,
                    page: fmt.integer.format(paged.page + 1),
                    pages: fmt.integer.format(paged.pages),
                  })
                : t(($) => $.skills.detail.hits, { count: listed.length })}
            </span>
          </ViewTools>
          <div className={cn(tableScroll, 'max-h-110 overflow-auto')}>
            <table
              data-ui="table"
              className="w-full border-collapse text-sm figures"
              aria-label={t(($) => $.skills.detail.table, { name })}
            >
              <thead>
                <tr>
                  <th scope="col" className={cn(tableHead, 'px-2 py-1.5 text-left')}>
                    {t(($) => $.timeline.column.time)}
                  </th>
                  <th scope="col" className={cn(tableHead, 'px-2 py-1.5 text-left')}>
                    {t(($) => $.timeline.column.target)}
                  </th>
                  <th scope="col" className={cn(tableHead, 'px-2 py-1.5 text-right')}>
                    {t(($) => $.timeline.column.amount)}
                  </th>
                  <th scope="col" className={cn(tableHead, 'px-2 py-1.5 text-left')}>
                    {t(($) => $.timeline.column.flags)}
                  </th>
                  <th scope="col" className={cn(tableHead, 'w-8 px-2 py-1.5')}>
                    <span className="sr-only">{t(($) => $.tabs.timeline)}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((hit, index) => (
                  <tr key={`${hit.at_ms}-${index}`} className={tableRow}>
                    <td className={cell}>{fmt.preciseClock(hit.at_ms)}</td>
                    <td className={cell}>
                      {hit.target !== null && hit.target !== undefined
                        ? names.entity(hit.target)
                        : UNKNOWN}
                    </td>
                    <td className={cn(cell, 'text-right')}>{fmt.number.format(hit.amount ?? 0)}</td>
                    <td className={cell}>
                      <span className="inline-flex gap-1">
                        {FLAGS.filter((flag) => hit[flag] === true).map((flag) => (
                          <Badge
                            key={flag}
                            shape="tag"
                            variant="outline"
                            tone={flag === 'critical' ? 'warn' : 'neutral'}
                          >
                            {t(($) => $.timeline.flag[flag])}
                          </Badge>
                        ))}
                        {(hit.hit_count ?? 1) > 1 && (
                          <Badge shape="tag" variant="outline">
                            ×{fmt.integer.format(hit.hit_count ?? 1)}
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className={cn(cell, 'py-0.5 text-right')}>
                      <Button
                        size="xs"
                        variant="ghost"
                        iconOnly
                        aria-label={t(($) => $.skills.detail.timelineAt, {
                          time: fmt.preciseClock(hit.at_ms),
                        })}
                        title={t(($) => $.showOnTimeline)}
                        onClick={() => goTo('timeline', hit.at_ms)}
                      >
                        <Icon name="activity" size={12} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!listed.length && (
              <EmptyState
                compact
                title={t(($) => $.skills.detail.emptyTitle)}
                icon={<Icon name="binoculars" size={18} />}
              >
                {t(($) => $.skills.detail.emptyBody)}
              </EmptyState>
            )}
          </div>
          {paged.pages > 1 && (
            <div className="mt-2.5 flex items-center justify-center gap-3 text-xs text-ink-3 figures">
              <Button size="xs" disabled={paged.page === 0} onClick={() => setPage(paged.page - 1)}>
                {t(($) => $.timeline.previous)}
              </Button>
              <span>
                {fmt.integer.format(paged.page + 1)} / {fmt.integer.format(paged.pages)}
              </span>
              <Button
                size="xs"
                disabled={paged.page >= paged.pages - 1}
                onClick={() => setPage(paged.page + 1)}
              >
                {t(($) => $.timeline.next)}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
