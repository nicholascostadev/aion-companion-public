import { FRESH, LONG, RAID } from './mockScenario';
import type {
  LivePlayer,
  LiveStatus,
  Recording,
  RecordingEvent,
  ReplayPlayer,
  Snapshot,
} from '../types/companion';

/*
 * DEV ONLY (`?mock`). Deterministic combat data in this app's native wire shapes: a small
 * fictional party fighting bosses from the bundled NPC catalogue with skills that have
 * bundled original artwork. Every total is aggregated from the generated events, so the
 * meter, reports, timelines and comparisons agree with each other.
 */

/** Seeded PRNG (mulberry32): the same fights on every reload. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface SkillDef {
  id: number;
  name: string;
  /** Relative strength of one hit. */
  power: number;
  /** Relative chance to be used. */
  weight: number;
  /** Damage over time: one hit and four periodic ticks. */
  tick?: boolean;
  /** Hits per use (multi-hit). */
  hits?: number;
  heal?: boolean;
}

interface Hero {
  id: number;
  name: string;
  class: string;
  local?: boolean;
  server_id: number;
  level: number;
  gear_score: number;
  combat_power: number;
  /** Base damage of a power-1 hit. */
  power: number;
  /** Average ms between skill uses. */
  cadence: number;
  melee: boolean;
  tank?: boolean;
  skills: SkillDef[];
  buff?: { id: number; self: boolean; every: number; length: number };
}

const s = (
  id: number,
  name: string,
  power: number,
  weight: number,
  extra: Partial<SkillDef> = {},
): SkillDef => ({ id, name, power, weight, ...extra });

/** Fictional characters. Skill ids and names come from the bundled skill catalogue. */
export const ROSTER: Hero[] = [
  {
    id: 1,
    name: 'Lyrienne',
    class: 'Ranger',
    local: true,
    server_id: 2101,
    level: 45,
    gear_score: 2310,
    combat_power: 109_680,
    power: 4200,
    cadence: 1050,
    melee: false,
    skills: [
      s(14020000, 'Snipe', 2.6, 2),
      s(14010000, 'Deadshot', 3.4, 1),
      s(14030000, 'Rapid Fire', 0.9, 3, { hits: 3 }),
      s(14040000, 'Spiral Arrow', 1.4, 3),
      s(14060000, 'Griffon Arrow', 1.1, 2, { tick: true }),
      s(14080000, 'Burst Arrow', 1.8, 2),
      s(14100000, 'Tempest Arrow', 1.2, 1, { hits: 2 }),
    ],
  },
  {
    id: 2,
    name: 'Kaelthos',
    class: 'Gladiator',
    server_id: 2101,
    level: 45,
    gear_score: 2245,
    combat_power: 104_210,
    power: 3900,
    cadence: 1150,
    melee: true,
    skills: [
      s(11010000, 'Rending Blow', 1.3, 3),
      s(11020000, 'Keen Strike', 1.6, 3),
      s(11030000, 'Rupture Strike', 1.1, 2, { tick: true }),
      s(11040000, 'Wrathful Strike', 2.4, 1),
      s(11050000, 'Crushing Wave', 1.9, 2),
      s(11090000, 'Blade Dance', 0.8, 1, { hits: 4 }),
    ],
    buff: { id: 11110000, self: true, every: 30_000, length: 8_000 },
  },
  {
    id: 3,
    name: 'Seraphine',
    class: 'Cleric',
    server_id: 2101,
    level: 45,
    gear_score: 2160,
    combat_power: 93_800,
    power: 1700,
    cadence: 1300,
    melee: false,
    skills: [
      s(17060000, 'Bolt', 1.2, 3),
      s(17020000, 'Thunder and Lightning', 1.8, 2),
      s(17040000, 'Judgment Thunder', 2.4, 1),
      s(17100000, 'Healing Light', 2.2, 3, { heal: true }),
      s(17120000, 'Radiant Recovery', 3.6, 1, { heal: true }),
      s(17090000, 'Light of Regeneration', 1.1, 2, { heal: true, tick: true }),
    ],
    buff: { id: 17090000, self: false, every: 12_000, length: 9_000 },
  },
  {
    id: 4,
    name: 'Vexmora',
    class: 'Sorcerer',
    server_id: 2101,
    level: 45,
    gear_score: 2288,
    combat_power: 107_950,
    power: 4400,
    cadence: 1250,
    melee: false,
    skills: [
      s(15010000, 'Flame Scattershot', 1.2, 3),
      s(15020000, 'Firebomb', 1.9, 2),
      s(15030000, 'Burst', 2.8, 1),
      s(15040000, 'Firestorm', 1.0, 2, { hits: 3 }),
      s(15060000, 'Hellfire', 1.3, 2, { tick: true }),
      s(15090000, 'Ice Chain', 1.5, 2),
    ],
  },
  {
    id: 5,
    name: 'Dorrin',
    class: 'Templar',
    server_id: 2101,
    level: 45,
    gear_score: 1945,
    combat_power: 85_680,
    power: 2300,
    cadence: 1200,
    melee: true,
    tank: true,
    skills: [
      s(12010000, 'Vicious Strike', 1.2, 3),
      s(12020000, 'Decisive Strike', 1.6, 2),
      s(12040000, 'Pummel', 1.0, 2),
      s(12060000, 'Punishing Strike', 1.9, 1),
      s(12090000, 'Punishment', 1.1, 1, { tick: true }),
      s(12100000, 'Shield Smite', 1.4, 2),
    ],
    buff: { id: 12110000, self: false, every: 25_000, length: 10_000 },
  },
  {
    id: 6,
    name: 'Nyxalis',
    class: 'Assassin',
    server_id: 2102,
    level: 45,
    gear_score: 2198,
    combat_power: 99_420,
    power: 4000,
    cadence: 950,
    melee: true,
    skills: [
      s(13010000, 'Quick Slice', 0.9, 3),
      s(13030000, 'Breaking Slice', 1.3, 2),
      s(13050000, 'Flash Slice', 1.1, 2, { hits: 2 }),
      s(13060000, 'Ambush', 2.6, 1),
      s(13070000, 'Shadowstrike', 2.0, 2),
      s(13090000, 'Shadowblade Pursuit', 1.0, 1, { tick: true }),
    ],
    buff: { id: 13080000, self: true, every: 40_000, length: 6_000 },
  },
  {
    id: 7,
    name: 'Mirelle',
    class: 'Chanter',
    server_id: 2102,
    level: 45,
    gear_score: 2050,
    combat_power: 90_130,
    power: 2700,
    cadence: 1100,
    melee: true,
    skills: [
      s(18010000, 'Onslaught', 1.1, 3),
      s(18020000, 'Resonance Crush', 1.5, 2),
      s(18040000, 'Incandescent Blow', 1.8, 2),
      s(18060000, 'Impactful Crush', 1.3, 2),
      s(18090000, 'Rushing Smash', 2.1, 1),
    ],
  },
  {
    id: 8,
    name: 'Tovrak',
    class: 'Spiritmaster',
    server_id: 2102,
    level: 45,
    gear_score: 2120,
    combat_power: 95_600,
    power: 3600,
    cadence: 1300,
    melee: false,
    skills: [
      s(16010000, 'Cold Shock', 1.2, 3),
      s(16020000, 'Vacuum Explosion', 2.2, 1),
      s(16030000, 'Earth Tremor', 1.5, 2),
      s(16040000, 'Combustion', 1.0, 2, { tick: true }),
      s(16060000, 'Siphon', 1.3, 2),
    ],
  },
  {
    id: 9,
    name: 'Brannoc',
    class: 'Brawler',
    server_id: 2101,
    level: 45,
    gear_score: 2205,
    combat_power: 101_300,
    power: 3800,
    cadence: 1000,
    melee: true,
    skills: [
      s(19010000, 'Flurry', 0.7, 3, { hits: 3 }),
      s(19040000, 'Roundhouse', 1.4, 2),
      s(19070000, 'Whirlwind', 1.2, 2, { hits: 2 }),
      s(19130000, 'Rampage', 2.3, 1),
      s(19200000, 'Exploding Fist', 2.0, 2),
    ],
    buff: { id: 19280000, self: true, every: 35_000, length: 10_000 },
  },
];

