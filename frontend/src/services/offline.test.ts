import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import {
  configureOffline,
  deleteLogs,
  exportLog,
  inspectReport,
  importCatalogue,
  listLogs,
  readLog,
  copyTextNative,
  readOfflineLiveStatus,
  readOfflineStatus,
  readSummary,
  renameLog,
  runOfflineAction,
  saveTrackerPositions,
} from './offline';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));
afterEach(() => vi.resetAllMocks());

describe('offline native contract', () => {
  it('maps every command and argument name', async () => {
    vi.mocked(invoke).mockResolvedValue({});
    await readOfflineStatus();
    expect(invoke).toHaveBeenLastCalledWith('offline_status');
    await readOfflineLiveStatus();
    expect(invoke).toHaveBeenLastCalledWith('offline_live_status');
    vi.mocked(invoke).mockResolvedValue(SETTINGS_FALLBACK);
    await configureOffline(SETTINGS_FALLBACK);
    expect(invoke).toHaveBeenLastCalledWith('offline_configure', { settings: SETTINGS_FALLBACK });
    vi.mocked(invoke).mockResolvedValue({ id: 'fight-1' });
    await readLog('fight-1');
    expect(invoke).toHaveBeenLastCalledWith('offline_log', { id: 'fight-1', bossOnly: false });
    await readLog('fight-1', true);
    expect(invoke).toHaveBeenLastCalledWith('offline_log', { id: 'fight-1', bossOnly: true });
    expect((await inspectReport('fight-1')).id).toBe('fight-1');
    expect(invoke).toHaveBeenLastCalledWith('offline_inspect', { id: 'fight-1', bossOnly: false });
    await inspectReport('fight-1', true);
    expect(invoke).toHaveBeenLastCalledWith('offline_inspect', { id: 'fight-1', bossOnly: true });
    await renameLog('fight-1', 'Boss');
    expect(invoke).toHaveBeenLastCalledWith('offline_log_rename', { id: 'fight-1', label: 'Boss' });
    vi.mocked(invoke).mockResolvedValue(2);
    expect(await deleteLogs(['fight-1', 'fight-2'])).toBe(2);
    expect(invoke).toHaveBeenLastCalledWith('offline_log_delete', { ids: ['fight-1', 'fight-2'] });
    vi.mocked(invoke).mockResolvedValue('C:/exports/fight-1.json');
    await exportLog('fight-1');
    expect(invoke).toHaveBeenLastCalledWith('offline_export', { id: 'fight-1' });
    vi.mocked(invoke).mockResolvedValue({ skills: 3, npcs: 1 });
    expect(await importCatalogue('{}')).toEqual({ skills: 3, npcs: 1 });
    expect(invoke).toHaveBeenLastCalledWith('offline_catalogue_import', { json: '{}' });
    vi.mocked(invoke).mockResolvedValue('1. Aria');
    await readSummary(null, true);
    expect(invoke).toHaveBeenLastCalledWith('offline_summary', { id: null, multiline: true });
    vi.mocked(invoke).mockResolvedValue(undefined);
    await copyTextNative('Damage dealt · 0:10');
    expect(invoke).toHaveBeenLastCalledWith('offline_copy_text', { text: 'Damage dealt · 0:10' });
    vi.mocked(invoke).mockResolvedValue({});
    await runOfflineAction('open_data_folder');
    expect(invoke).toHaveBeenLastCalledWith('offline_action', {
      action: 'open_data_folder',
      summary: true,
    });
    await runOfflineAction('save', 'full');
    expect(invoke).toHaveBeenLastCalledWith('offline_action', { action: 'save', summary: false });
    vi.mocked(invoke).mockResolvedValue(SETTINGS_FALLBACK);
    await saveTrackerPositions('p1', [{ bar_id: 'b1', x: 10, y: 20 }]);
    expect(invoke).toHaveBeenLastCalledWith('offline_positions', {
      presetId: 'p1',
      positions: [{ bar_id: 'b1', x: 10, y: 20 }],
    });
  });

  it('sends only the filters the user set', async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listLogs({ search: '', boss: 'Tiamat', sort: 'dps', limit: 51, offset: 0 });
    expect(invoke).toHaveBeenLastCalledWith('offline_logs', {
      query: { boss: 'Tiamat', sort: 'dps', limit: 51, offset: 0 },
    });
  });

  it('rejects a missing log instead of rendering an empty one', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(readLog('fight-9')).rejects.toThrow(/no log/);
  });
});
