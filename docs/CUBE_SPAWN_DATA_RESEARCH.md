# Hidden Cube candidate-position data research

Researched **2026-10-22** for Altgard and Verteron. This pass inspected public
primary sources and their published terms. It wrote this note only, ran no
builds, and copied no third-party implementation or marker dataset into the
repository. The primary agent separately investigates the installed Steam
client; its extraction update is identified below rather than presented as an
independent result of this online research.

## Decision

**Use the original installed client's `MapData.dat` as the preferred provenance
for an independently produced candidate dataset.** Exact native file paths and
public format references are below. No ready-to-bundle, permissively licensed
public dataset containing every Altgard/Verteron cube candidate was established
in this bounded search.

There are usable public reference datasets, but their terms and content differ:

- The upstream community repository explicitly licenses its data **CC BY-NC
  4.0**; its committed pins and live feed are different snapshots.
- A derivative object set contains all **2,811** candidates, but retains
  noncommercial terms and does not identify the original world-coordinate input
  sufficiently to establish its complete rights chain.
- The user-supplied Interactive Map site expressly prohibits marker scraping and
  redistribution without permission. It should remain a browsing reference.

These conclusions concern provenance and published permission, not current cube
availability. Neither a client placement nor a web pin establishes a live cube,
channel state or respawn time. Original-client extraction avoids inheriting a
website's marker database; **it does not itself establish permission to
redistribute NCSOFT data**. No publisher grant licensing the extracted cube table
under MIT, CC0 or another permissive data license was located here.

## Original-client source and exact locations

The primary agent reported successful extraction from the installed Steam
client's **`pakchunk401000-Windows_0_P.pak`** on October 22, using the already
installed `repak`. Its exact archive member paths are:

```text
AION2/Content/Data/Map/World/World_D/World_D_A/MapData.dat
AION2/Content/Data/Map/World/World_L/World_L_A/MapData.dat
```

`World_D_A` is Altgard; `World_L_A` is Verteron. The public extraction-tool
documentation independently names these same map directories. The primary
reported raw exports under `.tools/cube-native`; this pass did not inspect or
modify those files. The locally installed build ID, game version, archive hash
and extracted member hashes should accompany the final dataset. Do not assign
the build of a website's extraction to these local files.
[Public native-cube format documentation](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/2830afc9e5734169d4eba1a26f5906b3ee0f5754/Tools/aion2-dat/build_hidden_cubes.py).

