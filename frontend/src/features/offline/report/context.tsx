import { createContext, useContext } from 'react';
import type { Translate } from '../../../i18n/provider';
import type { CombatReport, DpsMode, ReportPlayer } from '../../../types/offline';
import type { Names, TimeWindow } from '../analysis';

export type ReportTab =
  | 'damage'
  | 'healing'
  | 'taken'
  | 'deaths'
  | 'highlights'
  | 'skills'
  | 'rotation'
  | 'buffs'
  | 'timeline';

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
  /** Switches view, optionally focusing a moment in the fight. */
  goTo: (tab: ReportTab, atMs?: number, player?: string) => void;
  /** Coverage flag: true observed, false not observed, null unknown. */
  observed: (family: string) => boolean | null;
  /** The player's class mark colour, neutral when hidden (see lib/classColors.ts). */
  colorOf: (player: Pick<ReportPlayer, 'class' | 'local'>) => string;
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
  reset: 'reset',
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
