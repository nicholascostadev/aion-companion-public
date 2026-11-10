import { useCallback, useEffect, useRef, useState } from 'react';
import {
  begin,
  decide,
  finish,
  opensByItself,
  parseProgress,
  quiet,
  serializeProgress,
  STORAGE_KEY,
  visit,
  type ChapterId,
  type Decision,
  type GuideProgress,
  type SetupStep,
} from '../features/onboarding/model';
import { loadDemo, type DemoFight } from '../features/onboarding/demo';

function read(): GuideProgress | null {
  try {
    return parseProgress(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function write(progress: GuideProgress | null) {
  if (!progress) return;
  try {
    localStorage.setItem(STORAGE_KEY, serializeProgress(progress));
  } catch {
    // Kept for this session only; the guide still works.
  }
}

/**
 * The getting-started guide's state: whether it is open, the step, and the reader's
 * progress and decisions, kept in local storage so it resumes where it was left. It opens by
 * itself only on a first run (nothing stored and no saved fights), once; afterwards only the
 * reader opens it. Finishing is the review's call: it checks the app's real state first.
 */
export function useGuide({ savedFights }: { savedFights: number | null }) {
  const [progress, setProgress] = useState<GuideProgress | null>(read);
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState<DemoFight | null | undefined>(undefined);

  useEffect(() => write(progress), [progress]);
  // What Finish checks when it runs, however long after the click that asked for it.
  const latest = useRef({ open, progress });
  useEffect(() => {
    latest.current = { open, progress };
  });

  const show = useCallback((chapter?: ChapterId) => {
    setProgress((p) => begin(p, chapter));
    setOpen(true);
  }, []);

  // The first run: stored at once, so it never opens by itself again.
  if (opensByItself(progress, savedFights)) {
    setProgress(begin(null));
    setOpen(true);
  }

  // The sample fight loads the first time the guide opens, in its own small chunk.
  useEffect(() => {
    if (!open || demo !== undefined) return;
    let current = true;
    loadDemo().then(
      (value) => current && setDemo(value),
      () => current && setDemo(null),
    );
    return () => {
      current = false;
    };
  }, [open, demo]);

  return {
    progress,
    open,
    demo,
    show,
    close: useCallback(() => setOpen(false), []),
    goTo: useCallback(
      (chapter: ChapterId) => setProgress((p) => (p ? visit(p, chapter) : begin(p, chapter))),
      [],
    ),
    /** Records the reader's decision on a step and moves on. */
    decide: useCallback(
      (step: SetupStep, decision: Decision) =>
        setProgress((p) => decide(p ?? begin(null, step), step, decision)),
      [],
    ),
    /**
     * Finish. The review checks the app's state before calling it; here it only takes effect
     * while the guide is open on the review, so a late call after the reader moved on (or
     * closed it) changes nothing.
     */
    done: useCallback(() => {
      const now = latest.current;
      if (!now.open || now.progress?.chapter !== 'review') return;
      setProgress(finish(now.progress));
      setOpen(false);
    }, []),
    quiet: useCallback(() => setProgress(quiet), []),
  };
}

export type GuideController = ReturnType<typeof useGuide>;
