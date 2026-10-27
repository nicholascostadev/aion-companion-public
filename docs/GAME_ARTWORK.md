# Bundled AION 2 artwork

Class emblems and skill artwork are original game images, delivered locally in
`frontend/public/game-art`. They load from the packaged application without
network requests. General application icons continue to use Lucide.

Every class and skill image is a 256 × 256 PNG from NCSOFT's own CDN,
`assets.playnccdn.com`, archived as lossless WebP (Pillow 13.0.0: `lossless`,
`method=6`, `exact`) in `artwork/originals/game-art`. Each archived file was verified
pixel-identical to the source PNG, alpha included. The app ships a compact encoding of
each (see [Compact delivery](#compact-delivery-of-icons-and-portraits)):

- The nine class emblems come from NCSOFT's character website,
  `/static-aion2/characters/img/class/class_icon_<name>.png`. The official Global
  character metadata identifies Elementalist as Spiritmaster; the Taiwan metadata
  identifies Fighter as Brawler. The asset names are kept in `original_key`, while the
  application uses its existing English class names.
- Skill icons come from NCSOFT's game-data resources,
  `/static-aion2-gamedata/resources/<ICON_…>.png`, under the game's own icon resource
  key (`ICON_CH_SKILL_013`, `ICON_GL_SKILL_Passive_003` …), recorded in `original_key`.

Which icon belongs to which native skill ID was taken from the public AION 2 skill
database; each entry's `reference` (and, where used, `idReference`) records the page.
Six Chanter and Cleric skills missing there were matched through NCSOFT's Taiwan
Guidebook by localized skill name; their guide images are pixel-identical to the
game-data resources now bundled. No image comes from a third-party host.

Sources checked on 2026-10-19:

- [Official Global character page](https://aion2.plaync.com/en-us/characters/index)
- [Official Global class metadata](https://aion2.plaync.com/en-us/api/gameinfo/pcdata?lang=en&region=eu)
- [Official Taiwan class metadata](https://tw.ncsoft.com/aion2/api/gameinfo/pcdata?lang=zh)
- [Official Taiwan Guidebook](https://tw.ncsoft.com/aion2/guidebook/index)
- NCSOFT game-data resources, e.g.
  [`ICON_AS_SKILL_001`](https://assets.playnccdn.com/static-aion2-gamedata/resources/ICON_AS_SKILL_001.png)

`frontend/src/data/game-art.json` (version 4) records each image's source URL, resource key,
reference page, the SHA-256 of the PNG as served (`source_sha256`), the archived lossless
original's file, hash and size (`original`), and the delivered WebP's file, hash, size and
PSNR (`file`, `sha256`, `width`, `height`, `psnr_db`). The bundle contains nine class icons
and 470 skill entries (376 distinct images: a few skills share one icon, and NCSOFT
serves identical bytes for two pairs of keys). Another 5,136 variant IDs explicitly
refer to those entries only when their names and classes match the native catalogue.
The UI never rounds an unknown ID to a nearby skill or substitutes a class emblem for a
missing skill image. Unknown or unavailable artwork keeps its written label.

`npm run check:art` (`node scripts/check-game-art.mjs`) requires every class and skill
source to be the NCSOFT host and path for its recorded key, with no query, and checks
each delivered and archived image (see Compact delivery), bundle completeness and variant
identities. No downloaded HTML is included.

Artwork copyright remains with NCSOFT / NC Corporation. Source images are bundled
without repainting or generated replacements (only the re-encodings described here) and
are separate from the software and Lucide icon licenses.

## Compact delivery of icons and portraits

The verified originals of the class and skill icons, the pet portraits and the resource
icons are archived unchanged under their hash names in `artwork/originals/game-art`,
`artwork/originals/pet-art` and `artwork/originals/resource-art`. These folders are tracked
but outside the Vite root, so they are never bundled or installed. The app ships a smaller
encoding of each, made by `scripts/build-compact-art.mjs` with the same pinned encoder as the
maps: sharp 0.35.5 (libvips 8.18.7, libwebp 1.6.0), lossy WebP at effort 4 with 4:2:0 chroma,
alpha kept lossless and dropped only from fully opaque images, and Lanczos-3 resampling
where the size changes. Nothing is cropped, recoloured, repainted or generated.

| Set                       | Drawn at (CSS px)                           | Delivered      | Archived  | Delivered size | Lowest PSNR |
| ------------------------- | ------------------------------------------- | -------------- | --------- | -------------- | ----------- |
| Class and skill icons     | 14–44 typical; tracker bars allow up to 128 | 128 × 128, q90 | 29.938 MB | 1.999 MB       | 28.75 dB    |
| Pet portraits             | up to about 230 (collection cards)          | 256 × 256, q85 | 28.562 MB | 5.526 MB       | 24.03 dB    |
| Odyle, cube and gathering | 28 or less; map glyphs about 14–30          | 128 × 128, q90 | 1.104 MB  | 0.117 MB       | 34.87 dB    |

PSNR is measured on colour premultiplied by alpha plus alpha, so colour hidden under fully
transparent pixels is not counted; each set's floor (28, 23 and 33 dB) sits just below its
measured minimum. The pet type emblems (about 21 KB) are unchanged.

The choices were checked visually on representative samples, compared with the originals:

- Icons at their usual 44 CSS px on a 2× display show no visible difference. At the tracker
  bar maximum of 128 CSS px on a 2× display (upscaled from 128 px) fine engraving, such as
  class emblem and shield filigree, is slightly softer than the original.
- Portraits keep their native 256 px because the collection cards draw them at about 230
  CSS px, beyond 256 device pixels at 1.5× scaling already. Quality 85 is visibly closer to
  the original than 80 in 4× crops. The lowest-PSNR portraits (saturated, fine-grained
  textures such as Papis, Rafflesia and Fire Elemental) show softened saturated colour edges
  in 4× crops; at their real drawn size this was judged acceptable.

Each manifest (`game-art.json` version 4, `pet-art.json` and `resource-art.json` version 2)
records the pinned settings under `delivery`, and per entry the delivered file and the
archived `original` (file, SHA-256, size and format). Provenance fields (key, source URL,
`source_sha256`, native package) are unchanged. `npm run check:art` requires every delivered
file to match its hash and hash name, be a lossy WebP of the set's size, be smaller than its
original and meet the PSNR floor; every archived original to match its hash, format and
256 × 256 size; and both folders to contain exactly the manifest's files. The pixel-level
proof is the generator's `--check`, which re-encodes every original to the exact delivered
bytes:

```sh
node scripts/build-compact-art.mjs            # write delivered files and manifests
node scripts/build-compact-art.mjs --check    # re-encode and require byte-identical output
```

It uses the same tool installation as the map generator (see below).

## Odyle energy

The DPS meter's energy symbol is NCSOFT's original `Icon_Item_Odenergy_A_001`,
downloaded unchanged from the official game-data CDN on 2026-10-21. Its 256 × 256
PNG is archived in `artwork/originals/resource-art` and delivered compact under
`frontend/public/resource-art`. The resource key, source URL, original and delivered
checksums and dimensions are recorded in `frontend/src/data/resource-art.json` and
checked by `npm run check:art`. The footer retains a translated accessible
name and falls back to that written name if the image cannot load.

## Hidden Cube

Cube Finder uses NCSOFT's original **`P_Img_HiddenCube_01_V04`** red Hidden Cube
artwork, downloaded unchanged from the
[official game-data CDN](https://assets.playnccdn.com/static-aion2-gamedata/resources/P_Img_HiddenCube_01_V04.png)
on **2026-10-22**. This exact resource name appears in the original client package
`AION2/Content/UI/Resource/Texture/Item/ETC/P_Img_HiddenCube_01_V04.uasset`;
the pinned native format notes name the same variant in the internal cube object
key `E_HiddenCube_01_V04_001`. It is not a recreated icon or a third-party
site's marker graphic.

The original **256 × 256 PNG** is archived unchanged as
`artwork/originals/resource-art/f01315b4bca8d639123d.png`. Its SHA-256 is
`f01315b4bca8d639123d152088f78541933137d543ec0d1b85163d74181e0c7b`, which
`npm run check:art` pins. The app ships its compact encoding (see Compact delivery),
without cropping or recolouring. `frontend/src/data/resource-art.json` records the
resource key, official source, native package path, date, and the original and delivered
files, checksums and dimensions; `npm run check:art` validates all of them. It loads offline
from the packaged app, just like the other original game icons. Underlying
artwork remains NCSOFT's and is separate from the software and Lucide licenses.

## Gathering resources

The Gathering Finder uses thirteen original 256 × 256 item PNGs from NCSOFT's
game-data CDN, archived unchanged and delivered compact like the other icons. Keys come from the original installed client's
EnvObjData → GatherSource → GatherSourceMaterial → Item joins, not a visual
guess. `resource-art.json.gathering` records each exact key, native texture
package, source URL, checksum, dimensions and verification date. `check:art`
checks those native joins and bundled bytes. The two unavailable exact keys
remain written-label fallbacks; no alternative artwork is invented. See
[gathering research](GATHERING_RESEARCH.md) for all resource and image records.

## Pet spawn maps

The Cube and Gathering Finders also use these map canvases and their existing
calibration. Reusing the textures for another marker layer does not change their
provenance or introduce a website dependency.

The three farming maps use original Texture2D map artwork exported directly from the
installed AION 2 Steam client (app 3393110, build 25926599), checked on 2026-10-19.
The source packages are under `AION2/Content/UI/Map/WorldMap/<key>/Res/`.
The base-colour textures retain the game's painted terrain, sea and parchment; fog,
masked textures and transparent path overlays are excluded.

| Farming map            | Original texture keys             | Grid                      | Native canvas |
| ---------------------- | --------------------------------- | ------------------------- | ------------- |
| Verteron               | `World_L_A_<column>_<row>`        | 8 × 8 tiles, 2048 px each | 16384 × 16384 |
| Altgard                | `World_D_A_<column>_<row>`        | 8 × 8 tiles, 1024 px each | 8192 × 8192   |
| Chaotic Lower Reshanta | `Abyss_Reshanta_A_<column>_<row>` | 4 × 4 tiles, 1024 px each | 4096 × 4096   |

These replace the 1125 × 1125 Taiwan Guidebook sheets. The added detail comes from
original client textures, without upscaling or generated artwork. Both tile indices
are zero-based: the first is the column (+X), the second the row (+Y).
Every tile is delivered, including sea, so panning across the canvas never reveals a gap.

Extraction used UE Viewer build 1579 based fix291 (Unreal Engine 5.3, PNG export).
Pillow 13.0.0 re-encodes those PNG exports as lossless WebP (`lossless`, `method=6`,
`exact`); each decoded RGBA image was compared byte-for-byte with its exported source.
These lossless originals are kept, unchanged and under their original hash names, in
`artwork/originals/pet-map-art`. That folder is tracked but outside the Vite root, so it
is never bundled or installed.

**Delivery encoding.** The delivered art is a lossy WebP of each original at its full native
size, with the same tile grid, canvas registration and calibration. Nothing is cropped,
rescaled, repainted or generated. `scripts/build-map-art.mjs` decodes each archived
original, checks its file and RGBA checksums and that it is opaque, then encodes it with
sharp 0.35.5 (libvips 8.18.7, libwebp 1.6.0) at quality 95, effort 6, 4:2:0 chroma,
default preset, without alpha or metadata. The delivered files are written under their
own hash names to `artwork/delivery/pet-map-art`, also outside the Vite root. Every delivered image must reach at least 39 dB RGB PSNR against its
original; the lowest is 39.99 dB and most are around 45 dB. The 147 map images drop from
141.452 MB to 44.549 MB.

Quality 95 was chosen over 90 (27.07 MB, lowest 37.86 dB) after comparing crops from the
most detailed tiles of each map and an overview at native, 3× and 4× scale. 4× is the app's
maximum magnification (`MAX_ART_UPSCALE`). At 3× and 4×, quality 90 visibly softens fine
terrain texture and small saturated markings. Quality 95 keeps the original texel structure,
with only slight softening of the smallest saturated colour details.

`frontend/src/data/pet-map-art.json` version 4 records the client build, original package
path and texture key, exported PNG hash (`source_sha256`), the archived original's file
and hash (`original`), its decoded RGBA hash (`rgba_sha256`, of the lossless original),
the delivered WebP's file and hash (`file`, `sha256`), delivered PSNR (`psnr_db`),
dimensions, grid position and map membership. `provenance.delivery` pins the encoder and
settings. The app never extracts assets from the game.

**Download on first use.** Map art is not inside the installer. The release builds one
content-hashed pack per map from `artwork/delivery/pet-map-art` and the manifest, published as
assets of the same GitHub release; together they are the 44.549 MB above, downloaded
separately and never shipped inside Setup. The first time a map's art is actually shown (not
at startup, nor for a hidden map, tab or window) the app asks native to ensure it
(`map_art_ensure`): native verifies its cache or downloads and verifies that map's pack once,
shared by every window, and the view polls `map_art_status` while the map is visible. Until
the art is ready the view draws the coordinate chart on the art's own canvas, so marks, pans
and zooms stay where they are, with a short notice (downloading with progress, or failed with
Retry). Cached maps work offline after a restart. Images load through native's `map-art`
protocol by hash file name only; it serves only verified cached files and reports a corrupted
file as failed, so the view shows Retry instead of a broken image. The frontend side is
`services/mapArt.ts` (commands and URLs), `hooks/mapArtStore.ts` (one shared state per map
per window, provided by `main.tsx`) and `features/maps/mapArt.ts` (what a map view reads).
For the browser preview, the Vite development server answers `/pet-map-art/<hash>.webp` for
manifest files only (never in a build); `?mock=maps-download` and `?mock=maps-error` fake a
first download and a failed one.

Regenerating the delivered files needs the pinned encoder, which is deliberately not a
project dependency. Install it once into the ignored tool folder and run the generator
from the repository root:

```sh
npm install --prefix .tools/size-lab --no-save --no-package-lock sharp@0.35.5
node scripts/build-map-art.mjs            # write delivered files, manifest and catalogue references
node scripts/build-map-art.mjs --check    # re-encode and require byte-identical output
```

`--sharp <path to sharp/dist/index.mjs>` selects another installation. The script
refuses any sharp, libvips or libwebp version other than the pinned one, because the
output bytes depend on the encoder. It rewrites only the manifest and the
`/pet-map-art/` references in `crates/companion-capture/data/pet-catalogue.json`.
Neither `npm run build` nor the app runs it. Size budgets are enforced separately: map art
in the bundle 0 MB, all of `frontend/public` 8 MB, built `dist` 11 MB, and the Setup
installer 15 MB.

Each map also has a 2048-pixel overview made by averaging aligned integer blocks of
the original tiles (BOX resampling), then encoding that result as lossless WebP. The
lossless overview is archived alongside the tiles, and its delivery encoding is made
exactly like the tiles'.
The overview and full tiles share the same canvas registration. Wider views use the
overview; close views use the visible native tiles, keeping decoded image memory
bounded without sacrificing terrain detail at close zoom. The manifest records
overview hashes and dimensions separately from original texture provenance.

**Calibration.** The main-world canvases are centered on the world origin and span
819200 world units; Lower Reshanta spans 409600. Thus `pixel = canvas / 2 + scale × world`,
with scales 0.02 (Verteron), 0.01 (Altgard) and 0.01 (Lower Reshanta). +Y points down.
The previous off-center extents (~836622 and ~833983 units for the main worlds) pulled
coastal markers inward. The centered calibration was checked by overlaying native
spawn coordinates on the original textures, including the small western Verteron
island, the main worlds' south-west islands and the Abyss island groups. Terrain
alignment is a visual calibration check, not a claim that every source monster is
on dry ground; native spawn coordinates remain unchanged.

The manifest and `npm run check:art` lock all three canvas transforms. The check also
verifies original texture paths, a complete grid, unique cells, and every catalogue
tile's exact position. Without decoding images, it checks that each archived original
still matches its recorded hash, is lossless WebP at the native size and is referenced
exactly once. Each delivered file must match its recorded hash and hash name, be a single
opaque lossy `VP8 ` key frame (no alpha, animation or metadata chunks, no upscaling) at
the native size, and be smaller than its original. Its recorded PSNR must meet the 39 dB
floor, and the pinned delivery settings must be unchanged. Both folders must contain exactly the
manifest's files. No map file may be in `frontend/public`, and with `--dist` (after
`vite build`) none may be in `dist` either. `node scripts/build-map-art.mjs --check`
supplies the pixel-level proof. It decodes every original against `rgba_sha256` and
re-encodes it to the exact delivered bytes. Frontend regression checks cover projected
coastal spawn positions, round trips and map zoom. Other catalogue maps retain their
parchment coordinate chart when they have no original artwork.

Artwork copyright remains with NCSOFT / NC Corporation. The delivered files are
compressed re-encodings of the original textures, not altered or substitute artwork. The
[official AION 2 Steam listing](https://store.steampowered.com/app/3393110/AION_2/)
identifies the client source; it is not a texture download endpoint.
