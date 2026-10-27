import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateAccessStatus } from '../types/updateAccess';
import {
  normalizeUpdateAccessStatus,
  readUpdateAccessStatus,
  runUpdateAccessAction,
} from './updateAccess';
import { updateAccessStep } from '../lib/updateAccess';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));

afterEach(() => {
  vi.resetAllMocks();
});

const checked = (patch: Partial<UpdateAccessStatus>): UpdateAccessStatus => ({
  phase: 'checked',
  cli_installed: true,
  authenticated: true,
  repository_access: true,
  checked_ms: 1,
  error: null,
  login_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
  ...patch,
});

describe('GitHub access service', () => {
  it('reads the cached status and runs each step with no arguments', async () => {
    vi.mocked(invoke).mockResolvedValue({
      phase: 'checked',
      cli_installed: true,
      authenticated: false,
      repository_access: null,
      checked_ms: 1_760_000_000_000,
      error: null,
      login_supported: true,
      repository: 'nicholascostadev/aion-companion-public',
    });
    await expect(readUpdateAccessStatus()).resolves.toMatchObject({ authenticated: false });
    expect(invoke).toHaveBeenLastCalledWith('updates_access_status');
    await runUpdateAccessAction('check');
    expect(invoke).toHaveBeenLastCalledWith('updates_access_check');
    await runUpdateAccessAction('login');
    expect(invoke).toHaveBeenLastCalledWith('updates_access_login');
  });

  it('assumes nothing it was not told', () => {
    expect(
      normalizeUpdateAccessStatus({ phase: 'checked', cli_installed: 'yes', error: ' ' }),
    ).toEqual({
      phase: 'checked',
      cli_installed: null,
      authenticated: null,
      repository_access: null,
      checked_ms: null,
      error: null,
      login_supported: false,
      repository: 'nicholascostadev/aion-companion-public',
    });
    expect(() => normalizeUpdateAccessStatus(null)).toThrow('no GitHub access status');
    expect(() => normalizeUpdateAccessStatus({ phase: 'granted' })).toThrow(
      'no GitHub access phase',
    );
  });

  it('never offers a development build a sign-in', () => {
    const status = normalizeUpdateAccessStatus({
      phase: 'development',
      cli_installed: true,
      repository_access: true,
      login_supported: true,
    });
    expect(status).toMatchObject({ repository_access: null, login_supported: false });
    expect(updateAccessStep(status)).toBe('unknown');
  });

  it('tells a missing CLI, a signed-out CLI and unconfirmed access apart', () => {
    expect(updateAccessStep(null)).toBe('unknown');
    expect(updateAccessStep(checked({ phase: 'unchecked' }))).toBe('unknown');
    expect(updateAccessStep(checked({ phase: 'checking' }))).toBe('checking');
    expect(updateAccessStep(checked({ phase: 'signing_in' }))).toBe('signing_in');
    expect(
      updateAccessStep(
        checked({ cli_installed: false, authenticated: null, repository_access: null }),
      ),
    ).toBe('cli_missing');
    expect(updateAccessStep(checked({ authenticated: false, repository_access: null }))).toBe(
      'signed_out',
    );
    expect(updateAccessStep(checked({ repository_access: false }))).toBe('no_access');
    expect(updateAccessStep(checked({}))).toBe('ready');
  });

  it('never calls a probe that could not finish a refusal', () => {
    // A connection failure, a rate limit or a cancelled sign-in: facts unknown, a safe next step.
    const unfinished = checked({
      authenticated: null,
      repository_access: null,
      error: 'Could not reach GitHub. Check your connection, then check access again.',
    });
    expect(updateAccessStep(unfinished)).toBe('error');
    expect(updateAccessStep(checked({ repository_access: null, error: 'Rate limited' }))).toBe(
      'error',
    );
  });
});
