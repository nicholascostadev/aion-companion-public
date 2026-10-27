import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useRef } from 'react';
import { PetRadar } from '../features/pets/PetRadar';
import { HIT_SELECTOR, useHitRegions } from '../hooks/useHitRegions';
import { usePetCatalogue, usePets } from '../hooks/usePets';
import { usePageVisible } from '../hooks/usePageVisible';
import { usePetWindow } from '../hooks/usePetWindow';
import { useRecentlyShown } from '../hooks/useRecentlyShown';
import { startWindowDrag } from '../services/companion';
import { setPetHitRegions } from '../services/pets';

const resize = () =>
  void getCurrentWindow()
    .startResizeDragging('SouthEast')
    .catch(() => undefined);
const drag = () => void startWindowDrag().catch(() => undefined);

/** In-game pet radar window (`?view=pet-radar`); always follows the character playing now. */
export default function PetRadarApp() {
  const win = usePetWindow({ markReady: true });
  const { index, error: catalogueError } = usePetCatalogue(win.native);
  // Paused while hidden: nothing to draw, and the workspace keeps its own poll.
  const hidden = win.known && !win.status.visible;
  const visible = usePageVisible();
  const pets = usePets(win.native, { intervalMs: 1000, paused: hidden || !visible, motion: true });
  // A radar left hidden lets its map art go; it is drawn again as the radar shows.
  const drawArt = useRecentlyShown(visible && !hidden);
  const { lock, hide } = win;
  const root = useRef<HTMLElement>(null);
  // Locked, the radar is click-through except its pin, lock and hide buttons.
  useHitRegions(root, HIT_SELECTOR, win.native && win.status.locked, setPetHitRegions);
  const onPin = useCallback(
    (pet: number, pinned: boolean) => void pets.setPinned(pet, pinned),
    [pets],
  );
  return (
    <PetRadar
      native={win.native}
      index={index}
      status={pets.status}
      window={win.status}
      error={win.error || pets.error || catalogueError}
      busy={win.busy}
      onPin={onPin}
      onLock={(locked) => void lock(locked)}
      onHide={() => void hide()}
      onDrag={drag}
      onResize={resize}
      hitRef={root}
      drawArt={drawArt}
    />
  );
}
