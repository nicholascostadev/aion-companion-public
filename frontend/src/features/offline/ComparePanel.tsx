import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Meter, Swatch } from '../../components/ui/Data';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Select } from '../../components/ui/Field';
import { SkillLabel } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
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
import { rowColor } from '../../lib/playerRow';
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
  type SkillPair,
  type SkillRow,
} from './analysis';

const LIVE = 'live';

/** The two sides of a comparison, in the order they are read: A first, then B. */
const SIDES = ['a', 'b'] as const;
type SideKey = (typeof SIDES)[number];
const LETTER: Record<SideKey, string> = { a: 'A', b: 'B' };

const capsLabel = 'text-2xs font-semibold tracking-caps text-ink-3 uppercase';

interface Side {
  source: string;
  player: string;
}

function useSideReport(
  source: string,
  live: ReportTotals | null,
  loadLog: (id: string) => Promise<ReportTotals>,
) {
  // `error` is raw native text; `noLive` is worded by the view. A read belongs to the loader
  // that made it, so a new target scope never shows the fight as read in the old one.
  const [loaded, setLoaded] = useState<{
    id: string;
    loader: typeof loadLog | null;
    report: ReportTotals | null;
    error: string;
  }>({ id: '', loader: null, report: null, error: '' });
  useEffect(() => {
    if (!source || source === LIVE) return;
    let cancelled = false;
    void loadLog(source).then(
      (report) => !cancelled && setLoaded({ id: source, loader: loadLog, report, error: '' }),
      (cause: unknown) =>
        !cancelled &&
        setLoaded({ id: source, loader: loadLog, report: null, error: String(cause) }),
    );
    return () => {
      cancelled = true;
    };
  }, [source, loadLog]);
  if (source === LIVE) return { report: live, error: '', noLive: !live, loading: false };
  if (!source) return { report: null, error: '', noLive: false, loading: false };
  const current = loaded.id === source && loaded.loader === loadLog;
  return {
    report: current ? loaded.report : null,
    error: current ? loaded.error : '',
    noLive: false,
    loading: !current,
  };
}

type SideReport = ReturnType<typeof useSideReport>;

/** What a difference measures: a plain figure, percentage points or a length of time. */
type DeltaKind = 'number' | 'points' | 'duration';

/**
 * How B differs from A. The arrow gives the direction and the tone says whether it favours
 * B; an unknown side is a dash, never a guessed difference.
 */
