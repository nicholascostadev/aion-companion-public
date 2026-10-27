import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { indexCatalogue, withPin, type PetIndex } from '../features/pets/model';
import { useTranslation, type Translate } from '../i18n/provider';
import { configurePets, readPetMotion, readPetsCatalogue, readPetsStatus } from '../services/pets';
import type { PetCatalogue, PetMotion, PetsConfig, PetsStatus } from '../types/pets';
import { useNativePoll } from './useNativePoll';

/** Native rejection of a save based on an older revision. */
const STALE = /changed|revision/i;

/* ---------- Catalogue: loaded once per window ---------- */

let cached: Promise<PetCatalogue> | null = null;
/** Shared catalogue request; a failure is retried on the next call. */
export function loadPetCatalogue() {
  cached ??= readPetsCatalogue().catch((cause: unknown) => {
    cached = null;
    throw cause;
  });
  return cached;
}

/**
 * The index of the catalogue in the language shown now, built once per window: Home and Pets
 * both read it, and each copy repeats every spawn point.
 */
let shared: { catalogue: PetCatalogue; language: string; index: PetIndex } | null = null;
function sharedIndex(catalogue: PetCatalogue, language: string, t: Translate<'pets'>) {
  if (shared?.catalogue !== catalogue || shared.language !== language)
    shared = { catalogue, language, index: indexCatalogue(catalogue, t) };
  return shared.index;
}

/** Tests only. */
export const resetPetCatalogue = () => {
  cached = null;
  shared = null;
};

