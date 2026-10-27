# Gathering metadata and native table research

Researched **2026-10-22**, using the original installed Steam AION 2 client,
**app 3393110, build 26077854**. The build was read directly from Steam's
`appmanifest_3393110.acf`. This note owns metadata investigation; map placement
extraction and production implementation belong to the primary task.

## Verified result

All **27 distinct environment-object IDs** used by the primary task's Verteron
and Altgard gathering placements resolve to native gathering definitions,
original English and Brazilian Portuguese names, and original result-item IDs.
The joins use independently decrypted client bytes, not website marker data.
The primary placement output was checked for coverage: Verteron has **130 groups,
2,709 points, 14 IDs**; Altgard has **39 groups, 2,692 points, 13 IDs**. These are
candidate placements, not a server spawn count or a live-availability promise.

The metadata handoff is ignored scratch
`.tools/gathering-research/resources.json`: `{version, provenance, resources,
icons}`. Each resource contains the requested `id`, `category`,
`name: {en, "pt-BR"}`, `icon_key`, and `item_id`, plus a `native` evidence record
with aliases, decoded byte offsets, source IDs, material variants and item
metadata. **Do not bundle the research decoder, manifest keys, raw tables or
scratch source references into the app.** Production consumes an independently
reviewed static catalogue and local artwork only.

Thirteen of fifteen distinct native item-icon keys returned original
**256 × 256 PNGs** from NCSOFT's CDN. Two exact keys returned 404; their four
resources have `icon_key: null` in the handoff and retain written names. Required
skill levels are omitted: a complete property-name mapping was not established.

## Native provenance

Installed archives were read from
`C:/Program Files (x86)/Steam/steamapps/common/AION2/AION2/Content/Paks`.
Extraction used the already installed `repak.exe` under the main checkout's
`.tools/class-color-research/tools/repak`. Its public archive-format configuration
was reused privately from the existing ignored extraction script; no key is
included in this note. `repak unpack` needs an existing output parent. Exports,
decoder scripts and downloaded icons are confined to
`.tools/gathering-research` in the shared worktree.

The manifest is the exact archive member
`Aion2/Content/StartUpData/Table/key_manifest.dat` in
`pakchunk0-Windows.pak`. Gathering definitions, environment objects, item data and
the full localization files below came from
`pakchunk401000-Windows_0_P.pak`, under
`AION2/Content/Data/Table/`. The startup archive also contains small EN/PT
localization tables; those are startup strings, not a replacement for the full
tables in the data patch. The following SHA-256 values hash **raw exported
archive members**, before table decryption.

| Raw member (relative to stated Table directory) |       Bytes | SHA-256                                                            |
| ----------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| Startup: `key_manifest.dat`                     |      36,104 | `d44e94bec85f16d41089cd104f0143cb74ef86eeb5e141d3c180fdab29616963` |
| `EnvObjData.dat`                                |   7,390,634 | `d42b0823809044865e318b7bb9d122c8ef704fdbc9626635e3c3957d3ad6d018` |
| `GatherMastery.dat`                             |       1,108 | `fdbc370ab6fa939addb90f7041686589552825677e832459f7633c5fb0464557` |
| `GatherSkill.dat`                               |       1,668 | `0825fcb9b9fb36fb6855d14bf1f4429884dcf4e40b082d2547c08dcaeb9d3830` |
| `GatherSource.dat`                              |       2,580 | `a92fbf04a102b4e5bfb1d945b7e292a481ead1642ac6893eac0d9029f7d10b74` |
| `GatherSourceMaterial.dat`                      |       1,780 | `ef266d33b4ca830fc8574c9282becb645de3d9532e553a48045bff46aa2e7cb2` |
| `Item.dat`                                      |  17,347,766 | `b272584a93d5f5e366468b48419069e36ccc188189c2028c0f78ade537751a4d` |
| `L10N/en-US/L10NString.dat`                     |   3,748,356 | `4beef8a90b37ece24ec34a4684949ff40fa1f79a61550c7dfef47c63b941bfd9` |
| `L10N/pt-BR/L10NString.dat`                     |   4,481,828 | `3d9f7f121350b60cae1f8a83bc8ab9a671bb3a929c9f94857eea8f1367452fba` |
| `NpcData.dat`                                   |  17,705,795 | `195bef6aac50c366cdb15f8e4a2e604b1cb407bceca5866a7420a9a7d0280254` |
| `Resources.dat`                                 | 166,272,606 | `41bd5dc47cedbbae52174f7b5c9cb338d4cd4975e8f1cc5497bd3ed62d858ef9` |
| `String.dat`                                    |  10,091,496 | `e690d0153bae19b2acf5af2daa5ddfcd22c9d5312f947f3ce7609ab94acfd73c` |

