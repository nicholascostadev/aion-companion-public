import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Swatch } from '../../components/ui/Data';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Select } from '../../components/ui/Field';
import { SkillLabel } from '../../components/ui/GameArt';
import { Panel } from '../../components/ui/Panel';
import {
  tableCell,
  tableHead,
  tableRow,
  tableScroll,
  tableSticky,
} from '../../components/ui/Table';
import { clock, UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { classColor } from '../../lib/classColors';
import type { LogMeta, OfflineSettings, ReportPlayer, ReportTotals } from '../../types/offline';
import {
  critRate,
  flagRate,
  key,
  Names,
  pairSkills,
  playerDps,
  rate,
  skillRowsFromPlayer,
} from './analysis';
import { Icon } from '../../components/ui/Icon';

const LIVE = 'live';

interface Side {
  source: string;
  player: string;
}

function useSideReport(
  source: string,
  live: ReportTotals | null,
  loadLog: (id: string) => Promise<ReportTotals>,
) {
  // `error` is raw native text; `noLive` is worded by the view.
  const [loaded, setLoaded] = useState<{ id: string; report: ReportTotals | null; error: string }>({
    id: '',
    report: null,
    error: '',
  });
  useEffect(() => {
    if (!source || source === LIVE) return;
    let cancelled = false;
    void loadLog(source).then(
      (report) => !cancelled && setLoaded({ id: source, report, error: '' }),
      (cause: unknown) =>
        !cancelled && setLoaded({ id: source, report: null, error: String(cause) }),
    );
    return () => {
      cancelled = true;
    };
  }, [source, loadLog]);
  if (source === LIVE) return { report: live, error: '', noLive: !live, loading: false };
  if (!source) return { report: null, error: '', noLive: false, loading: false };
  return {
    report: loaded.id === source ? loaded.report : null,
    error: loaded.id === source ? loaded.error : '',
    noLive: false,
    loading: loaded.id !== source,
  };
}

function delta(a: number | null, b: number | null, percent = false) {
  if (a === null || b === null) return null;
  const d = b - a;
  return { d, rel: a ? d / Math.abs(a) : null, percent };
}

function Delta({
  a,
  b,
  percent = false,
  lowerIsBetter = false,
}: {
  a: number | null;
  b: number | null;
  percent?: boolean;
  lowerIsBetter?: boolean;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const value = delta(a, b, percent);
  if (!value || value.d === 0)
    return <span className="text-ink-3 tabular-nums">{value ? '=' : UNKNOWN}</span>;
  const better = lowerIsBetter ? value.d < 0 : value.d > 0;
  const text = percent
    ? t(($) => $.compare.points, {
        value: fmt
          .numberWith({
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
            signDisplay: 'exceptZero',
          })
          .format(value.d * 100),
      })
    : fmt
        .numberWith({ notation: 'compact', maximumFractionDigits: 1, signDisplay: 'exceptZero' })
        .format(value.d);
  return (
    <span
      data-trend={better ? 'better' : 'worse'}
      className={cn(
        'inline-flex items-center justify-end gap-1 tabular-nums',
        better ? 'text-success' : 'text-danger',
      )}
    >
      <Icon name={value.d > 0 ? 'arrowUp' : 'arrowDown'} size={12} /> {text}
      {!percent && value.rel !== null && (
        <small className="text-2xs text-ink-3">({fmt.pct(value.rel, 0)})</small>
      )}
    </span>
  );
}

function SidePicker({
  label,
  side,
  onChange,
  logs,
  report,
  names,
  error,
  noLive,
}: {
  label: string;
  side: Side;
  onChange: (side: Side) => void;
  logs: LogMeta[];
  report: ReportTotals | null;
  names: Names;
  error: string;
  noLive: boolean;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const known = side.source === LIVE || logs.some((l) => l.id === side.source);
  return (
    <div className="flex min-w-0 flex-col gap-2.5 self-stretch rounded-lg border border-line-soft bg-surface-2 p-4">
      <h2 className="m-0 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-leaf border border-accent-line bg-accent-soft text-md font-semibold text-accent"
        >
          {label}
        </span>
        <span className="sr-only">{t(($) => $.compare.side, { side: label })}</span>
      </h2>
      <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-3">
        <span className="min-w-10 shrink-0">{t(($) => $.compare.fight)}</span>
        <Select
          size="sm"
          wrapperClassName="flex-1"
          className="font-normal"
          value={side.source}
          onChange={(e) => onChange({ source: e.target.value, player: '' })}
        >
          <option value="">{t(($) => $.compare.choose)}</option>
          <option value={LIVE}>{t(($) => $.compare.liveFight)}</option>
          {!known && side.source && <option value={side.source}>{side.source}</option>}
          {logs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label ?? l.boss ?? t(($) => $.library.encounter)} · {fmt.dateTime(l.started_ms)}
            </option>
          ))}
        </Select>
      </label>
      {report && (
        <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-3">
          <span className="min-w-10 shrink-0">{t(($) => $.columns.player)}</span>
          <Select
            size="sm"
            wrapperClassName="flex-1"
            className="font-normal"
            value={side.player}
            onChange={(e) => onChange({ ...side, player: e.target.value })}
          >
            {[...report.players]
              .sort((a, b) => b.damage - a.damage)
              .map((p) => (
                <option key={key(p.id)} value={key(p.id)}>
                  {names.entity(p.id)}
                  {p.class ? ` · ${p.class}` : ''}
                </option>
              ))}
          </Select>
        </label>
      )}
      {report && (
        <p className="m-0 text-xs text-ink-3">
          {clock(report.duration_ms)} ·{' '}
          {t(($) => $.library.players, { count: report.players.length })} ·{' '}
          {fmt.dateTime(report.started_ms)}
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {noLive && <Notice tone="error">{t(($) => $.compare.noLive)}</Notice>}
    </div>
  );
}

const pick = (report: ReportTotals | null, id: string) =>
  report
    ? (report.players.find((p) => key(p.id) === id) ??
      report.players.find((p) => p.local) ??
      [...report.players].sort((a, b) => b.damage - a.damage)[0] ??
      null)
    : null;

export function ComparePanel({
  live,
  logs,
  settings,
  native,
  initial,
  loadLog,
}: {
  live: ReportTotals | null;
  logs: LogMeta[];
  settings: OfflineSettings | null;
  native: boolean;
  /** Fights to open first (e.g. two logs chosen in the library). */
  initial: string[];
  loadLog: (id: string) => Promise<ReportTotals>;
}) {
  const [a, setA] = useState<Side>({ source: initial[0] ?? LIVE, player: '' });
  const [b, setB] = useState<Side>({ source: initial[1] ?? '', player: '' });
  const left = useSideReport(a.source, live, loadLog);
  const right = useSideReport(b.source, live, loadLog);
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const hideNames = settings?.hide_names ?? false;
  const namesA = useMemo(
    () => new Names(left.report, { hideNames, t }),
    [left.report, hideNames, t],
  );
  const namesB = useMemo(
    () => new Names(right.report, { hideNames, t }),
    [right.report, hideNames, t],
  );
  const pa = pick(left.report, a.player);
  const pb = pick(right.report, b.player);
  const mode = settings?.dps_mode ?? 'encounter';
  const pairs = useMemo(
    () =>
      pa && pb
        ? pairSkills(skillRowsFromPlayer(pa), skillRowsFromPlayer(pb), (row) =>
            (pa.skills.some((s) => key(s.id) === key(row.id)) ? namesA : namesB).skill(
              row.id,
              row.name,
            ),
          )
        : [],
    [pa, pb, namesA, namesB],
  );
  // Each side is marked in its class colour; a hidden local player's class stays private.
  const colorA = classColor(pa && !(hideNames && pa.local) ? pa.class : null);
  const colorB = classColor(pb && !(hideNames && pb.local) ? pb.class : null);

  if (!native)
    return <EmptyState title={t(($) => $.compare.native)} icon={<Icon name="scale" size={20} />} />;

  const metric = (
    label: string,
    get: (p: ReportPlayer, r: ReportTotals) => number | null,
    format: (v: number | null) => string,
    opts: { percent?: boolean; lowerIsBetter?: boolean } = {},
  ) => {
    const va = pa && left.report ? get(pa, left.report) : null;
    const vb = pb && right.report ? get(pb, right.report) : null;
    return (
      <tr key={label} className={tableRow}>
        <th scope="row" className={cn(tableCell, 'text-left font-medium text-ink-2')}>
          {label}
        </th>
        <td className={cn(tableCell, 'text-right')}>{format(va)}</td>
        <td className={cn(tableCell, 'text-right')}>{format(vb)}</td>
        <td className={cn(tableCell, 'text-right')}>
          <Delta a={va} b={vb} {...opts} />
        </td>
      </tr>
    );
  };
  const num = (v: number | null) => fmt.maybe(v);
  const percentOf = (v: number | null) => fmt.pct(v);

  return (
    <Panel padding="lg" className="flex flex-col gap-6">
      <div className="grid items-start gap-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SidePicker
          label="A"
          side={a}
          onChange={setA}
          logs={logs}
          report={left.report}
          names={namesA}
          error={left.error}
          noLive={left.noLive}
        />
        <Button
          iconOnly
          variant="ghost"
          className="self-center justify-self-center"
          aria-label={t(($) => $.compare.swap)}
          title={t(($) => $.compare.swap)}
          onClick={() => {
            setA(b);
            setB(a);
          }}
        >
          <Icon name="swap" />
        </Button>
        <SidePicker
          label="B"
          side={b}
          onChange={setB}
          logs={logs}
          report={right.report}
          names={namesB}
          error={right.error}
          noLive={right.noLive}
        />
      </div>
      {pa && pb && left.report && right.report ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-ink-3">
            <span className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
              <Swatch color={colorA} className="size-2.5" /> {namesA.entity(pa.id)}
            </span>
            <span className="text-2xs font-semibold tracking-caps uppercase">
              {t(($) => $.compare.versus)}
            </span>
            <span className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
              <Swatch color={colorB} className="size-2.5" /> {namesB.entity(pb.id)}
            </span>
          </div>
          <div className={tableScroll}>
            <table
              data-ui="table"
              className="w-full border-collapse text-sm tabular-nums"
              aria-label={t(($) => $.compare.players)}
            >
              <thead>
                <tr>
                  <HeadCell text>{t(($) => $.compare.metric)}</HeadCell>
                  <HeadCell>A</HeadCell>
                  <HeadCell>B</HeadCell>
                  <HeadCell>{t(($) => $.compare.bVsA)}</HeadCell>
                </tr>
              </thead>
              <tbody>
                {metric(
                  t(($) => $.compare.length),
                  (_p, r) => r.duration_ms,
                  (v) => (v === null ? UNKNOWN : clock(v)),
                  { lowerIsBetter: true },
                )}
                {metric(
                  t(($) => $.columns.damage),
                  (p) => p.damage,
                  num,
                )}
                {metric(mode === 'active' ? 'aDPS' : 'DPS', (p, r) => playerDps(p, r, mode), num)}
                {metric('eDPS', (p) => p.edps, num)}
                {metric('aDPS', (p) => p.adps, num)}
                {metric(
                  t(($) => $.columns.active),
                  (p) => p.active_pct,
                  percentOf,
                  {
                    percent: true,
                  },
                )}
                {metric(
                  t(($) => $.compare.damageShare),
                  (p, r) =>
                    rate(
                      p.damage,
                      r.players.reduce((s, x) => s + x.damage, 0),
                    ),
                  percentOf,
                  { percent: true },
                )}
                {metric(
                  t(($) => $.compare.critRate),
                  (p) => critRate(p),
                  percentOf,
                  {
                    percent: true,
                  },
                )}
                {metric(
                  t(($) => $.compare.backRate),
                  (p) => flagRate(p, 'back'),
                  percentOf,
                  {
                    percent: true,
                  },
                )}
                {metric(
                  t(($) => $.compare.perfectRate),
                  (p) => flagRate(p, 'perfect'),
                  percentOf,
                  { percent: true },
                )}
                {metric(
                  t(($) => $.columns.casts),
                  (p) => p.casts,
                  num,
                )}
                {metric(
                  t(($) => $.columns.healing),
                  (p) => p.healing,
                  num,
                )}
                {metric(
                  t(($) => $.highlights.damageTaken),
                  (p) => p.received,
                  num,
                  {
                    lowerIsBetter: true,
                  },
                )}
                {metric(
                  t(($) => $.columns.deaths),
                  (p) => p.deaths,
                  num,
                  { lowerIsBetter: true },
                )}
              </tbody>
            </table>
          </div>
          <section aria-label={t(($) => $.compare.skills)} className="flex flex-col gap-2.5">
            <h3 className="m-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
              {t(($) => $.compare.skills)}
            </h3>
            <div className={tableScroll}>
              <table
                data-ui="table"
                className="w-full border-collapse text-sm tabular-nums"
                aria-label={t(($) => $.compare.skillTable)}
              >
                <thead>
                  <tr>
                    <HeadCell text className="left-0 z-[3]">
                      {t(($) => $.columns.skill)}
                    </HeadCell>
                    {SKILL_COLUMNS.map((column) => (
                      <HeadCell key={column}>
                        {column === 'delta' ? 'Δ' : t(($) => $.compare.column[column])}
                      </HeadCell>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((pair) => (
                    <tr key={pair.key} className={tableRow}>
                      <th
                        scope="row"
                        className={cn(tableCell, tableSticky, 'text-left font-medium text-ink')}
                      >
                        <SkillLabel id={(pair.a ?? pair.b)?.id}>{pair.name}</SkillLabel>
                      </th>
                      {[
                        pair.a ? fmt.number.format(pair.a.damage) : UNKNOWN,
                        pair.b ? fmt.number.format(pair.b.damage) : UNKNOWN,
                        <Delta key="delta" a={pair.a?.damage ?? null} b={pair.b?.damage ?? null} />,
                        fmt.pct(pair.a?.share),
                        fmt.pct(pair.b?.share),
                        fmt.maybe(pair.a?.casts),
                        fmt.maybe(pair.b?.casts),
                        fmt.pct(pair.a ? critRate(pair.a) : null),
                        fmt.pct(pair.b ? critRate(pair.b) : null),
                        fmt.maybe(pair.a?.avg),
                        fmt.maybe(pair.b?.avg),
                        fmt.seconds(pair.a?.cast_gap_ms),
                        fmt.seconds(pair.b?.cast_gap_ms),
                      ].map((value, index) => (
                        <td key={SKILL_COLUMNS[index]} className={cn(tableCell, 'text-right')}>
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <EmptyState title={t(($) => $.compare.emptyTitle)} icon={<Icon name="scale" size={20} />}>
          {t(($) => $.compare.emptyBody)}
        </EmptyState>
      )}
    </Panel>
  );
}

const SKILL_COLUMNS = [
  'aDamage',
  'bDamage',
  'delta',
  'aShare',
  'bShare',
  'aCasts',
  'bCasts',
  'aCrit',
  'bCrit',
  'aAvg',
  'bAvg',
  'aGap',
  'bGap',
] as const;

function HeadCell({
  children,
  text = false,
  className,
}: {
  children: ReactNode;
  text?: boolean;
  className?: string;
}) {
  return (
    <th scope="col" className={cn(tableHead, text ? 'text-left' : 'text-right', className)}>
      {children}
    </th>
  );
}
