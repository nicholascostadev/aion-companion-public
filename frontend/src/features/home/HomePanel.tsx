import { useId, useState } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { DpsToggle } from '../../components/ui/DpsToggle';
import { Notice } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { Ticking } from '../../components/ui/Ticking';
import {
  stackedSwitch,
  WindowSwitch,
  windowState,
  type WindowState,
} from '../../components/ui/WindowSwitch';
import { clock } from '../../i18n/formatters';
import { Trans, useFormat, useTranslation } from '../../i18n/provider';
import { captureState, type CaptureState } from '../../lib/capture';
import { cn } from '../../lib/cn';
import type { LiveStatus } from '../../types/companion';
import type { ActivityWindowToggle } from '../../types/activityWindows';
import type { SetupState } from '../../types/setup';
import type { LogId, LogMeta, OfflineHotkeys, ReportTarget } from '../../types/offline';
import type { AlertsController } from '../alerts/AlertsPanel';
import type { PetIndex } from '../pets/model';
import { GettingStarted, type StepDetail } from './GettingStarted';
import { NextUpCard, RingingNow } from './HomeAlerts';
import { LastFights } from './HomeFights';
import { PetFarmingCard, type HomePets, type HomeRadar } from './HomePets';
import { sessionOf } from '../pets/model';
import { SetupBand } from '../setup/SetupBand';
import { captureIssue, type CaptureIssue } from '../setup/model';
import {
  dayPart,
  fightInProgress,
  firstSteps,
  liveLeader,
  localName,
  setupBlocking,
  type StepId,
} from './model';

/** Workspace places Home links to; `setup` is Settings scrolled to Setup. */
export type HomeDestination =
  | 'live'
  | 'logs'
  | 'alerts'
  | 'pets'
  | 'settings'
  | 'trackers'
  | 'setup';

/** The in-game windows Home can show or hide, as the workspace's overlay controls report them. */
export interface HomeWindows {
  /** False until the first native overlay status arrives. */
  known: boolean;
  busy: boolean;
  dps: boolean;
  /** AION is unfocused, so the native side holds back every window that is asked for. */
  suspended: boolean;
  locked: boolean;
  /** Automatic Group display is enabled, even outside a raid room. */
  group: boolean;
  /** Currently eligible for display; omitted by older callers that only report intent. */
  groupRequested?: boolean;
  trackers: boolean;
  timers?: ActivityWindowToggle;
  /** The in-game Explore window: the workspace's Explore choices over the game. */
  explore?: ActivityWindowToggle;
  onToggleDps: () => void;
  onLock: (locked: boolean) => void;
  onToggleGroup: () => void;
  onToggleTrackers: () => void;
}

export interface HomePanelProps {
  native: boolean;
  live: LiveStatus;
  captureError: string;
  /** The boss (or first target) of the live fight, from the live report. */
  liveTarget: ReportTarget | null;
  windows: HomeWindows;
  hotkeys: OfflineHotkeys;
  autoSave: boolean | null;
  libraryCount: number | null;
  alerts: AlertsController;
  /** What this PC has for live capture; a problem shows before everything else to do. */
  setup: SetupState;
  pets: HomePets;
  radar: HomeRadar;
  /** The pet catalogue, once there is a pet to name. */
  petIndex: PetIndex | null;
  /** The newest saved fights; null until read. */
  recent: { logs: LogMeta[] | null; error: string };
  /** A newer version waiting in Settings, if native found one. */
  update: { version: string | null; ready: boolean } | null;
  onNavigate: (to: HomeDestination) => void;
  onOpenLog: (id: LogId) => void;
}

// The stored key keeps its original name so a hidden Getting started stays hidden.
const HIDE_FIRST_STEPS = 'aion-companion.home.checklist-hidden';
const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_FIRST_STEPS) === '1';
  } catch {
    return false;
  }
};

const DATE_LINE = { weekday: 'long', day: 'numeric', month: 'long' } as const;

const CAPTURE_TONE: Record<CaptureState, 'accent' | 'warn' | 'danger' | 'neutral'> = {
  capturing: 'accent',
  waiting: 'warn',
  connecting: 'neutral',
  error: 'danger',
};

/** An expected missing prerequisite is something to do, not a fault. */
const SETUP_TONE: Record<CaptureIssue, 'warn' | 'neutral'> = {
  missing: 'warn',
  unavailable: 'warn',
  unsupported: 'neutral',
};

