import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { normalizeDashboard, normalizeDelivery } from '../lib/alertsNormalize';
import type {
  AlertActionName,
  AlertConfig,
  AlertDashboard,
  AlertDelivery,
  AlertSound,
} from '../types/alerts';

/* Local native commands; the native worker reads official maintenance notices. */

/** Lightweight: schedule, deliveries and server lists only, never a combat report. */
export const readAlertsStatus = (): Promise<AlertDashboard> =>
  invoke<unknown>('alerts_status').then(normalizeDashboard);

/** Full validated replacement; native rejects a stale `revision`. */
export const configureAlerts = (config: AlertConfig): Promise<AlertDashboard> =>
  invoke<unknown>('alerts_configure', { config }).then(normalizeDashboard);

export const runAlertAction = (
  action: AlertActionName,
  id: string | null = null,
  seconds: number | null = null,
): Promise<AlertDashboard> =>
  invoke<unknown>('alerts_action', { action, id, seconds }).then(normalizeDashboard);

/** Explicit preview through the native sound and popup path; nothing is marked delivered. */
export const testAlert = (sound: AlertSound, volume: number, popup: boolean): Promise<void> =>
  invoke<void>('alerts_test', { sound, volume, popup });

const deliveries = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map(normalizeDelivery)
    .filter((d): d is AlertDelivery => d !== null);

/** Popup window: marks it ready and returns the deliveries native wants on screen. */
export const markPopupReady = (): Promise<AlertDelivery[]> =>
  invoke<unknown>('alerts_popup_ready').then(deliveries);

/** Drops one delivery from the popup only; engine state is changed by `runAlertAction`. */
export const dismissPopup = (id: string) => invoke<void>('alerts_popup_dismiss', { id });

/** Native pushes the popup's deliveries whenever they change. */
export const onPopupDeliveries = (handler: (items: AlertDelivery[]) => void) =>
  listen<unknown>('alerts-popup', (event) => handler(deliveries(event.payload)));

/** Workspace section requested by another window (e.g. the top menu bell). */
export const NAVIGATE_EVENT = 'workspace-navigate';
export const requestWorkspaceTab = (tab: string) => emitTo('main', NAVIGATE_EVENT, { tab });
export const onWorkspaceTab = (handler: (tab: string) => void) =>
  listen<unknown>(NAVIGATE_EVENT, (event) => {
    const tab = (event.payload as { tab?: unknown } | null)?.tab;
    if (typeof tab === 'string') handler(tab);
  });