`repak` documents single-file extraction, archive listing and encrypted/compressed
`.pak` reading. Its MIT/Apache licenses cover the tool, not the contents of a
game archive. No redistribution entitlement for game data follows from using
it. [repak's own documentation and licenses](https://github.com/trumank/repak).

### CUE4Parse format facts

The maintainer's source at commit
`990d4d7d4e0340a75a14323436d55568f1415e00` is a primary reference for the
format understood by CUE4Parse, **not official NCSOFT format documentation**:

- `FAion2MapDataFile` decrypts the member, reads an initial FString and splits
  its comma-separated IDs. It selects the `MapData` struct for a `MapData`
  filename, accepts `Data/Map` and `Data/WorldMap` directories, and requires
  game mappings for structured deserialization. It does not embed a complete
  map-group schema.
  [Map-data reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2MapDataFile.cs).
- `FAion2DatFileArchive` documents through its behavior a repeating four-byte
  XOR for the file data: **`25 a8 7e 91`**. Its FString handling distinguishes
  positive UTF-8 and negative UTF-16 lengths; UTF-16 strings have additional
  string handling. Whole-file XOR does not mean every string is ordinary UTF-8.
  [Archive/string reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2DatFileArchive.cs).
- The generic property reader uses signed 32-bit array lengths, supports
  unsigned 64-bit properties, reads `DoubleProperty` as an eight-byte double,
  and consumes struct fields in mapping order. Struct-array headers need
  separate handling. A matching `.usmap` is the route for its general parser;
  this source is not evidence that an arbitrary text-search parser is complete.
  [Property reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2PropertyReader.cs).

Only format facts were used; no implementation was copied or run.

### Native cube-group identification

The dedicated extraction tool's introductory documentation identifies Verteron
groups containing **`HiddenCube`** and Altgard groups containing **`HiddenBox`**
in `EnvObj_...` names. Each group has candidate placements in **`Positions`**
and cube identities in **`EnvObjIdList`**. Placements contain XYZ location and
rotation; the author reports matching the identities to the client name
“Hidden Cube” through `EnvObjData`. These are useful field-identification facts,
not independently validated server spawn rules.
[Pinned native-cube documentation](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/2830afc9e5734169d4eba1a26f5906b3ee0f5754/Tools/aion2-dat/build_hidden_cubes.py).

The related spawn documentation describes `NpcIdList` as u64 IDs and locations
as having five significant bytes of a double plus three zero bytes, in the same
world units as NPC spawn positions. **Do not infer a five-byte record stride
from this wording.** CUE4Parse's general double reader uses eight bytes; the
actual native property's size, byte order, position/rotation separation and
array bounds must resolve the layout in this client's files.
[Pinned spawn-format documentation](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/2830afc9e5734169d4eba1a26f5906b3ee0f5754/Tools/aion2-dat/build_spawns.py).

The tool advertises output at `Client/assets/aion2/maps/hidden_cubes.json`, but
the corresponding [raw public URL](https://raw.githubusercontent.com/SkeeveAN/Aion-DPS-Meter/main/Client/assets/aion2/maps/hidden_cubes.json)
returned **404** during this investigation. The repository's
[MIT software license](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/2830afc9e5734169d4eba1a26f5906b3ee0f5754/LICENSE)
is not evidence of a separately licensed NCSOFT cube dataset.

## Community upstream: explicit noncommercial license, two distinct datasets

The current repository head inspected was
`89ce3984d569ff1a03ee6311d064231211212981`. Its author expressly separates
GPL-3.0 `/src` from **CC BY-NC 4.0 `/public/data`**, including JSON and other
assets. Redistribution/adaptation is offered for noncommercial purposes with
credit and change notices; commercial rights require author permission.
[Pinned LICENSE](https://github.com/aion2-interactive-map/aion2-interactive-map/blob/89ce3984d569ff1a03ee6311d064231211212981/LICENSE),
[author identification and license split](https://github.com/aion2-interactive-map/aion2-interactive-map/blob/89ce3984d569ff1a03ee6311d064231211212981/README.md).

Directly counted from the public responses on October 22:

- **Committed YAML:**
  [Verteron `public/data/markers/World_L_A.yaml`](https://raw.githubusercontent.com/aion2-interactive-map/aion2-interactive-map/89ce3984d569ff1a03ee6311d064231211212981/public/data/markers/World_L_A.yaml)
  has **118** `hiddenCube` subtype records;
  [Altgard `World_D_A.yaml`](https://raw.githubusercontent.com/aion2-interactive-map/aion2-interactive-map/89ce3984d569ff1a03ee6311d064231211212981/public/data/markers/World_D_A.yaml)
  has **108**. These use individual marker IDs and map-layer XY, rather than
  retaining native group and template identities. The derivative notice
  describes this older upstream convention as 8192-square pixels measured from
  the bottom-left.
- **Live JSON:** [Verteron](https://data-aion2.tc-imba.com/markers/World_L_A.json)
  has **95** cube markers among 3,948 total markers;
  [Altgard](https://data-aion2.tc-imba.com/markers/World_D_A.json)
  has **59** among 3,847. Each root is `{markers: [...]}`; cube records have
  `category: collection`, `subtype: hiddenCube`, XY, Z and generated marker IDs.
  These counts are consistent with one marker per group, but the feed does not
  expose every candidate or prove that interpretation. Live URLs are mutable
  and contain no inspected client-build identifier.

The repository license explicitly names `/public/data`; the live service is
outside that Git path. A derivative author's notice treats the live service as
the same licensed source, but that is not a separate direct license grant from
the live endpoint. Avoid silently extending path-scoped permissions.
[Derivative provenance notice](https://github.com/problem-xyz/aion2-map-overlay/blob/4c8d0ebdde176db0f4e72839942aa9cf1b197a70/NOTICE).

For any accepted CC BY-NC material, retain creator/copyright identification,
source and license links, relevant notices, and an explanation of modifications.
The license grants only rights the licensor controls and does not grant
trademark rights or warrant third-party clearance. The full terms, rather than
“free fan project” status, govern eligibility.
[Creative Commons legal code, sections 1–3 and 5](https://creativecommons.org/licenses/by-nc/4.0/legalcode.en).

## Full projected candidate layer: reference, not the preferred source

At commit `4c8d0ebdde176db0f4e72839942aa9cf1b197a70`, direct filtering of
`nodes` by `categoryId` found **1,440 Verteron** and **1,371 Altgard** cube
candidates:

- [`assets/object-sets/verteron.json`](https://raw.githubusercontent.com/problem-xyz/aion2-map-overlay/4c8d0ebdde176db0f4e72839942aa9cf1b197a70/assets/object-sets/verteron.json)
- [`assets/object-sets/altgard.json`](https://raw.githubusercontent.com/problem-xyz/aion2-map-overlay/4c8d0ebdde176db0f4e72839942aa9cf1b197a70/assets/object-sets/altgard.json)

The notice assigns the adapted object sets CC BY-NC 4.0 while reserving
NCSOFT's underlying rights. It explicitly says the cube layer was replaced
using a separate game-group world-coordinate list; it does not name a public
URL, build or license for that input. The application's own restricted license
must not be mistaken for the dataset's terms, or vice versa.
[NOTICE](https://github.com/problem-xyz/aion2-map-overlay/blob/4c8d0ebdde176db0f4e72839942aa9cf1b197a70/NOTICE),
[application LICENSE](https://github.com/problem-xyz/aion2-map-overlay/blob/4c8d0ebdde176db0f4e72839942aa9cf1b197a70/LICENSE).

Its documented input convention is **`[x, height, z]`**, in a centered world
8160 units across. It projects to an 8192-square layer as
`px = 4096 + x * 8192 / 8160`, `py = 4096 + z * 8192 / 8160`, then stores
top-left percentages rounded to three decimals. This is that author's map
convention, not the packet XYZ convention. Numeric height and template IDs are
absent from the projected candidate records; optional `level` is a relative
height heuristic. Reversing the percentages cannot recover original precision
or height. [Author's input-format/projection documentation](https://github.com/problem-xyz/aion2-map-overlay/blob/4c8d0ebdde176db0f4e72839942aa9cf1b197a70/scripts/import_cubes.py).

## Other sites: terms and coverage checks

**Interactive Map:** the user's
[Altgard reference](https://interactivemap.app/aion2/maps/altgard) is useful for
viewing possible places. Its April 2026 terms expressly forbid scraping,
bulk-downloading map/marker data and reproducing its marker database without
permission. The copyright notice claims its own community marker database and
reserves game assets to their publishers. No marker endpoint was harvested.
[Terms, section 2](https://interactivemap.app/terms/),
[copyright notice](https://interactivemap.app/copyright/).

**Aion2.gg:** its cube page reports **95 groups / 1,440 spots** for Verteron and
**59 / 1,371** for Altgard. It also lists Eltnen **26 / 456** and Morheim
**26 / 455** separately. Its current methodology identifies EU/NA **v2.0.7.0,
Steam build 25926599**, extracted **October 16, 2026**. These are that site's
dated claims, not a build stamp for other datasets. Its terms permit reading
and short attributed citations but expressly prohibit dataset building, bulk
downloads and rehosting; there is no reusable marker API permission here.
[Cube coverage](https://aion2.gg/map/hidden-cubes),
[current data provenance](https://aion2.gg/about/data),
[terms](https://aion2.gg/terms).

**Aion2.dev:** the inspected page identifies a static Steam playtest snapshot,
build **25344886**, extracted **September 16, 2026**, and warns that decoded
content may be internal/unreleased. No cube-specific permissive license or
complete candidate download was established. It is not a current-build
replacement for the installed files. [Author's source/build statement](https://aion2.dev/).

**Cube Radar:** its author says the 3,722 external TH.GL spots used during
experiments were omitted from Git because the license was unclear. This is
evidence of that author's provenance limitation, not permission to obtain those
spots elsewhere. Its Verteron templates **1200039 / 1200041** and hypothesized
Altgard **1301199** concern observed object identification, not a complete
candidate-group/template mapping. Do not assign one template to every group.
[Author's findings](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/docs/FINDINGS.md),
[template evidence levels](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/config/cubes.json).

## Handoff for the independent native extraction

Preserve native group names, each `EnvObjIdList` value, candidate indices and
full XYZ precision. Keep native coordinates distinct from any projected map
coordinates; verify axis order and scale against this app's own validated
position/map transform before distance guidance. Retain the original group even
if two candidates overlap. The public **95/59 groups and 1,440/1,371 candidates**
are useful comparison counts, not a reason to force a native extraction to fit.

Record the installed region/build, source archive/member hashes, extraction
date and independent decoding assumptions beside the produced native dataset.
Reject out-of-bounds/truncated arrays and investigate count differences. Keep
candidate locations separate from observed object lifecycle state. No
third-party companion-app reader, bridge or importer is needed or recommended.

## Validated local extraction

The primary agent subsequently completed and independently validated the original
client extraction on **2026-10-22**. This section records the local result, distinct
from the online research above. No website marker dataset was used as input.

- Installed Steam app: **3393110**, build **26077854**.
- Original archive: `pakchunk401000-Windows_0_P.pak`, **517,220,198 bytes**.
- Archive SHA-256: `c5aae736775f771d9eb3d607bb70e4f45202561c04970b958a397f95ae1f0601`.
- Verteron member SHA-256: `9a03487e39c338f54c9e053b5f0c97127a3115517127719a6ef0b820341acb06`.
- Altgard member SHA-256: `53d6a76c47d548752beae07ea86ed3638e1cd3dbe63123d75abe1d3d0d62e334`.
- Exact member paths are listed above and retained in the catalogue.

The resulting `frontend/src/data/cube-spawns.json` contains **95 Verteron groups /
1,440 unique XYZ positions**, and **59 Altgard groups / 1,371 unique XYZ positions**.
Counts were obtained from the native typed placement arrays, not forced to match
a website. Full double precision, native group IDs and every `EnvObjIdList` entry
(including repeated IDs) are retained. Verteron groups contain object IDs
1200039, 1200040 and 1200041; Altgard groups contain 1301199 and 1301200. This
classification does not itself validate additional live packet signatures.

### Observed binary layout

The independent bounded reader in `scripts/build-cube-spawns.mjs` verifies this
specific client layout rather than claiming to implement the complete MapData
schema. After the repeating whole-file XOR, the initial numeric ID CSV has a
signed 32-bit byte length and **no trailing NUL in this build**. Subsequent
property/group FStrings do include their NUL. This distinction was verified
against both raw members; the public general reader alone was insufficient.

A native group placement is identified by its `EnvObj_...HiddenCube...` or
`EnvObj_...HiddenBox...` name followed by the typed `NpcIdList` array. Bare
reference-table strings with the same names cannot create placements. The
observed struct-array header contains an i32 element count, property-name and
`StructProperty` FStrings, u64 payload size, struct-name FString, 16-byte GUID
and property-GUID flag (with an optional further GUID).

`NpcIdList` is empty in these groups. `EnvObjIdList` uses **four-byte unsigned
TableItemId entries**, confirmed by native element counts and payload sizes;
do not apply the public documentation's general u64-ID claim to these arrays.
After an observed empty i32 field, `Positions` contains `MapData_Position`
records of **48 bytes each: six ordinary little-endian f64 values**, XYZ
location followed by XYZ rotation. No five-byte stride or coordinate projection
is used. Rotation is checked for finiteness and excluded from location output.

All coordinates passed finite-value, array-size, truncation and map-bounds
checks. Native XY uses centimetres, +X east and -Y north, matching this app's
existing calibrated map frame. There are no repeated group names or repeated
XYZ placements within either map. The durable script regenerated the exact
bundled catalogue from the original members, including every coordinate and
source hash. Tooling tests cover precision, location/rotation separation,
reference-table false matches, corrupt/truncated arrays, duplicate groups,
non-finite/off-map positions and the bundled snapshot counts/provenance.

These are **possible client placements**, not observed live objects, server
availability, verified group exclusivity, channel state or respawn predictions.
The underlying game data remains NCSOFT's; extraction does not establish a
separate permissive redistribution grant.
