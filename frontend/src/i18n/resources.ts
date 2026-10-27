import type { View } from '../app/views';

/**
 * Message namespaces, one per feature. English (`locales/en`) defines every message;
 * `locales/pt-BR` implements the same keys. `native` is read by the desktop shell (tray,
 * window titles, copied summaries) and is never loaded by a window.
 */
export const NAMESPACES = [
  'common',
  'workspace',
  'home',
  'menu',
  'settings',
  'live',
  'reports',
  'recordings',
  'trackers',
  'group',
  'pets',
  'alerts',
  'timers',
  'cubes',
  'gathering',
  'maps',
  'diagnostics',
  'updates',
  'backups',
  'setup',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

type Messages = Record<string, unknown>;

// Packaged with the app: each catalog is its own small chunk, loaded only when a view needs it.
const loaders = import.meta.glob<Messages>(['./locales/*/*.json', '!./locales/*/native.json'], {
  import: 'default',
});

export const hasCatalog = (locale: string, ns: string) =>
  `./locales/${locale}/${ns}.json` in loaders;

/** One catalog; rejects for a namespace or locale that has none. */
export function loadCatalog(locale: string, ns: string): Promise<Messages> {
  const load = loaders[`./locales/${locale}/${ns}.json`];
  return load ? load() : Promise.reject(new Error(`No ${locale} catalog for "${ns}"`));
}

/**
 * Namespaces each window draws, preloaded in both languages before its first render so a
 * language change swaps text without waiting. A component that needs another namespace
 * still gets it (loaded on demand); the in-game windows never load the workspace's catalogs.
 */
export const VIEW_NAMESPACES: Record<View, readonly Namespace[]> = {
  workspace: NAMESPACES,
  overlay: ['common', 'live', 'reports', 'alerts'],
  menu: ['common', 'menu', 'alerts'],
  group: ['common', 'group'],
  trackers: ['common', 'trackers'],
  details: ['common', 'live', 'reports'],
  'alert-popup': ['common', 'alerts'],
  'pet-radar': ['common', 'pets'],
  timers: ['common', 'timers'],
  explore: ['common', 'maps', 'cubes', 'gathering'],
};
