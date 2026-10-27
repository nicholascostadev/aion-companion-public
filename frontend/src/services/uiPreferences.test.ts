import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commitUiPreference,
  createPreferenceSync,
  normalizeUiPreferences,
  setActivePreferenceSync,
  type UiPreferences,
} from './uiPreferences';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Apply = (stored: string) => void | Promise<void>;
type Report = (source: string, cause: unknown) => void;
const applied = () => vi.fn<Apply>();
const reported = () => vi.fn<Report>();
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Native settings shared by every window, with the invalidation event. */
function fakeNative(locale = 'en') {
  const store = { locale };
  const listeners = new Set<() => void>();
  return {
    store,
    read: vi.fn<() => Promise<UiPreferences>>(async () => ({ locale: store.locale })),
    subscribe: vi.fn<(handler: () => void) => Promise<() => void>>(async (handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    }),
    /** `offline_configure` committing a locale, then the app-wide invalidation. */
    save(next: string) {
      store.locale = next;
      for (const listener of listeners) listener();
      return next;
    },
    listeners,
  };
}

afterEach(() => {
  vi.useRealTimers();
  setActivePreferenceSync(null);
});

describe('ui preferences', () => {
  it('normalizes the native reply and rejects one without a locale', () => {
    expect(normalizeUiPreferences({ locale: 'pt' })).toEqual({ locale: 'pt' });
    expect(() => normalizeUiPreferences({})).toThrow('no interface preferences');
    expect(() => normalizeUiPreferences(null)).toThrow('no interface preferences');
  });
});

