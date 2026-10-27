import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const manifest = await readJson('frontend/src/data/game-art.json');
const petMapArt = await readJson('frontend/src/data/pet-map-art.json');
const petCatalogue = await readJson('crates/companion-capture/data/pet-catalogue.json');
const petArt = await readJson('frontend/src/data/pet-art.json');
const petTypeArt = await readJson('frontend/src/data/pet-type-art.json');
const resourceArt = await readJson('frontend/src/data/resource-art.json');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
/**
 * Compact deliveries of the original icons and portraits (`scripts/build-compact-art.mjs`).
 * Each set's settings are pinned here; that script's `--check` proves the delivered bytes are
 * the reproducible encoding of the archived originals.
 */
const compactCommon = {
  generator: 'scripts/build-compact-art.mjs',
  encoder: 'sharp 0.35.5 (libvips 8.18.7, libwebp 1.6.0)',
  format: 'lossy WebP (VP8), lossless alpha, opaque images without alpha',
  resize: 'lanczos3',
  effort: 4,
  chroma_subsampling: '4:2:0',
};
const COMPACT = {
  'game-art': { version: 4, original: 'lossless WebP (VP8L)', size: 128, quality: 90, min: 28 },
  'pet-art': { version: 2, original: 'PNG', size: 256, quality: 85, min: 23 },
  'resource-art': { version: 2, original: 'PNG', size: 128, quality: 90, min: 33 },
};
/** Delivered and archived files seen per set, by file name. */
const compactSeen = Object.fromEntries(
  Object.keys(COMPACT).map((name) => [name, { delivered: new Map(), originals: new Map() }]),
);
function verifyCompactManifest(name, json) {
  const set = COMPACT[name];
  const delivery = {
    ...compactCommon,
    size: set.size,
    quality: set.quality,
    min_psnr_db: set.min,
    archive: `artwork/originals/${name}`,
  };
  if (json.version !== set.version || JSON.stringify(json.delivery) !== JSON.stringify(delivery))
    throw new Error(`Unknown ${name} manifest version or delivery`);
}
/**
 * One compact entry: its delivered file in `frontend/public/<set>` is a lossy WebP of the
 * set's size whose recorded fidelity meets the pinned floor, smaller than its original; the
 * original, archived outside the bundle, still matches its checksum, format and 256 px size.
 */
async function verifyCompact(name, entry, label) {
  const set = COMPACT[name];
  const original = entry.original;
  const originalFile = set.original === 'PNG' ? /^[a-f0-9]{20}\.png$/ : /^[a-f0-9]{20}\.webp$/;
  if (
    !/^[a-f0-9]{20}\.webp$/.test(entry.file ?? '') ||
    !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') ||
    !entry.file.startsWith(entry.sha256.slice(0, 20)) ||
    entry.width !== set.size ||
    entry.height !== set.size ||
    !original ||
    !originalFile.test(original.file ?? '') ||
    !/^[a-f0-9]{64}$/.test(original.sha256 ?? '') ||
    !original.file.startsWith(original.sha256.slice(0, 20)) ||
    original.width !== 256 ||
    original.height !== 256 ||
    original.format !== set.original ||
    typeof entry.psnr_db !== 'number' ||
    !(entry.psnr_db >= set.min) ||
    !(entry.psnr_db < 100)
  )
    throw new Error(`${label}: invalid compact delivery record`);
  const seen = compactSeen[name];
  const known = seen.delivered.get(entry.file);
  if (known) {
    if (known.sha256 !== entry.sha256 || known.original !== original.sha256)
      throw new Error(`${label}: one delivered file with two identities`);
    return;
  }
  const bytes = await fs.readFile(path.join(root, 'frontend/public', name, entry.file));
  const size = webpSize(bytes);
  if (
    sha(bytes) !== entry.sha256 ||
    !size ||
    size.width !== entry.width ||
    size.height !== entry.height ||
    !['VP8 ', 'VP8X'].includes(bytes.toString('ascii', 12, 16)) ||
    !bytes.includes(Buffer.from('VP8 '))
  )
    throw new Error(`${label}: delivered file is not its recorded lossy WebP`);
  const source = await fs.readFile(path.join(root, 'artwork/originals', name, original.file));
  const sourceSize =
    set.original === 'PNG'
      ? source.subarray(0, 8).equals(PNG) && {
          width: source.readUInt32BE(16),
          height: source.readUInt32BE(20),
        }
      : source.toString('ascii', 12, 16) === 'VP8L' && webpSize(source);
  if (
    sha(source) !== original.sha256 ||
    !sourceSize ||
    sourceSize.width !== original.width ||
    sourceSize.height !== original.height ||
    bytes.length >= source.length
  )
    throw new Error(`${label}: archived original checksum, format or size mismatch`);
  seen.delivered.set(entry.file, { sha256: entry.sha256, original: original.sha256 });
  seen.originals.set(original.file, original.sha256);
}
/** Every delivered and archived file of a set is referenced, and nothing else is there. */
async function verifyCompactFiles(name) {
  const seen = compactSeen[name];
  for (const [dir, files] of [
    [`frontend/public/${name}`, seen.delivered],
    [`artwork/originals/${name}`, seen.originals],
  ]) {
    const actual = await fs.readdir(path.join(root, dir));
    if (actual.length !== files.size || actual.some((file) => !files.has(file)))
      throw new Error(`Unreferenced or missing artwork in ${dir}`);
  }
}

