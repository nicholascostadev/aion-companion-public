import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/*
 * The saved interface preferences, read from native settings (their only durable home).
 * `ui-preferences-changed` only says "read again": it carries no locale, so a late event
 * can never undo a newer choice.
 */

export interface UiPreferences {
  /** The stored settings value, verbatim (it may name a language the interface lacks). */
  locale: string;
}

export const UI_PREFERENCES_CHANGED = 'ui-preferences-changed';

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const locale = (value as { locale?: unknown } | null)?.locale;
  if (typeof locale !== 'string') throw new Error('Native returned no interface preferences');
  return { locale };
}

/** Settings only: no combat report is aggregated for this read. */
export const readUiPreferences = (): Promise<UiPreferences> =>
  invoke<unknown>('ui_preferences').then(normalizeUiPreferences);

export const onUiPreferencesChanged = (handler: () => void): Promise<() => void> =>
  listen<unknown>(UI_PREFERENCES_CHANGED, () => handler());

interface SyncOptions {
  read: () => Promise<UiPreferences>;
  subscribe: (handler: () => void) => Promise<() => void>;
  /**
   * Shows the stored preference; called one at a time, only with the newest known value, and
   * not again for the value already shown. A rejected apply is retried by the next answer.
   */
  apply: (stored: string) => void | Promise<void>;
  report: (source: string, cause: unknown) => void;
  /** First retry delay for a listener that failed to register; doubles up to a minute. */
  retryMs?: number;
}

export interface PreferenceSync {
  /** Registers the listener, then reads; resolves once applied or after `waitMs`. */
  start(waitMs: number): Promise<void>;
  /** Reads again (coalesced): after an event, on becoming visible, or to recover. */
  refresh(): Promise<void>;
  /** A settings save this window just made succeeded: its stored locale wins at once. */
  commit(stored: string): void;
  dispose(): void;
}

/**
 * Keeps one window's language in step with the saved settings.
 *
 * Reads are coalesced: one runs at a time, and an invalidation that arrives while it runs
 * discards its answer and reads again. Every answer carries the ticket taken when it was
 * asked for; an answer older than one already applied (a read that started before this
 * window's save committed) is dropped. A save's own reply is shown at once and confirmed by
 * a fresh read, so a delayed reply cannot outlast a newer save made in another window.
 */
export function createPreferenceSync({
  read,
  subscribe,
  apply,
  report,
  retryMs = 2000,
}: SyncOptions): PreferenceSync {
  let disposed = false;
  let ticket = 0;
  let applied = 0;
  let reading: Promise<void> | null = null;
  let invalidated = false;
  let unsubscribe: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = retryMs;
  // The newest known stored value, and the last one `apply` finished without failing.
  let wanted: string | null = null;
  let current: string | null = null;
  let draining = false;
  let applying = Promise.resolve();

  /**
   * Applies `wanted` until the window shows it. One apply runs at a time; a value superseded
   * while another was applying is skipped, and nothing starts after disposal. A failed apply
   * leaves the language unknown, so the next answer (even the same value) tries again.
   */
  const drain = async () => {
    draining = true;
    try {
      while (!disposed && wanted !== null && wanted !== current) {
        const next = wanted;
        try {
          await apply(next);
          current = next;
        } catch (cause) {
          current = null;
          report('i18n:apply', cause);
          if (wanted === next) return;
        }
      }
    } finally {
      // Cleared in the same turn the loop ends, so no answer can slip in unapplied.
      draining = false;
    }
  };

  const show = (stored: string, at: number) => {
    if (disposed || at < applied) return;
    applied = at;
    wanted = stored;
    // A confirming answer for the value being applied joins that apply; it never cancels it.
    if (!draining) applying = drain();
  };

  const readLatest = async () => {
    do {
      invalidated = false;
      const at = ++ticket;
      let prefs: UiPreferences;
      try {
        prefs = await read();
      } catch (cause) {
        report('i18n:read', cause);
        return;
      }
      if (!invalidated) show(prefs.locale, at);
    } while (invalidated && !disposed);
  };

  const refresh = () => {
    if (disposed) return Promise.resolve();
    if (reading) {
      invalidated = true;
      return reading;
    }
    reading = readLatest().finally(() => {
      reading = null;
    });
    return reading;
  };

  const register = () => {
    retry = null;
    subscribe(() => void refresh()).then(
      (stop) => {
        if (disposed) stop();
        else {
          unsubscribe = stop;
          retryDelay = retryMs;
          // Anything committed while unsubscribed is picked up now.
          void refresh();
        }
      },
      (cause: unknown) => {
        report('i18n:listen', cause);
        if (disposed) return;
        retry = setTimeout(register, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      },
    );
  };

  const onVisible = () => {
    if (document.visibilityState !== 'hidden') void refresh();
  };

  return {
    async start(waitMs) {
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
      // Listener first: a change committed between the read and registration is not missed.
      const listening = subscribe(() => void refresh()).then(
        (stop) => {
          if (disposed) stop();
          else unsubscribe = stop;
        },
        (cause: unknown) => {
          report('i18n:listen', cause);
          if (!disposed) retry = setTimeout(register, retryDelay);
        },
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      });
      const ready = listening.then(refresh).then(() => applying);
      await Promise.race([ready, timeout]);
      clearTimeout(timer);
    },
    refresh,
    commit(stored) {
      show(stored, ++ticket);
      // Shown at once, then confirmed: another window may have saved after this one, and
      // its event can arrive before this reply. A read already in flight may predate the
      // save, so it is discarded and repeated.
      void refresh();
    },
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (retry) clearTimeout(retry);
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

let active: PreferenceSync | null = null;

/** The window's sync, installed by `main.tsx`; saves report to it through `commitUiPreference`. */
export function setActivePreferenceSync(sync: PreferenceSync | null) {
  active = sync;
}

/** After a successful settings save in this window: show its language without waiting. */
export function commitUiPreference(stored: string) {
  active?.commit(stored);
}
