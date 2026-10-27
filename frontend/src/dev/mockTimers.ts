import { dashboard } from './mockAlerts';
import { FRESH, LONG } from './mockScenario';
import type { TimerRow, TimersStatus } from '../types/timers';

const FIXTURE_NOW = Date.now();
const INCLUDED = new Set([
  'festival',
  'invasion',
  'rift',
  'watcher-kaira',
  'siege-bosses',
  'guardian-nahma',
  'field-2101074',
  'field-2400800',
  'field-2101131',
  'field-2400853',
  'field-2101120',
  'field-2400855',
  'field-2101122',
  'field-2400854',
]);

/** Same service reset instants as native; display timezone is a separate choice. */
function nextReset(now: number, region: string, weekly: boolean): number {
  const offset = region === 'tw' ? 8 : region === 'kr' ? 9 : 0;
  const hour = region === 'tw' || region === 'kr' ? 5 : 7;
  const local = new Date(now + offset * 3600_000);
  let due =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) -
    offset * 3600_000;
  if (weekly) due += ((3 - local.getUTCDay() + 7) % 7) * 86400_000;
  if (due <= now) due += (weekly ? 7 : 1) * 86400_000;
  return due;
}

/** Native-shaped fixture using this app's existing Alerts catalogue and clock. */
export function timersStatus(): TimersStatus {
  const alerts = dashboard();
  const now = alerts.now_ms;
  const region = alerts.regions.find((r) => r.id === alerts.effective_region);
  const rows: TimerRow[] = alerts.catalogue_upcoming
    .filter(
      (row) =>
        (INCLUDED.has(row.entry_id) ||
          alerts.config.rules.some((rule) => rule.preset_id === row.entry_id && rule.favorite)) &&
        !(
          alerts.effective_faction !== null &&
          [
            'field-2101131',
            'field-2400853',
            'field-2101120',
            'field-2400855',
            'field-2101122',
            'field-2400854',
          ].includes(row.entry_id) &&
          alerts.catalogue.find((entry) => entry.id === row.entry_id)?.faction !==
            alerts.effective_faction
        ),
    )
    .map((row) => {
      const entry = alerts.catalogue.find((e) => e.id === row.entry_id);
      return {
        id: row.entry_id,
        name: row.entry_id === 'invasion' ? 'Dimensional Invasion' : row.name,
        category: row.category,
        due_ms: row.due_ms,
        ends_ms:
          row.due_ms !== null && entry && entry.rule.duration_seconds > 0
            ? row.due_ms + entry.rule.duration_seconds * 1000
            : null,
        state: row.state === 'open' && row.category !== 'event' ? 'unknown' : row.state,
        estimated: row.estimated,
        basis: row.basis,
        timezone: row.timezone,
      };
    });
  for (const rule of alerts.config.rules.filter(
    (rule) => rule.preset_id === null && (rule.enabled || rule.favorite),
  )) {
    const row = alerts.upcoming.find((item) => item.rule_id === rule.id);
    if (row)
      rows.push({
        id: rule.id,
        name: rule.name,
        category: 'event',
        due_ms: row.due_ms,
        ends_ms:
          row.due_ms !== null && rule.duration_seconds > 0
            ? row.due_ms + rule.duration_seconds * 1000
            : null,
        state: row.state,
        estimated: row.estimated,
        basis: 'Your own schedule',
        timezone: rule.timezone,
      });
  }
  if (!rows.some((row) => row.name.toLowerCase() === 'artifact siege'))
    rows.push({
      id: 'artifact-siege',
      name: 'Artifact Siege',
      category: 'event',
      due_ms: null,
      ends_ms: null,
      state: 'unknown',
      estimated: false,
      basis: 'Set an Artifact Siege schedule in Alerts for your service',
      timezone: null,
    });
  // Explicit visual fixtures for a known window, a local sighting and an unknown boss.
  // These are preview-only observations, never inferred from a calendar in the product.
  const event = rows.find((r) => r.category === 'event');
  const boss = rows.find((r) => r.category === 'field_boss');
  const observed = boss
    ? {
        ...boss,
        state: 'alive' as const,
        due_ms: null,
        ends_ms: FIXTURE_NOW + 120_000,
        basis: 'Demo local boss sighting',
        estimated: false,
      }
    : null;
  const demoRows = rows.map((row) =>
    !FRESH && row.id === event?.id
      ? {
          ...row,
          state: 'open' as const,
          due_ms: FIXTURE_NOW - 180_000,
          ends_ms: FIXTURE_NOW + 17 * 60_000,
          basis: 'Demo opening from the bundled calendar',
        }
      : !FRESH && row.id === boss?.id && observed
        ? observed
        : row,
  );
  return {
    now_ms: now,
    region: FRESH ? null : alerts.effective_region,
    region_name: FRESH ? 'Server unknown' : (region?.name ?? 'Custom server clock'),
    timezone: alerts.effective_timezone,
    clock_ready: !FRESH,
    clock_estimated: FRESH,
    rows: demoRows,
    resets: {
      daily_ms: nextReset(now, alerts.effective_region, false),
      weekly_ms: nextReset(now, alerts.effective_region, true),
      timezone: alerts.effective_timezone,
      basis: ['kr', 'tw'].includes(alerts.effective_region)
        ? 'Service reset: 05:00 local, Wednesday weekly'
        : 'Global reset: 07:00 UTC, Wednesday weekly',
    },
    error: LONG ? 'Waiting for a fresh game observation.' : null,
  };
}
