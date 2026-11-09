import { useEffect, useState } from 'react';
import type { Formatters } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { captureState, type CaptureState } from '../../lib/capture';
import { DEFAULT_HOTKEYS } from '../../lib/offlineNormalize';
import { bossTargets, reportScope, targetMode } from '../../lib/targetScope';
import type { GroupStatus, LiveStatus, OverlayStatus } from '../../types/companion';
import type {
  DpsMode,
  LastDeath,
  LogId,
  OfflineHotkeys,
  PolledOfflineStatus,
  ReportTotals,
  TargetMode,
} from '../../types/offline';
import { preparingRoom } from '../group/model';
import { bossProjection, dummyTimer } from '../offline/analysis';
import { bossStatus, type BossStatus } from './bossStatus';
import { deathShortcut, type DeathShortcut } from './lastDeath';
import { METER_ROWS } from './meterFit';
import { usePinnedFight, type MeterLibrary, type PinnedFight } from './MeterHistory';
import {
  fromReport,
  meterSummary,
  type MeterFocus,
  type MeterModel,
  type MeterPlayer,
} from './meterModel';
import type { MeterView } from './MeterViewSwitch';

/*
 * What the DPS meter shows right now, decided in one place: which sheet it draws (the party
 * room, the compact strip or the fight), which fight and focus, whether it fades, and the
 * words of its caption, problem, context and empty lines. Native status goes in, what to
 * show comes out. The reader's choices and the idle clock are pure state transitions
 * (`meterStart`, `meterStep`); `meterShows` reads them. `useMeter` only feeds them from
 * React: it owns the clock, the saved-fight read, the death shortcut's timer and the copy.
 */

/** What native reports, as the meter window polls it. */
export interface MeterInput {
  status: LiveStatus;
  overlay: OverlayStatus;
  /** The window's own problem (capture, overlay, offline or action errors). */
  error: string;
  /** Capture or offline work in flight: a new fight waits for it. */
  busy: boolean;
  /** Offline engine status: settings, the live report, trackers and your last death. */
  offline: PolledOfflineStatus | null;
  /**
   * The party room and run state (`group_status`). While native reports a dungeon group
   * preparing for its run the meter opens on the room, with a switch to the live DPS;
   * absent, it never shows the room.
   */
  group?: { status: GroupStatus | null; native: boolean } | undefined;
  /** The pinned saved fight as read from the library (`usePinnedFight`). */
  saved: PinnedFight;
  /** Your latest death while it is recent and not dismissed. */
  death: DeathShortcut | null;
  /** The meter's clock (epoch ms); it ticks each second while the meter may fade. */
  now: number;
}

/** The reader's choices and the meter's idle clock, changed only by `meterStep`. */
export interface MeterState {
  /** The preparing room the reader's view belongs to; null outside one. */
  room: string | null;
  /** The reader's choice while that room prepares: the group, or the live DPS. */
  view: MeterView;
  /** The saved fight opened from History; null on the live fight. */
  pinned: LogId | null;
  /** The fight on screen: `live:<report id>` or `saved:<log id>`. */
  fight: string;
  /** The reader's focus and the fight it was chosen in; any other fight shows the ranking. */
  choice: { fight: string; focus: MeterFocus } | null;
  historyOpen: boolean;
  /** What the last copy did, until it lapses. */
  copied: { ok: true } | { ok: false; detail: string } | null;
  /** What last changed in combat and when; `hold` keeps the meter lit whatever the time. */
  idle: { activity: string; hold: boolean; at: number };
}

/** What the reader does on the meter. */
export type MeterAction =
  | { type: 'view'; view: MeterView }
  | { type: 'pin'; id: LogId | null }
  | { type: 'focus'; focus: MeterFocus }
  | { type: 'history'; open: boolean }
  | { type: 'copied'; result: MeterState['copied'] };

/** Translators and formatters the meter's words are built with. */
export interface MeterWords {
  t: Translate<'live'>;
  tc: Translate<'common'>;
  fmt: Formatters;
}

