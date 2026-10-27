import type {
  AlertCatalogueEntry,
  AlertDashboard,
  AlertDelivery,
  AlertRule,
  ServerStatusRow,
  ServerStatusSnapshot,
} from '../../types/alerts';

/* Test fixtures shaped like docs/ALERTS_API.md payloads. */

export const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

export const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({
  id: 'r1',
  name: 'Shugo Festival',
  category: 'event',
  enabled: true,
  favorite: false,
  schedule: { type: 'calendar', times: ['12:30'], weekdays: [] },
  timezone: null,
  lead_seconds: [300, 0],
  sound: 'chime',
  volume: 0.8,
  popup: true,
  duration_seconds: 600,
  npc_id: null,
  event_id: null,
  respawn_seconds: null,
  notes: '',
  preset_id: null,
  npc_ids: [],
  event_ids: [],
  schedule_override: false,
  ...patch,
});

/** Ready-made entries shaped like native's catalogue: complete, disabled default rules. */
export const entry = (
  patch: Partial<Omit<AlertCatalogueEntry, 'rule'>> = {},
  rulePatch: Partial<AlertRule> = {},
): AlertCatalogueEntry => {
  const id = patch.id ?? 'event-rift';
  const category = patch.category ?? 'event';
  return {
    id,
    name: 'Spacetime Rift',
    category,
    map_id: null,
    map: null,
    faction: 'all',
    members: [],
    source: 'Local game calendar',
    note: '',
    recharge_minute: null,
    ...patch,
    rule: rule({
      id: `preset-${id}`,
      name: patch.name ?? 'Spacetime Rift',
      category,
      enabled: false,
      preset_id: id,
      schedule: {
        type: 'calendar',
        times: ['02:00', '05:00', '08:00', '11:00', '14:00', '17:00', '20:00', '23:00'],
        weekdays: [],
      },
      duration_seconds: 600,
      volume: 0.6,
      ...rulePatch,
    }),
  };
};

export const catalogue = (): AlertCatalogueEntry[] => [
  entry(),
  entry(
    {
      id: 'world-siege',
      name: 'Siege Bosses',
      category: 'world_boss',
      members: [
        { id: 2_200_001, name: 'Executor Tamasa' },
        { id: 2_200_002, name: 'Executor Argo' },
        { id: 2_200_003, name: 'Turncoat Ducal' },
      ],
    },
    { schedule: { type: 'observed' }, npc_ids: [2_200_001, 2_200_002, 2_200_003] },
  ),
  entry(
    {
      id: 'field-2100100',
      name: 'Test Guardian',
      category: 'field_boss',
      map: 'Verteron',
      map_id: 210_010_000,
      faction: 'elyos',
      members: [{ id: 2_100_100, name: 'Test Guardian' }],
    },
    { schedule: { type: 'observed' }, npc_id: 2_100_100 },
  ),
  entry(
    {
      id: 'field-2200200',
      name: 'Dark Warden',
      category: 'field_boss',
      map: 'Altgard',
      map_id: 220_030_000,
      faction: 'asmodian',
      members: [{ id: 2_200_200, name: 'Dark Warden' }],
    },
    { schedule: { type: 'observed' }, npc_id: 2_200_200 },
  ),
];

export const delivery = (patch: Partial<AlertDelivery> = {}): AlertDelivery => ({
  id: 'r1:1',
  rule_id: 'r1',
  name: 'Shugo Festival',
  category: 'event',
  due_ms: NOW + 300_000,
  fired_ms: NOW,
  lead_seconds: 300,
  phase: 'before',
  sound: 'chime',
  volume: 0.8,
  popup: true,
  status: 'delivered',
  ...patch,
});

export const serverRow = (patch: Partial<ServerStatusRow> = {}): ServerStatusRow => ({
  id: '1001',
  name: 'Server A',
  region: 'eu',
  status: 'unknown',
  population: null,
  character_creation_open: null,
  ...patch,
});

/** A fresh check a minute ago with no maintenance announced: both servers unknown. */
export const serverStatus = (patch: Partial<ServerStatusSnapshot> = {}): ServerStatusSnapshot => ({
  checked_ms: NOW - 60_000,
  last_attempt_ms: NOW - 60_000,
  stale: false,
  error: null,
  source: 'https://example.invalid/notices',
  maintenance: null,
  servers: [
    serverRow({ status: 'unknown' }),
    serverRow({ id: '2001', name: 'Server B', region: 'na-east', status: 'unknown' }),
  ],
  ...patch,
});

export const dashboard = (patch: Partial<AlertDashboard> = {}): AlertDashboard => ({
  now_ms: NOW,
  config: {
    version: 1,
    revision: 3,
    enabled: true,
    region: 'eu',
    server: '',
    timezone: 'Europe/Berlin',
    background_sound: true,
    muted_until_ms: null,
    quiet_hours: null,
    volume: 1,
    faction: 'auto',
    alert_when_game_closed: false,
    notify_server_back: false,
    rules: [
      rule(),
      rule({
        id: 'r2',
        name: 'Field boss watch',
        category: 'field_boss',
        enabled: false,
        schedule: { type: 'interval', anchor_ms: NOW - 3_600_000, every_seconds: 7200 },
      }),
    ],
  },
  upcoming: [
    {
      rule_id: 'r1',
      name: 'Shugo Festival',
      category: 'event',
      due_ms: NOW + 90_000,
      remaining_ms: 90_000,
      state: 'scheduled',
      basis: 'calendar 12:30 Europe/Berlin',
      estimated: false,
      source: null,
      server: null,
    },
  ],
  active: [],
  history: [],
  observed: [],
  regions: [
    { id: 'eu', name: 'Europe', timezone: 'Europe/Berlin' },
    { id: 'na-east', name: 'North America East', timezone: 'America/New_York' },
  ],
  servers: [
    { id: '1001', name: 'Server A', region: 'eu' },
    { id: '2001', name: 'Server B', region: 'na-east' },
  ],
  detected_server: null,
  templates: [],
  bosses: [{ id: 2_100_100, name: 'Test Guardian' }],
  catalogue: [],
  effective_region: 'eu',
  effective_timezone: 'Europe/Berlin',
  effective_faction: null,
  clock_ready: true,
  clock_estimated: false,
  clock_source: 'region',
  catalogue_upcoming: [],
  game_running: true,
  delivery_paused: null,
  server_status: serverStatus(),
  error: null,
  ...patch,
});
