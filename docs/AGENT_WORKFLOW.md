# Agent workflow

Use Git Bash for repository commands. `bash dev.sh help` lists the supported
development commands; `bash dev.sh doctor` prints the current checkout, branch,
tool locations and Dev log path. The Bash entry point discovers ignored tools in
both this checkout and the main checkout using Git's common directory. It keeps
dependencies and Cargo output local to the selected checkout.

For an individual command, use `bash dev.sh exec -- npm run typecheck` or
`bash dev.sh exec -- cargo test --locked -p companion-core`. For an interactive
shell, `source scripts/dev-env.sh` adds the same tool discovery to that shell.
Normal PATH tools take precedence over the optional `.tools` fallback. Node is
already required; use it for small filesystem/JSON tasks instead of assuming
Python is installed. The Windows Store Python alias is not an interpreter.

If a tool runner launches PowerShell despite a Bash shell selection, use it only
to launch Git Bash explicitly:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' --login ./dev.sh doctor
```

Use script files for complex commands rather than nested `node -e`, shell and
PowerShell strings. Backticks and `$()` execute in shells. Put temporary Node
scripts under ignored `.tools/` or use `node:os`'s `tmpdir()`; Windows Node does
not interpret Git Bash's `/tmp` inside JavaScript strings. Convert paths with
`cygpath -am` when handing Bash paths to native Windows tools. Pass a script to
`powershell.exe -File` with separate arguments when a native adapter is needed.

## Locate code

Start with a narrow `rg --files <directory> -g '*pattern*'`, then search those
files with `rg -n`. This avoids guessing filenames and searching generated,
bundled and artwork data. Use `rg -F` for literal text. Discover the filename
before reading it; workflow names and feature entry files are not uniform.

| Task                                   | Start here                                                               | Read when needed                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Window routing and composition         | `frontend/src/app/views.ts`, `frontend/src/main.tsx`, `frontend/src/app` | [Architecture](ARCHITECTURE.md)                                                                         |
| Feature views and display models       | `frontend/src/features/<feature>`                                        | [Design system](DESIGN_SYSTEM.md); preserve the UI model requirement in `AGENTS.md`                     |
| UI primitives, Base UI and shadcn      | `frontend/src/components/ui`, `components.json`                          | [Design system](DESIGN_SYSTEM.md#base-ui-and-owned-primitives)                                          |
| Native calls and polling               | `frontend/src/services`, `frontend/src/hooks`                            | [Architecture](ARCHITECTURE.md)                                                                         |
| Game decoding and combat models        | `crates/companion-core/src`                                              | [Architecture](ARCHITECTURE.md), [group protocol](GROUP_PROTOCOL.md)                                    |
| Capture, state owners and persistence  | `crates/companion-capture/src`                                           | [Architecture](ARCHITECTURE.md), [offline API](OFFLINE_API.md)                                          |
| Native commands and window behavior    | `src-tauri/src/main.rs`, adjacent domain modules                         | [Architecture](ARCHITECTURE.md)                                                                         |
| Pets, alerts, backups, translation     | Corresponding feature, service, capture and native modules               | [Pets](PETS.md), [alerts](ALERTS.md), [backups](BACKUPS.md), [translation](TRANSLATION_ARCHITECTURE.md) |
| Build, Dev shortcut, profiles and logs | `dev.sh`, `scripts/dev-env.sh`, `scripts/Launcher.cs`                    | [Development](DEVELOPMENT.md)                                                                           |
| CI and releases                        | `.github/workflows`, `scripts/release-version.mjs`                       | [Releasing](RELEASING.md)                                                                               |

## Choose checks

`bash dev.sh check` runs the existing frontend checks, including script
regressions. `bash dev.sh check --native` also builds the embedded frontend before
running all native library/binary tests, both identities and launcher checks.
Plain `cargo test` only tests the workspace's default member, `companion-core`.
For a focused change, choose the relevant checks from [Contributing](../CONTRIBUTING.md).

CI already runs `npm run check` on Linux and builds/tests on Windows through
`.github/workflows/check.yml` and `windows-build.yml`. Extend those existing gates
for mechanical regressions. For scripts, verify failing commands stop the build
before any publication step, and paths containing spaces remain single arguments.

## Native development

`bash dev.sh dev` uses the existing Windows host for its named mutex, log
transcript, port check, save-before-switch handshake and shortcut publication.
`build.ps1` is a compatibility entry point used by existing Dev shortcuts; it
forwards into Bash. The remaining PowerShell files are Windows adapters and CI
release automation. They can be called through the Bash entry point without
changing the stable/development channel guarantees.

Browser previews use `bash dev.sh exec -- npm run dev -- --host 127.0.0.1` with
`?mock` in the URL. The native Dev host uses port 1421; the browser preview normally
uses 1420. For computer/browser automation, use the thread's T3 preview tools
first. Follow [Development](DEVELOPMENT.md) before switching native worktrees or
rebinding a shortcut. Never start another capture just to inspect the frontend.
