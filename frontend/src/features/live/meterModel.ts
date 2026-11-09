import { clock, type Formatters } from '../../i18n/formatters';
import type { Translate } from '../../i18n/provider';
import { playerRows, type PlayerRow } from '../../lib/playerRow';
import type {
  DamageAccuracy,
  DpsMode,
  HitAccuracy,
  ReportPlayer,
  ReportSkill,
  ReportTotals,
} from '../../types/offline';
import { key } from '../offline/analysis';
import { liveWords } from './playerName';

/** One skill of the focused player, damage dealt only. */
export interface MeterSkill {
  id: string;
  /** Native numeric skill id, for its artwork. */
  skillId: string;
  name: string;
  damage: number;
  /** Share of the player's damage, 0..1. */
  share: number;
  /** Damage events; a multi-hit counts once. Null when not observed. */
  hits: number | null;
  /** Critical rate over hits with a decoded crit flag; null when none were decoded. */
  critRate: number | null;
}

/** A player's row on the meter: their `PlayerRow` (name, privacy, class colour) and figures. */
export interface MeterPlayer extends PlayerRow {
  /** Observed deaths in this fight; null when not reported. */
  deaths: number | null;
  damage: number;
  /** Share of all players' damage, 0..1. */
  share: number;
  /** Average DPS in the selected DPS mode. */
  dps: number;
  /** DPS over the last 5 seconds; null when unknown. */
  currentDps: number | null;
  hits: number | null;
  crits: number | null;
  critObserved: number | null;
  critRate: number | null;
  skills: MeterSkill[];
}

/** Everything the embedded meter table and summary show, from exactly one source. */
export interface MeterModel {
  reportId: string | null;
  durationMs: number;
  startedMs: number | null;
  ended: boolean;
  /** Damage of every ranked player. */
  total: number;
  totalDps: number;
  totalCurrent: number | null;
  /** Players with outgoing damage, highest first. */
  players: MeterPlayer[];
  /** Every known player, including those without damage (e.g. only damage taken). */
  everyone: MeterPlayer[];
  localId: string | null;
}

type Counted = Pick<ReportSkill, 'damage' | 'healing' | 'hits' | 'crits'> &
  Pick<HitAccuracy, 'critical_hits_observed'> &
  DamageAccuracy;

/**
 * Damage-only hit and crit counts. Native damage counters are preferred; the combined
 * damage+healing counters are only used when nothing was healed, where they are equal.
 */
export function damageCounts(value: Counted) {
  const native = value.damage_hits !== null;
  const pure = value.healing === 0;
  const hits = native ? value.damage_hits : pure ? value.hits : null;
  const crits = native ? value.damage_crits : pure ? value.crits : null;
  const observed = native
    ? value.damage_critical_hits_observed
    : pure
      ? value.critical_hits_observed
      : null;
  const critRate = crits !== null && observed ? crits / observed : null;
  return { hits, crits, observed: observed || null, critRate };
}

const perSecond = (damage: number, durationMs: number) =>
  (damage * 1000) / Math.max(1000, durationMs);

function reportSkill(skill: ReportSkill, playerDamage: number, t: Translate<'live'>): MeterSkill {
  const counts = damageCounts(skill);
  return {
    id: key(skill.id),
    skillId: key(skill.id),
    name: skill.name ?? t(($) => $.names.skillId, { id: key(skill.id) }),
    damage: skill.damage,
    share: playerDamage > 0 ? skill.damage / playerDamage : 0,
    hits: counts.hits,
    critRate: counts.critRate,
  };
}