verifyCompactManifest('resource-art', resourceArt);
const odyle = resourceArt.odyle;
if (
  odyle.original_key !== 'Icon_Item_Odenergy_A_001' ||
  odyle.source !==
    'https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Odenergy_A_001.png'
)
  throw new Error('Unverified original Odyle artwork');
await verifyCompact('resource-art', odyle, 'Odyle artwork');
const cube = resourceArt.cube;
if (
  cube.original_key !== 'P_Img_HiddenCube_01_V04' ||
  cube.source !==
    'https://assets.playnccdn.com/static-aion2-gamedata/resources/P_Img_HiddenCube_01_V04.png' ||
  cube.native_package !==
    'AION2/Content/UI/Resource/Texture/Item/ETC/P_Img_HiddenCube_01_V04.uasset' ||
  cube.original?.sha256 !== 'f01315b4bca8d639123d152088f78541933137d543ec0d1b85163d74181e0c7b'
)
  throw new Error('Unverified original Hidden Cube artwork');
await verifyCompact('resource-art', cube, 'Hidden Cube artwork');
const gathering = await readJson('frontend/src/data/gathering-spawns.json');
const gatheringKeys = new Set(gathering.resources.map((r) => r.icon_key).filter(Boolean));
const gatheringArt = resourceArt.gathering;
if (!gatheringArt || Object.keys(gatheringArt).length !== gatheringKeys.size)
  throw new Error('Missing or unreferenced original gathering artwork');
for (const key of gatheringKeys) {
  const entry = gatheringArt[key];
  const resources = gathering.resources.filter((r) => r.icon_key === key);
  if (
    !/^Icon_Item_Gather_[A-Za-z0-9_]+$/.test(key) ||
    !entry ||
    entry.original_key !== key ||
    entry.source !== `https://assets.playnccdn.com/static-aion2-gamedata/resources/${key}.png` ||
    entry.native_package !== `AION2/Content/UI/Resource/Texture/Item/ETC/${key}.uasset` ||
    resources.some((r) => r.native.item_icon_key !== key)
  )
    throw new Error(`Unverified original gathering artwork: ${key}`);
  await verifyCompact('resource-art', entry, `Gathering artwork ${key}`);
}
await verifyCompactFiles('resource-art');
const originalPetTypes = {
  Cognia: 'Intellect',
  Fera: 'Feral',
  Natura: 'Nature',
  Varia: 'Trans',
  Specia: 'Special',
};
const petTypeFiles = new Set();
if (
  petTypeArt.version !== 1 ||
  Object.keys(petTypeArt.families).length !== Object.keys(originalPetTypes).length
)
  throw new Error('Unknown or incomplete pet type artwork manifest');