## Container format and independent decoding

The primary public format reference is CUE4Parse at commit
**`990d4d7d4e0340a75a14323436d55568f1415e00`**. This is its maintainer's
implementation, not NCSOFT's official format specification. The scratch decoder
was written independently from the format facts; no reference implementation was
copied into application code.

- `FAion2DataTableFile` recognizes version **13**, decrypts before reading the
  version, comma-separated header IDs and row array, and requires game property
  mappings for general struct deserialization. `EnvObjData` uses the special
  struct name `EnvObjTableItem`.
  [Pinned table reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2DataTableFile.cs).
- The manifest has an eight-byte prefix and encrypted 48-byte entries. A public
  format constant is hashed with BLAKE3 to derive its AES key; each entry gives a
  64-bit seed and 32-byte content key. **736 entries** were recovered from this
  client's manifest. Keys were neither printed nor added to the durable report.
  [Pinned manifest reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2KeyManifestFile.cs).
- A table's seed is derived from its basename, with BLAKE3 header derivation.
  Container type 2 uses AES-256-ECB and an LZ4 block after a 32-byte decrypted
  prefix. Type 3 uses a stream built from AES-encrypted nonce/counter blocks;
  it is **not** MapData's repeating XOR. All four small gathering tables used
  type 2; `EnvObjData`, `Item`, `NpcData`, `Resources` and `String` used type 3.
  Output lengths were checked against their headers.
  [Pinned derivation](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Encryption/Dat/Aion2DatFileEncryption.cs),
  [pinned table container](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Encryption/Dat/Aion2DatFileEncryption.DataTable.cs).
- Table FNames/FStrings can use negative UTF-16 lengths with an additional
  per-string XOR. Structs follow mapping order, not embedded property names;
  nested struct arrays contain type headers. `ItemTableItem` adds different
  subtype fields according to `EItemType`.
  [Pinned string reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2DatFileArchive.cs),
  [pinned property reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2PropertyReader.cs).

No matching `.usmap` was available in this bounded pass. Consequently the
research uses strict, limited record prefixes, typed enum strings and exact
cross-table joins; it does not claim full generic deserialization of `EnvObjData`
or `Item`. Counts from the decrypted table headers are: `EnvObjData` **5,506**,
`GatherSource` **119**, `GatherSourceMaterial` **96**, `GatherMastery` **100**,
`GatherSkill` **21**, and `Item` **9,334**. The `GatherSource` record layout was
traversed for all 119 rows to its **exact 34,040-byte EOF**. Other large-table
prefixes were located through bounded, valid FString records and checked by
their following structure and joins.

## Exact object → source → item → artwork joins

The reliable discriminator is the native enum
**`EEnvObjectUsage::GatherSource`**, not an ID range or a name containing
“gather”. The decoded environment table has **142** such records. Every one
joined a `GatherSource` alias and an EN/PT environment name. The table also
contains basic/prototype and content variants that are not among these maps'
actual placement IDs; the production set must be the intersection with the
primary task's typed map groups.

A relevant environment-object record prefix is:

```text
u32 environment ID
FString environment alias
FString localization name key
FString secondary text field
FString model/resource alias
FString EEnvObjNameplate enum
four-byte scalar
FString EEnvObjectUsage enum
FString usage-specific alias  ← GatherSource.alias when usage is GatherSource
... remainder not fully mapped
```

The model/resource alias denotes the world object and is **not** the item icon.
For example, `Gather_Food_L_Lv1_Vegetable_2` is Kukuru's model resource.
`EEnvObjCategory::None` also appears in genuine gathering records, so that field
must not be mistaken for a food/ore/wood category. Monsters use separate native
NPC records/typed `NpcIdList` placements. Quest/event objects or ordinary
interactables are not admitted without the gathering-usage enum, a valid source
join and actual targeted map placement.

`GatherSource` has an independently traversed ten-field sequence:

