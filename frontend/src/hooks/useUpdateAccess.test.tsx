import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/updateAccess';
import type { UpdateAccessStatus } from '../types/updateAccess';
import { updateAccessStep } from '../lib/updateAccess';
import { useUpdateAccess } from './useUpdateAccess';

vi.mock('../services/updateAccess', async (load) => ({
  ...(await load<typeof api>()),
  readUpdateAccessStatus: vi.fn<typeof api.readUpdateAccessStatus>(),
  runUpdateAccessAction: vi.fn<typeof api.runUpdateAccessAction>(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

const accessStatus = (patch: Partial<UpdateAccessStatus> = {}): UpdateAccessStatus => ({
  phase: 'checked',
  cli_installed: true,
  authenticated: true,
  repository_access: true,
  checked_ms: 1_760_000_000_000,
  error: null,
  login_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
  ...patch,
});
const unchecked = accessStatus({
  phase: 'unchecked',
  cli_installed: null,
  authenticated: null,
  repository_access: null,
  checked_ms: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const slow = { busyMs: 60_000, idleMs: 60_000 };
const read = () => vi.mocked(api.readUpdateAccessStatus);
const run = () => vi.mocked(api.runUpdateAccessAction);
const step = (status: UpdateAccessStatus | null) => updateAccessStep(status);

describe('GitHub access for private updates', () => {
  it('does nothing outside the desktop app', async () => {
    const { result } = renderHook(() => useUpdateAccess(false));
    expect(await result.current.check()).toBe(false);
    expect(await result.current.login()).toBe(false);
    expect(read()).not.toHaveBeenCalled();
    expect(run()).not.toHaveBeenCalled();
  });

  it('never probes or signs in on a development build', async () => {
    read().mockResolvedValue(accessStatus({ phase: 'development', login_supported: false }));
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('development'));
    expect(await result.current.check()).toBe(false);
    expect(await result.current.login()).toBe(false);
    expect(run()).not.toHaveBeenCalled();
  });

  it('probes an unchecked status once, and ordinary polls only read the cache', async () => {
    vi.useFakeTimers();
    read().mockResolvedValue(unchecked);
    run().mockResolvedValue(accessStatus({ authenticated: false, repository_access: null }));
    const { result } = renderHook(() => useUpdateAccess(true, { busyMs: 1000, idleMs: 5000 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(run()).toHaveBeenCalledExactlyOnceWith('check');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(run()).toHaveBeenCalledOnce();
    expect(read().mock.calls.length).toBeGreaterThan(3);
    // A read of the cache never undoes the probe's answer.
    read().mockResolvedValue(accessStatus({ authenticated: false, repository_access: null }));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(step(result.current.status)).toBe('signed_out');
  });

  it('leaves confirmed access and a probe native is running alone', async () => {
    vi.useFakeTimers();
    read().mockResolvedValue(accessStatus());
    const ready = renderHook(() => useUpdateAccess(true, slow));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(step(ready.result.current.status)).toBe('ready');
    ready.unmount();

    read().mockResolvedValue(accessStatus({ phase: 'checking' }));
    const busy = renderHook(() => useUpdateAccess(true, slow));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(busy.result.current.busy).toBe(true);
    expect(await busy.result.current.check()).toBe(false);
    expect(await busy.result.current.login()).toBe(false);
    expect(run()).not.toHaveBeenCalled();
  });

  it('probes again on the way back while access is not confirmed', async () => {
    vi.useFakeTimers();
    const denied = accessStatus({ repository_access: false });
    read().mockResolvedValue(denied);
    run().mockResolvedValue(denied);
    const { rerender, result } = renderHook(
      ({ active }) => useUpdateAccess(true, { active, ...slow }),
      { initialProps: { active: true } },
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(run()).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(run()).toHaveBeenCalledTimes(1);

    // The owner granted access and the invitation was accepted meanwhile.
    run().mockResolvedValue(accessStatus());
    rerender({ active: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(run()).toHaveBeenCalledTimes(2);
    expect(step(result.current.status)).toBe('ready');

    read().mockResolvedValue(accessStatus());
    rerender({ active: false });
    rerender({ active: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(run()).toHaveBeenCalledTimes(2);
  });

  it('confirms access granted after an initial denial on Check access', async () => {
    const denied = accessStatus({ repository_access: false });
    read().mockResolvedValue(denied);
    run().mockResolvedValue(denied);
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(step(result.current.status)).toBe('no_access'));
    await waitFor(() => expect(result.current.busy).toBe(false));
    run().mockResolvedValue(accessStatus());
    let ok = false;
    await act(async () => {
      ok = await result.current.check();
    });
    expect(ok).toBe(true);
    expect(step(result.current.status)).toBe('ready');
  });

  it('reports a missing CLI as a finished probe and recovers once it is installed', async () => {
    read().mockResolvedValue(
      accessStatus({ cli_installed: false, authenticated: null, repository_access: null }),
    );
    run().mockResolvedValue(
      accessStatus({ cli_installed: false, authenticated: null, repository_access: null }),
    );
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(step(result.current.status)).toBe('cli_missing'));
    await waitFor(() => expect(result.current.busy).toBe(false));
    let ok = false;
    await act(async () => {
      ok = await result.current.check();
    });
    expect(ok).toBe(true);
    expect(step(result.current.status)).toBe('cli_missing');

    run().mockResolvedValue(accessStatus({ authenticated: false, repository_access: null }));
    await act(() => result.current.check());
    expect(step(result.current.status)).toBe('signed_out');
  });

  it('runs one step at a time', async () => {
    read().mockResolvedValue(accessStatus({ authenticated: false, repository_access: null }));
    run().mockResolvedValue(accessStatus({ authenticated: false, repository_access: null }));
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await waitFor(() => expect(run()).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.pending).toBeNull());

    const login = deferred<UpdateAccessStatus>();
    run().mockReturnValueOnce(login.promise);
    let first: Promise<boolean> | undefined;
    act(() => {
      first = result.current.login();
    });
    expect(result.current.pending).toBe('login');
    expect(result.current.busy).toBe(true);
    expect(await result.current.login()).toBe(false);
    expect(await result.current.check()).toBe(false);
    expect(run()).toHaveBeenCalledTimes(2);
    await act(async () => {
      login.resolve(accessStatus());
      expect(await first).toBe(true);
    });
    expect(result.current.pending).toBeNull();
    expect(step(result.current.status)).toBe('ready');
  });

  it('treats a cancelled sign-in as unfinished, and a second sign-in still works', async () => {
    const signedOut = accessStatus({ authenticated: false, repository_access: null });
    read().mockResolvedValue(signedOut);
    run().mockResolvedValue(signedOut);
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(step(result.current.status)).toBe('signed_out'));
    await waitFor(() => expect(result.current.pending).toBeNull());

    // Native closes the window without a sign-in: no stale facts, a safe next step.
    run().mockResolvedValueOnce(
      accessStatus({
        authenticated: null,
        repository_access: null,
        error: 'GitHub CLI sign-in did not finish. Sign in again when you are ready.',
      }),
    );
    let ok = true;
    await act(async () => {
      ok = await result.current.login();
    });
    expect(ok).toBe(false);
    expect(step(result.current.status)).toBe('error');
    expect(result.current.status?.error).toContain('did not finish');
    expect(result.current.error).toBe('');

    run().mockResolvedValueOnce(accessStatus());
    await act(async () => {
      ok = await result.current.login();
    });
    expect(ok).toBe(true);
    expect(step(result.current.status)).toBe('ready');
    expect(result.current.status?.error).toBeNull();
  });

  it('refuses a sign-in native cannot open', async () => {
    read().mockResolvedValue(
      accessStatus({ authenticated: false, repository_access: null, login_supported: false }),
    );
    run().mockResolvedValue(
      accessStatus({ authenticated: false, repository_access: null, login_supported: false }),
    );
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(result.current.status?.login_supported).toBe(false));
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(await result.current.login()).toBe(false);
    expect(run()).not.toHaveBeenCalledWith('login');
  });

  it('keeps the last answer through repeated native failures and recovers', async () => {
    const signedOut = accessStatus({ authenticated: false, repository_access: null });
    read().mockResolvedValue(signedOut);
    run().mockResolvedValueOnce(signedOut);
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(step(result.current.status)).toBe('signed_out'));
    await waitFor(() => expect(result.current.pending).toBeNull());

    run().mockRejectedValue(new Error('access commands unavailable'));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let ok = true;
      await act(async () => {
        ok = await result.current.check();
      });
      expect(ok).toBe(false);
      expect(result.current.error).toContain('access commands unavailable');
      expect(step(result.current.status)).toBe('signed_out');
      expect(result.current.busy).toBe(false);
    }

    run().mockResolvedValue(accessStatus());
    await act(() => result.current.check());
    expect(result.current.error).toBe('');
    expect(step(result.current.status)).toBe('ready');
  });

  it('says so when the status cannot be read, before any answer', async () => {
    read().mockRejectedValue(new Error('no access command'));
    const { result } = renderHook(() => useUpdateAccess(true, slow));
    await waitFor(() => expect(result.current.error).toContain('no access command'));
    expect(result.current.status).toBeNull();
    expect(step(result.current.status)).toBe('unknown');
    expect(run()).not.toHaveBeenCalled();
  });
});
