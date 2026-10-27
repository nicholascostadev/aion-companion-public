# Local alerts

Open **Alerts** from the workspace or the top menu's bell. Events and bosses are
already listed and their countdowns run without enabling notifications. Enable
a row's notifications, choose how early to be reminded, pick a sound and
optionally enable another notification when it opens or spawns. You do not need
to create a rule, type a name, choose an NPC ID or build a schedule.

The catalogue contains three events (Shugo Festival, Invasion and Spacetime Rift),
three scheduled world-boss groups (Watcher Kaira, Siege Bosses and Guardian Lord
Nahma, covering 12 NPCs), and all 73 field bosses from the bundled roster. Field
bosses are grouped by map and faction. Search and faction/enabled filters help
narrow the list. Disabled rows retain their customized reminders.

Server identity selects the clock automatically. You can choose a region/server
manually when capture started mid-session and the game has not resent identity.
Before detection, calendar countdowns use a clearly labelled fallback clock
(UTC by default) and are marked as estimates. Scheduled built-in notification
delivery still waits until the server clock is known. Bosses that need an actual
game sighting remain unknown until one is received; no respawn time is invented.
Global and Korea/Taiwan calendar defaults
switch with the region while keeping reminder and sound choices. An explicit
advanced schedule override stays unchanged.

The bundled Global server picker contains 106 server names from the official
NCSOFT game-info API, retrieved on 2026-10-17 for the five Global regions. It is a
local snapshot; the application does not contact that roster API at runtime. Korea and
Taiwan clock profiles are available without inventing server-name mappings.

## Maintenance and game availability

The Alerts panel checks the official Global announcement board directly over the
user's connection every minute. No account, app server or remote database is
required. A recognized game-maintenance notice supplies a dated start and expected
end, displayed in the user's local timezone. Normal reminders are suppressed during
that published window; the Wednesday schedule is never hardcoded. Account-only
maintenance does not suppress game reminders. Unsupported notice formats, regional
exceptions, failed requests and data older than three minutes stay unknown and do
not silence reminders. This is announcement-based maintenance information, not a
live per-server health or population feed. See [source research](SERVER_STATUS_RESEARCH.md).

Normal reminders also pause while `AION2.exe` is closed. Enable **Alert when the game
is closed** to receive them anyway; background sound while the running game is
unfocused remains a separate preference. Suppressed occurrences are recorded in
history and do not replay when the game or server returns. Explicit sound/popup
previews remain available.

Enable **Notify me when maintenance is complete** and leave the app running to
watch a scheduled maintenance notice. When that same official notice is marked
complete, the app plays a chime and shows a popup even with the game closed or
unfocused. This separate opt-in works with normal event notifications disabled;
global volume, mute and quiet hours still apply. It fires once across restarts,
never from the expected end time or an old completion discovered on first launch.
The watch and delivery claim are saved locally before notification. Completion
confirms the official announcement for that incident, not a continuous live probe.

Custom reminders remain available as a secondary workflow, including previously
saved rules. Advanced timing customization supports:

- **Once:** a specific date and time.
- **Interval:** an anchor date/time and repeating interval.
- **Calendar:** server-clock opening times and selected weekdays. Empty weekdays
  means every day. Rule-specific IANA timezones can override the main clock.
- **Observed:** a boss NPC or field-event ID received by this app's collector.
  Built-in field-boss rows already carry their names and observation bindings.

Add several advance reminders and a zero-second reminder for the opening itself.
Set the opening duration when it is known to keep an event marked open until it
ends. Each rule can use a popup, one of five local sound patterns, a volume level,
or silent delivery. Global volume multiplies each row's volume once, including
snoozed reminders. The explicit preview control uses the same native delivery
path as real notifications.

Popup cards are 56 pixels tall, show a name and static reminder label, and expire
after 10 seconds. The popup has only an individual Dismiss action, with no
countdown, Snooze button or footer. Normal reminders appear only while AION or one of its
companion overlays is focused and never activate a window. From the workspace,
dismiss a reminder, snooze it for later, or skip a rule's next occurrence. Snoozing creates an
independent reminder; it does not move the rule's regular schedule. Sound can
continue while AION is unfocused if background sound is enabled. A preview from
the workspace can therefore be audible there while its popup remains hidden
until AION is focused. The explicitly requested maintenance-completion popup can
also appear on the desktop without taking focus.

The master switch disables normal reminder delivery. The separate maintenance
completion watch uses its own opt-in. Timed mute and quiet hours suppress matching
notifications while recording their status in history. Quiet hours use the main
server-clock timezone and can cross midnight. Suppressed notifications do not
replay later. History shows up to 500 deliveries, including explicit previews;
clearing it does not make previously delivered events fire again.

## Timing evidence

Schedules belong to a specific service and clock. The bundled calendar snapshot
has separate Global and Korea/Taiwan defaults. Festival openings are hourly at
`:00` and Invasion at `:30`, both with three-minute entry windows. Rift openings
are at 02:00, 05:00, 08:00, 11:00, 14:00, 17:00, 20:00 and 23:00 with a ten-minute
entry window. World-boss recurrence and weekdays vary between services; the
native engine applies the matching calendar and IANA server timezone. This is a
bundled snapshot, not a live online timetable; advanced overrides support later
server changes without renaming or recreating entries.

Boss spawn and defeat observations are actual received records. A respawn
countdown after defeat requires a user-supplied interval and is marked estimated.
Unknown respawn times stay unknown. Field-event absolute clocks are accepted only
when one supported interpretation is plausible near the observation date, and
are explicitly marked interpreted estimates. Unmapped names and states keep
their numeric IDs. The named roster maps field event IDs to the correct NPCs,
including bosses absent from the older encounter classification. No community
live feed or external application's files are read by the app. A field-boss row
can be armed before its first sighting; its countdown appears when local game
traffic provides a timing observation. Open the game's **Field Boss list** while
capture is running to receive its map-specific presence and next-spawn times.
The collector reads the list's `01 91` records: map, numbered boss slots, presence,
optional live coordinates and absolute Unix-millisecond clocks. A complete,
validated list updates the matching map/slot bindings; malformed lists cannot
partially replace observations. This does not require standing near the boss.

If a future spawn is first learned inside an enabled advance-reminder window,
the reminder fires once immediately. Repeated lists cannot repeat that delivery;
old saved observations and expired spawn times do not trigger catch-up alerts.
An elapsed respawn countdown does not prove a boss is alive. Spawn sightings are
shown as current for at most two minutes; older sightings remain historical.

Observations are isolated by server and connection session while identity is
unknown. Starting capture after a spawn cannot reconstruct its missing record.
Calendar schedules follow IANA daylight-saving rules: nonexistent local opening
times are skipped and a repeated local opening time fires once. A suspended app
does not replay notifications more than 30 seconds late.

## Local storage

Rules, revisions, delivery claims, snoozes, skipped occurrences, history and timer
observations live in `offline/alerts.json` under the app data directory. Native
notifications do not depend on browser audio permissions or a visible workspace.
State is replaced atomically before delivering a reminder. Existing local
reminders migrate once. Invalid saved files report an error and remain untouched
by background delivery; saving valid settings explicitly replaces them.

The engine and UI have automated scheduling, persistence and interaction tests.
Audible output and real in-game event timing still require a live comparison;
automated validation does not play sounds or send game input.
