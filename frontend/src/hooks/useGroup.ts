import { isNative, markGroupReady, readGroupStatus } from '../services/companion';
import type { GroupStatus } from '../types/companion';
import { useNativeState } from './useNativeState';

/** Group window: reports `group_ready` once and follows `group_status`. */
export function useGroup() {
  const native = isNative();
  const { state, error } = useNativeState<GroupStatus | null>(native, readGroupStatus, {
    initial: null,
    intervalMs: 1000,
    markReady: markGroupReady,
    // As before: the next good read also clears a failed ready report.
    readClearsActionError: true,
  });
  return { native, status: state, error };
}
