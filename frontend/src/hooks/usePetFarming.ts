import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/provider';
import type { PetFarmingGoal, PetsConfig, PetWindowStatus } from '../types/pets';

interface Options {
  /** Applies a preference delta to the newest native config; resolves false on failure. */
  configure: (change: (config: PetsConfig) => PetsConfig) => Promise<boolean>;
  radar: { status: PetWindowStatus; show: () => Promise<boolean> };
}

export type FarmingPhase = 'idle' | 'saving' | 'opening';

/** What went wrong, worded at render so it follows the interface language. */
type FarmingProblem = 'notSaved' | 'radarFailed' | 'stopFailed';

/**
 * Starts and stops farming one pet. Start saves the goal (and the map as the last one
 * chosen) first; only once native accepted it does it ask for the in-game radar, which then
 * leads with the goal. Stop clears only the goal: pins and the last map stay. A problem is
 * reported as it happened, never as success.
 */
export function usePetFarming({ configure, radar }: Options) {
  const [phase, setPhase] = useState<FarmingPhase>('idle');
  const { t } = useTranslation('pets');
  const [problem, setProblem] = useState<FarmingProblem | null>(null);
  const running = useRef(false);
  const win = useRef(radar);
  useEffect(() => {
    win.current = radar;
  });

  const start = useCallback(
    async (goal: PetFarmingGoal) => {
      if (running.current) return false;
      running.current = true;
      setProblem(null);
      setPhase('saving');
      try {
        const saved = await configure((config) => ({
          ...config,
          farming_goal: { pet_id: goal.pet_id, map_id: goal.map_id },
          last_map_id: goal.map_id,
        }));
        if (!saved) {
          setProblem('notSaved');
          return false;
        }
        if (!win.current.status.requested) {
          setPhase('opening');
          const shown = await win.current.show();
          if (!shown) setProblem('radarFailed');
        }
        return true;
      } finally {
        running.current = false;
        setPhase('idle');
      }
    },
    [configure],
  );

  const stop = useCallback(async () => {
    if (running.current) return false;
    running.current = true;
    setProblem(null);
    setPhase('saving');
    try {
      const saved = await configure((config) => ({ ...config, farming_goal: null }));
      if (!saved) setProblem('stopFailed');
      return saved;
    } finally {
      running.current = false;
      setPhase('idle');
    }
  }, [configure]);

  const notice = problem ? t(($) => $.farm.problem[problem]) : '';
  return { phase, busy: phase !== 'idle', notice, start, stop };
}

export type PetFarmingController = ReturnType<typeof usePetFarming>;
