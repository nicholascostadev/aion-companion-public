import type { ComponentType } from 'react';

/**
 * Every window loads `index.html` with `?view=`; each view is its own chunk, so an in-game
 * window parses only its own code (the menu, popup and timers never load the workspace,
 * the reports or the art manifests).
 */
export const VIEWS = {
  workspace: () => import('./App'),
  overlay: () => import('./OverlayApp'),
  menu: () => import('./MenuApp'),
  group: () => import('./GroupApp'),
  trackers: () => import('./TrackerApp'),
  details: () => import('./DetailsApp'),
  'alert-popup': () => import('./AlertPopupApp'),
  'pet-radar': () => import('./PetRadarApp'),
  timers: () => import('./TimersApp'),
  explore: () => import('./ExploreApp'),
} satisfies Record<string, () => Promise<{ default: ComponentType }>>;

export type View = keyof typeof VIEWS;

const isView = (value: string | null): value is View =>
  value !== null && Object.hasOwn(VIEWS, value);

/**
 * Earlier names of a view, still opened by old links and launches: the separate cube and
 * gathering windows (and the Maps name) are the one Explore window now.
 */
const VIEW_ALIASES: Readonly<Record<string, View>> = {
  cubes: 'explore',
  gathering: 'explore',
  maps: 'explore',
  finder: 'explore',
};

/** The view named by `?view=` (or an earlier name of it); anything else is the workspace. */
export function resolveView(search: string): View {
  const requested = new URLSearchParams(search).get('view');
  if (isView(requested)) return requested;
  return (
    (requested && Object.hasOwn(VIEW_ALIASES, requested) && VIEW_ALIASES[requested]) || 'workspace'
  );
}

/** In-game windows float over the game: their surfaces are glass and the page has no ground. */
export const surfaceOf = (view: View) => (view === 'workspace' ? 'solid' : 'glass');
