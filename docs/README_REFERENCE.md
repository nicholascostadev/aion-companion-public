# Aion Companion reference

Technical detail moved from the [README](../README.md): full feature list, overlay
behaviour, live capture, updates, local storage, accuracy limits and project
structure. Players should start with the README and the
[installation guide](INSTALLATION.md).

## Features in detail

- A Home page that the workspace opens on: capture state and every in-game
  window in one place, alerts ringing now, the next openings counting down on a
  three-hour thread, the last fights with their result and trend, the pet being
  farmed with this session's pickups, and first steps that tick off by themselves.
- Live encounter, active and rolling DPS, per-player and per-skill breakdowns,
  target splits, healing, incoming damage, observed cast and hit flags.
- Compact damage meter with player ranking, per-player skill details,
  Boss/All filtering and local encounter history.
- Local encounter logs with search, filters, run grouping, labels, comparisons,
  original JSON export, checkpoint recovery and selected deletion.
- Detailed reports with rotations, openers, buffs, death recaps, highlights,
  damage/HP timelines, boss projections and timed training-dummy sessions.
- Separate Group inspection with roster identity, class, level, gear score,
  Combat Power, leader, capacity and tri-state observed readiness. Profiles can
  be inspected and compared before joining.
- Borderless DPS, Group and tracker overlays, a draggable top menu, click-through
  locking, tray controls, configurable shortcuts, privacy, fading and scale.
- Local tracker presets, observed/estimated cooldowns and buff timers.
- Native event and boss alerts with multiple advance reminders, opening-time
  notifications, regional calendars, observed respawns, popup cards, sounds,
  snooze, quiet hours, mute and delivery history. See [alerts](ALERTS.md).
  Three events, three scheduled boss groups and 73 field bosses are listed by
  name, map and faction, ready to enable and customize without creating rules.
- Pet collection across five families with Level 3 counts by type, soul progress,
  pinned farming targets, original local map terrain with recorded spawn
  locations, and a separate live nearby-monster radar. See [pet collection and farming](PETS.md).
- Separate Timers with regional event openings, local boss sightings and reset
  countdowns. See [Timers](ACTIVITIES.md).
- Downloadable bug reports in Settings with recent local errors, build details,
  capture counters and window state. Send the file manually with reproduction
  steps; nothing is uploaded automatically. See [bug reports](BUG_REPORTS.md).
- Native backups in Settings for preferences, pet progress
  and optional saved combat logs, with validated previews and restart recovery
  that retains rollback copies. See [backup and recovery](BACKUPS.md).

General UI icons use Lucide. Class and skill icons use original AION 2 artwork
bundled locally; unavailable artwork keeps its written label.

## Overlay behaviour

Enable Group to show its overlay automatically in an observed raid room. It stays
hidden outside a room and hides when you leave, while the toggle remains enabled
for the next room. Turning Group off or closing its panel disables it. Overlays
appear only while AION is focused; capture continues while they are hidden.
Clicking, dragging or resizing an overlay never takes focus from AION; only
clicking into a text field brings that overlay forward for typing.

Every lockable overlay (DPS meter, Pets radar, Timers) starts unlocked,
and the tracker layer starts in arrange mode until you press Done. Each window
remembers your lock choice across hiding and restarts, and opens where you last
dragged it. A saved meter lock is restored only while its unlock shortcut works.
Lock or unlock the meter through the top menu or the configured shortcut. While
it is unlocked, drag from the panel's summary, headings, rows or empty space; a
stationary row click still inspects damage.

When one player has dealt damage, the meter immediately shows that player's skill
damage, observed crit rate, hit count and share. Multiple damage dealers use a
player ranking. Full player reports remain available in a separate borderless
window. Meter controls remain clickable while locked; its background passes clicks
through to the game. The full inspector keeps the selected encounter when a new
fight begins and retrieves every event, including the start of long fights.
The boss HP bar uses the latest native target state and accepts updates that carry
only current HP, keeping the most recently observed maximum.

