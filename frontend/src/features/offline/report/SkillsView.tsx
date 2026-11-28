import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Chip } from '../../../components/ui/Chip';
import { Meter } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { SearchInput } from '../../../components/ui/Field';
import { Icon } from '../../../components/ui/Icon';
import { Pressable } from '../../../components/ui/Pressable';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { UNKNOWN, type Formatters } from '../../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import type { SkillCharge } from '../../../types/offline';
import {
  critRate,
  damageTaken,
  flagRate,
  key,
  multiRate,
  skillStatsFromEvents,
  type PositionalFlag,
  type SkillRow,
  type TakenRow,
} from '../analysis';
import {
  DEFAULT_METRICS,
  DEFAULT_ORDER,
  METRIC_GROUPS,
  parseMetrics,
  sameMetrics,
  searchSkills,
  skillTable,
  sortOptions,
  sortSkills,
  visibleColumns,
  type MetricGroup,
  type SkillKind,
  type SkillOrder,
  type SkillSort,
} from '../breakdown';
import { BossActivity } from './BossActivity';
import { BuffAnalysis } from './BuffAnalysis';
import { BuffSidebar } from './BuffSidebar';
import { useReport, type DetailKind } from './context';
import { FightMoments } from './Moments';
import { Figure, InlineSelect, Note, SkillArt, SubHeading, ViewStack, ViewTools } from './parts';
import { PlayerSummary, PlayerTabs } from './PlayerTabs';
import { CastCount, PartyComparison, TargetSplit } from './PlayerViews';
import { SkillDetail } from './SkillDetail';
import {
  arrangeTaken,
  DEFAULT_TAKEN_ORDER,
  TAKEN_SORTS,
  TakenRows,
  type TakenOrder,
  type TakenSort,
} from './TakenRows';
import { TimeRange } from './TimeRange';

/** The reader's choice of metric groups, kept on this computer between sessions. */
const METRICS_KEY = 'aion-companion.report.skill-metrics';
const readMetrics = () => {
  try {
    return parseMetrics(localStorage.getItem(METRICS_KEY));
  } catch {
    return [...DEFAULT_METRICS];
  }
};

function chargeText(t: Translate<'reports'>, fmt: Formatters, charge: SkillCharge | null) {
  if (charge === null) return UNKNOWN;
  if (typeof charge === 'number') return t(($) => $.skills.chargeLevel, { level: charge });
  return Object.entries(charge)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, count]) =>
      t(($) => $.skills.chargeLevelCount, { level, times: fmt.number.format(count) }),
    )
    .join(' ');
}

/** One optional figure of a skill row; `key` is its column key in `METRIC_COLUMNS`. */
interface Metric {
  key: string;
  label: string;
  title?: string;
  /** The value needs two tracks of the figure grid in this row. */
  wide?: (row: SkillRow) => boolean;
  render: (row: SkillRow) => ReactNode;
}

/**
 * Combat details of one player: who, their whole-fight output, the fight's key moments, the
 * window's clock with their activity on the boss, then one breakdown beside the buffs they
 * carried. The breakdown is their damage or healing by skill, or the damage they took by
 * source: a skill row is the skill's original art, its full name, its value and its share,
 * with the chosen metric groups as labelled figures beneath; nothing scrolls sideways.
 * Pressing a row unfolds its hit detail in place, where the specialties native reported
 * also live. The party's figures for the same breakdown unfold from the toolbar, and the
 * full buff analysis opens from the buffs.
 */
