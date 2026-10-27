import type { Translate } from '../../i18n/provider';
import type { GroupInspection, GroupStatus } from '../../types/companion';

/**
 * Fields the backend may start sending. Absent, null or malformed always means
 * "not observed": the panel shows a dash, never a guess.
 */
export type GroupMemberData = GroupStatus['members'][number] & {
  combat_power?: number | null;
  gear_score?: number | null;
  ready?: boolean | null;
  leader?: boolean | null;
  character_id?: string | null;
  /** 1-based party slot (1..12). */
  slot?: number | null;
  group_index?: number | null;
  /** When this member's ready state was last observed (epoch ms). */
  ready_observed_ms?: number | null;
};
export type GroupInspectionData = GroupInspection & {
  combat_power?: number | null;
  server_id?: number | null;
};
/**
 * Readiness metadata. Today native only proves each member's ready bit: `observed_ms`
 * is when readiness was last seen. `active`/`started_ms`/`expires_ms` describe a timed
 * ready-check round and stay null unless the game reports one explicitly.
 */
export interface ReadyCheck {
  active?: boolean | null;
  started_ms?: number | null;
  expires_ms?: number | null;
  /** Newest member readiness observation. */
  observed_ms?: number | null;
  /** Oldest member readiness observation still shown. */
  oldest_observed_ms?: number | null;
  source?: string | null;
  supported?: boolean | null;
}
export type GroupStatusData = Omit<GroupStatus, 'members' | 'inspections'> & {
  members: GroupMemberData[];
  inspections: GroupInspectionData[];
  lobby_name?: string | null;
  capacity?: number | null;
  ready_check?: ReadyCheck | null;
};

export interface MemberCard {
  key: string;
  name: string;
  className: string | null;
  level: number | null;
  gearScore: number | null;
  combatPower: number | null;
  ready: boolean | null;
  leader: boolean;
  serverId: number | null;
  slot: number | null;
  readyObservedMs: number | null;
}

/** Largest group size the panel will believe; anything else is treated as unknown. */
const MAX_CAPACITY = 48;

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
export function memberCards(status: GroupStatusData | null): MemberCard[] {
  if (!status) return [];
  const cards = status.members.map((member, i) => ({
    key: member.character_id
      ? `id:${member.character_id}`
      : `${member.server_id ?? ''}:${member.name}:${i}`,
    name: member.name,
    className: member.class || null,
    level: positive(member.level),
    gearScore: measured(member.gear_score),
    combatPower: positive(member.combat_power),
    ready: typeof member.ready === 'boolean' ? member.ready : null,
    leader: member.leader === true,
    serverId: member.server_id,
    // Native slots are 1-based (1..12); anything else is not an observed slot.
    slot: positive(member.slot),
    readyObservedMs: positive(member.ready_observed_ms),
  }));
  // Observed party slots order the roster; members without one keep roster order.
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (a.card.slot ?? Infinity) - (b.card.slot ?? Infinity) || a.index - b.index)
    .map(({ card }) => card);
}

/**
 * Readiness metadata, only when native reports it as supported. A round is "active"
 * only on an explicit `active: true`; the observation time never implies a round.
 */
export function readyCheck(status: GroupStatusData | null) {
  const check = status?.ready_check;
  if (!check || check.supported === false) return null;
  const active = check.active === true;
  return {
    active,
    startedMs: active ? positive(check.started_ms) : null,
    expiresMs: active ? positive(check.expires_ms) : null,
    observedMs: positive(check.observed_ms),
    oldestMs: positive(check.oldest_observed_ms) ?? positive(check.observed_ms),
    source: typeof check.source === 'string' && check.source ? check.source : null,
  };
}

/** Group size only when the game reported one that is consistent with the roster. */
export function knownCapacity(status: GroupStatusData | null): number | null {
  const capacity = status?.capacity;
  if (typeof capacity !== 'number' || !Number.isInteger(capacity)) return null;
  if (capacity < 1 || capacity > MAX_CAPACITY) return null;
  return capacity >= (status?.members.length ?? 0) ? capacity : null;
}

export function readiness(cards: MemberCard[]) {
  const known = cards.filter((card) => card.ready !== null);
  if (!known.length) return null;
  return {
    ready: known.filter((card) => card.ready).length,
    known: known.length,
    total: cards.length,
  };
}

export function averageCombatPower(cards: MemberCard[]) {
  const values = cards.flatMap((card) => (card.combatPower === null ? [] : [card.combatPower]));
  if (!values.length) return null;
  return {
    average: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length),
    known: values.length,
    total: cards.length,
  };
}

/** Readiness older than this (or without a time) is shown as old rather than confirmed. */
export const READY_FRESH_MS = 60_000;

/** Logical window widths the panel asks for: one column of rows, or two side by side. */
export const GROUP_WIDTH = { single: 336, double: 640 } as const;
/** A column holds up to one party of six; larger rosters (raids) take a second column. */
const COLUMN_ROWS = 6;
/**
 * Columns of the roster, so a raid stays visible without scrolling: two when there are
 * more places (members and open slots) than one party and the work area is wide enough.
 */
export function rosterColumns(places: number, availableWidth: number): 1 | 2 {
  return places > COLUMN_ROWS && availableWidth >= GROUP_WIDTH.double ? 2 : 1;
}

/** How long ago, in the largest whole unit: "5s ago", "20m ago", "2h ago". */
export function ago(ms: number, t: Translate<'group'>) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t(($) => $.ago.seconds, { value: seconds });
  if (seconds < 3600) return t(($) => $.ago.minutes, { value: Math.floor(seconds / 60) });
  return t(($) => $.ago.hours, { value: Math.floor(seconds / 3600) });
}
