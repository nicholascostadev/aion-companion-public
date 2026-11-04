import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { ClassIcon, OdyleIcon, SkillIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Menu, MenuTrigger } from '../../components/ui/Menu';
import { OverlayCaption, overlayWindow, WindowButton } from '../../components/ui/Overlay';
import { Pressable } from '../../components/ui/Pressable';
import { cn } from '../../lib/cn';
import { clock, UNKNOWN, type Formatters } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { captureState, type CaptureState } from '../../lib/capture';
import { DEFAULT_HOTKEYS } from '../../lib/offlineNormalize';
import { classColor, UNKNOWN_CLASS_COLOR } from '../../lib/classColors';
import { bossTargets, reportScope, targetMode } from '../../lib/targetScope';
import type { LiveStatus, OverlayStatus } from '../../types/companion';
import type { LogId, PolledOfflineStatus, ReportTotals, TargetMode } from '../../types/offline';
import type { MeterAlert } from '../alerts/model';
import type { GroupStatusData } from '../group/model';
import { bossProjection, dummyTimer } from '../offline/analysis';
import { TrackerChips } from '../offline/trackers';
import { bossStatus, type BossStatus } from './bossStatus';
import { HistoryMenu, usePinnedFight, type MeterLibrary } from './MeterHistory';
import {
  dpsFigure,
  fromReport,
  meterSummary,
  type MeterFocus,
  type MeterModel,
  type MeterPlayer,
} from './meterModel';
import { PreparationView } from './PreparationView';
import { useWindowDrag } from './windowDrag';

interface Props {
  status: LiveStatus;
  overlay: OverlayStatus;
  error: string;
  busy: boolean;
  onReset: () => void;
  onHide: () => void;
  /** Offline engine status: settings, live report, trackers and alerts. Optional. */
  offline?: PolledOfflineStatus | null;
  /** Copies text to the clipboard; the meter copies exactly what it shows. */
  onCopyText?: (text: string) => Promise<void>;
  /** Switches the meter to the compact strip; absent until settings are known. */
  onEnterStrip?: () => void;
  onExitStrip?: () => void;
  /** Saved fights for History; absent outside the native app. */
  library?: MeterLibrary;
  /** Opens full damage details for one player of exactly this fight. */
  onInspect?: (reportId: string, player: string) => void;
  /** Meter root, measured natively so locked controls stay clickable. */
  hitRef?: Ref<HTMLElement>;
  /** Starts a native window move; called while unlocked once a press on the meter travels. */
  onDrag?: () => void;
  /** Alerts open now or due within a few minutes, from the native alert engine. */
  nextAlerts?: MeterAlert[];
  /**
   * The party room and run state (`group_status`). While native reports a dungeon group
   * preparing for its run the meter shows only the room; absent, it never does.
   */
  group?: { status: GroupStatusData | null; native: boolean } | undefined;
}

const figure = 'whitespace-nowrap figures';
/** A small boxed tag beside a row's name (you, combat power). */
const nameTag =
  'inline-flex h-3.5 shrink-0 items-center gap-0.5 rounded-xs border px-1 text-4xs font-semibold leading-none figures';
/** A compact strip under the caption: what the meter is showing besides the fight. */
const strip = 'mx-1.5 mt-1 flex min-h-5.5 items-center gap-1.5 rounded-sm border px-1.5 text-3xs';
const capsLabel = 'text-4xs font-semibold tracking-wide text-ink-3 uppercase';
const statValue = 'm-0 text-xs font-bold whitespace-nowrap figures';
/** A label and its value (Kill 0:42, Rage 1:30): a clear gap inside, never split. */
const figurePair = 'inline-flex shrink-0 items-baseline gap-1.25';
/** Meter tabs stay quiet until chosen. */
const tabClass = 'border-transparent bg-transparent font-semibold text-ink-3';
/** A small outlined action that reads like a link (Back to live, Full details). */
const linkButton =
  'border-accent-line bg-transparent text-accent shadow-none enabled:hover:bg-accent-soft';

/**
 * How many whole rows fit the list's height: a row is never cut off, and enlarging the
 * window shows more. Measured from the rendered rows themselves (rectangles, so the
 * meter's scale applies to both sides); null until a row has a size, while every row
 * renders. The leader always shows; the list's minimum height keeps one row whole.
 * Re-measured after every render (rows appear, change or switch views, the scale
 * changes) and whenever the list resizes; equal counts do not render again.
 */
function useFittingRows() {
  const [list, setList] = useState<HTMLOListElement | null>(null);
  const [fit, setFit] = useState<number | null>(null);
  // Row pitch (height plus gap) over row height, so a lone row still steps by its gap
  // after the scale changed; remembered, as the second row it was measured from may
  // no longer render.
  const pitch = useRef(1);
  const measure = useCallback(() => {
    const rows = list?.querySelectorAll<HTMLElement>(':scope > [data-meter-row]');
    const first = rows?.[0]?.getBoundingClientRect();
    if (!list || !first?.height) return;
    const second = rows?.[1]?.getBoundingClientRect();
    if (second) pitch.current = Math.max(1, (second.top - first.top) / first.height);
    const step = first.height * pitch.current;
    const room = list.getBoundingClientRect().bottom - first.top + 0.5;
    setFit(Math.max(1, Math.floor((room - first.height) / step) + 1));
  }, [list]);
  useLayoutEffect(measure);
  useEffect(() => {
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list, measure]);
  return [setList, fit] as const;
}

