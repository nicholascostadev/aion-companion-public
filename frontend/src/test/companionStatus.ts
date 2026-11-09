import { normalizeGroupStatus } from '../lib/groupStatusNormalize';
import { normalizeLiveStatus } from '../lib/liveStatusNormalize';
import type { GroupMember, GroupStatus, LivePlayer, LiveStatus } from '../types/companion';

/*
 * TEST ONLY. Complete `live_status` and `group_status` values for tests that build their
 * own: each starts from what the normalizer makes of an empty payload (nothing observed)
 * and takes only the fields a test is about.
 */

/** `live_status` with nothing observed, and `patch` on top. */
export const liveStatus = (patch: Partial<LiveStatus> = {}): LiveStatus => ({
  ...normalizeLiveStatus({}),
  ...patch,
});

/** A meter row with nothing observed but its entity, and `patch` on top. */
export const livePlayer = (patch: Partial<LivePlayer> = {}): LivePlayer => ({
  ...normalizeLiveStatus({ players: [{ entity: 1 }] }).players[0]!,
  ...patch,
});

/** `group_status` with nothing observed, and `patch` on top. */
export const groupStatus = (patch: Partial<GroupStatus> = {}): GroupStatus => ({
  ...normalizeGroupStatus({}),
  ...patch,
});

/**
 * The keys of every object in a JSON value, by path: `players[]` for an array's elements.
 * The objects at a path in `records` hold labels rather than fields and are left out.
 */
export function objectKeys(value: unknown, records: readonly string[] = []): [string, string][] {
  const found: [string, string][] = [];
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, `${at}[]`);
      return;
    }
    if (node === null || typeof node !== 'object' || records.includes(at)) return;
    found.push([at || '(root)', Object.keys(node).sort().join(' ')]);
    for (const [key, child] of Object.entries(node)) walk(child, at ? `${at}.${key}` : key);
  };
  walk(value, '');
  return found;
}

/** A roster member with nothing observed but its name, and `patch` on top. */
export const groupMember = (name: string, patch: Partial<GroupMember> = {}): GroupMember => ({
  ...normalizeGroupStatus({ members: [{ name }] }).members[0]!,
  ...patch,
});
