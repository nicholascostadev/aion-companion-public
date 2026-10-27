import { ExploreView } from '../features/finder/ExploreView';
import type { FinderFocus } from '../features/finder/layers';
import { useCubes } from '../hooks/useCubes';
import { usePageVisible } from '../hooks/usePageVisible';
import { useRecentlyShown } from '../hooks/useRecentlyShown';
import type { FinderPreferencesControl } from '../lib/finderPreferences';
import type { ActivityWindowToggle } from '../types/activityWindows';

/**
 * Workspace Explore tab: every finder on one map. Mounted only while shown, so it reads only
 * then (every 250 ms). One cube read serves every layer: it carries the capture context and
 * position the gathering layer draws with, so the map has a single context owner. The saved
 * choices (`prefs`) are held by the workspace, so they outlive the tab.
 */
export function ExploreTab({
  native,
  prefs,
  overlay,
  focus,
}: {
  native: boolean;
  prefs: FinderPreferencesControl;
  overlay?: ActivityWindowToggle | undefined;
  focus?: FinderFocus | null;
}) {
  const visible = usePageVisible();
  const cubes = useCubes(native, { paused: !visible });
  // Only its decoded map art is let go while the window is hidden.
  const drawArt = useRecentlyShown(visible);
  return (
    <ExploreView
      native={native}
      status={cubes.status}
      fresh={cubes.fresh}
      error={cubes.error}
      clearing={cubes.clearing}
      onClear={() => void cubes.clear()}
      prefs={prefs}
      overlay={overlay}
      focus={focus ?? null}
      drawArt={drawArt}
      animate={visible}
    />
  );
}