/** What the meter shows for one state and input. */
export interface MeterShown {
  /** The sheet drawn: the party room, the compact strip or the fight. */
  sheet: 'room' | 'strip' | 'fight';
  /**
   * A dungeon group prepares: the fight's caption leads with the Group and DPS switch, and
   * the compact strip waits for the run.
   */
  preparing: boolean;
  /** The party room the room sheet draws. */
  group: { status: GroupStatus | null; native: boolean };
  locked: boolean;
  /** Idle long enough to fade; a finished boss fight and the room stay lit. */
  faded: boolean;
  /** Opacity now, its opacity while lit, and the meter's scale. */
  opacity: number;
  baseOpacity: number;
  scale: number;
  hotkeys: OfflineHotkeys;
  hideNames: boolean;
  dpsMode: DpsMode;
  /** The footer's problem, the first that applies; empty when there is none. */
  problem: string;
  /** Capture state and when this fight began, for the footer; empty when it says nothing. */
  context: string;
  capture: CaptureState;
  /** Capturing, on the live fight. */
  live: boolean;
  /** The meter's state in words: a saved fight, or capture's state. */
  stateLabel: string;
  /** What the caption's duration is. */
  durationTitle: string;
  pinned: LogId | null;
  /** The report on screen: the pinned fight, else the live report. */
  report: ReportTotals | null;
  /** Key of the fight on screen. */
  fight: string;
  /** The table, summary, Copy and details of the report on screen; null until one exists. */
  model: MeterModel | null;
  focus: MeterFocus;
  /** The focused player, whose skills show. */
  player: MeterPlayer | null;
  /** Focused on someone else: their chip leads back to the ranking. */
  viewingOther: boolean;
  /** Focused on your own skills: My DPS is on. */
  mine: boolean;
  /** You, named in the footer. */
  me: MeterPlayer | null;
  /** The fight Full details opens. */
  detailsId: string | null;
  /** The targets the shown damage was dealt to, and all of their names. */
  caption: { text: string; title: string };
  /** The caption names targets; false when the boss bar already names the only one. */
  headline: boolean;
  /** The live boss line; an ended report freezes it and a saved fight has none. */
  boss: BossStatus | null;
  bossName: string;
  dummy: ReturnType<typeof dummyTimer>;
  /** Tracker chips, a fallback for when the in-game tracker surface is not in use. */
  trackers: PolledOfflineStatus['trackers'];
  /** The empty list's line and its hint (empty for none). */
  empty: string;
  emptyHint: string;
  death: DeathShortcut | null;
  /** Profile links show; hidden names hide every one, as each names a character. */
  profileLinks: boolean;
  historyOpen: boolean;
  /** The last copy succeeded and has not lapsed. */
  copied: boolean;
  canReset: boolean;
  odyle: LiveStatus['odyle'] | null;
}

/**
 * Which preparing dungeon group the meter is in. Native alone decides when a group prepares;
 * without group status the meter never shows the room.
 */
const roomOf = (input: Pick<MeterInput, 'group'>) =>
  input.group === undefined ? null : preparingRoom(input.group.status);

const liveReport = (input: MeterInput) => input.offline?.report ?? null;
/** One report drives the meter: the pinned fight, else the live report. */
const shownReport = (pinned: LogId | null, input: MeterInput): ReportTotals | null =>
  pinned ? input.saved.report : liveReport(input);
const fightOf = (pinned: LogId | null, input: MeterInput) =>
  pinned ? `saved:${pinned}` : `live:${liveReport(input)?.id ?? ''}`;
const showsRoom = (state: MeterState) => state.room !== null && state.view === 'group';

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

/**
 * Brings the reader's state up to date with what native reports. Returns `state` itself
 * when nothing changes, so it can run on every render.
 */
