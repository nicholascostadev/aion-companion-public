import type { OverlayStatus } from '../types/companion';

/* Readings of `overlay_status` shared by every control that shows or toggles a panel. */

/** The user's choice to show the DPS meter, kept while focus temporarily hides it. */
export const dpsRequested = (overlay: OverlayStatus) =>
  overlay.requested_visible ?? overlay.visible;

/** Automatic Group display in raid rooms is on (older status fields as fallbacks). */
export const groupEnabled = (overlay: OverlayStatus) =>
  overlay.group_enabled ?? overlay.group_requested ?? overlay.group_visible ?? false;

/** The enabled Group panel is eligible for display in the room the player is in now. */
export const groupRequested = (overlay: OverlayStatus) =>
  overlay.group_requested ?? overlay.group_visible ?? false;