for (const [family, type] of Object.entries(originalPetTypes)) {
  const entry = petTypeArt.families[family];
  const resource = `/Game/UI/Resource/Sprite/FWindow_Vehicle/UT_FWindow_Vehicle_CreatureSlot_${type}_Sprite`;
  if (
    !entry ||
    !/^[a-f0-9]{20}\.webp$/.test(entry.file) ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    entry.original_resource !== resource ||
    entry.source !== `https://cdn.questlog.gg/aion-2/assets${resource}.webp` ||
    entry.reference !== 'https://tw.ncsoft.com/aion2/guidebook/view?title=%E5%AF%B5%E7%89%A9'
  )
    throw new Error('Unverified original pet type artwork');
  const bytes = await fs.readFile(path.join(root, 'frontend/public/pet-type-art', entry.file));
  if (
    crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256 ||
    !entry.file.startsWith(entry.sha256.slice(0, 20)) ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 16) !== 'WEBPVP8X' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length ||
    bytes.readUIntLE(24, 3) + 1 !== entry.width ||
    bytes.readUIntLE(27, 3) + 1 !== entry.height ||
    entry.width !== 94 ||
    entry.height !== 106 ||
    petTypeFiles.has(entry.file)
  )
    throw new Error('Pet type artwork checksum or dimensions mismatch');
  petTypeFiles.add(entry.file);
}
const actualPetTypes = await fs.readdir(path.join(root, 'frontend/public/pet-type-art'));
if (actualPetTypes.length !== petTypeFiles.size || actualPetTypes.some((f) => !petTypeFiles.has(f)))
  throw new Error('Unreferenced or missing pet type artwork');
const petPortraitFiles = new Set();
const petPortraitIds = new Set();
const petIds = new Set(petCatalogue.pets.map((pet) => pet.id));
verifyCompactManifest('pet-art', petArt);
for (const entry of petArt.images) {
  if (!petIds.has(entry.pet_id) || petPortraitIds.has(entry.pet_id))
    throw new Error('Invalid or duplicate pet portrait identity');
  if (!/^[A-Za-z0-9_%]+$/.test(entry.original_key))
    throw new Error('Invalid pet portrait manifest entry');
  const source = new URL(entry.source);
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'assets.playnccdn.com' ||
    source.pathname !==
      '/static-aion2-gamedata/resources/UT_Vehicle_Portrait_' + entry.original_key + '.png' ||
    source.search ||
    source.hash
  )
    throw new Error('Unverified pet portrait provenance');
  await verifyCompact('pet-art', entry, `Pet portrait ${entry.pet_id}`);
  petPortraitIds.add(entry.pet_id);
  petPortraitFiles.add(entry.file);
}
if (petPortraitIds.size !== petIds.size) throw new Error('Missing original pet portrait');
await verifyCompactFiles('pet-art');
/** Width and height of a WebP file (lossless `VP8L`, lossy `VP8 ` or extended `VP8X`). */
function webpSize(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
    return null;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X')
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8 ')
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  return null;
}
/**
 * A simple lossy WebP: one `VP8 ` key frame filling the RIFF container, with no alpha,
 * animation or metadata chunks, and no upscaling bits. Null for anything else.
 */
function opaqueLossyWebp(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 12, 16) !== 'VP8 ') return null;
  const size = bytes.readUInt32LE(16);
  const tag = bytes.readUIntLE(20, 3);
  if (
    20 + size + (size & 1) !== bytes.length ||
    (tag & 1) !== 0 ||
    (tag & 0x10) === 0 ||
    tag >>> 5 > size - 10 ||
    !bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a])) ||
    bytes.readUInt16LE(26) >>> 14 !== 0 ||
    bytes.readUInt16LE(28) >>> 14 !== 0
  )
    return null;
  return webpSize(bytes);
}
const MAP_ARCHIVE = 'artwork/originals/pet-map-art';
/** Delivered map art is never bundled: native downloads it per map from release packs. */
const MAP_DELIVERY = 'artwork/delivery/pet-map-art';
const MAP_ORIGINAL_FORMAT = 'lossless WebP (VP8L)';
const mapDelivery = {
  generator: 'scripts/build-map-art.mjs',
  encoder: 'sharp 0.35.5 (libvips 8.18.7, libwebp 1.6.0)',
  format: 'lossy WebP (VP8), opaque, native size',
  quality: 95,
  effort: 6,
  chroma_subsampling: '4:2:0',
  min_psnr_db: 39,
};
const mapArchiveFiles = new Set();
/**
 * The archived original (outside the bundle) still matches its recorded checksum and is
 * lossless; the delivered file is a smaller opaque lossy re-encoding at the same native
 * size whose recorded fidelity meets the pinned floor. `scripts/build-map-art.mjs --check`
 * proves the delivered bytes are the reproducible encoding of that original.
 */
