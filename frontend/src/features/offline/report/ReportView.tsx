import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Meter, Stat, StatStrip } from '../../../components/ui/Data';
import { Disclosure } from '../../../components/ui/Disclosure';
import { Notice } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { TabList, TabPanel, Tabs } from '../../../components/ui/Tabs';
import { clock, UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import { rowColor } from '../../../lib/playerRow';
import { reportScope, scopedTargets } from '../../../lib/targetScope';
import type { CombatReport, OfflineSettings, TargetMode } from '../../../types/offline';
import type { OpenProfile } from '../../live/ProfileLink';
import {
  bossProjection,
  dummyTimer,
  fullWindow,
  key,
  Names,
  partyDps,
  type BossProjection,
  type TimeWindow,
} from '../analysis';
import {
  coverageLabel,
  DEFAULT_DETAILS,
  endReason,
  ReportProvider,
  resolveRoute,
  type DetailsState,
  type ReportCtx,
  type ReportRoute,
  type ReportTab,
} from './context';
import { Figure, Note } from './parts';
import { RotationView } from './RotationView';
import { SkillsView } from './SkillsView';
import { TimelineView } from './TimelineView';

interface Props {
  report: CombatReport;
  settings: OfflineSettings | null;
  native: boolean;
  /** Live report (true) or a saved log. */
  live?: boolean;
  /** Copies this report's summary to the clipboard. Omit to hide the copy buttons. */
  onCopySummary?: (multiline: boolean) => Promise<void>;
  title?: ReactNode;
  /**
   * Stands in for the whole title heading, e.g. the rename form of a saved log. The report's
   * facts stay beneath it.
   */
  heading?: ReactNode;
  /** Leads the title row: the way back out of a report opened from a list. */
  lead?: ReactNode;
  actions?: ReactNode;
  /** Player selected first (entity id as text), e.g. a row opened from the DPS meter. */
  initialPlayer?: string | null;
  /**
   * Where the report opens: one of its three places, or the name of an earlier view, which
   * opens where that view's content lives now (see `resolveRoute`).
   */
  initialTab?: ReportRoute;
  /**
   * Writes the fight's figures and its boss on single lines instead of the hero strip, so
   * the views start higher: for a report opened to read its details, where the selected
   * player's own figures are the headline.
   */
  dense?: boolean;
  /** Told the place the reader moved to, so an owner can open the next report on it. */
  onTabChange?: (tab: ReportTab) => void;
  /**
   * The target scope this report was read in, named beside its date; omit or null when unknown.
   * Bosses reads as All targets for a fight that met no boss or dummy, as native counts
   * every target then. It must be the scope of this very read: the skill rows and hit lists
   * recomputed from the report's events are limited to it, to agree with native's totals.
   */
  scope?: TargetMode | null;
  /** Opens a character in the in-game profile window; omit outside the native app. */
  onOpenProfile?: OpenProfile | undefined;
}

/**
 * The three places of a report. Combat details hold the selected player's summary, skills,
 * buff uptime, healing and damage taken; Rotation the cast sequence, its timing and the
 * effects at each cast; Timeline the fight over time, its deaths and its events.
 */
const TABS: readonly ReportTab[] = ['details', 'rotation', 'timeline'];

/** One labelled fact of the boss band; `inline` writes the value beside its label. */
function BossFact({
  label,
  title,
  children,
  inline = false,
  className,
}: {
  label: string;
  title: string;
  children: ReactNode;
  inline?: boolean;
  className?: string | undefined;
}) {
  return (
    <div title={title} className={cn('min-w-0', inline && 'flex items-baseline gap-1.5')}>
      <dt className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">{label}</dt>
      <dd
        className={cn(
          'm-0 font-semibold text-ink figures',
          inline ? 'text-sm' : 'text-md',
          className,
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Boss HP with kill-time and berserk projections; every part degrades to a dash.
 * `compactLayout` is the same band in less height, and `line` writes it all on one line
 * (wrapping when it must), for a report whose views should start higher.
 */
export function BossSummary({
  projection,
  compactLayout = false,
  line = false,
}: {
  projection: BossProjection;
  compactLayout?: boolean;
  line?: boolean;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { target, fraction, ttkMs, berserkMs, beatsBerserk, dps, dpsSource } = projection;
  const low = fraction !== null && fraction < 0.2;
  const dense = compactLayout || line;
  const name = (
    <>
      <b
        className="min-w-0 truncate text-md font-semibold tracking-tight text-ink"
        title={target.name ?? undefined}
      >
        {target.name ?? t(($) => $.boss.targetId, { id: key(target.npc_id ?? target.id) })}
      </b>
      {target.boss && (
        <Badge shape="tag" tone="danger" variant="outline">
          {t(($) => $.boss.boss)}
        </Badge>
      )}
      {target.dummy && <Badge shape="tag">{t(($) => $.boss.dummy)}</Badge>}
    </>
  );
  const state = target.dead ? t(($) => $.boss.defeated) : fmt.pct(fraction);
  const meter = (
    <Meter
      size={dense ? 'sm' : 'md'}
      className="flex w-full"
      fraction={target.dead ? 0 : fraction}
      color={low ? undefined : 'var(--color-rose)'}
      label={
        target.name ? t(($) => $.boss.hpMeter, { name: target.name }) : t(($) => $.boss.targetHp)
      }
      tone={low ? 'bad' : undefined}
    />
  );
  const facts = (
    <>
      <BossFact
        inline={dense}
        label={t(($) => $.boss.partyDps)}
        title={
          dpsSource === 'hp'
            ? t(($) => $.boss.dpsFromHp)
            : dpsSource === 'damage'
              ? t(($) => $.boss.dpsFromDamage)
              : t(($) => $.boss.notEnoughData)
        }
      >
        {dps === null ? UNKNOWN : fmt.compact.format(dps)}
      </BossFact>
      <BossFact inline={dense} label={t(($) => $.boss.killIn)} title={t(($) => $.boss.killInTitle)}>
        {target.dead ? t(($) => $.boss.done) : ttkMs === null ? UNKNOWN : fmt.countdown(ttkMs)}
      </BossFact>
      <BossFact
        inline={dense}
        label={t(($) => $.boss.berserk)}
        title={
          target.berserk_seconds === null
            ? t(($) => $.boss.noBerserk)
            : t(($) => $.boss.berserkAfter, {
                seconds: fmt.number.format(target.berserk_seconds),
              })
        }
        className={
          beatsBerserk === null ? undefined : beatsBerserk ? 'text-success' : 'text-danger'
        }
      >
        {berserkMs === null
          ? UNKNOWN
          : berserkMs <= 0
            ? t(($) => $.boss.berserkActive)
            : fmt.countdown(berserkMs)}
        {beatsBerserk !== null && !target.dead && (
          <span className="sr-only">
            {beatsBerserk ? t(($) => $.boss.onPace) : t(($) => $.boss.behindPace)}
          </span>
        )}
      </BossFact>
    </>
  );
  if (line)
    return (
      <div
        data-ui="boss-summary"
        data-variant="line"
        className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line-soft bg-surface-2 px-3 py-1.5"
      >
        <span className="flex min-w-0 items-center gap-2">{name}</span>
        <span className="flex min-w-36 flex-1 items-center gap-2.5">
          {meter}
          <span className="shrink-0 text-sm font-semibold text-ink figures">{state}</span>
        </span>
        <dl className="m-0 flex flex-wrap gap-x-4 gap-y-0.5">{facts}</dl>
      </div>
    );
  return (
    <div
      data-ui="boss-summary"
      className={cn(
        'rounded-lg border border-line-soft bg-surface-2',
        compactLayout ? 'px-3 py-2.5' : 'px-4 py-3.5',
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-2', compactLayout ? 'mb-1.5' : 'mb-2')}>
        {name}
        <span
          className={cn(
            'ml-auto font-semibold text-ink figures',
            compactLayout ? 'text-md' : 'text-xl',
          )}
        >
          {state}
        </span>
      </div>
      {meter}
      <dl
        className={cn(
          'm-0',
          compactLayout ? 'mt-2 flex flex-wrap gap-x-5 gap-y-1' : 'mt-3 grid grid-cols-3 gap-3',
        )}
      >
        {facts}
      </dl>
    </div>
  );
}

export function CopySummary({
  onCopy,
  native,
}: {
  onCopy: (multiline: boolean) => Promise<void>;
  native: boolean;
}) {
  const { t } = useTranslation(['reports', 'common']);
  // Copied, or the raw failure detail: worded at render so a language change follows.
  const [state, setState] = useState<{ copied: true } | { error: string } | null>(null);
  const copy = async (multiline: boolean) => {
    try {
      await onCopy(multiline);
      setState({ copied: true });
    } catch (cause) {
      setState({ error: String(cause) });
    }
  };
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => setState(null), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        disabled={!native}
        icon={<Icon name="copy" size={13} />}
        onClick={() => void copy(false)}
        title={t(($) => $.copy.summaryTitle)}
      >
        {t(($) => $.copy.summary)}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!native}
        onClick={() => void copy(true)}
        title={t(($) => $.copy.multiLineTitle)}
      >
        {t(($) => $.copy.multiLine)}
      </Button>
      <output
        aria-label={t(($) => $.copy.status)}
        className="min-w-0 text-left text-xs font-medium text-accent"
      >
        {state === null
          ? ''
          : 'copied' in state
            ? t(($) => $.actions.copied, { ns: 'common' })
            : state.error}
      </output>
    </span>
  );
}

/** Report facts in a line, separated by quiet dots; falsy items are skipped. */
function Meta({ items }: { items: ReactNode[] }) {
  const shown = items.filter(Boolean);
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
      {shown.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-ink-4">
              ·
            </span>
          )}
          {item}
        </span>
      ))}
    </p>
  );
}

export function ReportView({
  report,
  settings,
  native,
  live = false,
  onCopySummary,
  title,
  heading,
  lead,
  actions,
  initialPlayer = null,
  initialTab = 'details',
  dense = false,
  onTabChange,
  scope,
  onOpenProfile,
}: Props) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const hideNames = settings?.hide_names ?? false;
  const mode = settings?.dps_mode ?? 'encounter';
  const names = useMemo(() => new Names(report, { hideNames, t }), [report, hideNames, t]);
  const tabs = TABS.map((id) => ({ id, label: t(($) => $.tabs[id]) }));
  const players = useMemo(
    () => [...report.players].sort((a, b) => b.damage - a.damage),
    [report.players],
  );
  // An earlier view's name opens where its content lives now, with that content in view.
  const [opening] = useState(() => resolveRoute(initialTab));
  const [tab, setShownTab] = useState<ReportTab>(opening.tab);
  const setTab = (next: ReportTab) => {
    setShownTab(next);
    onTabChange?.(next);
  };
  const [details, setDetailsState] = useState<DetailsState>({
    ...DEFAULT_DETAILS,
    ...opening.details,
  });
  const setDetails = useCallback(
    (patch: Partial<DetailsState>) => setDetailsState((current) => ({ ...current, ...patch })),
    [],
  );
  // Counts the requests for the death recaps, so the timeline brings them into view each
  // time, and remembers the last one it answered, so returning to the timeline later does
  // not answer it again.
  const [deathsAsked, setDeathsAsked] = useState(opening.deaths ? 1 : 0);
  const deathsShown = useRef(0);
  const [playerId, setPlayerId] = useState<string | null>(initialPlayer);
  const [zoom, setZoom] = useState<TimeWindow | null>(null);
  const [focus, setFocus] = useState<{ at: number; seq: number } | null>(null);
  const [fightId, setFightId] = useState(report.id);
  // One window object per report, so the views' memos over the window hold between renders.
  const full = useMemo(() => fullWindow(report), [report]);
  const total = full.to;
  // The scope native read this report in limits what is recomputed from its events too.
  const scopeTargets = useMemo(() => scopedTargets(report, scope), [report, scope]);
  const window = zoom ?? full;

  // A new fight (different id) resets selection, zoom and what was unfolded, adjusted
  // during render; the place and the breakdown kind the reader chose stay.
  if (fightId !== report.id) {
    setFightId(report.id);
    setZoom(null);
    setPlayerId(initialPlayer);
    setFocus(null);
    setDetailsState((current) => ({ ...DEFAULT_DETAILS, kind: current.kind }));
  }

  const player =
    players.find((p) => key(p.id) === playerId) ??
    players.find((p) => p.local) ??
    players[0] ??
    null;
  const setWindow = useCallback(
    (next: TimeWindow) => setZoom(next.from <= 0 && next.to >= total ? null : next),
    [total],
  );
  const ctx: ReportCtx = {
    report,
    names,
    mode,
    hideNames,
    players,
    player,
    setPlayer: setPlayerId,
    window,
    setWindow,
    total,
    scopeTargets,
    details,
    setDetails,
    goTo: (route, at, id) => {
      const destination = resolveRoute(route);
      setTab(destination.tab);
      if (destination.details) setDetails(destination.details);
      if (destination.deaths) setDeathsAsked((asked) => asked + 1);
      if (id) setPlayerId(id);
      if (at !== undefined) {
        // Center a 20 s window on the moment and mark it on the timeline.
        const width = Math.min(total, 20_000);
        const from = Math.max(0, Math.min(total - width, at - width / 2));
        setWindow({ from, to: from + width });
        setFocus((current) => ({ at, seq: (current?.seq ?? 0) + 1 }));
      }
    },
    observed: (family) => report.coverage[family] ?? null,
    // A hidden local player's class stays private, so their colour never reveals it.
    colorOf: (p) => rowColor(p, hideNames),
    // A profile link names its character, so hidden names offer none.
    onOpenProfile: hideNames ? undefined : onOpenProfile,
  };

  const projection = useMemo(() => bossProjection(report), [report]);
  const dummy = dummyTimer(report, settings?.dummy_length_seconds ?? 0);
  const damage = players.reduce((s, p) => s + p.damage, 0);
  const deaths = report.events.filter((e) => e.kind === 'death').length;
  const missing = Object.entries(report.coverage).filter(([, seen]) => !seen);

  return (
    <ReportProvider value={ctx}>
      <section
        data-ui="report"
        className="min-w-0"
        aria-label={live ? t(($) => $.view.liveReport) : t(($) => $.view.combatReport)}
      >
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-start gap-3">
            {lead}
            <div className="min-w-0 flex-1">
              {heading ?? (
                <h3 className="mb-1 text-lg font-semibold tracking-tight text-ink">
                  {title ??
                    report.label ??
                    (live ? t(($) => $.view.currentEncounter) : t(($) => $.view.combatLog))}
                </h3>
              )}
              <Meta
                items={[
                  live && !report.end_reason && (
                    <Badge key="live" shape="tag" tone="accent" dot="live">
                      {t(($) => $.view.live)}
                    </Badge>
                  ),
                  fmt.dateTime(report.started_ms),
                  clock(report.duration_ms),
                  endReason(t, report.end_reason),
                  report.zone_id !== null && t(($) => $.view.zone, { zone: report.zone_id }),
                  scope && (
                    <span key="scope" title={t(($) => $.view.scopeTitle)}>
                      {t(($) => $.view.scope[reportScope(report, scope)])}
                    </span>
                  ),
                  report.run_id && (
                    <span key="run" title={t(($) => $.view.runTitle)}>
                      {report.run_id}
                    </span>
                  ),
                ]}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onCopySummary && <CopySummary onCopy={onCopySummary} native={native} />}
            {actions}
          </div>
        </header>
        {dense ? (
          <div
            data-ui="report-summary"
            className="mb-3 flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2"
          >
            <dl className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
              <Figure label={t(($) => $.view.duration)} className="[&>dd]:font-semibold">
                {clock(report.duration_ms)}
              </Figure>
              <Figure
                label={t(($) => $.view.partyDamage)}
                title={fmt.number.format(damage)}
                className="[&>dd]:font-semibold"
              >
                {fmt.compact.format(damage)}
              </Figure>
              <Figure
                label={t(($) => $.view.partyDps)}
                title={t(($) => $.view.partyDpsTitle)}
                className="[&>dd]:font-semibold [&>dd]:text-accent"
              >
                {fmt.maybe(partyDps(report), fmt.compact)}{' '}
                <small className="text-2xs font-normal text-ink-3">
                  {t(($) => $.view.wholeEncounter)}
                </small>
              </Figure>
              <Figure label={t(($) => $.view.players)} className="[&>dd]:font-semibold">
                {fmt.number.format(players.length)}
              </Figure>
              <Figure
                label={t(($) => $.view.deaths)}
                className={cn('[&>dd]:font-semibold', deaths > 0 && '[&>dd]:text-danger')}
              >
                {report.coverage.deaths === false && !deaths ? UNKNOWN : fmt.number.format(deaths)}
              </Figure>
              {dummy && (
                <Figure label={t(($) => $.view.dummyTimer)} className="[&>dd]:font-semibold">
                  {dummy.remainingMs > 0
                    ? fmt.countdown(dummy.remainingMs)
                    : t(($) => $.view.dummyComplete)}{' '}
                  <small className="text-2xs font-normal text-ink-3">
                    {t(($) => $.view.dummyRun, {
                      seconds: fmt.number.format(dummy.totalMs / 1000),
                    })}
                  </small>
                </Figure>
              )}
            </dl>
            {projection && (
              <div className="min-w-72 flex-1">
                <BossSummary projection={projection} line />
              </div>
            )}
          </div>
        ) : (
          <>
            {/* The fight's figures and its boss share a row once the report is wide enough, so
            neither pushes the views below them down. */}
            <div className="@container mb-4">
              <div
                className={cn(
                  'grid items-center gap-x-8 gap-y-4',
                  projection && '@4xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]',
                )}
              >
                <StatStrip variant="open" columns="auto" className="mb-0">
                  <Stat label={t(($) => $.view.duration)} value={clock(report.duration_ms)} />
                  <Stat
                    label={t(($) => $.view.partyDamage)}
                    value={fmt.compact.format(damage)}
                    title={fmt.number.format(damage)}
                  />
                  <Stat
                    label={t(($) => $.view.partyDps)}
                    value={fmt.maybe(partyDps(report), fmt.compact)}
                    sub={t(($) => $.view.wholeEncounter)}
                    title={t(($) => $.view.partyDpsTitle)}
                    tone="accent"
                  />
                  <Stat
                    label={t(($) => $.view.players)}
                    value={fmt.number.format(players.length)}
                  />
                  <Stat
                    label={t(($) => $.view.deaths)}
                    value={
                      report.coverage.deaths === false && !deaths
                        ? UNKNOWN
                        : fmt.number.format(deaths)
                    }
                    tone={deaths ? 'bad' : undefined}
                  />
                  {dummy && (
                    <Stat
                      label={t(($) => $.view.dummyTimer)}
                      value={
                        dummy.remainingMs > 0
                          ? fmt.countdown(dummy.remainingMs)
                          : t(($) => $.view.dummyComplete)
                      }
                      sub={t(($) => $.view.dummyRun, {
                        seconds: fmt.number.format(dummy.totalMs / 1000),
                      })}
                    />
                  )}
                </StatStrip>
                {projection && <BossSummary projection={projection} compactLayout />}
              </div>
            </div>
          </>
        )}
        {report.events_truncated && (
          <Notice tone="info">
            {t(($) => $.view.truncated, { start: clock(report.event_window_start_ms ?? 0) })}
          </Notice>
        )}
        {(missing.length > 0 || report.warnings.length > 0) && (
          <Disclosure
            variant="plain"
            summaryClassName="py-1.5"
            summary={
              <>
                {t(($) => $.view.coverage)}
                {missing.length > 0 && (
                  <span className="font-normal text-ink-3">
                    {' '}
                    {t(($) => $.view.notObservedList, {
                      families: fmt.list(
                        missing.map(([k]) => coverageLabel(t, k)),
                        'unit',
                      ),
                    })}
                  </span>
                )}
              </>
            }
          >
            <ul className="m-0 mb-2.5 flex list-none flex-wrap gap-1.5 p-0">
              {Object.entries(report.coverage).map(([family, seen]) => (
                <li
                  key={family}
                  className={cn(
                    'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs',
                    seen
                      ? 'border-accent-line bg-accent-soft text-accent'
                      : 'border-dashed border-line-strong text-ink-3',
                  )}
                >
                  <Icon name={seen ? 'check' : 'minus'} size={12} strokeWidth={2.2} />
                  {coverageLabel(t, family)}
                  <span className="sr-only">
                    {' '}
                    {seen ? t(($) => $.view.observed) : t(($) => $.view.notObserved)}
                  </span>
                </li>
              ))}
            </ul>
            <Note>{t(($) => $.view.coverageNote)}</Note>
            {report.warnings.map((w) => (
              <Notice key={w} tone="warn">
                {w}
              </Notice>
            ))}
          </Disclosure>
        )}
        <Tabs value={tab} onValueChange={setTab}>
          <TabList label={t(($) => $.view.tabs)} items={tabs} variant="sub" />
          {TABS.map((id) => (
            <TabPanel key={id} value={id} className="pt-5">
              {id === 'details' && <SkillsView />}
              {id === 'rotation' && <RotationView />}
              {id === 'timeline' && (
                <TimelineView focus={focus} deathsAsked={deathsAsked} deathsShown={deathsShown} />
              )}
            </TabPanel>
          ))}
        </Tabs>
      </section>
    </ReportProvider>
  );
}
