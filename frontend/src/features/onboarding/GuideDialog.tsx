import { useEffect, useRef, useState, type RefObject } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../../components/ui/Dialog';
import { Notice } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { useLocale, useTranslation } from '../../i18n/provider';
import { UI_LOCALE_NAMES, UI_LOCALES, type UiLocale } from '../../i18n/locale';
import type { CaptureState } from '../../lib/capture';
import { cn } from '../../lib/cn';
import type { FinderPreferencesControl } from '../../lib/finderPreferences';
import type { AlertActionName, AlertConfig, AlertDashboard, AlertSound } from '../../types/alerts';
import type { OfflineSettings } from '../../types/offline';
import type { PetFarmingGoal, PetsStatus, PetWindowStatus } from '../../types/pets';
import type { SetupState } from '../../types/setup';
import type { UpdateStatus } from '../../types/updates';
import type { PetIndex } from '../pets/model';
import type { DemoFight } from './demo';
import {
  CHAPTERS,
  finishBlocks,
  languageSaved,
  neighbours,
  OPTIONAL,
  REQUIRED,
  SETUP_STEPS,
  stepState,
  type Activity,
  type ChapterId,
  type Decision,
  type Decisions,
  type FinishBlock,
  type SetupFacts,
  type SetupStep,
  type StepState,
} from './model';
import {
  alertsOn,
  AlertsStep,
  captureReady,
  CaptureStep,
  exploreOn,
  ExploreStep,
  InspectStep,
  MeterStep,
  petsOn,
  PetsStep,
  ProfilesStep,
  SaveFailed,
  UpdatesStep,
  type MeterShortcuts,
  type SaveSettings,
  type Track,
} from './steps';
import { shortcutError } from './shortcuts';
import { useShortcutDrafts } from './useShortcutDrafts';
import { useStepActions, type StepActions } from './useStepActions';

/** Names shortcut saves on the meter step, so putting the drafts back clears their failure. */
const SHORTCUT = 'shortcut';

/** Pet farming as the guide uses it: the saved goal, the radar and the catalogue to choose from. */
export interface GuidePets {
  /** Native pet state; null until first read. */
  status: PetsStatus | null;
  error: string;
  busy: boolean;
  /** The pet catalogue, loaded when the Pets step is first shown. */
  index: PetIndex | null;
  catalogueError: string;
  farming: {
    busy: boolean;
    notice: string;
    start: (goal: PetFarmingGoal) => Promise<boolean>;
    stop: () => Promise<boolean>;
  };
  /** Pins or unpins one pet, through the pets' own save path. */
  setPinned: (id: number, pin: boolean) => Promise<boolean>;
  radar: {
    status: PetWindowStatus;
    known: boolean;
    busy: boolean;
    error: string;
    /** Asks for the radar shown or hidden; resolves false when native refused. */
    setRequested: (requested: boolean) => Promise<boolean>;
  };
}

/**
 * An in-game window the guide can show or hide: native's state and its one action. The
 * action names the state wanted, never "the other one", so a retry cannot undo a change
 * made meanwhile elsewhere.
 */
export interface GuideWindow {
  requested: boolean;
  visible: boolean;
  known: boolean;
  busy: boolean;
  error: string;
  /** Asks for the window shown or hidden; resolves false when native refused. */
  setRequested: (requested: boolean) => Promise<boolean>;
}