const hero = (name: string) => ROSTER.find((h) => h.name === name)!;
/** The party of the current (live) fight and most saved fights. */
export const PARTY = ['Lyrienne', 'Kaelthos', 'Seraphine', 'Vexmora', 'Dorrin', 'Nyxalis'].map(
  hero,
);
const ALT_PARTY = ['Lyrienne', 'Mirelle', 'Tovrak', 'Brannoc', 'Dorrin', 'Seraphine'].map(hero);

/** Boss attack skill from the bundled catalogue. */
const BOSS_ATTACK = { id: 1224560, name: 'Attack' };
const TARGET_ENTITY = 9001;

interface TargetSpec {
  npc_id: number;
  name: string;
  boss: boolean;
  dummy: boolean;
  berserk_seconds: number | null;
  /** max HP = damage taken × factor; 1 means killed exactly at the end. */
  hpFactor: number;
}

interface FightSpec {
  id: string;
  label: string | null;
  started_ms: number;
  duration_ms: number;
  heroes: Hero[];
  target: TargetSpec;
  seed: number;
  end_reason: string | null;
  zone_id: number | null;
  run_id: string | null;
  party_id: number | null;
  /** Someone dies at this fight time and is revived 9 s later. */
  death_at?: number;
  warnings?: string[];
}

type Wire = Record<string, unknown>;
type Ev = {
  at_ms: number;
  kind: string;
  source?: number;
  target?: number;
  skill?: number;
  amount?: number;
  hit_count?: number;
  critical?: boolean;
  back?: boolean;
  front?: boolean;
  perfect?: boolean;
  double?: boolean;
  tick?: boolean;
  instance?: number;
};

function pick<T extends { weight: number }>(items: T[], r: () => number): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let roll = r() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