describe('preference sync', () => {
  it('registers the listener before the first read and applies the saved language', async () => {
    const native = fakeNative('pt-BR');
    const order: string[] = [];
    native.subscribe.mockImplementation(async (handler) => {
      order.push('listen');
      native.listeners.add(handler);
      return () => {
        native.listeners.delete(handler);
      };
    });
    native.read.mockImplementation(async () => {
      order.push('read');
      return { locale: native.store.locale };
    });
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    await sync.start(1000);
    expect(order).toEqual(['listen', 'read']);
    expect(apply).toHaveBeenCalledExactlyOnceWith('pt-BR');
    sync.dispose();
  });

  it('starts in English after a bounded wait and applies a late answer', async () => {
    vi.useFakeTimers();
    const native = fakeNative('pt-BR');
    const late = deferred<UiPreferences>();
    native.read.mockReturnValueOnce(late.promise);
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    const started = sync.start(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await started;
    expect(apply).not.toHaveBeenCalled();
    late.resolve({ locale: 'pt-BR' });
    await flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith('pt-BR');
    sync.dispose();
  });

  it('records a failed read and recovers when the window becomes visible', async () => {
    const native = fakeNative('pt-BR');
    native.read.mockRejectedValueOnce(new Error('settings locked'));
    const apply = applied();
    const report = reported();
    const sync = createPreferenceSync({ ...native, apply, report });
    await sync.start(1000);
    expect(report).toHaveBeenCalledWith('i18n:read', expect.any(Error));
    expect(apply).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith('pt-BR');
    sync.dispose();
  });

  it('discards a read that an invalidation overtook and coalesces repeated events', async () => {
    const native = fakeNative('en');
    const first = deferred<UiPreferences>();
    native.read.mockReturnValueOnce(first.promise);
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    const started = sync.start(1000);
    await flush();
    // Two saves elsewhere while the first read is still out.
    native.save('pt-BR');
    native.save('pt-BR');
    first.resolve({ locale: 'en' });
    await started;
    await flush();
    expect(native.read).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls).toEqual([['pt-BR']]);
    sync.dispose();
  });

  it('applies a save at once and drops a read that started before it', async () => {
    const native = fakeNative('en');
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    await sync.start(1000);
    const before = deferred<UiPreferences>();
    native.read.mockReturnValueOnce(before.promise);
    const reading = sync.refresh();
    native.store.locale = 'pt-BR';
    sync.commit('pt-BR');
    before.resolve({ locale: 'en' });
    await reading;
    await flush();
    expect(apply.mock.calls.map(([locale]) => locale)).toEqual(['en', 'pt-BR']);
    sync.dispose();
  });

  it('lets a newer save from another window win over this window’s delayed reply', async () => {
    const native = fakeNative('en');
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    await sync.start(1000);
    // This window saved pt-BR (A); another window then saved en (B) and its event arrived first.
    native.save('pt-BR');
    native.save('en');
    await flush();
    // A's reply arrives late: shown at once, then confirmed by a fresh read of native.
    sync.commit('pt-BR');
    await flush();
    expect(apply.mock.calls.at(-1)).toEqual(['en']);
    sync.dispose();
  });

  it('keeps two windows in one language through the invalidation event', async () => {
    const native = fakeNative('en');
    const workspace = applied();
    const overlay = applied();
    const a = createPreferenceSync({ ...native, apply: workspace, report: reported() });
    const b = createPreferenceSync({ ...native, apply: overlay, report: reported() });
    await Promise.all([a.start(1000), b.start(1000)]);
    a.commit(native.save('pt-BR'));
    await flush();
    expect(workspace.mock.calls.at(-1)).toEqual(['pt-BR']);
    expect(overlay.mock.calls.at(-1)).toEqual(['pt-BR']);
    b.commit(native.save('en'));
    await flush();
    expect(workspace.mock.calls.at(-1)).toEqual(['en']);
    expect(overlay.mock.calls.at(-1)).toEqual(['en']);
    a.dispose();
    b.dispose();
  });

  it('applies languages in order and never after disposal', async () => {
    const native = fakeNative('en');
    const slow = deferred<void>();
    const applied: string[] = [];
    const apply = vi.fn<Apply>(async (locale) => {
      if (locale === 'pt-BR') await slow.promise;
      applied.push(locale);
    });
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    await sync.start(10);
    sync.commit('pt-BR');
    await flush();
    // pt-BR is still switching: ja is superseded before it starts, en arrives after disposal.
    sync.commit('ja');
    sync.commit('ko');
    sync.dispose();
    slow.resolve();
    await flush();
    expect(applied).toEqual(['en', 'pt-BR']);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('still applies a save whose confirming read answers before the queued switch starts', async () => {
    const native = fakeNative('en');
    const english = deferred<void>();
    const done: string[] = [];
    const apply = vi.fn<Apply>(async (locale) => {
      if (locale === 'en') await english.promise;
      done.push(locale);
    });
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    void sync.start(10);
    await flush();
    // English is still switching when this window's save of pt-BR succeeds (its event not
    // yet delivered); the confirming read answers before the pt-BR switch could start.
    native.store.locale = 'pt-BR';
    sync.commit('pt-BR');
    await flush();
    expect(native.read).toHaveBeenCalledTimes(2);
    expect(done).toEqual([]);
    english.resolve();
    await flush();
    expect(done).toEqual(['en', 'pt-BR']);
    // Further confirmations of the shown language change nothing.
    await sync.refresh();
    await flush();
    expect(apply).toHaveBeenCalledTimes(2);
    sync.dispose();
  });

  it('retries a failed switch when the same language is read again', async () => {
    const native = fakeNative('en');
    const failing = deferred<void>();
    const apply = applied();
    const report = reported();
    const sync = createPreferenceSync({ ...native, apply, report });
    await sync.start(10);
    apply.mockReturnValueOnce(failing.promise);
    sync.commit(native.save('pt-BR'));
    await flush();
    failing.reject(new Error('catalog missing'));
    await flush();
    expect(report).toHaveBeenCalledWith('i18n:apply', expect.any(Error));
    expect(apply.mock.calls).toEqual([['en'], ['pt-BR']]);
    // The confirming read already joined the failed attempt; the next answer tries again.
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(apply.mock.calls).toEqual([['en'], ['pt-BR'], ['pt-BR']]);
    // Once shown, the same answer is not applied a third time.
    await sync.refresh();
    await flush();
    expect(apply).toHaveBeenCalledTimes(3);
    sync.dispose();
  });

  it('moves on to a newer language when the one being applied fails', async () => {
    const native = fakeNative('en');
    const failing = deferred<void>();
    const apply = vi.fn<Apply>(async (locale) => {
      if (locale === 'pt-BR') await failing.promise;
    });
    const report = reported();
    const sync = createPreferenceSync({ ...native, apply, report });
    await sync.start(10);
    sync.commit(native.save('pt-BR'));
    await flush();
    // Another window saved English while pt-BR was switching; then pt-BR failed.
    native.save('en');
    await flush();
    failing.reject(new Error('catalog missing'));
    await flush();
    expect(report).toHaveBeenCalledWith('i18n:apply', expect.any(Error));
    // The language is unknown after the failure, so English is applied again.
    expect(apply.mock.calls).toEqual([['en'], ['pt-BR'], ['en']]);
    sync.dispose();
  });

  it('removes a listener that finishes registering after disposal', async () => {
    const native = fakeNative('en');
    const registered = deferred<() => void>();
    const stop = vi.fn<() => void>();
    native.subscribe.mockReturnValueOnce(registered.promise);
    const sync = createPreferenceSync({ ...native, apply: applied(), report: reported() });
    void sync.start(10);
    sync.dispose();
    registered.resolve(stop);
    await flush();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports a listener that failed to register and retries it', async () => {
    vi.useFakeTimers();
    const native = fakeNative('en');
    native.subscribe.mockRejectedValueOnce(new Error('event plugin unavailable'));
    const report = reported();
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report, retryMs: 2000 });
    await sync.start(10);
    expect(report).toHaveBeenCalledWith('i18n:listen', expect.any(Error));
    await vi.advanceTimersByTimeAsync(2000);
    expect(native.subscribe).toHaveBeenCalledTimes(2);
    native.save('pt-BR');
    await vi.advanceTimersByTimeAsync(0);
    expect(apply.mock.calls.at(-1)).toEqual(['pt-BR']);
    sync.dispose();
  });

  it('forwards a save in this window to the active sync', async () => {
    const native = fakeNative('en');
    const apply = applied();
    const sync = createPreferenceSync({ ...native, apply, report: reported() });
    await sync.start(10);
    setActivePreferenceSync(sync);
    native.store.locale = 'pt';
    commitUiPreference('pt');
    await flush();
    expect(apply.mock.calls.at(-1)).toEqual(['pt']);
    sync.dispose();
  });
});
