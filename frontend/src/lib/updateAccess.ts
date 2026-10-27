import type { UpdateAccessStatus, UpdateAccessStep } from '../types/updateAccess';

/**
 * Where the guided GitHub access path stands. A step is only "missing" when the probe said
 * so; a fact it could not establish is a probe that did not finish, never a refusal.
 */
export function updateAccessStep(status: UpdateAccessStatus | null): UpdateAccessStep {
  if (!status || status.phase === 'unchecked' || status.phase === 'development') return 'unknown';
  if (status.phase === 'checking') return 'checking';
  if (status.phase === 'signing_in') return 'signing_in';
  if (status.cli_installed === false) return 'cli_missing';
  if (status.authenticated === false) return 'signed_out';
  if (status.repository_access === false) return 'no_access';
  if (status.repository_access === true) return 'ready';
  return status.error ? 'error' : 'unknown';
}
