# Pet collection and farming

The Pets workspace lists 207 pets across Cognia, Fera, Natura, Varia and Specia.
Search by pet, source monster, region or map; filter the collection and keep
favourites pinned independently from the current farming goal.

Its header names the character shown, how current its collection is, its totals
and this session, with the character list, the pet radar switch and the radar's
settings (lock, range, background, size, max-level pets) folded under a button.
Below it, Level 3 by type has one tile for all pets and one for each type: the
type's original symbol and written name, "N at Level 3" and "of T pets". The
counts always cover the whole collection of the profile shown, whatever the
search, list or map shows. While some levels are unknown the count reads "N+",
counting only known pets; with none known it reads "Level 3 unknown", never zero.
A note beside the tiles says where the counts come from (synced this session, last
full sync, saved collection or profile). Choosing a type tile filters both views
to that type; choosing it again shows every type.

Two tabs follow. Map is the farming atlas: a ranked portrait picker, the original
map and the selected pet's farming detail, side by side. Either side folds away to
widen the map; the map chooser offers Elyos, Asmodian and Abyss, and the Spawns and
Live layers show or hide the listed pets' static points and live sightings (the
selection and goal always show). Select a pet, choose a location if needed, then
Start farming. Choosing the selected pet again in the list or on its map mark, or the
detail's Clear the selection button, lets the selection go: the detail and the map's
focus return to the farming goal, or to nothing. The selection is not saved, and
clearing it leaves the goal, pins and chosen map as they are. The save completes before
the radar is requested; the workspace distinguishes a requested radar from one visible
over the game. A farming goal
sits beside the tabs with its souls, the radar's state and Stop farming.
Farmable here restricts the picker to the chosen map, and search also finds maps.
Collection is the portrait gallery with search, filters and pins; choosing a pet
there opens it on the map. Unknown collection progress never becomes an
ownership or completion recommendation.
The collection uses compact cards with original 256-pixel game portraits for
all 207 pets. Portraits are bundled from NCSOFT's game-data CDN, with IDs,
resource keys, dimensions and SHA-256 hashes checked during every build.
The app loads these images locally; a missing image keeps the pet's text label.
The recorded roster includes monster/soul-item mappings and static spawn points.
Pet identities follow the game's pet IDs, independently of soul-item numbering.
In particular, Aberrant Odyle Spider is pet 1021 (soul item 534660024), while
Mutated Aberrant Odyle Spider is pet 1025 (soul item 534660020). The latter owns
the Marsh, Garden, Highland and Unstable Ashen Spider farming sources. These
identities, names and item relations were checked against the Global client-data
`database.getPet` and `database.getItem` records on
[Questlog](https://questlog.gg/aion-2/api/trpc/database.getPet?input=%7B%22id%22%3A%221025%22%2C%22language%22%3A%22en%22%7D) on 2026-10-22. Earlier catalogue
data attached the names, soul items and farming sources to the opposite IDs;
correcting the catalogue preserves server-reported levels and saved progress.
Pets are farmed on three maps, one per realm: Verteron (Elyos), Altgard
(Asmodian) and Chaotic Lower Reshanta (Abyss). The map chooser, where-to-farm
list, map search and farming goals offer only these; dungeons, difficulties,
instance layers and other regions are never offered or shown automatically,
and a pet's sources off these maps are listed apart. The three maps are drawn on
NCSOFT's original detailed client map tiles, downloaded per map the first time
its art is shown and cached for offline use; until then the map draws its coordinate
chart (provenance, delivery and calibration in docs/GAME_ARTWORK.md). The catalogue keeps every other map for
native tracking; when the live radar follows the character onto one, it draws
a parchment coordinate chart with its name and a note that it has no official
map art. Original client map tiles support close zoom at their native resolution;
automatic fits keep the surrounding terrain in view. A static spawn point is a farming location,
not a claim that a monster is alive there now. Some internal instance resources
have no verified translated name and retain a neutral, disambiguated variant label.

The collector reads the full pet list at login or when the game resends it,
then applies progress, level and newly acquired-pet notifications. It never
counts both inventory changes and pet-progress notices for the same soul.
Collection refreshes do not generate pickup notifications. Levels are reported
by the server; the app does not infer a level-up from a soul threshold. The
current Global thresholds are five souls to acquire, 25 at level 1 and 75 at level 2;
level 3 is complete. Until a collection list arrives, missing pets are unknown.
The growth values were checked against `needSoul` and `leveling.needSoulCount`
in the Global client-data database on 2026-10-18 for every one of the 207 bundled
pets. The source query, extracted fields and checksum are preserved in
`crates/companion-capture/data/pet-growth-global.json`. Regional growth rules
can differ; the app does not infer server level changes from these thresholds.

A farming goal records a pet and one known spawn map in native preferences.
Starting or stopping a goal leaves favourites intact. The goal and last chosen
map survive an app restart, and saves retain revision-conflict protection.
The native collector rejects unknown goals and maps without that pet's spawns.
Goal sightings are prioritised before favourites when the radar output is bounded.
Explicit goals remain visible when complete, independently of the ordinary
show-maxed filter. Map fitting uses the focused pet's point bounds; Whole map
is a separate action. Difficulty labels are limited to explicit Easy, Normal
and Hard suffixes; other resource variants retain neutral labels.

Farming routes were removed from the app: no view, map layer or action shows,
follows or edits them, and the farming goal and pins work on their own. Routes an
earlier version saved stay untouched in the native pet preferences
(`config.routes`, `active_route_id` in `offline/pets.json`). The workspace reads
them for their shape only and sends them back unchanged with every preference
save, through `pets_configure` with the same revision check and rollback on a
failed write, so no saved data is migrated or dropped and an older build still
finds its routes. Native keeps validating that legacy data on load
(`pets::validate_saved`); files without routes keep the shape older builds read
(`schema_version` 1; empty route fields are omitted).

Session totals are ephemeral and reset on reconnect or character change. Soul
counts come from progress notices; new-pet and level counts require an established
collection baseline and authoritative notices. Collection snapshots never create
session gains, and repeated level notices do not count twice. Saved profiles
do not borrow the session totals of another character.

Collections are retained per observed character and server. Saved profiles can
be inspected offline and show their last sync time. New pickups advance a saved
baseline immediately after reconnect, with `~` marking the resulting counts until
a fresh collection snapshot arrives. A new authoritative level/add notice establishes
an exact zero baseline for that pet without requiring a complete collection; duplicate
level notices do not reset accumulated souls. Retained pickups skipped by older builds
are recovered once on load (the recent-pickup history is bounded to 100 entries).
Snapshots replace the cached estimate; thresholds never imply a level-up by themselves.
Capture starting after login cannot reconstruct records the game has not resent.

A saved collection is current only when capture has identified the character playing
now and the game sent its full collection on this connection; having been synced
once, however recently, is not enough, and no age makes it stale by itself. Until
then the Pets workspace shows a warning above every view, and the status line
says whether the collection is synced this session, not synced this session, a
saved collection shown because the character playing now is not identified (or
capture is not connected), or a saved profile chosen offline. The warning names
the last full sync and the recovery: keep the companion open, return to
character selection and log back in. Capture is passive and cannot ask the game
for the collection, so there is no sync button. The radar shows the same state
in a few words, apart from its live/position state. A saved profile chosen in
the Character list is labelled offline and is never told to log in again; a
current collection clears the warning by itself.

The compact radar uses received pet-source monster spawns, movement and removal
records. Matching monsters are grouped into concise rows with a count; the nearest
distance and direction always belong to the same observed entity. Every pet line
names the pet's type with its original symbol, so different pets met while farming
are told apart at a glance. Soul pickups are not announced on the radar; the
counts and progress on its rows update in place. Its map remains
visible alongside a bounded list, using the original calibrated sheet when one
exists. Recorded farming points and recent sightings have distinct marks; a
recorded point never implies that a monster is alive there.
It is separate from the DPS meter. Pinning applies in both the workspace and
radar. Pins lead every pet list, newest pin first, above the farming goal and
nearer monsters whatever their distance, and a new pin moves up at once. On the
radar, pinned pets and the farming goal stay listed while their monsters are out
of range, aged out or on another map: a near one sits in its monster's row with
its live distance; otherwise it reads Not nearby (the goal: Not seen) with where
it spawns, never a remembered distance. Unpinned monsters leave the list when
their sightings expire. Native keeps tracking pinned and goal monsters at max
level. Around a position the radar map opens 300 metres across its long side,
with independent zoom buttons. Far sightings stay in the list without forcing the
map out; a closer view can put them outside the map frame. The large map's Follow
your position toggle keeps its camera on the marker until disabled or the map is
panned, fitted or shown whole. Original tiles can be magnified up to four screen
pixels per texture pixel. Distances convert game centimetres to metres and require a local position
received in the last 15 seconds; monster sightings expire after 90 seconds.
The direction indicator uses map coordinate axes (-Y at the top, +X at the right),
not the camera. The map stays north-up. A separate gold arrow beside the player
dot shows the last own skill's facing, when received in the last 10 seconds.
Facing is independent of position age, clears on zone/character/connection changes,
and is neither inferred from movement nor retained as a current direction after expiry.
Fresh facing can accompany a hollow last-known position marker without refreshing
that position or enabling distances.
The player appears on a map only when the observed game zone has an unambiguous
map mapping. A stale position can keep the map centered, but its marker is marked
last known and does not provide a current distance or direction. Without a player
position, a chosen farming map can still show recorded locations without a player
marker. Unknown positions, maps and distances remain unknown.

The native status distinguishes `position` (fresh for up to 15 seconds) from
`last_position` (the last observed coordinates for the active character on this
connection). Both disappear for stopped capture or a different selected profile.
The latter is ephemeral, cleared on reconnect, character change and zone change
without replacement coordinates; it is never copied from a saved character.

Visible maps read a small `pets_motion` snapshot every 150 ms, separately from the
one-second collection/preferences read. Hidden maps stop these reads. Displayed
positions use the velocity of two recent measured fixes to project movement for
at most 1.2 seconds or 15 metres, then hold until another reading arrives. Repeated
polls never extend that horizon. New measurements reconcile small errors over
200 ms; jumps above 40 metres, implausible speed, map changes and stale fixes snap.
A dashed ring and the radar's Estimated position chip distinguish estimates;
the ring shows displacement from the last confirmed fix, not a guaranteed error bound.
Reduced motion disables prediction and interpolation. Animation never changes the
native coordinate, observation time, distances or saved state. Walking without
fresh observations eventually leaves the estimated marker stationary.
Effect add/renew frames (2A38/2B38) also provide the caster's
position; only a locally identified caster updates our own position.

The native radar defaults to 340 by 300 logical pixels, with nearby rows scrolling
above a map that keeps at least 45% of the available body. A saved size matching
the previous 340 by 440 default migrates once; other saved sizes are retained.
It is frameless, draggable, resizable and focus-gated to AION.
Its position and preferences are kept locally. Pet state lives in
`offline/pets.json` in the app data directory. Writes replace the file atomically.
A malformed saved file is preserved and reports an error instead of being
overwritten in the background. The app reads no other companion's files and
uses no online collection, map tiles or community sightings at runtime.

Pet type labels use the original AION 2 creature slot sprites: Intellect
(Cognia), Feral (Fera), Nature (Natura), Trans (Varia) and Special (Specia).
These are the mask, beast head, tree, spiral and flower emblems shown in
[NCSOFT's pet guide](https://tw.ncsoft.com/aion2/guidebook/view?title=%E5%AF%B5%E7%89%A9).
The unmodified WebP assets are bundled locally from the corresponding game UI
resource paths hosted by the public Questlog database. Provenance, dimensions
and checksums are recorded in `frontend/src/data/pet-type-art.json` and checked
by `npm run check:art`. A missing emblem leaves the written type name visible.

The packet readers have structural and malformed-input tests; collection, gain,
level, cached-state, reconnect, revision and persistence behaviors are tested.
Live in-game validation still requires the game to send a fresh collection and
pet drops while this collector is running. Regional packet differences may
require additional captured evidence.