function simulate(spec: FightSpec) {
  const r = rng(spec.seed);
  const events: Ev[] = [];
  const buffs: Wire[] = [];
  const { duration_ms: duration, heroes } = spec;
  const victim = spec.death_at === undefined ? null : (heroes.find((h) => !h.tank) ?? null);
  const down = (h: Hero, t: number) =>
    victim === h && spec.death_at !== undefined && t >= spec.death_at && t < spec.death_at + 9000;
  let instance = 1;
  for (const h of heroes) {
    let t = 300 + r() * 1200;
    while (t < duration) {
      if (down(h, t)) {
        t += 500;
        continue;
      }
      const skill = pick(h.skills, r);
      const at = Math.round(t);
      events.push({
        at_ms: at,
        kind: 'cast',
        source: h.id,
        target: TARGET_ENTITY,
        skill: skill.id,
      });
      const amount = () => Math.round(h.power * skill.power * (0.85 + r() * 0.3));
      if (skill.heal) {
        const target = heroes[Math.floor(r() * heroes.length)]!;
        const pulses = skill.tick ? 5 : 1;
        for (let p = 0; p < pulses && at + p * 1000 < duration; p++) {
          const critical = !skill.tick && r() < 0.22;
          events.push({
            at_ms: at + 120 + p * 1000,
            kind: 'heal',
            source: h.id,
            target: target.id,
            skill: skill.id,
            amount: Math.round(amount() * (critical ? 1.5 : 1)),
            ...(skill.tick && p > 0 ? { tick: true } : { critical }),
          });
        }
      } else {
        const hits = skill.hits ?? 1;
        const critical = r() < 0.28;
        const flags = h.melee ? { back: r() < 0.32, front: r() < 0.12 } : {};
        events.push({
          at_ms: at + 150,
          kind: 'damage',
          source: h.id,
          target: TARGET_ENTITY,
          skill: skill.id,
          amount: Math.round(amount() * hits * (critical ? 1.8 : 1)),
          ...(hits > 1 ? { hit_count: hits } : {}),
          critical,
          ...flags,
          perfect: r() < 0.08,
          double: r() < 0.1,
          instance: instance++,
        });
        if (skill.tick)
          for (let p = 1; p <= 4 && at + 150 + p * 1000 < duration; p++)
            events.push({
              at_ms: at + 150 + p * 1000,
              kind: 'damage',
              source: h.id,
              target: TARGET_ENTITY,
              skill: skill.id,
              amount: Math.round(amount() * 0.35),
              tick: true,
            });
      }
      t += h.cadence * (0.75 + r() * 0.5);
    }
    if (h.buff)
      for (let start = 2000 + r() * 4000; start < duration; start += h.buff.every) {
        const end = start + h.buff.length;
        const target = h.buff.self ? h : heroes[Math.floor(r() * heroes.length)]!;
        buffs.push({
          source: h.id,
          target: target.id,
          skill: h.buff.id,
          instance: instance++,
          start_ms: Math.round(start),
          // Still running when a live fight is read.
          end_ms: end > duration && spec.end_reason === null ? null : Math.round(end),
        });
      }
  }
  // The boss hits the tank, sometimes everyone.
  const tank = heroes.find((h) => h.tank) ?? heroes[0]!;
  for (let t = 1800; t < duration; t += 2200 + r() * 1200) {
    const aoe = r() < 0.18;
    for (const h of aoe ? heroes : [tank]) {
      if (down(h, t)) continue;
      events.push({
        at_ms: Math.round(t),
        kind: 'damage',
        source: TARGET_ENTITY,
        target: h.id,
        skill: BOSS_ATTACK.id,
        amount: Math.round((aoe ? 2600 : 4800) * (0.8 + r() * 0.4)),
      });
    }
  }
  if (victim && spec.death_at !== undefined) {
    events.push({ at_ms: spec.death_at, kind: 'death', target: victim.id });
    events.push({
      at_ms: spec.death_at + 9000,
      kind: 'revive',
      target: victim.id,
    });
  }
  events.sort((a, b) => a.at_ms - b.at_ms);
  return { events, buffs };
}

interface SkillAgg {
  id: number;
  name: string;
  damage: number;
  healing: number;
  received: number;
  casts: number;
  hits: number;
  direct_hits: number;
  crits: number;
  critical_hits_observed: number;
  back: number;
  front: number;
  flags_observed: number;
  perfect: number;
  double: number;
  multi: number;
  damage_hits: number;
  damage_crits: number;
  damage_critical_hits_observed: number;
  amounts: number[];
  castTimes: number[];
}

const emptySkill = (id: number, name: string): SkillAgg => ({
  id,
  name,
  damage: 0,
  healing: 0,
  received: 0,
  casts: 0,
  hits: 0,
  direct_hits: 0,
  crits: 0,
  critical_hits_observed: 0,
  back: 0,
  front: 0,
  flags_observed: 0,
  perfect: 0,
  double: 0,
  multi: 0,
  damage_hits: 0,
  damage_crits: 0,
  damage_critical_hits_observed: 0,
  amounts: [],
  castTimes: [],
});

const COUNTERS = [
  'casts',
  'hits',
  'direct_hits',
  'crits',
  'critical_hits_observed',
  'back',
  'front',
  'flags_observed',
  'perfect',
  'double',
  'multi',
  'damage_hits',
  'damage_crits',
  'damage_critical_hits_observed',
] as const;

