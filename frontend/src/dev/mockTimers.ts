import { dashboard } from './mockAlerts';
import { FRESH, LONG } from './mockScenario';
import type { TimerMap, TimerRow, TimersStatus } from '../types/timers';

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

/** Preview zone: the Abyss, so the map picker can show the normal world's bosses too. */
const PREVIEW_ZONE = 20;
type Dashboard = ReturnType<typeof dashboard>;

function catalogueRow(alerts: Dashboard, row: Dashboard['catalogue_upcoming'][number]): TimerRow {
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
    map_id: entry?.map_id ?? null,
  };
}

/** Field bosses by map, as native groups them: the normal world first, then the Abyss. */
function bossMaps(alerts: Dashboard, current: number | null): TimerMap[] {
  const maps = new Map<number, TimerMap>();
  for (const row of alerts.catalogue_upcoming) {
    const entry = alerts.catalogue.find((e) => e.id === row.entry_id);
    if (!entry || entry.map_id === null) continue;
    const side = alerts.effective_faction;
    if (side && entry.faction !== 'all' && entry.faction !== side && entry.map_id !== current)
      continue;
    const map = maps.get(entry.map_id) ?? {
      id: entry.map_id,
      name: entry.map ?? '',
      rows: [],
    };
    map.rows.push(catalogueRow(alerts, row));
    maps.set(entry.map_id, map);
  }
  return [...maps.values()].sort(
    (a, b) => Number(a.id < 1000) - Number(b.id < 1000) || a.id - b.id,
  );
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
    .map((row) => catalogueRow(alerts, row));
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
        map_id: null,
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
      map_id: null,
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
    current_map: FRESH ? null : { id: PREVIEW_ZONE, name: 'Chaotic Lower Reshanta' },
    maps: bossMaps(alerts, FRESH ? null : PREVIEW_ZONE),
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
