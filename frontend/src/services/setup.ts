import { invoke } from '@tauri-apps/api/core';
import type { NpcapState, SetupLink, SetupStatus } from '../types/setup';

/*
 * What this PC needs to run the app and capture live. Native probes the Npcap driver and a
 * supported adapter without reading traffic, and opens only a fixed set of official pages
 * in the browser; this side never builds or opens a URL itself.
 */

const NPCAP_STATES: readonly NpcapState[] = ['ready', 'missing', 'unavailable', 'unsupported'];

export const SETUP_LINKS: readonly SetupLink[] = [
  'npcap',
  'npcap_help',
  'webview2',
  'github_cli',
  'releases',
  'repository',
  'github_invitations',
];

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

export function normalizeSetupStatus(value: unknown): SetupStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Native returned no setup status');
  const raw = value as Record<string, unknown>;
  const npcap = (raw.npcap && typeof raw.npcap === 'object' ? raw.npcap : {}) as Record<
    string,
    unknown
  >;
  if (!NPCAP_STATES.includes(npcap.state as NpcapState))
    throw new Error('Native returned no Npcap state');
  return {
    platform_supported: raw.platform_supported === true,
    // Only an explicit false says otherwise: a running window is drawn by WebView2.
    webview2_ready: raw.webview2_ready !== false,
    npcap: { state: npcap.state as NpcapState, detail: text(npcap.detail) },
    installed: raw.installed === true,
    distribution: raw.distribution === 'public' ? 'public' : 'private',
  };
}

/** Probes the driver and an adapter; this can take a few seconds. */
export const readSetupStatus = (): Promise<SetupStatus> =>
  invoke<unknown>('setup_status').then(normalizeSetupStatus);

/** Opens one of the fixed official pages in the default browser. */
export function openSetupLink(link: SetupLink): Promise<void> {
  if (!SETUP_LINKS.includes(link)) return Promise.reject(new Error(`Unknown link "${link}"`));
  return invoke<unknown>('setup_open_link', { link }).then(() => undefined);
}