/** What the app knows right now and the real ways to change it, so each step sets it up. */
export interface GuideFacts {
  native: boolean;
  capture: CaptureState;
  /** Capture's own error, when it has one. */
  captureError: string;
  /** Network adapters capture has open; null before capture first reports. */
  adapters: number | null;
  setup: SetupState;
  /** The saved settings; null until native answers. */
  settings: OfflineSettings | null;
  savedFights: number | null;
  /**
   * Saves one change to the settings as saved now (never to the Settings draft); `change`
   * returns null when nothing needs saving. Resolves false when it was not saved.
   */
  saveSettings: SaveSettings;
  /** Why the last settings save failed, when native said. */
  settingsError: string;
  meter: {
    known: boolean;
    busy: boolean;
    visible: boolean;
    suspended: boolean;
    /**
     * Asks for the meter shown or hidden (never "the other one", so a retry is safe);
     * resolves false when native refused. Locking is left to the meter in game.
     */
    setVisible: (visible: boolean) => Promise<boolean>;
  };
  /** Alerts as the workspace holds them: the dashboard and the alerts' own save path. */
  alerts: {
    dashboard: AlertDashboard | null;
    error: string;
    busy: boolean;
    offsetMs: number;
    configure: (change: (config: AlertConfig) => AlertConfig) => Promise<boolean>;
    /** Mute and unmute, through the alerts' own actions. */
    action: (
      name: AlertActionName,
      id?: string | null,
      seconds?: number | null,
    ) => Promise<boolean>;
    /** Plays a preview through the alerts' own path; never marks anything delivered. */
    test: (sound: AlertSound, volume: number, popup: boolean) => Promise<boolean>;
    now: () => number;
  };
  explore: {
    prefs: FinderPreferencesControl;
    /** The in-game Explore window, when the workspace controls it. */
    window?: GuideWindow | undefined;
  };
  pets: GuidePets;
  updates: {
    status: UpdateStatus | null;
    error: string;
    busy: boolean;
    check: () => Promise<boolean>;
  };
}

export interface GuideDialogProps {
  open: boolean;
  chapter: ChapterId;
  seen: readonly ChapterId[];
  decisions: Decisions;
  facts: GuideFacts;
  /** The bundled sample fight; undefined while it loads, null when unreadable. */
  demo: DemoFight | null | undefined;
  reducedMotion: boolean;
  /** The workspace window is on screen; the sample pauses while it is not. */
  pageVisible: boolean;
  onChapter: (chapter: ChapterId) => void;
  onDecide: (step: SetupStep, decision: Decision) => void;
  onClose: () => void;
  /**
   * Finish: called only from the review, once every step is resolved and nothing is in flight
   * (checked again as Finish is pressed).
   */
  onFinish: () => void;
}

const CHAPTER_ICON: Record<ChapterId, IconName> = {
  language: 'language',
  capture: 'network',
  meter: 'meter',
  inspect: 'book',
  profiles: 'profile',
  alerts: 'bell',
  pets: 'paw',
  explore: 'compass',
  updates: 'packageCheck',
  review: 'circleCheck',
};

const STATE_TONE: Record<StepState, 'success' | 'neutral' | 'warn' | 'accent' | 'danger'> = {
  ready: 'success',
  skipped: 'neutral',
  deferred: 'warn',
  saving: 'accent',
  problem: 'danger',
  todo: 'accent',
};

/** Steps whose changes are saved settings, so a failure there can give Settings' reason. */
const SETTINGS_STEPS: readonly SetupStep[] = ['meter', 'inspect', 'profiles'];

/**
 * What is happening on each step: the guide's own actions there, and the busy flags and
 * errors of the feature the step sets up. Background errors count on their feature's step
 * only (see `stepState`, which sets them aside once an optional feature is skipped).
 * Shortcuts set on the meter step and not saved (refused, invalid or failed) are a problem
 * there until they are saved or put back.
 */
function activityOf(
  facts: GuideFacts,
  actions: StepActions,
  language: { phase: 'saving' | 'failed' } | null,
  shortcutsUnsaved: boolean,
): Activity {
  const { alerts, pets, explore } = facts;
  const own = (step: SetupStep, busy = false, error = false) => {
    const mine = actions.of(step);
    return { pending: mine.pending || busy, problem: mine.failed || error };
  };
  return {
    language: { pending: language?.phase === 'saving', problem: language?.phase === 'failed' },
    capture: { pending: facts.setup.checking, problem: false },
    meter: own('meter', facts.meter.busy, shortcutsUnsaved),
    inspect: own('inspect'),
    profiles: own('profiles'),
    alerts: own('alerts', alerts.busy, Boolean(alerts.error || alerts.dashboard?.error)),
    pets: own(
      'pets',
      pets.busy || pets.farming.busy || pets.radar.busy,
      Boolean(pets.error || pets.farming.notice || pets.radar.error),
    ),
    explore: own(
      'explore',
      explore.prefs.saving || Boolean(explore.window?.busy),
      Boolean(explore.prefs.error || explore.window?.error),
    ),
    // A failed update check is shown on its step; it never holds the guide back.
    updates: { pending: facts.updates.busy, problem: false },
  };
}

