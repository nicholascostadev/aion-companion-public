# Contributing

Read [AGENTS.md](AGENTS.md), the [agent workflow](docs/AGENT_WORKFLOW.md), the [architecture](docs/ARCHITECTURE.md), and the
[design system](docs/DESIGN_SYSTEM.md) first. Current architectural findings and
follow-up priorities are in [the review](docs/ARCHITECTURE_REVIEW.md).

## Development

Use Windows with Git Bash, Node.js 22.12+, Rust, Microsoft C++ Build Tools, and WebView2. Install
the locked dependencies with `bash dev.sh exec -- npm ci`. Live capture additionally requires Npcap.
Protocol, model, and synthetic report tests do not require a running game.

```bash
bash dev.sh dev
```

This starts the isolated Dev channel with live reload. Read
[DEVELOPMENT.md](docs/DEVELOPMENT.md) before changing worktrees or troubleshooting
the shared Dev shortcut. Avoid running multiple native instances. Browser-only
frontend development uses `bash dev.sh exec -- npm run dev` and the explicit `?mock` query parameter;
the mock transport never captures traffic or writes the native library.

## Change placement

- Fix game interpretation once in the Rust state owner; React should display the
  result and its evidence, including unknown values.
- Keep native calls in services and application/controller hooks. Feature views
  receive data and callbacks through props.
- Use existing tokens and UI primitives, Lucide for general icons, and verified
  original artwork for game imagery. Follow the model requirement in `AGENTS.md`
  for design and interaction changes.
- Preserve command names and file schemas during an internal refactor. For a
  format change, supply version handling, migration/recovery tests, and a clear
  compatibility statement.
- Do not add a new dependency before the maintainer reviews it. Suggest its
  purpose, alternatives, license, maintenance evidence, exact version, and
  transitive/build-script implications first.

## Checks

Run the checks relevant to the change, then the complete checks before submitting:

```bash
bash dev.sh check --native
```

Build the frontend before native `custom-protocol` checks so the embedded assets
exist. `cargo test` without `-p` defaults to `companion-core`; it does **not** run
all native tests. The authenticated release-download integration test is ignored
by default and should only run explicitly when that download is intended.

For a capture/report performance change, also run:

```bash
bash dev.sh exec -- cargo run --locked -p companion-core --example report_profile -- 50000
bash dev.sh exec -- cargo run --locked -p companion-core --example report_profile -- 500000
```

Report event count, build profile, machine/workload, snapshot/append copy time,
report compute time, and payload bytes. The synthetic profile isolates data-copy
and report work; it does not measure actual packet loss, UI frame rate, disk
latency, or end-to-end IPC. Those need a live session or native stress run. Do not
turn machine-specific microsecond timings into brittle unit-test assertions.

For new polling or IPC behavior, cover slow reads, an action racing a read,
profile/encounter changes, pause/unmount, and native failures. For persistence,
cover failed writes and recovery rather than only successful serialization.

For native pet-catalogue memory changes, compare both representations in separate
release-profile processes:

```bash
bash dev.sh exec -- cargo run --locked --release -p companion-capture --example pet_catalogue_profile -- baseline
bash dev.sh exec -- cargo run --locked --release -p companion-capture --example pet_catalogue_profile -- compact
```

The baseline reproduces the previous generic JSON tree and response clone; compact
exercises the collector's current metadata lookup and pre-serialized response. The
benchmark reports requested heap bytes and response preparation time. It does not
start capture, write a profile, or measure WebView memory or end-to-end IPC.

For the Windows WebView2 memory policy, build the frontend and run the isolated
native fixture in separate processes:

```bash
bash dev.sh exec -- npm run build
bash dev.sh exec -- cargo run --locked -p aion-companion --features custom-protocol,development --example webview_memory_profile -- baseline
bash dev.sh exec -- cargo run --locked -p aion-companion --features custom-protocol,development --example webview_memory_profile -- low
```

Both cases create the same hidden WebView with retained buffers, DOM nodes, canvas
contents and selection state; only the memory policy differs. Sample its process
tree's private working set and private committed bytes during `phase=measure`.
Both must finish with `state_preserved=true scripts_running=true`. Low mode may
page memory out rather than free it; compare committed memory too. The fixture
owns no capture or game profile and does not open a visible test window.

## Pull requests and commits

Use Conventional Commits for every commit and PR title as required by `AGENTS.md`.
Follow the [release-note conventions](docs/RELEASING.md#commits-pull-requests-and-release-notes)
for types, breaking changes and PR titles that become in-app release notes.
Keep changes focused. Explain the trigger/problem, resulting behavior, checks run,
and remaining limitations. Distinguish synthetic measurements from live gameplay
validation. Include screenshots for visible changes and migration evidence for
durable schema changes. Do not commit gameplay recordings, raw traffic, local
profiles, credentials, build outputs, or generated diagnostic data.
