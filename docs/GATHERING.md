# Gathering Finder

The Gathering layer in the shared Explore workspace and focus-gated
`explore-overlay` browse original-client possible gathering placements on the
shared world map. They work without capture.
These are possible locations, not confirmation that a resource is available now.
No respawn timer, depletion state or skill requirement is inferred.
The workspace shares its map and camera with Hidden cubes; layer controls decide
which locations are drawn. See [Explore](EXPLORE.md) for shared navigation and the
in-game view, which mirrors these layer and resource choices.

## Data and artwork

`frontend/src/data/gathering-spawns.json` version 1 contains **5,401 placements**:
Verteron has 130 groups / 2,709 points; Altgard has 39 groups / 2,692 points.
All 27 environment-object IDs resolve through native EnvObjData, GatherSource,
GatherSourceMaterial and Item records. Original names are available in English
and Brazilian Portuguese. Categories are food, gemstones, herbs, aether, ore and
wood. Different environment IDs remain distinct even when they yield the same
item. Source group names never establish a required gathering level.

The original installed Steam client is app 3393110, build 26077854. Each map
retains native group names, environment-object IDs and full-precision XYZ
centimetres. Archive/member hashes, build and extraction date accompany the
catalogue. Map projection is the existing calibrated atlas: +X east, −Y north.
Data is bundled locally; there are no runtime client-file readers or website
marker downloads. See [research](GATHERING_RESEARCH.md) for table joins, hashes,
format references and limitations.

Thirteen verified original item icons are bundled unchanged from the publisher's
CDN. Their keys, exact native packages, URLs, dimensions and SHA-256 checksums
are in `resource-art.json.gathering`. The exact two remaining native keys were
unavailable from the CDN and the inspected asset indexes. Kukuru, Ohkra, Inina
and Conide therefore retain written labels instead of substituted artwork.
`npm run check:art` validates every bundled icon and its native item-key join.
Game artwork and data remain separate from the software license.

## Position authority

`gathering_status` is a small read-only snapshot of capture's existing validated
local identity, zone and position context. It has no resource sightings, counts,
pet-profile requirement or new capture worker. Its contract is:

```text
running, phase, message, session_id, revision,
zone_id, map_id, position {x, y, z?, observed_ms}?, position_age_ms?
```

Only the local entity can move the player marker. Position expires after 15
seconds and is null without a confirmed local identity or while capture is off.
Connection, character and zone transitions invalidate old geometry. Distances
are planar metres and require fresh position on the displayed map. They are
straight-line measurements, not route lengths or confirmation of availability.

The frontend polls only while shown. Errors remove the player marker and all
distances while preserving the browsed map and its static possible locations.
Map images are released after the existing hidden-window delay. The shared Explore
overlay uses the existing activity-window focus, visibility, lock, hit-region,
geometry persistence and shutdown controller.

## Build-time extraction

`scripts/build-gathering-spawns.mjs` accepts unpacked **original** MapData members,
the original archive, Steam manifest and this application's native metadata
extraction result. It is a development tool, never part of the runtime flow.
The bounded typed MapData reader is shared with the cube extraction script;
reference-table strings cannot produce placements. Metadata joins must resolve
every placement ID and agree with its native category before bundling.

Script regression checks cover typed native arrays, XYZ precision, reference
strings, malformed records, unresolved metadata, artwork joins and complete
bundled counts. The capture tests cover fresh ownership, stale and stopped
positions, map transitions and the absence of inferred resource availability.
Live gathering packet detection needs independent current-build validation
before it can be added.
