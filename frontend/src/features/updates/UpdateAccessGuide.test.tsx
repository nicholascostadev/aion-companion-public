import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupState } from '../../types/setup';
import type { UpdateAccessState, UpdateAccessStatus } from '../../types/updateAccess';
import type { UpdateStatus, UpdatesState } from '../../types/updates';
import { GH_LOGIN_COMMAND, UpdateAccessGuide } from './UpdateAccessGuide';
import { UpdatesPanel } from './UpdatesPanel';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
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

const controller = (
  status: Partial<UpdateAccessStatus> | null,
  patch: Partial<UpdateAccessState> = {},
): UpdateAccessState => ({
  status: status ? accessStatus(status) : null,
  error: '',
  pending: null,
  busy: ['checking', 'signing_in'].includes(status?.phase ?? ''),
  check: vi.fn<UpdateAccessState['check']>().mockResolvedValue(true),
  login: vi.fn<UpdateAccessState['login']>().mockResolvedValue(true),
  ...patch,
});

const opener = () => vi.fn<SetupState['open']>().mockResolvedValue('');
const guide = () => screen.getByRole('region', { name: 'GitHub access for updates' });
const button = (name: RegExp | string) =>
  within(guide()).getByRole<HTMLButtonElement>('button', { name });
const step = (index: number) => {
  const item = guide().querySelector<HTMLElement>(`[data-step="${index}"]`);
  if (!item) throw new Error(`No step ${index}`);
  return item;
};
const primary = (element: HTMLElement) => element.className.includes('bg-accent ');

