import { useState } from 'react';
import { PetsPanel } from '../features/pets/PetsPanel';
import { usePetCatalogue, usePets } from '../hooks/usePets';
import { usePetFarming } from '../hooks/usePetFarming';
import { usePageVisible } from '../hooks/usePageVisible';
import { usePetWindow } from '../hooks/usePetWindow';
import { useRecentlyShown } from '../hooks/useRecentlyShown';

/** Workspace Pets tab: native state polls only while the tab is showing on screen. */
export function PetsTab({ native, active }: { native: boolean; active: boolean }) {
  // The large catalogue loads on the first visit, not at startup.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const catalogue = usePetCatalogue(native && visited);
  const visible = usePageVisible();
  const paused = !active || !visible;
  // The panel stays mounted to keep every choice; only its decoded map art is let go.
  const drawArt = useRecentlyShown(!paused);
  const pets = usePets(native, { intervalMs: 1000, profileId, paused, motion: true });
  const radar = usePetWindow({ paused });
  const farming = usePetFarming({ configure: pets.configure, radar });
  return (
    <PetsPanel
      native={native}
      index={catalogue.index}
      catalogueError={catalogue.error}
      profileId={profileId}
      onProfile={setProfileId}
      pets={pets}
      radar={radar}
      farming={farming}
      drawArt={drawArt}
    />
  );
}
