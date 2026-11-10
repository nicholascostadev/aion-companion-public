/**
 * Copies the verified original artwork the website shows from the app's bundle, and derives the
 * compact data the page draws (Verteron's cube and gathering placements, the pet roster counts).
 * Run from the repository root or anywhere: `npm run sync:data` in website/.
 *
 * Sources: frontend/src/data/*.json and frontend/public/* (see docs/GAME_ARTWORK.md), and the
 * capture crate's bundled catalogues. Nothing is generated or repainted; images are copied as is.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const json = (path) => JSON.parse(readFileSync(join(repo, path), 'utf8'));
const out = (path) => {
  const full = join(site, path);
  mkdirSync(dirname(full), { recursive: true });
  return full;
};
const fresh = (dir) => {
  rmSync(join(site, dir), { recursive: true, force: true });
  mkdirSync(join(site, dir), { recursive: true });
};

// ---------- Class and pet type emblems ----------
const gameArt = json('frontend/src/data/game-art.json');
fresh('public/art/class');
for (const [name, art] of Object.entries(gameArt.classes)) {
  copyFileSync(
    join(repo, 'frontend/public/game-art', art.file),
    out(`public/art/class/${name.toLowerCase()}.webp`),
  );
}

const petTypes = json('frontend/src/data/pet-type-art.json');
fresh('public/art/pet-type');
for (const [family, art] of Object.entries(petTypes.families)) {
  copyFileSync(
    join(repo, 'frontend/public/pet-type-art', art.file),
    out(`public/art/pet-type/${family.toLowerCase()}.webp`),
  );
}

// ---------- Odyle energy icon (the meter footer) ----------
const resourceArt = json('frontend/src/data/resource-art.json');
fresh('public/art/resource');
copyFileSync(
  join(repo, 'frontend/public/resource-art', resourceArt.odyle.file),
  out('public/art/resource/odyle.webp'),
);

// ---------- A Ranger rotation (skill icons by their game resource key) ----------
const ROTATION = [
  'ICON_RA_SKILL_001', // Snipe
  'ICON_RA_SKILL_003', // Rapid Fire
  'ICON_RA_SKILL_004', // Spiral Arrow
  'ICON_RA_SKILL_002', // Deadshot
  'ICON_RA_SKILL_006', // Griffon Arrow
  'ICON_RA_SKILL_005', // Drill Dart
  'ICON_RA_SKILL_008', // Burst Arrow
  'ICON_RA_SKILL_007', // Suppressing Arrow
];
fresh('public/art/skill');
const skills = [];
for (const key of ROTATION) {
  const entry = Object.values(gameArt.skills).find(
    (s) => s.original_key === key && s.name && s.class === 'Ranger',
  );
  if (!entry) throw new Error(`No Ranger skill icon for ${key}`);
  copyFileSync(
    join(repo, 'frontend/public/game-art', entry.file),
    out(`public/art/skill/${key.toLowerCase()}.webp`),
  );
  skills.push({ key: key.toLowerCase(), name: entry.name });
}

// ---------- Pet portraits ----------
const petArt = json('frontend/src/data/pet-art.json');
const catalogue = json('crates/companion-capture/data/pet-catalogue.json');
const PETS = [
  'Black Dragon',
  'Skyray',
  'Forest Spirit',
  'Krall laborer',
  'Oculazen',
  'Sparkie',
  'Fungie',
  'Klaw',
  'Slime',
  'Kailin',
  'White Bunny',
  'Forest Specter',
  'Swarm',
  'Potcrab',
  'Chonky Hamster',
  'Fossa',
  'Nagarant Guardian Warrior',
  'Gravi',
];
fresh('public/art/pet');
const pets = [];
for (const name of PETS) {
  const pet = catalogue.pets.find((p) => p.name === name);
  const art = pet && Object.values(petArt.images).find((i) => i.pet_id === pet.id);
  if (!pet || !art) throw new Error(`No portrait for ${name}`);
  copyFileSync(
    join(repo, 'frontend/public/pet-art', art.file),
    out(`public/art/pet/${pet.id}.webp`),
  );
  pets.push({ id: pet.id, name: pet.name, family: pet.family });
}
const families = {};
for (const pet of catalogue.pets) families[pet.family] = (families[pet.family] ?? 0) + 1;

// ---------- Verteron atlas: cubes and gathering, projected like the app's map ----------
// Map pixel = world * scale + offset (frontend/src/data/pet-map-art.json, calibrated).
const MAP = 'World/World_L/World_L_A';
const mapArt = json('frontend/src/data/pet-map-art.json').maps.find((m) => m.id === MAP);
const project = ([x, y]) => [
  Math.round(((x * mapArt.scale + mapArt.offset_x) / mapArt.width) * 1000),
  Math.round(((y * mapArt.scale + mapArt.offset_y) / mapArt.height) * 1000),
];
const cubes = json('frontend/src/data/cube-spawns.json').maps.find((m) => m.map_id === MAP);
const gathering = json('frontend/src/data/gathering-spawns.json');
const categoryOf = new Map(gathering.resources.map((r) => [r.id, r.category]));
const atlas = { cube: [] };
for (const group of cubes.groups) for (const p of group.points) atlas.cube.push(project(p));
for (const group of gathering.maps.find((m) => m.map_id === MAP).groups) {
  const category = categoryOf.get(group.env_object_ids[0]) ?? 'other';
  for (const p of group.points) (atlas[category] ??= []).push(project(p));
}
// Dedupe identical projected points per layer to keep the file small.
for (const layer of Object.keys(atlas)) {
  atlas[layer] = [...new Map(atlas[layer].map((p) => [p.join(','), p])).values()];
}

// ---------- Pet radar map: real Verteron terrain around the farming goal ----------
// The radar's map is the original game terrain (artwork/delivery/pet-map-art) with markers at
// real spawn points: the goal (Krall laborer), the pinned pet (Klaw) and other pets' spawns.
// The view is cropped from one original tile and re-encoded small with the same sharp/libvips
// build the app's art pipeline pins (scripts/build-compact-art.mjs).
const RADAR_VIEW = 1100; // map pixels across
const RADAR_OUT = 640; // delivered pixels across
const mapImages = json('frontend/src/data/pet-map-art.json').images.filter((i) =>
  i.map_ids.includes(MAP),
);
const toMap = (s) => [s.x * mapArt.scale + mapArt.offset_x, s.y * mapArt.scale + mapArt.offset_y];
const spawnsOf = (name) =>
  catalogue.pets
    .find((p) => p.name === name)
    .spawns.filter((s) => s.map_id === MAP)
    .map(toMap);
const goal = spawnsOf('Krall laborer');
const pinned = spawnsOf('Klaw');
const others = catalogue.pets
  .filter((p) => !['Krall laborer', 'Klaw'].includes(p.name))
  .flatMap((p) => p.spawns.filter((s) => s.map_id === MAP).map(toMap));

// The window that holds the most goal and pinned spawns, with both present.
const tileSize = mapArt.tile_size;
const inside = (pts, x0, y0) =>
  pts.filter(([x, y]) => x >= x0 && x < x0 + RADAR_VIEW && y >= y0 && y < y0 + RADAR_VIEW);
let best = null;
for (const [cx, cy] of [...goal, ...pinned]) {
  const x0 = Math.round(cx - RADAR_VIEW / 2);
  const y0 = Math.round(cy - RADAR_VIEW / 2);
  const g = inside(goal, x0, y0).length;
  const p = inside(pinned, x0, y0).length;
  if (!g || !p) continue;
  if (!best || g + p > best.score) best = { x0, y0, score: g + p };
}
if (!best) throw new Error('No radar window with both goal and pinned spawns');

// Stitch the original tiles the window touches, then crop and re-encode it small.
const c0 = Math.floor(best.x0 / tileSize);
const r0 = Math.floor(best.y0 / tileSize);
const c1 = Math.floor((best.x0 + RADAR_VIEW - 1) / tileSize);
const r1 = Math.floor((best.y0 + RADAR_VIEW - 1) / tileSize);
const { default: sharp } = await import('sharp');
const layers = [];
for (let c = c0; c <= c1; c++) {
  for (let r = r0; r <= r1; r++) {
    const tile = mapImages.find((i) => i.column === c && i.row === r);
    if (!tile) throw new Error();
    layers.push({
      input: join(repo, 'artwork/delivery/pet-map-art', tile.file),
      left: (c - c0) * tileSize,
      top: (r - r0) * tileSize,
    });
  }
}
const mosaic = await sharp({
  create: {
    width: (c1 - c0 + 1) * tileSize,
    height: (r1 - r0 + 1) * tileSize,
    channels: 3,
    background: '#000',
  },
})
  .composite(layers)
  .png({ compressionLevel: 0 })
  .toBuffer();
fresh('public/art/map');
await sharp(mosaic)
  .extract({
    left: best.x0 - c0 * tileSize,
    top: best.y0 - r0 * tileSize,
    width: RADAR_VIEW,
    height: RADAR_VIEW,
  })
  .resize(RADAR_OUT, RADAR_OUT, { kernel: 'lanczos3' })
  .webp({ quality: 82, effort: 6 })
  .toFile(out('public/art/map/verteron-radar.webp'));
const rel = (pts, limit = Infinity) =>
  inside(pts, best.x0, best.y0)
    .slice(0, limit)
    .map(([x, y]) => [
      +((x - best.x0) / RADAR_VIEW).toFixed(4),
      +((y - best.y0) / RADAR_VIEW).toFixed(4),
    ]);
const radar = { goal: rel(goal), pinned: rel(pinned), spawns: rel(others, 24) };

writeFileSync(out('src/data/radar.json'), `${JSON.stringify(radar)}\n`);
writeFileSync(
  out('src/data/game.json'),
  `${JSON.stringify({ skills, pets, families }, null, 2)}\n`,
);
writeFileSync(out('src/data/verteron-atlas.json'), `${JSON.stringify(atlas)}\n`);
console.log(
  `Synced ${skills.length} skills, ${pets.length} pets, atlas layers: ${Object.entries(atlas)
    .map(([k, v]) => `${k} ${v.length}`)
    .join(', ')}`,
);
