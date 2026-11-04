import { isNative, readGroupStatus } from '../services/companion';
import type { GroupStatus } from '../types/companion';
import { useNativeState } from './useNativeState';

/** Follows `group_status`: the party room and whether a dungeon run is under way. */
export function useGroup(native = isNative()) {
  const { state, error } = useNativeState<GroupStatus | null>(native, readGroupStatus, {
    initial: null,
    intervalMs: 1000,
  });
  return { native, status: state, error };
}
