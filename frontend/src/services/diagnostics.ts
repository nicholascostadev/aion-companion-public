import { invoke, isTauri } from '@tauri-apps/api/core';
import { resolveView } from '../app/views';

/*
 * Local bug-report diagnostics. Frontend failures (uncaught errors, unhandled rejections,
 * failed native commands) are kept in a small in-memory log and forwarded once each to the
 * native diagnostics log. `diagnostics_export` answers with the native support file, which
 * this window downloads; nothing is uploaded and nothing here touches the network.
 */

export type DiagnosticLevel = 'error' | 'warn';

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  /** Where it came from: `window`, `promise`, `react`, `native:<command>`, … */
  source: string;
  message: string;
  /** First and latest occurrence, epoch ms. */
  first_ms: number;
  last_ms: number;
  /** Identical entries (same level, source and message) collapse into one with a count. */
  count: number;
  /** Whether native accepted it into its own log. */
  forwarded: boolean;
}

/** What this window adds to `diagnostics_export` as `frontend`. */
export interface FrontendDiagnostics {
  generated_ms: number;
  environment: {
    view: string;
    user_agent: string;
    viewport: { width: number; height: number; scale: number };
  };
  entries: DiagnosticEntry[];
  /** Older entries dropped to keep the log bounded. */
  dropped: number;
  /** Entries not forwarded to native: the forward budget was spent, or forwarding failed. */
  unforwarded: number;
}

/** Bounds: at most this many distinct entries, each message this long. */
export const MAX_ENTRIES = 80;
export const MAX_MESSAGE = 1600;
/**
 * The exported log's size as UTF-8 JSON, comfortably below the native payload limit:
 * escaped text can grow past what the entry bounds alone allow, so the oldest go first.
 */
export const MAX_EXPORT_BYTES = 192 * 1024;
/** Native is told about this many distinct entries per session at most. */
export const MAX_FORWARDS = 50;
/** After this many failed forwards in a row, forwarding stops for the session. */
const MAX_FORWARD_FAILURES = 3;
/** Stack lines kept after the message of an `Error`. */
const STACK_LINES = 8;

/** This command records diagnostics itself; its own failures are never recorded. */
const RECORD_COMMAND = 'diagnostics_record';

let entries: DiagnosticEntry[] = [];
let dropped = 0;
let forwards = 0;
let forwardFailures = 0;

const REDACTED = '<redacted>';
/** Keys whose value is a credential, in JSON (`"token": "…"`), headers or `key=value` text. */
const SECRET_KEY =
  '(?:password|passwd|pwd|pass|secret|client_secret|token|access_token|refresh_token|id_token|auth_token|api_?key|authorization|cookie|set-cookie|session(?:_?id)?|private_key|credentials?)';
/** The app's own pages: their script paths in stacks help and carry nothing personal. */
const APP_HOST = /^(?:tauri\.localhost|localhost|127\.0\.0\.1)(?::\d+)?$/i;

/**
 * Best-effort removal of personal and credential-bearing text: the user name in a Windows
 * profile path, bearer and basic credentials, values of credential keys and URL credentials,
 * queries, hashes and (except on the app's own pages) paths. Logs can still hold unexpected
 * text, which is why the file is reviewed before it is shared.
 */