export function SkillsView() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { report, player, names, window, setWindow, total, details, setDetails } = ctx;
  const [target, setTarget] = useState('');
  const kind = details.kind;
  const setKind = (next: DetailKind) => setDetails({ kind: next });
  // The skill rows read damage or healing; damage taken has rows of its own.
  const skillKind: SkillKind = kind === 'heal' ? 'heal' : 'damage';
  const [takenOrder, setTakenOrder] = useState<TakenOrder>(DEFAULT_TAKEN_ORDER);
  const [query, setQuery] = useState('');
  const [showCastOnly, setShowCastOnly] = useState(false);
  const [metrics, setMetrics] = useState<MetricGroup[]>(readMetrics);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [order, setOrder] = useState<SkillOrder>(DEFAULT_ORDER);
  // The opened skill belongs to one player; switching players closes it.
  const [selection, setSelection] = useState<{ player: string; skill: string } | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const metricsPanel = useId();
  const partyPanel = useId();
  const windowed = window.from > 0 || window.to < total;
  const filtered = windowed || target !== '';
  const targetId =
    player && target ? (player.targets.find((x) => key(x.id) === target)?.id ?? null) : null;
  const table = useMemo(() => {
    if (!player) return { output: [], castOnly: [] };
    const derived = filtered
      ? skillStatsFromEvents(
          report,
          {
            source: player.id,
            target: targetId,
            window: windowed ? window : null,
            kind: skillKind,
          },
          names,
        )
      : null;
    return skillTable(player, skillKind, derived);
  }, [player, filtered, targetId, skillKind, report, window, windowed, names]);
  // What the player took is always read from the recorded events of the window.
  const taken = useMemo(
    () =>
      player && kind === 'taken' ? damageTaken(report, player.id, windowed ? window : null) : [],
    [player, kind, report, window, windowed],
  );
  const deathMarks = useMemo(
    () =>
      report.events
        .filter((event) => event.kind === 'death')
        .map((event) => ({
          at: event.at_ms,
          kind: 'death' as const,
          label: t(($) => $.timeline.death),
        })),
    [report.events, t],
  );
  const selected =
    selection && player && selection.player === key(player.id) ? selection.skill : null;
  // The detail unfolds under its row: keep it in view when a row near the edge is opened.
  useEffect(() => {
    if (selected !== null) detail.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!player)
    return (
      <EmptyState title={t(($) => $.skills.noPlayers)} icon={<Icon name="sprout" size={20} />} />
    );
  const choose = (next: MetricGroup[]) => {
    setMetrics(next);
    try {
      localStorage.setItem(METRICS_KEY, JSON.stringify(next));
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  };
  const toggle = (row: Pick<SkillRow, 'id'>) =>
    setSelection(selected === key(row.id) ? null : { player: key(player.id), skill: key(row.id) });
  const label = (r: Pick<SkillRow, 'id' | 'name'>) => names.skill(r.id, r.name);
  const value = (r: SkillRow) => (skillKind === 'damage' ? r.damage : r.healing);
  const valueLabel =
    kind === 'taken'
      ? t(($) => $.columns.taken)
      : kind === 'damage'
        ? t(($) => $.columns.damage)
        : t(($) => $.columns.healing);
  const takenLabel = (r: TakenRow) =>
    `${names.skill(r.skill)} ${r.source === null ? '' : names.entity(r.source)}`;
  const takenRows = arrangeTaken(taken, query, takenOrder, takenLabel);
  const takenSortLabel = (sort: TakenSort) =>
    sort === 'value'
      ? t(($) => $.columns.taken)
      : sort === 'name'
        ? t(($) => $.skills.orderName)
        : sort === 'hits'
          ? t(($) => $.columns.hits)
          : t(($) => $.columns.biggest);
  const span = Math.max(0.001, (windowed ? window.to - window.from : report.duration_ms) / 1000);

  // An order by a figure that no longer shows falls back to the ranking by value.
  const orders = sortOptions(metrics);
  const activeOrder = orders.includes(order.key) ? order : DEFAULT_ORDER;
  const listed = showCastOnly ? [...table.output, ...table.castOnly] : table.output;
  const found = sortSkills(searchSkills(listed, query, label), activeOrder, skillKind, label);
  const nativeSkill = (id: string) => player.skills.find((s) => key(s.id) === id) ?? null;
  // An opened skill stays in the list through a search or a cast-only choice that would
  // drop it, so its detail never loses its row.
  const openedRow =
    selected === null
      ? null
      : ([...table.output, ...table.castOnly].find((r) => key(r.id) === selected) ?? null);
  const rows = openedRow && !found.includes(openedRow) ? [...found, openedRow] : found;
  // A target or window that leaves the opened skill nothing keeps its detail, which says so.
  const outside = selected !== null && !openedRow ? nativeSkill(selected) : null;
  const flags = player.flags_observed !== null || rows.some((r) => r.flags_observed);

  const flagMetric = (flag: PositionalFlag): Metric => ({
    key: flag,
    label: t(($) => $.skills.flag[flag]),
    title: t(($) => $.skills.flagTitle[flag]),
    render: (r) => fmt.pct(flagRate(r, flag)),
  });
  const allMetrics: Metric[] = [
    {
      key: 'ps',
      label: skillKind === 'damage' ? 'DPS' : 'HPS',
      title: t(($) => $.skills.metricTitle.pace),
      render: (r) => fmt.number.format(value(r) / span),
    },
    {
      key: 'casts',
      label: t(($) => $.columns.casts),
      title: t(($) => $.skills.castsTitle),
      wide: (r) => !!r.inferred_casts,
      render: (r) => <CastCount casts={r.casts} inferred={r.inferred_casts} />,
    },
    {
      key: 'hits',
      label: t(($) => $.columns.hits),
      title: t(($) => $.skills.hitsTitle),
      render: (r) => fmt.maybe(r.hits),
    },
    {
      key: 'direct',
      label: t(($) => $.skills.direct),
      title: t(($) => $.skills.directTitle),
      render: (r) => fmt.maybe(r.direct_hits),
    },
    {
      key: 'crit',
      label: t(($) => $.columns.crit),
      title: t(($) => $.damage.critTitle),
      render: (r) => fmt.pct(critRate(r)),
    },
    flagMetric('back'),
    flagMetric('front'),
    flagMetric('perfect'),
    flagMetric('double'),
    flagMetric('parry'),
    {
      key: 'multi',
      label: t(($) => $.skills.multi),
      title: t(($) => $.skills.multiTitle),
      render: (r) => fmt.pct(multiRate(r)),
    },
    { key: 'min', label: t(($) => $.skills.min), render: (r) => fmt.maybe(r.min) },
    { key: 'avg', label: t(($) => $.columns.avg), render: (r) => fmt.maybe(r.avg) },
    {
      key: 'max',
      label: t(($) => $.skills.max),
      render: (r) => (r.hits ? fmt.maybe(r.max) : UNKNOWN),
    },
    {
      key: 'gap',
      label: t(($) => $.skills.gap),
      title: t(($) => $.skills.gapTitle),
      render: (r) => fmt.seconds(r.cast_gap_ms),
    },
    {
      key: 'charge',
      label: t(($) => $.skills.charge),
      title: t(($) => $.skills.chargeTitle),
      wide: (r) => r.charge !== null && typeof r.charge !== 'number',
      render: (r) => chargeText(t, fmt, r.charge),
    },
  ];
  const shown = visibleColumns(metrics);
  const figures = allMetrics.filter((metric) => shown.has(metric.key));
  // Position and special-hit rates are the ones that need decoded hit flags.
  const flagMetrics = metrics.includes('position') || metrics.includes('special');
  const orderLabel = (sort: SkillSort) =>
    sort === 'value'
      ? valueLabel
      : sort === 'name'
        ? t(($) => $.skills.orderName)
        : (allMetrics.find((metric) => metric.key === sort)?.label ?? sort);
  const openDetail = (skill: Pick<SkillRow, 'id' | 'name' | 'specialties'>) => (
    <div
      ref={detail}
      data-ui="skill-detail"
      className="border-t border-line-soft px-2.5 pt-3 pb-4 @3xl:pl-14.5"
    >
      <SkillDetail
        key={key(skill.id)}
        row={skill}
        native={nativeSkill(key(skill.id))}
        kind={skillKind}
        target={targetId}
        filtered={filtered}
        onClose={() => setSelection(null)}
      />
    </div>
  );

  const activeDesc = kind === 'taken' ? takenOrder.desc : activeOrder.desc;
  const reverse = () =>
    kind === 'taken'
      ? setTakenOrder({ key: takenOrder.key, desc: !takenOrder.desc })
      : setOrder({ key: activeOrder.key, desc: !activeOrder.desc });
  const partyTitle =
    kind === 'taken'
      ? t(($) => $.taken.table)
      : kind === 'heal'
        ? t(($) => $.healing.table)
        : t(($) => $.damage.table);
  const count = kind === 'taken' ? takenRows.length : rows.length;
  const fromEvents = kind === 'taken' || filtered;

  return (
    <ViewStack className="gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        <PlayerTabs />
        <PlayerSummary player={player} />
      </div>
      {/* The fight on its clock: its key moments, the window, then the player's activity on
          the boss within it. */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <FightMoments />
        <TimeRange compact total={total} window={window} onChange={setWindow} marks={deathMarks} />
        <BossActivity />
      </div>
      <div className="@container min-w-0">
        <div className="flex min-w-0 flex-col gap-2.5">
          <ViewTools className="gap-x-3">
            <SegmentedControl
              size="sm"
              label={t(($) => $.skills.kind)}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'damage', label: t(($) => $.columns.damage) },
                {
                  value: 'heal',
                  label: t(($) => $.columns.healing),
                  disabled: player.healing <= 0,
                },
                { value: 'taken', label: t(($) => $.skills.kindTaken) },
              ]}
            />
            <SearchInput
              size="sm"
              wrapperClassName="w-44 max-w-full"
              aria-label={t(($) => $.skills.search)}
              placeholder={t(($) => $.skills.searchPlaceholder)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {kind !== 'taken' && (
              <InlineSelect
                label={t(($) => $.skills.target)}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{t(($) => $.skills.allTargets)}</option>
                {player.targets
                  .filter((x) => x.damage > 0 || x.healing > 0)
                  .map((x) => (
                    <option key={key(x.id)} value={key(x.id)}>
                      {x.name ?? names.entity(x.id)}
                    </option>
                  ))}
              </InlineSelect>
            )}
            <span className="inline-flex min-w-0 items-center gap-1">
              {kind === 'taken' ? (
                <InlineSelect
                  label={t(($) => $.skills.order)}
                  value={takenOrder.key}
                  onChange={(e) => {
                    const next = e.target.value as TakenSort;
                    setTakenOrder({ key: next, desc: next !== 'name' });
                  }}
                >
                  {TAKEN_SORTS.map((sort) => (
                    <option key={sort} value={sort}>
                      {takenSortLabel(sort)}
                    </option>
                  ))}
                </InlineSelect>
              ) : (
                <InlineSelect
                  label={t(($) => $.skills.order)}
                  value={activeOrder.key}
                  onChange={(e) => {
                    const next = e.target.value as SkillSort;
                    // Names read from A; figures from the largest.
                    setOrder({ key: next, desc: next !== 'name' });
                  }}
                >
                  {orders.map((sort) => (
                    <option key={sort} value={sort}>
                      {orderLabel(sort)}
                    </option>
                  ))}
                </InlineSelect>
              )}
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label={
                  activeDesc
                    ? t(($) => $.skills.orderDescending)
                    : t(($) => $.skills.orderAscending)
                }
                title={t(($) => $.skills.orderReverse)}
                onClick={reverse}
              >
                <Icon name={activeDesc ? 'arrowDown' : 'arrowUp'} size={12} />
              </Button>
            </span>
            {kind !== 'taken' && (
              <>
                <Chip
                  pressed={showCastOnly}
                  onPressedChange={setShowCastOnly}
                  count={fmt.integer.format(table.castOnly.length)}
                  disabled={!table.castOnly.length}
                  title={t(($) => $.skills.castOnlyTitle)}
                >
                  {t(($) => $.skills.castOnly)}
                </Chip>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Icon name="sliders" size={12} />}
                  aria-expanded={metricsOpen}
                  aria-controls={metricsPanel}
                  title={t(($) => $.skills.metricsTitle)}
                  onClick={() => setMetricsOpen(!metricsOpen)}
                >
                  {t(($) => $.skills.metrics)}
                  <span className="text-ink-3 figures">
                    {fmt.integer.format(metrics.length)}/{fmt.integer.format(METRIC_GROUPS.length)}
                  </span>
                </Button>
              </>
            )}
            {/* The same breakdown for every player, a press away. */}
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              icon={<Icon name="group" size={12} />}
              aria-expanded={details.party}
              aria-controls={partyPanel}
              title={t(($) => $.party.compareTitle)}
              onClick={() => setDetails({ party: !details.party })}
            >
              {t(($) => $.party.compare)}
              <Icon name={details.party ? 'chevronUp' : 'chevronDown'} size={12} />
            </Button>
          </ViewTools>
          <div id={metricsPanel} className="empty:hidden">
            {metricsOpen && kind !== 'taken' && (
              <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0">
                <legend className="sr-only">{t(($) => $.skills.metricsLegend)}</legend>
                {METRIC_GROUPS.map((group) => (
                  <Chip
                    key={group}
                    size="xs"
                    pressed={metrics.includes(group)}
                    onPressedChange={(pressed) =>
                      choose(
                        METRIC_GROUPS.filter((g) => (g === group ? pressed : metrics.includes(g))),
                      )
                    }
                    title={t(($) => $.skills.metricTitle[group])}
                  >
                    {t(($) => $.skills.metric[group])}
                  </Chip>
                ))}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={sameMetrics(metrics, DEFAULT_METRICS)}
                  title={t(($) => $.skills.metricsDefaultTitle)}
                  onClick={() => choose([...DEFAULT_METRICS])}
                >
                  {t(($) => $.skills.metricsDefault)}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={metrics.length === METRIC_GROUPS.length}
                  title={t(($) => $.skills.metricsAllTitle)}
                  onClick={() => choose([...METRIC_GROUPS])}
                >
                  {t(($) => $.skills.metricsAll)}
                </Button>
              </fieldset>
            )}
          </div>
          <div id={partyPanel} className="empty:hidden">
            {details.party && (
              <section
                data-ui="party-comparison"
                aria-label={t(($) => $.party.label)}
                className="flex min-w-0 flex-col gap-2 border-y border-line-soft py-3"
              >
                <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <SubHeading className="mb-0">{partyTitle}</SubHeading>
                  <Note>{t(($) => $.party.note)}</Note>
                </header>
                <PartyComparison kind={kind} />
              </section>
            )}
          </div>
          {kind !== 'taken' && !flags && flagMetrics && <Note>{t(($) => $.skills.noFlags)}</Note>}
          {/* The breakdown and the buffs the player carried, read side by side. */}
          <div className="grid items-start gap-x-6 gap-y-5 @4xl:grid-cols-[minmax(0,1fr)_18rem] @6xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 px-2.5 pb-1.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  {kind === 'taken'
                    ? t(($) => $.taken.count, { count })
                    : t(($) => $.skills.count, { count })}
                  <Badge
                    shape="tag"
                    variant="outline"
                    className={cn(
                      'tracking-normal normal-case',
                      fromEvents && 'border-dashed text-ink-3',
                    )}
                    title={
                      fromEvents
                        ? t(($) => $.skills.fromEventsTitle)
                        : t(($) => $.skills.totalsTitle)
                    }
                  >
                    {fromEvents ? t(($) => $.skills.fromEvents) : t(($) => $.skills.totals)}
                  </Badge>
                </span>
                <span aria-hidden="true" className="flex shrink-0 items-baseline gap-3">
                  <span>{valueLabel}</span>
                  <span className="w-14 text-right">{t(($) => $.columns.share)}</span>
                </span>
              </div>
              {kind === 'taken' ? (
                <TakenRows player={player} rows={takenRows} all={taken} windowed={windowed} />
              ) : (
                <>
                  <ul
                    data-ui="skill-rows"
                    aria-label={t(($) => $.skills.table, { name: names.entity(player.id) })}
                    className="m-0 list-none border-y border-line-soft p-0"
                  >
                    {rows.map((r) => {
                      const id = key(r.id);
                      const open = selected === id;
                      const name = label(r);
                      return (
                        <li
                          key={id}
                          data-ui="skill-row"
                          data-open={open || undefined}
                          className="border-b border-line-soft last:border-b-0 data-open:shadow-[inset_2px_0_0_var(--color-accent)]"
                        >
                          {/* A press anywhere on the row opens its detail; the name beneath is
                                the keyboard and reader path to the same thing. */}
                          {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer shortcut for the name button */}
                          <div
                            className={cn(
                              'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-2.5 py-2.5',
                              'transition-colors duration-100 hover:bg-row-hover',
                              open && 'bg-row-selected hover:bg-row-selected',
                            )}
                            onClick={() => toggle(r)}
                          >
                            <SkillArt id={r.id} name={name} />
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-baseline gap-3">
                                <Pressable
                                  className="min-w-0 rounded-sm text-md leading-snug font-semibold wrap-anywhere text-ink hover:text-accent-strong aria-expanded:text-accent"
                                  aria-expanded={open}
                                  title={t(($) => $.skills.openDetail, { name })}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggle(r);
                                  }}
                                >
                                  {name}
                                </Pressable>
                                <span className="ml-auto flex shrink-0 items-baseline gap-3 figures">
                                  <span className="text-md font-semibold text-ink">
                                    <span className="sr-only">{valueLabel} </span>
                                    {fmt.number.format(value(r))}
                                  </span>
                                  <span className="w-14 text-right text-sm text-ink-2">
                                    <span className="sr-only">{t(($) => $.columns.share)} </span>
                                    {fmt.pct(r.share)}
                                  </span>
                                </span>
                              </div>
                              <Meter
                                className="mt-1.5 flex w-full"
                                fraction={r.share}
                                color={ctx.colorOf(player)}
                                label={t(($) => $.player.shareMeter, { name })}
                              />
                              {figures.length > 0 && (
                                <dl className="m-0 mt-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-1 text-sm">
                                  {figures.map((metric) => (
                                    <Figure
                                      key={metric.key}
                                      label={metric.label}
                                      title={metric.title}
                                      wide={metric.wide?.(r) ?? false}
                                    >
                                      {metric.render(r)}
                                    </Figure>
                                  ))}
                                </dl>
                              )}
                            </div>
                          </div>
                          {open && openDetail(nativeSkill(id) ?? r)}
                        </li>
                      );
                    })}
                    {outside && (
                      <li
                        data-ui="skill-row"
                        data-open
                        className="shadow-[inset_2px_0_0_var(--color-accent)]"
                      >
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 bg-row-selected px-2.5 py-2.5">
                          <SkillArt id={outside.id} name={label(outside)} />
                          <div className="min-w-0">
                            <div className="text-md leading-snug font-semibold wrap-anywhere text-accent">
                              {label(outside)}
                            </div>
                            <Note>{t(($) => $.skills.outside)}</Note>
                          </div>
                        </div>
                        {openDetail(outside)}
                      </li>
                    )}
                  </ul>
                  {!rows.length &&
                    !outside &&
                    (listed.length ? (
                      <EmptyState
                        compact
                        title={t(($) => $.skills.noMatchTitle)}
                        icon={<Icon name="search" size={18} />}
                      >
                        {t(($) => $.skills.noMatchBody)}
                      </EmptyState>
                    ) : (
                      <EmptyState
                        compact
                        title={t(($) => $.skills.emptyTitle)}
                        icon={<Icon name="binoculars" size={18} />}
                      >
                        {t(($) => $.skills.emptyBody)}
                      </EmptyState>
                    ))}
                </>
              )}
            </div>
            {/* Beside the rows: what the player carried, then who their output went to. */}
            <div className="flex min-h-0 min-w-0 flex-col gap-3 @4xl:sticky @4xl:top-28 @4xl:max-h-[calc(100vh-9rem)]">
              <BuffSidebar />
              {kind !== 'taken' && (
                <TargetSplit
                  player={player}
                  field={kind === 'heal' ? 'healing' : 'damage'}
                  title={
                    kind === 'heal' ? t(($) => $.healing.byRecipient) : t(($) => $.damage.byTarget)
                  }
                  className="shrink-0 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5"
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <BuffAnalysis />
    </ViewStack>
  );
}
