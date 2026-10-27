# Architecture review — 2026-10-19

## Assessment

Keep React, Tailwind, Rust, and Tauri. The existing crate boundaries, pure combat
models, bounded parser, typed frontend services, design primitives, mock transport,
and regression suite provide a useful foundation for a long-lived application.
The main problems are ownership and execution boundaries, rather than the choice
of framework. Replacing the stack would discard working protocol and lifecycle
behavior without addressing those problems.

This review covers the repository's Rust crates, Tauri commands and window/lifecycle
integration, frontend composition/services/hooks/features, native storage, build
and release scripts, capabilities, and existing checks. It is an architecture and
code review, not proof of live protocol accuracy or a complete FFI/security audit.
The branch was fast-forwarded to `origin/master` at `536f9f4` during the work.

## Corrections implemented

### High: reports contended with packet ingestion

Previously, saved-report file reads, aggregation, and report JSON construction
executed while `LiveCapture.shared` was locked. Moving the command onto a blocking
worker did not remove that contention: capture needed the same lock for each
packet. Live polling also aggregated and cloned its JSON cache under this lock.

`offline_api.rs` now prepares owned work and `reports.rs` executes it after releasing
capture state. Saved reads retain an immutable catalogue version. Live polling
keeps a separate event snapshot and transfers only its appended suffix after the
first poll; metadata is refreshed independently. A separate report mutex prevents
polling computations from racing across WebViews without blocking packet capture
for the duration of aggregation. Prefix reuse is invalidated on encounter/reset
replacement and dummy-cap trimming. The rendered-report revision also covers
metadata changes that do not append damage events.

Regression coverage verifies snapshot independence, unchanged totals and full
inspection detail, metadata/filter invalidation, incremental event transfer,
resets, dummy trimming, and capture access while a report poll is waiting.

### High: blocking native work could run on event/executor threads

Several synchronous commands performed capture locking, recording/file work, or
analysis. Replay `async` commands performed CPU work directly in the async body.
Quit could join capture and save files on the calling event thread. Some hotkey
actions built reports or persisted settings directly in their callback.

`background.rs` now provides one policy for blocking command work. Capture,
recording, offline-library, and pet IPC adapters use it. Shutdown routes through
the same synchronous save transaction on a blocking worker, including window
close, tray quit, and the updater's existing worker. Data-changing game shortcuts
also dispatch their blocking work. Short window operations stay in native window
adapters. IPC command names and response shapes remain compatible.

### Medium: replay calculation held a mutable session lock

Replay session state is now owned by `recordings.rs` as an immutable
`Arc<Recording>`. A calculation keeps the recording it started with even if a new
recording replaces the session. Large clones, parsing, computation, and file
writes run outside the session mutex. Tests verify both pointer sharing and
replacement during an in-flight snapshot.

### Medium: asynchronous settings operations needed transaction ownership

Moving writes to workers exposes interleaving that event-thread serialization
previously masked. `LiveCapture.settings_transaction` now serializes settings
patches, position patches, compact-mode changes, and live-filter configuration.
The native shortcut side effect is applied and rolled back through
`offline_configure_with`, without a Tauri dependency or a capture mutex held
during the callback. A failed file write restores the previous native
configuration; invalid input never reaches native side effects. Regression tests
exercise both failure paths. Preferences-only reads no longer build a report.

### Maintainability: separate composition, commands, report work, and ownership

The native entry point now contains registration/setup rather than replay and
capture command implementations. `capture_commands.rs`, `recordings.rs`,
`background.rs`, `offline_api.rs`, and `reports.rs` have explicit responsibilities.
Core forbids unsafe code. The new [architecture guide](ARCHITECTURE.md) documents
state owners, lock order, report version rules, and lifecycle requirements;
[CONTRIBUTING.md](../CONTRIBUTING.md) documents local checks and review expectations.

### Frontend: window loading and controller lifecycle

The frontend refactor was implemented by **Claude Opus 5.5 with High reasoning**,
as required by `AGENTS.md`. It adds a dynamically imported window-view registry,
shared polling/action/window controllers, safe asynchronous event cleanup,
centralized overlay-state derivation, and hidden-workspace polling suspension.
Feature-specific queued pet and alert edits keep their conflict-resolution rules.
Regression tests cover the shared controllers and affected application behavior.

Previously every window eagerly imported the workspace and its dependencies.
Production output now contains separate window chunks; `GameArt` is a separate
439.60 kB chunk rather than an eager dependency of menu/popup/timer entry views.
These are build-output observations, not a measured WebView startup-time claim.

A second integration review corrected manual-refresh ordering relative to
scheduled reads and actions, coalesced refreshes requested during an action, and
bounded replay snapshot work to one in-flight read plus the latest pending
position. Old-recording snapshots are discarded; within a recording, completed
frames may display in request order while a slow engine catches up. The popup's
initial ready reply can no longer replace a newer pushed delivery list.

Window-controller action errors now remain visible until a successful action;
read errors clear on the next successful read. Settings and Group retain their
existing error-clearing behavior. The tracker arrange panel now surfaces a failed
Done action instead of losing its message to background reads.

