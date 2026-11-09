import type { Translate } from '../../i18n/provider';
import { captureState, type CaptureState } from '../../lib/capture';
import { combatPower } from '../../lib/playerRow';
import type { GroupStatus } from '../../types/companion';

export interface MemberCard {
  key: string;
  name: string;
  className: string | null;
  level: number | null;
  gearScore: number | null;
  /** Observed combat power (`lib/playerRow`'s rule); null when not observed. */
  combatPower: number | null;
  /**
   * Ready as the group counts it. The current leader always is: they start the group
   * rather than accept readiness, so their own ready bit is not consulted.
   */
  ready: boolean | null;
  leader: boolean;
  serverId: number | null;
  slot: number | null;
  /** When the shown readiness was observed; null for the leader, ready by rule. */
  readyObservedMs: number | null;
}

/**
 * Which preparing dungeon group the meter is in, or null outside one (no room, no dungeon,
 * the run under way, or an older native without run state). The party and its dungeon name
 * it, so roster and readiness updates keep the same key while joining another group, or the
 * same group forming for another dungeon, changes it.
 */
export function preparingRoom(status: GroupStatus | null): string | null {
  if (status?.room !== true || status.preparing !== true) return null;
  return `${status.party_id ?? ''}:${status.dungeon_id ?? ''}`;
}

/** Largest group size the panel will believe; anything else is treated as unknown. */
const MAX_CAPACITY = 48;
/** A roster seen within this long reads as live. */
const FRESH_MS = 30_000;
/** Beyond this the roster is likely out of date (e.g. after leaving the lobby view). */
const STALE_MS = 120_000;
/** Readiness older than this (or without a time) is shown as old rather than confirmed. */
export const READY_FRESH_MS = 60_000;

