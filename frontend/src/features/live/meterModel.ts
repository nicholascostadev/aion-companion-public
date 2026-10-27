import { clock, type Formatters } from '../../i18n/formatters';
import type { Translate } from '../../i18n/provider';
import type { LivePlayer, LiveStatus } from '../../types/companion';
import type {
  DamageAccuracy,
  DpsMode,
  HitAccuracy,
  ReportPlayer,
  ReportSkill,
  ReportTotals,
} from '../../types/offline';
import { key } from '../offline/analysis';
import { playerDisplay } from './playerName';

/** One skill of the focused player, damage dealt only. */
export interface MeterSkill {
  id: string;
  /** Native numeric skill id, for its artwork; null for live totals keyed by name. */
  skillId: string | null;
  name: string;
  damage: number;
  /** Share of the player's damage, 0..1. */
  share: number;
  /** Damage events; a multi-hit counts once. Null when not observed. */
  hits: number | null;
  /** Critical rate over hits with a decoded crit flag; null when none were decoded. */
  critRate: number | null;
}

export interface MeterPlayer {
  id: string;
  name: string;
  title: string;
  class: string | null;
  local: boolean;
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
  source: 'report' | 'live';
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

/** Hidden names keep the local player recognizable and number everyone else by rank. */
function privateName(local: boolean, job: string | null, rank: number, t: Translate<'live'>) {
  if (local) return t(($) => $.names.you);
  return job
    ? t(($) => $.names.classRank, { className: job, rank })
    : t(($) => $.names.playerRank, { rank });
}

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
  total: number,
  durationMs: number,
  mode: DpsMode,
  t: Translate<'live'>,
): Omit<MeterPlayer, 'name' | 'title'> {
  const counts = damageCounts(player);
  const average = player.edps ?? perSecond(player.damage, durationMs);
  return {
    id: key(player.id),
    class: player.class,
    local: player.local === true,
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

function ranked(
  list: Omit<MeterPlayer, 'name' | 'title'>[],
  names: (p: (typeof list)[number], rank: number) => { name: string; title: string },
) {
  const everyone = [...list]
    .sort((a, b) => b.damage - a.damage)
    .map((p, index) => ({ ...p, ...names(p, index + 1) }));
  return { everyone, players: everyone.filter((p) => p.damage > 0) };
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
  const byId = new Map(report.players.map((p) => [key(p.id), p]));
  const { everyone, players } = ranked(
    report.players.map((p) => reportPlayer(p, total, durationMs, mode, t)),
    (p, rank) => {
      const source = byId.get(p.id);
      const text = source?.name ?? t(($) => $.names.playerId, { id: p.id });
      if (hideNames) {
        const hidden = privateName(p.local, p.class, rank, t);
        return { name: hidden, title: hidden };
      }
      const details = [
        p.class && p.class !== text && p.class,
        p.local && t(($) => $.names.youDetail),
      ].filter(Boolean);
      return { name: text, title: details.length ? `${text} · ${details.join(' · ')}` : text };
    },
  );
  const currents = players.map((p) => p.currentDps);
  return {
    source: 'report',
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

function livePlayer(player: LivePlayer, total: number): Omit<MeterPlayer, 'name' | 'title'> {
  const skills = Object.entries(player.skills)
    .filter(([, damage]) => damage > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([label, damage]) => ({
      id: label,
      // Live totals carry names only; a name is never mapped to artwork.
      skillId: null,
      name: label,
      damage,
      share: player.damage > 0 ? damage / player.damage : 0,
      // Live totals do not say which hits had a decoded crit flag.
      hits: null,
      critRate: null,
    }));
  return {
    id: String(player.entity),
    class: player.class ?? null,
    local: player.is_local === true,
    damage: player.damage,
    share: total > 0 ? player.damage / total : 0,
    dps: player.dps,
    currentDps: player.current_dps,
    hits: null,
    crits: null,
    critObserved: null,
    critRate: null,
    skills,
  };
}

/** Fallback before any native report exists: live totals without hit detail. */
export function fromLive(
  status: LiveStatus,
  { hideNames = false, t }: Pick<ModelOptions, 'hideNames' | 't'>,
): MeterModel {
  const total = status.players.reduce((sum, p) => sum + Math.max(0, p.damage), 0);
  const source = new Map(status.players.map((p) => [String(p.entity), p]));
  const { everyone, players } = ranked(
    status.players.map((p) => livePlayer(p, total)),
    (p, rank) => {
      if (hideNames) {
        const hidden = privateName(p.local, p.class, rank, t);
        return { name: hidden, title: hidden };
      }
      const display = playerDisplay(source.get(p.id)!, t);
      return { name: display.text, title: display.title };
    },
  );
  return {
    source: 'live',
    reportId: null,
    durationMs: status.duration_ms,
    startedMs: null,
    ended: !status.running || status.encounter_ended === true,
    total,
    totalDps: perSecond(total, status.duration_ms),
    totalCurrent: players.reduce((sum, p) => sum + (p.currentDps ?? 0), 0),
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
 * One-line clipboard text of exactly what the meter shows: the same fight, filter,
 * names (privacy applied) and rows, worded and formatted in the interface language.
 */
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
  const rate = (value: number) => t(($) => $.units.perSecond, { value: short(value) });
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