/** Builds one report in the native wire shape (`offline_log`, `offline_status.report`). */
function buildReport(spec: FightSpec): Wire {
  const { events, buffs } = simulate(spec);
  const seconds = spec.duration_ms / 1000;
  const skillName = new Map<number, string>([[BOSS_ATTACK.id, BOSS_ATTACK.name]]);
  for (const h of spec.heroes) for (const sk of h.skills) skillName.set(sk.id, sk.name);

  let targetDamage = 0;
  const players = spec.heroes.map((h) => {
    const skills = new Map<number, SkillAgg>();
    const skill = (id: number) => {
      let agg = skills.get(id);
      if (!agg) skills.set(id, (agg = emptySkill(id, skillName.get(id) ?? `Skill #${id}`)));
      return agg;
    };
    const healed = new Map<number, number>();
    const bins = new Set<number>();
    let received = 0;
    let healingReceived = 0;
    let recent = 0;
    for (const e of events) {
      if (e.kind === 'cast' && e.source === h.id) {
        const agg = skill(e.skill!);
        agg.casts++;
        agg.castTimes.push(e.at_ms);
      } else if ((e.kind === 'damage' || e.kind === 'heal') && e.source === h.id) {
        const agg = skill(e.skill!);
        const amount = e.amount ?? 0;
        bins.add(Math.floor(e.at_ms / 1000));
        agg.hits++;
        agg.amounts.push(amount);
        if ((e.hit_count ?? 1) > 1) agg.multi++;
        if (!e.tick) {
          agg.direct_hits++;
          agg.critical_hits_observed++;
          if (e.critical) agg.crits++;
          if (e.back !== undefined) {
            agg.flags_observed++;
            if (e.back) agg.back++;
            if (e.front) agg.front++;
          }
          if (e.perfect) agg.perfect++;
          if (e.double) agg.double++;
        }
        if (e.kind === 'damage') {
          agg.damage += amount;
          agg.damage_hits++;
          if (!e.tick) {
            agg.damage_critical_hits_observed++;
            if (e.critical) agg.damage_crits++;
          }
          targetDamage += amount;
          if (e.at_ms >= spec.duration_ms - 5000) recent += amount;
        } else {
          agg.healing += amount;
          healed.set(e.target!, (healed.get(e.target!) ?? 0) + amount);
        }
      } else if (e.kind === 'damage' && e.target === h.id) {
        received += e.amount ?? 0;
        skill(e.skill!).received += e.amount ?? 0;
      } else if (e.kind === 'heal' && e.target === h.id) healingReceived += e.amount ?? 0;
    }
    const list = [...skills.values()];
    const sum = (key: (typeof COUNTERS)[number]) => list.reduce((n, k) => n + k[key], 0);
    const damage = list.reduce((n, k) => n + k.damage, 0);
    const healing = list.reduce((n, k) => n + k.healing, 0);
    const active = Math.max(1, bins.size);
    const dead = events.some((e) => e.kind === 'death' && e.target === h.id);
    return {
      id: h.id,
      name: h.name,
      class: h.class,
      local: h.local === true,
      party: true,
      server_id: h.server_id,
      level: h.level,
      gear_score: h.gear_score,
      combat_power: h.combat_power,
      damage,
      healing,
      received,
      healing_received: healingReceived,
      deaths: dead ? 1 : 0,
      ...Object.fromEntries(COUNTERS.map((key) => [key, sum(key)])),
      inferred_casts: 0,
      edps: Math.round(damage / seconds),
      adps: Math.round(damage / active),
      current_dps: Math.round(recent / 5),
      active_pct: Math.min(100, (active / Math.ceil(seconds)) * 100),
      activity_method: 'one-second bins with outgoing damage or healing',
      skills: list
        .sort((a, b) => b.damage + b.healing - (a.damage + a.healing))
        .map(({ amounts, castTimes, ...k }) => {
          const gaps = castTimes.slice(1).map((t, i) => t - castTimes[i]!);
          return {
            ...k,
            casts: k.casts || null,
            min: amounts.length ? Math.min(...amounts) : null,
            max: amounts.length ? Math.max(...amounts) : null,
            avg: amounts.length ? Math.round((k.damage + k.healing) / amounts.length) : null,
            cast_gap_ms: gaps.length
              ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
              : null,
          };
        }),
      targets: [
        { id: TARGET_ENTITY, name: spec.target.name, damage, received },
        ...[...healed].map(([id, amount]) => ({
          id,
          name: spec.heroes.find((x) => x.id === id)?.name ?? null,
          healing: amount,
        })),
      ],
    };
  });

  const killed = spec.end_reason === 'kill';
  const maxHp = Math.round(targetDamage * (killed ? 1 : spec.target.hpFactor));
  const hp: Wire[] = [{ entity: TARGET_ENTITY, at_ms: 0, current: maxHp, max: maxHp }];
  let dealt = 0;
  let next = 1000;
  for (const e of events) {
    if (e.kind !== 'damage' || e.target !== TARGET_ENTITY) continue;
    while (e.at_ms >= next) {
      hp.push({
        entity: TARGET_ENTITY,
        at_ms: next,
        current: Math.max(0, maxHp - dealt),
      });
      next += 1000;
    }
    dealt += e.amount ?? 0;
  }
  hp.push({
    entity: TARGET_ENTITY,
    at_ms: spec.duration_ms,
    current: Math.max(0, maxHp - dealt),
  });
  if (killed)
    events.push({
      at_ms: spec.duration_ms,
      kind: 'death',
      target: TARGET_ENTITY,
    });

  const hits = events.filter((e) => e.kind === 'damage' && e.source !== TARGET_ENTITY);
  const biggest = hits.reduce((a, b) => ((b.amount ?? 0) > (a.amount ?? 0) ? b : a), hits[0]!);
  const top = (key: 'healing' | 'received' | 'healing_received') =>
    players.reduce((a, b) => (b[key] > a[key] ? b : a), players[0]!);
  const healer = top('healing');
  const tanked = top('received');
  const healedMost = top('healing_received');

  return {
    detail_level: 'full',
    id: spec.id,
    label: spec.label,
    started_ms: spec.started_ms,
    duration_ms: spec.duration_ms,
    end_reason: spec.end_reason,
    zone_id: spec.zone_id,
    run_id: spec.run_id,
    party_id: spec.party_id,
    players,
    targets: [
      {
        id: TARGET_ENTITY,
        npc_id: spec.target.npc_id,
        name: spec.target.name,
        boss: spec.target.boss,
        dummy: spec.target.dummy,
        current_hp: Math.max(0, maxHp - targetDamage),
        max_hp: maxHp,
        dead: killed,
        damage: targetDamage,
        berserk_seconds: spec.target.berserk_seconds,
      },
    ],
    events,
    event_count: events.length,
    buffs,
    hp,
    highlights: [
      {
        kind: 'biggest_hit',
        player: biggest.source,
        value: biggest.amount,
        at_ms: biggest.at_ms,
      },
      {
        kind: 'first_hit',
        player: hits[0]!.source,
        value: 0,
        at_ms: hits[0]!.at_ms,
      },
      ...(healer.healing > 0
        ? [{ kind: 'healing', player: healer.id, value: healer.healing }]
        : []),
      { kind: 'damage_taken', player: tanked.id, value: tanked.received },
      {
        kind: 'healing_received',
        player: healedMost.id,
        value: healedMost.healing_received,
      },
    ],
    warnings: spec.warnings ?? [],
    coverage: {
      damage: true,
      healing: true,
      casts: true,
      buffs: true,
      hp: true,
      deaths: true,
      hit_flags: true,
      positions: false,
    },
  };
}