describe('GitHub access guide', () => {
  it('starts unchecked, explains what is and is not needed, and checks on request', () => {
    const access = controller(null);
    render(<UpdateAccessGuide access={access} onOpenLink={opener()} />);
    expect(within(guide()).getByText('Not checked')).toBeTruthy();
    expect(
      within(guide()).getByText(/installer and the app work without any of this/),
    ).toBeTruthy();
    expect(
      within(guide()).getByText(/never need to download the repository, Git, Node or Rust/),
    ).toBeTruthy();
    // Nothing is marked missing before a probe has said so.
    for (const index of [1, 2, 3]) expect(step(index).dataset.progress).toBe('todo');
    fireEvent.click(button('Check access'));
    expect(access.check).toHaveBeenCalledOnce();
    // Never a field for a token or a password.
    expect(within(guide()).queryByRole('textbox')).toBeNull();
  });

  it('leads a missing CLI to the official download and holds sign-in until it is there', () => {
    const open = opener();
    const access = controller({
      cli_installed: false,
      authenticated: null,
      repository_access: null,
    });
    render(<UpdateAccessGuide access={access} onOpenLink={open} />);
    expect(within(guide()).getByText('GitHub CLI not found')).toBeTruthy();
    expect(step(1).dataset.progress).toBe('next');
    const get = button('Get GitHub CLI');
    expect(primary(get)).toBe(true);
    fireEvent.click(get);
    expect(open).toHaveBeenCalledWith('github_cli');
    expect(button('Sign in with GitHub CLI').disabled).toBe(true);
    expect(within(guide()).getByText('Install GitHub CLI first.')).toBeTruthy();
    expect(primary(button('Check access'))).toBe(false);
  });

  it('signs a signed-out CLI in, saying first to skip Git authentication', async () => {
    const writeText = vi.fn<Clipboard['writeText']>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const access = controller({ authenticated: false, repository_access: null });
    render(<UpdateAccessGuide access={access} onOpenLink={opener()} />);
    expect(within(guide()).getByText('Not signed in')).toBeTruthy();
    expect(step(1).dataset.progress).toBe('done');
    expect(step(2).dataset.progress).toBe('next');
    const git = within(step(2)).getByText(/asks whether to authenticate Git.*choose No/);
    const signIn = button('Sign in with GitHub CLI');
    // The Git answer is read before the button and the manual command.
    expect(git.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(step(2)).getByText(/not the same as signing in to GitHub CLI/)).toBeTruthy();
    expect(within(step(2)).getByText(/never sees your password or code/)).toBeTruthy();
    expect(primary(signIn)).toBe(true);
    fireEvent.click(signIn);
    expect(access.login).toHaveBeenCalledOnce();

    fireEvent.click(within(step(2)).getByText('Sign-in window did not open?'));
    expect(within(step(2)).getByText(GH_LOGIN_COMMAND)).toBeTruthy();
    fireEvent.click(within(step(2)).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(
      'gh auth login --hostname github.com --web --git-protocol https',
    );
    expect(await within(step(2)).findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('confirms a copied command under StrictMode, and says why a copy failed', async () => {
    const writeText = vi.fn<Clipboard['writeText']>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const status = { authenticated: false, repository_access: null, login_supported: false };
    const { unmount } = render(
      <StrictMode>
        <UpdateAccessGuide access={controller(status)} />
      </StrictMode>,
    );
    fireEvent.click(within(step(2)).getByRole('button', { name: 'Copy' }));
    expect(await within(step(2)).findByRole('button', { name: 'Copied' })).toBeTruthy();
    unmount();

    writeText.mockRejectedValue(new Error('denied'));
    render(<UpdateAccessGuide access={controller(status)} />);
    fireEvent.click(within(step(2)).getByRole('button', { name: 'Copy' }));
    expect((await within(step(2)).findByRole('alert')).textContent).toContain(
      'Could not copy the command',
    );
  });

  it('gives the command itself when this copy cannot open the sign-in window', () => {
    render(
      <UpdateAccessGuide
        access={controller({
          authenticated: false,
          repository_access: null,
          login_supported: false,
        })}
        onOpenLink={opener()}
      />,
    );
    expect(within(guide()).queryByRole('button', { name: 'Sign in with GitHub CLI' })).toBeNull();
    expect(within(step(2)).getByText(/cannot open the sign-in window/)).toBeTruthy();
    expect(within(step(2)).getByText(GH_LOGIN_COMMAND)).toBeTruthy();
    expect(within(step(2)).getByText(/choose No/)).toBeTruthy();
  });

  it('allows nothing else while signing in or checking', () => {
    const { rerender } = render(
      <UpdateAccessGuide
        access={controller({ phase: 'signing_in', authenticated: null, repository_access: null })}
      />,
    );
    expect(within(guide()).getByText(/Finish signing in in the GitHub CLI window/)).toBeTruthy();
    expect(button('Signing in…').disabled).toBe(true);
    expect(button('Check access').disabled).toBe(true);

    rerender(<UpdateAccessGuide access={controller(null, { pending: 'check', busy: true })} />);
    expect(button('Checking…').disabled).toBe(true);
    expect(button('Sign in with GitHub CLI').disabled).toBe(true);
  });

  it('calls unconfirmed access unconfirmed, with the invitation and a recheck', () => {
    const open = opener();
    const access = controller({ repository_access: false });
    render(<UpdateAccessGuide access={access} onOpenLink={open} />);
    expect(within(guide()).getByText('Access not confirmed')).toBeTruthy();
    const text = guide().textContent ?? '';
    expect(text).toContain('not confirmed yet');
    expect(text).toContain('a different account');
    expect(text).not.toMatch(/denied|refused|forbidden/i);
    expect(step(3).dataset.progress).toBe('next');
    fireEvent.click(button('Open GitHub notifications'));
    expect(open).toHaveBeenCalledWith('github_invitations');
    fireEvent.click(button('View repository'));
    expect(open).toHaveBeenCalledWith('repository');
    const check = button('Check access');
    expect(primary(check)).toBe(true);
    fireEvent.click(check);
    expect(access.check).toHaveBeenCalledOnce();
  });

  it('keeps a probe that did not finish apart from a refusal', () => {
    render(
      <UpdateAccessGuide
        access={controller({
          authenticated: null,
          repository_access: null,
          error: 'Could not reach GitHub. Check your connection, then check access again.',
        })}
      />,
    );
    expect(within(guide()).getByText('Unknown')).toBeTruthy();
    expect(within(guide()).getByText(/does not mean access was refused/)).toBeTruthy();
    expect(within(guide()).getByRole('alert').textContent).toContain('Could not reach GitHub');
    expect(primary(button('Check access'))).toBe(true);
    expect(button('Sign in with GitHub CLI').disabled).toBe(false);
  });

  it('says why the access commands could not be reached', () => {
    render(<UpdateAccessGuide access={controller(null, { error: 'Error: no access command' })} />);
    expect(within(guide()).getByRole('alert').textContent).toContain(
      'Could not reach the access check: Error: no access command',
    );
  });

  it('shrinks to one line once access is confirmed', () => {
    const access = controller({});
    render(<UpdateAccessGuide access={access} onOpenLink={opener()} />);
    expect(within(guide()).getByText('Ready')).toBeTruthy();
    expect(within(guide()).getByText(/Check for updates works as usual/)).toBeTruthy();
    expect(guide().querySelector('[data-step]')).toBeNull();
    expect(within(guide()).queryByRole('button', { name: 'Sign in with GitHub CLI' })).toBeNull();
    fireEvent.click(button('Check access'));
    expect(access.check).toHaveBeenCalledOnce();
  });

  it('says why an official page could not open', async () => {
    render(
      <UpdateAccessGuide
        access={controller({ repository_access: false })}
        onOpenLink={vi.fn<SetupState['open']>().mockResolvedValue('Error: no browser')}
      />,
    );
    fireEvent.click(button('Open GitHub notifications'));
    expect((await within(guide()).findByRole('alert')).textContent).toContain('no browser');
  });
});

const updateStatus = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  channel: 'stable',
  current_version: '0.6.4',
  latest_version: null,
  phase: 'idle',
  error: null,
  checked_ms: null,
  release_url: null,
  notes: null,
  restart_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
  ...patch,
});
const updates = (patch: Partial<UpdateStatus> = {}): UpdatesState => ({
  status: updateStatus(patch),
  error: '',
  pending: null,
  busy: false,
  check: vi.fn<UpdatesState['check']>().mockResolvedValue(true),
  download: vi.fn<UpdatesState['download']>().mockResolvedValue(true),
  install: vi.fn<UpdatesState['install']>().mockResolvedValue(true),
});
const region = () => screen.queryByRole('region', { name: 'GitHub access for updates' });

describe('updates panel with GitHub access', () => {
  it('replaces the lone CLI link with the guide in a private copy', () => {
    render(
      <UpdatesPanel
        native
        updates={updates({ phase: 'error', error: 'Not signed in.' })}
        onOpenLink={opener()}
        access={controller({ authenticated: false, repository_access: null })}
      />,
    );
    expect(region()).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /GitHub CLI/ })).toHaveLength(1);
    expect(screen.queryByText('gh auth login')).toBeNull();
    expect(screen.getByText(/through your GitHub CLI sign-in/)).toBeTruthy();
  });

  it('puts Check for updates first once access is confirmed, and starts nothing itself', () => {
    const state = updates({ phase: 'error', error: 'Not signed in.' });
    render(<UpdatesPanel native updates={state} access={controller({})} />);
    const check = screen.getByRole<HTMLButtonElement>('button', { name: 'Check for updates' });
    expect(primary(check)).toBe(true);
    expect(state.check).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    fireEvent.click(check);
    expect(state.check).toHaveBeenCalledOnce();
  });

  it('keeps the portable installer first and the guide for its checks', async () => {
    const open = opener();
    render(
      <UpdatesPanel
        native
        updates={updates({ phase: 'available', latest_version: '0.6.5', restart_supported: false })}
        onOpenLink={open}
        access={controller({})}
      />,
    );
    expect(region()).toBeTruthy();
    expect(primary(screen.getByRole('button', { name: 'Download installer' }))).toBe(true);
    expect(primary(screen.getByRole('button', { name: 'Check for updates' }))).toBe(false);
    expect(screen.queryByRole('button', { name: /Download update/ })).toBeNull();
    expect(screen.getByText(/needs a GitHub sign-in in your browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download installer' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('releases'));
  });

  it('never shows the guide for public releases or a development build', () => {
    const access = controller(null);
    const { rerender } = render(
      <UpdatesPanel native distribution="public" updates={updates()} access={access} />,
    );
    expect(region()).toBeNull();
    expect(screen.getByText(/read from GitHub directly, with no sign-in/)).toBeTruthy();
    rerender(
      <UpdatesPanel
        native
        updates={updates({ channel: 'development', phase: 'development' })}
        access={access}
      />,
    );
    expect(region()).toBeNull();
    expect(access.check).not.toHaveBeenCalled();
    expect(access.login).not.toHaveBeenCalled();
  });
});
