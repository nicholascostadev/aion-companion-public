import { invoke } from '@tauri-apps/api/core';
import type { TimersStatus } from '../types/timers';

/** Native owns the Alerts catalogue, schedules and local sightings. */
export const readTimersStatus = () => invoke<TimersStatus>('timers_status');
