import { getI18n } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import {
  bossProjection,
  buffLanes,
  buffsPerSkill,
  castDetail,
  castsFor,
  critRate,
  damageSeries,
  deathRecaps,
  dummyTimer,
  flagRate,
  fullWindow,
  Names,
  opener,
  partyDps,
  primaryTarget,
  skillRowsFromPlayer,
  skillStatsFromEvents,
} from './analysis';
import { report } from './fixtures';

// The test setup's real engine; fixed translators never change its current language.
const en = getI18n().getFixedT('en', 'reports');
const pt = getI18n().getFixedT('pt-BR', 'reports');

describe('rates use observed denominators', () => {
  it('divides crits by observed crit flags and positionals by observed flags', () => {
    const aria = report().players[0]!;
    expect(critRate(aria)).toBe(0.5);
    expect(flagRate(aria, 'back')).toBe(0.5);
    const volley = aria.skills[1]!;
    // No observed crit flag: unavailable, not 0%.
    expect(critRate(volley)).toBeNull();
    expect(flagRate(volley, 'back')).toBeNull();
  });

  it('recomputes from events for a window, excluding ticks from crit denominators', () => {
    const r = report();
    const rows = skillStatsFromEvents(r, { source: 1, window: { from: 0, to: 3000 } });
    const volley = rows.find((row) => row.id === 11000201)!;
    expect(volley.hits).toBe(2);
    expect(volley.direct_hits).toBe(1);
    expect(volley.critical_hits_observed).toBeNull();
    expect(volley.crits).toBeNull();
    // Without a cast packet for this skill, casts are unknown rather than zero.
    expect(volley.casts).toBeNull();
    const snipe = rows.find((row) => row.id === 11000101)!;
    expect(snipe.casts).toBe(1);
    expect(snipe.back).toBe(1);
    expect(flagRate(snipe, 'back')).toBe(1);
  });

  it('keeps native totals when unfiltered and leaves out received-only skills', () => {
    const rows = skillRowsFromPlayer(report().players[0]!);
    expect(rows.map((s) => s.name)).toEqual(['Snipe', 'Volley']);
    expect(rows[0]!.share).toBeCloseTo(6000 / 9000);
  });
});

describe('rotation', () => {
  it('uses cast packets per skill and marks hit-only skills as an attack sequence', () => {
    const casts = castsFor(report(), 1);
    expect(casts.map((c) => [c.at_ms, c.skill, c.fromHits])).toEqual([
      [1000, 11000101, false],
      [2000, 11000201, true],
      [6000, 11000101, false],
    ]);
    expect(opener(casts, 3000)).toHaveLength(2);
  });

  it('collects a cast’s hits, direct crit denominator and effects active at that moment', () => {
    const r = report();
    const names = new Names(r, { hideNames: false, t: en });
    const casts = castsFor(r, 1);
    const first = castDetail(r, casts, 0, 1, names)!;
    expect(first.hits).toHaveLength(1);
    expect(first.critObserved).toBe(1);
    expect(first.crits).toBe(0);
    expect(first.windowEstimated).toBe(false);
    expect(first.effects.map((e) => e.scope)).toEqual(['self']);
    expect(first.targetHp?.current).toBe(10000);
    const last = castDetail(r, casts, 2, 1, names)!;
    expect(last.windowEstimated).toBe(true);
    expect(last.effects.find((e) => e.scope === 'target')?.remainingMs).toBeNull();
  });
});

describe('buffs', () => {
  it('separates verified uptime from spans whose end was not observed', () => {
    const r = report();
    const lanes = buffLanes(r, fullWindow(r));
    const open = lanes.find((l) => l.skill === 600)!;
    expect(open.uptimeMs).toBe(0);
    expect(open.openMs).toBe(r.duration_ms - 5500);
    expect(lanes.find((l) => l.skill === 500)!.uptimeMs).toBe(2500);
  });

  it('measures real overlap of hits with buffs and flags open-ended ones', () => {
    const rows = buffsPerSkill(report(), 1);
    const snipe = rows.find((row) => row.skill === 11000101)!;
    const self = snipe.buffs.find((b) => b.scope === 'self')!;
    expect(self.hitShare).toBe(0.5);
    expect(self.damageShare).toBeCloseTo(1000 / 6000);
    expect(self.open).toBe(false);
    expect(snipe.buffs.find((b) => b.scope === 'target')!.open).toBe(true);
  });
});

