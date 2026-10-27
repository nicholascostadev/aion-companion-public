# Offline integration review follow-up

This is the historical review record for the offline-analysis implementation.
The build hashes and test counts below describe that reviewed build; use the
current CI results and release checksums for later changes.

Independent review: Claude Opus 5.5 High, task `aion-offline-integration-opus55-high-review-20261017-08`.
The review was read-only while the UI implementation was still in progress.

## Backend corrections implemented

- Recompute the last readiness observation after member add/remove; preserve a
  known member's ready state consistently when an update omits the ready mask.
- Expose both newest and oldest readiness observation times. Timed round
  active/start/expiry remain unknown; a ready bit does not establish a round.
- Count casts only from observed skill-start packets. Hits cannot create cast
  counts or gaps. Missing cast counts are null. Channel/repeated-hit regression
  coverage verifies this rule.
- Add an atomic positions-only command so arranging a tracker cannot replace
  unrelated settings that another window changed.
- Restrict a null active preset to the first preset, matching the displayed preset.
- Invalidate an old ready cooldown on a new observed local cast. A zero reached
  by an estimated countdown remains an estimate; only wire zero proves readiness.
- Compute recent DPS during the main aggregation pass; no per-player full-log
  scans. Bound live event detail, cache duplicate polls briefly and optimize hot
  crates in local debug builds. Full saved data remains intact.
- Treat an explicit known-boss death as zero HP with the same phase grace as an
  HP observation. A new alive boss cancels that candidate; the regression covers
  both outcomes. Wipe detection requires matching verified server identity.
- Run heavy report/status/export work outside the native UI thread.

## UI/native follow-up assigned to the implementation agent

- Missing tracker observations must say unknown, and estimated zero must be
  distinct from confirmed readiness.
- Group summaries must reveal the oldest ready observation rather than implying
  every member was updated at the newest timestamp.
- Party damage curves must exclude incoming damage and player targets.
- Death recap counts/totals must describe the complete selected interval or be
  labelled as a limited list; NPCs must not become player death recaps.
- Rotation must handle missing cast notices per skill and distinguish observed
  attacks from verified casts.
- Tracker dragging uses the atomic position patch, the last pointer position,
  cleanup when arranging ends and no write for an unmoved click.
- Destructive/action hotkeys respect game context. Capture starts automatically;
  there are no capture stop controls or reserved stop/save shortcuts.
- Party DPS labels identify encounter-based party damage even when individual
  ranking uses active DPS. Cast detail must not dilute direct crit rates with ticks
  or present an arbitrary damage-assignment window as certain.

## Review judgments

- A buff with an observed indefinite-duration flag can legitimately remain active
  until an end notice or encounter end. Show the open-end assumption and capture
  quality rather than treating every such buff as missing data.
- Unknown character-ID readiness updates are intentionally ignored. Buffering
  them across a later party join could attach an unrelated lobby observation.
- Current Global packet tests and idle capture transport do not establish live
  combat/ready-toggle parity or validated regional/proxy support.

Final check results and the implementation agent's responses must be consulted
before treating the assigned UI/native items as resolved.

## Final independent review

Opus 5.5 High task `aion-offline-final-opus55-high-review-20261017-09` found no
release blockers and confirmed the prior fixes in code. It identified:

- A subsequent despawn could shorten a dead boss's phase grace. Corrected by
  preserving the later pending kill deadline; the regression includes despawn.
- A dirty Settings draft could overwrite tracker positions saved while arranging.
  Opus implemented coordinate rebasing with pure-function and hook regression tests.
- Compact-strip hotkeys unnecessarily read a full report. Corrected with an atomic
  settings-only toggle.
- A second death without an intervening positive HP observation can be suppressed
  as a duplicate. Retained as an explicit evidence limit until a separate revive
  record is validated; guessing revival from damage-over-time would be unsafe.

Both independent reviews were code reviews without visual/game interaction.

## Build and launch verification

- Frontend typecheck, lint, formatting and 103 tests passed (57 new tests).
- Core 41, capture 14 and native host 15 tests passed.
- Production frontend and native desktop build succeeded; Desktop and Start menu
  shortcuts target the permanent launcher, whose checksum verification passed.
- Published build SHA-256:
  `f980bc965e7b69c0ccdd6866e5f545303fc1532b9b957c6659c66373e99476d4`.
- The installed executable was started in overlay mode. DPS/menu/trackers reported
  ready, tray registration succeeded, locking and tracker click-through were on,
  and no native/offline error was reported. Foreground HWND stayed unchanged.
- Native non-client recalculation (the same path run before showing overlays)
  produced zero client offsets and matching client/window sizes for all three
  created surfaces, without showing or activating them. Hidden windows initially
  retain Tao's creation-time caption geometry until that recalculation.
- Capture is enabled and waiting for AION's game connection. Overlays are correctly
  suppressed while AION is unfocused; Group stays hidden until a party is observed.

No live combat or readiness toggle occurred during final verification, and no
computer-use or visual interaction with the game was performed.
