import { GroupPanel } from '../features/group/GroupPanel';
import { useGroup } from '../hooks/useGroup';
import { useCallback, useState } from 'react';
import { hideGroupOverlay } from '../services/companion';
import { fitGroupWindow } from '../services/groupWindow';

export default function GroupApp() {
  const group = useGroup();
  const [error, setError] = useState('');
  const native = group.native;
  // The window follows the panel's size, so the whole roster shows without scrolling.
  const fit = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      if (native)
        // A size the window cannot take only leaves the panel scrolling; nothing to act on.
        void fitGroupWindow(width, height).catch((cause: unknown) => console.warn(cause));
    },
    [native],
  );
  return (
    <GroupPanel
      status={group.status}
      native={group.native}
      error={error || group.error}
      onHide={() => void hideGroupOverlay().catch((cause: unknown) => setError(String(cause)))}
      onFit={fit}
    />
  );
}
