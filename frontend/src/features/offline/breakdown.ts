import type {
  CombatReport,
  EntityId,
  ReportEvent,
  ReportPlayer,
  ReportSkill,
  ReportTotals,
} from '../../types/offline';
import { buffLanes, key, sameId, type BuffLane, type SkillRow, type TimeWindow } from './analysis';

/*
 * Pure models of the report's breakdowns: which skill metrics show, which skills list, one
 * skill's recorded hits, a player's activity on the boss and a buff's measured uptime. Like
 * `analysis.ts`, every figure comes from recorded events or spans; what was not observed
 * stays null, never a guess.
 */

/**
 * Fight time from which this report keeps detailed events. A live report holds only the
 * latest ones (`events_truncated`); anything earlier exists in its totals alone.
 */
export const detailStart = (report: CombatReport) =>
  report.events_truncated
    ? Math.max(0, report.event_window_start_ms ?? report.events[0]?.at_ms ?? 0)
    : 0;

/* ---------- Skill table metrics ---------- */

/** Groups of optional skill-table columns. The skill, its value and its share always show. */
export const METRIC_GROUPS = [
  'pace',
  'uses',
  'crit',
  'position',
  'special',
  'size',
  'timing',
] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

/** The column keys of each group, in table order. */
export const METRIC_COLUMNS: Record<MetricGroup, readonly string[]> = {
  pace: ['ps'],
  uses: ['casts', 'hits', 'direct'],
  crit: ['crit'],
  position: ['back', 'front'],
  special: ['perfect', 'double', 'parry', 'multi'],
  size: ['min', 'avg', 'max'],
  timing: ['gap', 'charge'],
};

/** What a breakdown opens with: output rate, uses, crit rate and hit size. */
export const DEFAULT_METRICS: readonly MetricGroup[] = ['pace', 'uses', 'crit', 'size'];

const ALWAYS_SHOWN = ['skill', 'value', 'share'];

/** Keys of the columns to show for a choice of groups. */
export function visibleColumns(groups: readonly MetricGroup[]): Set<string> {
  return new Set([...ALWAYS_SHOWN, ...groups.flatMap((group) => METRIC_COLUMNS[group])]);
}

/** A stored choice of groups, in canonical order; anything unreadable is the default. */
export function parseMetrics(raw: string | null): MetricGroup[] {
  if (raw === null) return [...DEFAULT_METRICS];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [...DEFAULT_METRICS];
    return METRIC_GROUPS.filter((group) => value.includes(group));
  } catch {
    return [...DEFAULT_METRICS];
  }
}

export const sameMetrics = (a: readonly MetricGroup[], b: readonly MetricGroup[]) =>
  a.length === b.length && METRIC_GROUPS.every((group) => a.includes(group) === b.includes(group));

/* ---------- Skill rows ---------- */

export type SkillKind = 'damage' | 'heal';

const valueOf = (kind: SkillKind) => (skill: Pick<ReportSkill, 'damage' | 'healing'>) =>
  kind === 'damage' ? skill.damage : skill.healing;

export interface SkillTable {
  /** Skills with damage (or healing) in the selection, largest first. */
  output: SkillRow[];
  /**
   * Skills that were cast but dealt nothing of either kind: buffs, stances, activations.
   * Listed only on request, so they never crowd the damage rows.
   */
  castOnly: SkillRow[];
}

/**
 * A player's skill rows for one kind. `derived` are rows recomputed from recorded events
 * (a target or time filter); without them native's whole-fight totals are used. Names and
 * specialties always come from native's rows. A healing skill is never cast-only in the
 * damage table (nor a damage skill in the healing table): it has output, of the other kind.
 */
export function skillTable(
  player: ReportPlayer,
  kind: SkillKind,
  derived: SkillRow[] | null = null,
): SkillTable {
  const value = valueOf(kind);
  const other = valueOf(kind === 'damage' ? 'heal' : 'damage');
  const native = new Map(player.skills.map((skill) => [key(skill.id), skill]));
  const total = player.skills.reduce((sum, skill) => sum + value(skill), 0);
  const rows =
    derived?.map((row) => {
      const known = native.get(key(row.id));
      return known ? { ...row, name: known.name, specialties: known.specialties } : row;
    }) ??
    player.skills.map((skill): SkillRow => ({
      ...skill,
      share: total ? value(skill) / total : null,
      derived: false,
    }));
  return {
    output: rows.filter((row) => value(row) > 0).sort((a, b) => value(b) - value(a)),
    castOnly: rows.filter(
      (row) =>
        value(row) === 0 && (row.casts ?? 0) > 0 && other(native.get(key(row.id)) ?? row) === 0,
    ),
  };
}

