import { invoke, type isTauri } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRecording,
  readSnapshot,
  saveRecording,
  readLiveStatus,
  resetLive,
  configureLive,
  saveLiveComparison,
  showDpsOverlay,
  lockDpsOverlay,
  hideDpsOverlay,
  markMenuReady,
  markOverlayReady,
  readOverlayStatus,
  openDetails,
  hideDetails,
  markDetailsReady,
  setRowRegions,
} from './companion';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<typeof invoke>(),
  isTauri: vi.fn<typeof isTauri>(),
}));
afterEach(() => vi.resetAllMocks());

describe('Tauri service contract', () => {
  it('maps overlay controls to native window commands', async () => {
    await showDpsOverlay();
    expect(invoke).toHaveBeenLastCalledWith('overlay_show');
    await lockDpsOverlay(false);
    expect(invoke).toHaveBeenLastCalledWith('overlay_lock', { locked: false });
    await hideDpsOverlay();
    expect(invoke).toHaveBeenLastCalledWith('overlay_hide');
    await readOverlayStatus();
    expect(invoke).toHaveBeenLastCalledWith('overlay_status');
  });
  it('reports readiness separately for the DPS meter and top menu windows', async () => {
    await markOverlayReady();
    expect(invoke).toHaveBeenLastCalledWith('overlay_ready');
    await markMenuReady();
    expect(invoke).toHaveBeenLastCalledWith('menu_ready');
  });
  it('maps damage details and locked-row regions to native commands', async () => {
    await openDetails('fight-1', '42');
    expect(invoke).toHaveBeenLastCalledWith('details_open', { reportId: 'fight-1', player: '42' });
    await openDetails(null, '42');
    expect(invoke).toHaveBeenLastCalledWith('details_open', { reportId: null, player: '42' });
    await hideDetails();
    expect(invoke).toHaveBeenLastCalledWith('details_hide');
    await markDetailsReady();
    expect(invoke).toHaveBeenLastCalledWith('details_ready');
    await setRowRegions([[10, 20, 300, 27]], 1.5);
    expect(invoke).toHaveBeenLastCalledWith('overlay_hit_regions', {
      regions: [[10, 20, 300, 27]],
      scale: 1.5,
    });
  });
  it('maps recording sources to native commands', async () => {
    await loadRecording({ kind: 'demo' });
    expect(invoke).toHaveBeenLastCalledWith('demo');
    await loadRecording({ kind: 'import', json: '{}' });
    expect(invoke).toHaveBeenLastCalledWith('import_recording', { json: '{}' });
    await loadRecording({ kind: 'live' });
    expect(invoke).toHaveBeenLastCalledWith('load_live_recording');
    await loadRecording({ kind: 'live', id: 3 });
    expect(invoke).toHaveBeenLastCalledWith('load_live_recording', { id: 3 });
  });

  it('maps background capture status, fight and report commands; capture has no start or stop', async () => {
    await readLiveStatus();
    expect(invoke).toHaveBeenLastCalledWith('live_status');
    await resetLive();
    expect(invoke).toHaveBeenLastCalledWith('live_reset');
    await configureLive(true, true);
    expect(invoke).toHaveBeenLastCalledWith('live_configure', { autoEnd: true, partyOnly: true });
    await saveLiveComparison();
    expect(invoke).toHaveBeenLastCalledWith('save_live_comparison');
  });

  it('maps snapshots and recording saves to native commands', async () => {
    await readSnapshot(500);
    expect(invoke).toHaveBeenLastCalledWith('snapshot', { atMs: 500 });
    await saveRecording();
    expect(invoke).toHaveBeenLastCalledWith('save_recording');
  });
});
