import { useCallback } from 'react';
import { dpsRequested, groupEnabled } from '../lib/overlayState';
import {
  hideDpsOverlay,
  hideGroupOverlay,
  isNative,
  lockDpsOverlay,
  markMenuReady,
  markOverlayReady,
  openWorkspace,
  quitOverlay,
  readOverlayStatus,
  showDpsOverlay,
  showGroupOverlay,
  showTrackers,
  hideTrackers,
  arrangeTrackers,
} from '../services/companion';
import type { OverlayStatus } from '../types/companion';
import { useNativeState } from './useNativeState';

const initialOverlay: OverlayStatus = {
  locked: false,
  ready: false,
  visible: false,
  can_lock: false,
  saved_path: '',
  errors: [],
};

interface Options {
  /** Reported once on mount; identifies which window is ready. */
  markReady?: () => Promise<void>;
  /** Also receives action failures, e.g. to surface them in a page status. */
  onError?: (message: string) => void;
  /** Stop polling (e.g. a minimised workspace), keeping the last state. */
  paused?: boolean;
}

/**
 * Polls the native DPS panel state and exposes guarded window actions. `overlay.visible`
 * always reflects the backend, so hotkey, tray and failed actions are picked up.
 */
export function useOverlayControls({ markReady, onError, paused = false }: Options = {}) {
  const native = isNative();
  const { state, known, busy, error, latest, act } = useNativeState(native, readOverlayStatus, {
    initial: initialOverlay,
    intervalMs: 500,
    paused,
    refreshAfterError: true,
    markReady,
    onActionError: onError,
  });

  const show = useCallback(() => act(showDpsOverlay), [act]);
  const hide = useCallback(
    () =>
      act(async () => {
        await hideDpsOverlay();
        return readOverlayStatus();
      }),
    [act],
  );

  return {
    native,
    overlay: state,
    known,
    busy,
    error,
    show,
    hide,
    toggle: () => (dpsRequested(latest.current) ? hide() : show()),
    toggleGroup: () =>
      act(async () => {
        if (groupEnabled(latest.current)) {
          await hideGroupOverlay();
          return readOverlayStatus();
        }
        return showGroupOverlay();
      }),
    toggleTrackers: () =>
      act(() => (latest.current.trackers_requested ? hideTrackers() : showTrackers())),
    arrangeTrackers: (editing: boolean) => act(() => arrangeTrackers(editing)),
    lock: (locked = true) => act(() => lockDpsOverlay(locked)),
    workspace: () =>
      act(async () => {
        await openWorkspace();
        return null;
      }),
    quit: () =>
      act(async () => {
        await quitOverlay();
        return null;
      }),
  };
}

/** DPS panel window: reports `overlay_ready`. */
export function useOverlay() {
  return useOverlayControls({ markReady: markOverlayReady });
}

/** Top menu window: reports `menu_ready`, never `overlay_ready`. */
export function useMenuControls() {
  return useOverlayControls({ markReady: markMenuReady });
}
