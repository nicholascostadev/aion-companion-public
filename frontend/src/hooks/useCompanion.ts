import { isNative } from '../services/companion';
import { useRecording } from './useRecording';

export function useCompanion() {
  const native = isNative();
  return { native, ...useRecording(native) };
}