/* ---------- Fights ---------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BOOT = Date.now();
/** Verteron, from the bundled map catalogue. */
const VERTERON = 1010;

/** `?mock=long` swaps in the longest boss names of the bundled roster. */
const LONG_NAMES: Record<string, string> = {
  'Divine Auldor': 'Superbia, Sacred Beast of Life',
  'Soul Ruler Kashapa': 'Special Operations Leader Linx',
  'High Commander Lagta': 'Drakan Battalion Weapon Guruta',
  'Kusan the Mad Gladiator': 'Third Unit Captain Minasara',
};
const boss = (npc_id: number, name: string, hpFactor = 1, berserk: number | null = null) => ({
  npc_id,
  name: (LONG && LONG_NAMES[name]) || name,
  boss: true,
  dummy: false,
  berserk_seconds: berserk,
  hpFactor,
});

const LIVE_SPEC: FightSpec = {
  id: `fight-${BOOT - 134_000}`,
  label: null,
  started_ms: BOOT - 134_000,
  duration_ms: 134_000,
  heroes: PARTY,
  target: boss(2300218, 'Divine Auldor', 1.65, 300),
  seed: 7,
  end_reason: null,
  zone_id: null,
  run_id: 'run-auldor',
  party_id: 41,
};

const saved = (
  ago: number,
  duration: number,
  target: TargetSpec,
  extra: Partial<FightSpec> = {},
): FightSpec => ({
  id: `fight-${BOOT - ago}`,
  label: null,
  started_ms: BOOT - ago,
  duration_ms: duration,
  heroes: PARTY,
  target,
  seed: Math.round(ago / 1000),
  end_reason: 'kill',
  zone_id: VERTERON,
  run_id: null,
  party_id: 41,
  ...extra,
});

