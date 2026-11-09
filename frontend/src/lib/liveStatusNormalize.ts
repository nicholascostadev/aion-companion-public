import type {
  CaptureCounters,
  CaptureStats,
  LivePlayer,
  LiveStatus,
  OdyleBalance,
  PastEncounter,
} from '../types/companion';

/*
 * `live_status` (and the `live_reset` and `live_configure` replies) as the meter reads it.
 * The contract is `crates/companion-capture/src/live_status.rs`; a payload that matches
 * `fixtures/contracts/live_status.json` comes out unchanged. Anything else is untrusted:
 * an absent or malformed observation becomes `null`, a malformed count zero, a malformed
 * row is dropped, and keys outside the contract are left out.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
/** A non-negative whole number, as every native counter, id and clock is. */
const whole = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

const COUNTERS = [
  'adapters',
  'packets',
  'frames',
  'bundles',
  'rejected',
  'gaps',
  'retransmissions',
  'desyncs',
  'dropped',
  'metadata_dropped',
] as const satisfies readonly (keyof CaptureCounters)[];

/** All ten counters, or `{}` (not published yet) when any of them is missing or malformed. */
function stats(value: unknown): CaptureStats {
  const v = bag(value);
  const counters: Partial<CaptureCounters> = {};
  for (const key of COUNTERS) {
    const n = whole(v[key]);
    if (n === null) return {};
    counters[key] = n;
  }
  return counters as CaptureCounters;
}

function odyle(value: unknown): OdyleBalance | null {
  const v = bag(value);
  const base = whole(v.base);
  const bonus = whole(v.bonus);
  const observed = whole(v.observed_ms);
  return base === null || bonus === null || observed === null
    ? null
    : { base, bonus, observed_ms: observed };
}

function pastEncounter(value: unknown): PastEncounter | null {
  const v = bag(value);
  const id = whole(v.id);
  if (id === null) return null;
  return { id, duration_ms: whole(v.duration_ms) ?? 0, events: whole(v.events) ?? 0 };
}

function skills(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(bag(value)).flatMap(([label, damage]) => {
      const n = whole(damage);
      return n === null ? [] : [[label, n] as const];
    }),
  );
}

/** A meter row; a row without an entity id names no one and is dropped. */
function player(value: unknown): LivePlayer | null {
  const v = bag(value);
  const entity = whole(v.entity);
  if (entity === null) return null;
  const name = str(v.name);
  return {
    entity,
    label: str(v.label) ?? '',
    // Native always names one ("Entity" for no class); a missing one stays unnamed, as the
    // meter has always shown it, rather than borrowing that word.
    class: str(v.class) ?? '',
    damage: whole(v.damage) ?? 0,
    dps: num(v.dps) ?? 0,
    current_dps: num(v.current_dps) ?? 0,
    share: num(v.share) ?? 0,
    direct_hits: whole(v.direct_hits) ?? 0,
    critical_hits: whole(v.critical_hits) ?? 0,
    ticks: whole(v.ticks) ?? 0,
    skills: skills(v.skills),
    name,
    // By definition whether `name` is set, when native does not say.
    name_known: bool(v.name_known) ?? name !== null,
    is_local: v.is_local === true,
    server_id: whole(v.server_id),
    party_member: v.party_member === true,
    gear_score: whole(v.gear_score),
    combat_power: whole(v.combat_power),
  };
}

const present = <T>(items: (T | null)[]): T[] => items.filter((item) => item !== null);

/**
 * The guaranteed `live_status` tree from whatever native sent. A missing setting reads as
 * native's default (auto end on, party only off) and a missing fight number as the first
 * fight, as the meter has always shown them before native's first answer.
 */
export function normalizeLiveStatus(value: unknown): LiveStatus {
  const v = bag(value);
  return {
    odyle: odyle(v.odyle),
    running: v.running === true,
    phase: str(v.phase) ?? '',
    message: str(v.message) ?? '',
    duration_ms: whole(v.duration_ms) ?? 0,
    events: whole(v.events) ?? 0,
    stats: stats(v.stats),
    players: present(list(v.players).map(player)),
    named_entities: whole(v.named_entities) ?? 0,
    roster_seen: v.roster_seen === true,
    party_members: whole(v.party_members) ?? 0,
    local_known: v.local_known === true,
    party_only: v.party_only === true,
    auto_end: bool(v.auto_end) ?? true,
    encounter: whole(v.encounter) ?? 1,
    encounter_ended: v.encounter_ended === true,
    skill_labels: whole(v.skill_labels) ?? 0,
    history: present(list(v.history).map(pastEncounter)),
  };
}
