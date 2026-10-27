import { invoke, isTauri } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTERCEPT_UNAVAILABLE,
  MAX_ENTRIES,
  MAX_EXPORT_BYTES,
  MAX_FORWARDS,
  MAX_MESSAGE,
  describeCause,
  diagnosticsFileName,
  exportDiagnostics,
  fallbackDiagnostics,
  frontendDiagnostics,
  installDiagnostics,
  recordDiagnostic,
  redact,
  resetDiagnostics,
} from './diagnostics';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<typeof invoke>(),
  isTauri: vi.fn<typeof isTauri>(),
}));

const recordCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'diagnostics_record');
/** Lets forwarded promises settle. */
const settle = () => new Promise((done) => setTimeout(done));

beforeEach(() => {
  resetDiagnostics();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());

describe('redaction', () => {
  it('removes credentials from headers, JSON and key=value text', () => {
    const text = redact(
      'Authorization: Bearer abc.def-123 {"password":"hunter2","access_token": "t0k"} api_key=xyz&x=1',
    );
    expect(text).not.toMatch(/abc\.def|hunter2|t0k|xyz/);
    expect(text).toContain('Bearer <redacted>');
    expect(text).toContain('"password":"<redacted>"');
  });

  it('removes URL credentials, paths, queries and hashes from other hosts', () => {
    const text = redact('fetch https://user:pw@api.example.com/v1/users/42?key=1#top failed');
    expect(text).toBe('fetch https://<redacted>@api.example.com/<redacted> failed');
    expect(redact('asset://localhost/C%3A%5CUsers%5Cme%5Cart.png')).toBe(
      'asset://localhost/<redacted>',
    );
  });

  it('keeps the app’s own script paths without their query', () => {
    expect(redact('at run (http://tauri.localhost/assets/index-ab12.js?v=3:1:200)')).toBe(
      'at run (http://tauri.localhost/assets/index-ab12.js)',
    );
  });

  it('hides the Windows user name and keeps ordinary error words', () => {
    expect(redact('cannot open C:\\Users\\Ayla\\AppData\\x.json')).toBe(
      'cannot open C:\\Users\\<user>\\AppData\\x.json',
    );
    expect(redact('Unexpected token u in JSON')).toBe('Unexpected token u in JSON');
    expect(redact('Basic attack missed')).toBe('Basic attack missed');
  });

  it('bounds long messages and describes non-errors', () => {
    expect(describeCause('x'.repeat(MAX_MESSAGE * 2))).toHaveLength(MAX_MESSAGE);
    expect(describeCause({ code: 7 })).toBe('{"code":7}');
    expect(describeCause('')).toBe('Unknown error');
    expect(describeCause(new TypeError('boom'))).toMatch(/^TypeError: boom/);
  });
});

describe('frontend log', () => {
  it('collapses repeats into one entry and forwards it once', async () => {
    for (let i = 0; i < 5; i++) recordDiagnostic('error', 'native:offline_status', 'offline');
    await settle();
    const { entries } = frontendDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ count: 5, forwarded: true, level: 'error' });
    expect(recordCalls()).toEqual([
      [
        'diagnostics_record',
        { level: 'error', source: 'native:offline_status', message: 'offline' },
      ],
    ]);
  });

  it('keeps only the newest entries and counts the dropped ones', () => {
    for (let i = 0; i < MAX_ENTRIES + 7; i++) recordDiagnostic('warn', 'test', `problem ${i}`);
    const log = frontendDiagnostics();
    expect(log.entries).toHaveLength(MAX_ENTRIES);
    expect(log.dropped).toBe(7);
    expect(log.entries[0]?.message).toBe('problem 7');
  });

  it('drops the oldest entries to keep the export within the size native accepts', () => {
    // Quotes double when escaped, and this character takes three UTF-8 bytes.
    for (let i = 0; i < MAX_ENTRIES; i++)
      recordDiagnostic('warn', 'x', `${i} ${'"界'.repeat(MAX_MESSAGE / 2)}`);
    const log = frontendDiagnostics();
    const bytes = new TextEncoder().encode(JSON.stringify(log)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
    expect(MAX_EXPORT_BYTES).toBeLessThan(256 * 1024);
    expect(log.entries.length).toBeGreaterThan(0);
    expect(log.dropped).toBe(MAX_ENTRIES - log.entries.length);
    expect(log.entries.at(-1)?.message).toMatch(/^79 /);
  });

  it('forwards a bounded number of entries per session', async () => {
    for (let i = 0; i < MAX_FORWARDS + 10; i++) recordDiagnostic('error', 'test', `e${i}`);
    await settle();
    expect(recordCalls()).toHaveLength(MAX_FORWARDS);
    expect(frontendDiagnostics().unforwarded).toBe(10);
  });

  it('keeps entries locally and stops forwarding when native keeps failing', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('no native'));
    for (let i = 0; i < 6; i++) {
      recordDiagnostic('error', 'test', `e${i}`);
      await settle();
    }
    expect(recordCalls()).toHaveLength(3);
    const log = frontendDiagnostics();
    expect(log.entries).toHaveLength(6);
    expect(log.unforwarded).toBe(6);
  });

  it('does not forward outside the desktop app', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    recordDiagnostic('error', 'test', 'boom');
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    expect(frontendDiagnostics().entries).toHaveLength(1);
  });

  it('describes the window without its address, query or stored data', () => {
    window.history.replaceState(null, '', '/?view=group&secret=1#hash');
    localStorage.setItem('aion.private', 'stored');
    const text = JSON.stringify(frontendDiagnostics());
    expect(frontendDiagnostics().environment.view).toBe('group');
    expect(text).not.toMatch(/secret|hash|stored|aion\.private/);
    window.history.replaceState(null, '', '/');
    localStorage.clear();
  });
});

