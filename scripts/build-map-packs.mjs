import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const MAGIC = Buffer.from('ACMAP001');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = 'src-tauri/map-art-index.json';
const DELIVERY = 'artwork/delivery/pet-map-art';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Native map packs contain only manifest-ordered length-prefixed WebP bytes, no paths. */
export async function buildMapPacks(manifest, readImage) {
  const entries = [...manifest.images, ...manifest.overviews];
  const packs = [];
  for (const map of manifest.maps) {
    const slug = map.id.split('/').at(-1);
    if (!/^[A-Za-z0-9_]+$/.test(slug)) throw new Error('Invalid map identity');
    const images = entries
      .filter((entry) => entry.map_id === map.id || entry.map_ids?.includes(map.id))
      .sort((a, b) => a.file.localeCompare(b.file, 'en'));
    if (!images.length || images.length > 65) throw new Error('Invalid map image count');
    const files = [];
    const chunks = [MAGIC];
    const names = new Set();
    for (const image of images) {
      if (
        !/^[a-f0-9]{64}$/.test(image.sha256) ||
        image.file !== `${image.sha256.slice(0, 20)}.webp` ||
        names.has(image.file)
      )
        throw new Error('Invalid or repeated map image');
      names.add(image.file);
      const bytes = await readImage(image.file);
      if (!bytes.length || bytes.length > 8_000_000 || hash(bytes) !== image.sha256)
        throw new Error(`Map image checksum or size mismatch: ${image.file}`);
      const length = Buffer.alloc(4);
      length.writeUInt32LE(bytes.length);
      chunks.push(length, bytes);
      files.push({ file: image.file, sha256: image.sha256, size: bytes.length });
    }
    const bytes = Buffer.concat(chunks);
    const sha256 = hash(bytes);
    packs.push({
      metadata: {
        id: map.id,
        asset: `AionCompanion-map-${slug}-${sha256.slice(0, 20)}.acmap`,
        sha256,
        size: bytes.length,
        files,
      },
      bytes,
    });
  }
  if (new Set(packs.map((pack) => pack.metadata.id)).size !== packs.length)
    throw new Error('Repeated map identity');
  return packs;
}

export function parseArgs(args) {
  if (!args.length || (args.length === 1 && args[0] === '--check')) return { mode: 'check' };
  if (args.length === 1 && args[0] === '--write-index') return { mode: 'write' };
  if (args.length === 2 && args[0] === '--output' && args[1] && !args[1].startsWith('--'))
    return { mode: 'output', output: args[1] };
  throw new Error('Usage: build-map-packs.mjs [--check | --write-index | --output DIRECTORY]');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(
    await fs.readFile(path.join(ROOT, 'frontend/src/data/pet-map-art.json')),
  );
  const packs = await buildMapPacks(manifest, (file) =>
    fs.readFile(path.join(ROOT, DELIVERY, file)),
  );
  const index = { version: 1, format: MAGIC.toString(), maps: packs.map((pack) => pack.metadata) };
  const indexPath = path.join(ROOT, INDEX);
  if (args.mode === 'write') await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');
  else {
    const recorded = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (!isDeepStrictEqual(recorded, index))
      throw new Error(
        `${INDEX} is stale. Regenerate with --write-index after changing map delivery.`,
      );
  }
  if (args.mode === 'output') {
    const output = path.resolve(args.output);
    await fs.mkdir(output, { recursive: true });
    for (const pack of packs) {
      await fs.writeFile(path.join(output, pack.metadata.asset), pack.bytes, { flag: 'wx' });
    }
  }
  console.log(
    `${args.mode === 'write' ? 'Indexed' : args.mode === 'output' ? 'Packaged' : 'Verified'} ${packs.length} map packs (${(packs.reduce((n, pack) => n + pack.bytes.length, 0) / 1e6).toFixed(2)} MB), separate from Setup and the portable ZIP.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
