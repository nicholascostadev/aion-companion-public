/**
 * Where native's GitHub access probe stands. `unchecked`: nothing probed yet this session;
 * `checking`: a probe is running; `signing_in`: the GitHub CLI sign-in window is open, and a
 * probe follows when it closes; `checked`: the fields hold the last probe; `development`:
 * development builds never probe or sign in.
 */
export type UpdateAccessPhase = 'unchecked' | 'checking' | 'signing_in' | 'checked' | 'development';

/**
 * `updates_access_status` (a cached snapshot, never a probe), `updates_access_check` and
 * `updates_access_login` all return this. Each fact is null until a probe could tell.
 */
export interface UpdateAccessStatus {
  phase: UpdateAccessPhase;
  cli_installed: boolean | null;
  authenticated: boolean | null;
  repository_access: boolean | null;
  checked_ms: number | null;
  /** A safe next step from native, never raw GitHub CLI output. */
  error: string | null;
  /** Native can open the official GitHub CLI sign-in window. */
  login_supported: boolean;
  repository: string;
}

export type UpdateAccessAction = 'check' | 'login';

/**
 * Which part of the guided path the last probe stopped at. `error` is a probe that could not
 * finish, which says nothing about permission; `no_access` is a signed-in account whose
 * access is not confirmed (no invitation yet, one not accepted, or another account).
 */
export type UpdateAccessStep =
  | 'unknown'
  | 'checking'
  | 'signing_in'
  | 'cli_missing'
  | 'signed_out'
  | 'no_access'
  | 'error'
  | 'ready';

/** What the GitHub access guide needs from `useUpdateAccess`. */
export interface UpdateAccessState {
  status: UpdateAccessStatus | null;
  /** The access commands could not be reached or rejected a step. */
  error: string;
  pending: UpdateAccessAction | null;
  /** A check or sign-in is running here or natively; neither may start another. */
  busy: boolean;
  check: () => Promise<boolean>;
  login: () => Promise<boolean>;
}
