# Cube Finder maps

The Hidden cubes layer in the shared Explore workspace tab and its compact in-game
overlay show possible Hidden Cube locations and recently observed objects on
the game's original maps.
Live observations use the application's existing receive-only capture; possible
locations come from the locally bundled original-client catalogue.
Open the overlay from the workspace; it follows the same game-focus, lock,
dragging, resizing, saved geometry and close-to-hide behavior as the activity
windows. Capture runs independently of whether either view is visible.

Live detection is experimental. It does not scan an entire map, predict
respawn times or infer channel availability. The initial signatures cover two
published Verteron variants and one
experimental Altgard variant. Other templates and regional/build differences
remain unsupported until independently validated. There is no audio alert in
this first version; new observations have a visual indication.

## Map surface and layers

The map remains available when capture has received no cubes. Browse Altgard or
Verteron, pan and zoom, fit the map, or inspect a sighting. The workspace provides
more room for the map and sighting details; the overlay uses the same map in its
resizable game window. The map uses the original textures, downloaded once on first use
and cached locally, and the calibration documented in
[artwork provenance](GAME_ARTWORK.md#pet-spawn-maps).
World +X points right and +Y points down; packet axes are not swapped.

Browsing another map does not move live observations onto it. Player and cube
marks require a matching known capture map. The player mark additionally requires
a fresh confirmed position. Failed reads remove live spatial marks until capture
can be read successfully again. Earlier observations retain their historical meaning;
their presence on the map does not establish that a cube is still available.

The map canvas accepts marker layers independently of cube lifecycle data.
The workspace shares its map choice, camera and position with the Gathering layer;
each layer has its own filters, counts and details. See [Explore](EXPLORE.md) for shared
navigation and [Gathering](GATHERING.md) for resource locations.
No third-party website or companion application is contacted by the running app.

## Possible locations

The default-on possible-location layer contains **1,440 Verteron positions in 95
native groups** and **1,371 Altgard positions in 59 groups**. These are original
client placements, not an availability feed. A location pin does not mean a cube
is currently there, and a group does not establish a verified server spawn rule.
There are no inferred respawn timers or channel claims.

Possible locations remain available without capture and survive failed reads
and Clear. Browsing a different map shows its own catalogue. Nearby points merge
into cube count tags when zoomed out; zooming in separates them. Every cube on
the maps and in the lists uses the original Hidden Cube artwork (see
[game artwork](GAME_ARTWORK.md)): a possible location shows it on a dark round
plate with a dashed ring, a received cube on a lit diamond. Candidate selection
is distinct from observed object selection and has no opening or collection state.
Distance requires a fresh player position on the same map.

`frontend/src/data/cube-spawns.json` preserves native group names, object IDs,
full XYZ coordinates in centimetres and source provenance from installed Steam
build **26077854**. Coordinates use the same native +X east / -Y north frame as
live observations. The UI uses neutral group numbers, not guessed regional names.
Static object IDs do not expand the live packet signatures automatically.

The independently written build-time reader is `scripts/build-cube-spawns.mjs`.
It takes the original unpacked `Data/Map` directory, original archive and Steam
manifest, validates typed native arrays, and writes this app's own catalogue:

```text
node scripts/build-cube-spawns.mjs <unpacked map root> <original pak> <Steam app manifest> <output JSON>
```

The running app does not read game files. The catalogue was regenerated from
the original members and compared exactly, including hashes and every coordinate.
The script's tests are part of `bash dev.sh check`. See
[source research and extraction evidence](CUBE_SPAWN_DATA_RESEARCH.md#validated-local-extraction)
and [game-data attribution](../THIRD_PARTY_NOTICES.txt). Underlying game data
remains separate from the software license.

## Observations and freshness

`wire/cubes.rs` decodes the world-object lifecycle separately from NPCs:

- `34 36`: common object header with identity, template and finite XYZ.
- `35 36`: removal, with reason `01` classified as out of view.
- `38 36` and `3A 36`: opening start and the complete successful opening pattern
  observed for the supported signatures. Unknown completion outcomes are ignored.

Only supported cube templates enter the finder. An interaction with an unknown
object cannot discover a cube. Destroyed/removed without a completed opening
is not reported as collected. First seen is the time this app received the
object, not a claimed spawn time. Returning to view does not increment the
observed counter while that same object remains in the bounded history.

Own-position XY and entity ownership use the existing validated spatial reader.
Z is optional and never carried forward from an older XY observation. Aim points
and other actors' coordinates cannot become the player's position. Distances,
north-up bearings and height differences require a confirmed own position no
older than 15 seconds. Heights additionally require both Z values. Coordinates
are game centimetres; the display uses metres. North is world -Y; east is +X.
No distance is inferred from an animated or predicted display position.

Sightings become stale after 90 seconds without an object lifecycle observation.
Out-of-view and stale sightings remain history, with no current distance or
direction. History expires after five minutes; opened/removed records expire
after 30 seconds. Storage is bounded to 128 objects, evicting the oldest when
full. Counts describe observations in the current context, not map population.

Connection/flow changes, closed connections, capture failures/stops and observed
character changes clear ephemeral state. Every zone-load observation clears it,
including the same zone ID, since this can represent a different instance or
channel. Learning identity metadata alone preserves the context; an established
name/server mismatch invalidates it. Unknown channel identity remains unknown.
Manual Clear clears sightings/counters while retaining the current player fix.
Nothing is persisted or imported from another application.

## Ownership and API

`companion-core` produces bounded typed observations after frame/bundle validation.
`companion-capture::cubes` owns lifecycle state under the existing capture lock.
Status copies at most 128 observations, releases the capture lock, then sorts and
builds JSON. `src-tauri/src/cubes.rs` only adapts IPC on a blocking worker.

- `cubes_status`: current capture phase, context/session identifier, revision,
  zone/map identity, fresh optional player position and bounded cube rows.
- `cubes_clear`: clears observations and returns the same status shape.

The activity-window adapter uses `kind: "explore"`, loads `?view=explore` and uses
native label `explore-overlay`. Legacy `cubes` and `gathering` kinds resolve to this
same window. Its geometry and lock choices are independent of Timers. Frontend
polling pauses while hidden; controls use the
existing action ordering and native hit-region mechanisms.

## Validation boundary

Automated coverage includes published Global spawn vectors, invalid/truncated
records, malformed bundles, unrelated objects, duplicate events, fresh and
missing XYZ, stale positions, opening versus leaving view, context invalidation,
entity reuse and bounded history. Published vectors validate those examples,
not today's server behavior. In-game confirmation with this app on the current
Global build is still required before claiming complete detection coverage or
a fixed detection radius. See [research and pinned evidence](CUBE_FINDER_RESEARCH.md).
