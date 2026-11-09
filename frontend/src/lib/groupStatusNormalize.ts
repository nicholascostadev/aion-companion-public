import type {
  GroupInspection,
  GroupMember,
  GroupReadyCheck,
  GroupRun,
  GroupStatus,
} from '../types/companion';

/*
 * `group_status` as the party room and the meter read it. The contract is
 * `crates/companion-capture/src/group_status.rs`; a payload that matches
 * `fixtures/contracts/group_status.json` comes out unchanged. Anything else is untrusted:
 * an absent or malformed observation becomes `null` (never zero or false), a malformed
 * row is dropped, and keys outside the contract, such as the development build's
 * `protocol_diagnostic`, are left out.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** A non-negative whole number, as every native id, size and clock is. */
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const present = <T>(items: (T | null)[]): T[] => items.filter((item) => item !== null);

const RUN_PHASES: readonly GroupRun['phase'][] = ['unknown', 'outside', 'running', 'cleared'];

/** A member without a name string is not a roster entry and is dropped. */
function member(value: unknown): GroupMember | null {
  const v = bag(value);
  const name = str(v.name);
  if (name === null) return null;
  return {
    // Decimal text only: a number would already have lost precision on the way.
    character_id: typeof v.character_id === 'string' && v.character_id ? v.character_id : null,
    slot: whole(v.slot),
    group_index: whole(v.group_index),
    ready_observed_ms: whole(v.ready_observed_ms),
    name,
    server_id: whole(v.server_id),
    class: str(v.class),
    // The room reads level 0 as not shown.
    level: whole(v.level) ?? 0,
    gear_score: whole(v.gear_score),
    combat_power: whole(v.combat_power),
    leader: bool(v.leader),
    ready: bool(v.ready),
  };
}

/** An inspection is kept only whole: every figure it shows was observed together. */
function inspection(value: unknown): GroupInspection | null {
  const v = bag(value);
  const id = whole(v.id);
  const name = str(v.name);
  const className = str(v.class);
  const level = whole(v.level);
  const gearScore = whole(v.gear_score);
  const observed = whole(v.observed_ms);
  if (
    id === null ||
    name === null ||
    className === null ||
    level === null ||
    gearScore === null ||
    observed === null
  )
    return null;
  return { id, name, class: className, level, gear_score: gearScore, observed_ms: observed };
}

/** An unobserved run, or one native described in words this build does not know. */
function run(value: unknown): GroupRun {
  const v = bag(value);
  return {
    phase: RUN_PHASES.includes(v.phase as GroupRun['phase'])
      ? (v.phase as GroupRun['phase'])
      : 'unknown',
    dungeon_id: whole(v.dungeon_id),
    run_id: str(v.run_id),
    zone_id: whole(v.zone_id),
  };
}

/** Readiness metadata; one that does not say it is supported is not. */
function readyCheck(value: unknown): GroupReadyCheck {
  const v = bag(value);
  return {
    active: bool(v.active),
    started_ms: whole(v.started_ms),
    expires_ms: whole(v.expires_ms),
    observed_ms: whole(v.observed_ms),
    oldest_observed_ms: whole(v.oldest_observed_ms),
    source: str(v.source) ?? '',
    supported: v.supported === true,
  };
}

/** The guaranteed `group_status` tree from whatever native sent. */
export function normalizeGroupStatus(value: unknown): GroupStatus {
  const v = bag(value);
  return {
    capture_id: whole(v.capture_id) ?? 0,
    running: v.running === true,
    phase: str(v.phase) ?? '',
    message: str(v.message) ?? '',
    roster_seen: v.roster_seen === true,
    roster_age_ms: whole(v.roster_age_ms),
    lobby_name: str(v.lobby_name),
    capacity: whole(v.capacity),
    party_id: whole(v.party_id),
    members: present(list(v.members).map(member)),
    inspections: present(list(v.inspections).map(inspection)),
    room: v.room === true,
    dungeon_id: whole(v.dungeon_id),
    run: run(v.run),
    preparing: v.preparing === true,
    ready_check: readyCheck(v.ready_check),
  };
}