function Delta({
  a,
  b,
  kind = 'number',
  lowerIsBetter = false,
  className,
}: {
  a: number | null;
  b: number | null;
  kind?: DeltaKind | undefined;
  lowerIsBetter?: boolean | undefined;
  className?: string;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  if (a === null || b === null || a === b)
    return (
      <span className={cn('text-ink-3 figures', className)}>
        {a === null || b === null ? UNKNOWN : '='}
      </span>
    );
  const d = b - a;
  const better = lowerIsBetter ? d < 0 : d > 0;
  const text =
    kind === 'points'
      ? t(($) => $.compare.points, {
          value: fmt
            .numberWith({
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
              signDisplay: 'exceptZero',
            })
            .format(d * 100),
        })
      : kind === 'duration'
        ? `${d > 0 ? '+' : '-'}${clock(Math.abs(d))}`
        : fmt
            .numberWith({
              notation: 'compact',
              maximumFractionDigits: 1,
              signDisplay: 'exceptZero',
            })
            .format(d);
  const relative = kind === 'points' || !a ? null : d / Math.abs(a);
  return (
    <span
      data-trend={better ? 'better' : 'worse'}
      className={cn(
        'inline-flex items-center justify-end gap-1 figures',
        better ? 'text-success' : 'text-danger',
        className,
      )}
    >
      <Icon name={d > 0 ? 'arrowUp' : 'arrowDown'} size={12} /> {text}
      {relative !== null && (
        <small className="text-2xs font-normal text-ink-3">({fmt.pct(relative, 0)})</small>
      )}
    </span>
  );
}

/** The figure a side is judged by: DPS in the reader's DPS mode. */
interface Headline {
  label: string;
  title: string;
  value: number | null;
}

/**
 * One side of the comparison: its fight and player, and once both are read, who it is and
 * the figure it is judged by. B mirrors A beside it, so the two figures face each other
 * across the difference between them.
 */
function SideCard({
  side,
  value,
  onChange,
  logs,
  state,
  names,
  player,
  color,
  headline,
  hideNames,
}: {
  side: SideKey;
  value: Side;
  onChange: (side: Side) => void;
  logs: LogMeta[];
  state: SideReport;
  names: Names;
  player: ReportPlayer | null;
  color: string;
  headline: Headline | null;
  hideNames: boolean;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { report } = state;
  const known = value.source === LIVE || logs.some((l) => l.id === value.source);
  const mirrored = side === 'b';
  return (
    <fieldset
      aria-label={t(($) => $.compare.side, { side: LETTER[side] })}
      className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border border-line-soft bg-surface-2 p-4"
    >
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-leaf border border-accent-line bg-accent-soft text-md font-semibold text-accent"
        >
          {LETTER[side]}
        </span>
        <label className="contents text-xs font-medium text-ink-3">
          <span>{t(($) => $.compare.fight)}</span>
          <Select
            size="sm"
            wrapperClassName="w-full"
            className="font-normal"
            value={value.source}
            onChange={(e) => onChange({ source: e.target.value, player: '' })}
          >
            <option value="">{t(($) => $.compare.choose)}</option>
            <option value={LIVE}>{t(($) => $.compare.liveFight)}</option>
            {!known && value.source && <option value={value.source}>{value.source}</option>}
            {logs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label ?? l.boss ?? t(($) => $.library.encounter)} · {fmt.dateTime(l.started_ms)}
              </option>
            ))}
          </Select>
        </label>
        {report && (
          <label className="contents text-xs font-medium text-ink-3">
            <span className="col-start-2">{t(($) => $.columns.player)}</span>
            <Select
              size="sm"
              wrapperClassName="w-full"
              className="font-normal"
              value={player ? key(player.id) : value.player}
              onChange={(e) => onChange({ ...value, player: e.target.value })}
            >
              {[...report.players]
                .sort((x, y) => y.damage - x.damage)
                .map((p) => (
                  <option key={key(p.id)} value={key(p.id)}>
                    {names.entity(p.id)}
                    {/* A hidden name already says the class it may show; yours stays private. */}
                    {p.class && !hideNames ? ` · ${p.class}` : ''}
                  </option>
                ))}
            </Select>
          </label>
        )}
      </div>
      {state.loading && (
        <output className="flex items-center gap-2 text-xs text-ink-3">
          <Icon name="loader" size={13} className="animate-spin" />
          {t(($) => $.library.opening)}
        </output>
      )}
      {state.error && (
        <Notice tone="error" className="my-0">
          {state.error}
        </Notice>
      )}
      {state.noLive && (
        <Notice tone="info" className="my-0">
          {t(($) => $.compare.noLive)}
        </Notice>
      )}
      {report && player && (
        <div
          className={cn(
            'mt-auto flex items-end justify-between gap-4 border-t border-line-soft pt-3',
            mirrored && 'min-[760px]:flex-row-reverse',
          )}
        >
          <div className={cn('min-w-0', mirrored && 'min-[760px]:text-right')}>
            <p
              className={cn(
                'm-0 flex items-center gap-2 text-sm font-medium text-ink',
                mirrored && 'min-[760px]:flex-row-reverse',
              )}
            >
              <Swatch color={color} className="size-2.5" />
              <span className="min-w-0 truncate">{names.entity(player.id)}</span>
            </p>
            <p className="m-0 mt-0.5 text-xs text-ink-3">
              {clock(report.duration_ms)} ·{' '}
              {t(($) => $.library.players, { count: report.players.length })} ·{' '}
              {fmt.dateTime(report.started_ms)}
            </p>
          </div>
          {headline && (
            <p
              className={cn(
                'm-0 flex shrink-0 flex-col text-right',
                mirrored && 'min-[760px]:text-left',
              )}
            >
              <span className={capsLabel} title={headline.title}>
                {headline.label}
              </span>
              <span className="text-2xl font-semibold tracking-tight text-ink figures">
                {fmt.maybe(headline.value, fmt.integer)}
              </span>
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

const pick = (report: ReportTotals | null, id: string) =>
  report
    ? (report.players.find((p) => key(p.id) === id) ??
      report.players.find((p) => p.local) ??
      [...report.players].sort((a, b) => b.damage - a.damage)[0] ??
      null)
    : null;

function Head({
  children,
  text = false,
  title,
  className,
}: {
  children: ReactNode;
  text?: boolean;
  title?: string | undefined;
  className?: string;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={cn(tableHead, text ? 'text-left' : 'text-right', className)}
    >
      {children}
    </th>
  );
}

/** A side's letter beside its class colour, the key to every bar of that side. */
function SideKeyLabel({ side, color }: { side: SideKey; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Swatch color={color} />
      {LETTER[side]}
    </span>
  );
}

interface MetricRow {
  id: string;
  label: string;
  title?: string | undefined;
  a: number | null;
  b: number | null;
  text: (value: number | null) => string;
  kind?: DeltaKind | undefined;
  lowerIsBetter?: boolean | undefined;
}

/** One chapter of whole-fight figures: its name heads the rows, then A, B and the difference. */
function MetricTable({
  label,
  rows,
  colors,
}: {
  label: string;
  rows: MetricRow[];
  colors: Record<SideKey, string>;
}) {
  const { t } = useTranslation('reports');
  const quiet = 'static bg-transparent';
  return (
    <div className="max-w-full overflow-x-auto">
      <table data-ui="table" className="w-full border-collapse text-sm figures" aria-label={label}>
        <thead>
          <tr>
            <Head text className={quiet}>
              {label}
            </Head>
            {SIDES.map((side) => (
              <Head key={side} className={cn(quiet, 'w-28')}>
                <SideKeyLabel side={side} color={colors[side]} />
              </Head>
            ))}
            <Head className={cn(quiet, 'w-40')}>{t(($) => $.compare.bVsA)}</Head>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={cn(tableRow, 'last:[&>th]:border-b-0')}>
              <th
                scope="row"
                title={row.title}
                className={cn(tableCell, 'text-left font-medium text-ink-2')}
              >
                {row.label}
              </th>
              <td className={cn(tableCell, 'text-right')}>{row.text(row.a)}</td>
              <td className={cn(tableCell, 'text-right')}>{row.text(row.b)}</td>
              <td className={cn(tableCell, 'text-right')}>
                <Delta a={row.a} b={row.b} kind={row.kind} lowerIsBetter={row.lowerIsBetter} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A skill's two figures for one column, A over B, so a column of numbers lines up and each
 * heading is written once. A side without the skill is a faint dash.
 */
function Lines({
  pair,
  className,
  children,
}: {
  pair: SkillPair;
  className?: string;
  children: (row: SkillRow, side: SideKey) => ReactNode;
}) {
  return (
    <span className="grid gap-y-1">
      {SIDES.map((side) => {
        const row = pair[side];
        return (
          <span
            key={side}
            className={cn('flex h-5 items-center justify-end', !row && 'text-ink-4', className)}
          >
            <span className="sr-only">{`${LETTER[side]} `}</span>
            {row ? children(row, side) : UNKNOWN}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Skills as paired bars: each skill is one row, A's damage over B's on one shared scale, then
 * the difference and share. `detail` adds casts, crit, average hit and cast gap.
 */
function SkillTable({
  pairs,
  colors,
  detail,
}: {
  pairs: SkillPair[];
  colors: Record<SideKey, string>;
  detail: boolean;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const rows = pairs.flatMap((pair) => SIDES.flatMap((side) => pair[side] ?? []));
  const top = Math.max(0, ...rows.map((row) => row.damage));
  // Every damage figure gets the same room, so every bar is drawn on the same scale.
  const figureWidth = `${Math.max(1, ...rows.map((row) => fmt.number.format(row.damage).length))}ch`;
  const cell = cn(tableCell, 'text-right align-middle');
  return (
    <div data-ui="table-scroll" className={tableScroll}>
      <table
        data-ui="table"
        className="w-full border-collapse text-sm figures"
        aria-label={t(($) => $.compare.skillTable)}
      >
        <thead>
          <tr>
            <Head text className="left-0 z-[3]">
              {t(($) => $.columns.skill)}
            </Head>
            <Head className="w-full">{t(($) => $.columns.damage)}</Head>
            <Head>{t(($) => $.compare.bVsA)}</Head>
            <Head>{t(($) => $.columns.share)}</Head>
            {detail && (
              <>
                <Head>{t(($) => $.columns.casts)}</Head>
                <Head title={t(($) => $.damage.critTitle)}>{t(($) => $.columns.crit)}</Head>
                <Head>{t(($) => $.columns.avg)}</Head>
                <Head title={t(($) => $.skills.gapTitle)}>{t(($) => $.skills.gap)}</Head>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair) => (
            <tr key={pair.key} className={cn(tableRow, 'last:[&>th]:border-b-0')}>
              <th
                scope="row"
                className={cn(
                  tableCell,
                  tableSticky,
                  'text-left align-middle font-medium text-ink',
                )}
              >
                <span className="flex items-center justify-between gap-4">
                  <span className="flex max-w-72 min-w-0" title={pair.name}>
                    <SkillLabel id={(pair.a ?? pair.b)?.id}>{pair.name}</SkillLabel>
                  </span>
                  {/* The letters lead the bars; each figure also names its side to a screen reader. */}
                  <span
                    aria-hidden="true"
                    className="grid shrink-0 gap-y-1 text-2xs font-semibold text-ink-3"
                  >
                    {SIDES.map((side) => (
                      <span
                        key={side}
                        className={cn('flex h-5 items-center', !pair[side] && 'text-ink-4')}
                      >
                        {LETTER[side]}
                      </span>
                    ))}
                  </span>
                </span>
              </th>
              <td className={cell}>
                <Lines pair={pair} className="gap-2.5">
                  {(row, side) => (
                    <>
                      <Meter
                        size="md"
                        fraction={rate(row.damage, top) ?? 0}
                        color={colors[side]}
                        label={t(($) => $.damage.shareMeter, { name: pair.name })}
                        className="min-w-24 bg-transparent"
                      />
                      <span className="shrink-0 text-right" style={{ minWidth: figureWidth }}>
                        {fmt.number.format(row.damage)}
                      </span>
                    </>
                  )}
                </Lines>
              </td>
              <td className={cell}>
                <Delta a={pair.a?.damage ?? null} b={pair.b?.damage ?? null} />
              </td>
              <td className={cell}>
                <Lines pair={pair}>{(row) => fmt.pct(row.share)}</Lines>
              </td>
              {detail && (
                <>
                  <td className={cell}>
                    <Lines pair={pair}>{(row) => fmt.maybe(row.casts)}</Lines>
                  </td>
                  <td className={cell}>
                    <Lines pair={pair}>{(row) => fmt.pct(critRate(row))}</Lines>
                  </td>
                  <td className={cell}>
                    <Lines pair={pair}>{(row) => fmt.maybe(row.avg)}</Lines>
                  </td>
                  <td className={cell}>
                    <Lines pair={pair}>{(row) => fmt.seconds(row.cast_gap_ms)}</Lines>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How far a skill's damage moved between the sides; a side without it counts as none. */
const damageChange = (pair: SkillPair) => Math.abs((pair.b?.damage ?? 0) - (pair.a?.damage ?? 0));

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
  const [figures, setFigures] = useState<'damage' | 'all'>('damage');
  const [order, setOrder] = useState<'damage' | 'change'>('damage');
  const skillsTitle = useId();
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
        ? pairSkills(
            skillRowsFromPlayer(pa),
            skillRowsFromPlayer(pb),
            // The row's own observed name first: another player's skill of the same id must
            // not rename it.
            (row) =>
              row.name?.trim() ||
              (pa.skills.some((s) => key(s.id) === key(row.id)) ? namesA : namesB).skill(row.id),
          )
        : [],
    [pa, pb, namesA, namesB],
  );
  const ordered = useMemo(
    () =>
      order === 'change' ? [...pairs].sort((x, y) => damageChange(y) - damageChange(x)) : pairs,
    [pairs, order],
  );

  if (!native)
    return <EmptyState title={t(($) => $.compare.native)} icon={<Icon name="scale" size={20} />} />;

  // Each side is marked in its class colour; a hidden local player's class stays private.
  const colors: Record<SideKey, string> = {
    a: rowColor(pa, hideNames),
    b: rowColor(pb, hideNames),
  };
  const headline = (player: ReportPlayer | null, report: ReportTotals | null): Headline | null =>
    player && report
      ? {
          label: mode === 'active' ? 'aDPS' : 'DPS',
          title:
            mode === 'active'
              ? t(($) => $.damage.dpsActiveTitle)
              : t(($) => $.damage.dpsEncounterTitle),
          value: playerDps(player, report, mode),
        }
      : null;
  const headlineA = headline(pa, left.report);
  const headlineB = headline(pb, right.report);
  const ready = Boolean(pa && pb && left.report && right.report);

  const num = (v: number | null) => fmt.maybe(v);
  const percentOf = (v: number | null) => fmt.pct(v);
  const metric = (
    id: string,
    label: string,
    get: (p: ReportPlayer, r: ReportTotals) => number | null,
    text: (v: number | null) => string,
    opts: Pick<MetricRow, 'kind' | 'lowerIsBetter' | 'title'> = {},
  ): MetricRow => ({
    id,
    label,
    a: pa && left.report ? get(pa, left.report) : null,
    b: pb && right.report ? get(pb, right.report) : null,
    text,
    ...opts,
  });

  return (
    <Panel padding="lg" className="flex flex-col gap-6">
      <div className="grid gap-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SideCard
          side="a"
          value={a}
          onChange={setA}
          logs={logs}
          state={left}
          names={namesA}
          player={pa}
          color={colors.a}
          headline={headlineA}
          hideNames={hideNames}
        />
        <div
          className={cn(
            'flex items-center justify-center gap-4 min-[760px]:flex-col min-[760px]:py-4',
            ready && 'min-[760px]:justify-between',
          )}
        >
          <Button
            iconOnly
            variant="ghost"
            aria-label={t(($) => $.compare.swap)}
            title={t(($) => $.compare.swap)}
            onClick={() => {
              setA(b);
              setB(a);
            }}
          >
            <Icon name="swap" />
          </Button>
          {ready && (
            <p className="m-0 flex flex-col items-center gap-0.5 text-center">
              <span className={capsLabel}>{t(($) => $.compare.bVsA)}</span>
              <Delta
                a={headlineA?.value ?? null}
                b={headlineB?.value ?? null}
                className="text-md font-semibold"
              />
            </p>
          )}
        </div>
        <SideCard
          side="b"
          value={b}
          onChange={setB}
          logs={logs}
          state={right}
          names={namesB}
          player={pb}
          color={colors.b}
          headline={headlineB}
          hideNames={hideNames}
        />
      </div>
      {ready ? (
        <>
          <section
            aria-label={t(($) => $.compare.players)}
            className="grid gap-x-10 gap-y-6 min-[900px]:grid-cols-2"
          >
            <MetricTable
              label={t(($) => $.compare.output)}
              colors={colors}
              rows={[
                metric(
                  'length',
                  t(($) => $.compare.length),
                  (_p, r) => r.duration_ms,
                  (v) => (v === null ? UNKNOWN : clock(v)),
                  { kind: 'duration', lowerIsBetter: true },
                ),
                metric(
                  'damage',
                  t(($) => $.columns.damage),
                  (p) => p.damage,
                  num,
                ),
                metric('edps', 'eDPS', (p) => p.edps, num, {
                  title: t(($) => $.damage.edpsTitle),
                }),
                metric('adps', 'aDPS', (p) => p.adps, num, {
                  title: t(($) => $.damage.adpsTitle),
                }),
                metric(
                  'active',
                  t(($) => $.columns.active),
                  (p) => p.active_pct,
                  percentOf,
                  { kind: 'points', title: t(($) => $.damage.activeTitle) },
                ),
                metric(
                  'share',
                  t(($) => $.compare.damageShare),
                  (p, r) =>
                    rate(
                      p.damage,
                      r.players.reduce((s, x) => s + x.damage, 0),
                    ),
                  percentOf,
                  { kind: 'points' },
                ),
                metric(
                  'casts',
                  t(($) => $.columns.casts),
                  (p) => p.casts,
                  num,
                ),
              ]}
            />
            <MetricTable
              label={t(($) => $.compare.survival)}
              colors={colors}
              rows={[
                metric(
                  'crit',
                  t(($) => $.compare.critRate),
                  (p) => critRate(p),
                  percentOf,
                  { kind: 'points', title: t(($) => $.damage.critTitle) },
                ),
                metric(
                  'back',
                  t(($) => $.compare.backRate),
                  (p) => flagRate(p, 'back'),
                  percentOf,
                  { kind: 'points', title: t(($) => $.damage.backTitle) },
                ),
                metric(
                  'perfect',
                  t(($) => $.compare.perfectRate),
                  (p) => flagRate(p, 'perfect'),
                  percentOf,
                  { kind: 'points', title: t(($) => $.skills.flagTitle.perfect) },
                ),
                metric(
                  'healing',
                  t(($) => $.columns.healing),
                  (p) => p.healing,
                  num,
                ),
                metric(
                  'taken',
                  t(($) => $.highlights.damageTaken),
                  (p) => p.received,
                  num,
                  { lowerIsBetter: true },
                ),
                metric(
                  'deaths',
                  t(($) => $.columns.deaths),
                  (p) => p.deaths,
                  num,
                  { lowerIsBetter: true },
                ),
              ]}
            />
          </section>
          <section
            aria-labelledby={skillsTitle}
            className="flex flex-col gap-3 border-t border-line-soft pt-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              <h2 id={skillsTitle} className="m-0">
                {t(($) => $.compare.skills)}
              </h2>
              {pairs.length > 0 && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <SegmentedControl
                    size="sm"
                    label={t(($) => $.compare.order)}
                    value={order}
                    onChange={setOrder}
                    options={[
                      { value: 'damage', label: t(($) => $.compare.mostDamage) },
                      { value: 'change', label: t(($) => $.compare.biggestChange) },
                    ]}
                  />
                  <SegmentedControl
                    size="sm"
                    label={t(($) => $.compare.figures)}
                    value={figures}
                    onChange={setFigures}
                    options={[
                      { value: 'damage', label: t(($) => $.columns.damage) },
                      { value: 'all', label: t(($) => $.compare.allFigures) },
                    ]}
                  />
                </div>
              )}
            </div>
            {pairs.length ? (
              <SkillTable pairs={ordered} colors={colors} detail={figures === 'all'} />
            ) : (
              <EmptyState
                compact
                title={t(($) => $.skills.emptyTitle)}
                icon={<Icon name="binoculars" size={18} />}
              />
            )}
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
