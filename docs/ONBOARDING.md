# Onboarding

The getting-started guide is a setup wizard in ten steps. Each step sets up one part
of the app in place, with its real controls and saved state, and asks for a decision:
language, live capture (Npcap), the DPS meter, saved fights, profiles and privacy,
alerts, pet farming, Hidden cubes and gathering, updates, then a review that finishes
the guide. Nothing sends the reader elsewhere in the app to configure a step.

## Fight sample

The onboarding sample in `frontend/src/features/onboarding/deus-demo.json` comes
from the owner's native saved Atiel fight in Deus Research Base. The owner
authorized its use for onboarding and confirmed the boss and instance. The fight
lasts 160.896 seconds and includes five damage contributors.

The sample contains damage to Atiel within that duration, cumulative damage
samples every two seconds, available boss HP samples, and per-player skill
totals. It is a compact educational replay, not a complete native recording.
It must stay separate from the user's saved fight library and live capture.

Only `foxyyyynm` retains its player name. Every other contributor has a sequential
`Player N` label. Actor IDs are replaced with sequential sample IDs. Original
server IDs, timestamps, profile identifiers, positions, free-text labels,
warnings and other recording metadata are omitted. Skill names come from the
app's game catalogue. The original local recording is unchanged.

When replacing the sample, construct the output from an explicit list of allowed
fields. Do not copy a native recording and attempt to redact selected strings.
Check that all other player labels and IDs are anonymous, the final cumulative
damage matches the player totals, and each player's skill damage adds up to
their total. `deus-demo.test.ts` checks those invariants and rejects added player
metadata fields.

## Language first

The first step is the language, readable whatever language is showing: the heading
and prompt appear in both languages, and each choice is a card written entirely in its
own language (`English` · _Continue in English_, `Português (Brasil)` · _Continuar
em português_). Choosing saves the `locale` setting through `useOffline().patch`,
the same native settings path and cross-window language sync as Settings → General.
The step moves on only after the save succeeds; while it runs the card says it is
saving, and a refused save is reported, with **Try again**, in the language chosen.
Choosing the language already saved saves nothing. Language stays first in the step
list, so it can be changed again at any time.

## How the guide opens and resumes

- **First run.** The guide opens by itself once, on the language step, when nothing
  is stored and the library reports no saved fights. While the library count is
  unknown it waits. Someone who already has saved fights is never interrupted; Home
  offers the guide instead.
- **Entry points.** The header's **Guide** button (`Open the app guide`) opens it
  at any time. Home shows a start or resume band until the guide is finished or the
  band is put away with **Not now**; the header button still works afterwards. While
  capture is set up later, the band says so.
- **Progress.** Progress is kept in this window's local storage
  (`aion-companion.onboarding`, `{version: 2, chapter, seen, decisions, finished,
  quiet}`). Version 1 progress (chapters read, no decisions) is still read: its place,
  what was read and whether it was finished or put away carry over, with no decisions.
  Such a guide, unless finished, opens on the language step every time until a
  language is chosen there (`resumeAt` in `model.ts`); Home's resume band names
  that same step, so it never promises a step the guide skips past. A finished guide
  is never reopened by itself or sent back to it. Losing the progress only offers the
  guide again.
- **Closing.** Escape, the close button or **Finish later** keep the progress and
  decisions. Escape while a shortcut box is recording only cancels the recording; the
  guide stays open.

## Decisions and finishing

Each step records one decision (`model.ts`): `done` confirms it or sets the feature
up, `skipped` leaves an optional feature (alerts, pet farming, Explore) as it is, and
`later` defers live capture. Skipping never turns anything off, and the guide never
turns a feature on by itself.

Whether a step is ready is never stored; `stepState` reads it from the app every
time. Capture is ready only when Npcap works and capture is connected or waiting for
the game (the game need not run). An optional feature counts as set up only while it
is really on: reminders on with an alert enabled, a pet farming goal saved or a pet
pinned, an Explore layer or the Explore window shown. The pet radar window alone does
not count, and the guide never switches a feature on without a click.

### Activity on each step

Every change a step makes runs through `useStepActions`, which keeps it on the step it
was made from: in flight until it settles, then failed (when it resolved `false` or
threw) until a later change on that step succeeds. A failure stays on its step wherever
the reader is, marks the step in the rail and the review, and the step offers **Try
again**, which repeats the same change. Each step also takes its feature's own busy flags
and errors (`activityOf` in `GuideDialog.tsx`):

| Step                   | In flight                                               | Problem                                                   |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Language               | the language save                                       | the language save failed                                  |
| Live capture           | **Check again**                                         | none (readiness covers it)                                |
| DPS meter              | guide changes, the meter window busy                    | a guide change failed, a shortcut not saved               |
| Saved fights, profiles | guide saves                                             | a guide save failed                                       |
| Alerts                 | guide changes, alerts busy                              | a guide change failed, an alerts error                    |
| Pet farming            | guide changes, pets, farming or radar busy              | a guide change failed, a pets, farming or radar error     |
| Explore                | guide changes, a choice saving, the Explore window busy | a guide change failed, an Explore choices or window error |
| Updates                | the update check                                        | none (a failed check is shown, never blocks)              |

