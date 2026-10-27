import { useCallback, useState } from 'react';
import { DamageDetails } from '../features/live/DamageDetails';
import { useInspectedReport } from '../hooks/useInspectedReport';
import { useOverlayControls } from '../hooks/useOverlay';
import { hideDetails, markDetailsReady } from '../services/companion';

/** Damage-details window: a player row opened from the DPS meter. */
export default function DetailsApp() {
  const controls = useOverlayControls({ markReady: markDetailsReady });
  const selection = controls.overlay.details_selection ?? null;
  // Hidden by Close or by the focus gate: refreshes pause, the snapshot stays.
  const visible = controls.overlay.details_visible ?? false;
  const inspected = useInspectedReport(selection, controls.native, visible);
  const [error, setError] = useState('');
  const close = useCallback(() => {
    void hideDetails().then(
      () => setError(''),
      (cause: unknown) => setError(String(cause)),
    );
  }, []);
  return (
    <DamageDetails
      selection={selection}
      inspected={inspected}
      native={controls.native}
      windowError={error || controls.error}
      onClose={close}
    />
  );
}