The generic action controller's error-recovery read still assumes a stable
resource for the action's lifetime, as current callers provide. Before using it
for an entity/profile that can change during an action, key/remount that
controller or add resource-version guards to action and recovery results. The
polling-only primitive already guards replaced read functions.

### Follow-up implemented: storage ownership and compact polling

`storage.rs` now owns runtime file encoding, syncing and atomic replacement. It
has four acknowledged request slots and three coalesced checkpoint mailboxes.
`storage_api.rs` releases capture state before waiting for a save, retains failed
encounter/library batches for retry, and orders active-checkpoint clearing after
the completed save. Shutdown explicitly flushes required work. Settings validation
and file persistence also happen outside capture state, with the existing native
side-effect rollback. Library reads/exports and catalogue parsing moved outside
that mutex. Pet and alert state now have separate owners; an alert claim must
still be saved successfully before delivery. No dependency or file schema changed.

The capture producer drains prepared batches after each packet. Slow or failed
completed saves apply backpressure outside the capture mutex; this trades continued
packet intake at an encounter boundary for retaining the encounter reliably. The
outbox must not become a background accumulation queue. Full checkpoint snapshot
copying still occurs under capture state and is a remaining performance cost.

`offline_live_status` returns compact aggregates and an explicit summary marker.
Core skips full timeline, buff-span and HP detail construction; at most two recent
HP endpoints per target preserve the meter's kill-time projection. Full polling detail is
computed lazily in the same versioned cache, reusing its existing aggregates.
Opus migrated frontend consumers to
summaries unless they display live analysis; summary/full types and normalizers
prevent empty summary arrays from masquerading as complete detail. Existing
full-status, saved-report and explicit inspection commands remain available.

Regression coverage includes aggregate/filter parity, lazy detail, 1,000 coalesced
checkpoints, bounded queue backpressure, confirmed writes overtaking older failed
checkpoints, checkpoint retry, retained encounter saves, reset/shutdown ordering,
capture access while pet/alert owners are unavailable, and bounded HP slope
endpoints that retain the meter's existing estimate.

## Remaining work, in priority order

### 1. Strengthen recovery validation and reduce snapshot copying

File replacement is centralized, but startup recovery validation still differs.
Alerts and pets already protect unreadable saved state in ways the offline settings,
catalogue, and active-log loader do not consistently share. Add version dispatch,
bounded structural validation, and corrupt-file preservation before overwriting
or migrating these files. `CombatLog` currently has permissive serde defaults;
native recording validation is stricter. Preserve supported legacy logs explicitly
instead of changing deserialization behavior without migration evidence.

Checkpoint preparation and explicit live inspection still copy an entire log.
Measure their capture-lock hold time in representative mixed encounters before
introducing shared event chunks or incremental checkpoint snapshots.

### 2. Measure aggregation before introducing an incremental accumulator

Compact reports substantially reduce payloads, but still scan the full encounter.
Keep full-report parity as the oracle for any incremental accumulator. Check
party/boss filtering, late identity/ownership, HP-only updates, rolling windows,
reset/trim and encounter transitions. Measure capture delay, report latency,
per-window work and peak memory together. Detail aggregation across independent
saved/inspection requests is still per request; introduce a bounded report worker
only if native measurements demonstrate contention.

### 3. Strengthen Rust/TypeScript contracts incrementally

**Medium correctness priority.** Many native feature interfaces use
`serde_json::Value`, while TypeScript types and normalizers describe the payloads
independently. A typed `invoke<T>` does not validate what Rust returns. Existing
normalizers are valuable compatibility boundaries but cannot make the compiler
detect a renamed Rust JSON field.

Start with typed request/response structs for the compact live API and settings.
Then evaluate generated bindings and contract fixtures. Keep unknown observations
nullable and preserve old-file normalization. Shared contracts should live below
feature views. Move such contracts when extending an area.

### 4. Make desktop integration easier to extend

**Medium maintainability priority.** `overlay.rs` combines surface creation,
visibility, focus integration, hit regions, shortcuts, tray actions, and shutdown.
`Offline` combines encounter state, settings, trackers, library indexing, and
storage. Large frontend feature editors also mix substantial form state with
rendering. Their size is a symptom; splitting files mechanically is insufficient.

Continue extracting by responsibility: storage first, then desktop shortcut/tray
adapters and surface-specific controllers, then feature editors' pure state and
validation models. Keep the existing pure `focus`, `group_auto`, `hit`, and geometry
models as the pattern. Avoid a generic window framework until more than one
surface actually shares the proposed lifecycle behavior.

The focus monitor also submits main-thread work every 25 ms. Coalesce pending
dispatches so an unusually stalled event thread cannot accumulate a backlog of
outdated visibility/input updates. This is separate from reducing IPC polling.

### 5. Add explicit performance and native integration evidence

**Medium validation priority.** Parser/model tests and browser mocks cannot prove
WebView2 behavior, Npcap throughput, game-focus click-through, multi-monitor drag,
shutdown handoff, or packet-drop behavior under load. Windows CI builds and tests
the native code, but these paths still need a repeatable native smoke/stress run.

