import { describe, expect, it } from 'vitest';
import { buffLanes, fullWindow, skillStatsFromEvents } from './analysis';
import {
  bossActivity,
  buffUptime,
  carriedBuffs,
  DEFAULT_METRICS,
  DEFAULT_ORDER,
  hitHas,
  hitResults,
  METRIC_GROUPS,
  paginate,
  parseMetrics,
  sameMetrics,
  searchSkills,
  skillHits,
  skillTable,
  sortOptions,
  sortSkills,
  summarizeHits,
  visibleColumns,
  type SkillSort,
} from './breakdown';
import { nativeReport, report } from './fixtures';

const [aria, bryn] = nativeReport.players;
const SNIPE = 11000101;
const VOLLEY = 11000201;
const names = (rows: { name: string | null }[]) => rows.map((row) => row.name);

describe('skill table metrics', () => {
  it('always shows the skill, its value and its share, then the chosen groups', () => {
    expect([...visibleColumns([])]).toEqual(['skill', 'value', 'share']);
    const shown = visibleColumns(DEFAULT_METRICS);
    for (const column of ['ps', 'casts', 'hits', 'direct', 'crit', 'min', 'avg', 'max'])
      expect(shown.has(column)).toBe(true);
    for (const column of ['back', 'front', 'perfect', 'double', 'parry', 'multi', 'gap', 'charge'])
      expect(shown.has(column)).toBe(false);
    expect(visibleColumns(METRIC_GROUPS).size).toBe(19);
  });

  it('reads a stored choice in canonical order and falls back to the default', () => {
    expect(parseMetrics(JSON.stringify(['timing', 'crit', 'made-up']))).toEqual(['crit', 'timing']);
    // Choosing nothing is a choice: only the three fixed columns show.
    expect(parseMetrics('[]')).toEqual([]);
    for (const broken of [null, 'not json', '{"crit":true}'])
      expect(parseMetrics(broken)).toEqual([...DEFAULT_METRICS]);
    expect(sameMetrics(['size', 'pace', 'crit', 'uses'], DEFAULT_METRICS)).toBe(true);
    expect(sameMetrics(['pace'], DEFAULT_METRICS)).toBe(false);
  });
});

describe('skill rows', () => {
  const withExtras = report({
    players: [
      {
        ...aria!,
        healing: 400,
        skills: [
          ...aria!.skills,
          { id: 11000900, name: 'Focus Stance', casts: 4 },
          { id: 11000950, name: 'Field Dressing', healing: 400, casts: 2, hits: 2 },
        ],
      },
      bryn!,
    ],
  });
  const player = withExtras.players[0]!;

  it('keeps cast-only skills apart from skills with output', () => {
    const damage = skillTable(player, 'damage');
    expect(names(damage.output)).toEqual(['Snipe', 'Volley']);
    // A heal has output of the other kind, and a skill only received (Claw) was never cast.
    expect(names(damage.castOnly)).toEqual(['Focus Stance']);
    expect(damage.output[0]!.share).toBeCloseTo(6000 / 9000);
    const heal = skillTable(player, 'heal');
    expect(names(heal.output)).toEqual(['Field Dressing']);
    expect(names(heal.castOnly)).toEqual(['Focus Stance']);
  });

  it('names rows recomputed from events as native does and keeps their specialties', () => {
    const derived = skillStatsFromEvents(withExtras, {
      source: player.id,
      window: { from: 0, to: 1500 },
    });
    const table = skillTable(player, 'damage', derived);
    expect(table.output).toHaveLength(1);
    expect(table.output[0]).toMatchObject({ name: 'Snipe', damage: 1000, derived: true });
    expect(table.output[0]!.specialties).toHaveLength(1);
    // Volley's hits are outside the window: no row at all, never a zero row.
    expect(table.castOnly).toEqual([]);
  });

  it('searches by shown name or identifier, ignoring case and spacing', () => {
    const rows = skillTable(player, 'damage').output;
    const label = (row: { name: string | null }) => row.name ?? '';
    expect(names(searchSkills(rows, '  SNI ', label))).toEqual(['Snipe']);
    expect(names(searchSkills(rows, String(VOLLEY), label))).toEqual(['Volley']);
    expect(searchSkills(rows, 'nothing', label)).toEqual([]);
    expect(searchSkills(rows, '   ', label)).toBe(rows);
  });
});

