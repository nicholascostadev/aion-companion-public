# Local combat collection and analysis

The new collector retains timed damage/healing, incoming damage, casts/windups,
hit flags, buffs and sources, HP samples, deaths/revivals and recorded positions.
Damage amounts are the actual wire amounts; a multi-hit count never multiplies them.
Summons with observed owners are credited to those owners.

Completed encounters are saved in the app data folder's `offline/logs` directory.
The library index supports player/boss text, zone, run and date filters, sorting,
labels, selected deletion and original JSON export. Each encounter keeps a stable
ID. A checkpoint is written every five seconds; an interrupted encounter is
recovered with an explicit warning. Settings and indexes are replaced atomically.
No account, upload, remote leaderboard, telemetry or online updater is present.

The Pets workspace includes the 207-pet roster, family filters, pinned targets,
recorded soul-source monsters and farming maps. Seventy-three map resources have
calibrated, original local terrain; remaining resources use coordinate charts.
The separate game-only radar follows received monster sightings and fresh local
positions. Collection snapshots, progress gains and authoritative level updates
are read independently of damage, with saved profiles scoped by character/server.
Unknown progress and positions remain unknown. See [Pets](PETS.md) for timing,
coordinate conventions, persistence and live-validation limits.

The compact meter always opens on the player ranking, even when only one player
has dealt damage; selecting a player's row shows their skills. Damage-only hit and
crit counters exclude healing, and crit rates require an observed direct-damage flag.
Full reports open in a separate encounter inspector with the player selected.
The live HP bar follows the latest native target state; current-only HP updates
retain the known maximum, and a living boss takes over from a defeated target.
Inspection requests every native event rather than the tail used for routine
polling, and an encounter ID prevents a later fight from replacing the report.

The bundled factual catalogue contains 16,899 skill names, 12,589 NPC names,
538 boss IDs and 51 training-dummy IDs. The app uses its own bundled catalogue.
An optional local JSON catalogue supplies additional names, cooldown durations,
specialty descriptions and boss timers. Known specialty ID mappings gate variant
decoding; unmapped digits never become invented specialty choices. Stigma tiers
are cumulative. Unknown metadata stays unknown.

Encounter boundaries use zone/dungeon changes, dungeon-clear records, observed
boss zero HP/removal/disengagement, configurable trash inactivity and timed dummy
limits. A grace interval lets a new alive boss continue a phase transition. These
signals improve segmentation but do not constitute validation of every encounter's
phase script. Run IDs survive successive encounters in an observed zone/dungeon.

Local alerts run on a native clock independently of visible windows and combat
reports. Rules support one-time, interval, weekday calendar and game-observed
timers; multiple advance reminders and opening notifications; configurable popup
cards, sound and volume; watchlists; snooze, skip, quiet hours, timed mute and
delivery history. Delivery claims persist before notification, preventing replay
across windows and restarts. Delayed wakeups skip stale reminders. Old user
reminders migrate once. See [alerts usage and evidence](ALERTS.md).

The primary alerts workflow is a ready-made catalogue: three named events, three
scheduled world-boss groups covering 12 NPCs, and 73 field bosses. Each row can be
enabled and customized directly. Region changes refresh built-in schedules while
preserving reminder choices. Global volume, auto-detected server clock and faction
filters are supported; existing custom reminders remain available separately.

Observed boss and field timers are scoped to the selected or detected server.
Respawn estimates require a user-provided interval after an observed defeat.
Known field-event IDs resolve to the named catalogue; unmapped names and states
remain numeric. Built-in regional calendar snapshots provide event and world-boss
opening times, with advanced overrides for later server changes. No
community sighting feed or predicted world-spawn schedule is fabricated. Cooldown
timers derived from consistent observed slopes are explicitly estimates.

Group remains independent of damage ranking. Its roster supplies character IDs,
names, classes, servers, level, GS, CP, leader, capacity and readiness. The actual
ready message matches a database ID and distinguishes ready, not ready and unknown.
Inspections stay separate from members; same-name profiles from other servers do
not supply member statistics. The Group toggle enables automatic display only in
a decoded room, including a host waiting alone. A generic party roster does not
open it. Leaving or losing live membership hides the panel while keeping the
toggle enabled for the next room; disabling Group or closing the panel turns it
off. Focus gating, drag, locking, tray and saved
positions continue to apply.

## Evidence limits

- Global packet layouts are covered by recorded reference vectors and structural
  tests. The shared TW/KR opcode map is not a live validation of those clients.
- Starting mid-session cannot reconstruct missing names, roster or already-active
  effects that the server has not resent.
- Activity percentage is based on one-second bins with outgoing damage or healing.
  Cast statistics use observed skill-start notices; hits never fabricate cast counts.
- Direction flags and current-build healing/death details still need an observed
  combat comparison. Capturing idle traffic verifies transport, not combat parity.
- Original class emblems and verified skill artwork are bundled for offline use.
  Unknown artwork keeps a written label. Full specialty descriptions are not bundled;
  numeric variant choices and charge stages are retained, and local metadata can
  supply descriptions. See [artwork provenance](GAME_ARTWORK.md).
- Revival currently needs a positive HP observation. If that record is missed, a
  later death can be treated as a duplicate rather than a new recap.
