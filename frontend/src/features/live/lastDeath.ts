import { shugoProfile, type ShugoProfile } from '../../lib/shugo';
import type { LastDeath } from '../../types/offline';

/** Your latest death, offered when a character observed by name landed its last hit. */
export interface DeathShortcut {
  /** Wall-clock time of the death, epoch milliseconds. */
  at: number;
  name: string;
  class: string | null;
  /** Null without an observed Global server: the name alone could be anyone's. */
  profile: ShugoProfile | null;
}

/**
 * The shortcut for native's `last_death`. A monster's or unidentified source's last hit
 * offers nothing, and nothing here claims the character killed you.
 */
export function deathShortcut(death: LastDeath | null | undefined): DeathShortcut | null {
  const hit = death?.last_hit;
  if (!death || !hit?.player || !hit.name) return null;
  return {
    at: death.at_ms,
    name: hit.name,
    class: hit.class,
    profile: shugoProfile(hit.name, hit.server_id),
  };
}