describe('deaths, series and projections', () => {
  it('recaps only player deaths with full hit counts', () => {
    const r = report();
    const names = new Names(r, { hideNames: false, t: en });
    const recaps = deathRecaps(r, (id) => names.isPlayer(id));
    expect(recaps).toHaveLength(1);
    expect(recaps[0]).toMatchObject({
      entity: 1,
      hitCount: 1,
      hitTotal: 300,
      killer: 50,
      revivedAt: 7000,
    });
  });

  it('counts only player damage against non-players', () => {
    const series = damageSeries(report(), 1000);
    expect(series[3]).toBe(0);
    expect(series[1]).toBe(1000);
    expect(series.reduce((a, b) => a + b, 0)).toBe(9000);
  });

  it('projects boss state from observed facts only', () => {
    const r = report();
    const projection = bossProjection(r)!;
    expect(projection.target.name).toBe('Test Boss');
    expect(projection.ttkMs).toBe(0);
    expect(projection.beatsBerserk).toBe(true);
    expect(partyDps(r)).toBeCloseTo(10000 / 30);
    const alive = report({
      targets: [
        {
          id: 50,
          name: 'Test Boss',
          boss: true,
          max_hp: 10000,
          current_hp: 5000,
          damage: 5000,
          berserk_seconds: null,
        },
      ],
    });
    const live = bossProjection(alive)!;
    expect(live.dpsSource).toBe('hp');
    expect(live.dps).toBe(500);
    expect(live.ttkMs).toBe(10_000);
    // No catalogue berserk timer: no claim either way.
    expect(live.berserkMs).toBeNull();
    expect(live.beatsBerserk).toBeNull();
  });

  it('follows HP updates that carry only the current value', () => {
    // Native sends the max once at spawn, then current-only updates.
    const boss = (patch: Record<string, unknown>) => ({
      id: 50,
      name: 'Test Boss',
      boss: true,
      max_hp: 1000,
      current_hp: 600,
      damage: 400,
      berserk_seconds: null,
      ...patch,
    });
    const spawnThenUpdates = [
      { entity: 50, at_ms: 0, current: 1000, max: 1000 },
      { entity: 50, at_ms: 2000, current: 800, max: null },
      { entity: 50, at_ms: 4000, current: 600, max: null },
    ];
    const live = bossProjection(report({ targets: [boss({})], hp: spawnThenUpdates }))!;
    expect(live.current).toBe(600);
    expect(live.fraction).toBeCloseTo(0.6);
    // 400 HP over 4 s of observed samples.
    expect(live.dpsSource).toBe('hp');
    expect(live.dps).toBe(100);
    expect(live.ttkMs).toBe(6000);

    // A retained older sample never freezes the target's current HP.
    const spawnOnly = report({ targets: [boss({})], hp: spawnThenUpdates.slice(0, 1) });
    expect(bossProjection(spawnOnly)!.fraction).toBeCloseTo(0.6);

    // Zero HP, or native marking the target dead, is defeated whatever the samples say.
    for (const state of [{ current_hp: 0 }, { current_hp: null, dead: true }]) {
      const over = bossProjection(report({ targets: [boss(state)], hp: spawnThenUpdates }))!;
      expect(over.fraction).toBe(0);
      expect(over.ttkMs).toBe(0);
      expect(over.beatsBerserk).toBe(true);
    }
  });

  it('falls back to HP samples only for what the target does not report', () => {
    const legacy = report({
      targets: [{ id: 50, name: 'Old Boss', boss: true, damage: 200 }],
      hp: [
        { entity: 50, at_ms: 0, current: 1000, max: 1000 },
        { entity: 50, at_ms: 5000, current: 800, max: 1000 },
      ],
    });
    expect(bossProjection(legacy)!.fraction).toBeCloseTo(0.8);
    // Current HP without any known max has no fraction rather than an invalid one.
    const unknownMax = report({
      targets: [{ id: 50, name: 'Boss', boss: true, current_hp: 600, damage: 1 }],
      hp: [],
    });
    const projection = bossProjection(unknownMax)!;
    expect(projection.current).toBe(600);
    expect(projection.max).toBeNull();
    expect(projection.fraction).toBeNull();
  });

  it('moves on to the next living boss once the first one dies', () => {
    const first = { id: 50, name: 'First Boss', boss: true, max_hp: 1000, damage: 1000 };
    const second = { id: 51, name: 'Second Boss', boss: true, max_hp: 2000, damage: 300 };
    const dead = { ...first, current_hp: 0, dead: true };
    const transition = report({ targets: [dead, { ...second, current_hp: 1700 }], hp: [] });
    expect(primaryTarget(transition)?.name).toBe('Second Boss');
    expect(bossProjection(transition)!.fraction).toBeCloseTo(0.85);
    // Before the kill the most damaged living boss leads.
    const both = report({
      targets: [
        { ...first, current_hp: 10 },
        { ...second, current_hp: 1700 },
      ],
      hp: [],
    });
    expect(primaryTarget(both)?.name).toBe('First Boss');
    // Once every boss is dead the most damaged one stays, as before.
    const cleared = report({
      targets: [dead, { ...second, current_hp: 0, dead: true }],
      hp: [],
    });
    expect(primaryTarget(cleared)?.name).toBe('First Boss');
  });

  it('shows a dummy timer only for dummies with a configured length', () => {
    const dummy = report({ targets: [{ id: 50, name: 'Dummy', dummy: true, damage: 1 }] });
    expect(dummyTimer(dummy, 60)?.remainingMs).toBe(30_000);
    expect(dummyTimer(dummy, 0)).toBeNull();
    expect(dummyTimer(report(), 60)).toBeNull();
  });
});

describe('names', () => {
  it('keeps observed names verbatim and words app fallbacks in the interface language', () => {
    const r = report();
    const english = new Names(r, { hideNames: false, t: en });
    const portuguese = new Names(r, { hideNames: false, t: pt });
    expect(portuguese.entity(1)).toBe(english.entity(1));
    expect(english.entity(null)).toBe('Unknown');
    expect(portuguese.entity(null)).toBe('Desconhecido');
    expect(english.skill(999)).toBe('Skill #999');
    expect(portuguese.skill(999)).toBe('Habilidade #999');
    expect(portuguese.skill(null)).toBe('Habilidade desconhecida');
  });

  it('hides names behind the observed class and rank', () => {
    const r = report();
    const hidden = new Names(r, { hideNames: true, t: pt });
    const local = r.players.find((p) => p.local)!;
    const other = r.players.find((p) => !p.local && p.class)!;
    expect(hidden.entity(local.id)).toBe('Você');
    expect(hidden.entity(other.id)).toBe(`${other.class} ${r.players.indexOf(other) + 1}`);
  });
});