describe('recorded hits of one skill', () => {
  const fight = report();

  it('lists only that player, skill, kind, target and window', () => {
    const snipe = skillHits(fight, { source: 1, skill: SNIPE, kind: 'damage' });
    expect(snipe.map((hit) => [hit.at_ms, hit.amount])).toEqual([
      [1100, 1000],
      [6100, 5000],
    ]);
    // Casts of the skill are not hits, and another player's or target's hits never leak in.
    expect(skillHits(fight, { source: 2, skill: SNIPE, kind: 'damage' })).toEqual([]);
    expect(skillHits(fight, { source: 1, skill: SNIPE, kind: 'damage', target: 1 })).toEqual([]);
    expect(skillHits(fight, { source: 1, skill: SNIPE, kind: 'heal' })).toEqual([]);
    expect(
      skillHits(fight, {
        source: 1,
        skill: SNIPE,
        kind: 'damage',
        target: 50,
        window: { from: 5000, to: 7000 },
      }).map((hit) => hit.at_ms),
    ).toEqual([6100]);
  });

  it('summarizes hits over decoded flags only', () => {
    const snipe = summarizeHits(skillHits(fight, { source: 1, skill: SNIPE, kind: 'damage' }));
    expect(snipe).toMatchObject({
      count: 2,
      total: 6000,
      min: 1000,
      avg: 3000,
      max: 5000,
      direct: 2,
      ticks: 0,
      critObserved: 2,
      crits: 1,
      flagsObserved: 2,
      back: 1,
      front: 0,
    });
    // Volley: one direct hit without any flag and one tick. Nothing was decoded, so the
    // denominators are zero rather than the hit count.
    const volley = summarizeHits(skillHits(fight, { source: 1, skill: VOLLEY, kind: 'damage' }));
    expect(volley).toMatchObject({
      count: 2,
      direct: 1,
      ticks: 1,
      critObserved: 0,
      crits: 0,
      flagsObserved: 0,
    });
    expect(summarizeHits([])).toMatchObject({ count: 0, min: null, avg: null, max: null });
  });

  it('summarizes a long fight without exceeding the function argument limit', () => {
    const hits = Array.from({ length: 200_000 }, (_, index) => ({
      at_ms: index,
      kind: 'damage',
      amount: index + 1,
    }));
    expect(summarizeHits(hits)).toMatchObject({
      count: 200_000,
      min: 1,
      max: 200_000,
      avg: 100_000.5,
    });
  });

  it('never calls an undecoded hit normal, nor a critical tick a crit', () => {
    const hit = { at_ms: 0, kind: 'damage' };
    expect(hitHas({ ...hit, critical: false }, 'normal')).toBe(true);
    expect(hitHas({ ...hit, critical: null }, 'normal')).toBe(false);
    expect(hitHas(hit, 'normal')).toBe(false);
    expect(hitHas({ ...hit, critical: true, tick: true }, 'critical')).toBe(false);
    expect(hitHas({ ...hit, hit_count: 3 }, 'multi')).toBe(true);
    expect(hitHas({ ...hit, hit_count: 1 }, 'multi')).toBe(false);
    const hits = skillHits(fight, { source: 1, skill: SNIPE, kind: 'damage' });
    expect(hitResults(hits)).toEqual(['critical', 'normal', 'back']);
    expect(hitResults(skillHits(fight, { source: 1, skill: VOLLEY, kind: 'damage' }))).toEqual([
      'tick',
    ]);
  });

  it('pages a long list and clamps the page into range', () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    expect(paginate(items, 0, 50)).toMatchObject({ page: 0, pages: 3 });
    expect(paginate(items, 2, 50).items).toEqual(items.slice(100));
    expect(paginate(items, 9, 50).page).toBe(2);
    expect(paginate([], 4, 50)).toEqual({ page: 0, pages: 1, items: [] });
  });
});

