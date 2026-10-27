import { useEffect, useState } from 'react';
import { readAppBuildInfo } from '../services/buildInfo';
import type { AppBuildInfo } from '../types/buildInfo';

/** Wait for native metadata before labelling any desktop build as development. */
export function useAppBuildInfo(native: boolean): AppBuildInfo | null {
  const [build, setBuild] = useState<AppBuildInfo | null>(null);
  useEffect(() => {
    if (!native) return;
    let stopped = false;
    void readAppBuildInfo().then(
      (info) => {
        if (!stopped) setBuild(info);
      },
      () => {},
    );
    return () => {
      stopped = true;
    };
  }, [native]);
  return build;
}
