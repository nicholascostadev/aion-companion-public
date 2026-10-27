import type { NpcapState, SetupStatus } from '../../types/setup';

/** Why live capture cannot run on this PC, from the latest probe. */
export type CaptureIssue = Exclude<NpcapState, 'ready'>;

/** The capture problem worth telling the user about, or null when the driver works. */
export function captureIssue(status: SetupStatus | null): CaptureIssue | null {
  if (!status) return null;
  if (!status.platform_supported) return 'unsupported';
  return status.npcap.state === 'ready' ? null : status.npcap.state;
}

/** The Setup surface in Settings, which Home's setup band scrolls to and focuses. */
export const SETUP_SECTION_ID = 'app-setup';
