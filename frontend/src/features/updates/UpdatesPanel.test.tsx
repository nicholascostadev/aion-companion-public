import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupState } from '../../types/setup';
import type { UpdateStatus, UpdatesState } from '../../types/updates';
import { UpdatesPanel } from './UpdatesPanel';

afterEach(cleanup);

const updateStatus = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  channel: 'stable',
  current_version: '0.6.4',
  latest_version: null,
  phase: 'current',
  error: null,
  checked_ms: 1_760_000_000_000,
  release_url: null,
  notes: null,
  restart_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
  ...patch,
});

const state = (status: Partial<UpdateStatus> | null, patch: Partial<UpdatesState> = {}) => ({
  status: status ? updateStatus(status) : null,
  error: '',
  pending: null,
  busy: ['checking', 'downloading', 'restarting'].includes(status?.phase ?? ''),
  check: vi.fn<UpdatesState['check']>().mockResolvedValue(true),
  download: vi.fn<UpdatesState['download']>().mockResolvedValue(true),
  install: vi.fn<UpdatesState['install']>().mockResolvedValue(true),
  ...patch,
});

const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });

/** Buttons that act; the release notes' fold (aria-expanded) only shows them. */
const actions = () =>
  screen.queryAllByRole('button').filter((button) => !button.hasAttribute('aria-expanded'));

