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
import { bossProjection, dummyTimer } from '../offline/analysis';
import { TrackerChips } from '../offline/trackers';
import { bossStatus, type BossStatus } from './bossStatus';
import { HistoryMenu, usePinnedFight, type MeterLibrary } from './MeterHistory';
import {
  fromReport,
  meterSummary,
  type MeterFocus,
  type MeterModel,
  type MeterPlayer,
} from './meterModel';
import { useWindowDrag } from './windowDrag';

interface Props {
  status: LiveStatus;
  overlay: OverlayStatus;
  error: string;
  busy: boolean;
  onReset: () => void;
  onHide: () => void;
  onQuit: () => void;
  /** Offline engine status: settings, live report, trackers and alerts. Optional. */
  offline?: PolledOfflineStatus | null;
  /** Copies text to the clipboard; the meter copies exactly what it shows. */
  onCopyText?: (text: string) => Promise<void>;
  onExitStrip?: () => void;
  /** Saved fights for History; absent outside the native app. */
  library?: MeterLibrary;
  /** Opens full damage details for one player of exactly this fight. */
  onInspect?: (reportId: string, player: string) => void;
  /** Meter root, measured natively so locked controls stay clickable. */
  hitRef?: Ref<HTMLElement>;
  /** Starts a native window move; called while unlocked once a press on the meter travels. */
  onDrag?: () => void;
  /** The next alert due within a few minutes (or open now), from the native alert engine. */
  nextAlert?: { name: string; remainingMs: number; open: boolean } | null;
}

/** A row's columns: name, then right-aligned figures (DPS in the ranking only). */
const rankingGrid = 'grid grid-cols-[minmax(0,1fr)_2.75rem_2.5rem_2.625rem] items-center gap-1.25';
const skillGrid = 'grid grid-cols-[minmax(0,1fr)_2.75rem_2.625rem] items-center gap-1.25';
const figure = 'text-right whitespace-nowrap tabular-nums';
const capsLabel = 'text-4xs font-semibold tracking-wide text-ink-3 uppercase';
const statValue = 'm-0 text-xs font-bold whitespace-nowrap tabular-nums';
/** A label and its value (Kill 0:42, Rage 1:30): a clear gap inside, never split. */
const figurePair = 'inline-flex shrink-0 items-baseline gap-1.25';
/**
 * A slight round shade behind class art, so it reads over any class colour; no layout
 * change. The emblems sit inside their circle, so rounding never clips the artwork.
 */
const classPlate = 'rounded-full bg-shade/30';
/** Meter tabs stay quiet until chosen. */
const tabClass = 'border-transparent bg-transparent font-semibold text-ink-3';
/** A small outlined action that reads like a link (Back to live, Full details). */
const linkButton =
  'rounded-md border-accent-line bg-transparent text-accent shadow-none enabled:hover:bg-accent-soft';

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
 * True once no new combat events arrived for `seconds` (0 disables fading). While `hold`
 * is set the meter never fades, and the idle clock starts over once it is released.
 */
