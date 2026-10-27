# UI review and redesign notes

Historical review of the first workspace, meter and menu redesign. Later
interaction and overlay behavior is documented in [the technical reference](README_REFERENCE.md) and current source.

Scope: workspace (`index.html`), DPS meter (`?view=overlay`), and top menu (`?view=menu`).

## Review findings (before)

- **No way to hide the DPS meter from the workspace.** The header only had "Show DPS overlay". Its
  state came from nowhere, so it could not reflect hotkey or tray changes.
- **Hierarchy.** A large "Combat workspace" header with a development-build eyebrow pushed content
  down. The live meter, recording tools and replay were stacked with equal weight. The
  quit/show controls sat in an unlabeled toolbar.
- **DPS meter density.** It had a three-line footer of hints, a bare "Avg DPS" button that labeled
  the _other_ mode, unicode glyph buttons (`−`, `×`, `⠿`), and share bars scaled by the total
  instead of the top player. That made small differences hard to read.
- **Tables.** Numbers were not tabular, header weight matched the body, and share was plain text.
- **Readiness coupling.** `useOverlay` always reported `overlay_ready`, so it could not be reused by
  any other window.

## Design changes

- **Shared tokens** (originally one `styles.css`; now the Tailwind theme in
  `frontend/src/styles/theme.css`, documented in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)): one dark
  palette, amber for "editing/locked" and rose for quit/errors. The workspace accent is jade; the
  in-game windows share a gold accent, glass background and border radius.
- **Top menu** (`features/menu/MenuBar.tsx`): a single 44px row inside the 480×52 transparent
  window, so nothing overflows. From left to right:
  - Branded drag area
  - Capture state (`● m:ss` when live, `Idle`, or a truncated error with a full tooltip)
  - **DPS meter switch** (`role="switch"`, Shown/Hidden)
  - Lock/unlock click-through
  - Open workspace
  - Quit with one click, consistent with the workspace and DPS panel

  The menu never hides itself. It stays interactive while the DPS meter is click-through, so it
  doubles as the unlock path.

- **DPS meter**: SVG icon caption, a LIVE/STOPPED dot, and summary tiles (encounter time, total
  DPS, damage). There is an Avg/5s segmented control with `aria-pressed`. Rows are ranked
  `<li>`s in the entity's color, with bars relative to the top player plus a share % column. The
  footer is compact: status line, hotkeys, and the experimental PvE/events/gaps line.
- **Workspace**:
  - Slim sticky header: brand, hotkey hints, a "Click-through" pill when locked, the DPS meter
    switch, and Quit.
  - Live DPS card: primary Start, grouped secondary actions, options row, stat strip, and a table
    with color chips and share bars.
  - "Recordings & replay" groups import/demo/save, history, saved totals and replay.
  - All honest experimental/accuracy text is kept (condensed into notes and details).

## State model

`hooks/useOverlay.ts` → `useOverlayControls({ markReady?, onError? })`:

- Polls `overlay_status` every 500ms. `overlay.visible` is always the backend's value, so
  hotkeys, the tray and failed actions are reflected within one poll.
- `known` stays false until the first status arrives, and the switch is disabled until then.
- A single-flight `acting` ref plus `busy` state means rapid clicks issue only one command. A
  generation counter drops polls that started before an action.
- On failure it surfaces the error and immediately re-reads the status to resync.
- `toggle()` reads the latest status from a ref, never a stale closure.
- `useOverlay()` (DPS window) calls `overlay_ready`, `useMenuControls()` (menu) calls
  `menu_ready`, and the workspace passes neither.

## Integration expectations (backend)

- Window `companion-menu`, `index.html?view=menu`, 480×52 logical, transparent, undecorated.
- `overlay_status.visible` refers to the DPS window only. The optional `menu_ready` and
  `menu_visible` fields are typed but the UI does not depend on them.
- `overlay_hide` hides only the DPS window. The menu calls `overlay_show`, `overlay_hide`,
  `overlay_lock`, `overlay_workspace` and `overlay_quit`.
- Showing an existing panel preserves its lock state. The menu's lock/unlock button changes it
  explicitly. Total DPS includes all displayed actors; party membership is not implied.