function reportPlayer(
  player: ReportPlayer,
  row: PlayerRow,
  total: number,
  durationMs: number,
  mode: DpsMode,
  t: Translate<'live'>,
): MeterPlayer {
  const counts = damageCounts(player);
  const average = player.edps ?? perSecond(player.damage, durationMs);
  return {
    ...row,
    deaths: player.deaths,
    damage: player.damage,
    share: total > 0 ? player.damage / total : 0,
    dps: mode === 'active' ? (player.adps ?? average) : average,
    currentDps: player.current_dps,
    hits: counts.hits,
    crits: counts.crits,
    critObserved: counts.observed,
    critRate: counts.critRate,
    skills: player.skills
      .filter((s) => s.damage > 0)
      .sort((a, b) => b.damage - a.damage)
      .map((s) => reportSkill(s, player.damage, t)),
  };
}

export interface ModelOptions {
  hideNames?: boolean;
  mode?: DpsMode;
  running?: boolean;
  /** Words for hidden or unnamed players and skills; observed names stay verbatim. */
  t: Translate<'live'>;
}

/** The native combat report drives the table and every summary figure. */
export function fromReport(
  report: ReportTotals,
  { hideNames = false, mode = 'encounter', running = true, t }: ModelOptions,
): MeterModel {
  const durationMs = report.duration_ms;
  const total = report.players.reduce((sum, p) => sum + Math.max(0, p.damage), 0);
  const rows = playerRows(
    { kind: 'meter', players: report.players, words: liveWords(t) },
    hideNames,
  );
  const everyone = report.players
    .map((p, index) => reportPlayer(p, rows[index]!, total, durationMs, mode, t))
    .sort((a, b) => b.damage - a.damage);
  const players = everyone.filter((p) => p.damage > 0);
  const currents = players.map((p) => p.currentDps);
  return {
    reportId: report.id,
    durationMs,
    startedMs: report.started_ms,
    ended: report.end_reason !== null || !running,
    total,
    totalDps: perSecond(total, durationMs),
    totalCurrent: currents.some((c) => c === null)
      ? null
      : currents.reduce<number>((sum, c) => sum + (c ?? 0), 0),
    players,
    everyone,
    localId: everyone.find((p) => p.local)?.id ?? null,
  };
}

/**
 * What the table shows: the player ranking, or one player's skills. The ranking is the
 * default however many players deal damage; a choice lasts until the fight changes.
 */
export type MeterFocus = { kind: 'ranking' } | { kind: 'player'; id: string };

/**
 * A DPS figure: whole numbers below a thousand (466.6 → 467), compact above it (12.3K).
 * Rounding first lets 999.5 read as 1K, never as "1,000" beside the compact figures.
 */
export const dpsFigure = (fmt: Formatters, value: number) => {
  const dps = Math.max(0, value);
  return fmt.compact.format(dps < 1000 ? Math.round(dps) : dps);
};

/** One-line clipboard summary using the meter's fight, scope, privacy and locale. */
export function meterSummary(
  model: MeterModel,
  focus: MeterFocus,
  {
    caption,
    rows,
    t,
    fmt,
  }: { caption: string; rows: number | null; t: Translate<'live'>; fmt: Formatters },
) {
  const short = (value: number) => fmt.compact.format(value);
  const rate = (value: number) => t(($) => $.units.perSecond, { value: dpsFigure(fmt, value) });
  const percent = (value: number) => fmt.pct(value, 1);
  const head = t(($) => $.summary.head, { caption, duration: clock(model.durationMs) });
  const take = <T>(list: T[]) => (rows === null ? list : list.slice(0, rows));
  if (focus.kind === 'player') {
    const player = model.everyone.find((p) => p.id === focus.id);
    if (!player) return head;
    const skills = take(player.skills).map(
      (s, i) => `${i + 1}. ${s.name} ${short(s.damage)} (${percent(s.share)})`,
    );
    return [
      `${head} · ${player.name} ${short(player.damage)} · ${rate(player.dps)} · ${percent(player.share)}`,
      ...skills,
    ].join(' | ');
  }
  const players = take(model.players).map(
    (p, i) => `${i + 1}. ${p.name} ${short(p.damage)} · ${rate(p.dps)} (${percent(p.share)})`,
  );
  return [`${head} · ${rate(model.totalDps)}`, ...players].join(' | ');
}
