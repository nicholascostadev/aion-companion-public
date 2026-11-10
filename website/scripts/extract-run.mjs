/**
 * Turns one of the app's saved fight logs into the anonymous replay the website's DPS meter plays
 * (src/data/run.json). Usage:
 *
 *   node scripts/extract-run.mjs <path to offline/logs/fight-….json>
 *
 * Only numbers, classes and timing are kept. No player or character names leave the log: the
 * page gives each player a fictional name (src/data/party.ts). Damage is summed per player per
 * tick across all targets, the way the meter's "all targets" view counts it; the boss's HP comes
 * from its own HP updates.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TICK_MS = 250;
const file = process.argv[2];
if (!file) throw new Error('Pass the path of a saved fight log.');
const log = JSON.parse(readFileSync(file, 'utf8'));

const players = Object.values(log.actors)
  .filter((a) => a.class && a.party)
  .sort((a, b) => Number(b.local) - Number(a.local));
if (players.length !== 5) throw new Error(`Expected a party of 5, found ${players.length}`);
const index = new Map(players.map((p, i) => [p.id, i]));

const bosses = Object.values(log.targets).filter((t) => t.boss);
const boss = bosses.find((t) => t.dead) ?? bosses[0];
if (!boss) throw new Error('No boss in this log');

const ticks = Math.ceil(log.duration_ms / TICK_MS);
const damage = players.map(() => Array.from({ length: ticks }, () => 0));
const hp = Array.from({ length: ticks }, () => null);
const deaths = [];
let lastHitOnLocal = null;

for (const e of log.events) {
  const t = Math.min(ticks - 1, Math.floor(e.at_ms / TICK_MS));
  if (e.kind === 'damage' && index.has(e.source)) damage[index.get(e.source)][t] += e.amount;
  if (e.kind === 'damage' && e.target === players[0].id) lastHitOnLocal = e.source;
  if (e.kind === 'hp' && e.target === boss.id) hp[t] = e.current_hp;
  if (e.kind === 'death' && index.has(e.target)) {
    deaths.push({
      player: index.get(e.target),
      at_ms: e.at_ms,
      // Who landed the last hit on you, if it was the boss (never a player's name).
      last_hit_boss: e.target === players[0].id ? lastHitOnLocal === boss.id : undefined,
    });
  }
}
// Carry the last known HP forward so every tick has one.
let known = hp.find((v) => v !== null) ?? boss.max_hp;
for (let t = 0; t < ticks; t++) known = hp[t] = hp[t] ?? known;
const startHp = Math.max(...hp);

const run = {
  source: 'A real clear from the developer’s saved logs, names removed (scripts/extract-run.mjs).',
  boss: boss.name,
  zone: log.zone_id,
  duration_ms: log.duration_ms,
  tick_ms: TICK_MS,
  boss_hp_max: startHp,
  berserk_seconds: boss.berserk_seconds,
  party: players.map((p) => ({
    cls: p.class,
    level: p.level,
    gs: p.gear_score,
    cp: p.combat_power,
    me: p.local,
  })),
  damage,
  boss_hp: hp,
  deaths,
};

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/data/run.json');
writeFileSync(out, `${JSON.stringify(run)}\n`);
const totals = damage.map((d) => d.reduce((a, b) => a + b, 0));
console.log(
  `${run.boss}: ${Math.round(log.duration_ms / 1000)} s, party ${players.map((p) => p.class).join('/')}, damage ${totals.join(', ')}, deaths ${deaths.length}`,
);
