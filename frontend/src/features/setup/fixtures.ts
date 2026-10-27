import type { NpcapState, SetupStatus } from '../../types/setup';

/** A supported, installed private build; `npcap` picks the driver's state. */
export const setupStatus = (
  npcap: NpcapState = 'ready',
  patch: Partial<SetupStatus> = {},
): SetupStatus => ({
  platform_supported: npcap !== 'unsupported',
  webview2_ready: true,
  npcap: {
    state: npcap,
    detail:
      npcap === 'missing'
        ? 'Npcap could not load: The specified module could not be found.'
        : npcap === 'unavailable'
          ? 'Npcap could not open a supported adapter.'
          : null,
  },
  installed: true,
  distribution: 'private',
  ...patch,
});
