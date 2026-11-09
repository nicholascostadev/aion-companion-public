import { useCallback, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
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
import { UNKNOWN_CLASS_COLOR } from '../../lib/classColors';
import { powerText, rowChrome } from '../../lib/playerRow';
import type { MeterAlert } from '../alerts/model';
import { TrackerChips } from '../offline/trackers';
import type { BossStatus } from './bossStatus';
import { HistoryMenu } from './MeterHistory';
import { dpsFigure } from './meterModel';
import { useMeterFit } from './meterFit';
import type { Meter } from './meterState';
import { MeterViewSwitch } from './MeterViewSwitch';
import { PreparationView } from './PreparationView';
import { ProfileLink, type OpenProfile } from './ProfileLink';
import { useWindowDrag } from './windowDrag';

interface Props {
  /** What the meter shows right now, with the reader's actions on it (`useMeter`). */
  meter: Meter;
  onReset: () => void;
  onHide: () => void;
  /** Switches the meter to the compact strip; absent until settings are known. */
  onEnterStrip?: () => void;
  onExitStrip?: () => void;
  /** Opens full damage details for one player of exactly this fight. */
  onInspect?: (reportId: string, player: string) => void;
  /** Opens a character in the in-game profile window; absent outside the native app, so no links show. */
  onOpenProfile?: OpenProfile;
  /** Meter root, measured natively so locked controls stay clickable. */
  hitRef?: Ref<HTMLElement>;
  /**
   * Sizes the window to the height the meter wants (CSS px, its scale included): up to
   * five rows, then its list scrolls. Absent outside the native app, where the meter fills
   * whatever it is given.
   */
  onFit?: (height: number) => void;
  /** Starts a native window move; called while unlocked once a press on the meter travels. */
  onDrag?: () => void;
  /** Alerts open now or due within a few minutes, from the native alert engine. */
  nextAlerts?: MeterAlert[];
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

/** Points `ref` (an object or a callback) at `node`, as React does for a `ref` prop. */
function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

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
 * The DPS meter as `meter` says to show it: the party room while a dungeon group prepares,
 * the compact strip, or the fight with its ranking or one player's skills.
 */
export function DpsOverlay({
  meter,
  onReset,
  onHide,
  onEnterStrip,
  onExitStrip,
  onInspect,
  onOpenProfile,
  hitRef,
  onFit,
  onDrag,
  nextAlerts = [],
}: Props) {
  const { t } = useTranslation('live');
  const fmt = useFormat();
  const perSecond = perSecondOf(t, fmt);
  // Whichever sheet the meter draws (fight, room or strip): measured here for the window's
  // height and natively for the locked meter's hit regions.
  const sheet = useRef<HTMLElement | null>(null);
  const sheetRef = useCallback(
    (node: HTMLElement | null) => {
      sheet.current = node;
      assignRef(hitRef, node);
    },
    [hitRef],
  );
  useMeterFit(sheet, onFit);
  // The history menu hangs from the caption it opens from, mounted inside the meter.
  const captionRef = useRef<HTMLElement>(null);
  const {
    locked,
    faded,
    hotkeys,
    pinned,
    model,
    focus,
    player,
    boss,
    bossName,
    dummy,
    live,
    problem,
    context,
    caption,
    empty,
    emptyHint,
    me,
    mine,
    death,
  } = meter;
  // Unlocked, the whole meter moves the window; locked, it stays where it is.
  const drag = useWindowDrag(locked ? undefined : onDrag);
  const rage = boss ? rageLabel(boss, t, fmt) : null;
  const style = {
    '--base-opacity': meter.baseOpacity,
    opacity: meter.opacity,
    zoom: meter.scale,
  } as CSSProperties;

  if (meter.sheet === 'room')
    return (
      <PreparationView meter={meter} style={style} hitRef={sheetRef} drag={drag} onHide={onHide} />
    );

  if (meter.sheet === 'strip') {
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
        ref={sheetRef}
        {...drag}
      >
        <span className={cn('inline-flex shrink-0', live ? 'text-accent' : 'text-ink-3')}>
          <StatusDot live={live} className="size-1.5 text-current" />
          <span className="sr-only">{meter.stateLabel}</span>
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
            <ClassIcon name={leader.class} size={15} solid />
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
  const top = Math.max(1, ...rows.map((r) => r.damage));
  const skillColor = player?.color ?? UNKNOWN_CLASS_COLOR;
  // The ranking needs no summary: its rows carry each player's DPS, combat power and share. A
  // chosen player's own figures stay as one quiet line above their skills, with their
  // average DPS only.
  const dpsLabel =
    meter.dpsMode === 'active' ? t(($) => $.overlay.activeDps) : t(($) => $.overlay.avgDps);
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
  const { detailsId } = meter;
  const localId = model?.localId ?? null;
  const canDetail = Boolean(onInspect && detailsId && player);
  const openDetails = () => {
    if (onInspect && detailsId && player) onInspect(detailsId, player.id);
  };
  const lockLabel = locked ? t(($) => $.overlay.lock.locked) : t(($) => $.overlay.lock.unlocked);
  // Open or imminent events light the strip; later ones keep it quiet.
  const urgent = nextAlerts.some((a) => a.open || a.remainingMs <= 60_000);
  // Hidden names hide every profile link: each names a character.
  const openProfile = meter.profileLinks ? onOpenProfile : undefined;
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
          It has no corners of its own: the row clips it to its rounded corners. */}
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
  // A row is filled in its class colour (a player's, or the chosen player's for their
  // skills) with the player row's chrome, shared with the party room's members; the leader
  // is told by its stronger bar. Rows that open something are Pressables and light up on hover.
  const rowProps = (interactive: boolean, color: string) => {
    const chrome = rowChrome(color);
    return {
      className: cn(
        'meter-row relative isolate flex w-full overflow-hidden text-left font-normal text-ink',
        chrome.className,
        interactive &&
          'cursor-pointer transition-[background-color] duration-150 hover:bg-accent-soft',
      ),
      style: chrome.style,
    };
  };

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
      ref={sheetRef}
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
          title={meter.stateLabel}
        >
          <StatusDot live={live} className="size-1.5 text-current" />
        </span>
        {meter.preparing && <MeterViewSwitch view="dps" onChange={meter.chooseView} />}
        {/* The elapsed time sits right beside the title, on the same baseline. */}
        <span className="flex min-w-0 shrink-[4] items-baseline gap-1.5">
          {meter.headline ? (
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
            title={meter.durationTitle}
          >
            {clock(model?.durationMs ?? 0)}
          </span>
        </span>
        {meter.viewingOther && (
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
            onClick={() => meter.select({ kind: 'ranking' })}
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
              onClick={() =>
                meter.select(mine ? { kind: 'ranking' } : { kind: 'player', id: localId })
              }
            >
              <Icon name="activity" size={12} />
            </WindowButton>
          )}
          {meter.library && (
            <Menu open={meter.historyOpen} onOpenChange={meter.setHistoryOpen} modal={false}>
              <MenuTrigger
                render={
                  <WindowButton
                    size="2xs"
                    className={cn((pinned || meter.historyOpen) && 'text-accent')}
                    data-hit
                    title={t(($) => $.overlay.historyTitle)}
                    aria-label={t(($) => $.overlay.history)}
                  />
                }
              >
                <Icon name="history" size={12} />
              </MenuTrigger>
              <HistoryMenu
                library={meter.library}
                pinned={pinned}
                onPick={meter.pin}
                onLive={() => meter.pin(null)}
                container={captionRef}
                anchor={captionRef}
              />
            </Menu>
          )}
          {meter.copy && (
            <WindowButton
              size="2xs"
              className={cn(meter.copied && 'text-accent')}
              data-hit
              data-state={meter.copied ? 'copied' : undefined}
              onClick={meter.copy}
              disabled={!model}
              title={meter.copied ? t(($) => $.overlay.copied) : t(($) => $.overlay.copyTitle)}
              aria-label={t(($) => $.overlay.copy)}
            >
              {/* Copying confirms on the button itself; the footer stays the status line. */}
              <Icon name={meter.copied ? 'check' : 'copy'} size={12} />
            </WindowButton>
          )}
          <WindowButton
            size="2xs"
            data-hit
            disabled={!meter.canReset}
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
            {/* A preparing group keeps the full meter, so the strip waits for the run. */}
            {onEnterStrip && !meter.preparing && (
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
              date: fmt.dateTime(meter.report?.started_ms ?? null),
            })}
          </span>
          <Button
            variant="secondary"
            size="2xs"
            className={cn(linkButton, 'h-4.5 px-1.5')}
            data-hit
            onClick={() => meter.pin(null)}
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
      {death && (
        // Your latest death, while recent: who landed the last hit, never called the killer,
        // with their profile and a way to put it away.
        <section
          className={cn(strip, 'border-danger-line')}
          aria-label={t(($) => $.overlay.lastDeath.label)}
        >
          <Icon name="death" size={11} className="shrink-0 text-danger" />
          <span
            className="flex min-w-0 flex-1 items-center gap-1"
            title={t(($) => $.overlay.lastDeath.title, {
              name: death.name,
              time: fmt.hourMinute(death.at),
            })}
          >
            <span className="shrink-0 text-ink-3">{t(($) => $.overlay.lastDeath.lastHit)}</span>
            <ClassIcon name={death.class} size={13} solid className="shrink-0" />
            <b className="min-w-0 truncate font-semibold text-ink">{death.name}</b>
            {/* The pebble never shrinks, so a long name truncates before it does. Its glyph
                rises a pixel to the text's cap height, which sits above the line box's middle. */}
            {openProfile && death.profile && (
              <ProfileLink
                profile={death.profile}
                label={t(($) => $.profile.open, { name: death.name })}
                onOpen={openProfile}
                size="2xs"
                className="[&_svg.icon]:-translate-y-px"
                hit
              />
            )}
            <span className="shrink-0 text-ink-3 figures">{fmt.hourMinute(death.at)}</span>
          </span>
          <WindowButton
            size="2xs"
            className="size-4.5"
            data-hit
            title={t(($) => $.overlay.lastDeath.dismiss)}
            aria-label={t(($) => $.overlay.lastDeath.dismiss)}
            onClick={meter.dismissDeath}
          >
            <Icon name="close" size={11} />
          </WindowButton>
        </section>
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
      <TrackerChips trackers={meter.trackers} limit={6} />
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
      {/* The window grows with the rows up to five (`useMeterFit`), then the list scrolls
          under the caption and above the footer, as it does when the screen is too short.
          Another fight or another player's skills start at the top. The list holds its last
          row's margin (`flow-root`), so the height it measures is all the list scrolls. */}
      <div
        key={`${meter.fight}:${player?.id ?? ''}`}
        className="min-h-8 flex-1 overflow-y-auto"
        data-meter-viewport
        data-hit-clip
      >
        <ol
          className="m-0 flow-root list-none px-1.5 pt-1"
          aria-label={
            ranking
              ? t(($) => $.overlay.playersByDamage)
              : player
                ? t(($) => $.overlay.skillsOf, { name: player.name })
                : t(($) => $.overlay.skillsOfPlayer)
          }
          data-meter-content
        >
          {ranking
            ? model?.players.map((p, index) => (
                <li key={p.id} className="relative mb-0.5 block" data-meter-row>
                  {/* The row's button lies under its drawn row, so the profile link can follow
                    the name without sitting inside it: keyboard and screen readers use the
                    button, and a press anywhere on the drawn row opens the same skills. */}
                  <Pressable
                    className="absolute inset-0 rounded-sm"
                    data-hit="row"
                    aria-label={t(($) => $.overlay.skillsOf, { name: p.name })}
                    onClick={() => meter.select({ kind: 'player', id: p.id })}
                  />
                  {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer shortcut for the button beneath */}
                  <div
                    {...rowProps(true, p.color)}
                    onClick={() => meter.select({ kind: 'player', id: p.id })}
                  >
                    {row({
                      index,
                      damage: p.damage,
                      share: p.share,
                      // Hidden names keep your own class private, as the text does.
                      art: <ClassIcon name={p.class} size={22} solid />,
                      name: p.name,
                      title: p.title,
                      tags: (
                        <>
                          {p.meTag && (
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
                          {/* Pulled into the name line's height, so a link never makes a row taller.
                            No region of its own: the row's region beneath already takes its
                            clicks, so a long roster never spends native's few regions on links. */}
                          {openProfile && p.profile && (
                            <ProfileLink
                              profile={p.profile}
                              label={t(($) => $.profile.open, { name: p.name })}
                              onOpen={openProfile}
                              size="2xs"
                              className="-my-1"
                            />
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
                      detail: p.showsPower && (
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
                          {powerText(p.combatPower, 'compact', fmt)}{' '}
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
                  </div>
                </li>
              ))
            : player?.skills.map((s, index) => {
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
      </div>
      <footer className="flex min-h-5.5 flex-none items-center gap-2 border-t border-line-soft bg-sunken/40 py-px pr-1.5 pl-2 text-3xs">
        {me && (
          // Who this meter belongs to; hidden names keep the class private here too.
          <span
            className="inline-flex max-w-28 min-w-0 shrink items-center gap-1 font-semibold text-ink-2"
            title={me.title}
          >
            <ClassIcon name={me.class} size={14} solid />
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
            <b className="font-bold text-ink">{fmt.maybe(meter.odyle?.base, fmt.integer)}</b>
            <span className="font-semibold text-jade-ink">
              {t(($) => $.overlay.odyle.bonus, {
                bonus: fmt.maybe(meter.odyle?.bonus, fmt.integer),
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