/** Rows whose shown name (or identifier) contains the query, ignoring case and spacing. */
export function searchSkills<Row extends { id: EntityId }>(
  rows: Row[],
  query: string,
  name: (row: Row) => string,
): Row[] {
  const needle = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) => name(row).toLowerCase().includes(needle) || key(row.id).includes(needle),
  );
}

/* ---------- Skill order ---------- */

/** What a skill list can be ordered by: its value, its name, or one of the shown metrics. */
export const SKILL_SORTS = [
  'value',
  'name',
  'casts',
  'hits',
  'direct',
  'crit',
  'back',
  'front',
  'perfect',
  'double',
  'parry',
  'multi',
  'min',
  'avg',
  'max',
  'gap',
] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];
export interface SkillOrder {
  key: SkillSort;
  desc: boolean;
}

/** What a breakdown opens ordered by: the largest damage (or healing) first. */
export const DEFAULT_ORDER: SkillOrder = { key: 'value', desc: true };

/**
 * The orders on offer for a choice of metric groups: value and name always, and a metric
 * only while its group shows, so a list is never ordered by a figure it does not print.
 */
export function sortOptions(groups: readonly MetricGroup[]): SkillSort[] {
  const shown = visibleColumns(groups);
  return SKILL_SORTS.filter((sort) => sort === 'value' || sort === 'name' || shown.has(sort));
}

const rateOf = (part: number | null, whole: number | null) =>
  part === null || !whole ? null : part / whole;

/** The figure a skill is ordered by; null (unknown) always sorts last. */
function sortValue(row: SkillRow, sort: Exclude<SkillSort, 'name'>, kind: SkillKind) {
  switch (sort) {
    case 'value':
      return valueOf(kind)(row);
    case 'casts':
      return row.casts;
    case 'hits':
      return row.hits;
    case 'direct':
      return row.direct_hits;
    case 'crit':
      return rateOf(row.crits, row.critical_hits_observed);
    case 'multi':
      return rateOf(row.multi, row.direct_hits ?? row.hits);
    case 'min':
      return row.min;
    case 'avg':
      return row.avg;
    case 'max':
      return row.hits ? row.max : null;
    case 'gap':
      return row.cast_gap_ms;
    default:
      return rateOf(row[sort], row.flags_observed);
  }
}

/** Skill rows in the chosen order. Rows without the figure keep their order, at the end. */
export function sortSkills(
  rows: SkillRow[],
  order: SkillOrder,
  kind: SkillKind,
  name: (row: SkillRow) => string,
): SkillRow[] {
  const { key: sort, desc } = order;
  return [...rows].sort((a, b) => {
    if (sort === 'name') {
      const byName = name(a).localeCompare(name(b));
      return desc ? -byName : byName;
    }
    const x = sortValue(a, sort, kind);
    const y = sortValue(b, sort, kind);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return desc ? y - x : x - y;
  });
}

/* ---------- One skill's recorded hits ---------- */

export interface SkillHitFilter {
  source: EntityId;
  skill: EntityId;
  kind: SkillKind;
  target?: EntityId | null;
  window?: TimeWindow | null;
}

/** The recorded damage (or heal) events of one skill of one player, in time order. */
export function skillHits(report: CombatReport, filter: SkillHitFilter): ReportEvent[] {
  const { window } = filter;
  return report.events.filter(
    (e) =>
      e.kind === filter.kind &&
      sameId(e.source, filter.source) &&
      sameId(e.skill, filter.skill) &&
      (filter.target === null || filter.target === undefined || sameId(e.target, filter.target)) &&
      (!window || (e.at_ms >= window.from && e.at_ms <= window.to)),
  );
}

/** Decoded results a hit list can be narrowed to. */
export const HIT_RESULTS = [
  'critical',
  'normal',
  'back',
  'front',
  'perfect',
  'double',
  'parry',
  'tick',
  'multi',
] as const;
export type HitResult = (typeof HIT_RESULTS)[number];

