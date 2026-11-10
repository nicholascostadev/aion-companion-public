import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetupStep } from './model';

interface Entry {
  /** Actions started on the step and not settled yet. */
  running: number;
  /** The last settled action there failed; cleared by the next success there. */
  failed: boolean;
  /** Runs the failed action again, on the same step. */
  retry: (() => Promise<boolean>) | null;
  /** What the failed action changed, when it said (see `dismiss`). */
  kind: string | null;
}

const IDLE: Entry = { running: 0, failed: false, retry: null, kind: null };

/**
 * The guide's own record of what each step changed: actions still in flight and the last
 * failure, kept on the step the action was started from (wherever the reader is when it
 * settles) until a later action there succeeds. An action fails when it resolves `false`
 * or throws. The record is mirrored in a ref updated as actions start, so a click handled
 * before the next render (Finish) still sees an action that just began.
 */
export function useStepActions() {
  const live = useRef(new Map<SetupStep, Entry>());
  const [shown, setShown] = useState<ReadonlyMap<SetupStep, Entry>>(() => new Map());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const set = useCallback((step: SetupStep, change: (entry: Entry) => Entry) => {
    const next = new Map(live.current);
    next.set(step, change(next.get(step) ?? IDLE));
    live.current = next;
    if (mounted.current) setShown(next);
  }, []);

  const run = useCallback(
    (
      step: SetupStep,
      action: () => Promise<unknown>,
      kind: string | null = null,
    ): Promise<boolean> => {
      const attempt = async (): Promise<boolean> => {
        set(step, (e) => ({ ...e, running: e.running + 1 }));
        let ok = false;
        try {
          ok = (await action()) !== false;
        } catch {
          ok = false;
        }
        set(step, (e) => ({
          running: e.running - 1,
          failed: !ok,
          retry: ok ? null : attempt,
          kind: ok ? null : kind,
        }));
        return ok;
      };
      return attempt();
    },
    [set],
  );

  /**
   * Forgets the failure on `step` when it came from an action of `kind`, because what it
   * tried to save was put back (so its retry would change nothing).
   */
  const dismiss = useCallback(
    (step: SetupStep, kind: string) =>
      set(step, (e) =>
        e.failed && e.kind === kind ? { ...e, failed: false, retry: null, kind: null } : e,
      ),
    [set],
  );

  return {
    /** Runs `action` as a change made on `step`; `kind` names it for `dismiss`. */
    run,
    dismiss,
    /** What the reader sees for `step`, as of this render. */
    of: (step: SetupStep) => {
      const entry = shown.get(step) ?? IDLE;
      return { pending: entry.running > 0, failed: entry.failed, retry: entry.retry };
    },
    /** Whether any action is in flight right now, including one started since this render. */
    running: () => [...live.current.values()].some((e) => e.running > 0),
  };
}

export type StepActions = ReturnType<typeof useStepActions>;
