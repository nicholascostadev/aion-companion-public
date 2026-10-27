/**
 * Native live capture starts with the app, waits for the game, reconnects and retries on its
 * own; the UI never starts or stops it. This only names where it is right now.
 */
export type CaptureState = 'capturing' | 'waiting' | 'connecting' | 'error';

export function captureState(
  status: { running: boolean; phase: string } | null | undefined,
): CaptureState {
  if (!status) return 'connecting';
  if (status.phase === 'error') return 'error';
  if (!status.running) return 'connecting';
  if (status.phase === 'capturing') return 'capturing';
  if (status.phase === 'waiting_for_game') return 'waiting';
  return 'connecting';
}

export const CAPTURE_LABEL: Record<CaptureState, string> = {
  capturing: 'Capturing',
  waiting: 'Waiting for game',
  connecting: 'Connecting',
  error: 'Capture error',
};

/** What happens next, in plain words; capture needs no action from the user. */
export const CAPTURE_HINT: Record<CaptureState, string> = {
  capturing: 'Receiving game traffic.',
  waiting: 'Capture connects automatically once AION 2 is running.',
  connecting: 'Live capture starts automatically.',
  error: 'Capture retries automatically.',
};
