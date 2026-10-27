import type { IconName } from '../../components/ui/Icon';
import type { Translate } from '../../i18n/provider';
import type { CaptureState } from '../../lib/capture';
import type { LivePlayer, LiveStatus } from '../../types/companion';
import type { LogMeta } from '../../types/offline';
import type { CaptureIssue } from '../setup/model';

/* Pure helpers of the Home tab: greeting, fight results and trends, the first steps. */

type T = Translate<'home'>;

export interface DayPart {
  /** Which greeting and eyebrow word (e.g. "Evening") to show. */
  id: 'morning' | 'afternoon' | 'evening' | 'night';
  icon: IconName;
}

/** The part of the day on this PC's clock, for the greeting. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return { id: 'morning', icon: 'sunrise' };
  if (hour >= 12 && hour < 18) return { id: 'afternoon', icon: 'sun' };
  if (hour >= 18 && hour < 23) return { id: 'evening', icon: 'sunset' };
  return { id: 'night', icon: 'night' };
}

/** The character playing now, by name, when capture has identified it; never guessed. */
export function localName(live: LiveStatus, profileName: string | null): string | null {
  const local = live.players.find((p) => p.is_local && p.name_known !== false && p.name);
  return local?.name ?? profileName ?? null;
}

/** A fight is under way: capture is live, someone dealt damage and it has not ended. */
export function fightInProgress(live: LiveStatus) {
  return (
    live.running &&
    live.phase === 'capturing' &&
    live.duration_ms > 0 &&
    live.players.length > 0 &&
    live.encounter_ended !== true
  );
}

/** The player leading the live fight, when there is one. */
export const liveLeader = (live: LiveStatus): LivePlayer | null =>
  live.players.reduce<LivePlayer | null>(
    (top, p) => (!top || p.damage > top.damage ? p : top),
    null,
  );

/**
 * The setup problem Home names in place of capture's own state, or null to show that state.
 * A confirmed problem stands in for the driver's load error and the reconnect between retries,
 * which only repeat it. Once capture waits for the game the driver evidently works, so a stale
 * probe never hides that; nor does it hide a failure to read capture's status at all.
 */
export function setupBlocking(
  capture: CaptureState,
  issue: CaptureIssue | null,
  readError: string,
): CaptureIssue | null {
  if (!issue || readError) return null;
  return capture === 'error' || capture === 'connecting' ? issue : null;
}

/* ---------- Fights ---------- */

export type FightResult = { label: string; tone: 'success' | 'warn' | 'neutral' };

/** How a saved fight ended, in one word or two; only what native recorded. */
export function fightResult(reason: string | null, t: T): FightResult {
  switch (reason) {
    case 'kill':
      return { label: t(($) => $.result.kill), tone: 'success' };
    case 'reset':
      return { label: t(($) => $.result.reset), tone: 'warn' };
    case 'dummy_cap':
    case 'idle':
    case 'zone_change':
      return { label: t(($) => $.result[reason]), tone: 'neutral' };
    case null:
      return { label: t(($) => $.result.inProgress), tone: 'neutral' };
    default:
      return { label: t(($) => $.result.ended), tone: 'neutral' };
  }
}

export interface FightTrend {
  /** Party DPS change against the previous fight on the same boss, as a fraction. */
  change: number | null;
  /** Best party DPS of the fights listed against this boss (at least two of them). */
  best: boolean;
}

/**
 * Each fight against the previous one on the same boss, from the logs at hand (newest
 * first). Nothing is inferred for a boss seen once or a fight without a DPS figure.
 */
export function fightTrends(logs: readonly LogMeta[]): Map<string, FightTrend> {
  const trends = new Map<string, FightTrend>();
  const byBoss = new Map<string, LogMeta[]>();
  for (const log of logs) {
    if (!log.boss) continue;
    const list = byBoss.get(log.boss) ?? [];
    list.push(log);
    byBoss.set(log.boss, list);
  }
  for (const list of byBoss.values()) {
    const rated = list.filter((l) => l.dps !== null && l.dps > 0);
    const top = rated.length > 1 ? Math.max(...rated.map((l) => l.dps ?? 0)) : null;
    list.forEach((log, i) => {
      const previous = list.slice(i + 1).find((l) => l.dps !== null && l.dps > 0);
      const change =
        log.dps !== null && previous?.dps ? (log.dps - previous.dps) / previous.dps : null;
      trends.set(log.id, { change, best: top !== null && log.dps === top });
    });
  }
  return trends;
}

/** Same calendar day on this PC's clock. */
export function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** Coarse age of something that happened, e.g. "just now", "9 min ago", "Yesterday". */
export function since(ms: number, now: number, t: T) {
  const elapsed = Math.max(0, now - ms);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t(($) => $.since.justNow);
  if (minutes < 60) return t(($) => $.since.minutes, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && sameDay(ms, now)) return t(($) => $.since.hours, { count: hours });
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 1) return t(($) => $.since.yesterday);
  return t(($) => $.since.days, { count: days });
}

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ---------- First steps ---------- */

export type StepId = 'game' | 'meter' | 'fight' | 'alerts' | 'pets';

export interface StepFacts {
  capturing: boolean;
  meterShown: boolean;
  savedFights: number | null;
  alertOn: boolean;
  farming: boolean;
}

export interface Step {
  /** Also names the step's title in the `home` messages (`steps.<id>`). */
  id: StepId;
  done: boolean;
}

/** The first steps, each ticked off by real state, never by having been clicked. */
export function firstSteps(facts: StepFacts): Step[] {
  return [
    { id: 'game', done: facts.capturing },
    { id: 'meter', done: facts.meterShown },
    { id: 'fight', done: (facts.savedFights ?? 0) > 0 },
    { id: 'alerts', done: facts.alertOn },
    { id: 'pets', done: facts.farming },
  ];
}
