import { useCallback, useState } from 'react';
import type { ShugoProfile } from '../lib/shugo';
import { isNative } from '../services/companion';
import {
  hideProfileWindow,
  markProfileWindowReady,
  openProfileWindow,
  readProfileWindowStatus,
} from '../services/profile';
import { INITIAL_PROFILE_WINDOW } from '../types/profile';
import { useNativeState } from './useNativeState';

/**
 * The profile window's own controller: native owns the selection, visibility and privacy
 * suppression, so the page shows whichever character was opened last from any window.
 */
export function useProfileWindow() {
  const native = isNative();
  const { state, known, error, act, refresh } = useNativeState(native, readProfileWindowStatus, {
    initial: INITIAL_PROFILE_WINDOW,
    intervalMs: 500,
    refreshAfterError: true,
    markReady: markProfileWindowReady,
  });
  const hide = useCallback(() => act(hideProfileWindow), [act]);
  /** Runs a native action that answers with the window status (save, open a saved one). */
  return { native, status: state, known, error, hide, refresh, act };
}

/**
 * Opens the in-game profile window from any other window (meter, workspace, reports,
 * damage details). Undefined outside the native app, so no entry point shows there.
 */
export function useOpenProfile() {
  const [error, setError] = useState('');
  const open = useCallback(
    (profile: ShugoProfile) =>
      void openProfileWindow(profile).then(
        () => setError(''),
        (cause: unknown) => setError(String(cause)),
      ),
    [],
  );
  return { open: isNative() ? open : undefined, error, clearError: () => setError('') };
}