describe('boss hit activity', () => {
  const fight = report();
  const whole = fullWindow(fight);

  it('counts one-second bins with a hit on the boss as active', () => {
    const activity = bossActivity(fight, [1, 2], whole)!;
    const mine = activity.get('1')!;
    // Aria hit the boss at 1.1 s, 2.0 s, 2.3 s and 6.1 s: bins 1, 2 and 6.
    expect(mine.segments).toEqual([
      { from: 0, to: 1000, active: false },
      { from: 1000, to: 3000, active: true },
      { from: 3000, to: 6000, active: false },
      { from: 6000, to: 7000, active: true },
      { from: 7000, to: 30_000, active: false },
    ]);
    expect(mine).toMatchObject({ activeMs: 3000, gapMs: 27_000 });
    expect(mine.share).toBeCloseTo(0.1);
    expect(mine.longestGap).toEqual({ from: 7000, to: 30_000, active: false });
    // Bryn never hit the boss: one gap, not an unknown.
    expect(activity.get('2')).toMatchObject({ activeMs: 0, gapMs: 30_000, share: 0 });
  });

  it('never counts hits on other monsters or on players', () => {
    const noise = report({
      targets: [
        ...nativeReport.targets,
        { id: 51, npc_id: 901, name: 'Elyos Scout', boss: false, dummy: false, damage: 500 },
      ],
      events: [
        ...nativeReport.events,
        { at_ms: 10_000, kind: 'damage', source: 1, target: 51, skill: SNIPE, amount: 500 },
        { at_ms: 12_000, kind: 'damage', source: 1, target: 2, skill: SNIPE, amount: 500 },
        { at_ms: 14_000, kind: 'heal', source: 1, target: 50, skill: SNIPE, amount: 500 },
        { at_ms: 16_000, kind: 'damage', source: 1, target: 50, skill: SNIPE, amount: 0 },
      ],
    });
    expect(bossActivity(noise, [1], fullWindow(noise))!.get('1')!.activeMs).toBe(3000);
  });

  it('measures only the selected window, clipping the bins at its edges', () => {
    const mine = bossActivity(fight, [1], { from: 2500, to: 6500 })!.get('1')!;
    // The partial first bin joins the gap after it; the last bin ends with the window.
    expect(mine.segments).toEqual([
      { from: 2500, to: 6000, active: false },
      { from: 6000, to: 6500, active: true },
    ]);
    expect(mine).toMatchObject({ from: 2500, to: 6500, activeMs: 500, gapMs: 3500 });
    expect(mine.longestGap).toEqual({ from: 2500, to: 6000, active: false });
  });

  it('starts at the retained events of a truncated live report, never calling the rest a gap', () => {
    const live = report({ events_truncated: true, event_window_start_ms: 5200 });
    const mine = bossActivity(live, [1], fullWindow(live))!.get('1')!;
    expect(mine.from).toBe(5200);
    expect(mine.segments[0]).toEqual({ from: 5200, to: 6000, active: false });
    expect(mine.activeMs).toBe(1000);
    expect(mine.gapMs).toBe(30_000 - 5200 - 1000);
    // A window wholly before the retained events measures nothing.
    expect(bossActivity(live, [1], { from: 0, to: 4000 })!.get('1')).toMatchObject({
      from: 4000,
      to: 4000,
      share: null,
      segments: [],
      longestGap: null,
    });
  });

  it('is unavailable without a boss or training dummy, and counts a dummy like a boss', () => {
    const trash = { ...nativeReport.targets[0]!, boss: false, dummy: false };
    expect(bossActivity(report({ targets: [trash] }), [1], whole)).toBeNull();
    const dummy = report({ targets: [{ ...trash, dummy: true }] });
    expect(bossActivity(dummy, [1], whole)!.get('1')!.activeMs).toBe(3000);
  });
});