function observe(state: MeterState, input: MeterInput): MeterState {
  let next = state;
  // The group comes first: the meter shows the room when the group appears, on joining
  // another group and when it prepares for its next run, while polls of the same group
  // keep the reader's choice of the live DPS. Pre-run hits never start the run.
  const room = roomOf(input);
  if (next.room !== room)
    // An opened saved fight never outlasts a change of group or run: the DPS view of a
    // preparing group, the run and the meter after leaving all start on the live fight.
    next = { ...next, room, view: 'group', pinned: null };
  const roomShown = showsRoom(next);
  // The fight's History menu hangs from its caption, which the room does not draw.
  if (roomShown && next.historyOpen) next = { ...next, historyOpen: false };
  const fight = fightOf(next.pinned, input);
  if (next.fight !== fight) next = { ...next, fight };
  // New activity, or a hold taken or released, restarts the idle clock from the meter's
  // clock. A finished boss keeps its result readable, and the room stays readable while
  // preparing.
  const activity = combatActivity(input.status, liveReport(input));
  const hold = finishedBoss(shownReport(next.pinned, input)) || roomShown;
  if (next.idle.activity !== activity || next.idle.hold !== hold)
    next = { ...next, idle: { activity, hold, at: input.now } };
  return next;
}

function apply(state: MeterState, action: MeterAction): MeterState {
  switch (action.type) {
    case 'view':
      return { ...state, view: action.view };
    case 'pin':
      return { ...state, pinned: action.id, historyOpen: false };
    case 'focus':
      return { ...state, choice: { fight: state.fight, focus: action.focus } };
    case 'history':
      return { ...state, historyOpen: action.open };
    case 'copied':
      return { ...state, copied: action.result };
  }
}

/** The meter as it opens: on the group of a preparing room, else the live fight's ranking. */
export function meterStart(input: MeterInput): MeterState {
  return observe(
    {
      room: roomOf(input),
      view: 'group',
      pinned: null,
      fight: '',
      choice: null,
      historyOpen: false,
      copied: null,
      idle: { activity: '', hold: false, at: input.now },
    },
    input,
  );
}

/**
 * The meter's state after the reader's `action` (if any), brought up to date with `input`.
 * Pure: the same state, input and action always give the same state, and `state` itself
 * when nothing changed.
 */
export function meterStep(state: MeterState, input: MeterInput, action?: MeterAction) {
  return observe(action ? apply(state, action) : state, input);
}

