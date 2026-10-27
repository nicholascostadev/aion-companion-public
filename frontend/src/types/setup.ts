/**
 * What live capture's driver looks like on this PC. `missing`: Npcap is not installed;
 * `unavailable`: it is installed but no supported adapter could be opened (a restricted
 * driver, a stopped service); `unsupported`: live capture cannot run on this system at all.
 */
export type NpcapState = 'ready' | 'missing' | 'unavailable' | 'unsupported';

/** Where releases come from: the private repository (GitHub CLI sign-in) or public releases. */
export type SetupDistribution = 'private' | 'public';

/** The fixed official pages native can open in the browser; there is no other URL opener. */
export type SetupLink =
  | 'npcap'
  | 'npcap_help'
  | 'webview2'
  | 'github_cli'
  | 'releases'
  | 'repository'
  | 'github_invitations';

/** `setup_status`: probes the driver and a supported adapter, never reads a packet. */
export interface SetupStatus {
  platform_supported: boolean;
  /** The desktop UI is running, so this is true whenever it can be read. */
  webview2_ready: boolean;
  npcap: { state: NpcapState; detail: string | null };
  /** Running from the managed installation rather than a portable copy. */
  installed: boolean;
  distribution: SetupDistribution;
}

/** What the setup surfaces need from `useSetup`. */
export interface SetupState {
  status: SetupStatus | null;
  /** `setup_status` could not be read. */
  error: string;
  /** A probe is running: the first read or Check again. */
  checking: boolean;
  /** Probes again; a request while one runs joins it. */
  recheck: () => Promise<void>;
  /** Opens an official page in the browser; resolves to why it failed, or '' once open. */
  open: (link: SetupLink) => Promise<string>;
}