describe('updates panel', () => {
  it.each(['development', 'available', 'ready'] as const)(
    'hides release actions on the development channel in phase %s',
    (phase) => {
      const updates = state({ channel: 'development', phase, latest_version: '0.6.5' });
      render(<UpdatesPanel native updates={updates} />);
      expect(screen.getByText(/Release updates belong to the stable channel/)).toBeTruthy();
      expect(actions()).toEqual([]);
      expect(screen.queryByText('Latest release')).toBeNull();
      expect(screen.queryByText('gh auth login')).toBeNull();
      expect(updates.check).not.toHaveBeenCalled();
      expect(updates.download).not.toHaveBeenCalled();
      expect(updates.install).not.toHaveBeenCalled();
    },
  );

  it('needs the desktop app and says so', () => {
    const updates = state(null);
    render(<UpdatesPanel native={false} updates={updates} />);
    expect(screen.getByText(/Updates need the desktop app/)).toBeTruthy();
    expect(button(/Check for updates/).disabled).toBe(true);
    expect(screen.getByText(/no gameplay data is uploaded/)).toBeTruthy();
  });

  it('checks GitHub on request and explains the GitHub CLI sign-in', () => {
    const updates = state({ phase: 'current' });
    render(<UpdatesPanel native updates={updates} />);
    expect(screen.getByText('v0.6.4')).toBeTruthy();
    expect(screen.getByText('You have the latest version')).toBeTruthy();
    expect(screen.getByText('gh auth login')).toBeTruthy();
    fireEvent.click(button(/Check for updates/));
    expect(updates.check).toHaveBeenCalledTimes(1);
  });

  it('shows a check in progress without allowing another', () => {
    render(<UpdatesPanel native updates={state({ phase: 'checking' })} />);
    expect(button(/Checking/).disabled).toBe(true);
    expect(screen.getByText('Checking GitHub for a new release…')).toBeTruthy();
  });

  it('offers the download it found, with raw HTML in the notes kept as text', () => {
    const updates = state({
      phase: 'available',
      latest_version: '0.6.5',
      notes: '<b>Faster</b> meter',
    });
    const { container } = render(<UpdatesPanel native updates={updates} />);
    expect(screen.getByText('Version v0.6.5 is available')).toBeTruthy();
    expect(screen.getByText('<b>Faster</b> meter').tagName).toBe('P');
    expect(container.querySelector('[data-ui="release-notes"] b')).toBeNull();
    expect(screen.getByText('Release notes for v0.6.5')).toBeTruthy();
    fireEvent.click(button(/Download update/));
    expect(updates.download).toHaveBeenCalledTimes(1);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it('formats generated release notes as grouped changes', () => {
    const pull = 'https://github.com/nicholascostadev/aion-companion-public/pull/30';
    const compare =
      'https://github.com/nicholascostadev/aion-companion-public/compare/v0.7.13...v0.7.14';
    render(
      <UpdatesPanel
        native
        updates={state({
          phase: 'available',
          latest_version: '0.7.14',
          notes: `## What's Changed\n* style(ui): nest border radii concentrically by @nicholascostadev in ${pull}\n\n**Full Changelog**: ${compare}`,
        })}
      />,
    );
    expect(screen.getByText('1 change')).toBeTruthy();
    fireEvent.click(screen.getByText('1 change'));
    expect(screen.getByRole('heading', { name: /Improvements/ })).toBeTruthy();
    expect(screen.queryByText(/What's Changed/)).toBeNull();
    expect(screen.getByText('ui').getAttribute('title')).toBe('Area: ui');
    expect(screen.getByText('Nest border radii concentrically')).toBeTruthy();
    expect(screen.getByText('by @nicholascostadev')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([pull, compare]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(links[1]!.textContent).toContain('Full changelog');
    expect(links[1]!.textContent).toContain('v0.7.13 → v0.7.14');
  });

  it('previews sample release notes on the development channel without update actions', () => {
    render(
      <UpdatesPanel native updates={state({ channel: 'development', phase: 'development' })} />,
    );
    expect(screen.getByText('Release notes preview')).toBeTruthy();
    expect(screen.getByText('Sample')).toBeTruthy();
    expect(screen.getByText(/It is not a release/)).toBeTruthy();
    fireEvent.click(screen.getByText('Release notes preview'));
    expect(screen.getByRole('heading', { name: /New features/ })).toBeTruthy();
    expect(actions()).toEqual([]);
  });

  it('downloads without a made-up progress figure', () => {
    render(
      <UpdatesPanel native updates={state({ phase: 'downloading', latest_version: '0.6.5' })} />,
    );
    expect(button(/Downloading/).disabled).toBe(true);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText(/the download continues/)).toBeTruthy();
  });

  it('waits for the user to restart into a verified download', () => {
    const updates = state({ phase: 'ready', latest_version: '0.6.5' });
    render(<UpdatesPanel native updates={updates} restartBlocked={false} />);
    expect(screen.getByText('Version v0.6.5 is downloaded and verified')).toBeTruthy();
    expect(screen.getByText(/saves collected results, then restarts into v0\.6\.5/)).toBeTruthy();
    expect(screen.getByText(/Unsaved settings changes are not kept/)).toBeTruthy();
    expect(updates.install).not.toHaveBeenCalled();
    fireEvent.click(button(/Restart to update/));
    expect(updates.install).toHaveBeenCalledTimes(1);
  });

  it('holds only Restart while settings changes are unsaved', () => {
    const updates = state({ phase: 'ready', latest_version: '0.6.5' });
    render(<UpdatesPanel native updates={updates} restartBlocked />);
    expect(button(/Restart to update/).disabled).toBe(true);
    expect(
      screen.getByText('Save or discard your settings changes before restarting.'),
    ).toBeTruthy();
  });

  it('offers a portable copy the installer instead of an update it cannot apply', async () => {
    const open = vi.fn<SetupState['open']>().mockResolvedValue('');
    const updates = state({
      phase: 'available',
      latest_version: '0.6.5',
      restart_supported: false,
    });
    render(<UpdatesPanel native updates={updates} onOpenLink={open} />);
    expect(screen.getByText('Portable copy')).toBeTruthy();
    expect(screen.getByText(/portable copy, so it cannot update itself/)).toBeTruthy();
    expect(screen.getByText('Version v0.6.5 is available')).toBeTruthy();
    expect(screen.getByText(/replace this file with the new version by hand/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download update/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull();

    fireEvent.click(button(/Download installer/));
    expect(open).toHaveBeenCalledWith('releases');
    // It still checks for releases, through the private sign-in.
    fireEvent.click(button(/Check for updates/));
    expect(updates.check).toHaveBeenCalledOnce();
    expect(screen.getByText(/needs a GitHub sign-in in your browser/)).toBeTruthy();
    expect(screen.getByText('gh auth login')).toBeTruthy();
    fireEvent.click(button(/Set up GitHub CLI/));
    expect(open).toHaveBeenCalledWith('github_cli');
    expect(updates.download).not.toHaveBeenCalled();
    await waitFor(() => expect(button(/Download installer/).disabled).toBe(false));
  });

  it('never offers a portable copy a restart, even with a staged version', () => {
    render(
      <UpdatesPanel
        native
        updates={state({ phase: 'ready', latest_version: '0.6.5', restart_supported: false })}
        onOpenLink={vi.fn<SetupState['open']>().mockResolvedValue('')}
      />,
    );
    expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull();
    expect(button(/Download installer/)).toBeTruthy();
    expect(screen.getByText(/Download the installer from the latest release/)).toBeTruthy();
  });

  it('says why the release page could not open', async () => {
    render(
      <UpdatesPanel
        native
        updates={state({ phase: 'current', restart_supported: false })}
        onOpenLink={vi.fn<SetupState['open']>().mockResolvedValue('Error: no browser')}
      />,
    );
    fireEvent.click(button(/Download installer/));
    expect((await screen.findByRole('alert')).textContent).toContain('no browser');
  });

  it('reads public releases without asking for a GitHub CLI sign-in', () => {
    render(
      <UpdatesPanel
        native
        distribution="public"
        updates={state({ phase: 'current', restart_supported: false })}
        onOpenLink={vi.fn<SetupState['open']>().mockResolvedValue('')}
      />,
    );
    expect(screen.queryByText('gh auth login')).toBeNull();
    expect(screen.queryByRole('button', { name: /Set up GitHub CLI/ })).toBeNull();
    expect(screen.queryByText(/sign-in in your browser/)).toBeNull();
    expect(screen.getByText(/Download the installer from the latest release/)).toBeTruthy();
  });

  it('links an installed private copy to GitHub CLI setup, which only updates need', () => {
    const open = vi.fn<SetupState['open']>().mockResolvedValue('');
    render(<UpdatesPanel native updates={state({ phase: 'current' })} onOpenLink={open} />);
    expect(screen.getByText(/The CLI is only for updates/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download installer/ })).toBeNull();
    fireEvent.click(button(/Set up GitHub CLI/));
    expect(open).toHaveBeenCalledWith('github_cli');
  });

  it('shows a restart in progress', () => {
    render(
      <UpdatesPanel native updates={state({ phase: 'restarting', latest_version: '0.6.5' })} />,
    );
    expect(button(/Restarting/).disabled).toBe(true);
    expect(screen.getByText(/the app stays open, keeps capturing/)).toBeTruthy();
  });

  it('shows a failed step and keeps the current version honest', () => {
    render(
      <UpdatesPanel
        native
        updates={state({
          phase: 'error',
          latest_version: '0.6.5',
          error: 'Saving capture failed.',
        })}
      />,
    );
    const alert = screen.getByRole('alert').textContent;
    expect(alert).toContain('Saving capture failed.');
    expect(alert).toContain('capture is unaffected');
    expect(button(/Check for updates/).disabled).toBe(false);
  });

  it('reports a service that cannot be reached before any status', () => {
    render(<UpdatesPanel native updates={state(null, { error: 'Error: no updater' })} />);
    expect(screen.getByRole('alert').textContent).toContain('no updater');
    expect(screen.getByText('Reading update status…')).toBeTruthy();
    expect(button(/Check for updates/).disabled).toBe(true);
  });

  it('shows download activity before native reports the downloading phase', () => {
    render(
      <UpdatesPanel
        native
        updates={state(
          { phase: 'available', latest_version: '0.6.5' },
          { pending: 'download', busy: true },
        )}
      />,
    );
    expect(button(/Downloading/).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Check again/ })).toBeNull();
    expect(button(/Downloading/).querySelector('svg.animate-spin')).toBeTruthy();
  });
});
