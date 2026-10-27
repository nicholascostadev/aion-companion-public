import type { BossProjection } from '../offline/analysis';

/** The rage (berserk) timer as the meter shows it; unknown is stated, never guessed. */
export type RageState =
  /** Not a boss: rage does not apply. */
  | { kind: 'none' }
  /** A boss without a catalogued rage timer. */
  | { kind: 'unknown' }
  /** Time left before rage; frozen once the fight ended with the boss alive. */
  | { kind: 'countdown'; ms: number; frozen: boolean }
  /** The timer ran out while the boss was alive. */
  | { kind: 'enraged'; frozen: boolean }
  /** The boss is defeated, so its timer no longer runs. */
  | { kind: 'stopped' };

export interface BossStatus {
  role: 'boss' | 'dummy' | 'target';
  name: string | null;
  /** Observed HP; null until seen, never read as zero. */
  current: number | null;
  max: number | null;
  fraction: number | null;
  dead: boolean;
  /** Kill estimate; 0 once defeated, null when unknown or the fight ended without a kill. */
  killMs: number | null;
  killSource: BossProjection['dpsSource'];
  rage: RageState;
  /** Whether the kill estimate beats rage, while both still run. */
  pace: 'good' | 'bad' | null;
}

/**
 * The meter's boss line from the live projection. `ended` freezes the fight: a living
 * boss keeps the rage time left when it ended, without a kill estimate or pace.
 */
export function bossStatus(projection: BossProjection | null, ended: boolean): BossStatus | null {
  if (!projection) return null;
  const { target, current, max, fraction, ttkMs, berserkMs, beatsBerserk } = projection;
  const role = target.boss === true ? 'boss' : target.dummy === true ? 'dummy' : 'target';
  const dead = target.dead === true || current === 0;
  const rage: RageState =
    role !== 'boss'
      ? { kind: 'none' }
      : dead
        ? { kind: 'stopped' }
        : berserkMs === null
          ? { kind: 'unknown' }
          : berserkMs <= 0
            ? { kind: 'enraged', frozen: ended }
            : { kind: 'countdown', ms: berserkMs, frozen: ended };
  const pace =
    rage.kind === 'countdown' && !ended && beatsBerserk !== null
      ? beatsBerserk
        ? 'good'
        : 'bad'
      : null;
  return {
    role,
    name: target.name,
    current: dead ? 0 : current,
    max,
    fraction: dead ? 0 : fraction,
    dead,
    killMs: dead ? 0 : ended ? null : ttkMs,
    killSource: projection.dpsSource,
    rage,
    pace,
  };
}
