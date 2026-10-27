# Stable and development

|                      | Stable                                  | Dev                                          |
| -------------------- | --------------------------------------- | -------------------------------------------- |
| Shortcut             | Aion Companion                          | Aion Companion Dev                           |
| Source               | Published GitHub release                | Checkout last started with `bash dev.sh dev` |
| Installation         | `%LOCALAPPDATA%/AionCompanion`          | `%LOCALAPPDATA%/AionCompanionDev`            |
| Settings, pets, logs | `%APPDATA%/org.aioncompanion.prototype` | `%APPDATA%/org.aioncompanion.development`    |
| WebView storage      | Stable app identifier                   | Separate Dev app identifier                  |
| Updating             | Settings → App updates                  | Edit source; rebuild for backend changes     |

Run commands from the checkout you want to develop:

```bash
bash dev.sh dev
```

The command sets up the Dev shortcut and runs Tauri with Vite on port 1421.
Frontend edits update open windows. Rust changes trigger a rebuild and restart;
capture cannot continue during that restart. The main window title and Dev badge
identify the build; the badge tooltip includes branch, revision and reload mode.
The revision describes the checked-out commit, not uncommitted edits.

Open the Dev shortcut to resume the same checkout. The launcher runs the host in
the background, with its output in `%LOCALAPPDATA%/AionCompanionDev/development.log`.
First compilation can take several minutes. For visible compiler errors, run the
command in a terminal. Quitting the native app normally ends the development host.
Closing a window with X or Alt+F4 hides it to the tray and keeps capture running.
Use the tray's Workspace action to restore it, or Quit to save and exit.
Only one host may run at a time; a second command will not attach to another
checkout's server or start another capture. If a host is still starting, wait for
it or stop its terminal before retrying.

On first live-development launch, after the previous app has saved and exited,
Dev copies this app's stable preferences, alerts, pet baseline
and activity-window preferences into its new
profile. It never copies active combat recordings, combat history or WebView
storage. An existing Dev profile is never overwritten. Subsequent edits and
captured progress remain independent, so using Dev does not update stable's pet
baseline. Each channel refreshes its own baseline from game traffic.

`bash dev.sh build --run` builds an embedded standalone Dev executable, publishes it into
an immutable hash folder and launches it. It does not need Vite after building.
The normal Dev shortcut still opens live development. Local build output defaults
to `target/development`; use `--target-dir` for a different Cargo target folder.

To change branches or worktrees, quit Dev first, then run `bash dev.sh dev` from the
new checkout. This rebinds the single Dev shortcut. All development checkouts share
the Dev profile; none share stable storage. Port 1420 remains available for isolated
browser previews (`bash dev.sh exec -- npm run dev` and `?mock`), which do not capture game traffic.

Maps stay outside the frontend bundle. Browser previews serve only indexed map
images from `artwork/delivery/pet-map-art`. Native Dev builds use those same verified
workspace files to populate their separate map cache on first use, so an unpublished
checkout can exercise the complete cache flow. Without a checkout, Dev uses the
matching release assets. Stable builds always use release assets. Browser mock
scenarios `?mock=maps-download` and `?mock=maps-error` expose progress and retry states.

Use Git Bash for development commands. `bash dev.sh doctor` shows the active
checkout, tool paths and Dev log location. The command uses PATH tools, then
discovers optional `.tools` installations in this and the main checkout, so linked
worktrees can reuse installed tools. `bash dev.sh exec -- <command>` runs focused
checks with that environment. Existing Dev shortcuts keep working through the
`build.ps1` compatibility entry point, which now forwards to Bash. Windows-specific
shortcut, mutex and profile operations remain native helpers.

Restore or install stable from GitHub:

```bash
bash dev.sh install-stable --run
bash dev.sh install-stable --version 0.7.0
```

The installer authenticates with the GitHub CLI, rejects drafts and prereleases,
verifies the release asset's SHA-256 digest, and publishes only the stable shortcut.
It preserves stable data. Installing an older version does not downgrade saved-data
schemas; normally use the latest stable release. Publishing a local Dev build into
stable is rejected by the publisher, and release packaging rejects Dev binaries.
Dev disables GitHub update checks, downloads and installation in both UI and native
commands.

The launchers ask a recognized running app to save and exit before switching.
If it cannot finish saving, the switch fails rather than killing capture. New builds
also hold a process-lifetime Windows mutex to prevent parallel native capture even
when started directly. Old releases predating this guard should be opened through
the stable shortcut. A busy port fails explicitly; stop the other server rather than
reusing an unknown checkout. Locked files while compiling can be avoided with a
different `--target-dir`.

Regression checks:

```bash
bash dev.sh check --native
```
