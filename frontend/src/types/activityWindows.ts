export type ActivityWindowKind = 'timers' | 'explore';

export interface ActivityWindowStatus {
  requested: boolean;
  visible: boolean;
  ready: boolean;
  locked: boolean;
  game_active: boolean;
  errors: string[];
}

/** Read by workspace and toolbar controls; native remains the source of visibility. */
export interface ActivityWindowToggle {
  requested: boolean;
  visible: boolean;
  known: boolean;
  busy: boolean;
  onToggle: () => void;
}

export const ACTIVITY_NATIVE_LABELS = {
  timers: 'timers-overlay',
  explore: 'explore-overlay',
} as const;

export const INITIAL_ACTIVITY_WINDOW: ActivityWindowStatus = {
  requested: false,
  visible: false,
  ready: false,
  locked: false,
  game_active: false,
  errors: [],
};