export function redact(text: string): string {
  return (
    text
      .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"'`]+/gi, '$1<user>')
      .replace(/\b(Bearer)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`)
      // Case-sensitive and long, so "Unexpected token u" or "Basic attack" stay readable.
      .replace(/\b(Basic|Token)\s+[\w.~+/=-]{8,}/g, `$1 ${REDACTED}`)
      // "token": "…", 'password': '…'
      .replace(
        new RegExp(
          `(["']${SECRET_KEY}["']\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,}]+)`,
          'gi',
        ),
        `$1"${REDACTED}"`,
      )
      // password=…, token: …, Authorization: … (a header keeps its scheme word redacted above)
      .replace(
        new RegExp(
          `(\\b${SECRET_KEY}\\b\\s*[=:]\\s*)(?!<redacted>|"<redacted>"|Bearer |Basic |Token )[^\\s,;&"'}]+`,
          'gi',
        ),
        `$1${REDACTED}`,
      )
      .replace(
        /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#()"'`]+)([^\s()"'`]*)/gi,
        (_, scheme, authority, rest) => {
          const at = authority.lastIndexOf('@');
          const host = at === -1 ? authority : authority.slice(at + 1);
          const login = at === -1 ? '' : `${REDACTED}@`;
          const path = String(rest).replace(/[?#].*$/, '');
          // asset: and file: paths spell out local folders; only the app's own pages keep theirs.
          const own = /^https?:\/\/$/i.test(scheme) && APP_HOST.test(host);
          const kept = own ? path : path && path !== '/' ? `/${REDACTED}` : '';
          return `${scheme}${login}${host}${kept}`;
        },
      )
  );
}

/** Readable text of anything thrown or rejected, bounded and redacted. */
export function describeCause(cause: unknown): string {
  let text: string;
  if (cause instanceof Error) {
    const head = `${cause.name}: ${cause.message}`;
    const stack = (cause.stack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !head.includes(line))
      .slice(0, STACK_LINES);
    text = [head, ...stack].join('\n');
  } else if (typeof cause === 'string') {
    text = cause;
  } else {
    try {
      text = JSON.stringify(cause) ?? String(cause);
    } catch {
      text = String(cause);
    }
  }
  text = redact(text.trim() || 'Unknown error');
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

function forward(entry: DiagnosticEntry) {
  if (!isTauri() || forwards >= MAX_FORWARDS || forwardFailures >= MAX_FORWARD_FAILURES) return;
  forwards += 1;
  const { level, source, message } = entry;
  invoke<void>(RECORD_COMMAND, { level, source, message }).then(
    () => {
      entry.forwarded = true;
      forwardFailures = 0;
    },
    () => {
      // Kept locally and exported with the frontend log; never recorded again.
      forwardFailures += 1;
    },
  );
}

/**
 * Records one frontend problem. Repeats of the same problem (a failing poll) only bump the
 * count of the entry already kept, and only a new problem is forwarded to native.
 */
export function recordDiagnostic(level: DiagnosticLevel, source: string, cause: unknown) {
  try {
    const message = describeCause(cause);
    const at = Date.now();
    const known = entries.find(
      (entry) => entry.level === level && entry.source === source && entry.message === message,
    );
    if (known) {
      known.count += 1;
      known.last_ms = at;
      return;
    }
    const entry: DiagnosticEntry = {
      level,
      source: source.slice(0, 120),
      message,
      first_ms: at,
      last_ms: at,
      count: 1,
      forwarded: false,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      dropped += entries.length - MAX_ENTRIES;
      entries = entries.slice(-MAX_ENTRIES);
    }
    forward(entry);
  } catch {
    // Diagnostics must never become the problem.
  }
}

/** This window's log and minimal environment, for `diagnostics_export`. */
export function frontendDiagnostics(): FrontendDiagnostics {
  const log: FrontendDiagnostics = {
    generated_ms: Date.now(),
    environment: {
      // Only the view name: the page address, its query and hash are left out.
      view: resolveView(window.location.search),
      user_agent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: window.devicePixelRatio,
      },
    },
    entries: entries.map((entry) => ({ ...entry })),
    dropped,
    unforwarded: 0,
  };
  const size = () => new TextEncoder().encode(JSON.stringify(log)).length;
  while (log.entries.length > 0 && size() > MAX_EXPORT_BYTES) {
    log.entries.shift();
    log.dropped += 1;
  }
  log.unforwarded = log.entries.filter((entry) => !entry.forwarded).length;
  return log;
}

/** The native support file, as formatted JSON, with this window's log inside. */
export const exportDiagnostics = (): Promise<string> =>
  invoke<string>('diagnostics_export', { frontend: frontendDiagnostics() });

/**
 * A stand-in file when native cannot write its own (the native side is failing): only this
 * window's log, in the same native support format, marked partial.
 */
export function fallbackDiagnostics(reason: unknown): string {
  return JSON.stringify(
    {
      kind: 'aion-companion-diagnostics',
      schema_version: 1,
      exported_at_ms: Date.now(),
      partial: true,
      partial_reason: describeCause(reason),
      frontend: frontendDiagnostics(),
    },
    null,
    2,
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `aion-companion-20261019-142530.aion-diagnostics.json`, in local time. */
export function diagnosticsFileName(at = new Date(), partial = false): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `aion-companion-${day}-${time}${partial ? '-partial' : ''}.aion-diagnostics.json`;
}

interface TauriInternals {
  invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
}

let installed: (() => void) | null = null;

/** Recorded once per window when failed native commands cannot be recorded. */
export const INTERCEPT_UNAVAILABLE =
  'Failed native commands are not recorded: the runtime does not allow its IPC entry to be wrapped.';

/**
 * Wraps the runtime's IPC entry so a failed command is recorded, when the runtime lets it be
 * replaced. Tauri defines it read-only, so this can fail; it never throws. Answers the
 * uninstall, or `null` when the entry was left as it is.
 */
function interceptNativeFailures(internals: TauriInternals): (() => void) | null {
  const original = internals.invoke;
  const wrapped: TauriInternals['invoke'] = (cmd, ...rest) =>
    original.call(internals, cmd, ...rest).catch((cause: unknown) => {
      if (cmd !== RECORD_COMMAND) recordDiagnostic('error', `native:${cmd}`, cause);
      throw cause;
    });
  try {
    internals.invoke = wrapped;
  } catch {
    // A read-only, frozen or sealed runtime: assigning throws in module (strict) code.
    return null;
  }
  // Some runtimes ignore the assignment instead of throwing.
  if (internals.invoke !== wrapped) return null;
  return () => {
    try {
      if (internals.invoke === wrapped) internals.invoke = original;
    } catch {
      // Diagnostics must never become the problem.
    }
  };
}

/**
 * Starts recording uncaught errors, unhandled rejections and failed native commands.
 * Every `invoke` from `@tauri-apps/api` passes through the runtime's one IPC entry, so a
 * failure is recorded there with its command name (never its arguments); successful
 * commands, polls included, are not logged. When the runtime keeps that entry read-only, a
 * warning says so and errors and rejections are still recorded. Never throws, so startup
 * never depends on it. Idempotent; returns an uninstall for tests.
 */
export function installDiagnostics(): () => void {
  if (installed) return installed;
  const onError = (event: ErrorEvent) =>
    recordDiagnostic('error', 'window', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    recordDiagnostic('error', 'promise', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  let restore: (() => void) | null = null;
  try {
    const internals = (window as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function') {
      restore = interceptNativeFailures(internals);
      if (!restore) recordDiagnostic('warn', 'diagnostics', INTERCEPT_UNAVAILABLE);
    }
  } catch (cause) {
    recordDiagnostic('warn', 'diagnostics', cause);
  }

  installed = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    restore?.();
    installed = null;
  };
  return installed;
}

/** Test hook: an empty log and a fresh forward budget. */
export function resetDiagnostics() {
  entries = [];
  dropped = 0;
  forwards = 0;
  forwardFailures = 0;
}
