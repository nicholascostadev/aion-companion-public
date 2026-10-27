# Class colour research

Verified on 2026-10-22 from the user's Windows computer. Web checks used ordinary
unauthenticated HTTPS GET requests. Client checks read the installed AION 2 Steam
client (app 3393110, build 26077854, manifest `LastUpdated` 2026-10-21T08:39:51Z)
without modifying it. Temporary tools, extracted assets and scripts are under the
ignored `.tools/class-color-research/`; nothing extracted is checked into this repository.

## Conclusion

**No game-defined per-class palette was verified in the sources checked.** None of
the nine classes has a colour encoded by NCSOFT in those sources. The inspected party
UI identifies classes by their **emblem icons**; this does not rule out a palette in
uninspected or inaccessible sources:

- The official websites encode no class colour in their CSS, JS or JSON.
- The client's central UI colour DataTable (`UI_ColorTable`, 328 `FLinearColor` rows)
  has no class rows.
- No UI widget or DataTable in the client declares a class colour or tint.
- Every class emblem, on the web and in the client, is drawn in the same gold and
  silver metal (median hue 36–41°), so sampling the emblems cannot tell classes apart.

A per-class palette chosen without further game evidence would be **an application
design choice** and must not be presented as the game's. The first-party result table
lists no hex values for this reason. The application palette described below is a design choice, not evidence of
an official game palette.

