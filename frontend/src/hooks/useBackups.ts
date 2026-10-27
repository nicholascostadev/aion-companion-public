import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelBackupPreview,
  exportBackup,
  planBackup,
  previewBackup,
  readBackupStatus,
  restoreBackup,
} from '../services/backups';
import {
  BACKUP_PARTS,
  DEFAULT_BACKUP_OPTIONS,
  type BackupAction,
  type BackupExportOutcome,
  type BackupOptions,
  type BackupPart,
  type BackupPlan,
  type BackupPreview,
  type BackupRestoreOutcome,
  type BackupStatus,
  type BackupsState,
} from '../types/backups';

const EMPTY_PLAN: BackupPlan = { files: [], total_bytes: 0 };
const anyPart = (options: BackupOptions) => BACKUP_PARTS.some((part) => options[part]);

/**
 * The backup and restore steps. Held by the workspace so a result or preview survives a
 * tab change; reads status and the estimate only while `active` (Settings is shown).
 *
 * One step runs at a time: a request while one is running is ignored, so a double-click
 * never opens two dialogs. Choosing another file clears the shown preview before the
 * dialog opens, so a restore can only ever apply the preview on screen. An estimate for
 * options that have since changed is dropped, and nothing is applied after unmount. Once
 * native has staged a restore the app closes, and every step here stays locked.
 */
export function useBackups(native: boolean, { active = true } = {}): BackupsState {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [options, setOptions] = useState<BackupOptions>(DEFAULT_BACKUP_OPTIONS);
  const [planAsked, setPlanAsked] = useState(0);
  // The latest estimate, with the options (and request) it was read for.
  const [estimate, setEstimate] = useState<{
    key: string;
    plan: BackupPlan | null;
    error: string;
  } | null>(null);
  const [pending, setPending] = useState<BackupAction | null>(null);
  const [exported, setExported] = useState<BackupExportOutcome | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restore, setRestore] = useState<BackupRestoreOutcome | null>(null);

  const alive = useRef(false);
  const inflight = useRef<BackupAction | null>(null);
  const staged = useRef(false);
  const shown = useRef<BackupPreview | null>(null);
  const statusTicket = useRef(0);
  const planTicket = useRef(0);
  // The options a click sees, so Back up never acts on a stale render.
  const chosen = useRef(options);
  useEffect(() => {
    chosen.current = options;
  }, [options]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const showPreview = useCallback((next: BackupPreview | null) => {
    shown.current = next;
    setPreview(next);
  }, []);

  const reading = native && active;
  useEffect(() => {
    if (!reading) return;
    const ticket = ++statusTicket.current;
    readBackupStatus().then(
      (next) => {
        if (!alive.current || ticket !== statusTicket.current) return;
        setStatus(next);
        setStatusError('');
      },
      (cause: unknown) => {
        if (alive.current && ticket === statusTicket.current) setStatusError(String(cause));
      },
    );
  }, [reading]);

  // The estimate follows the options; a reply for older options is dropped.
  const some = anyPart(options);
  const planKey = `${planAsked}:${BACKUP_PARTS.map((part) => (options[part] ? 1 : 0)).join('')}`;
  useEffect(() => {
    if (!reading || !some) return;
    const ticket = ++planTicket.current;
    const settle = (plan: BackupPlan | null, error: string) => {
      if (alive.current && ticket === planTicket.current)
        setEstimate({ key: planKey, plan, error });
    };
    planBackup(options).then(
      (next) => settle(next, ''),
      (cause: unknown) => settle(null, String(cause)),
    );
  }, [reading, some, options, planKey]);
  const current = estimate?.key === planKey;
  const plan = !some ? EMPTY_PLAN : current ? estimate.plan : (estimate?.plan ?? null);
  const planning = reading && some && !current;
  const planError = some && current ? estimate.error : '';

  /** Claims the single step slot; false while a step runs or once a restore is staged. */
  const begin = useCallback(
    (action: BackupAction) => {
      if (!native || inflight.current || staged.current) return false;
      inflight.current = action;
      setPending(action);
      return true;
    },
    [native],
  );
  const end = useCallback(() => {
    inflight.current = null;
    if (alive.current) setPending(null);
  }, []);

  const setOption = useCallback((part: BackupPart, on: boolean) => {
    if (inflight.current === 'export') return;
    setOptions((current) => (current[part] === on ? current : { ...current, [part]: on }));
  }, []);

  const runExport = useCallback(async () => {
    const parts = chosen.current;
    if (!anyPart(parts) || !begin('export')) return;
    setExported(null);
    try {
      const result = await exportBackup(parts);
      if (!alive.current) return;
      setExported(result ? { kind: 'saved', result } : { kind: 'cancelled' });
      // Sizes may have moved on while the dialog was open.
      if (result) setPlanAsked((n) => n + 1);
    } catch (cause) {
      if (alive.current) setExported({ kind: 'failed', error: String(cause) });
    } finally {
      end();
    }
  }, [begin, end]);

  const choosePreview = useCallback(async () => {
    if (!begin('preview')) return;
    // Never leave an older file on screen while another is being chosen.
    showPreview(null);
    setRestore(null);
    try {
      const next = await previewBackup();
      if (!alive.current) return;
      showPreview(next);
      if (!next) setRestore({ kind: 'cancelled' });
    } catch (cause) {
      if (alive.current) setRestore({ kind: 'failed', step: 'preview', error: String(cause) });
    } finally {
      end();
    }
  }, [begin, end, showPreview]);

  const applyRestore = useCallback(
    async (token: string) => {
      // Only the preview on screen can be applied.
      if (!token || shown.current?.token !== token || !begin('restore')) return;
      setRestore(null);
      try {
        await restoreBackup(token);
        staged.current = true;
        if (!alive.current) return;
        setRestore({ kind: 'staged' });
        setStatus((current) => (current ? { ...current, pending_restore: true } : current));
      } catch (cause) {
        if (!alive.current) return;
        // Native may have dropped the held file: it has to be chosen and checked again.
        showPreview(null);
        setRestore({ kind: 'failed', step: 'restore', error: String(cause) });
      } finally {
        end();
      }
    },
    [begin, end, showPreview],
  );

  const discardPreview = useCallback(async () => {
    if (!shown.current || !begin('cancel')) return;
    showPreview(null);
    setRestore(null);
    try {
      await cancelBackupPreview();
    } catch {
      // The token is gone from screen; the next preview replaces native's copy anyway.
    } finally {
      end();
    }
  }, [begin, end, showPreview]);

  return {
    status,
    statusError,
    options,
    setOption,
    plan,
    planning,
    planError,
    pending,
    exported,
    preview,
    restore,
    exportBackup: runExport,
    choosePreview,
    applyRestore,
    discardPreview,
    dismissExport: useCallback(() => setExported(null), []),
    dismissRestore: useCallback(() => setRestore(null), []),
  };
}