const SAVED_SPECS: FightSpec[] = [
  saved(9 * MINUTE, 192_000, boss(2101122, 'Soul Ruler Kashapa'), {
    label: LONG
      ? 'Linx — clean kill on the second pull after the healer swap, keep this one'
      : 'Kashapa — clean kill',
    run_id: 'run-verteron-1',
  }),
  saved(26 * MINUTE, 241_000, boss(2101131, 'High Commander Lagta'), {
    run_id: 'run-verteron-1',
    death_at: 120_000,
  }),
  saved(48 * MINUTE, 158_000, boss(2100076, 'Kusan the Mad Gladiator'), {
    run_id: 'run-verteron-1',
  }),
  saved(2 * HOUR, 305_000, boss(2300218, 'Divine Auldor', 1.4, 300), {
    end_reason: 'reset',
    zone_id: null,
    death_at: 210_000,
    warnings: ['Capture quality: 1 stream gap.'],
  }),
  saved(
    3 * HOUR,
    60_000,
    {
      npc_id: 2000000,
      name: 'Punching Bag',
      boss: false,
      dummy: true,
      berserk_seconds: null,
      hpFactor: 40,
    },
    {
      heroes: [hero('Lyrienne')],
      label: 'Dummy · 60 s rotation',
      end_reason: 'dummy_cap',
      party_id: null,
    },
  ),
  saved(22 * HOUR, 176_000, boss(2101074, 'Eternal Gartua'), {
    heroes: ALT_PARTY,
    party_id: 37,
  }),
  saved(23 * HOUR, 214_000, boss(2100708, 'Centurion Demiros'), {
    heroes: ALT_PARTY,
    party_id: 37,
  }),
  saved(26 * HOUR, 132_000, boss(2100077, 'Ritualist Garshim'), {
    heroes: ALT_PARTY,
    party_id: 37,
  }),
  saved(2 * 24 * HOUR, 268_000, boss(2101122, 'Soul Ruler Kashapa'), {
    death_at: 90_000,
  }),
  saved(3 * 24 * HOUR, 187_000, boss(2100661, 'Phantasm Kasia')),
];

const reports = new Map<string, Wire>();
function report(spec: FightSpec): Wire {
  let value = reports.get(spec.id);
  if (!value) reports.set(spec.id, (value = buildReport(spec)));
  return value;
}

export const liveReport = () => report(LIVE_SPEC);
/** The live report as `offline_live_status` sends it: aggregates only, no details. */
export const liveReportSummary = (): Wire => ({
  ...liveReport(),
  detail_level: 'summary',
  events: [],
  buffs: [],
  hp: [],
});
export const LIVE_ID = LIVE_SPEC.id;

/** Saved logs: labels can be renamed and logs deleted for this session. */
const library = FRESH ? [] : SAVED_SPECS.map((spec) => ({ spec, label: spec.label }));

export const libraryCount = () => library.length;

function meta(entry: (typeof library)[number]) {
  const value = report(entry.spec) as {
    players: { name: string; damage: number }[];
  };
  const damage = value.players.reduce((n, p) => n + p.damage, 0);
  return {
    id: entry.spec.id,
    label: entry.label,
    started_ms: entry.spec.started_ms,
    duration_ms: entry.spec.duration_ms,
    damage,
    dps: Math.round(damage / (entry.spec.duration_ms / 1000)),
    players: value.players.map((p) => p.name),
    boss: entry.spec.target.name,
    zone_id: entry.spec.zone_id,
    run_id: entry.spec.run_id,
    end_reason: entry.spec.end_reason,
  };
}

export function listLogs(query: Record<string, unknown>) {
  const search = typeof query.search === 'string' ? query.search.toLowerCase() : '';
  const bossName = typeof query.boss === 'string' ? query.boss.toLowerCase() : '';
  let rows = library.map(meta).filter((m) => {
    if (
      search &&
      !`${m.label ?? ''} ${m.boss} ${m.players.join(' ')}`.toLowerCase().includes(search)
    )
      return false;
    if (bossName && !m.boss.toLowerCase().includes(bossName)) return false;
    if (typeof query.zone_id === 'number' && m.zone_id !== query.zone_id) return false;
    if (typeof query.run_id === 'string' && m.run_id !== query.run_id) return false;
    if (typeof query.from_ms === 'number' && m.started_ms < query.from_ms) return false;
    if (typeof query.to_ms === 'number' && m.started_ms > query.to_ms) return false;
    return true;
  });
  const sort = query.sort;
  rows = rows.sort((a, b) =>
    sort === 'damage'
      ? b.damage - a.damage
      : sort === 'dps'
        ? b.dps - a.dps
        : b.started_ms - a.started_ms,
  );
  const offset = typeof query.offset === 'number' ? query.offset : 0;
  const limit = typeof query.limit === 'number' ? query.limit : rows.length;
  return rows.slice(offset, offset + limit);
}

/** A saved fight or the live one; `bossOnly` changes nothing here (the target is a boss). */
export function readLog(id: unknown) {
  if (id === LIVE_ID) return liveReport();
  const entry = library.find((e) => e.spec.id === id);
  if (!entry) throw new Error(`No local log ${String(id)}`);
  return { ...report(entry.spec), label: entry.label };
}

export function renameLog(id: unknown, label: unknown) {
  const entry = library.find((e) => e.spec.id === id);
  if (!entry) throw new Error(`No local log ${String(id)}`);
  entry.label = typeof label === 'string' && label.trim() ? label.trim() : null;
  return meta(entry);
}

export function deleteLogs(ids: unknown) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  const before = library.length;
  for (let i = library.length - 1; i >= 0; i--)
    if (wanted.has(library[i]!.spec.id)) library.splice(i, 1);
  return before - library.length;
}

