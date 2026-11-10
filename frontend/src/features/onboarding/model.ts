/*
 * The getting-started guide: a setup wizard whose steps each configure one part of the app
 * in place, and the reader's progress through it. Progress is a small per-PC convenience
 * kept in this window's local storage: where to resume, which steps were opened and the
 * decision made on each. Whether a step is actually ready is never stored: it is read from
 * the app's own state every time (see `stepState`), so the guide finishes only on real,
 * saved setup.
 */

/** The steps in order; each also names its messages (`onboarding.chapters.<id>`). */
export const CHAPTERS = [
  'language',
  'capture',
  'meter',
  'inspect',
  'profiles',
  'alerts',
  'pets',
  'explore',
  'updates',
  'review',
] as const;
export type ChapterId = (typeof CHAPTERS)[number];
/** Every step but the closing review, each needing a decision before Finish. */
export type SetupStep = Exclude<ChapterId, 'review'>;
export const SETUP_STEPS = CHAPTERS.filter((id): id is SetupStep => id !== 'review');

export const isChapter = (value: unknown): value is ChapterId =>
  typeof value === 'string' && (CHAPTERS as readonly string[]).includes(value);

/** Required steps: Finish waits for them to be ready; the rest may be skipped. */
export const REQUIRED: readonly SetupStep[] = ['language', 'capture'];
/** Optional features: set up, or explicitly skipped (never switched on by the guide). */
export const OPTIONAL: readonly SetupStep[] = ['alerts', 'pets', 'explore'];

/**
 * What the reader decided on a step: `done` confirmed it (or, for a feature, set it up),
 * `skipped` leaves an optional feature as it is, `later` defers capture setup (the guide then
 * stays unfinished and resumable).
 */
export type Decision = 'done' | 'skipped' | 'later';
export type Decisions = Partial<Record<SetupStep, Decision>>;

export interface GuideProgress {
  /** The step to open on: the one the reader was on when they left. */
  chapter: ChapterId;
  /** Steps opened at least once, in order. */
  seen: ChapterId[];
  /** The decision recorded on each step; absent means none yet. */
  decisions: Decisions;
  /** The review's Finish was used with every step resolved. */
  finished: boolean;
  /** Home's resume band was put away; the header's Guide button still opens it. */
  quiet: boolean;
}

export const STORAGE_KEY = 'aion-companion.onboarding';
const VERSION = 2;

const inOrder = (ids: Iterable<ChapterId>) => {
  const set = new Set(ids);
  return CHAPTERS.filter((id) => set.has(id));
};

const DECISIONS: Record<SetupStep, readonly Decision[]> = {
  language: ['done'],
  capture: ['done', 'later'],
  meter: ['done'],
  inspect: ['done'],
  profiles: ['done'],
  alerts: ['done', 'skipped'],
  pets: ['done', 'skipped'],
  explore: ['done', 'skipped'],
  updates: ['done'],
};

/** A decision the step allows; anything else is dropped on reading. */
export const allowed = (step: SetupStep, decision: Decision) => DECISIONS[step].includes(decision);

function parseDecisions(value: unknown): Decisions {
  if (typeof value !== 'object' || value === null) return {};
  const out: Decisions = {};
  for (const step of SETUP_STEPS) {
    const d = (value as Record<string, unknown>)[step];
    if ((d === 'done' || d === 'skipped' || d === 'later') && allowed(step, d)) out[step] = d;
  }
  return out;
}

/**
 * Progress as stored, or null when there is none (a first run) or it cannot be read. The
 * first version (chapters read, no decisions and no language step) is kept: its place,
 * what was read and whether it was finished or put away carry over, with no decisions.
 */
export function parseProgress(raw: string | null): GuideProgress | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if ((v.version !== 1 && v.version !== VERSION) || !isChapter(v.chapter)) return null;
    const seen = Array.isArray(v.seen) ? v.seen.filter(isChapter) : [];
    return {
      chapter: v.chapter,
      seen: inOrder([...seen, v.chapter]),
      decisions: v.version === VERSION ? parseDecisions(v.decisions) : {},
      finished: v.finished === true,
      quiet: v.quiet === true,
    };
  } catch {
    return null;
  }
}

export const serializeProgress = (progress: GuideProgress) =>
  JSON.stringify({ version: VERSION, ...progress });

const fresh = (chapter: ChapterId): GuideProgress => ({
  chapter,
  seen: [],
  decisions: {},
  finished: false,
  quiet: false,
});

/**
 * The step the guide opens on when no step is asked for. A guide whose language was never
 * chosen (a first run, or progress kept from before the language step) opens on the
 * language step, every time until a language is chosen there; after that it resumes where
 * the reader left off. A finished guide is never sent back to it: Language stays one click
 * away in the step list.
 */
export function resumeAt(progress: GuideProgress | null): ChapterId {
  const needsLanguage = !progress?.finished && progress?.decisions.language !== 'done';
  return needsLanguage ? 'language' : (progress?.chapter ?? CHAPTERS[0]);
}

/** Opening the guide: on `chapter` if given, otherwise where it resumes (`resumeAt`). */
export function begin(progress: GuideProgress | null, chapter?: ChapterId): GuideProgress {
  const at = chapter ?? resumeAt(progress);
  return visit(progress ?? fresh(at), at);
}

/** Moving to `chapter`: it becomes the resume point and counts as seen. */
export function visit(progress: GuideProgress, chapter: ChapterId): GuideProgress {
  if (progress.chapter === chapter && progress.seen.includes(chapter)) return progress;
  return { ...progress, chapter, seen: inOrder([...progress.seen, chapter]) };
}