/**
 * True once `activity` stayed the same for `seconds` (0 disables fading). While `hold`
 * is set the meter never fades, and the idle clock starts over once it is released.
 */
function useIdleFade(activity: string, seconds: number, hold: boolean) {
  const [now, setNow] = useState(() => Date.now());
  const [mark, setMark] = useState(() => ({ activity, hold, at: Date.now() }));
  // New activity (or a released hold) restarts the idle clock, adjusted during render.
  if (mark.activity !== activity || mark.hold !== hold) setMark({ activity, hold, at: now });
  // The clock keeps ticking while held, so a released hold restarts from the real time.
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return seconds > 0 && !hold && now - mark.at >= seconds * 1000;
}

/**
 * A finished boss fight (killed, cleared or otherwise ended), live or saved: its result
 * stays readable. Trash and dummy fights still fade when idle.
 */
const finishedBoss = (report: ReportTotals | null) =>
  report !== null && report.end_reason !== null && report.targets.some((x) => x.boss === true);

/**
 * What changes while anyone deals damage: the live status's event count and the live
 * report the meter shows. The status only counts your party's hits (none until you are
 * identified), so the report's damage keeps the meter lit while it is still growing.
 * Player totals follow the target scope (bosses only leaves out adds); the report's
 * targets never do, so hits on any enemy of the fight count. Player totals still add
 * damage dealt to players, which targets leave out.
 */
const combatActivity = (status: LiveStatus, report: ReportTotals | null) => {
  const total = (rows: { damage: number }[] = []) =>
    rows.reduce((sum, row) => sum + Math.max(0, row.damage), 0);
  return [status.events, report?.id ?? '', total(report?.players), total(report?.targets)].join(
    ':',
  );
};

/** A per-second figure in the interface language; unknown stays a dash. */
const perSecondOf = (t: Translate<'live'>, fmt: Formatters) => (value: number | null) =>
  value === null ? UNKNOWN : t(($) => $.units.perSecond, { value: dpsFigure(fmt, value) });

/** The rage timer as text; an unknown timer is a dash with its reason, never hidden. */
function rageLabel(boss: BossStatus, t: Translate<'live'>, fmt: Formatters) {
  const { rage } = boss;
  switch (rage.kind) {
    case 'none':
      return null;
    case 'unknown':
      return {
        value: UNKNOWN,
        title: t(($) => $.overlay.projection.rageUnknownTitle),
        tone: null,
        quiet: true,
      };
    case 'countdown':
      return {
        value: fmt.countdown(rage.ms),
        title: rage.frozen
          ? t(($) => $.overlay.projection.rageFrozenTitle)
          : t(($) => $.overlay.projection.rageTitle),
        tone: boss.pace,
        quiet: rage.frozen,
      };
    case 'enraged':
      return {
        value: t(($) => $.overlay.projection.enraged),
        title: t(($) => $.overlay.projection.enragedTitle),
        tone: 'bad' as const,
        quiet: rage.frozen,
      };
    case 'stopped':
      return {
        value: t(($) => $.overlay.projection.stopped),
        title: t(($) => $.overlay.projection.stoppedTitle),
        tone: null,
        quiet: true,
      };
  }
}

/** Current and maximum HP; before any HP is seen it says so instead of showing zero. */
function hpLabel(boss: BossStatus, t: Translate<'live'>, fmt: Formatters) {
  if (boss.current === null && boss.max === null) return t(($) => $.overlay.projection.hpPending);
  return t(($) => $.overlay.projection.hp, {
    current: fmt.maybe(boss.current, fmt.compact),
    max: fmt.maybe(boss.max, fmt.compact),
  });
}

/** Text colour for a rage value: pace and rage tint it, a frozen or settled timer is quiet. */
const rageTone = (rage: { tone: 'good' | 'bad' | null; quiet: boolean }) =>
  rage.tone === 'bad'
    ? 'text-danger'
    : rage.tone === 'good'
      ? 'text-success'
      : rage.quiet
        ? 'text-ink-2'
        : 'text-ink';

/**
 * Targets the shown damage was dealt to, in the chosen scope: with Bosses, the report's
 * bosses and dummies while it met any (native then counts only them); otherwise every
 * target hit, named when there is one.
 */
function targetCaption(report: ReportTotals | null, mode: TargetMode, t: Translate<'live'>) {
  const bosses = reportScope(report, mode) === 'boss';
  const shown = (
    bosses ? bossTargets(report) : (report?.targets ?? []).filter((x) => x.damage > 0)
  ).sort((a, b) => b.damage - a.damage);
  const names = shown.map((x) => x.name ?? t(($) => $.overlay.unknownTarget));
  const title = names.join(', ');
  if (shown.length === 1) return { text: names[0]!, title };
  if (bosses)
    return {
      text: t(($) => $.overlay.targetMore, {
        name: names[0]!,
        extra: shown.length - 1,
      }),
      title,
    };
  return { text: t(($) => $.overlay.allTargets), title };
}

