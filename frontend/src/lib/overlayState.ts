import type { OverlayStatus } from '../types/companion';

/* Readings of `overlay_status` shared by every control that shows or toggles a panel. */

/** The user's choice to show the DPS meter, kept while focus temporarily hides it. */
export const dpsRequested = (overlay: OverlayStatus) =>
  overlay.requested_visible ?? overlay.visible;