describe('export', () => {
  it('asks native for the support file with this window’s log', async () => {
    recordDiagnostic('error', 'window', 'boom');
    vi.mocked(invoke).mockResolvedValue('{"kind":"aion-companion-diagnostics"}');
    await expect(exportDiagnostics()).resolves.toBe('{"kind":"aion-companion-diagnostics"}');
    const [, args] = vi.mocked(invoke).mock.lastCall ?? [];
    expect(vi.mocked(invoke).mock.lastCall?.[0]).toBe('diagnostics_export');
    expect((args as { frontend: { entries: unknown[] } }).frontend.entries).toHaveLength(1);
  });

  it('writes a partial file in the native format when native cannot', () => {
    recordDiagnostic('error', 'window', 'boom');
    const file = JSON.parse(fallbackDiagnostics('token=abc123 failed'));
    expect(file).toMatchObject({ kind: 'aion-companion-diagnostics', schema_version: 1 });
    expect(file.partial).toBe(true);
    expect(file.partial_reason).toBe('token=<redacted> failed');
    expect(file.frontend.entries[0].message).toBe('boom');
  });

  it('names files by local time', () => {
    const at = new Date(2026, 9, 19, 14, 5, 9);
    expect(diagnosticsFileName(at)).toBe('aion-companion-20261019-140509.aion-diagnostics.json');
    expect(diagnosticsFileName(at, true)).toBe(
      'aion-companion-20261019-140509-partial.aion-diagnostics.json',
    );
  });
});

describe('global hooks', () => {
  type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;
  /** The runtime's own IPC entry, before diagnostics wrap it. */
  let raw = vi.fn<Invoke>();
  const internals: { invoke: Invoke } = { invoke: raw };
  let uninstall = () => {};
  beforeEach(() => {
    raw = vi.fn<Invoke>();
    internals.invoke = raw;
    Object.assign(window, { __TAURI_INTERNALS__: internals });
    uninstall = installDiagnostics();
  });
  afterEach(() => {
    uninstall();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('records failed native commands by name only, not successes or their arguments', async () => {
    raw.mockResolvedValueOnce('fine').mockRejectedValueOnce('Library locked');
    await expect(internals.invoke('offline_status')).resolves.toBe('fine');
    await expect(internals.invoke('offline_log', { id: 'secret-id' })).rejects.toBe(
      'Library locked',
    );
    const { entries } = frontendDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: 'native:offline_log', message: 'Library locked' });
    expect(JSON.stringify(entries)).not.toContain('secret-id');
  });

  it('never records a failure of the diagnostics command itself', async () => {
    raw.mockRejectedValue('journal unavailable');
    await expect(internals.invoke('diagnostics_record', {})).rejects.toBe('journal unavailable');
    expect(frontendDiagnostics().entries).toHaveLength(0);
  });

  it('records uncaught errors and unhandled rejections', () => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('render failed') }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.assign(rejection, { reason: 'lost promise' });
    window.dispatchEvent(rejection);
    const sources = frontendDiagnostics().entries.map((entry) => entry.source);
    expect(sources).toEqual(['window', 'promise']);
  });

  it('is idempotent and restores everything on uninstall', () => {
    expect(internals.invoke).not.toBe(raw);
    expect(installDiagnostics()).toBe(uninstall);
    uninstall();
    expect(internals.invoke).toBe(raw);
    window.dispatchEvent(new ErrorEvent('error', { message: 'after' }));
    expect(frontendDiagnostics().entries).toHaveLength(0);
  });
});