```text
u32 ID; FString alias; FString material-group alias;
FString EGatherSourceType; FString EGatherSourceGrade;
i32 scalar; FString field; i32 scalar; FString field; i32 scalar
```

The material-group alias joins the repeated first field of
`GatherSourceMaterial`; its variants expose the exact result item alias. A
result-item alias then joins the native `Item` record prefix:
`u32 ID`, alias, name string key, secondary text, `EItemType`, scalar, grade,
tier, race, **icon resource key**. Ninety-six source-material prefix pairs were
found, and each result alias matched an item among the **92** gathered-material
item prefixes. Variant scalars are retained as raw evidence rather than assigned
unverified reward/quality semantics. The handoff selects the first variant whose
first scalar is 1 for a representative result-item icon; it does not promise
loot quantity, quality or success probability.

Two directly verified examples, offsets measured in the decrypted table bodies:

| Field                      | Verteron example                  | Altgard example                   |
| -------------------------- | --------------------------------- | --------------------------------- |
| Environment ID             | `1500045`                         | `1550041`                         |
| EnvObjData record offset   | `6319494`                         | `6397147`                         |
| Environment alias          | `Gather_Source_Food_L_lv1_06`     | `Gather_Source_Food_D_lv1_02`     |
| Usage                      | `EEnvObjectUsage::GatherSource`   | `EEnvObjectUsage::GatherSource`   |
| Original EN / PT-BR name   | Kukuru / Kukuru                   | Morfa / Morfa                     |
| GatherSource ID            | `1081006`                         | `1091002`                         |
| GatherSource record offset | `12664`                           | `27874`                           |
| Source type                | `EGatherSourceType::Vegetable`    | `EGatherSourceType::Vegetable`    |
| Material group             | `Gather_Source_Food_Common_L_006` | `Gather_Source_Food_Common_D_002` |
| First result item alias    | `Material_Gather_Food_L_c_01b_f`  | `Material_Gather_Food_D_c_01a_f`  |
| Item ID                    | `610680044`                       | `610680049`                       |
| Item record offset         | `16792276`                        | `16796260`                        |
| Native item icon key       | `Icon_Item_Gather_Food_L_c_002`   | `Icon_Item_Gather_Food_L_c_001`   |
| Verified artwork           | unavailable; written name         | original CDN PNG                  |

These facts are measured from the original members identified by the hashes
above; the complete per-record raw evidence is in the scratch handoff.

## Names, categories and requirements