/** Records a decision on `step` and moves on to the next step. */
export function decide(
  progress: GuideProgress,
  step: SetupStep,
  decision: Decision,
): GuideProgress {
  if (!allowed(step, decision)) return progress;
  const next = neighbours(step).next ?? 'review';
  return visit({ ...progress, decisions: { ...progress.decisions, [step]: decision } }, next);
}

/** Finish on the review: the guide is finished and Home stops offering it. */
export const finish = (progress: GuideProgress): GuideProgress => ({
  ...progress,
  finished: true,
  quiet: true,
});

/** Puts Home's offer away without finishing the guide (or, never opened, without starting it). */
export const quiet = (progress: GuideProgress | null): GuideProgress => ({
  ...(progress ?? fresh(CHAPTERS[0])),
  quiet: true,
});

export function neighbours(chapter: ChapterId) {
  const index = CHAPTERS.indexOf(chapter);
  return {
    index,
    previous: index > 0 ? CHAPTERS[index - 1]! : null,
    next: index < CHAPTERS.length - 1 ? CHAPTERS[index + 1]! : null,
  };
}

/**
 * Whether to open the guide by itself: only on a true first run, once. Nothing stored and
 * no saved fights yet; while the library count is unknown it waits rather than guess, and
 * someone who already has saved fights is offered it on Home instead of interrupted.
 */
export function opensByItself(progress: GuideProgress | null, savedFights: number | null) {
  return progress === null && savedFights === 0;
}

/** Whether Home offers to start or resume the guide. */
export const homeOffers = (progress: GuideProgress | null) =>
  progress === null || (!progress.finished && !progress.quiet);

/* ---------- Readiness ---------- */

/**
 * The app's own answers each step is judged by; null is unknown and never counts as ready.
 * `captureReady`: Npcap works and capture has opened (connected, or waiting for the game).
 */
export interface SetupFacts {
  captureReady: boolean;
  /** Reminders are on with at least one alert enabled. */
  alertsOn: boolean | null;
  /** A pet farming goal is saved, or a pet is pinned to lead the radar. */
  petsOn: boolean | null;
  /** The Explore map shows a finder, or its in-game window is asked for. */
  exploreOn: boolean | null;
}

/** What is happening on one step right now. */
export interface StepActivity {
  /** A change made there is still being saved, or its window, save or check is busy. */
  pending: boolean;
  /** A change made there was not saved, or the feature reports an error. */
  problem: boolean;
}
export type Activity = Partial<Record<SetupStep, StepActivity>>;

/**
 * Where a step stands: `ready` (set up, or confirmed as it is), `skipped` (an optional
 * feature left as it is), `deferred` (capture set up later), `saving` (something is still in
 * flight there, so nothing is claimed yet), `problem` (a change there was not saved or the
 * feature reports an error) or `todo` (no decision yet, or one the app's state no longer
 * bears out).
 */
export type StepState = 'ready' | 'skipped' | 'deferred' | 'saving' | 'problem' | 'todo';

function decided(step: SetupStep, decisions: Decisions, facts: SetupFacts): StepState {
  const decision = decisions[step];
  switch (step) {
    case 'capture':
      if (facts.captureReady) return 'ready';
      return decision === 'later' ? 'deferred' : 'todo';
    case 'alerts':
    case 'pets':
    case 'explore': {
      if (decision === 'skipped') return 'skipped';
      const on =
        step === 'alerts' ? facts.alertsOn : step === 'pets' ? facts.petsOn : facts.exploreOn;
      return decision === 'done' && on === true ? 'ready' : 'todo';
    }
    default:
      return decision === 'done' ? 'ready' : 'todo';
  }
}

/**
 * A step's state from its decision, the app's facts and what is happening on it. Anything
 * still in flight is `saving`, even on a skipped step: its outcome is not known yet. A
 * problem counts on its own step only, and not once an optional feature is skipped: its
 * errors stay shown there, but a feature left as it is never holds the guide back.
 */
export function stepState(
  step: SetupStep,
  decisions: Decisions,
  facts: SetupFacts,
  activity: Activity = {},
): StepState {
  const now = activity[step];
  if (now?.pending) return 'saving';
  const state = decided(step, decisions, facts);
  return now?.problem && state !== 'skipped' ? 'problem' : state;
}

/** Why Finish is not available yet, most pressing first. */
export type FinishBlock = 'saving' | 'problem' | 'deferred' | 'undecided';

const BLOCK_OF: Partial<Record<StepState, FinishBlock>> = {
  saving: 'saving',
  problem: 'problem',
  deferred: 'deferred',
  todo: 'undecided',
};
const BLOCK_ORDER: readonly FinishBlock[] = ['saving', 'problem', 'deferred', 'undecided'];

/**
 * Finish needs every step ready or skipped: nothing in flight anywhere and no unresolved
 * problem on a step that is not skipped. Each block names the steps it comes from, so the
 * review can send the reader there; empty when Finish is available. Deferred capture keeps
 * the guide unfinished (and resumable) rather than claiming it works.
 */
export function finishBlocks(
  decisions: Decisions,
  facts: SetupFacts,
  activity: Activity = {},
): { kind: FinishBlock; steps: SetupStep[] }[] {
  const steps = new Map<FinishBlock, SetupStep[]>();
  for (const step of SETUP_STEPS) {
    const kind = BLOCK_OF[stepState(step, decisions, facts, activity)];
    if (kind) steps.set(kind, [...(steps.get(kind) ?? []), step]);
  }
  return BLOCK_ORDER.filter((kind) => steps.has(kind)).map((kind) => ({
    kind,
    steps: steps.get(kind)!,
  }));
}

/** The interface language a stored settings value already shows, so choosing it saves nothing. */
export const languageSaved = (stored: string, locale: string) =>
  stored === locale || (stored === 'pt' && locale === 'pt-BR');