describe('a runtime that keeps its IPC entry read-only', () => {
  type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;
  let raw = vi.fn<Invoke>();
  let uninstall = () => {};
  const runtime = () =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;
  /** How Tauri 2 defines it: `defineProperty` with writable and configurable left false. */
  const tauriRuntime = () => Object.defineProperty({}, 'invoke', { value: raw, enumerable: true });
  /** Every way a runtime can refuse the wrapper. */
  const RUNTIMES: [string, () => object][] = [
    ['defined without writable or configurable', tauriRuntime],
    ['frozen', () => Object.freeze({ invoke: raw })],
    [
      'a getter without a setter',
      () => ({
        get invoke() {
          return raw;
        },
      }),
    ],
    [
      'a setter that ignores the value',
      () => ({
        get invoke() {
          return raw;
        },
        set invoke(_: Invoke) {},
      }),
    ],
  ];
  beforeEach(() => {
    raw = vi.fn<Invoke>();
  });
  afterEach(() => {
    uninstall();
    uninstall = () => {};
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it.each(RUNTIMES)(
    'starts when the entry is %s, and says failures go unrecorded',
    async (_, make) => {
      Object.assign(window, { __TAURI_INTERNALS__: make() });
      expect(() => {
        uninstall = installDiagnostics();
      }).not.toThrow();
      expect(runtime().invoke).toBe(raw);
      await settle();
      const { entries } = frontendDiagnostics();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        level: 'warn',
        source: 'diagnostics',
        message: INTERCEPT_UNAVAILABLE,
        forwarded: true,
      });
    },
  );

  it('keeps recording errors and rejections, and native calls behave as before', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: tauriRuntime() });
    uninstall = installDiagnostics();
    raw.mockResolvedValueOnce('fine').mockRejectedValueOnce('Library locked');
    await expect(runtime().invoke('offline_status')).resolves.toBe('fine');
    await expect(runtime().invoke('offline_log')).rejects.toBe('Library locked');
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('render failed') }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.assign(rejection, { reason: 'lost promise' });
    window.dispatchEvent(rejection);
    const sources = frontendDiagnostics().entries.map((entry) => entry.source);
    expect(sources).toEqual(['diagnostics', 'window', 'promise']);
  });

  it('warns once, and uninstalls cleanly without touching the entry', () => {
    Object.assign(window, { __TAURI_INTERNALS__: tauriRuntime() });
    uninstall = installDiagnostics();
    expect(installDiagnostics()).toBe(uninstall);
    expect(frontendDiagnostics().entries).toMatchObject([{ count: 1 }]);
    expect(() => uninstall()).not.toThrow();
    expect(runtime().invoke).toBe(raw);
    window.dispatchEvent(new ErrorEvent('error', { message: 'after' }));
    expect(frontendDiagnostics().entries).toHaveLength(1);
  });

  it('does not warn outside the desktop app or when the entry can be wrapped', () => {
    uninstall = installDiagnostics();
    uninstall();
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: raw } });
    uninstall = installDiagnostics();
    expect(runtime().invoke).not.toBe(raw);
    expect(frontendDiagnostics().entries).toHaveLength(0);
  });
});