/**
 * The getting-started guide: a setup wizard in one sheet over the workspace. Language comes
 * first, in both languages at once; each following step sets up one part of the app in place
 * with its real controls, saving as it goes, and asks for a decision. The review lists every
 * step and finishes only when the app's own state says each one is ready or skipped.
 */
export function GuideDialog({
  open,
  chapter,
  seen,
  decisions,
  facts,
  demo,
  reducedMotion,
  pageVisible,
  onChapter,
  onDecide,
  onClose,
  onFinish,
}: GuideDialogProps) {
  const { t } = useTranslation('onboarding');
  const { t: ts } = useTranslation('settings');
  const { index } = neighbours(chapter);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // A new step starts at its top, and its heading takes focus for assistive technology.
  const changed = useRef(false);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
    if (changed.current) heading.current?.focus({ preventScroll: true });
    changed.current = true;
  }, [chapter]);
  useEffect(() => {
    if (!open) changed.current = false;
  }, [open]);

  // Every change made from a step is kept on that step: in flight, then failed until a
  // later change there succeeds, so Finish waits for it and the step offers to retry.
  const actions = useStepActions();

  // Shortcuts set on the meter step outlive the step: a key that was not saved stays shown
  // and holds the step back until it is saved or put back.
  const drafts = useShortcutDrafts();
  const shortcutsUnsaved = Object.keys(drafts.drafts).length > 0;
  const shortcuts: MeterShortcuts = {
    drafts: drafts.drafts,
    saving: actions.of('meter').pending,
    set: (action, value) => {
      const saved = facts.settings;
      if (!saved) return;
      drafts.set(action, value);
      // Checked here against the settings shown, then again against the newest ones as it
      // is saved (and on every retry), so a key taken meanwhile is refused, not saved.
      if (shortcutError(saved, action, value, ts)) return;
      void actions.run('meter', () => drafts.save(action, facts.saveSettings, ts), SHORTCUT);
    },
    discard: () => {
      drafts.discard();
      actions.dismiss('meter', SHORTCUT);
    },
  };

  // The language is saved through the same path as Settings; the step moves on only once it is.
  const [language, setLanguage] = useState<{
    locale: UiLocale;
    phase: 'saving' | 'failed';
  } | null>(null);
  const chooseLanguage = async (locale: UiLocale) => {
    if (language?.phase === 'saving') return;
    setLanguage({ locale, phase: 'saving' });
    const ok = await facts.saveSettings((s) =>
      languageSaved(s.locale, locale) ? null : { ...s, locale },
    );
    if (ok) {
      setLanguage(null);
      onDecide('language', 'done');
    } else setLanguage({ locale, phase: 'failed' });
  };

  const setupFacts: SetupFacts = {
    captureReady: captureReady(facts),
    alertsOn: alertsOn(facts),
    petsOn: petsOn(facts),
    exploreOn: exploreOn(facts),
  };
  const activity = activityOf(facts, actions, language, shortcutsUnsaved);
  const states = Object.fromEntries(
    SETUP_STEPS.map((s) => [s, stepState(s, decisions, setupFacts, activity)]),
  ) as Record<SetupStep, StepState>;
  const blocks = finishBlocks(decisions, setupFacts, activity);
  // Checked again as Finish is pressed: from the review only, with nothing in flight (an
  // action started since this render included) and nothing blocking.
  const finish = () => {
    if (!open || chapter !== 'review' || actions.running()) return;
    if (
      finishBlocks(decisions, setupFacts, activityOf(facts, actions, language, shortcutsUnsaved))
        .length > 0
    )
      return;
    onFinish();
  };

  const step = chapter === 'review' ? null : chapter;
  const progress = t(($) => $.progress, { at: index + 1, total: CHAPTERS.length });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup
        initialFocus={heading}
        className="h-[min(46rem,100%)] max-w-6xl max-[760px]:h-full"
      >
        <header className="flex flex-none items-center gap-3 border-b border-line-soft px-5 py-3 max-[760px]:px-4">
          <span className="grid size-8 place-items-center rounded-leaf border border-accent-line bg-accent-soft text-accent">
            <Icon name="guide" size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="m-0 text-md font-semibold tracking-tight">
              {t(($) => $.title)}
            </DialogTitle>
            <DialogDescription className="m-0 truncate text-xs text-ink-3">
              {t(($) => $.description)}
            </DialogDescription>
          </div>
          <span className="flex items-center gap-2 text-xs text-ink-3 figures min-[900px]:hidden">
            {progress}
            <Meter
              size="xs"
              fraction={(index + 1) / CHAPTERS.length}
              label={progress}
              className="w-16"
            />
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t(($) => $.close)}
            title={t(($) => $.closeTitle)}
            icon={<Icon name="close" size={15} />}
            onClick={onClose}
          />
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] max-[900px]:grid-cols-1">
          <nav
            aria-label={t(($) => $.chaptersLabel)}
            className="min-h-0 overflow-y-auto border-r border-line-soft bg-surface-2/40 p-3 max-[900px]:hidden"
          >
            <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
              {CHAPTERS.map((id, i) => (
                <li key={id}>
                  <RailItem
                    id={id}
                    number={i + 1}
                    current={id === chapter}
                    state={id === 'review' ? null : states[id]}
                    visited={seen.includes(id)}
                    onClick={() => onChapter(id)}
                  />
                </li>
              ))}
            </ol>
          </nav>
          <div ref={body} className="min-h-0 overflow-y-auto px-7 pt-6 pb-8 max-[760px]:px-4">
            {chapter === 'language' ? (
              <LanguageStep
                heading={heading}
                state={language}
                onChoose={(locale) => void chooseLanguage(locale)}
              />
            ) : (
              <>
                <p className="m-0 flex flex-wrap items-center gap-1.5 text-2xs font-semibold tracking-caps text-accent uppercase">
                  <Icon name={CHAPTER_ICON[chapter]} size={13} />
                  {t(($) => $.chapters[chapter].short)}
                  <span className="text-ink-4" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-ink-3 figures">{progress}</span>
                  {step && (
                    <>
                      <span className="text-ink-4" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-ink-3">
                        {REQUIRED.includes(step)
                          ? t(($) => $.kind.required)
                          : OPTIONAL.includes(step)
                            ? t(($) => $.kind.optional)
                            : null}
                      </span>
                    </>
                  )}
                </p>
                <h2
                  ref={heading}
                  tabIndex={-1}
                  className="mt-1.5 mb-0 text-2xl font-semibold tracking-tight outline-none"
                  data-onboarding="heading"
                >
                  {t(($) => $.chapters[chapter].title)}
                </h2>
                {chapter !== 'review' && (
                  <p className="mt-2 mb-0 max-w-2xl text-md text-ink-2">
                    {t(($) => $.chapters[chapter].lead)}
                  </p>
                )}
                <div className="mt-6" key={chapter}>
                  {chapter === 'review' ? (
                    <ReviewStep states={states} blocks={blocks} onChapter={onChapter} />
                  ) : (
                    <>
                      <StepFailure
                        chapter={chapter}
                        actions={actions}
                        reason={SETTINGS_STEPS.includes(chapter) ? facts.settingsError : ''}
                      />
                      <StepBody
                        chapter={chapter}
                        facts={facts}
                        demo={demo}
                        reducedMotion={reducedMotion}
                        active={open && pageVisible}
                        shortcuts={shortcuts}
                        track={(action) => actions.run(chapter, action)}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3 max-[760px]:px-4">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t(($) => $.later)}
          </Button>
          <span className="flex-1" />
          <StepActions
            chapter={chapter}
            states={states}
            decisions={decisions}
            facts={setupFacts}
            pending={chapter !== 'review' && Boolean(activity[chapter]?.pending)}
            held={
              // Said once the save settles; while it runs the step is saving, not held.
              chapter === 'meter' && shortcutsUnsaved && !activity.meter?.pending
                ? t(($) => $.chapters.meter.needShortcuts)
                : ''
            }
            canFinish={blocks.length === 0}
            onChapter={onChapter}
            onDecide={onDecide}
            onFinish={finish}
          />
        </footer>
      </DialogPopup>
    </Dialog>
  );
}

function StepBody({
  chapter,
  facts,
  demo,
  reducedMotion,
  active,
  shortcuts,
  track,
}: {
  chapter: Exclude<ChapterId, 'language' | 'review'>;
  facts: GuideFacts;
  demo: DemoFight | null | undefined;
  reducedMotion: boolean;
  active: boolean;
  shortcuts: MeterShortcuts;
  /** Runs a change as one made on this step. */
  track: Track;
}) {
  const save: SaveSettings = (change) => track(() => facts.saveSettings(change));
  switch (chapter) {
    case 'capture':
      return <CaptureStep facts={facts} />;
    case 'meter':
      return (
        <MeterStep
          facts={facts}
          demo={demo}
          reducedMotion={reducedMotion}
          active={active}
          shortcuts={shortcuts}
          track={track}
        />
      );
    case 'inspect':
      return <InspectStep facts={facts} save={save} />;
    case 'profiles':
      return <ProfilesStep facts={facts} save={save} />;
    case 'alerts':
      return <AlertsStep facts={facts} active={active} track={track} />;
    case 'pets':
      return <PetsStep facts={facts} track={track} />;
    case 'explore':
      return <ExploreStep facts={facts} track={track} />;
    case 'updates':
      return <UpdatesStep facts={facts} />;
  }
}

/** A change made on this step that was not saved, with the way to try it again here. */
function StepFailure({
  chapter,
  actions,
  reason,
}: {
  chapter: SetupStep;
  actions: StepActions;
  reason: string;
}) {
  const mine = actions.of(chapter);
  if (!mine.failed) return null;
  const retry = mine.retry;
  return (
    <SaveFailed
      reason={reason}
      busy={mine.pending}
      {...(retry ? { onRetry: () => void retry() } : {})}
    />
  );
}

/** One step in the rail: its number, or how it stands once decided. */
function RailItem({
  id,
  number,
  current,
  state,
  visited,
  onClick,
}: {
  id: ChapterId;
  number: number;
  current: boolean;
  state: StepState | null;
  visited: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const shown = state === 'todo' ? null : state;
  return (
    <Pressable
      aria-current={current ? 'step' : undefined}
      data-chapter={id}
      data-state={state ?? undefined}
      className={cn(
        selectableRow(current),
        'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm',
        current ? 'text-ink' : 'text-ink-2 hover:bg-row-hover hover:text-ink',
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          'grid size-5.5 shrink-0 place-items-center rounded-full text-2xs font-semibold figures',
          current
            ? 'bg-accent text-accent-ink'
            : shown === 'ready'
              ? 'bg-success-soft text-success'
              : shown === 'deferred'
                ? 'bg-warn-soft text-warn'
                : shown === 'problem'
                  ? 'bg-danger-soft text-danger'
                  : shown === 'saving'
                    ? 'bg-accent-soft text-accent'
                    : shown === 'skipped'
                      ? 'bg-surface-3 text-ink-3'
                      : visited
                        ? 'border border-line-strong text-ink-2'
                        : 'border border-line text-ink-3',
        )}
        aria-hidden="true"
      >
        {current || !shown ? (
          number
        ) : shown === 'ready' ? (
          <Icon name="check" size={11} strokeWidth={2.4} />
        ) : shown === 'deferred' ? (
          <Icon name="hourglass" size={11} />
        ) : shown === 'saving' ? (
          <Icon name="loader" size={11} className="animate-spin motion-reduce:animate-none" />
        ) : shown === 'problem' ? (
          <Icon name="warning" size={11} />
        ) : (
          <Icon name="minus" size={11} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{t(($) => $.chapters[id].short)}</span>
      {state && <span className="sr-only">({t(($) => $.state[state])})</span>}
    </Pressable>
  );
}

/** The footer's way on: the decision this step asks for, or the next step once decided. */
function StepActions({
  chapter,
  states,
  decisions,
  facts,
  pending,
  held,
  canFinish,
  onChapter,
  onDecide,
  onFinish,
}: {
  chapter: ChapterId;
  states: Record<SetupStep, StepState>;
  decisions: Decisions;
  facts: SetupFacts;
  pending: boolean;
  /** Why this step cannot be confirmed yet, when something on it must be resolved first. */
  held: string;
  canFinish: boolean;
  onChapter: (chapter: ChapterId) => void;
  onDecide: (step: SetupStep, decision: Decision) => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const { previous, next } = neighbours(chapter);
  const back = previous && (
    <Button
      size="sm"
      icon={<Icon name="chevronLeft" size={14} />}
      onClick={() => onChapter(previous)}
    >
      {t(($) => $.back)}
    </Button>
  );
  const nextButton = (decide?: () => void) =>
    next && (
      <Button size="sm" variant="primary" onClick={decide ?? (() => onChapter(next))}>
        {t(($) => $.next, { title: t(($) => $.chapters[next].short) })}
        <Icon name="chevronRight" size={14} />
      </Button>
    );
  if (chapter === 'review')
    return (
      <>
        {back}
        <Button
          size="sm"
          variant="primary"
          icon={<Icon name="check" size={14} />}
          disabled={!canFinish}
          onClick={onFinish}
        >
          {t(($) => $.chapters.review.finish)}
        </Button>
      </>
    );
  const step: SetupStep = chapter;
  const state = states[step];
  const decided = decisions[step] !== undefined && state !== 'todo';
  switch (step) {
    case 'language':
      // The language cards are the decision; once made, the way on is plain.
      return (
        <>
          {back}
          {decided && nextButton()}
        </>
      );
    case 'capture':
      return (
        <>
          {back}
          {state === 'ready' ? (
            nextButton(() => onDecide('capture', 'done'))
          ) : state === 'deferred' ? (
            nextButton()
          ) : (
            <Button
              size="sm"
              icon={<Icon name="hourglass" size={14} />}
              onClick={() => onDecide('capture', 'later')}
            >
              {t(($) => $.chapters.capture.later)}
            </Button>
          )}
        </>
      );
    case 'alerts':
    case 'pets':
    case 'explore': {
      // "Use" is offered once the feature is really on; skipping never changes anything.
      const on =
        (step === 'alerts' ? facts.alertsOn : step === 'pets' ? facts.petsOn : facts.exploreOn) ===
        true;
      const use =
        step === 'alerts'
          ? t(($) => $.chapters.alerts.use)
          : step === 'pets'
            ? t(($) => $.chapters.pets.use)
            : t(($) => $.chapters.explore.use);
      const skip =
        step === 'alerts'
          ? t(($) => $.chapters.alerts.skip)
          : step === 'pets'
            ? t(($) => $.chapters.pets.skip)
            : t(($) => $.chapters.explore.skip);
      const need =
        step === 'alerts'
          ? t(($) => $.chapters.alerts.needOne)
          : step === 'pets'
            ? t(($) => $.chapters.pets.needGoal)
            : t(($) => $.chapters.explore.needOne);
      return (
        <>
          {!on && <span className="mr-2 text-xs text-ink-3 max-[760px]:basis-full">{need}</span>}
          {back}
          <Button size="sm" onClick={() => onDecide(step, 'skipped')}>
            {skip}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Icon name="check" size={14} />}
            disabled={pending || !on}
            onClick={() => onDecide(step, 'done')}
          >
            {use}
          </Button>
        </>
      );
    }
    default:
      return (
        <>
          {held && <span className="mr-2 text-xs text-ink-3 max-[760px]:basis-full">{held}</span>}
          {back}
          <Button
            size="sm"
            variant="primary"
            disabled={pending || held !== ''}
            onClick={() => onDecide(step, 'done')}
          >
            {t(($) => $.confirm)}
            <Icon name="chevronRight" size={14} />
          </Button>
        </>
      );
  }
}

/* ---------- Language ---------- */

/**
 * The first step, readable whatever language is showing: the prompt in both languages, and
 * one card per language written entirely in that language. Choosing saves the preference
 * through Settings' own path (so every window follows) and moves on only once it is saved.
 */
function LanguageStep({
  heading,
  state,
  onChoose,
}: {
  heading: RefObject<HTMLHeadingElement | null>;
  state: { locale: UiLocale; phase: 'saving' | 'failed' } | null;
  onChoose: (locale: UiLocale) => void;
}) {
  const current = useLocale();
  // The language showing now leads; the other follows, marked with its own language.
  const order = [current, ...UI_LOCALES.filter((l) => l !== current)];
  return (
    <div data-onboarding="language">
      <p className="m-0 flex items-center gap-1.5 text-2xs font-semibold tracking-caps text-accent uppercase">
        <Icon name="language" size={13} />
        {order.map((locale, i) => (
          <LanguageWord key={locale} locale={locale} first={i === 0} part="short" />
        ))}
      </p>
      <h2
        ref={heading}
        tabIndex={-1}
        className="mt-1.5 mb-0 text-2xl font-semibold tracking-tight outline-none"
        data-onboarding="heading"
      >
        {order.map((locale, i) => (
          <LanguageWord key={locale} locale={locale} first={i === 0} part="title" />
        ))}
      </h2>
      <div className="mt-2 flex max-w-2xl flex-col gap-1">
        {order.map((locale, i) => (
          <LanguagePrompt key={locale} locale={locale} quiet={i > 0} />
        ))}
      </div>
      <ul
        className="m-0 mt-6 grid max-w-2xl list-none grid-cols-2 gap-3 p-0 max-[600px]:grid-cols-1"
        aria-label={UI_LOCALES.map((l) => UI_LOCALE_NAMES[l]).join(' / ')}
      >
        {UI_LOCALES.map((locale) => (
          <li key={locale}>
            <LanguageCard
              locale={locale}
              current={locale === current}
              saving={state?.phase === 'saving' ? state.locale : null}
              onChoose={() => onChoose(locale)}
            />
          </li>
        ))}
      </ul>
      {state?.phase === 'failed' && (
        <LanguageFailed locale={state.locale} onRetry={() => onChoose(state.locale)} />
      )}
    </div>
  );
}

function LanguageWord({
  locale,
  first,
  part,
}: {
  locale: UiLocale;
  first: boolean;
  part: 'short' | 'title';
}) {
  const { t } = useTranslation('onboarding', { lng: locale });
  return (
    <span lang={locale} className={cn(!first && 'text-ink-3')}>
      {!first && (
        <span className="mx-1.5 text-ink-4" aria-hidden="true">
          ·
        </span>
      )}
      {part === 'short' ? t(($) => $.chapters.language.short) : t(($) => $.language.title)}
    </span>
  );
}

function LanguagePrompt({ locale, quiet }: { locale: UiLocale; quiet: boolean }) {
  const { t } = useTranslation('onboarding', { lng: locale });
  return (
    <p lang={locale} className={cn('m-0 text-sm', quiet ? 'text-ink-3' : 'text-ink-2')}>
      {t(($) => $.language.prompt)}
    </p>
  );
}

function LanguageCard({
  locale,
  current,
  saving,
  onChoose,
}: {
  locale: UiLocale;
  current: boolean;
  /** The language being saved now, if any: every card waits for it. */
  saving: UiLocale | null;
  onChoose: () => void;
}) {
  const { t } = useTranslation('onboarding', { lng: locale });
  const mine = saving === locale;
  return (
    <Pressable
      lang={locale}
      data-locale={locale}
      aria-busy={mine || undefined}
      disabled={saving !== null}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-4 py-3.5',
        current
          ? 'border-accent-line bg-accent-soft hover:bg-accent-soft'
          : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-hover',
      )}
      onClick={onChoose}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-md font-semibold text-ink">
          {UI_LOCALE_NAMES[locale]}
          {current && (
            <span className="rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-ink">
              {t(($) => $.language.current)}
            </span>
          )}
        </span>
        <span className="text-sm text-ink-2">
          {mine ? t(($) => $.language.saving) : t(($) => $.language.use)}
        </span>
      </span>
      <Icon
        name={mine ? 'loader' : 'chevronRight'}
        size={16}
        className={cn('shrink-0 text-ink-3', mine && 'animate-spin')}
      />
    </Pressable>
  );
}

function LanguageFailed({ locale, onRetry }: { locale: UiLocale; onRetry: () => void }) {
  const { t } = useTranslation('onboarding', { lng: locale });
  return (
    <div lang={locale} className="mt-4 max-w-2xl">
      <Notice tone="error">
        {t(($) => $.language.failed)}{' '}
        <Button variant="link" onClick={onRetry}>
          {t(($) => $.language.retry)}
        </Button>
      </Notice>
    </div>
  );
}

/* ---------- Review ---------- */

const GROUPS: { key: 'requiredTitle' | 'setupTitle' | 'optionalTitle'; steps: SetupStep[] }[] = [
  { key: 'requiredTitle', steps: ['language', 'capture'] },
  { key: 'setupTitle', steps: ['meter', 'inspect', 'profiles', 'updates'] },
  { key: 'optionalTitle', steps: ['alerts', 'pets', 'explore'] },
];

function ReviewStep({
  states,
  blocks,
  onChapter,
}: {
  states: Record<SetupStep, StepState>;
  blocks: { kind: FinishBlock; steps: SetupStep[] }[];
  onChapter: (chapter: ChapterId) => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <>
      <p className="mt-0 mb-5 max-w-2xl text-md text-ink-2">{t(($) => $.chapters.review.lead)}</p>
      <div className="grid max-w-3xl gap-5 min-[900px]:grid-cols-3">
        {GROUPS.map((group) => (
          <section key={group.key} aria-label={t(($) => $.chapters.review[group.key])}>
            <h3 className="m-0 mb-2 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
              {t(($) => $.chapters.review[group.key])}
            </h3>
            <ul className="m-0 flex list-none flex-col p-0" data-onboarding="review">
              {group.steps.map((step) => (
                <ReviewRow
                  key={step}
                  step={step}
                  state={states[step]}
                  onChange={() => onChapter(step)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-6 flex max-w-2xl flex-col gap-2 [&>[data-ui=notice]]:my-0">
        {blocks.length === 0 ? (
          <Notice tone="good">{t(($) => $.chapters.review.allSet)}</Notice>
        ) : (
          blocks.map(({ kind, steps }) => (
            <Notice key={kind} tone={kind === 'problem' ? 'error' : 'info'}>
              <span data-block={kind}>
                {t(($) => $.chapters.review[kind])}{' '}
                {steps.map((step, i) => (
                  <span key={step}>
                    {i > 0 && ', '}
                    <Button variant="link" onClick={() => onChapter(step)}>
                      {t(($) => $.chapters[step].short)}
                    </Button>
                  </span>
                ))}
              </span>
            </Notice>
          ))
        )}
      </div>
    </>
  );
}

function ReviewRow({
  step,
  state,
  onChange,
}: {
  step: SetupStep;
  state: StepState;
  onChange: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const name = t(($) => $.chapters[step].short);
  return (
    <li
      className="flex items-center gap-2.5 border-t border-line-soft py-2 first:border-t-0"
      data-step={step}
      data-state={state}
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-ink-2">
        <Icon name={CHAPTER_ICON[step]} size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{name}</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-3">
          <StatusDot tone={STATE_TONE[state]} />
          {t(($) => $.state[state])}
        </span>
      </span>
      <Button
        size="xs"
        variant="ghost"
        aria-label={t(($) => $.chapters.review.changeLabel, { step: name })}
        onClick={onChange}
      >
        {t(($) => $.chapters.review.change)}
      </Button>
    </li>
  );
}