function useIdleFade(events: number, seconds: number, hold: boolean) {
  const [now, setNow] = useState(() => Date.now());
  const [mark, setMark] = useState(() => ({ events, hold, at: Date.now() }));
  // New events (or a released hold) restart the idle clock, adjusted during render.
  if (mark.events !== events || mark.hold !== hold) setMark({ events, hold, at: now });
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

/** A per-second figure in the interface language; unknown stays a dash. */
const perSecondOf = (t: Translate<'live'>, fmt: Formatters) => (value: number | null) =>
  value === null
    ? UNKNOWN
    : t(($) => $.units.perSecond, { value: fmt.compact.format(Math.max(0, value)) });

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
      text: t(($) => $.overlay.targetMore, { name: names[0]!, extra: shown.length - 1 }),
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
  onQuit,
  offline = null,
  onCopyText,
  onExitStrip,
  library,
  onInspect,
  hitRef,
  onDrag,
  nextAlert = null,
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
  const [choice, setChoice] = useState<{ fight: string; focus: MeterFocus } | null>(null);
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
  const faded = useIdleFade(status.events, settings?.fade_after_seconds ?? 0, finishedBoss(shown));
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

  if (settings?.compact_strip) {
    const leader = model?.players[0];
    return (
      <section
        className={cn(
          'flex min-h-[30px] items-center gap-2.5 rounded-full border bg-shade/70 py-0.5 pr-1 pl-3',
          'text-xs text-ink text-halo inset-shadow-light transition-opacity duration-400 ease-grow select-none',
          locked ? 'border-line-strong' : 'cursor-move border-accent-line',
          faded && 'hover:opacity-(--base-opacity)!',
        )}
        data-variant="strip"
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
        <span className="font-semibold whitespace-nowrap tabular-nums">
          {clock(model?.durationMs ?? 0)}
        </span>
        <span
          className="font-semibold whitespace-nowrap text-accent tabular-nums"
          title={t(($) => $.overlay.totalDps)}
        >
          {fmt.compact.format(model?.totalDps ?? 0)}
        </span>
        {boss && (
          <span
            className="inline-flex items-baseline gap-1 font-semibold whitespace-nowrap tabular-nums"
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
            className="inline-flex items-baseline gap-1 font-semibold whitespace-nowrap tabular-nums"
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
            <ClassIcon
              name={hideNames && leader.local ? null : leader.class}
              size={14}
              className={classPlate}
            />
            {leader.name} {fmt.compact.format(leader.dps)}
          </span>
        )}
        {!locked && onExitStrip && (
          <WindowButton
            size="2xs"
            className="ml-auto"
            onClick={onExitStrip}
            title={
              hotkeys.compact_strip
                ? t(($) => $.overlay.fullMeterHotkey, { hotkey: hotkeys.compact_strip })
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
  const grid = ranking ? rankingGrid : skillGrid;
  // The boss bar already names its target; the headline then gives way, and its status
  // context moves onto the bar's detail line. Several targets keep the headline.
  const headline = !boss || caption.text !== bossName;
  // An ended fight keeps its result and duration without an "ended since" line.
  const context = pinned
    ? t(($) => $.overlay.savedAt, { date: fmt.dateTime(shown?.started_ms ?? null) })
    : model?.source === 'report' && model.startedMs !== null
      ? model.ended
        ? ''
        : t(($) => $.overlay.liveSince, { time: fmt.hourMinute(model.startedMs) })
      : capture === 'capturing'
        ? t(($) => $.overlay.waitingForCombat)
        : captureLabel(capture);
  // The ranking needs no summary: its rows carry each player's damage, DPS and share. A
  // chosen player's own figures stay as one quiet line above their skills, with their
  // average DPS only.
  const stats = player
    ? [
        {
          label: mode === 'active' ? t(($) => $.overlay.activeDps) : t(($) => $.overlay.avgDps),
          value: perSecond(player.dps),
        },
        { label: t(($) => $.overlay.damage), value: fmt.compact.format(player.damage) },
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
  /** The growing bar and name that lead a row; its figures follow as cells. */
  const lead = (index: number, damage: number, color: string, name: ReactNode, title: string) => (
    <>
      {/* The bar takes the player's class colour: a player's row in the ranking, their skills. */}
      <span
        className={cn(
          'meter-bar absolute inset-y-0 left-0 -z-10 origin-left animate-grow rounded-[inherit]',
          'transition-[width] duration-300 ease-grow',
          index === 0 ? 'bg-(--mark)/45' : 'bg-(--mark)/30',
        )}
        aria-hidden="true"
        style={{ width: `${(damage / top) * 100}%`, '--mark': color } as CSSProperties}
      />
      <span className="meter-name min-w-0 truncate text-left text-xs font-semibold" title={title}>
        {name}
      </span>
    </>
  );
  const rowClass = (index: number, interactive: boolean) =>
    cn(
      'meter-row relative isolate min-h-[21px] w-full rounded-md border bg-row-hover px-1.5 py-0 text-left text-2xs leading-snug font-normal text-ink',
      grid,
      index === 0 ? 'border-accent-line' : 'border-transparent',
      // Rows that open something are Pressables; they light up like the top row on hover.
      interactive &&
        'transition-[background-color,border-color] duration-150 hover:border-accent-line hover:bg-accent-soft',
    );

  return (
    <section
      className={overlayWindow({
        editing: !locked,
        className: cn(
          'rounded-lg text-2xs leading-snug',
          faded && 'hover:opacity-(--base-opacity)!',
        ),
      })}
      data-state={faded ? 'faded' : undefined}
      aria-label={t(($) => $.overlay.label)}
      style={style}
      ref={hitRef}
      {...drag}
    >
      <OverlayCaption
        ref={captionRef}
        className={cn('relative h-[26px] gap-1.5 pr-1 pl-2', !locked && 'cursor-move')}
      >
        {!locked && (
          <span
            className="-ml-0.5 inline-flex shrink-0 text-ink-3"
            title={t(($) => $.overlay.dragToMove)}
          >
            <Icon name="grip" size={13} />
          </span>
        )}
        <span
          className="min-w-0 shrink-[4] truncate text-2xs font-semibold whitespace-nowrap text-accent"
          title={t(($) => $.overlay.outgoingTitle)}
        >
          {t(($) => $.overlay.damageDealt)}
        </span>
        <nav className="flex min-w-0 flex-auto gap-0.5" aria-label={t(($) => $.overlay.meterView)}>
          {localId && (
            <Chip
              size="xs"
              className={tabClass}
              data-hit
              pressed={focus.kind === 'player' && focus.id === localId}
              title={
                focus.kind === 'player' && focus.id === localId
                  ? t(($) => $.overlay.backToRanking)
                  : t(($) => $.overlay.yourSkills)
              }
              onClick={() =>
                select(
                  focus.kind === 'player' && focus.id === localId
                    ? { kind: 'ranking' }
                    : { kind: 'player', id: localId },
                )
              }
            >
              {t(($) => $.overlay.myDps)}
            </Chip>
          )}
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
        </nav>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-2xs tabular-nums',
            live ? 'text-ink' : 'text-ink-3',
          )}
          title={pinned ? t(($) => $.overlay.savedDuration) : captureLabel(capture)}
        >
          <StatusDot
            live={live}
            className={cn('size-[5px]', live ? 'text-accent' : 'text-current opacity-60')}
          />
          {clock(model?.durationMs ?? 0)}
        </span>
        <span className="flex shrink-0">
          {library && (
            <Menu open={historyOpen} onOpenChange={setHistoryOpen} modal={false}>
              <MenuTrigger
                render={
                  <WindowButton
                    size="2xs"
                    className={cn('rounded-md', (pinned || historyOpen) && 'text-accent')}
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
              className={cn('rounded-md', copied?.ok && 'text-accent')}
              data-hit
              data-state={copied?.ok ? 'copied' : undefined}
              onClick={copy}
              disabled={!model}
              title={copied?.ok ? t(($) => $.overlay.copied) : t(($) => $.overlay.copyTitle)}
              aria-label={t(($) => $.overlay.copy)}
            >
              {/* Copying confirms on the button itself; the footer stays Odyle's. */}
              <Icon name={copied?.ok ? 'check' : 'copy'} size={12} />
            </WindowButton>
          )}
          <WindowButton
            size="2xs"
            className="rounded-md"
            data-hit
            disabled={busy || pinned !== null}
            onClick={onReset}
            title={
              pinned
                ? t(($) => $.overlay.returnToLive)
                : hotkeys.reset
                  ? t(($) => $.overlay.newFightHotkey, { hotkey: hotkeys.reset })
                  : t(($) => $.overlay.newFight)
            }
            aria-label={t(($) => $.overlay.newFight)}
          >
            <Icon name="reset" size={12} />
          </WindowButton>
        </span>
        {!locked && (
          <span className="flex shrink-0 border-l border-line-soft pl-0.5">
            <WindowButton
              size="2xs"
              onClick={onHide}
              title={
                hotkeys.toggle_overlay
                  ? t(($) => $.overlay.hideHotkey, { hotkey: hotkeys.toggle_overlay })
                  : t(($) => $.overlay.hideMenu)
              }
              aria-label={t(($) => $.overlay.hide)}
            >
              <Icon name="minus" size={13} />
            </WindowButton>
            <WindowButton
              size="2xs"
              close
              onClick={onQuit}
              title={t(($) => $.overlay.quit)}
              aria-label={t(($) => $.overlay.quit)}
            >
              <Icon name="close" size={13} />
            </WindowButton>
          </span>
        )}
      </OverlayCaption>
      {headline && (
        <div className={cn('flex items-baseline gap-1.5 px-2 pt-1', !stats.length && 'pb-1')}>
          <b className="min-w-0 truncate text-xs font-bold" title={caption.title || undefined}>
            {caption.text}
          </b>
          <span className="min-w-0 flex-1 truncate text-right text-3xs text-ink-3">{context}</span>
          {pinned && (
            <Button
              variant="secondary"
              size="2xs"
              className={linkButton}
              data-hit
              onClick={() => pin(null)}
            >
              <Icon name="live" size={11} />
              {t(($) => $.overlay.backToLive)}
            </Button>
          )}
        </div>
      )}
      {stats.length > 0 && (
        <dl
          className={cn(
            'm-0 flex flex-wrap gap-x-3 gap-y-0.5 px-2 pb-1',
            headline ? 'pt-0.5' : 'pt-1',
          )}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className={capsLabel}>{stat.label}</dt>
              <dd className={statValue}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {boss && (
        // Boss status: a labelled HP bar, then kill estimate and rage on one quiet line.
        <section
          className={cn('mx-1.5 mb-1', !headline && !stats.length && 'mt-1')}
          aria-label={t(($) => $.overlay.projection.label)}
          data-rage={boss.rage.kind}
        >
          <div
            className={cn(
              'relative isolate flex min-h-[18px] items-center gap-1.5 overflow-hidden rounded-md border bg-shade/50 px-1.5 text-halo',
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
                'shrink-0 text-xs font-bold tabular-nums',
                boss.dead ? 'text-ink-2' : 'text-ink',
              )}
            >
              {boss.dead ? t(($) => $.overlay.projection.defeated) : fmt.pct(boss.fraction)}
            </b>
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 px-1 text-3xs whitespace-nowrap text-ink-3">
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
              <b className="text-ink tabular-nums">
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
                <b className={cn('tabular-nums', rageTone(rage))}>{rage.value}</b>
              </span>
            )}
            {dummy && (
              <span className={figurePair}>
                {t(($) => $.overlay.projection.dummyTime)}{' '}
                <b className="text-ink tabular-nums">
                  {dummy.remainingMs > 0
                    ? fmt.countdown(dummy.remainingMs)
                    : t(($) => $.overlay.projection.done)}
                </b>
              </span>
            )}
            {!headline && context && (
              <span className="ml-auto min-w-0 truncate text-right">{context}</span>
            )}
          </div>
        </section>
      )}
      {nextAlert && (
        <div className="mx-1.5 mb-1 flex text-3xs" aria-label={t(($) => $.overlay.alert.label)}>
          <span
            className={cn(
              'inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 tabular-nums',
              nextAlert.open || nextAlert.remainingMs <= 60_000
                ? 'border-accent-line bg-accent-soft text-accent'
                : 'border-line text-ink-3',
            )}
          >
            <Icon name="bell" size={11} />
            <b className="truncate text-ink">
              {nextAlert.name || t(($) => $.overlay.alert.fallback)}
            </b>{' '}
            {nextAlert.open
              ? t(($) => $.overlay.alert.open)
              : nextAlert.remainingMs > 0
                ? fmt.countdown(nextAlert.remainingMs)
                : t(($) => $.overlay.alert.now)}
          </span>
        </div>
      )}
      <TrackerChips trackers={trackers} limit={6} />
      {rows.length > 0 && (
        // What each figure column is, above the rows and inset exactly as they are.
        <div className="border-t border-line-soft px-1.5 pt-0.5" aria-hidden="true">
          <div className={cn('border-x border-transparent px-1.5', grid, capsLabel)}>
            <span />
            <span className={figure}>{t(($) => $.overlay.columns.total)}</span>
            {ranking && <span className={figure}>{t(($) => $.overlay.columns.dps)}</span>}
            <span className={figure}>{t(($) => $.overlay.columns.share)}</span>
          </div>
        </div>
      )}
      <ol
        ref={listRef}
        className={cn(
          'm-0 min-h-7 flex-1 list-none overflow-hidden px-1.5',
          // The labels carry the divider while rows show; the list starts right below them.
          rows.length > 0 ? 'pt-0.5' : 'border-t border-line-soft pt-1',
        )}
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
          ? model?.players.slice(0, visible.length).map((p, index) => {
              const cells = (
                <>
                  {lead(
                    index,
                    p.damage,
                    colorOf(p),
                    <>
                      {/* Hidden names keep your own class private, as the text does. */}
                      <ClassIcon
                        name={hideNames && p.local ? null : p.class}
                        size={18}
                        className={cn(classPlate, '-mt-0.5 mr-1.25')}
                      />
                      {p.name}
                      {p.local && !hideNames && (
                        <em className="text-3xs font-normal text-ink-2 not-italic">
                          {` ${t(($) => $.names.youDetail)}`}
                          {p.combatPower !== null && ` ${fmt.compact.format(p.combatPower)}`}
                        </em>
                      )}
                    </>,
                    p.title,
                  )}
                  <span className={cn(figure, 'font-bold text-ink')}>
                    {fmt.compact.format(p.damage)}
                  </span>
                  <span className={cn(figure, 'text-accent-strong')}>
                    {fmt.compact.format(p.dps)}
                  </span>
                  <span className={cn(figure, 'text-ink-3')}>{fmt.pct(p.share, 1)}</span>
                </>
              );
              return (
                <li key={p.id} className="mb-0.5 block" data-meter-row>
                  <Pressable
                    className={rowClass(index, true)}
                    data-hit="row"
                    aria-label={t(($) => $.overlay.skillsOf, { name: p.name })}
                    onClick={() => select({ kind: 'player', id: p.id })}
                  >
                    {cells}
                  </Pressable>
                </li>
              );
            })
          : player?.skills.slice(0, visible.length).map((s, index) => {
              const cells = (
                <>
                  {lead(
                    index,
                    s.damage,
                    skillColor,
                    <>
                      <SkillIcon id={s.skillId} size={18} className="-mt-0.5 mr-1.25" />
                      {s.name}
                    </>,
                    s.name,
                  )}
                  <span className={cn(figure, 'font-bold text-ink')}>
                    {fmt.compact.format(s.damage)}
                  </span>
                  <span className={cn(figure, 'text-ink-3')}>{fmt.pct(s.share, 1)}</span>
                </>
              );
              return (
                <li key={s.id} className="mb-0.5 block" data-meter-row>
                  {canDetail ? (
                    <Pressable
                      className={rowClass(index, true)}
                      data-hit="row"
                      aria-label={t(($) => $.overlay.skillDetails, { name: s.name })}
                      onClick={openDetails}
                    >
                      {cells}
                    </Pressable>
                  ) : (
                    <div className={rowClass(index, false)}>{cells}</div>
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
      <footer className="flex min-h-[21px] items-center gap-1.5 border-t border-line-soft bg-sunken/40 py-px pr-1.5 pl-2">
        {/* Original game energy icon and captured balance; unknown stays a dash, never zero. */}
        <dl
          className="m-0 inline-flex shrink-0 items-center gap-1 text-2xs whitespace-nowrap tabular-nums"
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
          className="min-w-0 flex-1 truncate text-left text-3xs text-danger"
          aria-label={t(($) => $.overlay.status)}
          title={problem || undefined}
        >
          {problem}
        </output>
        {canDetail && (
          <Button
            variant="secondary"
            size="2xs"
            className={linkButton}
            data-hit
            onClick={openDetails}
            title={t(($) => $.overlay.fullDetailsTitle)}
          >
            <Icon name="external" size={11} />
            {t(($) => $.overlay.fullDetails)}
          </Button>
        )}
      </footer>
    </section>
  );
}