/** The greeting: part of the day, the date and the character, when capture knows it. */
function Greeting({ titleId, name }: { titleId: string; name: string | null }) {
  const { t } = useTranslation('home');
  const fmt = useFormat();
  return (
    <Ticking every={30_000}>
      {(now) => {
        const part = dayPart(new Date(now).getHours());
        return (
          <>
            <p className="m-0 flex items-center gap-1.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
              <Icon name={part.icon} size={13} className="text-accent" />
              {t(($) => $.dayPart[part.id])}
              <span aria-hidden="true">·</span>
              {fmt.dateTimeWith(DATE_LINE).format(now)}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{fmt.hourMinute(now)}</span>
            </p>
            <h2 id={titleId} className="mt-1.5 mb-0 text-3xl font-semibold tracking-tight">
              {name ? (
                <Trans
                  t={t}
                  i18nKey={($) => $.greeting[`${part.id}Named`]}
                  values={{ name }}
                  components={[<span key="name" className="text-accent" />]}
                />
              ) : (
                t(($) => $.greeting[part.id])
              )}
            </h2>
          </>
        );
      }}
    </Ticking>
  );
}

/** The fight under way, with the boss's health and one click to the full Live view. */
function InCombat({
  live,
  target,
  onOpen,
}: {
  live: LiveStatus;
  target: ReportTarget | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation('home');
  const fmt = useFormat();
  const total = live.players.reduce((n, p) => n + p.damage, 0);
  const leader = liveLeader(live);
  const hp =
    target?.current_hp !== null && target?.current_hp !== undefined && target.max_hp
      ? target.current_hp / target.max_hp
      : null;
  return (
    <Panel
      variant="flat"
      padding="none"
      data-home="in-combat"
      className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-accent-line px-4 py-3 shadow-glow"
    >
      {/* The boss gets a line of its own before it is cut; the figures wrap below it. */}
      <span className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className="flex items-center gap-2 text-2xs font-semibold tracking-caps text-accent uppercase">
          <StatusDot tone="accent" live />
          {t(($) => $.combat.inCombat)}
        </span>
        {/* The health bar drops under a long boss name rather than cutting it. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <b
            className="min-w-0 truncate text-md font-semibold text-ink"
            title={target?.name ?? undefined}
          >
            {target?.name ?? t(($) => $.combat.currentFight)}
          </b>
          {hp !== null && (
            <span className="flex min-w-32 flex-1 items-center gap-2 text-xs text-ink-2 tabular-nums">
              <Meter
                size="sm"
                fraction={hp}
                tone="bad"
                label={t(($) => $.combat.healthLeft, { percent: fmt.pct(hp, 0) })}
                className="max-w-40"
              />
              {t(($) => $.combat.hp, { percent: fmt.pct(hp, 0) })}
            </span>
          )}
        </span>
      </span>
      <dl className="m-0 flex gap-5 text-xs text-ink-3 tabular-nums">
        <div className="flex flex-col">
          <dt>{t(($) => $.combat.time)}</dt>
          <dd className="m-0 text-md font-semibold text-ink">{clock(live.duration_ms)}</dd>
        </div>
        <div className="flex flex-col">
          <dt>{t(($) => $.combat.damage)}</dt>
          <dd className="m-0 text-md font-semibold text-ink">{fmt.compact.format(total)}</dd>
        </div>
        {leader && (
          <div className="flex max-w-36 flex-col">
            <dt>{t(($) => $.combat.top)}</dt>
            <dd className="m-0 truncate text-md font-semibold text-ink">
              {leader.name ?? leader.label}
            </dd>
          </div>
        )}
      </dl>
      <Button size="sm" variant="primary" icon={<Icon name="meter" size={14} />} onClick={onOpen}>
        {t(($) => $.combat.openLive)}
      </Button>
    </Panel>
  );
}

/** Every in-game window, shown or hidden in one click, with the meter's hotkeys. */
function Windows({
  native,
  windows,
  radar,
  hotkeys,
}: {
  native: boolean;
  windows: HomeWindows;
  radar: HomeRadar;
  hotkeys: OfflineHotkeys;
}) {
  const { t } = useTranslation('home');
  const titleId = useId();
  const state = (requested: boolean) =>
    windowState({ known: windows.known, requested, held: windows.suspended });
  const groupState: WindowState =
    windows.known && windows.group && !(windows.groupRequested ?? windows.group)
      ? 'waitingForRaid'
      : state(windows.group && (windows.groupRequested ?? windows.group));
  const radarState = windowState({
    known: radar.known,
    requested: radar.status.requested,
    held: !radar.status.visible,
  });
  return (
    <Panel
      as="section"
      padding="none"
      aria-labelledby={titleId}
      className="w-full max-w-[29rem] flex-none p-4 max-[1020px]:max-w-none"
    >
      <h2
        id={titleId}
        className="m-0 mb-3 text-2xs font-semibold tracking-caps text-ink-3 uppercase"
      >
        {t(($) => $.windows.title)}
      </h2>
      {/* Stacked tiles let longer window states wrap within a half-width cell. */}
      <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
        <DpsToggle
          visible={windows.dps}
          suspended={windows.suspended}
          known={windows.known}
          busy={windows.busy}
          disabled={!native}
          {...(hotkeys.toggle_overlay ? { shortcut: hotkeys.toggle_overlay } : {})}
          stacked
          onToggle={windows.onToggleDps}
        />
        <Button
          size="sm"
          className={stackedSwitch}
          aria-pressed={windows.locked}
          disabled={!native || !windows.known || windows.busy}
          icon={<Icon name={windows.locked ? 'lock' : 'unlock'} size={14} />}
          title={
            windows.locked
              ? t(($) => $.windows.lockedTitle, { key: hotkeys.toggle_lock })
              : t(($) => $.windows.movableTitle, { key: hotkeys.toggle_lock })
          }
          onClick={() => windows.onLock(!windows.locked)}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-px leading-tight">
            <span className="font-semibold">
              {windows.locked ? t(($) => $.windows.locked) : t(($) => $.windows.lock)}
            </span>
            <span
              className={cn('text-xs', windows.locked ? 'text-accent' : 'text-ink-3')}
              aria-hidden="true"
            >
              {windows.locked ? t(($) => $.windows.clickThrough) : t(($) => $.windows.movable)}
            </span>
          </span>
        </Button>
        <WindowSwitch
          on={windows.known && windows.group}
          icon="group"
          label={t(($) => $.windows.group)}
          state={groupState}
          busy={windows.busy}
          disabled={!native || !windows.known}
          stacked
          title={windows.group ? t(($) => $.windows.groupDisable) : t(($) => $.windows.groupEnable)}
          onClick={windows.onToggleGroup}
        />
        <WindowSwitch
          on={windows.known && windows.trackers}
          icon="trackers"
          label={t(($) => $.windows.trackers)}
          state={state(windows.trackers)}
          busy={windows.busy}
          disabled={!native || !windows.known}
          stacked
          title={t(($) => $.windows.trackersTitle)}
          onClick={windows.onToggleTrackers}
        />
        <WindowSwitch
          on={radar.known && radar.status.requested}
          icon="paw"
          label={t(($) => $.windows.radar)}
          state={radarState}
          busy={radar.busy}
          disabled={!native || !radar.known}
          stacked
          title={t(($) => $.windows.radarTitle)}
          onClick={() => void radar.toggle()}
        />
        {(
          [
            {
              id: 'timers',
              label: t(($) => $.windows.timers),
              title: t(($) => $.windows.timersTitle),
              icon: 'timers',
              control: windows.timers,
            },
            {
              id: 'explore',
              label: t(($) => $.windows.explore),
              title: t(($) => $.windows.exploreTitle),
              icon: 'compass',
              control: windows.explore,
            },
          ] as const
        ).map(
          ({ id, label, title, icon, control }) =>
            control && (
              <WindowSwitch
                key={id}
                on={control.known && control.requested}
                icon={icon}
                label={label}
                state={windowState({
                  known: control.known,
                  requested: control.requested,
                  held: !control.visible,
                })}
                busy={control.busy}
                disabled={!native || !control.known}
                stacked
                title={title}
                onClick={control.onToggle}
              />
            ),
        )}
      </div>
      <p className="mt-3 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <Icon name="keyboard" size={13} />
        {hotkeys.toggle_overlay && (
          <span>
            <Trans
              t={t}
              i18nKey={($) => $.windows.showHide}
              values={{ key: hotkeys.toggle_overlay }}
              components={[<kbd key="key" />]}
            />
          </span>
        )}
        <span>
          <Trans
            t={t}
            i18nKey={($) => $.windows.lockKey}
            values={{ key: hotkeys.toggle_lock }}
            components={[<kbd key="key" />]}
          />
        </span>
      </p>
    </Panel>
  );
}

/**
 * The workspace's front page: what is going on and what to do next. A greeting with the
 * capture state and the in-game windows, whatever is ringing, then what opens next, the
 * last fights and the pet being farmed; a first-steps list until the basics are done.
 * Every section shows only real data and says honestly when it has none.
 */
export function HomePanel({
  native,
  live,
  captureError,
  liveTarget,
  windows,
  hotkeys,
  autoSave,
  libraryCount,
  alerts,
  setup,
  pets,
  radar,
  petIndex,
  recent,
  update,
  onNavigate,
  onOpenLog,
}: HomePanelProps) {
  const { t } = useTranslation(['home', 'common']);
  const titleId = useId();
  const config = pets.status?.config;
  const [hidden, setHidden] = useState(readHidden);

  const capture = captureState(live);
  // The setup band says what to do; the native reason stays in Setup. A status kept from before
  // a failed probe is not confirmed, so capture's own error shows.
  const blocked = setupBlocking(
    capture,
    setup.error ? null : captureIssue(setup.status),
    captureError,
  );
  const dashboard = alerts.dashboard;
  const profile = pets.status?.profiles.find((p) => p.id === pets.status?.active_profile_id);
  const name = localName(live, profile?.name ?? null);
  const server = dashboard?.detected_server?.name ?? null;

  const steps = firstSteps({
    capturing: capture === 'capturing',
    meterShown: windows.known && windows.dps,
    savedFights: libraryCount,
    alertOn: !!dashboard?.config.enabled && dashboard.config.rules.some((r) => r.enabled),
    farming: !!config?.farming_goal,
  });
  const details: Record<StepId, StepDetail> = {
    game: {
      hint: blocked
        ? t(($) => $.capture.setup.hint[blocked])
        : capture === 'error'
          ? captureError || live.message || t(($) => $.capture.hint.error, { ns: 'common' })
          : t(($) => $.steps.gameHint),
    },
    meter: {
      hint: hotkeys.toggle_overlay ? (
        <Trans
          t={t}
          i18nKey={($) => $.steps.meterHintKey}
          values={{ key: hotkeys.toggle_overlay }}
          components={[<kbd key="key" />]}
        />
      ) : (
        t(($) => $.steps.meterHint)
      ),
      action: {
        label: t(($) => $.steps.meterAction),
        onClick: windows.onToggleDps,
        disabled: !native || !windows.known || windows.busy,
      },
    },
    fight: {
      hint:
        autoSave === false ? t(($) => $.steps.fightHintAutoSaveOff) : t(($) => $.steps.fightHint),
      ...(autoSave === false
        ? {
            action: {
              label: t(($) => $.steps.fightAction),
              onClick: () => onNavigate('settings'),
            },
          }
        : {}),
    },
    alerts: {
      hint: t(($) => $.steps.alertsHint),
      action: { label: t(($) => $.steps.alertsAction), onClick: () => onNavigate('alerts') },
    },
    pets: {
      hint: t(($) => $.steps.petsHint),
      action: { label: t(($) => $.steps.petsAction), onClick: () => onNavigate('pets') },
    },
  };
  const doneCount = steps.filter((s) => s.done).length;
  const showSteps = !hidden && doneCount < steps.length;
  const stepsFirst = showSteps && doneCount < 3;
  // Before anything is chosen or picked up, Getting started already points to Pets.
  const petsEmpty = !config?.farming_goal && !config?.pinned_ids.length && !sessionOf(pets.status);
  const showPets = !(petsEmpty && showSteps && !steps.find((s) => s.id === 'pets')?.done);
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_FIRST_STEPS, '1');
    } catch {
      // Hidden for this session only.
    }
  };
  const gettingStarted = showSteps ? (
    <GettingStarted steps={steps} details={details} onHide={hide} />
  ) : null;

  const main = (
    <div className="flex min-w-0 flex-col gap-5 min-[1020px]:col-start-1 min-[1020px]:row-start-1">
      <NextUpCard alerts={alerts} onOpenAlerts={() => onNavigate('alerts')} />
      <LastFights
        logs={native ? recent.logs : []}
        error={recent.error}
        autoSave={autoSave}
        onOpen={onOpenLog}
        onOpenLogs={() => onNavigate('logs')}
      />
    </div>
  );
  const side = (
    <div className="flex min-w-0 flex-col gap-5 min-[1020px]:col-start-2 min-[1020px]:row-start-1">
      {stepsFirst && gettingStarted}
      {showPets && (
        <PetFarmingCard
          pets={pets}
          radar={radar}
          index={petIndex}
          onOpenPets={() => onNavigate('pets')}
        />
      )}
      {!stepsFirst && gettingStarted}
    </div>
  );

  return (
    <div className="flex flex-col pb-14" data-home="page">
      {update && (
        <Notice tone="info" className="mt-0 mb-5">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span>
              {update.version ? (
                <Trans
                  t={t}
                  i18nKey={($) =>
                    update.ready ? $.update.readyVersion : $.update.availableVersion
                  }
                  values={{ version: update.version }}
                  components={[<b key="version" className="font-semibold" />]}
                />
              ) : update.ready ? (
                t(($) => $.update.ready)
              ) : (
                t(($) => $.update.available)
              )}
            </span>
            <Button size="xs" onClick={() => onNavigate('settings')}>
              {update.ready ? t(($) => $.update.restart) : t(($) => $.update.see)}
            </Button>
          </span>
        </Notice>
      )}

      <section
        aria-labelledby={titleId}
        className="mb-7 flex flex-wrap items-start justify-between gap-x-10 gap-y-6 pt-2"
      >
        <div className="min-w-0 flex-1 basis-96">
          <Greeting titleId={titleId} name={name} />
          <p
            className="mt-3 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-md text-ink-2"
            data-home="capture"
            data-state={blocked ? 'setup' : capture}
          >
            <StatusDot
              tone={blocked ? SETUP_TONE[blocked] : CAPTURE_TONE[capture]}
              live={capture === 'capturing'}
            />
            <b className="font-semibold text-ink">
              {blocked
                ? t(($) => $.capture.setup.label[blocked])
                : t(($) => $.capture.label[capture], { ns: 'common' })}
            </b>
            <span className="text-ink-3">
              {blocked
                ? t(($) => $.capture.detail, { detail: t(($) => $.capture.setup.hint[blocked]) })
                : capture === 'capturing'
                  ? server
                    ? t(($) => $.capture.onServer, { server })
                    : t(($) => $.capture.receiving)
                  : t(($) => $.capture.detail, {
                      detail:
                        capture === 'error'
                          ? captureError ||
                            live.message ||
                            t(($) => $.capture.hint.error, { ns: 'common' })
                          : t(($) => $.capture.hint[capture], { ns: 'common' }),
                    })}
            </span>
          </p>
          {fightInProgress(live) ? (
            <InCombat live={live} target={liveTarget} onOpen={() => onNavigate('live')} />
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<Icon name="meter" size={14} />}
                onClick={() => onNavigate('live')}
              >
                {t(($) => $.shortcuts.live)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="book" size={14} />}
                onClick={() => onNavigate('logs')}
              >
                {t(($) => $.shortcuts.logs)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="trackers" size={14} />}
                onClick={() => onNavigate('trackers')}
              >
                {t(($) => $.shortcuts.trackers)}
              </Button>
            </div>
          )}
        </div>
        <Windows native={native} windows={windows} radar={radar} hotkeys={hotkeys} />
      </section>

      <RingingNow active={dashboard?.active ?? []} busy={alerts.busy} onAction={alerts.action} />

      {/* Shown whether or not the first steps are hidden; a connected capture outranks a stale probe. */}
      {capture !== 'capturing' && (
        <SetupBand setup={setup} onOpenSetup={() => onNavigate('setup')} />
      )}

      <div
        className={cn(
          'grid items-start gap-5',
          'min-[1020px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]',
        )}
      >
        {/* On a first run the steps come first, in reading and focus order too. */}
        {stepsFirst ? (
          <>
            {side}
            {main}
          </>
        ) : (
          <>
            {main}
            {side}
          </>
        )}
      </div>
    </div>
  );
}
