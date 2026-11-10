import { useState } from 'react';
import {
  GuideDialog,
  type GuideDialogProps,
  type GuideFacts,
} from '../features/onboarding/GuideDialog';
import { usePetFarming } from '../hooks/usePetFarming';
import { usePetCatalogue, usePets } from '../hooks/usePets';
import { usePetWindow } from '../hooks/usePetWindow';

/**
 * The guide with what only it needs: pet farming state and the pet radar, read while the
 * guide is open and on screen, and the pet catalogue, loaded the first time the Pets step
 * shows. Everything else comes from the workspace, so the guide changes the same state.
 * Loaded on demand with the guide.
 */
export function GuideHost({
  facts,
  ...props
}: Omit<GuideDialogProps, 'facts'> & { facts: Omit<GuideFacts, 'pets'> }) {
  const active = props.open && props.pageVisible;
  const [wantCatalogue, setWantCatalogue] = useState(false);
  if (props.open && props.chapter === 'pets' && !wantCatalogue) setWantCatalogue(true);
  const catalogue = usePetCatalogue(facts.native && wantCatalogue);
  const pets = usePets(facts.native, { intervalMs: 2000, paused: !active });
  const radar = usePetWindow({ paused: !active });
  const farming = usePetFarming({ configure: pets.configure, radar });
  return (
    <GuideDialog
      {...props}
      facts={{
        ...facts,
        pets: {
          status: pets.status,
          error: pets.error,
          busy: pets.busy,
          index: catalogue.index,
          catalogueError: catalogue.error,
          farming,
          setPinned: pets.setPinned,
          radar: {
            status: radar.status,
            known: radar.known,
            busy: radar.busy,
            error: radar.error,
            setRequested: (on) => (on ? radar.show() : radar.hide()),
          },
        },
      }}
    />
  );
}