`stepState` shows a step with anything in flight as saving, never ready, even when it
was skipped meanwhile. A problem counts only on its own step, and not once an optional
feature (alerts, pet farming, Explore) is skipped: its errors stay shown there, but a
feature left as it is never holds the guide back, so an unrelated background read
failure cannot block Finish.

### Finishing

The review lists every step as ready, skipped, set up later, saving, needing attention
or needing a decision, each with **Change**. **Finish** is enabled only when every step
is ready or skipped, nothing is in flight and no step that is not skipped has a problem;
otherwise the review says why and links each step concerned. The Finish handler checks
again as it runs (including actions started since the last render), and `useGuide.done`
only takes effect while the guide is open on the review, so a late call after the reader
moved on changes nothing. Capture set up later keeps the guide unfinished and resumable.
Nothing requires the game to run, a fight to happen or an update to download; Npcap is
the one external install, from its official site.

## What each step changes

Every change is saved as it is made, through the app's own paths, and a failure is
shown on its step:

- **Settings** (auto-save, hiding names, shortcuts, language) go through
  `useOffline().patch`, which reads the saved settings afresh and changes only the
  field asked for. Patches run one at a time in the order asked, each after any save or
  action already running in that hook, so quick changes in a row are all saved instead
  of refused as busy, and each keeps the fields the one before it saved. An unsaved
  Settings draft is left as it is.
- **Live capture:** Npcap's official download and troubleshooting pages, **Check
  again**, and Npcap's own install steps. **Set up later** defers it honestly.
- **DPS meter:** the meter window switch and every global shortcut. The step has no
  lock control: the meter is placed in game first, then locked there, so the step
  teaches the lock shortcut instead. A recorded shortcut is a draft held for as long as
  the guide is (`useShortcutDrafts`): it is checked against the settings shown
  (`shortcutError` in `shortcuts.ts`: the lock key is required and a key used by
  another action or a preset is taken, as native checks), then saved and checked again
  against the settings as saved at that moment, on every retry too. A refused or
  invalid key stays in its box with the reason, and a key whose save failed stays with
  **Try again**; either way the step shows a problem, **Looks good, continue** and
  Finish wait, and the shortcuts open when the reader comes back, until the key is set
  again or **Put back the saved shortcuts** drops every draft (and the failure of a
  shortcut save with it).
- **In-game windows** (the meter, the pet radar, the Explore window) are asked for
  shown or hidden as the switch said when it was pressed (`setVisible`,
  `setRequested`), never toggled, so **Try again** repeats that request even if the
  window changed meanwhile.
- **Alerts:** reminders on or off, mute, the master volume and a test sound through
  the alerts' preview path (`chime`, no popup, nothing scheduled or marked delivered);
  the Alerts tab's **Server & clock** (region, server and the fallback zone), so
  countdowns and built-in reminders use the real server clock, and its delivery
  settings (background sound, reminding while the game is closed, quiet hours); and
  the ready-made catalogue (`AlertCatalogue`), with each entry's lead time and sound.
  While the server is unknown the step says that countdowns use the fallback clock and
  built-in reminders wait.
- **Pet farming:** find a pet, then **Farm this pet** on a chosen map
  (`usePetFarming` saves the goal, then asks for the radar, as the step says before
  the click) or **Pin to the radar** (`usePets().setPinned`), **Stop farming** and
  the pet radar switch. `app/GuideHost.tsx` reads pets and the radar only while the
  guide is open and loads the pet catalogue the first time the step shows.
- **Explore:** the Hidden cubes and gathering layers, the cube sub-layers, the
  Explore window and, while gathering is shown, the Explore tab's `ResourceFilter`,
  all through the shared saved Explore choices (`useFinderPreferences`), so the tab
  and the in-game window follow at once. The filter's map choice only selects which
  resources are listed; hidden resources hold on every map, and the map Explore shows
  is left as it is.
- **Updates:** **Check now** and the status. The guide never downloads, installs or
  restarts.

Saved fights and profiles stay demonstrative beyond their switches: the sample fight
on the DPS meter step shows what a fight holds without leaving the guide.

## The sample on the meter

`demo.ts` validates the sample and turns each two-second frame into the compact
live report, live status and overlay status the meter reads, so the step runs
the real `useMeter` and `DpsOverlay`. Rows open each player's skills; the compact
strip and hide buttons work on the sample. Player and skill totals are exact at
the final frame. Earlier frames use the recorded cumulative damage, while skill,
hit and crit counts follow each player's final split, as the step says. The
sample has no profile links, History, Copy or Full details, and New fight is
disabled.

Playback starts by itself each time the step is shown (the step mounts the sample
afresh, from the pull), at 8× by default, and holds whenever the step or window is
not visible. With
`prefers-reduced-motion` it opens on the finished fight and starts only from Play.
Pause, a scrubber and 1×, 4× and 8× speeds are always available. The JSON is a
separate chunk loaded when the guide first opens, and the guide's code is loaded
on demand from `App.tsx`.