The game's own encoded colours that a DPS meter could reuse honestly are listed under
[Usable encoded colours](#usable-encoded-colours-not-class-colours).

## 1. Official websites (encoded colours)

Fetched live on 2026-10-22 with a desktop browser `User-Agent`, without cookies:

| URL                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://aion2.plaync.com/en-us/characters/index` (also `ko-kr`, and `https://tw.ncsoft.com/aion2/characters/index`)                                  | Loads `static-aion2/characters/css/index.css?_=202610061429` (SHA-256 `d5990516…2448`) and `js/index.js` (SHA-256 `2ae10f0b…1354`). The only class selectors are `.daevanion-board__node--start-<class>`, which set a `background-image`, not a colour. The JS builds `img/class/class_icon_${className.toLowerCase()}.png`. Its only hex literals are `#ff4b4b #e0e0e0 #61d345 #616161 #363636` (toast/status UI). The custom properties are `--grade-color-0…7`, `--title-grade-color-0…7` and `--color-primary`; none of them is per class. |
| `https://aion2.plaync.com/en-us/api/gameinfo/pcdata?lang=en&region=eu`, `https://tw.ncsoft.com/aion2/api/gameinfo/pcdata?lang=zh`                     | `pcDataList` fields are only `className, classText, genderName, id, raceName`. There is no colour.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `https://aion2.plaync.com/en-us/api/gameinfo/classes?lang=en&region=eu`, `https://tw.ncsoft.com/aion2/api/gameinfo/classes?lang=zh`                   | `classList` fields are only `id, name, text`. There is no colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/en-us/about/index`, `/ko-kr/about/index`, `https://tw.ncsoft.com/aion2/about/index` and their `static-about-game/…/style.css` and `main.js`         | These pages contain no class names (English, Korean or Chinese) and no class selectors.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `static-nc-home/2.8.5/css/nc-home-aion2global.css`, `nc-home-aion2.css`, `js/nc-home.js`                                                              | These files contain no class references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Taiwan Guidebook class articles `https://tw.ncsoft.com/aion2/api/v2/aion2tw/guide/<class>` (劍星, 守護星, 弓星, 殺星, 魔道星, 精靈星, 治癒星, 護法星) | The only colour is the cover's `background-color: transparent`. The class skill articles use one shared highlight, `rgb(247, 218, 100)`, for every class. That is editorial emphasis, not class identity.                                                                                                                                                                                                                                                                                                                                      |
| `https://aion2.plaync.com/en-us/ranking/index`, `/en-us/guidebook/index`                                                                              | Both redirect to a 404. The Korean ranking URL redirects to the characters page. No official ranking or stat-chart page with class colours was found.                                                                                                                                                                                                                                                                                                                                                                                          |

## 2. Game client data (encoded colours)

**Method.** The `.utoc` containers carry flags `0xF` (compressed, encrypted, signed,
indexed) and a zero key GUID. They were read with the community-documented AES-256
client key, which is not reproduced here. Two portable CLIs were used, each checked
against its published SHA-256:

- [retoc v0.1.5](https://github.com/trumank/retoc/releases/tag/v0.1.5)
  (`cc036b06…63aa`), for IoStore: `list --path --size` and
  `to-legacy --version UE5_3 -f <filter>`.
- [repak v0.2.3](https://github.com/trumank/repak/releases/tag/v0.2.3)
  (`6720d602…73fa`), for legacy `.pak` listing. It could not parse
  `pakchunk0-Windows_0_P.pak` and listed the other 266.

Together they covered 444,100 IoStore `.uasset` paths and 105,256 `.pak` entries.
Packages use unversioned properties (`PKG_UnversionedProperties`), so only name maps
and fixed layouts were decoded. No `.usmap` was available.

**Path search.** No asset path contains `ClassColor`, `Class_Color`, `JobColor` or a
similar name. Class-related UI assets are icons only:

- `UI/Resource/Sprite/Common/UT_Common_Icon_Class_<Class>_Sprite`
- `UI/Resource/Texture/Icon/UT_Class_<Class>_Large`
- `UT_Common_Slot_Restrict_Class<Class>_Sprite`
- `UT_Common_Icon_ClassBG_{Normal,Conqueror}{S,B}_Sprite`, a background that differs
  by Conqueror status, not by class.

**`/Game/UnrealData/UI_ColorTable`** (container `pakchunk200000-Windows_0_P`; legacy
`.uasset` SHA-256 `05a01339…69b1`, `.uexp` `ccc3d755…675a`) is a `DataTable` of
`UIColorDataRow`. It has 328 rows. Each row is an `FName`, an unversioned header and one
`FLinearColor` (four little-endian floats). The decoder consumed the export exactly to
its package tag (8,527 + 4 = 8,531 bytes). Its row names cover:

- item grades and nameplates
- chat types and party/force state
- faction (Light/Dark) tags, elemental summons and gauges

**No row names a class.** The legacy name map has no class name, and no
`ECharacterClass` reference.

**Widgets.** All 1,710 `UI/Widget/**` packages and 39 `UnrealData/UI_*` tables were
converted. No name map contains `ClassColor`, `Class_Color`, `JobColor`, `ColorByClass`
or `ClassTint`.

- **Party frame.** `HUD_PartyListItem` / `HUD_ForcePartyListItem` show the class as
  `P_Img_Class` (designer default `UT_Common_Icon_Class_Gladiator_Sprite`) over
  `P_WS_ClassBG` (Normal/Conqueror). They have no class-dependent colour.
- **Damage meter.** The in-game meter, `Popup_DamageMeter_Tooltip`
  (`AionWidget_HUD_DamageAnalyzer`) and its list items, is a single-player analyser:
  battle time, total damage/DPS, skill list, target and hit-type counts. It has no
  per-member rows and no class colours.
- **`UI_HudEditDataTable`.** This references `ECharacterClass::<Class>` for HUD-layout
  presets only.

**Not pursued.**

- **`AION2/Content/Data/Table/*.dat`** (for example `PcData.dat`, 2,420 bytes, in
  `pakchunk401000-Windows_0_P.pak`). These tables use a second, custom encryption: an
  `i32 13` header and keys derived through BLAKE3 from a `key_manifest.dat`, as
  implemented in CUE4Parse's `Aion2DatFileEncryption`. Decoding them also needs row
  schemas. They are server design data, not UI styling, and the UI's own colour table
  has no class rows. The effort was judged not worthwhile.
- **`AION2.exe`** (156,609,312 bytes). Its strings are packed: a scan for known type
  names (`UIColorDataRow`, `ECharacterClass`) finds nothing. Hard-coded native colours
  therefore cannot be ruled out statically. This is the one remaining uncertainty.

## 3. Class emblem artwork (sampled)

The source images are:

- the nine bundled web emblems (`frontend/public/game-art`, provenance in
  [GAME_ARTWORK.md](GAME_ARTWORK.md));
- the client's `UT_Class_<Class>_Large` textures, decoded from the legacy `.uexp`.
  These are `PF_DXT5`, 256 × 256, with 65,536 bytes of mip 0 starting 20 bytes after
  the `PF_DXT5` name. They were wrapped in a DDS header and decoded with Pillow 13.0.0.

**Statistic.** Only pixels with alpha ≥ 200 are kept. For each emblem the method reports
the mean sRGB, the median HSV hue of pixels with saturation ≥ 0.1, the median saturation,
and the share of pixels with saturation ≥ 0.35. The script is
`.tools/class-color-research/scripts/emblem_stats.py`.

| Class        | Web emblem mean / hue / sat | Client icon mean / hue / sat |
| ------------ | --------------------------- | ---------------------------- |
| Gladiator    | `#beab88` / 37.1° / 0.30    | `#d9d2c4` / 38.1° / 0.07     |
| Templar      | `#a39374` / 37.5° / 0.29    | `#c6bdae` / 37.2° / 0.07     |
| Ranger       | `#bdae94` / 37.3° / 0.24    | `#ded6c7` / 39.3° / 0.07     |
| Assassin     | `#b3a387` / 36.3° / 0.28    | `#ddd3c2` / 37.1° / 0.09     |
| Sorcerer     | `#af9f83` / 36.5° / 0.27    | `#d7cebc` / 38.2° / 0.10     |
| Elementalist | `#a7977e` / 36.0° / 0.26    | `#cbc4b6` / 38.2° / 0.07     |
| Cleric       | `#ab9c83` / 36.3° / 0.26    | `#d6ccbb` / 36.0° / 0.09     |
| Chanter      | `#b1a186` / 35.8° / 0.25    | `#d1c8b9` / 38.2° / 0.08     |
| Fighter      | `#d6ccb7` / 40.6° / 0.12    | `#e3dccf` / 39.1° / 0.07     |

Every emblem is the same gold/silver metal, within 5° of hue. These are **sampled
values that describe the shared emblem style**, not class colours, and must not be used
as a class palette.

## 4. First-party screenshots and video

No screenshots or video were sampled. The client shows that party and force frames
identify a class only by its emblem sprite over a Normal/Conqueror background. Sampling
an official screenshot would therefore only recover the same gold emblem.

## Usable encoded colours (not class colours)

These `UI_ColorTable` rows are encoded by NCSOFT. sRGB values use the standard
linear→sRGB transfer, which is what UE's `ToFColor(true)` applies.

| Row                                                         | `FLinearColor` (R, G, B, A)           | sRGB                                                        |
| ----------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `List_My`                                                   | 0.7305, 0.4564, 0.1529, 1             | `#deb46d`                                                   |
| `List_Other`                                                | 1, 1, 1, 1                            | `#ffffff`                                                   |
| `Quest_RaceTag_Light`                                       | 0.0762, 0.4910, 0.4678, 1             | `#4ebab6`                                                   |
| `Quest_RaceTag_Dark`                                        | 0.2384, 0.0762, 0.4910, 1             | `#864eba`                                                   |
| `AbyssArtifact_Text_Light` / `_Dark`                        | 0.0110, 0.7682, 1 / 0.8469, 0.0497, 1 | `#1be3ff` / `#ed3fff`                                       |
| `Common` / `Rare` / `Legend` / `Unique` / `Epic` / `Mythic` | item grades                           | `#c3c3c3` `#19e048` `#379aff` `#ffd02b` `#ff6c00` `#ff3245` |

`List_My` / `List_Other` (gold for your own row, white for others) match a DPS meter's
"me versus party" distinction. The faction rows separate Light and Dark, **not classes**.
The grade palette already means item rarity in game, so reusing it for classes would
mislead players.

## Result by class

| Class (official Global name) | Verified colour | Provenance | Sources checked                                                                                   |
| ---------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| Gladiator                    | none            | —          | official site CSS/JS and APIs (§1); client `UI_ColorTable`, widgets, UI tables (§2); emblems (§3) |
| Templar                      | none            | —          | same                                                                                              |
| Ranger                       | none            | —          | same                                                                                              |
| Assassin                     | none            | —          | same                                                                                              |
| Sorcerer                     | none            | —          | same                                                                                              |
| Elementalist (Spiritmaster)  | none            | —          | same                                                                                              |
| Cleric                       | none            | —          | same                                                                                              |
| Chanter                      | none            | —          | same                                                                                              |
| Fighter (Taiwan: Brawler)    | none            | —          | same                                                                                              |

Light and Dark characters share the same class keys and emblems in the inspected
sources; no per-class colours were verified there. Faction-level colours were verified
(above). Community sites and other meter tools were excluded from this first-party
investigation.

## 5. Applied class palette

The existing class tokens in `frontend/src/styles/theme.css` retain their
selected palette. Those values were selected by comparing a third-party desktop
distribution, version 4.2.11 (executable SHA-256
`4678f3b66d8c07f0353dda02577382f96e36e3ac2031a3000090b71934542ad3`).
This is an application design choice; it is not an official NCSOFT palette or
a claim of independently discovered game-defined class colours. No implementation
or renderer from that distribution is bundled.

Every player of a known class uses the same token. Spiritmaster uses the
selected fallback colour, while an unknown or hidden class uses `class-unknown`
(ink-4). The own-player override and secondary colours from the reference are
not used.

| Class             | Token                | Value                |
| ----------------- | -------------------- | -------------------- |
| Gladiator         | `class-gladiator`    | `#8e44ad`            |
| Templar           | `class-templar`      | `#e67e22`            |
| Ranger            | `class-ranger`       | `#d4a017`            |
| Assassin          | `class-assassin`     | `#40c070`            |
| Spiritmaster      | `class-spiritmaster` | `#7dd8d8`            |
| Sorcerer          | `class-sorcerer`     | `#2980b9`            |
| Cleric            | `class-cleric`       | `#1abc9c`            |
| Chanter           | `class-chanter`      | `#f1c40f`            |
| Brawler           | `class-brawler`      | `#c0392b`            |
| Unknown or hidden | `class-unknown`      | `var(--color-ink-4)` |