async function verifyMapDelivery(entry, label) {
  const original = entry.original;
  if (
    !original ||
    !/^[a-f0-9]{20}\.webp$/.test(original.file) ||
    !/^[a-f0-9]{64}$/.test(original.sha256) ||
    !original.file.startsWith(original.sha256.slice(0, 20)) ||
    original.format !== MAP_ORIGINAL_FORMAT ||
    original.file === entry.file ||
    mapArchiveFiles.has(original.file) ||
    typeof entry.psnr_db !== 'number' ||
    !(entry.psnr_db >= mapDelivery.min_psnr_db) ||
    !(entry.psnr_db < 100)
  )
    throw new Error(`${label}: invalid archived original or delivery record`);
  const source = await fs.readFile(path.join(root, MAP_ARCHIVE, original.file));
  const sourceSize = webpSize(source);
  if (
    crypto.createHash('sha256').update(source).digest('hex') !== original.sha256 ||
    source.toString('ascii', 12, 16) !== 'VP8L' ||
    sourceSize?.width !== entry.width ||
    sourceSize?.height !== entry.height
  )
    throw new Error(`${label}: archived original checksum, format or size mismatch`);
  const bytes = await fs.readFile(path.join(root, MAP_DELIVERY, entry.file));
  const size = opaqueLossyWebp(bytes);
  if (
    crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256 ||
    !entry.file.startsWith(entry.sha256.slice(0, 20))
  )
    throw new Error(`${label}: delivered checksum mismatch`);
  if (!size || size.width !== entry.width || size.height !== entry.height)
    throw new Error(`${label}: delivered file is not an opaque lossy WebP of its native size`);
  if (bytes.length >= source.length)
    throw new Error(`${label}: delivered file is not smaller than its original`);
  mapArchiveFiles.add(original.file);
}
// Original client map textures. Lock canvas geometry as well as file provenance: a
// valid image on the wrong world extent makes coastal spawn points drift into sea.
const mapCanvases = new Map([
  ['World/World_L/World_L_A', { key: 'World_L_A', tile: 2048, grid: 8, world: 819200 }],
  ['World/World_D/World_D_A', { key: 'World_D_A', tile: 1024, grid: 8, world: 819200 }],
  [
    'Intersever/Abyss/Abyss_Reshanta_A',
    { key: 'Abyss_Reshanta_A', tile: 1024, grid: 4, world: 409600 },
  ],
]);
const petMapFiles = new Map();
if (
  petMapArt.version !== 4 ||
  !Array.isArray(petMapArt.images) ||
  !Array.isArray(petMapArt.maps) ||
  !Array.isArray(petMapArt.overviews) ||
  petMapArt.maps.length !== mapCanvases.size ||
  petMapArt.overviews.length !== mapCanvases.size ||
  petMapArt.provenance?.kind !== 'game-client' ||
  petMapArt.provenance.steam_app_id !== 3393110 ||
  petMapArt.provenance.steam_build_id !== '25926599' ||
  petMapArt.provenance.reference !== 'https://store.steampowered.com/app/3393110/AION_2/' ||
  petMapArt.provenance.archive !== MAP_ARCHIVE ||
  JSON.stringify(petMapArt.provenance.delivery) !== JSON.stringify(mapDelivery)
)
  throw new Error('Unknown map artwork manifest version');
const declaredMaps = new Set();
for (const entry of petMapArt.maps) {
  const canvas = mapCanvases.get(entry.id);
  const size = canvas && canvas.tile * canvas.grid;
  if (
    !canvas ||
    declaredMaps.has(entry.id) ||
    entry.width !== size ||
    entry.height !== size ||
    entry.tile_size !== canvas.tile ||
    entry.grid !== canvas.grid ||
    entry.world_size !== canvas.world ||
    entry.scale !== size / canvas.world ||
    entry.offset_x !== size / 2 ||
    entry.offset_y !== size / 2 ||
    entry.calibration !== 'verified'
  )
    throw new Error('Invalid original map canvas calibration');
  declaredMaps.add(entry.id);
}
const sourceCells = new Set();
for (const entry of petMapArt.images) {
  if (
    !/^[a-f0-9]{20}\.webp$/.test(entry.file) ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !/^[a-f0-9]{64}$/.test(entry.source_sha256) ||
    !/^[a-f0-9]{64}$/.test(entry.rgba_sha256) ||
    entry.source_format !== 'Texture2D' ||
    !Array.isArray(entry.map_ids) ||
    entry.map_ids.length !== 1 ||
    petMapFiles.has('/pet-map-art/' + entry.file)
  )
    throw new Error('Invalid map artwork manifest');
  const canvas = mapCanvases.get(entry.map_ids[0]);
  const cell = `${entry.map_ids[0]}:${entry.column}:${entry.row}`;
  const key =
    canvas &&
    `${canvas.key}_${String(entry.column).padStart(2, '0')}_${String(entry.row).padStart(2, '0')}`;
  if (
    !canvas ||
    !Number.isInteger(entry.column) ||
    !Number.isInteger(entry.row) ||
    entry.column < 0 ||
    entry.row < 0 ||
    entry.column >= canvas.grid ||
    entry.row >= canvas.grid ||
    sourceCells.has(cell) ||
    entry.width !== canvas.tile ||
    entry.height !== canvas.tile ||
    entry.original_key !== key ||
    entry.source !== `AION2/Content/UI/Map/WorldMap/${canvas.key}/Res/${key}.uasset`
  )
    throw new Error('Unverified map artwork provenance');
  sourceCells.add(cell);
  await verifyMapDelivery(entry, `Map tile ${key}`);
  petMapFiles.set('/pet-map-art/' + entry.file, entry);
}
if (sourceCells.size !== [...mapCanvases.values()].reduce((n, c) => n + c.grid ** 2, 0))
  throw new Error('Incomplete original map texture grid');
