# Explore

Explore is the workspace's shared home for location finders. Hidden cubes and
Gathering are layers of one map, with one map choice, camera and player context.
New location kinds belong here rather than gaining another top-level workspace
tab. Only implemented layers are offered.

## Layers

Hidden cubes retains its possible locations, nearby live observations and earlier
sightings. Gathering retains category and resource filters over fixed possible
locations. Layer visibility controls which marks are drawn; each layer keeps its
own counts and details. Live cube observations remain distinguishable from static
possible locations. Changing filters does not transfer positions to another map.

The original locally bundled atlas works without capture. Distances require a
fresh confirmed player position on the displayed map. Failed reads, stale positions
and unknown areas remove player measurements while leaving static locations
browsable. Cube Clear affects live cube observations, never the fixed catalogues.

Both static layers together account for 4,149 possible placements in Verteron and
4,063 in Altgard. These totals describe catalogue placements, not current server
availability. Clustering preserves the counts of represented placements as the
map zooms out. No respawn timer or availability rule is inferred.

Static layers share one clustering pass. A mixed count tag represents both cubes
and gathering, retains each layer's count and uses their original artwork. Live
cube observations are drawn above those tags. Hiding a layer preserves the camera
and the other layer's filter choices.

## Shared choices and in-game view

`?tab=explore` opens the workspace. Existing `?tab=maps`, `?tab=cubes` and
`?tab=gathering` links also reach Explore with the relevant finder available.

One toolbar button, one Home switch and one workspace switch control the same
`explore-overlay` window (`?view=explore`). It follows the character's current map
and position, while the workspace can browse other maps. Layers, cube sub-layers
and gathering resources are shared; browsing a map in the workspace does not move
the in-game minimap. An unknown captured area does not select a substitute map.
The old cube and gathering window
names resolve to this single native window. Timers remains independent.

`finder_preferences` reads the shared choices; `finder_preferences_update` merges
only the fields in its patch, including partial nested layer flags. Native serializes
updates and atomically saves `finder-preferences.json` in this app channel's data
directory before publishing a new revision and `finder-preferences-changed` event.
Failed writes keep the previous choices. Windows discard older revisions; a late
read or event cannot roll preferences back. Choices survive closing the workspace
or restarting the app. Camera position, search text and selected marks are local
presentation state, rather than independent display filters.

## Player motion

While visible, the in-game overlay listens to `world-motion-updated` for new
confirmed fixes and context changes. `world_motion_status` supplies the initial
snapshot and periodic recovery reads. The marker and follow camera use this feed;
cube observations, distances and nearest-place calculations retain their 250 ms
status poll. The workspace continues using that poll for its marker too.

The player marker uses the same bounded display motion as the pet map. Confirmed
fixes interpolate over 200 ms; plausible consecutive fixes can predict at most
1.2 seconds and 15 metres ahead. Teleports, long gaps, session or map changes,
failed reads and capture stops reset prediction. Repeated snapshots and turns
without a new position do not extend its horizon. Reduced motion disables both
prediction and interpolation. Estimates affect only the marker and following
camera, never distances, nearest-item order or resource availability.

The facing arrow comes from the same validated own-character observations as
Pets, with coordinate yaw 0° toward +X and 90° toward +Y. It is not inferred from
movement or the camera. Facing expires independently after 10 seconds. Native
snapshots include the observation clock, fresh position, last confirmed position
and optional facing. A last-known marker may remain after position freshness
expires, but supplies no measurements or further prediction.

Push delivery removes the wait for a frontend poll; it does not supply missing
coordinates. See [position research](MAP_POSITION_RESEARCH.md) for measured update
cadence, source limitations and the decision to exclude process-memory access.

## Extending the workspace

`app/ExploreTab.tsx` owns the workspace's shown-only cube status read. That one
snapshot supplies shared capture context, player position and received cubes;
the gathering catalogue needs no separate poll. `features/finder/layers.ts`
declares the supported layers, `useFinderMap.ts` holds map and selection state,
and `FinderMap.tsx` composes their marks into the shared canvas. `ExploreView.tsx`
and `ExploreOverlay.tsx` render from props without invoking native commands.
`app/ExploreApp.tsx` wires the in-game view, while `useFinderPreferences` connects
each window to the revisioned store in `lib/finderPreferences.ts` through the
native service. The workspace keeps that store above its tab lifetime.

Reuse the atlas, camera, generic map canvas and clustering model. A new real layer
supplies its location model, verified artwork or written fallback, filters, counts
and selection details to the shared surface. Keep capture reads in app/hooks and
services, and keep feature rendering independent of native calls. A finder must
establish its own data provenance and availability semantics before it is offered.
It must not acquire a second camera or infer live presence from static metadata.

See [Cube Finder](CUBES.md), [Gathering Finder](GATHERING.md) and
[artwork provenance](GAME_ARTWORK.md) for the current layers' data and limits.
