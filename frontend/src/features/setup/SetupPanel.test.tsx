import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupState, SetupStatus } from '../../types/setup';
import { setupStatus } from './fixtures';
import { SetupPanel } from './SetupPanel';

afterEach(cleanup);

const controller = (status: SetupStatus | null, patch: Partial<SetupState> = {}): SetupState => ({
  status,
  error: '',
  checking: false,
  recheck: vi.fn<SetupState['recheck']>().mockResolvedValue(),
  open: vi.fn<SetupState['open']>().mockResolvedValue(''),
  ...patch,
});

const requirement = (name: string) => {
  const row = screen.getByText(name, { selector: 'b' }).closest('li');
  if (!row) throw new Error(`No requirement ${name}`);
  return row;
};

describe('setup panel', () => {
  it('lists what this PC has when everything is ready', () => {
    const setup = controller(setupStatus('ready'));
    render(<SetupPanel native setup={setup} />);
    expect(within(requirement('Windows')).getByText('Supported')).toBeTruthy();
    expect(within(requirement('WebView2 Runtime')).getByText('Ready')).toBeTruthy();
    expect(within(requirement('Npcap')).getByText('Ready')).toBeTruthy();
    expect(within(requirement('Npcap')).queryByRole('button', { name: 'Get Npcap' })).toBeNull();
    expect(within(requirement('Npcap')).queryByText(/not installed on this PC/)).toBeNull();
    // Which features need the driver, and which never do.
    expect(screen.getByText(/the DPS meter, Group, trackers, the pet radar/)).toBeTruthy();
    expect(screen.getByText(/saved logs and reports, Compare, Replay, reminders/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(setup.recheck).toHaveBeenCalledOnce();
  });

  it('offers the official download for a missing driver', () => {
    const setup = controller(setupStatus('missing'));
    render(<SetupPanel native setup={setup} />);
    const npcap = requirement('Npcap');
    expect(within(npcap).getByText('Not installed')).toBeTruthy();
    expect(within(npcap).getByText(/not installed on this PC/)).toBeTruthy();
    expect(within(npcap).getByText(/Npcap reported: .*could not be found/)).toBeTruthy();
    fireEvent.click(within(npcap).getByRole('button', { name: 'Get Npcap' }));
    expect(setup.open).toHaveBeenCalledWith('npcap');
    fireEvent.click(within(npcap).getByRole('button', { name: 'Npcap help' }));
    expect(setup.open).toHaveBeenCalledWith('npcap_help');
  });

  it('points an installed but unusable driver to troubleshooting, not to installing', () => {
    const setup = controller(setupStatus('unavailable'));
    render(<SetupPanel native setup={setup} />);
    const npcap = requirement('Npcap');
    expect(within(npcap).getByText('Installed, cannot capture')).toBeTruthy();
    expect(within(npcap).queryByRole('button', { name: 'Get Npcap' })).toBeNull();
    expect(within(npcap).queryByText(/run (it )?as administrator/i)).toBeNull();
    fireEvent.click(within(npcap).getByRole('button', { name: 'Npcap troubleshooting' }));
    expect(setup.open).toHaveBeenCalledWith('npcap_help');
  });

  it('marks an unsupported system without offering an install', () => {
    render(<SetupPanel native setup={controller(setupStatus('unsupported'))} />);
    expect(within(requirement('Windows')).getByText('Not supported')).toBeTruthy();
    const npcap = requirement('Npcap');
    expect(within(npcap).getByText('Not supported')).toBeTruthy();
    expect(within(npcap).queryByRole('button', { name: /Get Npcap|troubleshooting/ })).toBeNull();
  });

  it('explains the GitHub CLI is optional and only for private updates', () => {
    const setup = controller(setupStatus('ready'));
    const { rerender } = render(<SetupPanel native setup={setup} />);
    const cli = requirement('GitHub CLI');
    expect(within(cli).getByText('Optional')).toBeTruthy();
    expect(within(cli).getByText(/app and its installer run without it/)).toBeTruthy();
    fireEvent.click(within(cli).getByRole('button', { name: 'Set up GitHub CLI' }));
    expect(setup.open).toHaveBeenCalledWith('github_cli');
    rerender(
      <SetupPanel native setup={controller(setupStatus('ready', { distribution: 'public' }))} />,
    );
    expect(screen.queryByText('GitHub CLI')).toBeNull();
  });

  it('drops the GitHub CLI once the updater has found the releases public', () => {
    // The setup probe ran before the first update check and still says private.
    render(<SetupPanel native setup={controller(setupStatus('ready'))} distribution="public" />);
    expect(screen.queryByText('GitHub CLI')).toBeNull();
  });

  it.each(['ready', 'missing', 'unavailable'] as const)(
    'explains what Npcap is with the driver %s, from the official pages only',
    (state) => {
      const setup = controller(setupStatus(state));
      render(<SetupPanel native setup={setup} />);
      const npcap = requirement('Npcap');
      const summary = within(npcap).getByText(/What is Npcap\?/);
      const about = summary.closest<HTMLElement>('[data-ui="disclosure"]');
      const toggle = summary.closest('button');
      if (!about || !toggle) throw new Error('No Npcap explainer');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(summary);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const body = about.textContent ?? '';
      expect(body).toContain("Nmap Project's packet capture library");
      expect(body).toContain('countersigned by Microsoft');
      expect(body).toContain('Nmap Software LLC');
      expect(body).toContain('read-only: it does not inject game packets');
      expect(body).toContain('every program on this PC');
      expect(body).toContain('Npcap is optional');
      expect(body).not.toMatch(/\bsafe\b|cannot be banned|guarantee/i);
      fireEvent.click(within(about).getByRole('button', { name: 'npcap.com' }));
      expect(setup.open).toHaveBeenLastCalledWith('npcap');
      fireEvent.click(within(about).getByRole('button', { name: "Npcap User's Guide" }));
      expect(setup.open).toHaveBeenLastCalledWith('npcap_help');
    },
  );

  it('shows a probe in progress, a failed probe and a page that would not open', async () => {
    const { rerender } = render(<SetupPanel native setup={controller(null, { checking: true })} />);
    expect(screen.getByText('Checking this PC…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Checking…' }).disabled).toBe(
      true,
    );

    rerender(<SetupPanel native setup={controller(null, { error: 'Error: probe failed' })} />);
    expect(screen.getByRole('alert').textContent).toContain('probe failed');
    expect(screen.queryByText('Checking this PC…')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check again' }).disabled).toBe(
      false,
    );

    const failing = controller(setupStatus('missing'), {
      open: vi.fn<SetupState['open']>().mockResolvedValue('Error: no browser'),
    });
    rerender(<SetupPanel native setup={failing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get Npcap' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not open the page: Error: no browser',
    );
  });

  it('needs the desktop app and probes nothing in a preview', () => {
    const setup = controller(null);
    render(<SetupPanel native={false} setup={setup} />);
    expect(screen.getByText(/Setup checks need the desktop app/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(setup.recheck).not.toHaveBeenCalled();
  });
});