export function summary(id: unknown, multiline: boolean) {
  const value = (id === null ? liveReport() : readLog(id)) as {
    duration_ms: number;
    targets: { name: string }[];
    players: { name: string; damage: number; edps: number }[];
  };
  const seconds = Math.round(value.duration_ms / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const rows = [...value.players]
    .sort((a, b) => b.damage - a.damage)
    .map(
      (p, i) =>
        `${i + 1}. ${p.name} ${(p.damage / 1e6).toFixed(2)}M (${(p.edps / 1000).toFixed(1)}K/s)`,
    );
  const head = `${value.targets[0]?.name ?? 'Fight'} · ${time}`;
  return multiline ? [head, ...rows].join('\n') : [head, ...rows].join(' · ');
}

/* ---------- Live meter ---------- */

const live = {
  autoEnd: true,
  encounter: 12,
  history: [] as Wire[],
};

export function liveStatus(): LiveStatus {
  if (FRESH)
    return {
      running: true,
      phase: 'waiting_for_game',
      message: 'Waiting for AION 2.',
      odyle: null,
      duration_ms: 0,
      events: 0,
      players: [],
      stats: { adapters: 1 },
    };
  const value = liveReport() as {
    duration_ms: number;
    events: unknown[];
    players: {
      id: number;
      name: string;
      class: string;
      local: boolean;
      damage: number;
      edps: number;
      current_dps: number;
      direct_hits: number;
      crits: number;
      hits: number;
      skills: { name: string; damage: number }[];
    }[];
  };
  const total = value.players.reduce((n, p) => n + p.damage, 0) || 1;
  const players: LivePlayer[] = value.players
    .map((p) => ({
      entity: p.id,
      label: `${p.class} #${p.id}`,
      name: p.name,
      class: p.class,
      name_known: true,
      is_local: p.local,
      damage: p.damage,
      dps: p.edps,
      current_dps: p.current_dps,
      share: p.damage / total,
      direct_hits: p.direct_hits,
      critical_hits: p.crits,
      ticks: p.hits - p.direct_hits,
      skills: Object.fromEntries(
        p.skills.filter((k) => k.damage > 0).map((k) => [k.name, k.damage] as const),
      ),
    }))
    .sort((a, b) => b.damage - a.damage);
  return {
    named_entities: 14,
    roster_seen: true,
    party_members: PARTY.length,
    local_known: true,
    // Like native, the meter only ever counts you and your party.
    party_only: true,
    auto_end: live.autoEnd,
    encounter: live.encounter,
    encounter_ended: false,
    // The resource packet arrived a little before this poll.
    odyle: { base: 15, bonus: 275, observed_ms: Date.now() - 42_000 },
    skill_labels: 16_899,
    history: [
      { id: live.encounter - 1, duration_ms: 192_000, events: 4_812 },
      { id: live.encounter - 2, duration_ms: 241_000, events: 6_034 },
      { id: live.encounter - 3, duration_ms: 158_000, events: 3_977 },
    ],
    running: true,
    phase: 'capturing',
    message: 'Capturing combat from AION 2.',
    duration_ms: value.duration_ms,
    events: value.events.length,
    players,
    stats: {
      adapters: 1,
      packets: 1_284_330,
      frames: 402_118,
      bundles: 18_442,
      rejected: 3,
      gaps: 0,
      retransmissions: 12,
      desyncs: 0,
      dropped: 0,
    },
  };
}

export function configureLive(args: Record<string, unknown>) {
  if (typeof args.autoEnd === 'boolean') live.autoEnd = args.autoEnd;
  return liveStatus();
}

export function resetLive() {
  live.encounter += 1;
  return liveStatus();
}

/* ---------- Recordings and replay ---------- */

/** A short synthetic recording in this app's own recording format. */
export function demoRecording(source = 'Mock demo recording'): Recording {
  const r = rng(99);
  const duration = 30_000;
  const actors = PARTY.slice(0, 4);
  const events: RecordingEvent[] = [];
  const center = { x: 50, y: 45 };
  for (const [i, a] of actors.entries())
    for (let t = 0; t <= duration; t += 1000) {
      const angle = (t / duration) * Math.PI * 2 + (i * Math.PI) / 2;
      events.push({
        kind: 'position',
        at_ms: t,
        actor: a.name,
        x: Math.round(center.x + Math.cos(angle) * (18 + i * 4)),
        y: Math.round(center.y + Math.sin(angle) * (14 + i * 3)),
      });
    }
  events.push({
    kind: 'position',
    at_ms: 0,
    actor: 'Divine Auldor',
    x: center.x,
    y: center.y,
  });
  for (const a of actors)
    for (let t = 500 + r() * 800; t < duration; t += a.cadence * (0.8 + r() * 0.4)) {
      const skill = pick(a.skills, r);
      events.push({
        kind: skill.heal ? 'heal' : 'damage',
        at_ms: Math.round(t),
        source: a.name,
        target: skill.heal ? actors[Math.floor(r() * actors.length)]!.name : 'Divine Auldor',
        skill: skill.name,
        amount: Math.round(a.power * skill.power * (0.85 + r() * 0.3)),
      });
    }
  events.push(
    {
      kind: 'counter',
      at_ms: 0,
      character: 'Lyrienne',
      key: 'Dungeon entries',
      value: 3,
      limit: 4,
    },
    {
      kind: 'counter',
      at_ms: 18_000,
      character: 'Lyrienne',
      key: 'Dungeon entries',
      value: 2,
      limit: 4,
    },
    {
      kind: 'counter',
      at_ms: 0,
      character: 'Lyrienne',
      key: 'Field boss rewards',
      value: 1,
      limit: 3,
    },
    {
      kind: 'pet_souls',
      at_ms: 0,
      character: 'Lyrienne',
      pet: 'Fossa',
      owned: 18,
      required: 25,
    },
    {
      kind: 'pet_souls',
      at_ms: 22_000,
      character: 'Lyrienne',
      pet: 'Fossa',
      owned: 19,
      required: 25,
    },
    { kind: 'gap', at_ms: 14_500, reason: 'Capture gap: 1 dropped frame' },
  );
  events.sort((a, b) => a.at_ms - b.at_ms);
  return { schema_version: 1, source, duration_ms: duration, events };
}

let recording: Recording | null = null;

export function openRecording(next: Recording) {
  recording = next;
  return next;
}

export function snapshot(atMs: number): Snapshot {
  const players: Record<string, ReplayPlayer> = {};
  const positions: Record<string, [number, number]> = {};
  const counters = new Map<string, Snapshot['counters'][number]>();
  const pets = new Map<string, Snapshot['pets'][number]>();
  const gaps: string[] = [];
  const player = (name: string) =>
    (players[name] ??= { damage: 0, healing: 0, dps: 0, skills: {} });
  for (const e of recording?.events ?? []) {
    if (e.at_ms > atMs) break;
    switch (e.kind) {
      case 'damage':
      case 'heal': {
        const p = player(e.source);
        if (e.kind === 'damage') p.damage += e.amount;
        else p.healing += e.amount;
        p.skills[e.skill] = (p.skills[e.skill] ?? 0) + e.amount;
        break;
      }
      case 'position':
        positions[e.actor] = [e.x, e.y];
        break;
      case 'counter':
        counters.set(`${e.character}|${e.key}`, e);
        break;
      case 'pet_souls':
        pets.set(`${e.character}|${e.pet}`, e);
        break;
      case 'gap':
        gaps.push(e.reason);
        break;
    }
  }
  const seconds = Math.max(1, atMs / 1000);
  for (const p of Object.values(players)) p.dps = Math.round(p.damage / seconds);
  return {
    at_ms: atMs,
    players,
    positions,
    counters: [...counters.values()].map(({ character, key, value, limit }) => ({
      character,
      key,
      value,
      limit,
    })),
    pets: [...pets.values()].map(({ character, pet, owned, required }) => ({
      character,
      pet,
      owned,
      required,
    })),
    gaps,
  };
}

/* ---------- Group ---------- */

/** `?mock=raid`: the whole roster and three more, in raid slots 1..12. */
const RAID_MEMBERS = [
  ...ROSTER,
  { ...hero('Kaelthos'), name: 'Aurelwyn', gear_score: 2265, combat_power: 104_420 },
  { ...hero('Seraphine'), name: 'Thessaly', gear_score: 1985, combat_power: 86_310 },
  { ...hero('Vexmora'), name: 'Quillon', gear_score: 2140, combat_power: 97_050 },
];

export function groupStatus() {
  const now = Date.now();
  const heroes = RAID ? RAID_MEMBERS : PARTY.slice(0, 5);
  // The raid shows every ready state: fresh, not ready, an old tick and one never seen.
  const observed = (i: number) =>
    RAID && i === 7 ? now - 8 * 60_000 : now - 4_000 - (i % 6) * 1_500;
  return {
    capture_id: 10,
    running: true,
    phase: 'capturing',
    message: '',
    roster_seen: true,
    roster_age_ms: 2_000,
    lobby_name: RAID ? 'Dramata Nest (Raid)' : 'Deus Research Base (Transcendence)',
    capacity: RAID ? 12 : 6,
    party_id: 41,
    members: heroes.map((h, i) => ({
      name: h.name,
      server_id: h.server_id,
      class: h.class,
      level: h.level,
      gear_score: h.gear_score,
      combat_power: h.combat_power,
      ready: RAID && i === 10 ? null : i !== 3,
      leader: i === 0,
      slot: i + 1,
      ready_observed_ms: RAID && i === 10 ? null : observed(i),
    })),
    inspections: [hero('Mirelle'), hero('Brannoc')].map((h, i) => ({
      id: h.id,
      name: h.name,
      class: h.class,
      level: h.level,
      gear_score: h.gear_score,
      combat_power: h.combat_power,
      server_id: h.server_id,
      observed_ms: now - 30_000 - i * 45_000,
    })),
    ready_check: {
      observed_ms: now - 4_000,
      oldest_observed_ms: RAID ? observed(7) : now - 10_000,
      supported: true,
    },
  };
}