describe('buff uptime', () => {
  const fight = report();
  const whole = fullWindow(fight);

  it('keeps confirmed time apart from applications whose end was not observed', () => {
    const rows = buffUptime(buffLanes(fight, whole), whole);
    const closed = rows.find((row) => row.skill === 500)!;
    expect(closed).toMatchObject({
      applications: 1,
      openEnds: 0,
      confirmedMs: 2500,
      openMs: 0,
      avgClosedMs: 2500,
    });
    expect(closed.confirmedShare).toBeCloseTo(2500 / 30_000);
    expect(closed.upperShare).toBe(closed.confirmedShare);
    // Applied at 5.5 s and never seen to end: none of its time is confirmed.
    const open = rows.find((row) => row.skill === 600)!;
    expect(open).toMatchObject({
      applications: 1,
      openEnds: 1,
      confirmedMs: 0,
      confirmedShare: 0,
      openMs: 24_500,
      avgClosedMs: null,
    });
    expect(open.upperShare).toBeCloseTo(24_500 / 30_000);
  });

  it('counts overlapping applications once and clips to the window', () => {
    const stacked = report({
      buffs: [
        { source: 2, target: 1, skill: 500, instance: 1, start_ms: 0, end_ms: 4000 },
        { source: 2, target: 1, skill: 500, instance: 2, start_ms: 2000, end_ms: 6000 },
        { source: 2, target: 1, skill: 500, instance: 3, start_ms: 9000, end_ms: null },
      ],
    });
    const window = { from: 1000, to: 11_000 };
    const [row] = buffUptime(buffLanes(stacked, window), window);
    expect(row).toMatchObject({
      applications: 3,
      openEnds: 1,
      confirmedMs: 5000,
      openMs: 2000,
      avgClosedMs: 4000,
    });
    expect(row!.confirmedShare).toBeCloseTo(0.5);
    expect(row!.upperShare).toBeCloseTo(0.7);
  });
});

describe('buffs a player carried', () => {
  const carried = report({
    buffs: [
      ...nativeReport.buffs,
      { source: 2, target: 1, skill: 700, instance: 5, start_ms: 8000, end_ms: 20_000 },
      { source: 2, target: 1, skill: 800, instance: 6, start_ms: 5500, end_ms: null },
    ],
  });
  const whole = fullWindow(carried);

  it('lists only the buffs on that player, the longest confirmed uptime first', () => {
    const rows = carriedBuffs(carried, 1, whole);
    // The mark Aria put on the boss (600) is not one she carried.
    expect(rows.map((row) => row.skill)).toEqual([700, 500, 800]);
    expect(rows[0]!.confirmedMs).toBe(12_000);
    // An open end is never confirmed time, however long it may have lasted.
    expect(rows[2]).toMatchObject({ confirmedMs: 0, openEnds: 1, openMs: 24_500 });
    expect(carriedBuffs(carried, 2, whole)).toEqual([]);
  });

  it('follows the window', () => {
    const rows = carriedBuffs(carried, 1, { from: 7500, to: 22_500 });
    expect(rows.map((row) => row.skill)).toEqual([700, 800]);
    expect(rows[0]!.confirmedShare).toBeCloseTo(0.8);
  });
});

describe('skill order', () => {
  const player = report().players[0]!;
  const rows = skillTable(player, 'damage').output;
  const label = (row: { name: string | null }) => row.name ?? '';
  const ordered = (key: SkillSort, desc: boolean) =>
    names(sortSkills(rows, { key, desc }, 'damage', label));

  it('offers the value and the name always, a metric only while its group shows', () => {
    expect(sortOptions([])).toEqual(['value', 'name']);
    expect(sortOptions(DEFAULT_METRICS)).toEqual([
      'value',
      'name',
      'casts',
      'hits',
      'direct',
      'crit',
      'min',
      'avg',
      'max',
    ]);
    // The rate per second follows the value and a charge level has no order of its own.
    expect(sortOptions(METRIC_GROUPS)).toHaveLength(16);
    expect(sortOptions(['timing'])).toEqual(['value', 'name', 'gap']);
  });

  it('orders by value, by name and by a figure, either way', () => {
    expect(ordered(DEFAULT_ORDER.key, DEFAULT_ORDER.desc)).toEqual(['Snipe', 'Volley']);
    expect(ordered('value', false)).toEqual(['Volley', 'Snipe']);
    expect(ordered('name', true)).toEqual(['Volley', 'Snipe']);
    expect(ordered('min', true)).toEqual(['Snipe', 'Volley']);
    expect(ordered('avg', false)).toEqual(['Volley', 'Snipe']);
  });

  it('keeps a skill without the figure last, whichever way the order runs', () => {
    // No cast packet and no crit flag was observed for Volley: unknown, never a zero.
    for (const key of ['casts', 'crit', 'gap', 'back'] as const) {
      expect(ordered(key, true)).toEqual(['Snipe', 'Volley']);
      expect(ordered(key, false)).toEqual(['Snipe', 'Volley']);
    }
  });

  it('never reorders the rows it was given', () => {
    const before = names(rows);
    sortSkills(rows, { key: 'value', desc: false }, 'damage', label);
    expect(names(rows)).toEqual(before);
  });
});
