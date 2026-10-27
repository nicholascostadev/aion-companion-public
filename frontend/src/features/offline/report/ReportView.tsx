import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { classColor } from '../../../lib/classColors';
import type { CombatReport, OfflineSettings } from '../../../types/offline';
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
import { BuffsView } from './BuffsView';
import {
  coverageLabel,
  endReason,
  ReportProvider,
  type ReportCtx,
  type ReportTab,
} from './context';
import { DeathsView, HighlightsView } from './EventViews';
import { Note } from './parts';
import { DamageView, HealingView, TakenView } from './PlayerViews';
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
  actions?: ReactNode;
  /** Player selected first (entity id as text), e.g. a row opened from the DPS meter. */
  initialPlayer?: string | null;
  initialTab?: ReportTab;
}

const TABS: readonly ReportTab[] = [
  'damage',
  'healing',
  'taken',
  'deaths',
  'highlights',
  'skills',
  'rotation',
  'buffs',
  'timeline',
];

/** One labelled fact of the boss band. */
function BossFact({
  label,
  title,
  children,
  className,
}: {
  label: string;
  title: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div title={title} className="min-w-0">
      <dt className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">{label}</dt>
      <dd className={cn('m-0 text-md font-semibold text-ink tabular-nums', className)}>
        {children}
      </dd>
    </div>
  );
}

/** Boss HP with kill-time and berserk projections; every part degrades to a dash. */
export function BossSummary({
  projection,
  compactLayout = false,
}: {
  projection: BossProjection;
  compactLayout?: boolean;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { target, fraction, ttkMs, berserkMs, beatsBerserk, dps, dpsSource } = projection;
  const low = fraction !== null && fraction < 0.2;
  return (
    <div
      data-ui="boss-summary"
      className={cn(
        'rounded-lg border border-line-soft bg-surface-2',
        compactLayout ? 'px-3 py-2.5' : 'px-4 py-3.5',
      )}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
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
        <span className="ml-auto text-xl font-semibold text-ink tabular-nums">
          {target.dead ? t(($) => $.boss.defeated) : fmt.pct(fraction)}
        </span>
      </div>
      <Meter
        size="md"
        className="flex w-full"
        fraction={target.dead ? 0 : fraction}
        color={low ? undefined : 'var(--color-rose)'}
        label={
          target.name ? t(($) => $.boss.hpMeter, { name: target.name }) : t(($) => $.boss.targetHp)
        }
        tone={low ? 'bad' : undefined}
      />
      <dl className="m-0 mt-3 grid grid-cols-3 gap-3">
        <BossFact
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
        <BossFact label={t(($) => $.boss.killIn)} title={t(($) => $.boss.killInTitle)}>
          {target.dead ? t(($) => $.boss.done) : ttkMs === null ? UNKNOWN : fmt.countdown(ttkMs)}
        </BossFact>
        <BossFact
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
  actions,
  initialPlayer = null,
  initialTab = 'damage',
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
  const [tab, setTab] = useState<ReportTab>(initialTab);
  const [playerId, setPlayerId] = useState<string | null>(initialPlayer);
  const [zoom, setZoom] = useState<TimeWindow | null>(null);
  const [focus, setFocus] = useState<{ at: number; seq: number } | null>(null);
  const [fightId, setFightId] = useState(report.id);
  const full = fullWindow(report);
  const total = full.to;
  const window = zoom ?? full;

  // A new fight (different id) resets selection and zoom, adjusted during render.
  if (fightId !== report.id) {
    setFightId(report.id);
    setZoom(null);
    setPlayerId(initialPlayer);
    setFocus(null);
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
    goTo: (next, at, id) => {
      setTab(next);
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
    colorOf: (p) => classColor(hideNames && p.local ? null : p.class),
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
        <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h3 className="mb-1 text-lg font-semibold tracking-tight text-ink">
              {title ??
                report.label ??
                (live ? t(($) => $.view.currentEncounter) : t(($) => $.view.combatLog))}
            </h3>
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
                report.run_id && (
                  <span key="run" title={t(($) => $.view.runTitle)}>
                    {report.run_id}
                  </span>
                ),
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onCopySummary && <CopySummary onCopy={onCopySummary} native={native} />}
            {actions}
          </div>
        </header>
        <StatStrip variant="open" columns="auto" className="mb-5">
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
          <Stat label={t(($) => $.view.players)} value={fmt.number.format(players.length)} />
          <Stat
            label={t(($) => $.view.deaths)}
            value={
              report.coverage.deaths === false && !deaths ? UNKNOWN : fmt.number.format(deaths)
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
        {projection && (
          <div className="mb-4">
            <BossSummary projection={projection} />
          </div>
        )}
        {report.events_truncated && (
          <Notice tone="info">
            {t(($) => $.view.truncated, { start: clock(report.event_window_start_ms ?? 0) })}
          </Notice>
        )}
        {(missing.length > 0 || report.warnings.length > 0) && (
          <Disclosure
            variant="plain"
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
              {id === 'damage' && <DamageView />}
              {id === 'healing' && <HealingView />}
              {id === 'taken' && <TakenView />}
              {id === 'deaths' && <DeathsView />}
              {id === 'highlights' && <HighlightsView />}
              {id === 'skills' && <SkillsView />}
              {id === 'rotation' && <RotationView />}
              {id === 'buffs' && <BuffsView />}
              {id === 'timeline' && <TimelineView focus={focus} />}
            </TabPanel>
          ))}
        </Tabs>
      </section>
    </ReportProvider>
  );
}