export function usePetCatalogue(native: boolean) {
  const { t, i18n } = useTranslation('pets');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [catalogue, setCatalogue] = useState<PetCatalogue | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void loadPetCatalogue().then(
      (next) => {
        if (!cancelled) {
          setCatalogue(next);
          setError('');
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native]);
  const index = useMemo<PetIndex | null>(
    // Map labels and unnamed monsters are worded in the interface language.
    () => (catalogue ? sharedIndex(catalogue, language, t) : null),
    [catalogue, language, t],
  );
  return { catalogue, index, error };
}

/* ---------- Status and preferences ---------- */

interface Options {
  intervalMs?: number;
  /** Saved profile to show; null follows the character playing now. */
  profileId?: string | null;
  paused?: boolean;
  /** Visible maps use lightweight spatial reads between collection polls. */
  motion?: boolean;
}

/**
 * Polls `pets_status`. Preference edits are deltas applied to the newest native config;
 * on a revision conflict (another window saved first) the delta is re-applied once to a
 * fresh config instead of overwriting the other change. Saves run one at a time, in order.
 * Callers pass deltas built from plain values captured at the time of the input.
 *
 * A pin shows at once: its delta is laid over every status shown until its save settles,
 * then the native answer alone is shown (so a failed pin falls back). Polls wait for
 * pending saves, so none can overwrite it meanwhile.
 */
export function usePets(
  native: boolean,
  { intervalMs = 1000, profileId = null, paused = false, motion = false }: Options = {},
) {
  const [status, setStatus] = useState<PetsStatus | null>(null);
  const [spatial, setSpatial] = useState<{ requested: string | null; value: PetMotion } | null>(
    null,
  );
  const [error, setError] = useState('');
  // A successful background read does not mean a rejected preference save succeeded.
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef<PetsStatus | null>(null);
  const profile = useRef(profileId);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);
  const offset = useRef(0);
  /** Deltas shown before their saves settle. */
  const overlays = useRef<((config: PetsConfig) => PetsConfig)[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Shows `next` with every unsettled optimistic delta on top. */
  const show = useCallback((next: PetsStatus) => {
    if (!mounted.current) return;
    const shown = overlays.current;
    setStatus(
      shown.length ? { ...next, config: shown.reduce((c, delta) => delta(c), next.config) } : next,
    );
  }, []);

  const apply = useCallback(
    (next: PetsStatus) => {
      offset.current = next.now_ms - Date.now();
      latest.current = next;
      show(next);
    },
    [show],
  );

  useEffect(() => {
    profile.current = profileId;
  }, [profileId]);

  // Another profile restarts the reads at once; reads of the previous one are dropped.
  const read = useCallback(() => readPetsStatus(profileId), [profileId]);
  const { invalidate } = useNativePoll(read, {
    enabled: native && !paused,
    intervalMs,
    skip: () => pending.current > 0,
    onData: (next) => {
      apply(next);
      setError('');
    },
    onError: setError,
  });

  const readMotion = useCallback(() => readPetMotion(profileId), [profileId]);
  useNativePoll(readMotion, {
    enabled: native && motion && !paused,
    intervalMs: 150,
    onData: (value) => {
      // Stationary polls do not make the entire collection render at the spatial rate.
      setSpatial((old) =>
        old?.requested === profileId &&
        old.value.profile_id === value.profile_id &&
        old.value.active_profile_id === value.active_profile_id &&
        old.value.running === value.running &&
        JSON.stringify(old.value.facing) === JSON.stringify(value.facing) &&
        JSON.stringify(old.value.position) === JSON.stringify(value.position) &&
        JSON.stringify(old.value.last_position) === JSON.stringify(value.last_position)
          ? old
          : { requested: profileId, value },
      );
    },
    onError: () => setSpatial(null),
  });
  const spatialValue = spatial?.requested === profileId ? spatial.value : null;
  const shownStatus =
    status &&
    spatialValue &&
    motion &&
    !paused &&
    spatialValue.profile_id === status.profile_id &&
    spatialValue.now_ms >= status.now_ms
      ? {
          ...status,
          now_ms: spatialValue.now_ms,
          running: spatialValue.running,
          active_profile_id: spatialValue.active_profile_id,
          position: spatialValue.position,
          last_position: spatialValue.last_position,
          facing: spatialValue.facing ?? null,
        }
      : status;

  const configure = useCallback(
    (
      change: (config: PetsConfig) => PetsConfig,
      /** Show the change at once; only for idempotent deltas. */
      optimistic = false,
    ): Promise<boolean> => {
      if (!native) return Promise.resolve(false);
      pending.current += 1;
      invalidate();
      setBusy(true);
      if (optimistic) {
        overlays.current = [...overlays.current, change];
        if (latest.current) show(latest.current);
      }
      const next = queue.current.then(async () => {
        try {
          const base = latest.current ?? (await readPetsStatus(profile.current));
          let result: PetsStatus;
          try {
            result = await configurePets(change(base.config));
          } catch (cause) {
            if (!STALE.test(String(cause))) throw cause;
            const fresh = await readPetsStatus(profile.current);
            apply(fresh);
            result = await configurePets(change(fresh.config));
          }
          // The save answers for the live character; keep showing the chosen profile.
          if (profile.current === null || result.profile_id === profile.current) apply(result);
          else if (latest.current) apply({ ...latest.current, config: result.config });
          if (mounted.current) setSaveError('');
          return true;
        } catch (cause) {
          if (mounted.current) setSaveError(String(cause));
          return false;
        } finally {
          pending.current -= 1;
          invalidate();
          if (optimistic) {
            overlays.current = overlays.current.filter((delta) => delta !== change);
            if (latest.current) show(latest.current);
          }
          if (mounted.current && pending.current === 0) setBusy(false);
        }
      });
      queue.current = next;
      return next;
    },
    [native, apply, show, invalidate],
  );

  /** Pins or unpins one pet; the desired state is fixed at the time of the click. */
  const setPinned = useCallback(
    (id: number, pin: boolean) =>
      configure((config) => ({ ...config, pinned_ids: withPin(config.pinned_ids, id, pin) }), true),
    [configure],
  );

  const now = useCallback(() => Date.now() + offset.current, []);

  return {
    native,
    status: shownStatus,
    error: saveError || error,
    busy,
    configure,
    setPinned,
    now,
  };
}

export type PetsController = ReturnType<typeof usePets>;
