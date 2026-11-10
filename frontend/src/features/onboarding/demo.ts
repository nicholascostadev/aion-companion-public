import { normalizeLiveStatus } from '../../lib/liveStatusNormalize';
import { normalizeReportSummary, SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LiveStatus, OverlayStatus } from '../../types/companion';
import type { OfflineSettings, PolledOfflineStatus, ReportSummary } from '../../types/offline';

/*
 * The onboarding's sample fight: the owner's saved Atiel fight in Deus Research Base,
 * sanitized into `deus-demo.json` (provenance in docs/ONBOARDING.md). It is never part of
 * the fight library or live capture. This module checks the bundled file and turns one of
 * its two-second samples into the native shapes the real DPS meter reads, so the guide
 * draws the meter itself rather than a picture of it.
 */

export interface DemoSkill {
  id: number;
  name: string;
  damage: number;
  hits: number;
  criticalHits: number;
}

export interface DemoPlayer {
  id: string;
  name: string;
  class: string;
  self: boolean;
  damage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  skills: DemoSkill[];
}

export interface DemoFrame {
  atMs: number;
  /** Cumulative damage to the boss, one entry per player in `players` order. */
  damage: number[];
  bossHp: number | null;
  bossMaxHp: number | null;
}

export interface DemoFight {
  schemaVersion: 1;
  boss: string;
  instance: string;
  durationMs: number;
  outcome: 'defeated' | 'ended';
  sampleIntervalMs: number;
  players: DemoPlayer[];
  frames: DemoFrame[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isHp = (v: unknown): v is number | null => v === null || isCount(v);

function isSkill(v: unknown): v is DemoSkill {
  return (
    isRecord(v) &&
    isCount(v.id) &&
    isText(v.name) &&
    isCount(v.damage) &&
    isCount(v.hits) &&
    isCount(v.criticalHits)
  );
}

function isPlayer(v: unknown): v is DemoPlayer {
  return (
    isRecord(v) &&
    isText(v.id) &&
    isText(v.name) &&
    isText(v.class) &&
    typeof v.self === 'boolean' &&
    isCount(v.damage) &&
    isCount(v.dps) &&
    isCount(v.hits) &&
    isCount(v.criticalHits) &&
    Array.isArray(v.skills) &&
    v.skills.every(isSkill)
  );
}

/**
 * The bundled sample when it has the shape the guide plays, else null (the guide then says
 * the sample is unavailable instead of drawing anything). Frames must start at zero, move
 * forward, end at the fight's length and only ever add damage.
 */
export function parseDemo(value: unknown): DemoFight | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const { boss, instance, durationMs, outcome, sampleIntervalMs, players, frames } = value;
  if (!isText(boss) || !isText(instance) || !isCount(durationMs) || durationMs <= 0) return null;
  if (outcome !== 'defeated' && outcome !== 'ended') return null;
  if (!isCount(sampleIntervalMs) || sampleIntervalMs <= 0) return null;
  if (!Array.isArray(players) || players.length === 0 || !players.every(isPlayer)) return null;
  if (!Array.isArray(frames) || frames.length < 2) return null;
  let previous: DemoFrame | null = null;
  for (const frame of frames as unknown[]) {
    if (
      !isRecord(frame) ||
      !isCount(frame.atMs) ||
      !isHp(frame.bossHp) ||
      !isHp(frame.bossMaxHp) ||
      !Array.isArray(frame.damage) ||
      frame.damage.length !== players.length ||
      !frame.damage.every(isCount)
    )
      return null;
    const current = frame as unknown as DemoFrame;
    if (previous) {
      if (current.atMs <= previous.atMs) return null;
      if (current.damage.some((d, i) => d < previous!.damage[i]!)) return null;
    } else if (current.atMs !== 0) return null;
    previous = current;
  }
  if (previous!.atMs !== durationMs) return null;
  return value as unknown as DemoFight;
}

/** Loads the sample on demand, so it is its own small chunk and only the guide pays for it. */
export async function loadDemo(): Promise<DemoFight | null> {
  const module = await import('./deus-demo.json');
  return parseDemo(module.default);
}

/** The boss's latest known health at or before `index` (some samples carry none). */
function bossHpAt(demo: DemoFight, index: number) {
  for (let i = index; i >= 0; i--) {
    const frame = demo.frames[i]!;
    if (frame.bossHp !== null && frame.bossMaxHp) return frame;
  }
  return null;
}

/** Damage over the last five seconds of samples, per second; null at the very start. */
function recentDps(demo: DemoFight, index: number, player: number) {
  const now = demo.frames[index]!;
  const from = demo.frames.find((f) => f.atMs >= now.atMs - 5000) ?? now;
  const seconds = (now.atMs - from.atMs) / 1000;
  return seconds > 0 ? (now.damage[player]! - from.damage[player]!) / seconds : null;
}

/** The sample's id in the meter, so a new playback is a new fight to the meter. */
export const DEMO_REPORT_ID = 'onboarding-sample';

/**
 * The sample up to frame `index` as the compact live report native would send: the
 * cumulative damage recorded at that sample, the boss's recorded health, and each player's
 * skills. Skill totals are recorded for the whole fight only, so before the last sample
 * they follow each player's final skill shares; at the end they are exact.
 */
export function demoReport(demo: DemoFight, index: number, startedMs: number): ReportSummary {
  const last = demo.frames.length - 1;
  const at = Math.min(Math.max(0, index), last);
  const frame = demo.frames[at]!;
  const ended = at === last;
  const seconds = frame.atMs / 1000;
  const hp = bossHpAt(demo, at);
  const bossId = 'boss';
  const players = demo.players.map((p, i) => {
    const damage = frame.damage[i]!;
    const part = p.damage > 0 ? damage / p.damage : 0;
    const scaled = (n: number) => (ended ? n : Math.round(n * part));
    const hits = scaled(p.hits);
    return {
      id: p.id,
      name: p.name,
      class: p.class,
      local: p.self,
      party: true,
      damage,
      edps: ended ? p.dps : seconds > 0 ? damage / seconds : 0,
      current_dps: ended ? null : recentDps(demo, at, i),
      damage_hits: hits,
      damage_crits: Math.min(hits, scaled(p.criticalHits)),
      damage_critical_hits_observed: hits,
      skills: p.skills.map((s) => {
        const skillHits = scaled(s.hits);
        return {
          id: s.id,
          name: s.name,
          damage: scaled(s.damage),
          healing: 0,
          damage_hits: skillHits,
          damage_crits: Math.min(skillHits, scaled(s.criticalHits)),
          damage_critical_hits_observed: skillHits,
        };
      }),
    };
  });
  const dead = ended && demo.outcome === 'defeated';
  // Health samples of the last twenty seconds, enough for the meter's kill-time estimate.
  const samples = demo.frames
    .slice(0, at + 1)
    .filter((f) => f.bossHp !== null && f.bossMaxHp && f.atMs >= frame.atMs - 20_000)
    .map((f) => ({ entity: bossId, at_ms: f.atMs, current: f.bossHp, max: f.bossMaxHp }));
  const report = normalizeReportSummary({
    detail_level: 'summary',
    id: DEMO_REPORT_ID,
    started_ms: startedMs,
    duration_ms: frame.atMs,
    end_reason: ended ? (dead ? 'kill' : 'idle') : null,
    players,
    targets: [
      {
        id: bossId,
        name: demo.boss,
        boss: true,
        dummy: false,
        current_hp: dead ? 0 : (hp?.bossHp ?? null),
        max_hp: hp?.bossMaxHp ?? null,
        dead,
        damage: frame.damage.reduce((sum, d) => sum + d, 0),
      },
    ],
    hp: samples,
  });
  if (!report) throw new Error('The onboarding sample did not form a report');
  return report;
}

/** Meter settings for the sample: the defaults, never faded, at full size. */
export function demoSettings(compactStrip: boolean): OfflineSettings {
  return {
    ...SETTINGS_FALLBACK,
    target_mode: 'boss',
    fade_after_seconds: 0,
    opacity: 1,
    scale: 1,
    hide_names: false,
    compact_strip: compactStrip,
  };
}

/** What the meter polls, for the sample at frame `index`. */
export function demoSources(
  demo: DemoFight,
  index: number,
  {
    startedMs,
    compactStrip,
    locked,
  }: { startedMs: number; compactStrip: boolean; locked: boolean },
): { status: LiveStatus; overlay: OverlayStatus; offline: PolledOfflineStatus } {
  const report = demoReport(demo, index, startedMs);
  const status = normalizeLiveStatus({
    running: true,
    phase: 'capturing',
    message: '',
    duration_ms: report.duration_ms,
    events: index,
    players: [],
    local_known: true,
    encounter: 1,
    encounter_ended: report.end_reason !== null,
    history: [],
  });
  return {
    status,
    overlay: { locked, ready: true, visible: true, can_lock: true, errors: [] },
    offline: {
      settings: demoSettings(compactStrip),
      report,
      library_count: null,
      trackers: [],
      alerts: [],
      catalogue: null,
      capabilities: {},
      error: null,
    },
  };
}

/** The last frame at or before `ms` of fight time. */
export function frameAt(demo: DemoFight, ms: number) {
  let index = 0;
  demo.frames.forEach((f, i) => {
    if (f.atMs <= ms) index = i;
  });
  return index;
}
