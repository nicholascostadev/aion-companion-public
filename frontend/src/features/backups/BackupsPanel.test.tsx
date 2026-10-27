import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import {
  DEFAULT_BACKUP_OPTIONS,
  type BackupPreview,
  type BackupStatus,
  type BackupsState,
} from '../../types/backups';
import { BackupsPanel } from './BackupsPanel';

afterEach(cleanup);

const MIB = 1024 * 1024;
const status = (patch: Partial<BackupStatus> = {}): BackupStatus => ({
  channel: 'stable',
  limits: { archive_bytes: 128 * MIB, total_bytes: 64 * MIB, file_bytes: 32 * MIB, files: 1000 },
  pending_restore: false,
  last_recovery: null,
  ...patch,
});

const preview: BackupPreview = {
  token: 'tok-1',
  created_ms: Date.UTC(2026, 9, 17, 18, 30),
  app_version: '0.7.9',
  channel: 'stable',
  files: [
    { path: 'offline/settings.json', bytes: 6 * 1024, will_replace: true },
    { path: 'offline/pets.json', bytes: 40 * 1024, will_replace: true },
    { path: 'offline/logs/17.json', bytes: 50 * 1024, will_replace: false },
  ],
  total_bytes: 96 * 1024,
};

const state = (patch: Partial<BackupsState> = {}): BackupsState => ({
  status: status(),
  statusError: '',
  options: DEFAULT_BACKUP_OPTIONS,
  setOption: vi.fn<BackupsState['setOption']>(),
  plan: {
    files: [
      { path: 'offline/settings.json', bytes: 6 * 1024 },
      { path: 'offline/pets.json', bytes: 40 * 1024 },
    ],
    total_bytes: 46 * 1024,
  },
  planning: false,
  planError: '',
  pending: null,
  exported: null,
  preview: null,
  restore: null,
  exportBackup: vi.fn<BackupsState['exportBackup']>().mockResolvedValue(),
  choosePreview: vi.fn<BackupsState['choosePreview']>().mockResolvedValue(),
  applyRestore: vi.fn<BackupsState['applyRestore']>().mockResolvedValue(),
  discardPreview: vi.fn<BackupsState['discardPreview']>().mockResolvedValue(),
  dismissExport: vi.fn<BackupsState['dismissExport']>(),
  dismissRestore: vi.fn<BackupsState['dismissRestore']>(),
  ...patch,
});

const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });

