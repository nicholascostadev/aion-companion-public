# Architecture

Aion Companion is a local Windows application with a React interface and a Rust
backend hosted by Tauri 2. Keep it a modular monolith: one native process owns
capture and durable state, while separate WebView windows render the workspace
and overlays. A separate service or a web server is not required at runtime.

If you know React web applications, think of Rust commands as the local backend
API. `invoke` is the transport between the WebView and that backend. Each window
has its own JavaScript environment: a React context, module variable, or hook
instance in one window does not share state with another window. Persistent state
and cross-window authority belong in Rust.

## Ownership and dependencies

| Area                         | Owns                                                                                           | Must not own                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `crates/companion-core`      | Bounded wire decoding, normalized recordings, deterministic combat analysis                    | Windows APIs, Tauri, storage, window state                   |
| `crates/companion-capture`   | Npcap lifecycle, live observations, encounters, local library, alerts, pet and activity models | React, Tauri windows, UI presentation                        |
| `src-tauri`                  | IPC adapters, startup/shutdown, windows, tray, hotkeys, local update handoff                   | A second combat engine or duplicate persistent feature state |
| `frontend/src/services`      | Typed command calls, response normalization, native events and window adapters                 | React rendering or feature state                             |
| `frontend/src/hooks`         | Polling, action ordering, transient application state, subscription cleanup                    | Durable game state or protocol interpretation                |
| `frontend/src/app`           | Window and tab composition; hooks wired to views                                               | Packet parsing or direct filesystem access                   |
| `frontend/src/features`      | Feature views and pure display models                                                          | Native command calls in view components                      |
| `frontend/src/components/ui` | Reusable primitives and design-system behavior                                                 | Game rules or feature-specific persistence                   |
| `frontend/src/lib`, `types`  | Pure helpers and shared contracts                                                              | Window orchestration or application state                    |

Rust dependencies point from `src-tauri` to the two crates, and from
`companion-capture` to `companion-core`. Core forbids unsafe code. Keep platform
FFI in native adapters rather than bringing it into parsers and analysis.

The frontend already checks import cycles and restricts services, hooks, and Tauri
imports in feature views and shared components through `.oxlintrc.json`. New
abstractions should strengthen these boundaries, not bypass them.

## Frontend execution

The [translation architecture](TRANSLATION_ARCHITECTURE.md) defines
English and Brazilian Portuguese resources, native preference ownership and
synchronization between windows using i18next and react-i18next.

`app/views.ts` is the window-route registry. `main.tsx` selects one view from the
native window URL and dynamically imports it before the first render. Each
WebView loads its own dependency graph rather than eagerly importing every
workspace and overlay component. Keep the development mock installation before
that first render; production builds exclude the mock transport.

`useNativePoll` owns polling schedules, skips overlapping scheduled reads, and
orders scheduled and manual reads together, discarding overtaken results and
results invalidated by a write, a replaced read function, or schedule cleanup.
Explicit refresh remains available while the schedule is paused. `useNativeState`
adds one-at-a-time actions and separate read/action errors; refresh requests made
during an action wait for it and share one subsequent read. Window controllers
build on these primitives; feature-specific queued edits, such as pet and alert
preferences, retain their own conflict-resolution rules. Do not replace those
queues with a generic last-write-wins state setter.

`useNativeEvent` owns asynchronous event registration and eventual unsubscription,
including the case where the component unmounts before registration completes.
`usePageVisible` lets screen-only workspace polling pause while hidden and resume
when shown. Native capture, reminder delivery, and updater work continue regardless
of whether the workspace is rendering.

