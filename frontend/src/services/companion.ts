import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  Recording,
  RecordingSource,
  Snapshot,
  LiveStatus,
  OverlayStatus,
  GroupStatus,
} from '../types/companion';

export const isNative = isTauri;

export function loadRecording(source: RecordingSource): Promise<Recording> {
  switch (source.kind) {
    case 'demo':
      return invoke<Recording>('demo');
    case 'import':
      return invoke<Recording>('import_recording', { json: source.json });
    case 'live':
      return source.id === undefined
        ? invoke<Recording>('load_live_recording')
        : invoke<Recording>('load_live_recording', { id: source.id });
  }
}

export const readSnapshot = (atMs: number) => invoke<Snapshot>('snapshot', { atMs });
export const saveRecording = () => invoke<string>('save_recording');
export const readLiveStatus = () => invoke<LiveStatus>('live_status');
/** Archives the current fight and starts a new one; capture keeps running. */
export const resetLive = () => invoke<LiveStatus>('live_reset');
export const configureLive = (autoEnd: boolean, partyOnly: boolean) =>
  invoke<LiveStatus>('live_configure', { autoEnd, partyOnly });
export const saveLiveComparison = () => invoke<string>('save_live_comparison');
export const readOverlayStatus = () => invoke<OverlayStatus>('overlay_status');
export const markOverlayReady = () => invoke<void>('overlay_ready');
export const markMenuReady = () => invoke<void>('menu_ready');
export const showDpsOverlay = () => invoke<OverlayStatus>('overlay_show');
export const lockDpsOverlay = (locked: boolean) =>
  invoke<OverlayStatus>('overlay_lock', { locked });
export const hideDpsOverlay = () => invoke<void>('overlay_hide');
export const openWorkspace = () => invoke<void>('overlay_workspace');
export const quitOverlay = () => invoke<void>('overlay_quit');
/** Moves the calling window with the pressed left mouse button; in-game windows move without taking focus from the game. */
export const startWindowDrag = () => getCurrentWindow().startDragging();
export const readGroupStatus = () => invoke<GroupStatus>('group_status');
export const markGroupReady = () => invoke<void>('group_ready');
export const showGroupOverlay = () => invoke<OverlayStatus>('group_show');
export const hideGroupOverlay = () => invoke<void>('group_hide');
export const markTrackersReady = () => invoke<void>('trackers_ready');
export const showTrackers = () => invoke<OverlayStatus>('trackers_show');
export const hideTrackers = () => invoke<OverlayStatus>('trackers_hide');
/** Shows damage details for one player of one fight; `reportId` null means the current fight. */
export const openDetails = (reportId: string | null, player: string) =>
  invoke<OverlayStatus>('details_open', { reportId, player });
export const hideDetails = () => invoke<void>('details_hide');
export const markDetailsReady = () => invoke<void>('details_ready');
/**
 * Controls and rows that stay clickable while the DPS meter is locked: `[x, y, width, height]`
 * in physical client pixels at device pixel ratio `scale`. An empty list clears them.
 */
export const setRowRegions = (regions: [number, number, number, number][], scale: number) =>
  invoke<number>('overlay_hit_regions', { regions, scale });
/** Arrange mode makes the in-game tracker surface interactive until turned off. */
export const arrangeTrackers = (editing: boolean) =>
  invoke<OverlayStatus>('trackers_arrange', { editing });