const mapOverviews = new Map();
for (const entry of petMapArt.overviews) {
  if (
    !mapCanvases.has(entry.map_id) ||
    mapOverviews.has(entry.map_id) ||
    !/^[a-f0-9]{20}\.webp$/.test(entry.file) ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !/^[a-f0-9]{64}$/.test(entry.rgba_sha256) ||
    entry.width !== 2048 ||
    entry.height !== 2048 ||
    entry.source !== 'downsampled-original-tiles' ||
    petMapFiles.has('/pet-map-art/' + entry.file)
  )
    throw new Error('Invalid original map overview');
  await verifyMapDelivery(entry, `Map overview ${entry.map_id}`);
  mapOverviews.set(entry.map_id, entry);
  petMapFiles.set('/pet-map-art/' + entry.file, entry);
}
const actualMapArt = await fs.readdir(path.join(root, MAP_DELIVERY));
if (
  actualMapArt.length !== petMapFiles.size ||
  actualMapArt.some((file) => !petMapFiles.has('/pet-map-art/' + file))
)
  throw new Error('Unreferenced or missing map artwork');
const actualMapArchive = await fs.readdir(path.join(root, MAP_ARCHIVE));
if (
  actualMapArchive.length !== mapArchiveFiles.size ||
  actualMapArchive.some(
    (file) => !mapArchiveFiles.has(file) || petMapFiles.has('/pet-map-art/' + file),
  )
)
  throw new Error('Unreferenced or missing archived original map artwork');
// No map file may ship inside the bundle: never in Vite's public folder and, with `--dist`
// after a build, never in its output (a stale dist before `vite build` is not checked).
for (const dir of ['frontend/public', ...(process.argv.includes('--dist') ? ['dist'] : [])]) {
  const found = await fs.readdir(path.join(root, dir), { recursive: true }).catch((cause) => {
    if (cause.code === 'ENOENT') return [];
    throw cause;
  });
  const shipped = found.filter(
    (file) =>
      /(^|[\\/])pet-map-art([\\/]|$)/.test(file) ||
      petMapFiles.has('/pet-map-art/' + path.basename(file)) ||
      mapArchiveFiles.has(path.basename(file)),
  );
  if (shipped.length) throw new Error(`Map artwork must not be bundled: ${dir}/${shipped[0]}`);
}
const mapsWithArt = new Set();
for (const map of petCatalogue.maps) {
  if (!map.bounds.every(Number.isFinite)) throw new Error('Invalid farming map bounds');
  if (!map.art) continue;
  const { art } = map;
  const canvas = mapCanvases.get(map.id);
  const size = canvas && canvas.tile * canvas.grid;
  const overview = mapOverviews.get(map.id);
  if (
    !canvas ||
    ![art.width, art.height, art.scale, art.offset_x, art.offset_y].every(Number.isFinite) ||
    art.scale !== size / canvas.world ||
    art.width !== size ||
    art.height !== size ||
    art.offset_x !== size / 2 ||
    art.offset_y !== size / 2 ||
    art.approximate !== undefined ||
    !overview ||
    art.overview?.file !== '/pet-map-art/' + overview.file ||
    art.overview.width !== overview.width ||
    art.overview.height !== overview.height ||
    !Array.isArray(art.tiles) ||
    art.tiles.length !== canvas.grid ** 2 ||
    map.bounds.some((value, i) => value !== ((i < 2 ? -1 : 1) * canvas.world) / 2)
  )
    throw new Error(`Unverified farming map art: ${map.id}`);
  const cells = new Set();
  for (const tile of art.tiles) {
    const entry = petMapFiles.get(tile.file);
    const cell = `${tile.x}:${tile.y}`;
    if (
      !entry ||
      !entry.map_ids.includes(map.id) ||
      cells.has(cell) ||
      tile.x !== entry.column * canvas.tile ||
      tile.y !== entry.row * canvas.tile ||
      tile.width !== canvas.tile ||
      tile.height !== canvas.tile
    )
      throw new Error(`Invalid original map tile placement: ${map.id}`);
    cells.add(cell);
  }
  mapsWithArt.add(map.id);
}
for (const entry of petMapArt.images)
  if (entry.map_ids.some((id) => !mapsWithArt.has(id)))
    throw new Error('Map artwork manifest names a map without that art');
