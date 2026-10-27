# Hidden Cube finder research

Researched **2026-10-22**. Scope: publisher-owned sources for game mechanics;
tool authors' own sites, repositories and sample captures for tool capabilities.
Tool documentation is evidence of what its author implements or observed, not a
publisher guarantee. No third-party application, map dataset or capture was
installed or imported. Source pages/code were read online. No implementation or
UI changes were made.

## Conclusion and confidence

A standalone **nearby observed-cube finder is technically plausible**. Published
Global packet samples contain object identities and XYZ coordinates, with
separate interaction/removal events. This establishes a stronger feasibility lead
than static map pins, but still needs validation using this app's own supported
builds and recordings. It does not establish a mapwide live feed.

Candidate-location maps are useful for searching and route planning. They do
not establish that a cube is present, when it will respawn, or which channel has
one. No dependable numerical respawn interval or cross-channel synchronization
rule was established from publisher sources in this investigation.

Confidence is **high** in the documented distinction between static candidates
and observed objects; **moderate** in nearby radar feasibility on the cited Global
build; **low/unknown** for current cross-build compatibility, exact respawn timing,
all-zone templates, channel semantics and mapwide availability.

## What the publisher actually confirms

The Korean **January 14, 2026 update note**, published by the `AION2 공식`
account, says that a Hidden Cube spawn delay is being added and that the chance
of cubes which can only be opened with a key is being increased. It gives **no
numerical duration** for that delay. This is a KR patch statement, not proof that
the same rule or parameter applies to today's Global build.
[Official KR January 14 update](https://lounge.plaync.com/feed/55760?country=KR&locale=ko-KR).

The official Taiwan July update page advertises Eltnen and Morheim with the
July 1, 2026 expansion. This establishes that those locations belong to a
different regional content timeline; it does not establish their availability
in a particular Global patch.
[Official TW expansion page](https://tw.ncsoft.com/event/promo/AION2/preview/260614_update/index.aspx).

Searches also found publisher-hosted **NCER** guides. One directly inspected
Hidden Cube article explicitly says its information was AI-generated and may
differ from the game. Do not treat publisher hosting alone as authoritative
mechanical verification. That article is excluded as a basis for spawn timing,
specific coordinates or Global opening rules.
[NCER Hidden Cube article, December 22, 2025](https://lounge.plaync.com/feed/52100?country=KR&locale=ko-KR).

The publisher's Korean cube probability page was reached, but the retrieved page
did not expose the reward tables. No numerical reward or timing claim is taken
from it.
[Official probability disclosure](https://probability.plaync.com/aion2/view?probCategoryId=69032b1757c8986afe4406ab).

For regional chronology, a directly fetched official Global announcement lists
September 30–October 4 early access and October 5 official launch in 2026. Its
public article JSON was inspected because the rendered page exposed little text.
It contains no cube spawning specification.
[Global launch announcement](https://aion2.plaync.com/en-us/board/notice/view?articleId=6aadde90fa34c1011d6277af),
[first-party article JSON](https://api-global-community.plaync.com/aion2_global/board/notice_en/article/6aadde90fa34c1011d6277af).

## Fixed candidates, random groups and specific places

These concepts can coexist: a group can have a fixed list of possible positions
while its next active object is placed at a selected position. A pin is one
candidate, not an independently available chest with its own demonstrated timer.

The **Aion2.gg map author's model** explicitly distinguishes **154 cube groups
from 2,811 possible spots** across its two main zones: Verteron has 95 groups /
1,440 spots; Altgard has 59 / 1,371. The author describes a cube returning at a
random member of its group's spots, and omits permanent completion ticks for
cubes. Its page separately labels Eltnen and Morheim as later content, with
26 groups / 456 and 26 / 455 spots. These are the map author's dataset/model
claims, **not independently verified publisher mechanics or simultaneous live
counts**. Do not turn 2,811 pins into 2,811 active cubes.
[Aion2.gg cube map and explanation](https://aion2.gg/map/hidden-cubes).

The **Map Overlay author's NOTICE** explains that earlier cube markers were
replaced with all candidate positions from a world-coordinate cube-group list.
Its October 7 v1.6.0 notes report 1,440 Verteron and 1,371 Altgard candidates.
Agreement between these authors is useful corroboration of their displayed
coverage, but does not independently prove the server selection algorithm.
[Author's provenance notice](https://github.com/problem-xyz/aion2-map-overlay/blob/main/NOTICE),
[versioned release notes](https://github.com/problem-xyz/aion2-map-overlay/releases/tag/v1.6.0).

Concrete places to inspect, rather than an uncited list of coordinates:

- **Verteron:** AION2 Status's own map guide groups about 78 candidate pins near
  Eastern Tolbas Forest, with Aullaeu Village Border as the nearby teleport.
- **Altgard:** the same author groups about 63 near Calderon Canyon, with
  teleport #4 Temporary Investigation Base. Its counts use the nearest place
  label and its travel distances are straight lines; neither is a measured live
  yield or optimized route. Its FAQ explicitly distinguishes a possible spot
  from a currently present cube.

These are evidence of that tool's organization and navigation aids, not
publisher-confirmed best farming areas.
[Author's candidate-area and overlay guide](https://aion2status.com/en/hidden-cubes/).

For exact observed coordinates, the published Global sample discussed below
contains two Verteron objects. Those coordinates are examples of observations,
not a new reusable map dataset, guaranteed future spawns or destinations that
are currently occupied.

## Respawn, server and channel unknowns

No publisher source inspected established a fixed per-spot cooldown, a numeric
random respawn distribution, a maximum simultaneous cube count, or a guaranteed
1–4 hour interval. The January delay change makes unversioned timing folklore
particularly unsuitable for a countdown feature.

No publisher source inspected established whether cube state is scoped to a
server, channel, instance, region or some combination, or whether channel changes
reset/preserve it. A website's server selector or a map's faction selector does
not demonstrate any live state connection.

Practical implications, inferred from the evidence boundary:

- A candidate pin may always be shown as a **possible location**.
- A newly received object record can support **observed nearby**, with capture
  time and context. First received is not automatically newly spawned.
- An out-of-view removal does not prove another player collected the cube.
- A confirmed opening applies to that observed object/context; it does not
  establish a timer for all positions in its candidate group.
- Unknown channel identity must remain unknown. Do not reuse observations after
  a context change or claim a cube is absent merely because it was not received.
- No documented public publisher endpoint for mapwide cube availability was
  located. This is a search result, not proof that no internal endpoint exists.

## Maps and desktop approaches, verified with their authors

**Interactive Map**, supplied as the user's interaction reference, presents Altgard
as a browsable map with a map selector, marker search, category filters, reset-view
controls and marker details. Its interface lists Hidden Cube under Collectibles
and individual gathering resources under Resources. This supports a shared map
canvas with category-specific layers as a suitable interaction pattern. Those
displayed locations are not a live availability feed. The site was inspected in
the browser on October 22; its marker database and assets were not imported.
[User-supplied Altgard reference](https://interactivemap.app/aion2/maps/altgard).

**Aion 2 Maps** is a browser atlas with 3D terrain, floor slicing and see-through
roofs, useful for caves and vertical locations. Its author says it is built from
game-client map data and includes cube markers. Browser progress/sync is a
checklist facility, not demonstrated live spawn detection.
[Author's atlas](https://aion2maps.com/),
[Verteron map](https://aion2maps.com/verteron/).

**AION2 Hub** provides candidate maps and filters. Its selector explicitly labels
Eltnen, Morheim and Chaotic Middle Reshanta KR/TW, citing client v110 dated
September 9 and Global status as of September 19, 2026. That dated label is
evidence of the site's regional separation, not a fresh October 22 Global
content audit.
[Author's map selector](https://aion2hub.com/maps).

**hnomkeng/Aion2MapOverlay** aligns bundled markers to the open in-game world map
using screen matching. Its code loads YAML candidates, filters `hiddenCube`,
captures the screen and projects those coordinates through a map transform.
This is a real-time alignment overlay over static candidates, not live cube
availability detection. Its README limits testing to 1920×1080 and Asmodians.
[Author's README](https://github.com/hnomkeng/Aion2MapOverlay),
[alignment/marker code](https://github.com/hnomkeng/Aion2MapOverlay/blob/main/OverlayWindow.xaml.cs).

**problem-xyz/aion2-map-overlay** supports user routes aligned to the map by screen
recognition. Its v1.6.0 combines cube candidates and height hints with a separate
event timetable. The presence of a Timers tool does not establish cube respawn
timers. The release notes are more current than the root README's statement
that no releases exist yet.
[Author's repository](https://github.com/problem-xyz/aion2-map-overlay),
[v1.6.0](https://github.com/problem-xyz/aion2-map-overlay/releases/tag/v1.6.0).

**TH.GL** advertises a Windows overlay, live player tracking, nearby-object mode,
routes and a browser map/database; its current support list names Steam.
The inspected feature page does not explicitly identify live Hidden Cube
support. Therefore its general live-mode claim must not be rewritten as verified
cube detection. Its dated author reply says player tracking arrived October 8
in v21.1.0.
[Author's feature page](https://www.th.gl/apps/aion2),
[author's implementation update](https://www.th.gl/suggestions-issues/1555527336571707473).

**TeamMate / DBAion2** explicitly advertises an experimental PRO cube arrow with
distance, height, nearby alerts and session history. Its author says a patch may
disable it until an updated app is released. This verifies an advertised nearby
finder, not a mapwide feed or an implementation we independently tested.
[Author's Hidden Cube guide](https://dbaion2.online/en/tracker/guide/).

**BeardBear33/AION2-Cube-Detector** uses audio restricted to the game process and
children, with near-cube calibration. The author explicitly says its calibrated
percentage is relative sound level, **not metres**. It supplies an alternative
detection approach, not evidence of coordinates or a respawn schedule; regional
coverage and detection accuracy were not established.
[Author's audio-detector documentation](https://github.com/BeardBear33/AION2-Cube-Detector).

**The Completionist** currently describes manually tracked progress and possible
cube locations from public data, with no game traffic/memory reading. Do not
infer a current live cube radar from its name, screenshots or older versions.
[Author's current description](https://github.com/Kloggzer/the-completionist-aion2).

## Strongest public nearby-radar evidence

The following sources are primary evidence about their authors' implementations
and experiments, not publisher-endorsed protocol documentation.

**Cube Watch**, pinned at
`a6992215a526da0a1254ce7bbd8a55c1733475e9`, parses `34 36` object spawns,
`35 36` removals and `38 36` / `3a 36` interactions. Its cube signature is
`0x0013DACF` (1301199), read with XYZ from the object record. Its README describes
Npcap capture and a click-through minimap overlay; it estimates announcements at
about 15,000 world units. This does not establish all-zone recognition.
[Pinned parser](https://github.com/ayi-afk/aion2cubedetector/blob/a6992215a526da0a1254ce7bbd8a55c1733475e9/proto/proto.v),
[author's usage/range claims](https://github.com/ayi-afk/aion2cubedetector).

**Cube Radar**, pinned at
`c9c8497ed03b06f0b281f431e0c1ce6204c7c866`, documents the author's own
October 13 captures on Global Steam build **25800038**. Its findings distinguish
measured observations from hypotheses, report nearby object delivery and
event-driven own-position updates, and find no zonewide notification. These are
the author's experiments; we did not reproduce live captures here.
[Pinned experimental findings](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/docs/FINDINGS.md).

Its configuration marks **1200039 and 1200041 as verified Verteron templates**,
but **1301199 / Altgard as a hypothesis**. Its four planar entry samples are
approximately 9,680–10,548 world units, interpreted as about 100 m. That differs
from Cube Watch's approximate 150 m claim; **do not guarantee a detection
radius**, and do not equate entry and exit radii.
[Pinned template/range evidence](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/config/cubes.json).

The object parser separates spawn, removal and interaction records. It reads XYZ
as little-endian floats after object identity, kind and template. It distinguishes
removal reason `04` (destroyed/opened) from `01` (left view), and reads a
candidate creation timestamp. None is a next-respawn timestamp. Ownership,
reason meanings and timestamp interpretation still require our build-specific
validation.
[Pinned object lifecycle parser](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/src/CubeRadar.Core/Protocol/ObjectMessages.cs).

The primary agent independently decoded both published `34 36` hexadecimal
fixture bodies in JavaScript, obtaining:

- Object **65509**, template **1200039**, XYZ **(-50205, 126283, 15449)**.
- Object **34438**, template **1200039**, XYZ
  **(-51124.625, 134578.78125, 19311)**.

These match the sample author's values (the second Y is rounded in its JSON).
This validates decoding of those published vectors, **not the completeness of
the protocol, today's server behavior, or our own live capture path**. The
fixture's map identifiers reverse displayed X/Y relative to packet order; do
not silently swap axes in a future map projection.
[Pinned two-cube fixture](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/fixtures/cubes/2026-10-13_verteron_two_cubes.json).

## Data access and licensing boundaries

Publicly readable data is not automatically licensed for bundling or served by
a stable API. No third-party dataset, app bridge, importer or file reader is
recommended for this standalone application.

- **aion2-interactive-map:** the author explicitly separates GPL-3.0 source under
  `/src` from **CC BY-NC 4.0** images/JSON/assets under `/public/data`.
  Do not treat its code license as permission for unrestricted map-data reuse.
  [Author's license split](https://github.com/aion2-interactive-map/aion2-interactive-map#-license).
- **Map Overlay:** the author's license permits inspection and personal builds
  but reserves redistribution and derivative publication; it separately credits
  CC BY-NC maps/object sets and says NCSOFT content rights remain with NCSOFT.
  It is not a permissively licensed implementation source for this app.
  [Author's license](https://github.com/problem-xyz/aion2-map-overlay/blob/main/LICENSE).
- **Cube Radar:** GPL-3.0. Treat it as a factual protocol/experiment reference;
  copying code would require a separate compatibility decision. Its findings
  explicitly mark externally collected spot-data licensing unclear and omit
  that dataset from Git. No permission to reuse those spots is inferred.
  [License](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/LICENSE),
  [data provenance caveat](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/docs/FINDINGS.md).
- **Cube Watch:** no obvious repository license was found; do not copy its
  implementation. The inspected repository listing also does not establish
  permission for redistribution.
  [Author's repository](https://github.com/ayi-afk/aion2cubedetector).
- **Audio detector:** the repository identifies AGPL-3.0. An audio implementation
  and its calibration material would need separate review before reuse.
  [Author's license](https://github.com/BeardBear33/AION2-Cube-Detector/blob/main/LICENSE).
- **Commercial/fan sites:** no reusable cube API contract or explicit dataset
  license was established from the inspected TH.GL, AION2 Status, Aion2.gg,
  Aion 2 Maps or TeamMate feature pages. Their download/export buttons and public
  marker displays are not an integration recommendation.

## Local feasibility supplied by the primary agent

The primary agent inspected this app separately and supplied these findings on
October 22; this internet-research pass did not re-audit that architecture:

- Current pet decoding handles `41 36` NPC spawns and `42 36` removals. Searching
  `cube` in `crates` found no cube parser. See the
  [spatial observation reader](../crates/companion-core/src/wire/pets.rs) and
  [decoder dispatch](../crates/companion-core/src/wire.rs).
- Existing position observations retain X/Y and drop Z. Consequently current
  position plumbing cannot substantiate above/below guidance. See `Observation`
  in the spatial reader and the
  [pet state owner](../crates/companion-capture/src/pets.rs).
- Capture, map projection, character identity and freshness handling are useful
  reusable infrastructure. Cube objects need an independent lifecycle domain,
  not classification as pet NPCs. Existing map and freshness behavior is
  documented in [Pets](PETS.md) and [map position research](MAP_POSITION_RESEARCH.md).

## Practical standalone recommendation

Start with an **experimental nearby-observation capability**, after independent
validation. Reuse this app's capture infrastructure; independently implement
validated object parsing and XYZ observations. Keep candidate maps optional and
separate, using only independently sourced, documented and permitted data. A
candidate dataset is unnecessary to demonstrate a nearby radar from object
coordinates.

Before shipping a live claim, validate our own native recordings for known
Verteron variants, Altgard, malformed/truncated frames, unrelated objects,
opening by self/others, lost sight versus destruction, zone/character/channel
changes, reconnects and position age. Validate the map transform and units before
metres or height guidance. Preserve build, region, source, session and observation
time; clear or downgrade observations when their context becomes uncertain.

Useful eventual behavior: nearby alerts, observed locations, planar distance,
vertical difference only with fresh XYZ, and explicit last-seen/opening/opened/
out-of-view states. A route or distance must carry stale-position uncertainty.
Static pins should say possible location; manual checks should record time and
context rather than permanently mark a respawning spot complete.

Do not promise a cube at a pin, a mapwide scan, a precise detection radius,
cross-channel availability or a respawn countdown. Those require evidence this
research did not establish. The next engineering milestone should demonstrate
correct nearby lifecycle behavior with this app's own captures, before adding
prediction or broader map coverage.