function measured(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function positive(value: unknown): number | null {
  const n = measured(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Members as cards, using only what the roster reported for that member. Inspected
 * profiles are never merged in: they carry no verified server, and names are not
 * unique across servers.
 */
function memberCards(status: GroupStatus | null): MemberCard[] {
  if (!status) return [];
  const cards = status.members.map((member, i) => {
    const leader = member.leader === true;
    return {
      key: member.character_id
        ? `id:${member.character_id}`
        : `${member.server_id ?? ''}:${member.name}:${i}`,
      name: member.name,
      className: member.class || null,
      level: positive(member.level),
      gearScore: measured(member.gear_score),
      combatPower: combatPower(member.combat_power),
      ready: leader ? true : typeof member.ready === 'boolean' ? member.ready : null,
      leader,
      serverId: member.server_id,
      // Native slots are 1-based (1..12); anything else is not an observed slot.
      slot: positive(member.slot),
      readyObservedMs: leader ? null : positive(member.ready_observed_ms),
    };
  });
  // Observed party slots order the roster; members without one keep roster order.
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (a.card.slot ?? Infinity) - (b.card.slot ?? Infinity) || a.index - b.index)
    .map(({ card }) => card);
}

/**
 * Readiness metadata, only when native reports it as supported. A round is "active"
 * only on an explicit `active: true`; the observation time never implies a round.
 * Observation times come from the members, not from here.
 */
function readyCheck(status: GroupStatus | null) {
  const check = status?.ready_check;
  if (!check || check.supported === false) return null;
  const active = check.active === true;
  return {
    active,
    startedMs: active ? positive(check.started_ms) : null,
    expiresMs: active ? positive(check.expires_ms) : null,
    source: typeof check.source === 'string' && check.source ? check.source : null,
  };
}

/** Group size only when the game reported one that is consistent with the roster. */
function knownCapacity(status: GroupStatus | null): number | null {
  const capacity = status?.capacity;
  if (typeof capacity !== 'number' || !Number.isInteger(capacity)) return null;
  if (capacity < 1 || capacity > MAX_CAPACITY) return null;
  return capacity >= (status?.members.length ?? 0) ? capacity : null;
}

/** How fresh the roster reads, in the caption and the footer. */
export type Freshness =
  /** Outside the native app the room is a preview. */
  | { kind: 'preview' }
  /** Capture is not capturing: its own state names the roster's. */
  | { kind: 'capture'; capture: CaptureState }
  /** Capturing, but no roster seen yet. */
  | { kind: 'waiting' }
  | { kind: 'live' }
  /** Seen this long ago. */
  | { kind: 'seen'; ageMs: number };

/** Everything the party room shows for one group status at one moment. */
export interface Room {
  /** Members in slot order. */
  cards: MemberCard[];
  /** The game's ready check, when native reports it as supported. */
  check: ReturnType<typeof readyCheck>;
  capture: CaptureState;
  running: boolean;
  /** How long ago the roster was seen; null when unknown. */
  age: number | null;
  /** The group's size, when consistent with the roster. */
  capacity: number | null;
  /** Empty places: the size less the members; none while the size is unknown. */
  openSlots: number;
  /**
   * Ready members over the known ones, the leader counted as ready. Null until another
   * member's readiness is observed: the leader's rule alone says nothing about the group.
   */
  ready: { ready: number; known: number; total: number } | null;
  /** Combat power averaged over the members it was observed for. */
  average: { average: number; known: number; total: number } | null;
  /**
   * The newest and oldest readiness observations, and how many known states have no time.
   * The leader's readiness is the game's rule, not an observation, so it never counts here.
   */
  newestMs: number | null;
  oldestMs: number | null;
  untimed: number;
  /** How old the oldest observation is, while native reports a ready check. */
  oldestAge: number | null;
  /** Capturing, but the roster has not been seen for a while. */
  stale: boolean;
  /**
   * The caption's readiness, null until another member's is observed. Old readiness (or
   * readiness without a time) never reads as a fresh all-ready group.
   */
  readiness: 'all' | 'some' | 'old' | null;
  freshness: Freshness;
}

/**
 * What the party room shows for `status` at `now`. Outside the native app (`native` false)
 * the room is a preview and never stale.
 */
export function groupRoom(status: GroupStatus | null, native: boolean, now: number): Room {
  const cards = memberCards(status);
  const check = readyCheck(status);
  const capture = captureState(status);
  const running = capture === 'capturing';
  const age = status?.roster_age_ms ?? null;
  const capacity = knownCapacity(status);
  const observed = cards.filter((card) => !card.leader && card.ready !== null);
  const times = observed.flatMap((card) =>
    card.readyObservedMs === null ? [] : [card.readyObservedMs],
  );
  const newestMs = times.length ? Math.max(...times) : null;
  const oldestMs = times.length ? Math.min(...times) : null;
  const untimed = observed.length - times.length;
  const oldestAge = check && oldestMs !== null ? Math.max(0, now - oldestMs) : null;
  const known = cards.filter((card) => card.ready !== null);
  const ready = known.some((card) => !card.leader)
    ? {
        ready: known.filter((card) => card.ready).length,
        known: known.length,
        total: cards.length,
      }
    : null;
  const powers = cards.flatMap((card) => (card.combatPower === null ? [] : [card.combatPower]));
  const old = (oldestAge !== null && oldestAge > READY_FRESH_MS) || untimed > 0;
  return {
    cards,
    check,
    capture,
    running,
    age,
    capacity,
    openSlots: capacity === null ? 0 : capacity - cards.length,
    ready,
    average: powers.length
      ? {
          average: Math.round(powers.reduce((sum, v) => sum + v, 0) / powers.length),
          known: powers.length,
          total: cards.length,
        }
      : null,
    newestMs,
    oldestMs,
    untimed,
    oldestAge,
    stale: native && running && age !== null && age > STALE_MS,
    readiness: !ready ? null : old ? 'old' : ready.ready === ready.total ? 'all' : 'some',
    freshness: !native
      ? { kind: 'preview' }
      : !running
        ? { kind: 'capture', capture }
        : !status?.roster_seen || age === null
          ? { kind: 'waiting' }
          : age <= FRESH_MS
            ? { kind: 'live' }
            : { kind: 'seen', ageMs: age },
  };
}

/**
 * The room's clock ticks only while it shows a readiness time: an active ready check, or
 * another member's observed readiness (the leader's is ready by rule, untimed).
 */
export function roomClockTicks(status: GroupStatus | null): boolean {
  return (
    readyCheck(status)?.active === true ||
    (status?.members ?? []).some(
      (member) => member.leader !== true && positive(member.ready_observed_ms) !== null,
    )
  );
}

/** A column holds up to one party of six; larger rosters (raids) take a second column. */
const COLUMN_ROWS = 6;
/**
 * Columns of the roster: two when there are more places (members and open slots) than one
 * party. The second column shows once the meter is wide enough for it.
 */
export function rosterColumns(places: number): 1 | 2 {
  return places > COLUMN_ROWS ? 2 : 1;
}

/** How long ago, in the largest whole unit: "5s ago", "20m ago", "2h ago". */
export function ago(ms: number, t: Translate<'group'>) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t(($) => $.ago.seconds, { value: seconds });
  if (seconds < 3600) return t(($) => $.ago.minutes, { value: Math.floor(seconds / 60) });
  return t(($) => $.ago.hours, { value: Math.floor(seconds / 3600) });
}