/**
 * Whether a hit has a result. Only decoded flags count: `normal` is a direct hit whose crit
 * flag was decoded as false, never a hit whose flag is simply unknown.
 */
export function hitHas(hit: ReportEvent, result: HitResult): boolean {
  switch (result) {
    case 'critical':
      return hit.critical === true && !hit.tick;
    case 'normal':
      return hit.critical === false && !hit.tick;
    case 'tick':
      return hit.tick === true;
    case 'multi':
      return (hit.hit_count ?? 1) > 1;
    default:
      return hit[result] === true;
  }
}

/** The results that occur among these hits, in a fixed order. */
export const hitResults = (hits: ReportEvent[]): HitResult[] =>
  HIT_RESULTS.filter((result) => hits.some((hit) => hitHas(hit, result)));

export interface HitSummary {
  count: number;
  total: number;
  /** Null without hits. */
  min: number | null;
  avg: number | null;
  max: number | null;
  /** Hits that were not periodic ticks. */
  direct: number;
  ticks: number;
  /** Direct hits whose crit flag was decoded: the crit rate's denominator. */
  critObserved: number;
  crits: number;
  /** Hits whose position flags were decoded: the denominator of the flags below. */
  flagsObserved: number;
  back: number;
  front: number;
  perfect: number;
  double: number;
  parry: number;
  /** Events that landed more than once. */
  multi: number;
}

/** Totals over a list of hits, with the same denominators as the skill table. */
export function summarizeHits(hits: ReportEvent[]): HitSummary {
  const amounts = hits.map((hit) => hit.amount ?? 0);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const count = (match: (hit: ReportEvent) => boolean) => hits.filter(match).length;
  const present = (flag: boolean | null | undefined) => flag !== null && flag !== undefined;
  return {
    count: hits.length,
    total,
    min: hits.length ? amounts.reduce((min, amount) => Math.min(min, amount), Infinity) : null,
    avg: hits.length ? total / hits.length : null,
    max: hits.length ? amounts.reduce((max, amount) => Math.max(max, amount), -Infinity) : null,
    direct: count((hit) => !hit.tick),
    ticks: count((hit) => hit.tick === true),
    critObserved: count((hit) => !hit.tick && present(hit.critical)),
    crits: count((hit) => hitHas(hit, 'critical')),
    flagsObserved: count((hit) => present(hit.back)),
    back: count((hit) => hit.back === true),
    front: count((hit) => hit.front === true),
    perfect: count((hit) => hit.perfect === true),
    double: count((hit) => hit.double === true),
    parry: count((hit) => hit.parry === true),
    multi: count((hit) => hitHas(hit, 'multi')),
  };
}

