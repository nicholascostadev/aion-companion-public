import type { Translate } from '../../i18n/provider';
import type {
  BuffSpan,
  CombatReport,
  EntityId,
  HpSample,
  ReportEvent,
  ReportPlayer,
  ReportSkill,
  ReportTarget,
  ReportTotals,
  SkillCharge,
} from '../../types/offline';

/*
 * Pure report analysis. Every figure is derived from recorded events, buff spans or
 * HP samples; when the inputs are missing the result is `null`/empty, never a guess.
 */

export const key = (id: EntityId | null | undefined) =>
  id === null || id === undefined ? '' : String(id);
export const sameId = (a: EntityId | null | undefined, b: EntityId | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

/** Ratio or null when the denominator is unknown/zero or the numerator unknown. */
export function rate(part: number | null | undefined, whole: number | null | undefined) {
  if (part === null || part === undefined || !whole) return null;
  return part / whole;
}

type Counted = Pick<
  ReportSkill,
  | 'crits'
  | 'back'
  | 'front'
  | 'perfect'
  | 'double'
  | 'parry'
  | 'multi'
  | 'hits'
  | 'direct_hits'
  | 'critical_hits_observed'
  | 'flags_observed'
>;
export type PositionalFlag = 'back' | 'front' | 'perfect' | 'double' | 'parry';

/** Crit rate over direct hits whose crit flag was decoded; DoT ticks never count. */
export const critRate = (row: Counted) =>
  row.crits === null ? null : rate(row.crits, row.critical_hits_observed);
/** Positional/special rate over hits whose flags were decoded. */
export const flagRate = (row: Counted, flag: PositionalFlag) =>
  row[flag] === null ? null : rate(row[flag], row.flags_observed);
export const multiRate = (row: Counted) => rate(row.multi, row.direct_hits ?? row.hits);

export interface TimeWindow {
  from: number;
  to: number;
}
export const fullWindow = (report: CombatReport): TimeWindow => ({
  from: 0,
  to: Math.max(report.duration_ms, report.events.at(-1)?.at_ms ?? 0, 1),
});
const inWindow = (at: number, window?: TimeWindow | null) =>
  !window || (at >= window.from && at <= window.to);

/* ---------- Names ---------- */

export interface NameOptions {
  hideNames: boolean;
  /** Words for unnamed or hidden identities; observed names stay verbatim. */
  t: Translate<'reports'>;
}

export function playerLabel(player: ReportPlayer, index: number, { hideNames, t }: NameOptions) {
  if (player.local && (hideNames || !player.name)) return t(($) => $.names.you);
  if (hideNames)
    return player.class
      ? t(($) => $.names.classIndex, { className: player.class, index: index + 1 })
      : t(($) => $.names.playerIndex, { index: index + 1 });
  return player.name ?? t(($) => $.names.playerId, { id: key(player.id) });
}

/** Resolves entity and skill identifiers to the names native observed. */
export class Names {
  private readonly entities = new Map<string, string>();
  private readonly skills = new Map<string, string>();
  private readonly t: Translate<'reports'>;
  readonly players = new Map<string, ReportPlayer>();
  readonly targets = new Map<string, ReportTarget>();

  constructor(report: ReportTotals | null, options: NameOptions) {
    const { t } = options;
    this.t = t;
    if (!report) return;
    report.players.forEach((player, index) => {
      this.players.set(key(player.id), player);
      this.entities.set(key(player.id), playerLabel(player, index, options));
      for (const skill of player.skills) if (skill.name) this.skills.set(key(skill.id), skill.name);
    });
    for (const target of report.targets) {
      this.targets.set(key(target.id), target);
      if (!this.entities.has(key(target.id)))
        this.entities.set(
          key(target.id),
          target.name ?? t(($) => $.names.npcId, { id: key(target.npc_id ?? target.id) }),
        );
    }
  }

  entity(id: EntityId | null | undefined) {
    if (id === null || id === undefined) return this.t(($) => $.names.unknown);
    return this.entities.get(key(id)) ?? `#${key(id)}`;
  }
  skill(id: EntityId | null | undefined, fallback?: string | null) {
    if (id === null || id === undefined) return this.t(($) => $.names.unknownSkill);
    return this.skills.get(key(id)) ?? fallback ?? this.t(($) => $.names.skillId, { id: key(id) });
  }
  isPlayer(id: EntityId | null | undefined) {
    return this.players.has(key(id));
  }
}

/* ---------- Targets & boss projection ---------- */

/** Native reports the target dead, or its current HP is an observed zero. */
const isDead = (target: ReportTarget) => target.dead === true || target.current_hp === 0;

/**
 * The boss with most damage taken, else a training dummy, else the most damaged target
 * with known HP. A living boss or target wins over a dead one, so the next boss of a run
 * takes over from the one just killed; once all are dead the most damaged is kept.
 */
export function primaryTarget(report: ReportTotals | null): ReportTarget | null {
  if (!report?.targets.length) return null;
  const byDamage = [...report.targets].sort((a, b) => b.damage - a.damage);
  const pick = (match: (t: ReportTarget) => boolean) =>
    byDamage.find((t) => match(t) && !isDead(t)) ?? byDamage.find(match);
  return (
    pick((t) => t.boss === true) ??
    byDamage.find((t) => t.dummy === true) ??
    pick((t) => t.max_hp !== null && t.max_hp > 0) ??
    null
  );
}

/** Aggregates with whatever HP samples the report carries (a summary: slope endpoints only). */
type WithHp = ReportTotals & { hp: HpSample[] };

export function latestHp(report: WithHp, id: EntityId, atMs = Infinity): HpSample | null {
  let found: HpSample | null = null;
  for (const sample of report.hp) {
    if (sample.at_ms > atMs) break;
    if (sameId(sample.entity, id)) found = sample;
  }
  return found;
}

export interface BossProjection {
  target: ReportTarget;
  current: number | null;
  max: number | null;
  fraction: number | null;
  /** Damage per second against this target. */
  dps: number | null;
  dpsSource: 'hp' | 'damage' | null;
  ttkMs: number | null;
  /** Remaining time before berserk, measured from the start of the fight. */
  berserkMs: number | null;
  beatsBerserk: boolean | null;
}

const SLOPE_WINDOW_MS = 20_000;

export function bossProjection(report: WithHp | null): BossProjection | null {
  const target = primaryTarget(report);
  if (!report || !target) return null;
  // The target's own HP is native's current state; retained samples may be older (e.g. the
  // spawn sample), so they only fill in what the target does not report.
  const sample = latestHp(report, target.id);
  const deadNow = target.dead === true;
  const current = deadNow ? 0 : (target.current_hp ?? sample?.current ?? null);
  const max = target.max_hp !== null && target.max_hp > 0 ? target.max_hp : (sample?.max ?? null);
  const fraction = current !== null && max ? Math.min(1, Math.max(0, current / max)) : null;

  // Prefer the observed HP slope over the recent window; fall back to recorded damage.
  let dps: number | null = null;
  let dpsSource: BossProjection['dpsSource'] = null;
  const samples = report.hp.filter((s) => sameId(s.entity, target.id));
  const last = samples.at(-1);
  if (last) {
    const first = samples.find((s) => s.at_ms >= last.at_ms - SLOPE_WINDOW_MS);
    if (first && last.at_ms - first.at_ms >= 3000 && first.current > last.current) {
      dps = (first.current - last.current) / ((last.at_ms - first.at_ms) / 1000);
      dpsSource = 'hp';
    }
  }
  if (dps === null && target.damage > 0 && report.duration_ms > 0) {
    dps = target.damage / (report.duration_ms / 1000);
    dpsSource = 'damage';
  }
  const dead = deadNow || current === 0;
  const ttkMs = dead ? 0 : current !== null && dps ? (current / dps) * 1000 : null;
  const berserkMs =
    target.berserk_seconds !== null && target.berserk_seconds > 0
      ? target.berserk_seconds * 1000 - report.duration_ms
      : null;
  const beatsBerserk = dead
    ? true
    : ttkMs !== null && berserkMs !== null
      ? ttkMs <= berserkMs
      : null;
  return { target, current, max, fraction, dps, dpsSource, ttkMs, berserkMs, beatsBerserk };
}

/** Training dummy countdown from the user's dummy length setting. */
export function dummyTimer(report: ReportTotals | null, lengthSeconds: number) {
  const target = primaryTarget(report);
  if (!report || !target || target.dummy !== true || lengthSeconds <= 0) return null;
  const total = lengthSeconds * 1000;
  return { target, remainingMs: Math.max(0, total - report.duration_ms), totalMs: total };
}

/* ---------- Skill statistics from events ---------- */

export interface SkillRow extends ReportSkill {
  /** Damage share of the selection (0..1). */
  share: number | null;
  /** True when computed from events instead of native aggregates. */
  derived: boolean;
}

export interface SkillFilter {
  source: EntityId;
  target?: EntityId | null;
  window?: TimeWindow | null;
  kind?: 'damage' | 'heal';
}

const isHit = (e: ReportEvent, kind: 'damage' | 'heal') => e.kind === kind;

/** Per-skill statistics for one player, from damage/heal and cast events. */
export function skillStatsFromEvents(
  report: CombatReport,
  filter: SkillFilter,
  names?: Names,
): SkillRow[] {
  const kind = filter.kind ?? 'damage';
  const rows = new Map<
    string,
    SkillRow & { amounts: number; castTimes: number[]; charges: Map<string, number> }
  >();
  const row = (id: EntityId) => {
    let r = rows.get(key(id));
    if (!r) {
      r = {
        id,
        name: names ? names.skill(id) : null,
        damage: 0,
        healing: 0,
        received: 0,
        casts: 0,
        hits: 0,
        crits: 0,
        back: 0,
        front: 0,
        perfect: 0,
        double: 0,
        parry: 0,
        multi: 0,
        direct_hits: 0,
        critical_hits_observed: 0,
        flags_observed: 0,
        inferred_casts: null,
        damage_hits: null,
        damage_crits: null,
        damage_critical_hits_observed: null,
        min: null,
        max: null,
        avg: null,
        cast_gap_ms: null,
        charge: null,
        specialties: [],
        share: null,
        derived: true,
        amounts: 0,
        castTimes: [],
        charges: new Map(),
      };
      rows.set(key(id), r);
    }
    return r;
  };
  for (const e of report.events) {
    if (!sameId(e.source, filter.source) || e.skill === null || e.skill === undefined) continue;
    if (!inWindow(e.at_ms, filter.window)) continue;
    if (e.kind === 'cast') {
      if (
        filter.target &&
        e.target !== null &&
        e.target !== undefined &&
        !sameId(e.target, filter.target)
      )
        continue;
      const r = row(e.skill);
      r.casts = (r.casts ?? 0) + 1;
      r.castTimes.push(e.at_ms);
      if (e.charge !== null && e.charge !== undefined)
        r.charges.set(String(e.charge), (r.charges.get(String(e.charge)) ?? 0) + 1);
      continue;
    }
    if (!isHit(e, kind)) continue;
    if (filter.target && !sameId(e.target, filter.target)) continue;
    const value = e.amount ?? 0;
    const r = row(e.skill);
    if (kind === 'damage') r.damage += value;
    else r.healing += value;
    r.amounts += 1;
    r.hits = (r.hits ?? 0) + 1;
    r.min = r.min === null ? value : Math.min(r.min, value);
    r.max = r.max === null ? value : Math.max(r.max, value);
    if (!e.tick) r.direct_hits = (r.direct_hits ?? 0) + 1;
    if (!e.tick && e.critical !== null && e.critical !== undefined)
      r.critical_hits_observed = (r.critical_hits_observed ?? 0) + 1;
    if (e.back !== null && e.back !== undefined) r.flags_observed = (r.flags_observed ?? 0) + 1;
    if (e.critical && !e.tick) r.crits = (r.crits ?? 0) + 1;
    if (e.back) r.back = (r.back ?? 0) + 1;
    if (e.front) r.front = (r.front ?? 0) + 1;
    if (e.perfect) r.perfect = (r.perfect ?? 0) + 1;
    if (e.double) r.double = (r.double ?? 0) + 1;
    if (e.parry) r.parry = (r.parry ?? 0) + 1;
    if ((e.hit_count ?? 1) > 1) r.multi = (r.multi ?? 0) + 1;
  }
  const total = [...rows.values()].reduce(
    (sum, r) => sum + (kind === 'damage' ? r.damage : r.healing),
    0,
  );
  return [...rows.values()]
    .map(({ amounts, castTimes, charges, ...r }): SkillRow => {
      const value = kind === 'damage' ? r.damage : r.healing;
      const gaps = castTimes.slice(1).map((t, i) => t - (castTimes[i] ?? t));
      // Without an observed flag the rate is unknown, not zero.
      const crit = r.critical_hits_observed ? r.crits : null;
      const flagged = (n: number | null) => (r.flags_observed ? n : null);
      return {
        ...r,
        crits: crit,
        back: flagged(r.back),
        front: flagged(r.front),
        perfect: flagged(r.perfect),
        double: flagged(r.double),
        parry: flagged(r.parry),
        critical_hits_observed: r.critical_hits_observed || null,
        flags_observed: r.flags_observed || null,
        // A skill without cast packets has unknown casts, not zero.
        casts: castTimes.length ? r.casts : null,
        avg: amounts ? value / amounts : null,
        cast_gap_ms: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null,
        charge: charges.size ? (Object.fromEntries(charges) as SkillCharge) : null,
        share: total ? value / total : null,
      };
    })
    .filter((r) => (kind === 'damage' ? r.damage > 0 : r.healing > 0) || (r.casts ?? 0) > 0)
    .sort((a, b) => (kind === 'damage' ? b.damage - a.damage : b.healing - a.healing));
}

/** Native aggregates with share; used when no target/time filter is active. */
export function skillRowsFromPlayer(
  player: ReportPlayer,
  kind: 'damage' | 'heal' = 'damage',
): SkillRow[] {
  const value = (s: ReportSkill) => (kind === 'damage' ? s.damage : s.healing);
  const total = player.skills.reduce((sum, s) => sum + value(s), 0);
  return player.skills
    .filter((s) => value(s) > 0 || (kind === 'damage' && (s.casts ?? 0) > 0 && s.healing === 0))
    .map((s) => ({ ...s, share: total ? value(s) / total : null, derived: false }))
    .sort((a, b) => value(b) - value(a));
}

/* ---------- Rotation ---------- */

export interface Cast {
  at_ms: number;
  skill: EntityId;
  target: EntityId | null;
  instance: EntityId | null;
  charge: number | null;
  duration_ms: number | null;
  /**
   * True for an attack-sequence entry: the first hit of a skill use for a skill with
   * no observed cast packet. Never a verified cast.
   */
  fromHits: boolean;
}

/**
 * The player's sequence. Skills with observed cast packets use them; skills with none
 * contribute the first hit of each use (by instance, else a 600 ms gap), flagged
 * `fromHits`. Decided per skill, so one cast packet never hides hit-only skills.
 */
export function castsFor(
  report: CombatReport,
  source: EntityId,
  window?: TimeWindow | null,
): Cast[] {
  const mine = report.events.filter(
    (e) => sameId(e.source, source) && e.skill !== null && e.skill !== undefined,
  );
  const casted = new Set(mine.filter((e) => e.kind === 'cast').map((e) => key(e.skill)));
  const out: Cast[] = [];
  const lastHit = new Map<string, ReportEvent>();
  for (const e of mine) {
    const skill = e.skill as EntityId;
    if (e.kind === 'cast') {
      if (inWindow(e.at_ms, window))
        out.push({
          at_ms: e.at_ms,
          skill,
          target: e.target ?? null,
          instance: e.instance ?? null,
          charge: e.charge ?? null,
          duration_ms: e.duration_ms ?? null,
          fromHits: false,
        });
      continue;
    }
    if ((e.kind !== 'damage' && e.kind !== 'heal') || e.tick || casted.has(key(skill))) continue;
    const previous = lastHit.get(key(skill));
    lastHit.set(key(skill), e);
    const sameUse =
      previous &&
      (e.instance !== null && e.instance !== undefined
        ? sameId(previous.instance, e.instance)
        : e.at_ms - previous.at_ms < 600);
    if (!sameUse && inWindow(e.at_ms, window))
      out.push({
        at_ms: e.at_ms,
        skill,
        target: e.target ?? null,
        instance: e.instance ?? null,
        charge: e.charge ?? null,
        duration_ms: null,
        fromHits: true,
      });
  }
  return out.sort((a, b) => a.at_ms - b.at_ms);
}

/** Opening sequence: the first casts within `windowMs` of the player's first cast. */
export function opener(casts: Cast[], windowMs = 15_000, limit = 16) {
  const first = casts[0];
  if (!first) return [];
  return casts.filter((c) => c.at_ms - first.at_ms <= windowMs).slice(0, limit);
}

/* ---------- Buffs ---------- */

export const spanEnd = (span: BuffSpan, report: CombatReport) =>
  span.end_ms ?? Math.max(report.duration_ms, span.start_ms);

const activeAt = (span: BuffSpan, at: number, report: CombatReport) =>
  span.start_ms <= at && at < spanEnd(span, report);

export interface ActiveEffect {
  span: BuffSpan;
  scope: 'self' | 'party' | 'target' | 'other';
  remainingMs: number | null;
}

/** Effects active at one instant, grouped relative to a player and their target. */
export function effectsAt(
  report: CombatReport,
  at: number,
  player: EntityId,
  target: EntityId | null,
  names: Names,
): ActiveEffect[] {
  return report.buffs
    .filter((span) => activeAt(span, at, report))
    .map((span): ActiveEffect => {
      const scope = sameId(span.target, player)
        ? 'self'
        : target !== null && sameId(span.target, target)
          ? 'target'
          : names.isPlayer(span.target)
            ? 'party'
            : 'other';
      return { span, scope, remainingMs: span.end_ms === null ? null : span.end_ms - at };
    });
}

export interface CastDetail {
  cast: Cast;
  hits: ReportEvent[];
  damage: number;
  healing: number;
  /** Crits among direct hits whose crit flag was decoded. */
  crits: number;
  critObserved: number;
  /** True when the hit window is the 8 s fallback, not bounded by the next cast or a duration. */
  windowEstimated: boolean;
  effects: ActiveEffect[];
  targetHp: HpSample | null;
  gapBeforeMs: number | null;
}

/**
 * Hits belonging to a cast: same source and skill (and instance when recorded),
 * until the next cast of that skill, the cast's own duration, or an 8 s fallback.
 */
export function castDetail(
  report: CombatReport,
  casts: Cast[],
  index: number,
  player: EntityId,
  names: Names,
): CastDetail | null {
  const cast = casts[index];
  if (!cast) return null;
  const next = casts.slice(index + 1).find((c) => sameId(c.skill, cast.skill));
  const bounded = next?.at_ms ?? (cast.duration_ms ? cast.at_ms + cast.duration_ms + 1000 : null);
  const until = Math.min(bounded ?? Infinity, cast.at_ms + 8000);
  const hits = report.events.filter(
    (e) =>
      (e.kind === 'damage' || e.kind === 'heal') &&
      sameId(e.source, player) &&
      sameId(e.skill, cast.skill) &&
      e.at_ms >= cast.at_ms &&
      e.at_ms < until &&
      (cast.instance === null ||
        e.instance === null ||
        e.instance === undefined ||
        sameId(e.instance, cast.instance)),
  );
  const direct = hits.filter((h) => !h.tick && h.critical !== null && h.critical !== undefined);
  const target =
    cast.target ?? hits.find((h) => h.target !== null && h.target !== undefined)?.target ?? null;
  const previous = casts[index - 1];
  return {
    cast,
    hits,
    damage: hits.filter((h) => h.kind === 'damage').reduce((s, h) => s + (h.amount ?? 0), 0),
    healing: hits.filter((h) => h.kind === 'heal').reduce((s, h) => s + (h.amount ?? 0), 0),
    crits: direct.filter((h) => h.critical).length,
    critObserved: direct.length,
    windowEstimated: bounded === null || bounded > cast.at_ms + 8000,
    effects: effectsAt(report, cast.at_ms, player, target, names),
    targetHp: target === null ? null : latestHp(report, target, cast.at_ms),
    gapBeforeMs: previous ? cast.at_ms - previous.at_ms : null,
  };
}

export interface BuffLane {
  key: string;
  skill: EntityId;
  target: EntityId | null;
  spans: BuffSpan[];
  /** Time covered by spans with a recorded end. */
  uptimeMs: number;
  /** Additional time from spans with no recorded end, counted to the fight end. */
  openMs: number;
  applications: number;
}

/** Buff lanes (one per skill × target) clipped to a window, ordered by uptime. */
export function buffLanes(
  report: CombatReport,
  window: TimeWindow,
  filter: (span: BuffSpan) => boolean = () => true,
): BuffLane[] {
  const lanes = new Map<string, BuffLane>();
  for (const span of report.buffs) {
    if (!filter(span)) continue;
    const end = spanEnd(span, report);
    if (end < window.from || span.start_ms > window.to) continue;
    const id = `${key(span.skill)}@${key(span.target)}`;
    let lane = lanes.get(id);
    if (!lane) {
      lane = {
        key: id,
        skill: span.skill,
        target: span.target,
        spans: [],
        uptimeMs: 0,
        openMs: 0,
        applications: 0,
      };
      lanes.set(id, lane);
    }
    lane.spans.push(span);
    lane.applications += 1;
  }
  for (const lane of lanes.values()) {
    lane.uptimeMs = mergedLength(
      lane.spans.filter((s) => s.end_ms !== null),
      window,
      report,
    );
    lane.openMs = Math.max(0, mergedLength(lane.spans, window, report) - lane.uptimeMs);
  }
  return [...lanes.values()].sort((a, b) => b.uptimeMs + b.openMs - (a.uptimeMs + a.openMs));
}

function mergedLength(spans: BuffSpan[], window: TimeWindow, report: CombatReport) {
  const ranges = spans
    .map(
      (s) => [Math.max(window.from, s.start_ms), Math.min(window.to, spanEnd(s, report))] as const,
    )
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = [-Infinity, -Infinity];
  for (const [a, b] of ranges) {
    if (a > end) {
      if (end > start) total += end - start;
      [start, end] = [a, b];
    } else end = Math.max(end, b);
  }
  if (end > start) total += end - start;
  return total;
}

export interface BuffOverlap {
  buff: EntityId;
  scope: 'self' | 'target';
  /** Share of this skill's hits that landed while the buff was active. */
  hitShare: number;
  /** Share of this skill's damage dealt while the buff was active. */
  damageShare: number;
  /** Some overlap came from a span whose end was not observed (active through report end). */
  open: boolean;
}

export interface SkillBuffOverlap {
  skill: EntityId;
  hits: number;
  damage: number;
  buffs: BuffOverlap[];
}

type Tally = [hits: number, damage: number, open: boolean];

/**
 * Real recorded overlap: for each of a player's skills, the fraction of hits and
 * damage that landed while each buff on the player (self) or on the hit target was
 * active. Spans without an observed end count as active through the report end and
 * are flagged `open`.
 */
export function buffsPerSkill(
  report: CombatReport,
  player: EntityId,
  window?: TimeWindow | null,
): SkillBuffOverlap[] {
  const selfSpans = new Map<string, BuffSpan[]>();
  const onTargets = new Map<string, Map<string, BuffSpan[]>>();
  for (const span of report.buffs) {
    if (sameId(span.target, player)) {
      const list = selfSpans.get(key(span.skill)) ?? [];
      list.push(span);
      selfSpans.set(key(span.skill), list);
    } else {
      const byTarget = onTargets.get(key(span.target)) ?? new Map<string, BuffSpan[]>();
      const list = byTarget.get(key(span.skill)) ?? [];
      list.push(span);
      byTarget.set(key(span.skill), list);
      onTargets.set(key(span.target), byTarget);
    }
  }
  const skills = new Map<
    string,
    {
      skill: EntityId;
      hits: number;
      damage: number;
      self: Map<string, Tally>;
      target: Map<string, Tally>;
    }
  >();
  const ids = new Map<string, EntityId>();
  const tally = (
    into: Map<string, Tally>,
    buff: string,
    spans: BuffSpan[],
    at: number,
    value: number,
  ) => {
    const active = spans.find((span) => activeAt(span, at, report));
    if (!active) return;
    ids.set(buff, active.skill);
    const [h, d, open] = into.get(buff) ?? [0, 0, false];
    into.set(buff, [h + 1, d + value, open || active.end_ms === null]);
  };
  for (const e of report.events) {
    if (
      e.kind !== 'damage' ||
      !sameId(e.source, player) ||
      e.skill === null ||
      e.skill === undefined
    )
      continue;
    if (!inWindow(e.at_ms, window)) continue;
    const s = skills.get(key(e.skill)) ?? {
      skill: e.skill,
      hits: 0,
      damage: 0,
      self: new Map(),
      target: new Map(),
    };
    skills.set(key(e.skill), s);
    const value = e.amount ?? 0;
    s.hits += 1;
    s.damage += value;
    for (const [buff, spans] of selfSpans) tally(s.self, buff, spans, e.at_ms, value);
    const targetSpans = onTargets.get(key(e.target));
    if (targetSpans)
      for (const [buff, spans] of targetSpans) tally(s.target, buff, spans, e.at_ms, value);
  }
  const overlaps = (
    s: { hits: number; damage: number },
    map: Map<string, Tally>,
    scope: 'self' | 'target',
  ) =>
    [...map].map(([buff, [h, d, open]]): BuffOverlap => ({
      buff: ids.get(buff) ?? buff,
      scope,
      hitShare: h / s.hits,
      damageShare: s.damage ? d / s.damage : 0,
      open,
    }));
  return [...skills.values()]
    .map((s) => ({
      skill: s.skill,
      hits: s.hits,
      damage: s.damage,
      buffs: [...overlaps(s, s.self, 'self'), ...overlaps(s, s.target, 'target')].sort(
        (a, b) => b.damageShare - a.damageShare,
      ),
    }))
    .sort((a, b) => b.damage - a.damage);
}

/* ---------- Damage taken, deaths ---------- */

export interface TakenRow {
  source: EntityId | null;
  skill: EntityId | null;
  amount: number;
  hits: number;
  max: number;
}

export function damageTaken(
  report: CombatReport,
  player: EntityId,
  window?: TimeWindow | null,
): TakenRow[] {
  const rows = new Map<string, TakenRow>();
  for (const e of report.events) {
    if (e.kind !== 'damage' || !sameId(e.target, player) || !inWindow(e.at_ms, window)) continue;
    const id = `${key(e.source)}|${key(e.skill)}`;
    const row = rows.get(id) ?? {
      source: e.source ?? null,
      skill: e.skill ?? null,
      amount: 0,
      hits: 0,
      max: 0,
    };
    row.amount += e.amount ?? 0;
    row.hits += 1;
    row.max = Math.max(row.max, e.amount ?? 0);
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

export interface DeathRecap {
  at_ms: number;
  entity: EntityId;
  killer: EntityId | null;
  /** All hits taken in the recap window, and their total. */
  hitCount: number;
  hitTotal: number;
  /** The most recent hits, for display (at most eight). */
  lastHits: ReportEvent[];
  revivedAt: number | null;
}

const present = (id: EntityId | null | undefined): id is EntityId =>
  id !== null && id !== undefined;

/** Each recorded player death, with the hits taken in the `recapMs` before it. */
export function deathRecaps(
  report: CombatReport,
  isPlayer: (id: EntityId) => boolean,
  recapMs = 10_000,
): DeathRecap[] {
  return report.events.flatMap((death): DeathRecap[] => {
    if (death.kind !== 'death') return [];
    // Dead entity: the event target when named, else its source.
    const who = present(death.target) ? death.target : death.source;
    if (!present(who) || !isPlayer(who)) return [];
    const window = report.events.filter(
      (e) =>
        e.kind === 'damage' &&
        sameId(e.target, who) &&
        e.at_ms <= death.at_ms &&
        e.at_ms >= death.at_ms - recapMs,
    );
    const revive = report.events.find(
      (e) => e.kind === 'revive' && sameId(e.target ?? e.source, who) && e.at_ms > death.at_ms,
    );
    return [
      {
        at_ms: death.at_ms,
        entity: who,
        // A death naming both sides credits its source; otherwise the last recorded hit.
        killer:
          present(death.target) && present(death.source) && !sameId(death.source, death.target)
            ? death.source
            : (window.at(-1)?.source ?? null),
        hitCount: window.length,
        hitTotal: window.reduce((s, h) => s + (h.amount ?? 0), 0),
        lastHits: window.slice(-8),
        revivedAt: revive?.at_ms ?? null,
      },
    ];
  });
}

/* ---------- Series ---------- */

/**
 * Damage per second buckets dealt by recorded players to non-player targets: one
 * player when `source` is given, otherwise all of them. NPC hits never count.
 */
export function damageSeries(report: CombatReport, bucketMs: number, source?: EntityId | null) {
  const players = new Set(report.players.map((p) => key(p.id)));
  const size = Math.max(1, Math.ceil(fullWindow(report).to / bucketMs));
  const buckets = new Array<number>(size).fill(0);
  for (const e of report.events) {
    if (e.kind !== 'damage' || !players.has(key(e.source)) || players.has(key(e.target))) continue;
    if (present(source) && !sameId(e.source, source)) continue;
    const i = Math.min(size - 1, Math.floor(e.at_ms / bucketMs));
    buckets[i] = (buckets[i] ?? 0) + (e.amount ?? 0);
  }
  return buckets.map((value) => value / (bucketMs / 1000));
}

export function hpSeries(report: CombatReport, entity: EntityId) {
  return report.hp.filter((s) => sameId(s.entity, entity));
}

/* ---------- Comparison ---------- */

export interface SkillPair {
  key: string;
  name: string;
  a: SkillRow | null;
  b: SkillRow | null;
}

export function pairSkills(
  a: SkillRow[],
  b: SkillRow[],
  names: (row: SkillRow) => string,
): SkillPair[] {
  const pairs = new Map<string, SkillPair>();
  for (const row of a)
    pairs.set(key(row.id), { key: key(row.id), name: names(row), a: row, b: null });
  for (const row of b) {
    const existing = pairs.get(key(row.id));
    if (existing) existing.b = row;
    else pairs.set(key(row.id), { key: key(row.id), name: names(row), a: null, b: row });
  }
  return [...pairs.values()].sort(
    (x, y) =>
      Math.max(y.a?.damage ?? 0, y.b?.damage ?? 0) - Math.max(x.a?.damage ?? 0, x.b?.damage ?? 0),
  );
}

/** Whole-encounter party DPS: all recorded players' damage ÷ fight duration, whatever the DPS mode. */
export function partyDps(report: ReportTotals | null) {
  if (!report || report.duration_ms <= 0) return null;
  const total = report.players.reduce((sum, p) => sum + p.damage, 0);
  return total / (report.duration_ms / 1000);
}

/** Player DPS for the selected mode; null when native has not computed it. */
export function playerDps(
  player: ReportPlayer,
  report: ReportTotals,
  mode: 'encounter' | 'active',
) {
  if (mode === 'active') return player.adps;
  return (
    player.edps ?? (report.duration_ms > 0 ? player.damage / (report.duration_ms / 1000) : null)
  );
}