## Live capture and overlays

[Npcap](https://npcap.com/#download) must be installed separately for live capture.
The collector finds `AION2.exe`'s TCP connection on game port 13328 and applies a
receive-only connection filter. It handles TCP ordering, retransmits, sequence
wrap, compressed bundles and bounded record parsing. Stream gaps, driver drops and
rejected observations remain visible in diagnostics and exports. Raw traffic is
not uploaded or saved.

Live collection starts automatically whenever the app opens, including from the
Desktop or Start menu. It waits for AION, follows reconnects and retries driver
or adapter errors every 10 seconds while keeping the error visible. Closing or
hiding an overlay does not stop collection. Quitting the app shuts down capture
and saves the collected results.

Launching with `--overlay` also requests the DPS meter. `--group` enables automatic
Group display in rooms. `--trackers` requests the tracker surface with its saved
arrange choice. `--timers` requests the activity timer panel. There are no capture
start/stop buttons or stop shortcuts. Default shortcuts are:

| Shortcut      | Action                |
| ------------- | --------------------- |
| Ctrl+Shift+F9 | Show/hide DPS         |
| Ctrl+Shift+F8 | Lock/unlock the meter |
| Ctrl+Shift+F6 | Reset encounter       |
| Ctrl+Shift+F5 | Copy summary          |
| Ctrl+Shift+F4 | Compact strip         |

In-game action shortcuts respect game focus; visibility and recovery controls
stay available. Reset encounter clears the current fight without stopping live
collection. Reports can be saved while capture continues. The tray provides
workspace, overlay and quit actions. A composited/windowed game display is needed
for desktop overlays to appear over it.

## GitHub updates

Settings includes a GitHub update checker. The app checks the latest published
stable release at startup; checking or downloading never interrupts collection.
The workspace header shows the available version and follows download readiness
on every tab. Click its update indicator to open App updates in Settings directly.
Public releases are checked and downloaded over HTTPS without additional tools.
For this private repository's automatic updates, install
[GitHub CLI](https://cli.github.com/) and authenticate with an account that can
read `nicholascostadev/aion-companion-public` using `gh auth login`. The app reuses that
authentication without asking for or storing a token. Alternatively download
Setup in your browser; GitHub CLI is not required to install or run a downloaded
copy. Automatic restart updates belong to installed copies; portable copies offer
the installer and manual replacement instructions.

Download update verifies the executable and license file against the release's
SHA-256 asset digests and stages an immutable installation. Restart to update
saves capture first; only after the app exits does the launcher atomically switch
versions. Desktop and Start menu shortcuts continue to open the current version.
If saving fails, the current app keeps collecting and the previous version stays
selected. No gameplay recordings or character data are sent to GitHub.

Each PR merged into `master` creates a versioned Windows release. **Build Windows
executable** can also be run manually for Actions artifacts. See
[release instructions](RELEASING.md).

## Local files

The app stores its data under `%APPDATA%/org.aioncompanion.prototype`:

- `offline/logs`: durable encounter records, with an index and recovery checkpoint.
- `offline/exports`: exported original log JSON.
- `offline/settings.json`: local preferences and tracker presets.
- `offline/alerts.json`: alert rules, delivery claims, history and observed timers.
- `offline/alert-sounds`: generated local notification tones.
- `recordings`: this app's normalized replay files.
- `comparisons`: independent capture reports with diagnostics and encounter data.

Import accepts only the app's versioned recording schema. Replay can open a live
recording or an explicitly selected local file, and includes an optional fictional
demo. It does not scan other applications' data. Live collection and replay use
separate state. App-owned data is not bundled in source control.

## Accuracy and evidence

The collector remains experimental for Global PvE. Known damage values are actual
observed amounts; multi-hit counts never multiply them. Known summons are credited
only through observed ownership. Missing identity, roster or spawn records cannot
be reconstructed by guesswork.

Cast totals use observed skill-start records; attack-only sequences are labelled
separately. Critical and positional rates use only observed flags. Readiness is
ready, not ready or unknown with observation ages; a member-ready bit does not
prove a timed check's start or expiry. Encounter segmentation uses observed game
signals with transition grace periods and configurable inactivity, and still
needs comparisons against current live encounter behavior.

Regional/proxy parity, PvP, complete encounter scripts and live ready-toggle
accuracy are not established. Starting capture mid-session can leave information
unavailable until the game sends it again. See
[feature evidence and limits](OFFLINE_FEATURES.md),
[Group protocol evidence](GROUP_PROTOCOL.md), and the [native API](OFFLINE_API.md).
Protocol reference data and third-party licenses are recorded in
[`THIRD_PARTY_NOTICES.txt`](../THIRD_PARTY_NOTICES.txt). Original class and skill
artwork remains copyright NCSOFT / NC Corporation; see
[artwork provenance](GAME_ARTWORK.md). Npcap is not redistributed.

## Build and develop

For local development, install Git for Windows, Node.js 22.12+, Rust, Microsoft
C++ Build Tools and WebView2, then run from Git Bash:

```bash
bash dev.sh dev
```

This creates **Aion Companion Dev** shortcuts and starts the native app with
React/CSS live reload. Rust changes recompile and restart the app. The Dev badge
shows the branch and commit in its tooltip. Startup/build output is saved in
`%LOCALAPPDATA%/AionCompanionDev/development.log` when using the shortcut.

For a standalone local build without a development server:

```bash
bash dev.sh build --run
```

Local builds publish only to `%LOCALAPPDATA%/AionCompanionDev`; they never change
the stable shortcut. The Dev shortcut always starts live development; `build --run`
opens the standalone Dev build instead. Use `build --test` to check before building.
Run `bash dev.sh doctor` to inspect tools and `bash dev.sh help` for commands.
The script uses PATH tools, falling back to `.tools` in this or the main checkout.
Direct Cargo local builds require the `development` feature; add `custom-protocol`
after `npm run build` to embed the frontend. Release CI omits `development`.

Advanced developer option: install or restore the verified GitHub release and
its **Aion Companion** shortcut from an existing source checkout:

```bash
bash dev.sh install-stable --run
```

Stable and Dev use independent data folders. Switching saves and closes the
running app before starting the selected version. See
[the development workflow](DEVELOPMENT.md) for data locations, worktree switching
and troubleshooting.

## Checks and project structure

```powershell
npm run check
node --test scripts/release-version.test.mjs
cargo test --locked -p companion-core -p companion-capture -p aion-companion --features custom-protocol --lib --bins
```

`companion-core` contains protocol parsing, normalized replay and combat analysis.
`companion-capture` owns capture lifecycle, encounter recording and local storage.
`src-tauri` provides desktop windows, focus/tray integration and native commands.
`frontend/src` contains the workspace, overlays, report views and typed IPC layer,
styled with Tailwind CSS and shared primitives as described in
[the design system](DESIGN_SYSTEM.md); `npm run check` includes its guardrail.
The GitHub workflows build a tested Windows setup executable and portable build
with licenses and SHA-256 checksums.

For state ownership, threading, lock rules and contributor entry points, read the
[architecture guide](ARCHITECTURE.md) and [contributing guide](../CONTRIBUTING.md).
The [architecture review](ARCHITECTURE_REVIEW.md) records implemented
improvements, remaining priorities and package suggestions for maintainer review.

## Commit and branch conventions

Every commit and PR title must follow the
[Conventional Commits rules](../AGENTS.md#conventional-commits). Name working
branches with the same supported types using `<type>/<kebab-case-description>`,
for example `feat/pet-farming-goals`, `fix/group-readiness`, or
`docs/readme-conventional-commits`.
