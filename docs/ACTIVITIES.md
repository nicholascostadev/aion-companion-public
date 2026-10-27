# Timers

Open **Timers** from the top menu or Home's in-game windows. It is an independent transparent window with its own saved
position, size and lock preference. It follows the same AION focus gate as the
other overlays. Closing a panel hides it; collection continues.

## Timers

Timers shows regional event openings, scheduled bosses, locally observed field
bosses, and daily and weekly resets. It uses this app's bundled alert catalogue
and native scheduling clock. Notifications do not have to be enabled to see the
calendar. Enable reminders separately in Alerts.

The default list includes Shugo Festival, Dimensional Invasion, Spacetime Rift,
Watcher Kaira, Siege Bosses, Guardian Lord Nahma, Eternal and Immortal Gartua,
and the appropriate High Commander when the character's faction is known.
Favorite field bosses and enabled or favorite custom schedules also appear.
An opening with a known duration counts down until the window ends. **Alive**
requires a spawn observed by this app during active collection within the last
two minutes; an old sighting never stays alive indefinitely.

An undetected server uses the explicitly marked fallback clock from Alerts.
Select a region in Alerts if necessary. Unknown respawns stay unknown until a
local observation and a configured respawn interval provide an estimate. There
is no bundled Artifact Siege schedule: create a custom schedule named
**Artifact Siege** in Alerts and favorite it to supply the timer without enabling
notifications. The panel otherwise shows its time as unknown.

Global-service resets use **07:00 UTC**, with the weekly reset on Wednesday.
They are fixed service instants, so the displayed local time can move with
daylight saving. Korea and Taiwan use **05:00 in their service time zone**, with
Wednesday weekly resets. These are calendar defaults, not authoritative live
server announcements; maintenance or special events may differ. The timer panel
displays the selected time zone and reset basis.

## Local state and native integration

Files live in the active channel's app-data folder: stable uses
`%APPDATA%/org.aioncompanion.prototype`, Dev uses
`%APPDATA%/org.aioncompanion.development`.

- `timers-window.json`: window position and size.
- `overlay-locks.json`: lock choices for DPS, Pets, Timers and Trackers.
- `window-positions.json`: where you last dropped the DPS meter, top menu, Group and
  damage details. Pets, Timers and the alert popup keep their spot (and size)
  in their own window files. Only your own drags are saved; default placement, Group
  auto-fit and display changes never overwrite a saved spot. A spot on a monitor that is
  no longer connected (or now off-screen) opens moved just enough to be fully visible.
- `offline/alerts.json`: existing alert configuration and own local observations.

The native commands are `timers_status` and
`activity_window_{status,ready,show,hide,lock,hit_regions}`.
The shared window commands accept `kind: "timers"`.
Launch argument `--timers` requests the panel at startup.
Browser previews use `?mock&view=timers` with local fixtures; they do not collect
game traffic.