/** What the meter shows for `state` (as `meterStep` left it) and `input`. */
export function meterShows(
  current: MeterState,
  input: MeterInput,
  { t, tc, fmt }: MeterWords,
): MeterShown {
  const state = observe(current, input);
  const captureLabel = (capture: CaptureState) => tc(($) => $.capture.label[capture]);
  const settings = input.offline?.settings ?? null;
  const hideNames = settings?.hide_names ?? false;
  const mode = settings?.dps_mode ?? 'encounter';
  const scope = targetMode(settings);
  const { pinned } = state;
  const live = liveReport(input);
  const report = shownReport(pinned, input);
  const room = showsRoom(state);
  // The compact strip is a fight preference: the room always shows in full, and a preparing
  // group keeps the full meter so its switch stays in reach. The strip returns with the run.
  const sheet = room ? 'room' : settings?.compact_strip && state.room === null ? 'strip' : 'fight';

  // One native report drives the table, summary, Copy and player details: the pinned
  // fight, else the live report. Native aggregates it in the chosen target scope (every
  // target, or bosses and dummies while any were met) and owns every total. The raw
  // LiveStatus totals ignore that scope, so without a report the meter waits rather than
  // fall back to them and show trash damage as a boss's.
  const model = report
    ? fromReport(report, { hideNames, mode, running: pinned ? false : input.status.running, t })
    : null;
  const focus: MeterFocus =
    state.choice?.fight === state.fight ? state.choice.focus : { kind: 'ranking' };
  const player =
    focus.kind === 'player' ? (model?.everyone.find((p) => p.id === focus.id) ?? null) : null;
  const localId = model?.localId ?? null;

  const boss = pinned
    ? null
    : bossStatus(bossProjection(live), (live?.end_reason ?? null) !== null);
  const bossName = boss ? (boss.name ?? t(($) => $.overlay.unknownTarget)) : '';
  const caption = targetCaption(report, scope, t);
  const seconds = settings?.fade_after_seconds ?? 0;
  const faded = seconds > 0 && !state.idle.hold && input.now - state.idle.at >= seconds * 1000;
  // Capture runs in the background from app launch; the meter only reports its state.
  const capture = captureState(input.status);
  const savedError = pinned ? input.saved.error : '';
  // The footer leads with Odyle energy; only a problem shares it, never routine status.
  const problem =
    input.error ||
    input.overlay.errors.join(' · ') ||
    (capture === 'error' ? input.status.message || captureLabel('error') : '') ||
    (state.copied && !state.copied.ok ? state.copied.detail : '') ||
    savedError;
  // An ended fight keeps its result and duration without an "ended since" line.
  const context = pinned
    ? ''
    : model && model.startedMs !== null
      ? model.ended
        ? ''
        : t(($) => $.overlay.liveSince, { time: fmt.hourMinute(model.startedMs) })
      : capture === 'capturing'
        ? t(($) => $.overlay.waitingForCombat)
        : captureLabel(capture);
  const ranking = focus.kind === 'ranking';
  // A boss met but not yet hit by anyone counted reads as such, never as idle.
  const bossMet = bossTargets(report).length > 0;
  const empty =
    pinned && !model
      ? input.saved.loading
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
  const opacity = settings?.opacity ?? 1;

  return {
    sheet,
    preparing: state.room !== null,
    group: { status: input.group?.status ?? null, native: input.group?.native ?? false },
    locked: input.overlay.locked,
    faded,
    opacity: faded ? (settings?.fade_opacity ?? 1) : opacity,
    baseOpacity: opacity,
    scale: settings?.scale ?? 1,
    hotkeys: settings?.hotkeys ?? DEFAULT_HOTKEYS,
    hideNames,
    dpsMode: mode,
    problem,
    context,
    capture,
    live: capture === 'capturing' && !pinned,
    stateLabel: pinned ? t(($) => $.overlay.savedFight) : captureLabel(capture),
    durationTitle: pinned ? t(($) => $.overlay.savedDuration) : captureLabel(capture),
    pinned,
    report,
    fight: state.fight,
    model,
    focus,
    player,
    viewingOther: focus.kind === 'player' && focus.id !== localId,
    mine: focus.kind === 'player' && focus.id === localId,
    me: model?.everyone.find((p) => p.local) ?? null,
    detailsId: pinned ?? model?.reportId ?? null,
    caption,
    // The boss bar already names its target; the caption then says what the meter counts
    // instead of naming it twice. Several targets keep their name in the caption.
    headline: !boss || caption.text !== bossName,
    boss,
    bossName,
    dummy: pinned ? null : dummyTimer(live, settings?.dummy_length_seconds ?? 0),
    trackers: input.overlay.trackers_requested ? [] : (input.offline?.trackers ?? []),
    empty,
    emptyHint,
    // Hidden names hide the death shortcut too: it names a character.
    death: pinned || hideNames ? null : input.death,
    profileLinks: !hideNames,
    historyOpen: state.historyOpen,
    copied: state.copied?.ok === true,
    canReset: !input.busy && pinned === null,
    odyle: input.status.odyle ?? null,
  };
}

/** How long after your death the meter offers the character who landed the last hit. */
const DEATH_SHORTCUT_MS = 10 * 60_000;

/**
 * The death shortcut while it is recent and not dismissed. It lapses on its own: one timer
 * re-renders the meter when it expires, and a death already old when the meter opened never
 * shows.
 */