/** Pages of a long list: the page clamped into range, its slice and the page count. */
export function paginate<Item>(items: Item[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { page: current, pages, items: items.slice(current * size, current * size + size) };
}

/* ---------- Buff uptime ---------- */

export interface BuffUptimeRow {
  key: string;
  skill: EntityId;
  target: EntityId | null;
  /** Applications that overlap the window. */
  applications: number;
  /** Applications whose end was never observed. */
  openEnds: number;
  /** Time covered by applications whose end was observed (overlaps counted once). */
  confirmedMs: number;
  /** Share of the window the confirmed time covers. */
  confirmedShare: number;
  /**
   * Further time from applications without an observed end, counted through the report end.
   * An upper bound: the buff may have ended earlier.
   */
  openMs: number;
  /** Confirmed plus open time over the window: the most the buff can have been up. */
  upperShare: number;
  /** Mean full length of the applications whose end was observed; null without any. */
  avgClosedMs: number | null;
}

/** Numeric uptime of buff lanes over a window, confirmed time kept apart from open ends. */
export function buffUptime(lanes: BuffLane[], window: TimeWindow): BuffUptimeRow[] {
  const span = Math.max(1, window.to - window.from);
  return lanes.map((lane) => {
    const closed = lane.spans.flatMap((s) => (s.end_ms === null ? [] : [s.end_ms - s.start_ms]));
    return {
      key: lane.key,
      skill: lane.skill,
      target: lane.target,
      applications: lane.applications,
      openEnds: lane.spans.length - closed.length,
      confirmedMs: lane.uptimeMs,
      confirmedShare: Math.min(1, lane.uptimeMs / span),
      openMs: lane.openMs,
      upperShare: Math.min(1, (lane.uptimeMs + lane.openMs) / span),
      avgClosedMs: closed.length
        ? closed.reduce((sum, length) => sum + length, 0) / closed.length
        : null,
    };
  });
}

/**
 * The buffs one entity carried over a window, the longest confirmed uptime first and, among
 * equals, the larger upper bound. The figures are `buffUptime`'s: time whose end was never
 * observed stays apart from the confirmed time.
 */
export function carriedBuffs(
  report: CombatReport,
  carrier: EntityId,
  window: TimeWindow,
): BuffUptimeRow[] {
  const lanes = buffLanes(report, window, (span) => sameId(span.target, carrier));
  return buffUptime(lanes, window).sort(
    (a, b) => b.confirmedShare - a.confirmedShare || b.upperShare - a.upperShare,
  );
}

/* ---------- Boss hit activity ---------- */

/** Length of one activity bin. */
export const ACTIVITY_BIN_MS = 1000;

export interface ActivitySegment {
  from: number;
  to: number;
  active: boolean;
}

export interface BossActivity {
  /** The measured span: the window, starting no earlier than the retained events. */
  from: number;
  to: number;
  activeMs: number;
  gapMs: number;
  /** Active share of the measured span; null when the span is empty. */
  share: number | null;
  /** The longest stretch without a hit; null when there was none. */
  longestGap: ActivitySegment | null;
  /** Alternating active and gap stretches covering the measured span. */
  segments: ActivitySegment[];
}

/** Targets native knows as a boss or a training dummy. */
export const bossTargetIds = (report: ReportTotals) =>
  new Set(report.targets.filter((t) => t.boss === true || t.dummy === true).map((t) => key(t.id)));

/**
 * How steadily each player kept hitting the boss. The method is deliberately plain: the
 * window is cut into one-second bins on the fight clock, and a bin is active for a player
 * when at least one of their recorded damage events (direct or periodic, above zero) landed
 * on a boss or training dummy in it. Hits on other monsters or on players never count.
 * Stretches of inactive bins are gaps. The span starts no earlier than the events the
 * report retains, so a truncated live report is never read as a gap. Null when the fight
 * has no boss or dummy.
 */
export function bossActivity(
  report: CombatReport,
  sources: EntityId[],
  window: TimeWindow,
): Map<string, BossActivity> | null {
  const bosses = bossTargetIds(report);
  if (!bosses.size) return null;
  const from = Math.min(window.to, Math.max(window.from, detailStart(report)));
  const to = Math.max(from, window.to);
  const first = Math.floor(from / ACTIVITY_BIN_MS);
  const last = Math.max(first, Math.ceil(to / ACTIVITY_BIN_MS) - 1);
  const bins = new Map(sources.map((id) => [key(id), new Set<number>()]));
  for (const e of report.events) {
    if (e.kind !== 'damage' || e.at_ms < from || e.at_ms > to) continue;
    if ((e.amount ?? 0) <= 0 || !bosses.has(key(e.target))) continue;
    bins.get(key(e.source))?.add(Math.min(last, Math.floor(e.at_ms / ACTIVITY_BIN_MS)));
  }
  const result = new Map<string, BossActivity>();
  for (const [id, active] of bins) {
    const segments: ActivitySegment[] = [];
    if (to > from)
      for (let bin = first; bin <= last; bin++) {
        const start = Math.max(from, bin * ACTIVITY_BIN_MS);
        const end = Math.min(to, (bin + 1) * ACTIVITY_BIN_MS);
        const previous = segments.at(-1);
        if (previous && previous.active === active.has(bin)) previous.to = end;
        else segments.push({ from: start, to: end, active: active.has(bin) });
      }
    const activeMs = segments.reduce((sum, s) => sum + (s.active ? s.to - s.from : 0), 0);
    const gaps = segments.filter((s) => !s.active);
    result.set(id, {
      from,
      to,
      activeMs,
      gapMs: to - from - activeMs,
      share: to > from ? activeMs / (to - from) : null,
      longestGap: gaps.reduce<ActivitySegment | null>(
        (longest, gap) =>
          !longest || gap.to - gap.from > longest.to - longest.from ? gap : longest,
        null,
      ),
      segments,
    });
  }
  return result;
}