export function DpsOverlay({
  status,
  overlay,
  error,
  busy,
  onReset,
  onHide,
  offline = null,
  onCopyText,
  onEnterStrip,
  onExitStrip,
  library,
  onInspect,
  hitRef,
  onDrag,
  nextAlerts = [],
  group,
}: Props) {
  const { t } = useTranslation('live');
  const { t: tc } = useTranslation('common');
  const fmt = useFormat();
  const perSecond = perSecondOf(t, fmt);
  const captureLabel = (state: CaptureState) => tc(($) => $.capture.label[state]);
  // What the last copy did; worded on render so it follows a language change.
  const [copied, setCopied] = useState<{ ok: true } | { ok: false; detail: string } | null>(null);
  const [pinned, setPinned] = useState<LogId | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listRef, fit] = useFittingRows();
  // The history menu hangs from the caption it opens from, mounted inside the meter.
  const captionRef = useRef<HTMLElement>(null);
  const [choice, setChoice] = useState<{
    fight: string;
    focus: MeterFocus;
  } | null>(null);
  const locked = overlay.locked;
  // Unlocked, the whole meter moves the window; locked, it stays where it is.
  const drag = useWindowDrag(locked ? undefined : onDrag);
  const settings = offline?.settings ?? null;
  const liveReport = offline?.report ?? null;
  const hotkeys = settings?.hotkeys ?? DEFAULT_HOTKEYS;
  const hideNames = settings?.hide_names ?? false;
  const mode = settings?.dps_mode ?? 'encounter';
  const scope = targetMode(settings);
  const saved = usePinnedFight(library ?? null, pinned, scope === 'boss');
  const shown = pinned ? saved.report : liveReport;
  // Native alone decides when a dungeon group is preparing; the room is then the meter's only
  // content, with no way to the fight until the run starts. Pre-run hits never count.
  const showRoom =
    group !== undefined && group.status?.room === true && group.status.preparing === true;
  // The fight's History menu and an opened saved fight belong to the fight: neither outlasts
  // preparation, so the run starts on the live meter.
  if (showRoom && historyOpen) setHistoryOpen(false);
  if (showRoom && pinned !== null) setPinned(null);

  // One native report drives the table, summary, Copy and player details: the pinned
  // fight, else the live report. Native aggregates it in the chosen target scope (every
  // target, or bosses and dummies while any were met) and owns every total. The raw
  // LiveStatus totals ignore that scope, so without a report the meter waits rather than
  // fall back to them and show trash damage as a boss's.
  const model: MeterModel | null = useMemo(() => {
    if (pinned)
      return saved.report ? fromReport(saved.report, { hideNames, mode, running: false, t }) : null;
    return liveReport
      ? fromReport(liveReport, { hideNames, mode, running: status.running, t })
      : null;
  }, [pinned, saved.report, liveReport, status.running, hideNames, mode, t]);

  const fight = pinned ? `saved:${pinned}` : `live:${model?.reportId ?? ''}`;
  // Hidden names keep your own class private, so your colour never reveals it either.
  const colorOf = (p: Pick<MeterPlayer, 'class' | 'local'>) =>
    classColor(hideNames && p.local ? null : p.class);
  const chosen = choice?.fight === fight ? choice.focus : null;
  const focus: MeterFocus = chosen ?? { kind: 'ranking' };
  const select = (next: MeterFocus) => setChoice({ fight, focus: next });
  const player: MeterPlayer | null =
    focus.kind === 'player' ? (model?.everyone.find((p) => p.id === focus.id) ?? null) : null;
  const localId = model?.localId ?? null;
  const viewingOther = focus.kind === 'player' && focus.id !== localId;
  const detailsId = pinned ?? model?.reportId ?? null;

  // The live boss line; an ended report freezes it (a saved fight has none).
  const boss = useMemo(
    () =>
      pinned
        ? null
        : bossStatus(bossProjection(liveReport), (liveReport?.end_reason ?? null) !== null),
    [pinned, liveReport],
  );
  const bossName = boss ? (boss.name ?? t(($) => $.overlay.unknownTarget)) : '';
  const rage = boss ? rageLabel(boss, t, fmt) : null;
  const dummy = pinned ? null : dummyTimer(liveReport, settings?.dummy_length_seconds ?? 0);
  const faded = useIdleFade(
    combatActivity(status, liveReport),
    settings?.fade_after_seconds ?? 0,
    // A finished boss keeps its result readable, and the room stays readable while preparing.
    finishedBoss(shown) || showRoom,
  );
  // Chips are a fallback for when the in-game tracker surface is not in use.
  const trackers = overlay.trackers_requested ? [] : (offline?.trackers ?? []);
  // Capture runs in the background from app launch; the meter only reports its state.
  const capture = captureState(status);
  const live = capture === 'capturing' && !pinned;
  // The footer leads with Odyle energy; only a problem shares it, never routine status.
  const problem =
    error ||
    overlay.errors.join(' · ') ||
    (capture === 'error' ? status.message || captureLabel('error') : '') ||
    (copied && !copied.ok ? copied.detail : '') ||
    saved.error;
  const style = {
    '--base-opacity': settings?.opacity ?? 1,
    opacity: faded ? (settings?.fade_opacity ?? 1) : (settings?.opacity ?? 1),
    zoom: settings?.scale ?? 1,
  } as CSSProperties;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    if (!model || !onCopyText) return;
    const text = meterSummary(model, focus, {
      caption: targetCaption(shown, scope, t).text,
      rows: fit,
      t,
      fmt,
    });
    void onCopyText(text).then(
      () => setCopied({ ok: true }),
      (cause: unknown) => setCopied({ ok: false, detail: String(cause) }),
    );
  };
  const pin = (id: LogId | null) => {
    setPinned(id);
    setHistoryOpen(false);
  };

  if (showRoom)
    // The compact strip is a fight preference: the room always shows in full, and the
    // strip returns with the fight.
    return (
      <PreparationView
        group={group?.status ?? null}
        native={group?.native ?? false}
        error={problem}
        locked={locked}
        style={style}
        hitRef={hitRef}
        drag={drag}
        hotkeys={hotkeys}
        onHide={onHide}
      />
    );

  if (settings?.compact_strip) {
    const leader = model?.players[0];
    return (
      <section
        className={cn(
          'flex min-h-[30px] items-center gap-2.5 rounded-lg border bg-shade py-0.5 pr-1 pl-3',
          'text-xs text-ink text-halo inset-shadow-light transition-opacity duration-400 ease-grow select-none',
          locked ? 'border-line-strong' : 'cursor-move border-accent-line',
          faded && 'hover:opacity-(--base-opacity)!',
        )}
        data-variant="strip"
        // Solid like the full meter; only the idle fade lets the game through.
        data-glass="deep"
        data-state={faded ? 'faded' : undefined}
        aria-label={t(($) => $.overlay.label)}
        style={style}
        ref={hitRef}
        {...drag}
      >
        <span className={cn('inline-flex shrink-0', live ? 'text-accent' : 'text-ink-3')}>
          <StatusDot live={live} className="size-1.5 text-current" />
          <span className="sr-only">
            {pinned ? t(($) => $.overlay.savedFight) : captureLabel(capture)}
          </span>
        </span>
        <span className="font-semibold whitespace-nowrap figures">
          {clock(model?.durationMs ?? 0)}
        </span>
        <span
          className="font-semibold whitespace-nowrap text-accent figures"
          title={t(($) => $.overlay.totalDps)}
        >
          {dpsFigure(fmt, model?.totalDps ?? 0)}
        </span>
        {boss && (
          <span
            className="inline-flex items-baseline gap-1 font-semibold whitespace-nowrap figures"
            title={`${t(($) => $.overlay.targetHp, { name: bossName })} · ${hpLabel(boss, t, fmt)}`}
          >
            <small className="text-3xs font-semibold text-rose-ink">
              {t(($) => $.overlay.projection.hpShort)}
            </small>{' '}
            {boss.dead ? t(($) => $.overlay.dead) : fmt.pct(boss.fraction, 0)}
          </span>
        )}
        {rage && (
          <span
            className="inline-flex items-baseline gap-1 font-semibold whitespace-nowrap figures"
            title={rage.title}
          >
            <small className="text-3xs font-semibold text-ink-3">
              {t(($) => $.overlay.projection.rage)}
            </small>{' '}
            <span className={rageTone(rage)} data-tone={rage.tone ?? undefined}>
              {rage.value}
            </span>
          </span>
        )}
        {leader && (
          <span
            className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-ink-2"
            title={leader.title}
          >
            <ClassIcon name={hideNames && leader.local ? null : leader.class} size={15} solid />
            {leader.name} {dpsFigure(fmt, leader.dps)}
          </span>
        )}
        {!locked && onExitStrip && (
          <WindowButton
            size="2xs"
            className="ml-auto"
            onClick={onExitStrip}
            title={
              hotkeys.compact_strip
                ? t(($) => $.overlay.fullMeterHotkey, {
                    hotkey: hotkeys.compact_strip,
                  })
                : t(($) => $.overlay.fullMeter)
            }
            aria-label={t(($) => $.overlay.showFullMeter)}
          >
            <Icon name="meter" size={13} />
          </WindowButton>
        )}
      </section>
    );
  }

  const ranking = focus.kind === 'ranking';
  const rows = ranking ? (model?.players ?? []) : (player?.skills ?? []);
  const visible = fit === null ? rows : rows.slice(0, fit);
  const top = Math.max(1, ...rows.map((r) => r.damage));
  const caption = targetCaption(shown, scope, t);
  const skillColor = player ? colorOf(player) : UNKNOWN_CLASS_COLOR;
  // The boss bar already names its target; the caption then says what the meter counts
  // instead of naming it twice. Several targets keep their name in the caption.
  const headline = !boss || caption.text !== bossName;
  // An ended fight keeps its result and duration without an "ended since" line.
  const context = pinned
    ? ''
    : model?.source === 'report' && model.startedMs !== null
      ? model.ended
        ? ''
        : t(($) => $.overlay.liveSince, {
            time: fmt.hourMinute(model.startedMs),
          })
      : capture === 'capturing'
        ? t(($) => $.overlay.waitingForCombat)
        : captureLabel(capture);
  // The ranking needs no summary: its rows carry each player's DPS, combat power and share. A
  // chosen player's own figures stay as one quiet line above their skills, with their
  // average DPS only.
  const dpsLabel = mode === 'active' ? t(($) => $.overlay.activeDps) : t(($) => $.overlay.avgDps);
  const stats = player
    ? [
        {
          label: dpsLabel,
          value: perSecond(player.dps),
        },
        {
          label: t(($) => $.overlay.damage),
          value: fmt.compact.format(player.damage),
        },
        { label: t(($) => $.overlay.share), value: fmt.pct(player.share, 1) },
      ]
    : [];
  // A boss met but not yet hit by anyone counted reads as such, never as idle.
  const bossMet = bossTargets(shown).length > 0;
  const empty =
    pinned && !model
      ? saved.loading
        ? t(($) => $.overlay.empty.loadingSaved)
        : t(($) => $.overlay.empty.savedUnavailable)
      : !ranking
        ? t(($) => $.overlay.empty.noDamage)
        : bossMet
          ? t(($) => $.overlay.empty.noBossDamage)
          : capture === 'capturing' || pinned
            ? t(($) => $.overlay.empty.waitingForCombat)
            : capture === 'error'
              ? t(($) => $.overlay.empty.captureUnavailable)
              : t(($) => $.overlay.empty[capture]);
  const emptyHint =
    pinned || bossMet || model?.players.length
      ? ''
      : capture === 'capturing'
        ? t(($) => $.overlay.empty.hitTarget)
        : tc(($) => $.capture.hint[capture]);
  const canDetail = Boolean(onInspect && detailsId && player);
  const openDetails = () => {
    if (onInspect && detailsId && player) onInspect(detailsId, player.id);
  };
  const mine = focus.kind === 'player' && focus.id === localId;
  const me = model?.everyone.find((p) => p.local) ?? null;
  const stateLabel = pinned ? t(($) => $.overlay.savedFight) : captureLabel(capture);
  const lockLabel = locked ? t(($) => $.overlay.lock.locked) : t(($) => $.overlay.lock.unlocked);
  // Open or imminent events light the strip; later ones keep it quiet.
  const urgent = nextAlerts.some((a) => a.open || a.remainingMs <= 60_000);
  /**
   * A two-line row: art, then the name with its tags over a detail line (combat power in
   * the ranking); the headline figure (a player's DPS, a skill's damage) sits large at the
   * right over the share. The bar grows behind it all, by damage.
   */
  const row = ({
    index,
    damage,
    share,
    art,
    name,
    title,
    tags,
    detail,
    figure: headline,
  }: {
    index: number;
    damage: number;
    share: number;
    art: ReactNode;
    name: string;
    title: string;
    tags?: ReactNode;
    detail?: ReactNode;
    figure: { value: string; cell: 'dps' | 'damage'; title: string };
  }) => (
    <>
      {/* The bar takes the row's class colour (`--mark`), deepening towards its leading edge.
          It has no corners of its own: the row clips it to the inner curve of its border, so a
          full bar meets the border with no gap. */}
      <span
        className={cn(
          'meter-bar absolute inset-y-0 left-0 -z-10 origin-left animate-grow',
          'transition-[width] duration-300 ease-grow',
          index === 0 ? 'bg-mark-fade-35' : 'bg-mark-fade-25',
        )}
        aria-hidden="true"
        style={{ width: `${(damage / top) * 100}%` }}
      />
      <span className="meter-name flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex size-5.5 shrink-0 items-center justify-center">{art}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1 text-xs font-semibold" data-cell="name">
            <span className="min-w-0 truncate" title={title}>
              {name}
            </span>
            {tags}
          </span>
          {detail}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span
          className={cn(figure, 'text-sm leading-4 font-bold text-ink')}
          data-cell={headline.cell}
          title={headline.title}
        >
          {headline.value}
        </span>
        <span className={cn(figure, 'text-3xs text-ink-3')} data-cell="share">
          {fmt.pct(share, 1)}
        </span>
      </span>
    </>
  );
  // A row is edged and filled in its class colour (a player's, or the chosen player's for
  // their skills); the leader is told by its stronger bar. Rows that open something are
  // Pressables and light up on hover.
  const rowProps = (interactive: boolean, color: string) => ({
    className: cn(
      'meter-row relative isolate flex min-h-7 w-full items-center gap-1.5 overflow-hidden rounded-sm border border-(--mark) bg-row-hover py-px pr-1.5 pl-1 text-left leading-tight font-normal text-ink',
      interactive && 'transition-[background-color] duration-150 hover:bg-accent-soft',
    ),
    style: { '--mark': color } as CSSProperties,
  });

  return (
    // Solid, not see-through: the game never shows behind the figures. Only the idle fade
    // (the whole window's opacity) lets it through.
    <section
      className={overlayWindow({
        editing: !locked,
        className: cn('text-2xs leading-snug', faded && 'hover:opacity-(--base-opacity)!'),
      })}
      data-glass="deep"
      data-state={faded ? 'faded' : undefined}
      aria-label={t(($) => $.overlay.label)}
      style={style}
      ref={hitRef}
      {...drag}
    >
      <OverlayCaption
        ref={captionRef}
        className={cn('relative h-7 gap-1.5 pr-1 pl-2', !locked && 'cursor-move')}
      >
        <span
          className={cn('inline-flex shrink-0', live ? 'text-accent' : 'text-ink-3')}
          // The timer in this caption carries the same state for assistive technology.
          aria-hidden="true"
          title={stateLabel}
        >
          <StatusDot live={live} className="size-1.5 text-current" />
        </span>
        {/* The elapsed time sits right beside the title, on the same baseline. */}
        <span className="flex min-w-0 shrink-[4] items-baseline gap-1.5">
          {headline ? (
            <b
              className="min-w-0 truncate text-xs font-semibold text-ink"
              title={caption.title || undefined}
            >
              {caption.text}
            </b>
          ) : (
            <b
              className="min-w-0 truncate text-xs font-semibold text-ink-2"
              title={t(($) => $.overlay.outgoingTitle)}
            >
              {t(($) => $.overlay.damageDealt)}
            </b>
          )}
          <span
            className={cn(
              'shrink-0 text-2xs font-semibold figures',
              live ? 'text-ink' : 'text-ink-2',
            )}
            title={pinned ? t(($) => $.overlay.savedDuration) : captureLabel(capture)}
          >
            {clock(model?.durationMs ?? 0)}
          </span>
        </span>
        {viewingOther && (
          <Chip
            size="xs"
            className={cn(tabClass, 'block max-w-24 min-w-0 shrink truncate')}
            data-hit
            pressed
            title={
              player
                ? t(($) => $.overlay.skillsOfBack, { name: player.title })
                : t(($) => $.overlay.backToRanking)
            }
            onClick={() => select({ kind: 'ranking' })}
          >
            {player?.name ?? t(($) => $.overlay.player)}
          </Chip>
        )}
        <span className="ml-auto flex shrink-0">
          {localId && (
            <WindowButton
              size="2xs"
              className={cn(mine && 'bg-accent-soft text-accent')}
              data-hit
              aria-pressed={mine}
              aria-label={t(($) => $.overlay.myDps)}
              title={mine ? t(($) => $.overlay.backToRanking) : t(($) => $.overlay.yourSkills)}
              onClick={() => select(mine ? { kind: 'ranking' } : { kind: 'player', id: localId })}
            >
              <Icon name="activity" size={12} />
            </WindowButton>
          )}
          {library && (
            <Menu open={historyOpen} onOpenChange={setHistoryOpen} modal={false}>
              <MenuTrigger
                render={
                  <WindowButton
                    size="2xs"
                    className={cn((pinned || historyOpen) && 'text-accent')}
                    data-hit
                    title={t(($) => $.overlay.historyTitle)}
                    aria-label={t(($) => $.overlay.history)}
                  />
                }
              >
                <Icon name="history" size={12} />
              </MenuTrigger>
              <HistoryMenu
                library={library}
                pinned={pinned}
                onPick={pin}
                onLive={() => pin(null)}
                container={captionRef}
                anchor={captionRef}
              />
            </Menu>
          )}
          {onCopyText && (
            <WindowButton
              size="2xs"
              className={cn(copied?.ok && 'text-accent')}
              data-hit
              data-state={copied?.ok ? 'copied' : undefined}
              onClick={copy}
              disabled={!model}
              title={copied?.ok ? t(($) => $.overlay.copied) : t(($) => $.overlay.copyTitle)}
              aria-label={t(($) => $.overlay.copy)}
            >
              {/* Copying confirms on the button itself; the footer stays the status line. */}
              <Icon name={copied?.ok ? 'check' : 'copy'} size={12} />
            </WindowButton>
          )}
          <WindowButton
            size="2xs"
            data-hit
            disabled={busy || pinned !== null}
            onClick={onReset}
            title={
              pinned
                ? t(($) => $.overlay.returnToLive)
                : hotkeys.reset
                  ? t(($) => $.overlay.newFightHotkey, {
                      hotkey: hotkeys.reset,
                    })
                  : t(($) => $.overlay.newFight)
            }
            aria-label={t(($) => $.overlay.newFight)}
          >
            <Icon name="reset" size={12} />
          </WindowButton>
        </span>
        {!locked && (
          <span className="flex shrink-0 border-l border-line-soft pl-0.5">
            {onEnterStrip && (
              <WindowButton
                size="2xs"
                onClick={onEnterStrip}
                title={
                  hotkeys.compact_strip
                    ? t(($) => $.overlay.compactStripHotkey, {
                        hotkey: hotkeys.compact_strip,
                      })
                    : t(($) => $.overlay.compactStrip)
                }
                aria-label={t(($) => $.overlay.showCompactStrip)}
              >
                <Icon name="compact" size={13} />
              </WindowButton>
            )}
            <WindowButton
              size="2xs"
              onClick={onHide}
              title={
                hotkeys.toggle_overlay
                  ? t(($) => $.overlay.hideHotkey, {
                      hotkey: hotkeys.toggle_overlay,
                    })
                  : t(($) => $.overlay.hideMenu)
              }
              aria-label={t(($) => $.overlay.hide)}
            >
              <Icon name="minus" size={13} />
            </WindowButton>
          </span>
        )}
      </OverlayCaption>
      {pinned && (
        // A saved fight says so under the caption, with the way back to the live one.
        <div className={cn(strip, 'border-accent-line bg-accent-soft')}>
          <Icon name="history" size={11} className="text-accent" />
          <span className="min-w-0 flex-1 truncate text-ink-2">
            {t(($) => $.overlay.savedAt, {
              date: fmt.dateTime(shown?.started_ms ?? null),
            })}
          </span>
          <Button
            variant="secondary"
            size="2xs"
            className={cn(linkButton, 'h-4.5 px-1.5')}
            data-hit
            onClick={() => pin(null)}
          >
            <Icon name="live" size={11} />
            {t(($) => $.overlay.backToLive)}
          </Button>
        </div>
      )}
      {nextAlerts.length > 0 && (
        // Every open or near event, in one strip, so overlapping events (an open festival
        // and a rift) both show; they wrap rather than hide behind a count.
        <div
          className={cn(
            strip,
            'py-0.5',
            urgent ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-ink-3',
          )}
        >
          <Icon name="bell" size={11} />
          <div
            className="flex min-w-0 flex-1 flex-wrap gap-x-2.5 gap-y-0.5"
            aria-label={t(($) => $.overlay.alert.label)}
          >
            {nextAlerts.map((alert) => (
              <span
                key={alert.key}
                className={cn(
                  'inline-flex max-w-full min-w-0 items-baseline gap-1 figures',
                  alert.open || alert.remainingMs <= 60_000 ? 'text-accent' : 'text-ink-3',
                )}
              >
                <b className="truncate font-semibold text-ink">
                  {alert.name || t(($) => $.overlay.alert.fallback)}
                </b>{' '}
                {alert.open
                  ? t(($) => $.overlay.alert.open)
                  : alert.remainingMs > 0
                    ? fmt.countdown(alert.remainingMs)
                    : t(($) => $.overlay.alert.now)}
              </span>
            ))}
          </div>
        </div>
      )}
      {boss && (
        // Boss status: a labelled HP bar, then kill estimate and rage on one quiet line.
        <section
          className="mx-1.5 mt-1"
          aria-label={t(($) => $.overlay.projection.label)}
          data-rage={boss.rage.kind}
        >
          <div
            className={cn(
              'relative isolate flex min-h-[18px] items-center gap-1.5 overflow-hidden rounded-sm border bg-shade/50 px-1.5 text-halo',
              boss.rage.kind === 'enraged' ? 'border-danger-line' : 'border-rose/45',
            )}
            title={t(($) => $.overlay.targetHp, { name: bossName })}
          >
            {boss.fraction === null ? (
              <span
                className="absolute inset-0 -z-10 bg-hatch"
                data-state="unknown"
                aria-hidden="true"
              />
            ) : (
              <span
                className="absolute inset-y-0 left-0 -z-10 bg-rose/40 transition-[width] duration-300 ease-grow"
                aria-hidden="true"
                style={{ width: `${boss.fraction * 100}%` }}
              />
            )}
            {/* One shared baseline for the label, name and health, centred in the bar as a line. */}
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 text-4xs font-semibold tracking-wide text-rose-ink uppercase">
                {boss.role === 'boss'
                  ? t(($) => $.overlay.boss)
                  : boss.role === 'dummy'
                    ? t(($) => $.overlay.projection.dummy)
                    : t(($) => $.overlay.target)}
              </span>
              <b className="min-w-0 flex-1 truncate text-xs font-bold text-ink">{bossName}</b>
              <b
                className={cn(
                  'shrink-0 text-xs font-bold figures',
                  boss.dead ? 'text-ink-2' : 'text-ink',
                )}
              >
                {boss.dead ? t(($) => $.overlay.projection.defeated) : fmt.pct(boss.fraction)}
              </b>
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 px-1 text-3xs whitespace-nowrap text-ink-3">
            <span
              className={figurePair}
              title={
                boss.killSource === 'hp'
                  ? t(($) => $.overlay.projection.hpTitle)
                  : boss.killSource === 'damage'
                    ? t(($) => $.overlay.projection.damageTitle)
                    : undefined
              }
            >
              {t(($) => $.overlay.projection.kill)}{' '}
              <b className="text-ink figures">
                {boss.dead
                  ? t(($) => $.overlay.projection.done)
                  : boss.killMs === null
                    ? UNKNOWN
                    : fmt.countdown(boss.killMs)}
              </b>
            </span>
            {rage && (
              <span className={figurePair} title={rage.title} data-tone={rage.tone ?? undefined}>
                {t(($) => $.overlay.projection.rage)}{' '}
                <b className={cn('figures', rageTone(rage))}>{rage.value}</b>
              </span>
            )}
            {dummy && (
              <span className={figurePair}>
                {t(($) => $.overlay.projection.dummyTime)}{' '}
                <b className="text-ink figures">
                  {dummy.remainingMs > 0
                    ? fmt.countdown(dummy.remainingMs)
                    : t(($) => $.overlay.projection.done)}
                </b>
              </span>
            )}
          </div>
        </section>
      )}
      <TrackerChips trackers={trackers} limit={6} />
      {stats.length > 0 && (
        <dl className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 px-2 pt-1">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className={capsLabel}>{stat.label}</dt>
              <dd className={statValue}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ol
        ref={listRef}
        className="m-0 min-h-8 flex-1 list-none overflow-hidden px-1.5 pt-1"
        aria-label={
          ranking
            ? t(($) => $.overlay.playersByDamage)
            : player
              ? t(($) => $.overlay.skillsOf, { name: player.name })
              : t(($) => $.overlay.skillsOfPlayer)
        }
        data-hit-clip
      >
        {ranking
          ? model?.players.slice(0, visible.length).map((p, index) => (
              <li key={p.id} className="mb-0.5 block" data-meter-row>
                <Pressable
                  {...rowProps(true, colorOf(p))}
                  data-hit="row"
                  aria-label={t(($) => $.overlay.skillsOf, { name: p.name })}
                  onClick={() => select({ kind: 'player', id: p.id })}
                >
                  {row({
                    index,
                    damage: p.damage,
                    share: p.share,
                    // Hidden names keep your own class private, as the text does.
                    art: <ClassIcon name={hideNames && p.local ? null : p.class} size={22} solid />,
                    name: p.name,
                    title: p.title,
                    tags: (
                      <>
                        {p.local && !hideNames && (
                          <>
                            {' '}
                            {/* Capitals (ME, EU), trimmed to cap height and baseline so the
                                word sits in the middle of its box whatever the font's metrics. */}
                            <span
                              className={cn(
                                nameTag,
                                'justify-center border-accent-line text-accent',
                              )}
                            >
                              <span className="[text-box:trim-both_cap_alphabetic]">
                                {t(($) => $.names.meBadge)}
                              </span>
                            </span>
                          </>
                        )}
                        {/* Only deaths the game reported; none observed shows no badge. */}
                        {p.deaths !== null && p.deaths > 0 && (
                          <>
                            {' '}
                            <span
                              className={cn(nameTag, 'border-danger-line text-danger')}
                              data-cell="deaths"
                              title={t(($) => $.overlay.deaths, {
                                value: fmt.integer.format(p.deaths),
                              })}
                            >
                              <Icon name="death" size={9} />
                              {fmt.integer.format(p.deaths)}
                            </span>
                          </>
                        )}
                      </>
                    ),
                    // Hidden names also hide every combat power, which could identify a player.
                    // Every row has a power line; one never observed says so, never shows GS.
                    detail: !hideNames && (
                      <span
                        className={cn(
                          figure,
                          'text-3xs font-semibold',
                          p.combatPower === null ? 'text-ink-3' : 'text-ink-2',
                        )}
                        data-cell="combat-power"
                        title={
                          p.combatPower === null
                            ? t(($) => $.overlay.combatPowerUnknown)
                            : t(($) => $.overlay.combatPower)
                        }
                      >
                        {fmt.maybe(p.combatPower, fmt.compact)}{' '}
                        <span className="text-4xs text-ink-3">
                          {t(($) => $.overlay.combatPowerUnit)}
                        </span>
                      </span>
                    ),
                    figure: {
                      value: dpsFigure(fmt, p.dps),
                      cell: 'dps',
                      title: dpsLabel,
                    },
                  })}
                </Pressable>
              </li>
            ))
          : player?.skills.slice(0, visible.length).map((s, index) => {
              const cells = row({
                index,
                damage: s.damage,
                share: s.share,
                art: <SkillIcon id={s.skillId} size={20} />,
                name: s.name,
                title: s.name,
                // A skill's own figure is its damage; native reports no per-skill DPS.
                figure: {
                  value: fmt.compact.format(s.damage),
                  cell: 'damage',
                  title: t(($) => $.overlay.damage),
                },
              });
              return (
                <li key={s.id} className="mb-0.5 block" data-meter-row>
                  {canDetail ? (
                    <Pressable
                      {...rowProps(true, skillColor)}
                      data-hit="row"
                      aria-label={t(($) => $.overlay.skillDetails, {
                        name: s.name,
                      })}
                      onClick={openDetails}
                    >
                      {cells}
                    </Pressable>
                  ) : (
                    <div {...rowProps(false, skillColor)}>{cells}</div>
                  )}
                </li>
              );
            })}
        {!rows.length && (
          <li className="px-1.5 py-3 text-center text-ink-3">
            {empty}
            {emptyHint && <small className="mt-1 block text-3xs opacity-85">{emptyHint}</small>}
          </li>
        )}
      </ol>
      <footer className="flex min-h-5.5 items-center gap-2 border-t border-line-soft bg-sunken/40 py-px pr-1.5 pl-2 text-3xs">
        {me && (
          // Who this meter belongs to; hidden names keep the class private here too.
          <span
            className="inline-flex max-w-28 min-w-0 shrink items-center gap-1 font-semibold text-ink-2"
            title={me.title}
          >
            <ClassIcon name={hideNames ? null : me.class} size={14} solid />
            <span className="truncate">{me.name}</span>
          </span>
        )}
        {/* Original game energy icon and captured balance; unknown stays a dash, never zero. */}
        <dl
          className="m-0 inline-flex shrink-0 items-center gap-1 text-2xs whitespace-nowrap figures"
          title={t(($) => $.overlay.odyle.title)}
        >
          <dt className={capsLabel}>
            <OdyleIcon label={t(($) => $.overlay.odyle.name)} />
          </dt>
          <dd className="m-0 inline-flex items-baseline gap-1">
            <b className="font-bold text-ink">{fmt.maybe(status.odyle?.base, fmt.integer)}</b>
            <span className="font-semibold text-jade-ink">
              {t(($) => $.overlay.odyle.bonus, {
                bonus: fmt.maybe(status.odyle?.bonus, fmt.integer),
              })}
            </span>
          </dd>
        </dl>
        <output
          className="min-w-0 flex-1 truncate text-left text-danger"
          aria-label={t(($) => $.overlay.status)}
          title={problem || undefined}
        >
          {problem}
        </output>
        {!problem && context && (
          // Capture state and when this fight began; a problem takes the room instead.
          <span
            className={cn(
              'inline-flex min-w-0 shrink items-center gap-1',
              live ? 'text-ink-2' : 'text-ink-3',
            )}
          >
            <Icon name="live" size={11} className={live ? 'text-accent' : undefined} />
            <span className="truncate">{context}</span>
          </span>
        )}
        {canDetail && (
          <Button
            variant="secondary"
            size="2xs"
            className={cn(linkButton, 'h-4.5 px-1.5')}
            data-hit
            onClick={openDetails}
            title={t(($) => $.overlay.fullDetailsTitle)}
          >
            <Icon name="external" size={11} />
            {t(($) => $.overlay.fullDetails)}
          </Button>
        )}
        <span
          className={cn('inline-flex shrink-0', locked ? 'text-ink-3' : 'text-accent')}
          title={
            hotkeys.toggle_lock
              ? t(($) => $.overlay.lock.withHotkey, {
                  state: lockLabel,
                  hotkey: hotkeys.toggle_lock,
                })
              : lockLabel
          }
        >
          <Icon name={locked ? 'lock' : 'unlock'} size={11} />
          <span className="sr-only">{lockLabel}</span>
        </span>
      </footer>
    </section>
  );
}