describe('backups panel', () => {
  it('needs the desktop app and says so', () => {
    render(<BackupsPanel native={false} backups={state({ status: null, plan: null })} />);
    expect(screen.getByText(/Backups need the desktop app/)).toBeTruthy();
    expect(button(/Back up/).disabled).toBe(true);
    expect(button(/Choose backup file/).disabled).toBe(true);
  });

  it('shows the estimate and limits before a backup, and what is left out', () => {
    const backups = state();
    render(<BackupsPanel native backups={backups} />);
    expect(screen.getByText('About 46 kB in 2 files')).toBeTruthy();
    expect(screen.getByText(/up to 1,000 files and 64 MB in all, 32 MB per file/)).toBeTruthy();
    expect(screen.getByText(/not a copy of the whole app folder/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Saved logs/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Saved logs/ }));
    expect(backups.setOption).toHaveBeenCalledWith('logs', true);
    fireEvent.click(button(/Back up/));
    expect(backups.exportBackup).toHaveBeenCalledTimes(1);
  });

  it('holds a backup that is larger than native allows', () => {
    render(
      <BackupsPanel
        native
        backups={state({
          options: { ...DEFAULT_BACKUP_OPTIONS, logs: true },
          plan: {
            files: [{ path: 'offline/logs/1.json', bytes: 70 * MIB }],
            total_bytes: 70 * MIB,
          },
        })}
      />,
    );
    expect(screen.getByText(/more than the 64 MB one backup holds/)).toBeTruthy();
    expect(button(/Back up/).disabled).toBe(true);
  });

  it('asks for at least one part', () => {
    render(
      <BackupsPanel
        native
        backups={state({
          options: { settings: false, pets: false, logs: false },
          plan: { files: [], total_bytes: 0 },
        })}
      />,
    );
    expect(screen.getByText('Choose at least one part to back up.')).toBeTruthy();
    expect(button(/Back up/).disabled).toBe(true);
  });

  it('locks every step while one is running', () => {
    render(<BackupsPanel native backups={state({ pending: 'export' })} />);
    expect(button(/Saving backup/).disabled).toBe(true);
    expect(button(/Choose backup file/).disabled).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Settings/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('reports a saved, cancelled or failed backup', () => {
    const { rerender } = render(
      <BackupsPanel
        native
        backups={state({
          exported: {
            kind: 'saved',
            result: {
              path: 'D:\\Backups\\mine.aion-backup.json',
              files: 3,
              total_bytes: 1,
              archive_bytes: 52 * 1024,
            },
          },
        })}
      />,
    );
    expect(screen.getByText('Backup saved: 3 files, 52 kB in all.')).toBeTruthy();
    expect(screen.getByText('D:\\Backups\\mine.aion-backup.json')).toBeTruthy();
    rerender(<BackupsPanel native backups={state({ exported: { kind: 'cancelled' } })} />);
    expect(screen.getByText('Backup cancelled. No file was written.')).toBeTruthy();
    rerender(
      <BackupsPanel
        native
        backups={state({ exported: { kind: 'failed', error: 'Disk full.' } })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Disk full.');
  });

  it('chooses a file without restoring it', () => {
    const backups = state();
    render(<BackupsPanel native backups={backups} />);
    fireEvent.click(button(/Choose backup file/));
    expect(backups.choosePreview).toHaveBeenCalledTimes(1);
    expect(backups.applyRestore).not.toHaveBeenCalled();
  });

  it('says a cancelled choice changed nothing, without an error', () => {
    render(<BackupsPanel native backups={state({ restore: { kind: 'cancelled' } })} />);
    expect(screen.getByText('No file chosen. Nothing was changed.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('previews what is replaced and added, then restores only after confirming', () => {
    const backups = state({ preview });
    render(<BackupsPanel native backups={backups} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText('v0.7.9')).toBeTruthy();
    expect(within(card).getAllByText('Replaces')).toHaveLength(2);
    expect(within(card).getAllByText('Adds')).toHaveLength(1);
    expect(within(card).getByText(/anything saved to it since/)).toBeTruthy();
    expect(within(card).getByText(/stays as it is/)).toBeTruthy();

    fireEvent.click(button(/Restore and restart/));
    expect(backups.applyRestore).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button(/Keep current data/));
    fireEvent.keyDown(button(/Keep current data/), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Apply and restart/ })).toBeNull();

    fireEvent.click(button(/Restore and restart/));
    expect(screen.getByRole('group', { name: /Restore this backup and restart/ })).toBeTruthy();
    fireEvent.click(button(/Apply and restart/));
    expect(backups.applyRestore).toHaveBeenCalledWith('tok-1');
  });

  it('holds Apply while settings changes are unsaved', () => {
    render(<BackupsPanel native backups={state({ preview })} restartBlocked />);
    fireEvent.click(button(/Restore and restart/));
    expect(button(/Apply and restart/).disabled).toBe(true);
    expect(screen.getByText(/Save or discard your settings changes first/)).toBeTruthy();
  });

  it('discards a preview on request', () => {
    const backups = state({ preview });
    render(<BackupsPanel native backups={backups} />);
    fireEvent.click(button(/Discard/));
    expect(backups.discardPreview).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a refused file from a restore that did not start', () => {
    const { rerender } = render(
      <BackupsPanel
        native
        backups={state({
          restore: { kind: 'failed', step: 'preview', error: 'Checksum mismatch.' },
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be restored: Checksum mismatch/);
    rerender(
      <BackupsPanel
        native
        backups={state({ restore: { kind: 'failed', step: 'restore', error: 'Expired.' } })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /not started: Expired\..*Choose the file again/,
    );
  });

  it('shows a staged restore and locks everything', () => {
    render(
      <BackupsPanel
        native
        backups={state({
          preview,
          restore: { kind: 'staged' },
          status: status({ pending_restore: true }),
        })}
      />,
    );
    expect(screen.getByText(/The app is closing and opens again/)).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: /Choose/ })).toBeNull();
    expect(button(/Back up/).disabled).toBe(true);
  });

  it.each([
    ['restored', /was restored when the app started/],
    ['rolled_back', /could not finish, so the files it was replacing were put back/],
    ['failed', /could not be applied/],
  ])('words the last %s recovery and folds native detail away', (phase, words) => {
    render(
      <BackupsPanel
        native
        backups={state({
          status: status({ last_recovery: { phase, message: 'Raw native detail' } }),
        })}
      />,
    );
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Technical details' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByText('Raw native detail').closest('[hidden]')).not.toBeNull();
  });

  it('shows nothing for a recovery phase it does not know', () => {
    render(
      <BackupsPanel
        native
        backups={state({ status: status({ last_recovery: { phase: 'mystery', message: 'x' } }) })}
      />,
    );
    expect(screen.queryByText('Technical details')).toBeNull();
  });

  it('speaks Portuguese (Brazil)', () => {
    render(
      <TranslationProvider i18n={createTestI18n('pt-BR')}>
        <BackupsPanel native backups={state({ preview })} />
      </TranslationProvider>,
    );
    expect(screen.getByText('Cerca de 46 kB em 2 arquivos')).toBeTruthy();
    expect(button(/Restaurar e reiniciar/)).toBeTruthy();
    expect(screen.getAllByText('Substitui')).toHaveLength(2);
  });
});