The full localization paths are exactly
`AION2/Content/Data/Table/L10N/en-US/L10NString.dat` and
`AION2/Content/Data/Table/L10N/pt-BR/L10NString.dat` in the patch archive.
Version-2 localization containers use their locale-specific manifest keys,
AES-ECB and LZ4. The decoded payload is version **1**, namespace **`AION2`**,
then a map of ordinary FString keys/values. Both full files yielded **153,185
entries**. Parsing that map leaves four trailing zero bytes; those were retained
without assigning additional semantics.
[Pinned localization encryption](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Encryption/Dat/Aion2DatFileEncryption.L10N.cs),
[pinned localization payload reader](https://github.com/FabianFG/CUE4Parse/blob/990d4d7d4e0340a75a14323436d55568f1415e00/CUE4Parse/GameTypes/Aion2/Objects/FAion2L10NFile.cs).

Node names use the environment record's exact localization key, e.g.
`EnvObjData_Gather_Source_Food_L_lv1_06_desc`. Item names use the item's exact
string alias through `String_<alias>_body`. These are distinct identities: reuse
the item for its artwork, and retain the environment name for the node. Native
PT-BR spellings are preserved, including **Mela → Mella**, **Calendula →
Calêndula**, and **Ohkra → Okra**; no machine translation was needed.

The six app categories deliberately group native types as follows; `aether` is
the agreed application category identifier, while original labels remain
**Odyle / Od**.

| App category | Native source type(s)             | Original EN / PT-BR type labels where present                       |
| ------------ | --------------------------------- | ------------------------------------------------------------------- |
| `aether`     | `Od`                              | Odyle / Od                                                          |
| `ore`        | `Metal`                           | Ore / Minério                                                       |
| `wood`       | `Tree`                            | Log / Tora                                                          |
| `gemstone`   | `Jewelry`                         | Gem / Gema                                                          |
| `herb`       | `Herb`                            | Herb / Erva                                                         |
| `food`       | `Berry`, `Vegetable`, `Shellfish` | Fruit / Fruto; Vegetable / Legume; Aquatic Life / Peixes e mariscos |

Other native source types include `Flower` and `RareMetal`; their inspected type
localization values are `<DNT>` / `DNT`, and they are not among these maps' 27
IDs. Preserve the exact case of localization keys: the native type-string keys
include `herb` and `ShellFish`, unlike the enum spellings.

**Do not derive a required level from `_lv1`/`_lv2` group or object names.**
For example, all four Ore source variants have native grade `Beginner` and the
following scalar **1**, despite their different `_lv` tokens. Across the source
table, grades and that scalar correlate as Beginner/1, Intermediate/100,
Advanced/200 and Expert/300. Correlation is insufficient to name the scalar a
player requirement without the matching schema. `GatherMastery` contains the
progression rows; `GatherSkill` contains skill aliases, name/description keys,
original skill icon paths and condition enums. Neither alone establishes the
requirement of a particular placement. They were decrypted and counted, but
their complete field meanings remain unverified.

## Complete targeted resource mapping

Every row below is joined from original native bytes. Item IDs identify a
representative first material variant, not the map object itself. Distinct
environment IDs remain separate even when they share a node name/result item:
for example **1500043 and 1500061** both represent Cypri and item **610680048**.
`—` means retain the written label because the exact native icon was unavailable.

|  Env ID | Category | Native EN  | Native PT-BR | Source ID | Result item ID | Verified icon key                   |
| ------: | -------- | ---------- | ------------ | --------: | -------------: | ----------------------------------- |
| 1500000 | aether   | Odyle      | Od           |   1080001 |      610610013 | `Icon_Item_Gather_Od_L_lv2_02a`     |
| 1500004 | ore      | Orichalcum | Orichalcum   |   1080101 |      610620013 | `Icon_Item_Gather_Ore_A_c_002`      |
| 1500012 | wood     | Yggdrasil  | Yggdrasil    |   1080301 |      610650011 | `Icon_Item_Gather_Wood_A_c_001`     |
| 1500020 | gemstone | Sapphire   | Safira       |   1080501 |      610660025 | `Icon_Item_Gather_Gemstone_A_c_002` |
| 1500021 | gemstone | Diamond    | Diamante     |   1080502 |      610660026 | `Icon_Item_Gather_Gemstone_A_c_003` |
| 1500022 | gemstone | Ruby       | Rubi         |   1080503 |      610660027 | `Icon_Item_Gather_Gemstone_A_c_004` |
| 1500032 | herb     | Aria       | Aria         |   1080601 |      610670041 | `Icon_Item_Gather_Herb_L_c_001`     |
| 1500033 | herb     | Targena    | Targena      |   1080602 |      610670042 | `Icon_Item_Gather_Herb_D_c_002`     |
| 1500040 | food     | Mela       | Mella        |   1081001 |      610680045 | `Icon_Item_Gather_Food_D_c_003`     |
| 1500041 | food     | Coriolus   | Coriolus     |   1081002 |      610680043 | `Icon_Item_Gather_Food_L_c_001`     |
| 1500042 | food     | Inina      | Inina        |   1081003 |      610680047 | —                                   |
| 1500043 | food     | Cypri      | Cypri        |   1081004 |      610680048 | `Icon_Item_Gather_Food_L_c_006`     |
| 1500045 | food     | Kukuru     | Kukuru       |   1081006 |      610680044 | —                                   |
| 1500061 | food     | Cypri      | Cypri        |   1081004 |      610680048 | `Icon_Item_Gather_Food_L_c_006`     |
| 1550000 | aether   | Odyle      | Od           |   1090001 |      610610013 | `Icon_Item_Gather_Od_L_lv2_02a`     |
| 1550004 | ore      | Orichalcum | Orichalcum   |   1090101 |      610620013 | `Icon_Item_Gather_Ore_A_c_002`      |
| 1550012 | wood     | Asvata     | Asvata       |   1090301 |      610650012 | `Icon_Item_Gather_Wood_A_c_001`     |
| 1550020 | gemstone | Sapphire   | Safira       |   1090501 |      610660025 | `Icon_Item_Gather_Gemstone_A_c_002` |
| 1550021 | gemstone | Diamond    | Diamante     |   1090502 |      610660026 | `Icon_Item_Gather_Gemstone_A_c_003` |
| 1550022 | gemstone | Ruby       | Rubi         |   1090503 |      610660027 | `Icon_Item_Gather_Gemstone_A_c_004` |
| 1550032 | herb     | Azpha      | Azpha        |   1090601 |      610670043 | `Icon_Item_Gather_Herb_D_c_001`     |
| 1550033 | herb     | Calendula  | Calêndula    |   1090602 |      610670044 | `Icon_Item_Gather_Herb_D_c_002`     |
| 1550040 | food     | Raydam     | Raydam       |   1091001 |      610680051 | `Icon_Item_Gather_Food_L_c_003`     |
| 1550041 | food     | Morfa      | Morfa        |   1091002 |      610680049 | `Icon_Item_Gather_Food_L_c_001`     |
| 1550042 | food     | Conide     | Conide       |   1091003 |      610680053 | —                                   |
| 1550043 | food     | Pujery     | Pujery       |   1091004 |      610680054 | `Icon_Item_Gather_Food_L_c_006`     |
| 1550045 | food     | Ohkra      | Okra         |   1091006 |      610680050 | —                                   |

## Original artwork verification and bounded native fallback

Each requested URL was constructed **only from the exact native Item icon key**,
under NCSOFT's original game-data CDN. PNG signature, 256 × 256 dimensions and
SHA-256 were checked; successful originals are saved unchanged under ignored
`.tools/gathering-research/icons`. No generated, tinted or guessed substitutes
were made. Underlying game artwork remains NCSOFT's, separate from the
application's software license.

| Exact native key / official source                                                                                                      | Result                      | SHA-256 of original PNG                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| [Icon_Item_Gather_Od_L_lv2_02a](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Od_L_lv2_02a.png)         | 200, 256 × 256 PNG          | `d36f87ce24606153ed3a6f9509cc7ccaf98585834b60f7c0e3de940170b2e554` |
| [Icon_Item_Gather_Ore_A_c_002](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Ore_A_c_002.png)           | 200, 256 × 256 PNG          | `dd31f162ff1e7401aef7494a9f6f10eae921f289a39da5c3f2f41fd7835988b7` |
| [Icon_Item_Gather_Wood_A_c_001](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Wood_A_c_001.png)         | 200, 256 × 256 PNG          | `9414df0d69122bdb0955369689a9587ffecb02b5ddb0fe8d996ec8ac69920318` |
| [Icon_Item_Gather_Gemstone_A_c_002](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Gemstone_A_c_002.png) | 200, 256 × 256 PNG          | `9e9537b63fe1d802b0628bd19b9d3d656d156e9ccf36a6eca4278203cc364b2c` |
| [Icon_Item_Gather_Gemstone_A_c_003](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Gemstone_A_c_003.png) | 200, 256 × 256 PNG          | `d4375708dfb3a4695dc5ae1413d97bcee04e968b9829dbe823b2be685a508bf9` |
| [Icon_Item_Gather_Gemstone_A_c_004](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Gemstone_A_c_004.png) | 200, 256 × 256 PNG          | `533d3d6f4f1026b3b9bab562fccb23ab3a697df4bf1389250bc65c066536c2e3` |
| [Icon_Item_Gather_Herb_L_c_001](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Herb_L_c_001.png)         | 200, 256 × 256 PNG          | `2507095742d06f3d922ddc89d24c5474135ff3c7b3123acedbe24cbf760ca4d3` |
| [Icon_Item_Gather_Herb_D_c_002](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Herb_D_c_002.png)         | 200, 256 × 256 PNG          | `7aa3c13b68ca3bdd5b1ca53ec6a87f8c975cb0fc1ba4eccd75355b5d21566389` |
| [Icon_Item_Gather_Food_D_c_003](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Food_D_c_003.png)         | 200, 256 × 256 PNG          | `bd3518bdc761db77b12e54f430390041bcec432717c505ebc0ecdb8d145c61fc` |
| [Icon_Item_Gather_Food_L_c_001](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Food_L_c_001.png)         | 200, 256 × 256 PNG          | `88cd8b0cd510e70a4cdb248498ffc926483aa12bb5e1bdd127139c4261fdc098` |
| [Icon_Item_Gather_Food_L_c_005](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Food_L_c_005.png)         | 404; written-label fallback | —                                                                  |
| [Icon_Item_Gather_Food_L_c_006](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Food_L_c_006.png)         | 200, 256 × 256 PNG          | `cd01a06411d5c212224fa6e5268ce31f6f8cec18ca54297cb6d0b62d0c67db9a` |
| [Icon_Item_Gather_Food_L_c_002](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Food_L_c_002.png)         | 404; written-label fallback | —                                                                  |
| [Icon_Item_Gather_Herb_D_c_001](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Herb_D_c_001.png)         | 200, 256 × 256 PNG          | `2eb32b6e10e160a64d65839c4deaaf64e3f0286842857cf014adf17b0f022d32` |
| [Icon_Item_Gather_Food_L_c_003](https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Gather_Food_L_c_003.png)         | 200, 256 × 256 PNG          | `1d139326f35eff16c35be510912adf19323be949583598259250c18bcc339192` |

The two missing exact keys are
`Icon_Item_Gather_Food_L_c_002` (Kukuru/Ohkra) and
`Icon_Item_Gather_Food_L_c_005` (Inina/Conide). Both returned **HTTP 404** on this
date. The existing complete IoStore indexes in the main checkout
(`class-color-research/all.txt`, `paths.txt`, `p.txt`) and its pak inventory
`pakall.txt` contain no case-insensitive match for either exact key. They do
contain nearby verified assets such as `Icon_Item_Gather_Food_L_c_001`, so this
is a bounded absence result for the inspected indexes, not proof that every
possible native alias was exhausted.

The installed `retoc.exe` supports listing/extraction and conversion from Zen
to legacy packages, but is not a PNG texture renderer. No `umodel` executable
was found within current/main `.tools` through depth five. Without a matching
asset path, additional conversion would not establish the missing icon's
identity. Keep the fallback; do not select a similarly named texture. The native
Item keys remain preserved in `native.item_icon_key` for later verified recovery.

## Wire-spawn evidence and limits

Public primary source code documents an **environment spawn** family separately
from NPC spawns and explicitly includes gathering sources. One pinned decoder
reads an entity varint, skips two kind bytes, then reads a **u32 environment
template ID** and f32 XYZ; it looks up gathering metadata by that exact ID. This
supports investigating the existing environment-object path rather than treating
gather nodes as monsters. Its source is evidence of the author's implementation,
not independent validation on our client build.
[Pinned protocol-family description, lines 94–98](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/2830afc9e5734169d4eba1a26f5906b3ee0f5754/Client/Aion2/Protocol/Aion2Protocol.cs#L94-L98),
[pinned environment decoder, lines 927–953](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/2830afc9e5734169d4eba1a26f5906b3ee0f5754/Client/Aion2/Protocol/Aion2FrameDecoder.cs#L927-L953).

An independently authored cube protocol reference for Global build **25800038**
identifies bytes **`34 36`** for environment spawn, **`35 36`** for removal, and
the same entity/kind/template/f32 position prefix. Its validated examples are
cubes, not gathering nodes. No specific numeric **gathering kind/type byte**,
local gathering packet fixture, removal reason meaning for harvested resources,
full-map delivery, channel sharing or respawn interval was validated here.
[Pinned object lifecycle reference](https://github.com/dr89mh/aion2-cube-radar/blob/c9c8497ed03b06f0b281f431e0c1ce6204c7c866/src/CubeRadar.Core/Protocol/ObjectMessages.cs#L14-L47).

Therefore static placement + metadata is ready; a live gathering claim still
needs this app's own capture evidence matching a known environment ID, position
and observed in-game object, plus its harvest/disappearance lifecycle. No wire
reader was implemented by this research task. No website spawn dataset,
third-party application import or runtime bridge was used.

## Verification scope

Verified independently: installed build ID, exact members/hashes, manifest and
table decoding lengths, all 119 source-record boundaries, full EN/PT string maps,
all 27 target ID joins and their native classification, material/item/icon
prefixes, placement-ID coverage, and successful CDN image hashes/dimensions.
Unresolved: full `.usmap` field names, numeric level/skill requirements, complete
material-variant semantics, the two unavailable icon assets, and build-specific
live gathering behavior. No native build, UI edit, commit, stash or reset was
performed. This research's only durable file is this document.
