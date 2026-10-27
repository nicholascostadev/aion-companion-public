/*
 * DEV ONLY. Plain `?mock` is a busy evening with the full data set.
 * - `?mock=fresh` is a first run: the game is not running yet, nothing has been saved, no
 *   window is shown and nothing is chosen, so empty and first-run states can be checked.
 * - `?mock=long` is the same evening with the longest real strings: AION is unfocused, so
 *   every requested in-game window is Auto-hidden, the bosses, pets and maps are the longest
 *   names in the bundled catalogues, fight labels and reminders are long and the overlay
 *   reports an error. Use it to check that nothing overflows.
 * - `?mock=still` is the busy evening with the character standing still: no fresh position,
 *   only the last observed one, so last-known maps and unknown distances can be checked.
 * - `?mock=raid` is the busy evening in a full 12-member raid, so the Group window can be
 *   checked at its largest roster, with fresh, old and unknown ready states side by side.
 * - `?mock=failing` is the busy evening with a failing bug-report export, so the error and
 *   its window-log fallback in Settings can be checked.
 * - `?mock=update` is the busy evening on a stable build with a new release available, and
 *   `?mock=update-ready` the same with it downloaded and verified, so the header's update pill
 *   and App updates in Settings can be checked. Download in `?mock=update` reaches ready.
 * - `?mock=portable` is the busy evening on a stable portable copy with a new release
 *   available: it cannot update itself, so App updates offers the installer instead.
 * - `?mock=npcap-missing`, `?mock=npcap-unavailable` and `?mock=npcap-unsupported` are the
 *   busy evening's saved data on a PC where live capture cannot run (Npcap not installed,
 *   installed but unusable, or not possible here), so Home's setup band and Setup in
 *   Settings can be checked. In `npcap-missing`, Get Npcap "installs" it and Check again
 *   then finds it ready.
 * - `?mock=access-cli`, `access-signin`, `access-cancel`, `access-invite`, `access-error` and
 *   `access-ready` are the busy evening on a stable private install at one step of the GitHub
 *   access path for private release updates (see `mockUpdateAccess.ts`), so the guide in App
 *   updates can be walked through without a GitHub CLI or an account.
 * - `?mock=backup-restored` and `?mock=backup-rolled-back` start just after a restore that
 *   applied or was rolled back; `?mock=backup-cancel` cancels every backup file dialog;
 *   `?mock=backup-large` has more saved logs than one backup holds. With `?mock=failing` a
 *   chosen backup file is refused. Restoring never quits the preview.
 * - `?mock=maintenance` is the busy evening during an officially announced maintenance of
 *   every Global server (reminders paused), `maintenance-done` the moment the notice marks it
 *   complete (the opt-in "maintenance complete" alert ringing), `notices-down` with the
 *   official notices unreachable for minutes (uncertain, nothing paused) and `game-closed`
 *   with AION not running (reminders held until "Alert while the game is closed" is on).
 * - `?mock=maps-download` is the busy evening on a fresh install: no map art is cached, so
 *   the first showing of each map downloads it over a few seconds (chart and progress first).
 *   `?mock=maps-error` fails each map's first download partway; Retry then succeeds.
 *   Otherwise every map's art is already cached. See `mockMapArt.ts`.
 */
const scenario =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock') : null;

export const FRESH = scenario === 'fresh';
export const LONG = scenario === 'long';
export const STILL = scenario === 'still';
export const RAID = scenario === 'raid';
export const FAILING = scenario === 'failing';
/** The stable update phase to fake, or null for the default development build. */
export const UPDATE =
  scenario === 'update' ? 'available' : scenario === 'update-ready' ? 'ready' : null;
/** A stable portable copy (`?mock=portable`): it checks releases but cannot restart into one. */
export const PORTABLE = scenario === 'portable';
/** The Npcap problem to fake (`?mock=npcap-…`), or null for a working driver. */
export const NPCAP = scenario?.startsWith('npcap-') ? scenario.slice('npcap-'.length) : null;
/** The GitHub access step to fake (`?mock=access-…`), or null. */
export const ACCESS = scenario?.startsWith('access-') ? scenario.slice('access-'.length) : null;
/** The backup situation to fake (`?mock=backup-…`), or null. */
/** The maintenance or game state to fake (see above), or null for a running game and no window. */
export const NOTICES =
  (['maintenance', 'maintenance-done', 'notices-down', 'game-closed'] as const).find(
    (name) => name === scenario,
  ) ?? null;
export const BACKUP = scenario?.startsWith('backup-') ? scenario.slice('backup-'.length) : null;
/** The map art situation to fake (`?mock=maps-…`), or null for every map already cached. */
export const MAPS =
  scenario === 'maps-download' || scenario === 'maps-error' ? scenario.slice(5) : null;