const catalogue = await readJson('crates/companion-capture/data/catalogue.json');
const nativeSkills = new Map(catalogue.skills.map((skill) => [skill.id, skill]));
const files = new Map();
const fail = (message) => {
  throw new Error(message);
};
/** The nine class emblems by native name, with the asset name NCSOFT's character site uses. */
const classKeys = {
  Gladiator: 'gladiator',
  Templar: 'templar',
  Ranger: 'ranger',
  Assassin: 'assassin',
  Spiritmaster: 'elementalist',
  Sorcerer: 'sorcerer',
  Cleric: 'cleric',
  Chanter: 'chanter',
  Brawler: 'fighter',
};
const officialSource = (entry, pathname) => {
  const source = new URL(entry.source);
  return (
    source.protocol === 'https:' &&
    source.hostname === 'assets.playnccdn.com' &&
    source.pathname === pathname &&
    !source.search &&
    !source.hash
  );
};

/**
 * An original image from NCSOFT's CDN, archived as a lossless WebP verified pixel-identical to
 * the PNG as served (`source_sha256`, alpha included) and delivered compact.
 */
async function verifyImage(entry, label) {
  if (!/^[a-f0-9]{64}$/.test(entry.source_sha256 ?? '')) fail(`${label}: missing source checksum`);
  await verifyCompact('game-art', entry, label);
  files.set(entry.file, entry.sha256);
}

verifyCompactManifest('game-art', manifest);
if (
  Object.keys(manifest.classes).length !== Object.keys(classKeys).length ||
  Object.keys(classKeys).some((name) => !Object.hasOwn(manifest.classes, name))
)
  fail('Unknown or incomplete class emblem set');
for (const [name, entry] of Object.entries(manifest.classes)) {
  if (
    entry.original_key !== classKeys[name] ||
    !officialSource(
      entry,
      `/static-aion2/characters/img/class/class_icon_${entry.original_key}.png`,
    )
  )
    fail(`${name}: unverified class emblem provenance`);
  await verifyImage(entry, name);
}
let bases = 0;
let variants = 0;
for (const [id, entry] of Object.entries(manifest.skills)) {
  if (!/^\d+$/.test(id)) fail(`Invalid skill ID ${id}`);
  if (entry.base !== undefined) {
    const base = manifest.skills[entry.base];
    const native = nativeSkills.get(Number(id));
    if (!base?.file || !native || native.name !== base.name || native.class !== base.class) {
      fail(`Skill ${id}: variant has no matching native catalogue identity`);
    }
    variants++;
  } else {
    if (
      !/^ICON_[A-Za-z0-9_]+$/.test(entry.original_key ?? '') ||
      !officialSource(entry, `/static-aion2-gamedata/resources/${entry.original_key}.png`)
    )
      fail(`Skill ${id}: unverified skill artwork provenance`);
    await verifyImage(entry, `Skill ${id}`);
    bases++;
  }
}
await verifyCompactFiles('game-art');
console.log(
  `Verified ${Object.keys(manifest.classes).length} class icons, ${bases} skill entries, ${variants} native variants, ${files.size} class/skill images, ${petMapArt.images.length} original map tiles, ${mapOverviews.size} map overviews, ${petPortraitIds.size} original pet portraits, ${petTypeFiles.size} original pet type icons, ${gatheringKeys.size} original gathering icons, and original Odyle and Hidden Cube icons.`,
);
