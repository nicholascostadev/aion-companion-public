import { ACCESS, PORTABLE, UPDATE } from './mockScenario';

/*
 * DEV ONLY. GitHub access for private release updates, faked without a GitHub CLI or an
 * account. `?mock=access-<step>` starts a stable private install at one step of the path:
 * - `cli`: GitHub CLI is not installed; Get GitHub CLI "installs" it.
 * - `signin`: installed but signed out; Sign in "finishes" in the browser after a moment.
 * - `cancel`: like `signin`, but the first sign-in window is closed before finishing.
 * - `invite`: signed in, invitation not accepted; Open GitHub notifications "accepts" it.
 * - `error`: the first probe cannot reach GitHub; the next one finds access.
 * - `ready`: access confirmed.
 * Other stable scenarios have access confirmed; development builds never probe.
 */

type Step = 'cli' | 'signin' | 'cancel' | 'invite' | 'error' | 'ready';
const STEPS: readonly Step[] = ['cli', 'signin', 'cancel', 'invite', 'error', 'ready'];
const step: Step | null = STEPS.includes(ACCESS as Step) ? (ACCESS as Step) : null;

/** A stable build: the access guide only exists there. */
export const ACCESS_STABLE = step !== null || UPDATE !== null || PORTABLE;

const gh = {
  cli: step !== 'cli',
  signedIn: step === 'invite' || step === 'error' || step === 'ready' || step === null,
  invited: step === 'error' || step === 'ready' || step === null,
  unreachable: step === 'error' ? 1 : 0,
  cancels: step === 'cancel' ? 1 : 0,
};

type Phase = 'unchecked' | 'checking' | 'signing_in' | 'checked' | 'development';
const access = {
  phase: (ACCESS_STABLE ? (step === null ? 'checked' : 'unchecked') : 'development') as Phase,
  cli_installed: null as boolean | null,
  authenticated: null as boolean | null,
  repository_access: null as boolean | null,
  checked_ms: null as number | null,
  error: null as string | null,
  login_supported: ACCESS_STABLE,
  repository: 'nicholascostadev/aion-companion-public',
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** What a bounded probe of the CLI, its sign-in and the repository would find right now. */
function probe() {
  access.phase = 'checked';
  access.checked_ms = Date.now();
  access.error = null;
  access.cli_installed = gh.cli;
  access.authenticated = gh.cli ? gh.signedIn : null;
  access.repository_access = gh.cli && gh.signedIn ? gh.invited : null;
  if (gh.cli && gh.unreachable > 0) {
    gh.unreachable -= 1;
    access.authenticated = null;
    access.repository_access = null;
    access.error =
      'Could not reach GitHub. Check your internet connection, then check access again.';
  }
}
if (step === null && ACCESS_STABLE) probe();

/** Access is confirmed, so private release checks succeed. */
export const accessReady = () =>
  access.phase !== 'development' && access.repository_access === true;

/** Opening an official page moves the fake along, as doing what the page says would. */
export function accessLinkOpened(link: unknown) {
  if (link === 'github_cli') gh.cli = true;
  if (link === 'github_invitations' && gh.signedIn) gh.invited = true;
}

let running = false;
export const accessCommands = {
  updates_access_status: () => ({ ...access }),
  updates_access_check: async () => {
    if (access.phase === 'development') return { ...access };
    if (running) throw new Error('A GitHub access check is already running (mock)');
    running = true;
    access.phase = 'checking';
    try {
      await wait(1_200);
      probe();
    } finally {
      running = false;
    }
    return { ...access };
  },
  updates_access_login: async () => {
    if (access.phase === 'development') return { ...access };
    if (running) throw new Error('A GitHub access check is already running (mock)');
    if (!gh.cli) throw new Error('Install GitHub CLI first, then check access (mock)');
    running = true;
    access.phase = 'signing_in';
    console.info('[mock] Would open GitHub CLI sign-in in its own window.');
    try {
      await wait(3_000);
      if (gh.cancels > 0) {
        gh.cancels -= 1;
        probe();
        access.authenticated = null;
        access.repository_access = null;
        access.error = 'GitHub CLI sign-in did not finish. Sign in again when you are ready.';
      } else {
        gh.signedIn = true;
        probe();
      }
    } finally {
      running = false;
    }
    return { ...access };
  },
};