Native host visibility is also mirrored to the WebView2 controller, including
minimized and initially hidden windows. Hiding an HWND alone does not hide its
browser content. `webview_visibility.rs` updates the controller on overlay
visibility and window resize events, with a periodic reconciliation on the
existing focus worker. Each callback reads the current host state so an old hide
cannot overtake a reopen. Hidden pages can throttle work while retaining their
state; capture and reminders stay in Rust. The same callback requests WebView2's
`Low` memory target after hiding a controller and restores `Normal` before showing
it. Memory advice failures cannot prevent the visibility update, and older runtimes
without the optional interface retain the visibility-only behavior. This is a
best-effort cache/paging policy, not a heap limit or a page reload; scripts and
window-local state remain alive. Do not mix it with `TrySuspend`/`Resume`, which
have their own memory policy. See the
[WebView2 memory-target API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_19#put_memoryusagetargetlevel).

The meter's Odyle balance comes from incoming resource-status messages, exposed
as `live_status.odyle` with absolute `base`, `bonus` and an `observed_ms` timestamp.
It is ephemeral connection state: character changes, disconnects and capture
failures clear it, while a combat reset preserves it. A missing or unsupported
observation stays null; a supported empty resource record is a known zero. The
meter uses its existing live poll and never substitutes manual estimates or
client-side regeneration for captured balances. No recording or profile schema
changes are needed.

The experimental Cube Finder observes world objects independently of pet NPCs.
Core emits bounded lifecycle and validated spatial observations; a small ephemeral
capture-owned state keeps at most 128 objects. Status clones this bounded state
under the capture lock and builds JSON after releasing it. Character, connection
and zone-load changes invalidate sightings. Confirmed fresh own position controls
distance and optional height; display predictions never become measurements.
The Explore workspace and focus-gated `explore-overlay` share this authority
through IPC. Snapshots also carry the native observation clock, last confirmed
position and validated own-character facing from the same wire observations as
Pets. A shared bounded motion model animates the player marker without changing
confirmed measurements. The in-game minimap follows the current map and player;
workspace map browsing remains independent.
See [Cube Finder](CUBES.md) for observation semantics and validation limits.

The shared `features/maps` atlas, camera and `WorldMap` canvas use the original
map artwork and calibrated projection. The canvas consumes world-coordinate
markers independently of cube lifecycle or native polling; the cube adapter decides
which context and observations may be drawn. This is also the extension point for
gathering layers. Browsing the atlas and its coordinate chart does not need the pet
catalogue or a network request. Original artwork downloads per map on first use;
verified cached artwork works offline. The bundled original-client `cube-spawns.json` supplies static
possible locations separately from capture: the generic spots model groups them
for display without losing their counts. A failed cube read hides live geometry
while retaining the shown map and its possible locations. Static selections have
no lifecycle; distance requires a fresh matching player position.

`src-tauri/src/map_art.rs` owns map downloads and the content-addressed local cache,
independently of capture. Its compiled map index pins the release asset, exact length
and SHA-256 of each map pack and image. The `map_art_ensure` command starts one
background job per map across all windows; `map_art_status` only reads progress.
`useMapArt` requests artwork only while that map is shown and the page is visible,
and retains pan, zoom and selection while showing download or retry state over the
coordinate chart. Cache verification after restart needs no network. The `map-art`
protocol serves only indexed images whose bytes verify, through a hash filename
rather than a frontend-provided filesystem path. Packs have no paths: their
length-prefixed image bytes are interpreted only against the compiled index.

The Gathering Finder supplies resource-specific static spot layers from the
original-client `gathering-spawns.json`, with native localized names and local
original item artwork. Explore supplies the same validated capture-owned spatial
context already used by cubes, without another status poll, another capture or a
dependency on a saved pet profile. Static placements never become confirmed
gathering sightings. The context-only native `gathering_status` adapter remains
available for compatibility, but Explore does not call it.
See [Gathering Finder](GATHERING.md) for provenance and availability semantics.

Workspace location finders share one [Explore tab](EXPLORE.md) and one map canvas.
Layer models supply their own data, filters, counts and selection details while
the workspace owns the common map choice, camera and player context. New real
layers extend this surface rather than adding top-level workspace tabs. The
single Explore overlay mirrors the durable shared layer and resource choices.
Its native controller owns one focus-gated window; revisioned preference patches
and change events synchronize it with the workspace without overwriting unrelated
choices or persisting transient camera and mark selections.

Pet maps release their artwork after their tab or window has stayed hidden for
30 seconds. The map and its controls remain mounted to retain the chosen pet,
filters, pan and zoom. Tile selection scales its decoded-pixel budget to the
device-pixel viewport, with room for a tile-grid corner and the existing global
ceiling. This bounds the tiles currently referenced by a view; browser image
caches and GPU surfaces have their own lifetimes.

The workspace shares one translated pet index between Home and Pets, and catalogue
normalization shares repeated map strings within each window. The Logs tab releases
its opened report after 30 seconds away while retaining the selected log, filters,
page and selection; returning reloads that same native log. Minimizing the workspace
keeps the mounted report and its view state. Replay and pinned detail snapshots remain
retained because they are required state rather than replaceable caches.

The native pet collector retains only typed IDs, source monsters, spawn coordinates,
map/zone associations and NPC names, borrowing strings from the bundled catalogue.
Artwork and other display metadata stay in the bundled JSON rather than a retained
generic JSON tree. `pets_catalogue` returns that complete document directly as a JSON
IPC response; it must remain an object payload, not a JSON-encoded string or binary
response. Each WebView still owns its parsed display catalogue.

Replay snapshot requests also have backpressure: only one native snapshot read is
in flight. Playback ticks and scrubs update the requested time immediately and
coalesce pending positions to the newest one. Completed frames can be shown in
request order while the engine catches up; results for a replaced recording are
discarded. This bounds native work without freezing playback on a slow engine.

The alert popup treats native pushes as complete current delivery lists. Once a
push arrives, it takes precedence over the initial ready-command reply. If this
protocol changes to partial updates, introduce explicit ordering/version rules
rather than reusing the complete-list assumption.

## Native execution and lock rules

The capture worker owns adapter polling and decoding. Closing, hiding, minimizing,
or unmounting a React window must not stop capture. Focus controls whether an
overlay is displayed and receives input; it does not own the capture lifecycle.

`src-tauri/src/main.rs` is the composition root. It registers state, runs setup in
order, and registers commands. Command implementations live in domain adapters
such as `capture_commands.rs`, `recordings.rs`, `offline.rs`, and `pets.rs`.

Commands that can wait on capture state, read/write files, parse recordings, or
build reports use `background::run` or `background::capture`. An `async fn` alone
does not move CPU or synchronous I/O to another thread. Short native window
operations may stay in their window adapters. Never hold a Rust mutex across an
`.await`.

`LiveCapture` has distinct locks with these responsibilities:

- `worker`: start/stop ownership and joining the capture thread.
- `shared`: mutable capture observations and application models.
- `report_cache`: one polling report computation at a time, including requests
  from different WebViews. Capture never acquires this lock.
- `settings_transaction`: serializes preferences, tracker positions, compact-mode
  shortcuts, and settings side effects. Capture never acquires this lock.
- Pet and alert models have independent `Arc<Mutex<_>>` owners. Clone the owner
  under `shared`, release `shared`, and only then wait for that owner. Alert
  observations transfer as owned batches after each packet; delivery claims can
  wait for persistence without locking capture state.
- `Storage.dispatch` orders encounter/library transactions. Acquire it before
  capture state. `storage_api.rs` releases capture state for every writer wait.

Acquire `worker`, `report_cache`, or `settings_transaction` **before** `shared`
when both are needed. Never acquire those outer locks while holding `shared`, and
never nest report work inside a settings side-effect callback. A settings callback
may apply native configuration but must not reenter a settings mutation.

`offline_configure_with` validates a patch, applies the native side effect, and
persists the result as one transaction. If persistence fails, it restores the
previous native configuration. The callback runs without the capture mutex.
This keeps Tauri out of the application crate while preserving shortcut rollback.
Saved settings remain authoritative; errors must stay visible to the caller.

## Reports and replay

`offline_api.rs` prepares owned report inputs under the capture lock.
`reports.rs` executes them after that lock is released. Saved-report requests
carry a validated local path and an immutable catalogue reference; file reads,
aggregation, and report JSON construction happen outside capture state.

Live polling keeps its own event snapshot. The first poll copies the available
events; later polls copy only the appended suffix and refresh encounter metadata.
Merging that suffix, aggregating, and constructing JSON happen outside `shared`.
The snapshot adds a second in-memory event history, bounded by the existing event
limit. Explicit live inspection still takes a complete snapshot once.

There are two different versions to maintain in `Offline`:

- `report_revision` invalidates a rendered report when observations or catalogue
  data change, even if no combat event was appended.
- `report_stream` invalidates reuse of an event prefix when an event history is
  replaced or edited. Increment it on **every non-append mutation** of the live
  event list, including resets and dummy-cap trimming.

Encounter ID, filters, label, end reason, and event count also participate in the
report cache key. The cache has a short freshness limit for time-based values.
Do not use the cache as durable state. A saved/inspected encounter request must
never fall back to another encounter when the requested one is unavailable.

`offline_live_status` returns aggregates with `detail_level: "summary"`, the total
`event_count`, empty event/buff arrays, and at most two recent HP endpoints per
target to preserve the meter's kill-time estimate. It skips constructing full
detail arrays in core. `offline_status` retains the bounded full report (latest 25,000
events); that JSON is built lazily once per cached version, reusing the summary's
aggregates rather than recalculating them. Both use the same
aggregation and snapshot. Full queries never reuse empty summary arrays as detail.
Explicit inspection and saved reports preserve the complete encounter.
Frontend services and normalizers distinguish summary/full reports. Meters,
trackers and workspace tabs without analysis poll summaries; visible live analysis
requests full detail. Mutation replies select the current polling detail level.

Meter aggregates automatically count only boss/training-dummy damage when those
targets exist in an encounter, and ordinary encounter damage otherwise. Live
reports apply the policy natively, including in the report cache key; discovering
a boss re-aggregates the existing event prefix. The saved meter requests
`offline_log` with `bossOnly:true` for the same automatic behavior. The legacy
`target_mode` preference stays readable but no longer controls meter aggregation.
Player totals, DPS and skills use the same filter; raw target observations and
events remain available to complete all-target inspection.

Live encounters and the fallback meter start only on positive outgoing damage
from the observed local player or group. Other players' damage is admitted only
on targets that group has engaged during the current pull; unrelated nearby fights
cannot start a pull or replace a completed result. Unidentified sources wait for
identity evidence rather than being assumed to belong to the local group.
The group's first hit on an identified boss closes any preceding ordinary
encounter at its last combat time (`boss_pull`) and starts a separate boss log
and report stream. This applies even without an idle gap, so path combat cannot
lengthen the boss's DPS denominator, elapsed clock or rage countdown. Saving the
preceding encounter still follows `auto_save`. Another boss target during an
existing boss encounter retains the clock for phase transitions.
An observed boss kill freezes report duration and rolling DPS immediately at the
last boss combat damage, including during the internal phase-transition grace period.
Add damage, incoming hits from adds and healing cannot extend that final duration.
Reports expose `end_reason: "kill"` during that grace; damage to another living boss
resumes the same encounter. Storage still waits for the phase decision before
finalizing the log. Spawned NPC/summon entities cannot become ranked actors;
confirmed summon ownership is resolved to the player by the decoder.
Within an observed dungeon, the observed group also bounds player rankings in
both report and fallback meters, even when a trap's spawn/owner record is missing.
Unbound damage stays in the native log; ownership is never inferred from class
or skill alone. Recovery healing and delayed hits on dead targets leave completed
boss results selected until damage to a living or newly spawned target starts a pull.
The versioned native recording and log formats stay unchanged by these execution
details.

Replay uses a separate `recordings::Session`. It stores `Arc<Recording>` behind a
short mutex: taking a snapshot shares immutable data, and replacing a replay swaps
the pointer. Parsing, snapshot computation, JSON writing, and large clones happen
outside that mutex. Live capture and replay cannot replace each other's state.

## Storage and lifecycle

JSON documents are the current storage format. The log index is derived from log
files and can be rebuilt. Active encounter checkpoints support crash recovery.
Alert claims, pet collections, and window preferences have
their own state owners and persistence rules. See [development](DEVELOPMENT.md)
for the independent Stable/Dev data folders.

Closing a window with X or Alt+F4 hides it while the tray and capture keep running.
The tray's Workspace action restores the workspace. Tray check marks show the
requested overlays and the Group intent, not focus-gated visibility; each
visibility pass reconciles them, whichever path changed the intent. Explicit Quit from the app or
tray and update handoff share the save-and-quit transaction. Run it on a blocking
worker: it joins capture, saves collected results, flushes positions, and then
exits. A save failure cancels
quit and attempts to resume capture. Do not replace that transaction with a direct
process kill or rely on destructors as the only save mechanism.
The Windows launcher signals the process-specific `Local\AionCompanion.SaveAndQuit.<pid>`
auto-reset event when switching builds. It uses `WM_CLOSE` only for older apps
without that event; ordinary window close must never become a shutdown request.

`storage.rs` owns runtime library, settings, pet and alert file writes on one
thread. Its acknowledged request queue holds at most four requests; callers wait
outside capture state. Three replaceable checkpoint mailboxes retain only the
latest active encounter, pet state and alert observation snapshot. JSON encoding,
file syncing and atomic replacement happen on the writer. Windows replacement
retains the write-through policy; no persisted schema changed.

Completed encounter/library batches are prepared under capture state and retained
until acknowledged. `storage_api.rs` drains them before the next mutation or
packet; a failed batch remains at the front for retry. Reset/clear cannot publish
an empty active checkpoint before the completed save succeeds. This intentionally
applies backpressure at encounter boundaries on slow storage; it does not promise
unlimited ingestion through a stalled disk. Capture state remains accessible.
The producer drains after each packet, and user library mutations enter through
the dispatch gate; do not introduce producers that accumulate an unbounded outbox.

Checkpoint failures remain visible and retry on a newer snapshot or explicit
flush. An acknowledged snapshot supersedes older pending/failed checkpoints;
failure preserves a superseded checkpoint for retry. Alert delivery still requires
a confirmed claim save before notification. `stop()` flushes observations, pending
encounters, pet state and checkpoints before save-and-quit may continue. Startup
recovery happens synchronously before capture starts. It preserves an already
finished save when the active checkpoint is stale,
and prefers a newer unfinished manual save. Unreadable collisions are preserved
and reported. Periodic full checkpoint snapshots still copy events under capture
state; reducing that copy and stronger
corrupt-file validation remain documented follow-ups in the architecture review.

## Extending the app

Start with the state owner. Put protocol evidence and deterministic calculations
in core; put durable feature rules and capture integration in the application
crate; expose them through a small Tauri adapter. Add the frontend service and
normalizer, then the hook/controller, then pass data and callbacks into views.
Avoid making a component authoritative for settings shown by several windows.

Keep IPC names and native file schemas compatible during internal refactors.
Introduce explicit schema migrations before changing durable formats. Prefer
small typed Rust request/response structs for new commands; avoid extending
unvalidated JSON payloads merely because older commands use them.

Use regression tests for observable guarantees: old reads cannot replace newer
actions, unsupported observations remain unknown, report totals do not change,
resets discard old snapshots, write failures preserve prior state, and shutdown
does not acknowledge success before saving. See [contributing](../CONTRIBUTING.md)
for the commands and review requirements.