function useRecentDeath(death: LastDeath | null | undefined) {
  const [opened] = useState(() => Date.now());
  const [lapsed, setLapsed] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const at = death?.at_ms ?? null;
  useEffect(() => {
    if (at === null) return;
    const timer = setTimeout(() => setLapsed(at), Math.max(0, at + DEATH_SHORTCUT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [at]);
  const recent =
    at !== null && at + DEATH_SHORTCUT_MS > opened && lapsed !== at && dismissed !== at;
  return { death: recent ? deathShortcut(death) : null, dismiss: () => setDismissed(at) };
}

/** Where the meter's state comes from: native status, the library and the clipboard. */
export interface MeterSources extends Omit<MeterInput, 'offline' | 'saved' | 'death' | 'now'> {
  offline?: PolledOfflineStatus | null | undefined;
  /** Saved fights for History; absent outside the native app. */
  library?: MeterLibrary | undefined;
  /** Copies text to the clipboard; the meter copies exactly what it shows. */
  copyText?: ((text: string) => Promise<void>) | undefined;
}

/** What the meter shows, with the reader's actions on it. */
export interface Meter extends MeterShown {
  /** Saved fights for History; History is offered only with one. */
  library: MeterLibrary | null;
  chooseView: (view: MeterView) => void;
  select: (focus: MeterFocus) => void;
  /** Opens a saved fight, or the live one again (null), and closes History. */
  pin: (id: LogId | null) => void;
  setHistoryOpen: (open: boolean) => void;
  /** Copies the shown summary; null without a clipboard. */
  copy: (() => void) | null;
  dismissDeath: () => void;
}

/**
 * Feeds the meter's state from React: the idle clock, the pinned fight's read, the death
 * shortcut's timer and the copy's lapse. Each render brings the state up to date with
 * `sources` (an adjustment during render, so the first paint is already right).
 */
export function useMeter({ library, copyText, ...sources }: MeterSources): Meter {
  const { t } = useTranslation('live');
  const { t: tc } = useTranslation('common');
  const fmt = useFormat();
  const offline = sources.offline ?? null;
  const settings = offline?.settings ?? null;
  const seconds = settings?.fade_after_seconds ?? 0;
  const [now, setNow] = useState(() => Date.now());
  // The clock keeps ticking while held, so a released hold restarts from the real time.
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  const recentDeath = useRecentDeath(offline?.last_death);
  const base = { ...sources, offline, death: recentDeath.death, now };
  const [stored, setStored] = useState(() => meterStart({ ...base, saved: NOT_PINNED }));
  const saved = usePinnedFight(library ?? null, stored.pinned, targetMode(settings) === 'boss');
  const input: MeterInput = { ...base, saved };
  const state = meterStep(stored, input);
  if (state !== stored) setStored(state);
  useEffect(() => {
    if (!state.copied) return;
    const timer = setTimeout(
      () => setStored((s) => apply(s, { type: 'copied', result: null })),
      2500,
    );
    return () => clearTimeout(timer);
  }, [state.copied]);

  const shown = meterShows(state, input, { t, tc, fmt });
  const act = (action: MeterAction) => setStored((s) => apply(s, action));
  const copy = copyText
    ? () => {
        if (!shown.model) return;
        const text = meterSummary(shown.model, shown.focus, {
          caption: shown.caption.text,
          // The rows the meter shows before its list scrolls.
          rows: METER_ROWS,
          t,
          fmt,
        });
        void copyText(text).then(
          () => act({ type: 'copied', result: { ok: true } }),
          (cause: unknown) => act({ type: 'copied', result: { ok: false, detail: String(cause) } }),
        );
      }
    : null;
  return {
    ...shown,
    library: library ?? null,
    chooseView: (view) => act({ type: 'view', view }),
    select: (focus) => act({ type: 'focus', focus }),
    pin: (id) => act({ type: 'pin', id }),
    setHistoryOpen: (open) => act({ type: 'history', open }),
    copy,
    dismissDeath: recentDeath.dismiss,
  };
}

const NOT_PINNED: PinnedFight = { report: null, loading: false, error: '' };