Record event rate, capture queue/drop counters, capture-lock wait time, report
compute time, payload bytes, memory, and per-window frame work in a representative
session. Keep benchmarks out of ordinary timing-sensitive unit assertions.
Use Rust formatting/linting consistently in a dedicated baseline change before
making full-repository formatter/clippy checks mandatory.

The frontend visibility test covers browser visibility events, not WebView2's
mapping of minimization to `document.visibilityState`. Confirm that mapping in the
real desktop app. If a host does not report hidden, polling continues with the
prior behavior. Browser automation was unavailable during this review (T3 preview
snapshot timeouts and no fallback browser); no live gameplay or native UI smoke
run is claimed.

## Performance evidence from this refactor

The synthetic `report_profile` compares bounded full detail with compact summaries
and asserts identical player aggregates. One local Windows development-profile
run (core and serde_json use the repository's existing optimization level 2) gave:

| Damage events | Full snapshot copy | Copy 100 appended | Detail compute | Summary compute | Detail JSON     | Summary JSON |
| ------------- | ------------------ | ----------------- | -------------- | --------------- | --------------- | ------------ |
| 50,000        | 6,592 us           | 18 us             | 86,222 us      | 10,769 us       | 3,616,679 bytes | 15,288 bytes |
| 500,000       | 97,301 us          | 17 us             | 218,037 us     | 126,881 us      | 3,616,900 bytes | 15,509 bytes |

The summary payload was about 99.6% smaller in this fixture. These are individual
runs under the workstation's current load, not stable latency budgets.

This is an illustrative data-copy/aggregation microbenchmark on this workstation,
not a measured before/after gameplay speedup. The append sample isolates event
copying; it excludes metadata copying, lock acquisition, allocations elsewhere,
disk work, and IPC. Actual polling now reuses its prior prefix, whereas explicit
inspection and periodic checkpoint preparation still need full copies. Full-detail
JSON is created only when requested. These results do not establish packet loss,
disk latency, end-to-end IPC, frame rate, memory use or a lag-free gameplay claim.

Reproduce with the commands in [CONTRIBUTING.md](../CONTRIBUTING.md). Use release
profiles and representative mixed-event encounters for a performance budget.

## Validation record

- `npm run check`: art/design checks, typecheck, lint, formatting, and **559
  frontend tests in 67 files passed** after the final frontend fixes. A combined
  run during native compilation hit a Pets timeout and subsequent failure; the
  complete check passed when run without the competing build, with unchanged
  test timeouts. Similar load-sensitive timeouts occurred in Opus's earlier runs.
- `npm run build`: final production frontend built successfully with separate
  window chunks.
- Native regression commands from `CONTRIBUTING.md`: **181 passed** across
  core (48), capture/application (80), and desktop (53). The existing authenticated
  release-download integration test remained intentionally ignored.
- Development identity/update-isolation regression command: **53 passed**, with
  that same download test ignored.
- `cargo build --locked -p aion-companion --features custom-protocol,development`:
  final desktop executable built with the updated frontend embedded.
- Release version consistency and three versioning tests passed. Both PowerShell
  launcher/channel regression scripts passed, including update handoff/rollback
  and isolated profile initialization.
- All **73 original native command registrations** were preserved, with
  `offline_live_status` added. Package manifests and
  dependency lockfiles were unchanged. Formatting and `git diff --check` passed.

These checks cover code, contracts already exercised by tests, builds and launcher
fixtures. They do not replace the live Windows/gameplay validation described
above.

## Package suggestions for maintainer review

No dependencies were added or upgraded. Existing lockfiles are unchanged. These
are candidates for separate review, not dependencies required by this refactor.

- **`tracing` and `tracing-subscriber`**: the stronger near-term candidate for
  structured local timings around capture-lock waits, report jobs, and storage
  acknowledgements. The project is maintained by Tokio and uses the MIT license;
  it does not require running Tokio. The repository already has `tracing`
  transitively through native dependencies, but direct instrumentation and a
  subscriber would still be an explicit dependency decision. Keep logs local,
  filtered and bounded; avoid per-hit spans and measure instrumentation overhead.
  Evidence: [upstream repository](https://github.com/tokio-rs/tracing) and
  [Tokio guide](https://tokio.rs/tokio/topics/tracing).
- **Specta / `tauri-specta`** (deferred at the maintainer's request): evaluate after introducing typed Rust DTOs, to
  generate TypeScript command bindings and reduce contract drift. The upstream
  project is MIT licensed. Its reviewed main manifest identifies the Tauri 2
  integration as `2.0.0-rc.25`, with prerelease Specta dependencies and development
  Git patches; that is a maturity/compatibility reason to review published versions
  carefully rather than adopting main. Returning unstructured `Value` would also
  limit the benefit. Evidence: [upstream project](https://github.com/specta-rs/tauri-specta)
  and [manifest](https://github.com/specta-rs/tauri-specta/blob/main/Cargo.toml).

Review exact published versions, advisories, dependency trees, build scripts, and
licenses before approving either candidate. Maintenance and licensing evidence
are not a completed security audit. There is no demonstrated need to add a
frontend global-state library or change storage engines for this refactor.
