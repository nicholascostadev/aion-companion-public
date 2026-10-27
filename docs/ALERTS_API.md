# Native alerts API (implementation contract)

Alerts run in a native 500 ms worker, independent of combat capture, reports,
visible webviews and browser audio permissions. Rules and claims remain local;
an independent native worker reads official public maintenance notices every minute.
A dedicated popup overlay follows the existing AION-focus rule for normal
reminders; the explicit recovery notification can appear on the desktop. Neither
activates a window.
Sound can continue while the game is unfocused if enabled in the alert preferences.
Normal delivery also checks the game process and fresh announced maintenance.
The separate completion watch bypasses game/normal-alert gates, requires an official
completion update, and still respects volume, mute and quiet hours.

Commands use camelCase arguments in JavaScript:

- `alerts_status()` -> `AlertDashboard` below (lightweight; no combat report).
- `alerts_configure({config})` -> fresh dashboard. Full validated config replacement;
  `revision` must match the current revision, then native increments it.
- `alerts_action({action,id,seconds})` -> fresh dashboard. Actions: `dismiss`
  (delivery id), `dismiss_all`, `snooze` (delivery id, 60..86400 seconds), `skip`
  (rule id's next occurrence), `clear_history`, `mute` (seconds), `unmute`.
- `alerts_test({sound,volume,popup})` -> success. Explicit preview only; same native
  sound and popup path, no real event is marked delivered.
  Development builds also present test popups outside the game, for the Alerts
  tab's Dev-only "Test toast"; stable keeps them to the AION-focus rule.
- `alerts_popup_ready()` and `alerts_popup_dismiss({id})` are popup lifecycle
  commands supplied by the UI implementation.

`AlertDashboard`:

```ts
interface AlertDashboard {
  now_ms: number;
  config: AlertConfig;
  upcoming: AlertOccurrence[];
  // Present for every catalogue entry, even with notifications disabled.
  catalogue_upcoming: CatalogueCountdown[];
  active: AlertDelivery[];
  history: AlertDelivery[];
  observed: ObservedTimer[];
  regions: { id: string; name: string; timezone: string }[];
  servers: { id: string; name: string; region: string }[];
  detected_server: { id: string; name: string; region: string } | null;
  templates: AlertTemplate[];
  bosses: { id: number; name: string }[];
  error: string | null;
  catalogue: AlertCatalogueEntry[];
  effective_region: string;
  effective_timezone: string;
  effective_faction: 'all' | 'elyos' | 'asmodian';
  clock_ready: boolean;
  clock_estimated: boolean;
  clock_source: string;
  game_running: boolean | null;
  delivery_paused: 'game_closed' | 'server_down' | null;
  server_status: {
    checked_ms: number | null;
    last_attempt_ms: number | null;
    stale: boolean;
    error: string | null;
    source: string;
    maintenance: {
      title: string;
      url: string;
      starts_ms: number;
      ends_ms: number;
      completed: boolean;
    } | null;
    servers: {
      id: string;
      name: string;
      region: string;
      status: 'online' | 'maintenance' | 'offline' | 'unknown';
      population: number | null;
      character_creation_open: boolean | null;
    }[];
  };
}
interface AlertConfig {
  version: 1;
  revision: number;
  enabled: boolean;
  region: string;
  server: string;
  timezone: string;
  background_sound: boolean;
  alert_when_game_closed: boolean; // default false, including old saved config
  notify_server_back: boolean; // separate completion-watch opt-in, default false
  muted_until_ms: number | null;
  quiet_hours: { start: string; end: string } | null;
  rules: AlertRule[];
  volume: number; // global multiplier 0..1, default 1
  faction: 'auto' | 'all' | 'elyos' | 'asmodian'; // default auto
}
interface CatalogueCountdown {
  entry_id: string;
  rule_id: string;
  name: string;
  category: 'event' | 'world_boss' | 'field_boss';
  due_ms: number | null;
  remaining_ms: number | null;
  state: 'scheduled' | 'open' | 'unknown';
  clock: 'server' | 'fallback' | 'own' | 'observed' | 'none';
  timezone: string | null;
  basis: string;
  estimated: boolean;
  notify: 'on' | 'off' | 'waiting_for_clock';
  server: string | null;
}
interface AlertRule {
  preset_id: string | null;
  npc_ids: number[];
  event_ids: number[];
  schedule_override: boolean;
  id: string;
  name: string;
  category: 'event' | 'world_boss' | 'field_boss' | 'custom';
  enabled: boolean;
  favorite: boolean;
  schedule: AlertSchedule | null;
  timezone: string | null;
  lead_seconds: number[]; // distinct 0..86400, 0 = at start
  sound: 'none' | 'chime' | 'ping' | 'bell' | 'beep' | 'pulse' | 'alarm';
  volume: number;
  popup: boolean;
  duration_seconds: number; // 0 if opening/entry duration is not known
  npc_id: number | null;
  event_id: number | null;
  respawn_seconds: number | null; // user estimate, 60..2678400; default null
  notes: string;
}
type AlertSchedule =
  | { type: 'once'; at_ms: number }
  | { type: 'interval'; anchor_ms: number; every_seconds: number }
  | { type: 'calendar'; times: string[]; weekdays: number[] }
  | { type: 'observed' };
// Calendar HH:mm times use the rule timezone or global config timezone.
// Weekdays are 0=Monday .. 6=Sunday; empty means every day.
interface AlertOccurrence {
  rule_id: string;
  name: string;
  category: AlertRule['category'];
  due_ms: number | null;
  remaining_ms: number | null;
  state: 'scheduled' | 'open' | 'unknown' | 'disabled';
  basis: string;
  estimated: boolean;
  source: string | null;
  server: string | null;
}
interface AlertDelivery {
  id: string;
  rule_id: string;
  name: string;
  category: AlertRule['category'];
  due_ms: number;
  fired_ms: number;
  lead_seconds: number;
  phase: 'before' | 'start' | 'snooze' | 'test' | 'recovery';
  sound: AlertRule['sound'];
  volume: number;
  popup: boolean;
  status: 'delivered' | 'quiet' | 'muted' | 'dismissed' | 'snoozed' | 'game_closed' | 'server_down';
}
interface ObservedTimer {
  id: string;
  name: string;
  category: 'event' | 'field_boss' | 'world_boss';
  npc_id: number | null;
  event_id: number | null;
  due_ms: number | null;
  observed_ms: number;
  server: string;
  state: string;
  basis: string;
  estimated: boolean;
}
interface AlertTemplate {
  id: string;
  name: string;
  category: AlertRule['category'];
  schedule: AlertSchedule | null;
  duration_seconds: number;
  regions: string[];
  source: string | null;
  notes: string;
  verified: boolean;
  npc_id: number | null;
}
interface AlertCatalogueEntry {
  id: string;
  name: string;
  category: 'event' | 'world_boss' | 'field_boss';
  map_id: number | null;
  map: string | null;
  faction: 'all' | 'elyos' | 'asmodian';
  members: { id: number; name: string }[];
  rule: AlertRule; // valid, disabled, fully named/bound regional default
  source: string;
  note: string;
  recharge_minute: number | null; // server-clock daily key recharge minute
}
```

The native engine persists settings, delivery claims, dismissals, snoozes, history
and observed timers. It rejects invalid times, unknown zones, duplicate IDs and
unbounded collections atomically. A reminder occurrence is claimed once across
windows and restarts; delayed wakeups do not replay stale reminders.

Built-in schedules have source and region metadata. Unknown times stay unknown;
users may edit schedules to match their server. Observed boss countdowns are scoped
to a detected or explicitly chosen server. No community live feeds are accessed;
only the official public notice API is polled for announced maintenance.

The catalogue is always present, including before character identity: three named
events, three scheduled world-boss groups covering 12 NPCs, and 73 field bosses.
To enable/customize an entry, upsert `entry.rule` (or its existing configured rule,
matched by `preset_id`) with the requested notification changes. No naming or
NPC selection is required. Built-in names and bindings stay canonical; schedules,
entry durations and zones follow region changes unless `schedule_override=true`.
Disabling a row retains its customized settings. Unknown preset IDs and duplicate
preset selections are rejected. Existing custom rules retain their IDs/settings.

`region="global"` allows automatic region selection from the selected/detected
server. Built-in calendar delivery waits for `clock_ready`; the list remains
visible and can be configured while waiting. Custom absolute/observed rules are
independent of that gate. Quiet hours use `effective_timezone`; global sound volume
multiplies each rule's volume once, including snoozes and explicit previews.

`now_ms` and all timestamps use Unix UTC milliseconds. Timezone values are IANA
names. The initial profile is `region: "global"` (automatic region/custom clock),
`server: ""` (automatic detection), timezone UTC, master alerts disabled. Observed timer
`server` values are scope keys of the form `region/server-id`; before identity
is received they use a connection-session scope. The engine filters observations
to the current scope. Boss choices come from the complete bundled NPC catalogue.

`server_status` currently describes official announced Global maintenance only.
Server rows come from the bundled roster and become `maintenance` inside a fresh,
recognized notice window, otherwise `unknown`. Population and character creation
remain null. An official completion clears suppression early; elapsed estimates
do not prove live recovery. Unsupported formats and errors fail open.

`active` contains delivered popup-enabled entries for 15 seconds after firing;
quiet/muted/dismissed/snoozed entries are excluded. History retains the latest 500
deliveries, including previews and suppression statuses. Preview delivery phase is
`test`; a preview does not claim or change a real rule occurrence. A snoozed
reminder receives a new delivery ID. Clearing history retains delivery claims.

The native host uses `alert_window::present` for newly fired deliveries and
`alert_window::replace` each tick to synchronize the exact active set. Popup
visibility for normal reminders also requires the existing game-focus gate. A preview requested from
the workspace can play sound there; its popup appears only if the user returns
to AION during the 15-second lifetime. Nothing takes focus.

Recovery deliveries use `rule_id="maintenance-complete"` and `phase="recovery"`;
these can appear outside game focus. The local saved document adds a default-null
`maintenance_watch` timestamp and the config's two default-false flags, so existing
version-1 files still load. Watch arming and once-only completion claims are persisted
before sound or popup. Explicitly discovering an old completion does not arm it.
