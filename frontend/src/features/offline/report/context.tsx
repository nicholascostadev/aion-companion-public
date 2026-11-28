import { createContext, useContext } from 'react';
import type { Translate } from '../../../i18n/provider';
import type { CombatReport, DpsMode, ReportPlayer } from '../../../types/offline';
import type { OpenProfile } from '../../live/ProfileLink';
import type { Names, TimeWindow } from '../analysis';

/** The three places of a report. */
export type ReportTab = 'details' | 'rotation' | 'timeline';

/**
 * The views a report had before it was three places. They are still accepted wherever a
 * destination is named (an opening view, a link from another view), and each leads to where
 * its content lives now.
 */
export type LegacyReportView =
  | 'damage'
  | 'healing'
  | 'taken'
  | 'deaths'
  | 'highlights'
  | 'skills'
  | 'buffs';

/** A destination inside a report: one of its places, or an earlier view's name. */
export type ReportRoute = ReportTab | LegacyReportView;

/** What Combat details break down for the selected player. */
export type DetailKind = 'damage' | 'heal' | 'taken';

/** What Combat details show beyond the selected player's rows. */
export interface DetailsState {
  kind: DetailKind;
  /** The party's figures for the chosen kind, one row per player. */
  party: boolean;
  /** Every highlight with its runners-up, under the key moments. */
  highlights: boolean;
  /** The buff analysis dialog. */
  buffs: boolean;
}

export const DEFAULT_DETAILS: DetailsState = {
  kind: 'damage',
  party: false,
  highlights: false,
  buffs: false,
};

export interface Destination {
  tab: ReportTab;
  /** Changes to Combat details that bring the named content into view. */
  details?: Partial<DetailsState>;
  /** The death recaps of the timeline are wanted. */
  deaths?: true;
}

const DESTINATIONS: Record<ReportRoute, Destination> = {
  details: { tab: 'details' },
  rotation: { tab: 'rotation' },
  timeline: { tab: 'timeline' },
  // The skill rows are what Combat details open on.
  skills: { tab: 'details' },
  // The party tables unfold beside the breakdown they compare.
  damage: { tab: 'details', details: { kind: 'damage', party: true } },
  healing: { tab: 'details', details: { kind: 'heal', party: true } },
  taken: { tab: 'details', details: { kind: 'taken', party: true } },
  highlights: { tab: 'details', details: { highlights: true } },
  buffs: { tab: 'details', details: { buffs: true } },
  // Death recaps hang on the timeline they happened on.
  deaths: { tab: 'timeline', deaths: true },
};

/** Where a destination lives; a name this build does not know opens Combat details. */
export function resolveRoute(route: string): Destination {
  return Object.hasOwn(DESTINATIONS, route)
    ? DESTINATIONS[route as ReportRoute]
    : DESTINATIONS.details;
}

export interface ReportCtx {
  report: CombatReport;
  names: Names;
  mode: DpsMode;
  hideNames: boolean;
  /** Players ranked by damage. */
  players: ReportPlayer[];
  player: ReportPlayer | null;
  setPlayer: (id: string) => void;
  window: TimeWindow;
  setWindow: (window: TimeWindow) => void;
  total: number;
  /** What Combat details show; it outlives a visit to another place of the report. */
  details: DetailsState;
  setDetails: (patch: Partial<DetailsState>) => void;
  /**
   * Goes to a place of the report, or to where an earlier view's content lives now,
   * optionally focusing a moment in the fight and choosing a player.
   */
  goTo: (route: ReportRoute, atMs?: number, player?: string) => void;
  /** Coverage flag: true observed, false not observed, null unknown. */
  observed: (family: string) => boolean | null;
  /** The player's class mark colour, neutral when hidden (see lib/classColors.ts). */
  colorOf: (player: Pick<ReportPlayer, 'class' | 'local'>) => string;
  /** Opens a character in the in-game profile window; undefined (no links) while names are hidden. */
  onOpenProfile?: OpenProfile | undefined;
}

const Context = createContext<ReportCtx | null>(null);
export const ReportProvider = Context.Provider;

export function useReport() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useReport outside ReportView');
  return ctx;
}

/** Coverage families native reports → their message keys. */
const COVERAGE_KEYS = {
  damage: 'damage',
  healing: 'healing',
  casts: 'casts',
  buffs: 'buffs',
  hp: 'hp',
  deaths: 'deaths',
  hit_flags: 'hitFlags',
  positions: 'positions',
} as const;

/** A coverage family's readable name; an unknown family keeps its wire name. */
export function coverageLabel(t: Translate<'reports'>, family: string) {
  const id = Object.hasOwn(COVERAGE_KEYS, family)
    ? COVERAGE_KEYS[family as keyof typeof COVERAGE_KEYS]
    : null;
  return id ? t(($) => $.coverage[id]) : family;
}

const END_REASON_KEYS = {
  idle: 'idle',
  kill: 'kill',
  clear: 'clear',
  reset: 'reset',
  wipe: 'wipe',
  despawn: 'despawn',
  dungeon_change: 'dungeonChange',
  zone_change: 'zoneChange',
  boss_pull: 'bossPull',
  dummy_cap: 'dummyCap',
  manual: 'manual',
  stopped: 'stopped',
  recovered: 'recovered',
  event_limit: 'eventLimit',
} as const;

/** Why a fight ended, worded; an unknown reason keeps its wire value. */
export function endReason(t: Translate<'reports'>, reason: string | null) {
  if (reason === null) return t(($) => $.endReason.inProgress);
  const id = Object.hasOwn(END_REASON_KEYS, reason)
    ? END_REASON_KEYS[reason as keyof typeof END_REASON_KEYS]
    : null;
  return id ? t(($) => $.endReason[id]) : reason;
}
