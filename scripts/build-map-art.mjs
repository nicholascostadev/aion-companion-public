/**
 * Build-time delivery encoding for the original AION 2 map textures.
 *
 * The archived originals in `artwork/originals/pet-map-art` are the lossless WebP
 * re-encodings of the client's Texture2D exports; they stay outside the shipped bundle.
 * This script verifies each original against its recorded file and decoded RGBA
 * checksums, encodes it as lossy WebP at its native size and writes the delivered file to
 * `artwork/delivery/pet-map-art` (outside the bundle; the release's map packs are built from it),
 * `frontend/src/data/pet-map-art.json` and the catalogue's tile references.
 * It is never called by the running application or by `npm run build`.
 *
 * Encoder output is only reproducible with the pinned encoder, so the script refuses any
 * other sharp/libvips/libwebp version. sharp is deliberately not a project dependency:
 *
 *   node scripts/build-map-art.mjs [--check] [--sharp <path to sharp/dist/index.mjs>]
 *
 * `--check` re-encodes everything and fails unless the manifest, the delivered files and
 * the catalogue are byte-identical to that output. It writes nothing. The default sharp
 * path is `.tools/size-lab/node_modules/sharp/dist/index.mjs`; see docs/GAME_ARTWORK.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST = 'frontend/src/data/pet-map-art.json';
const CATALOGUE = 'crates/companion-capture/data/pet-catalogue.json';
const ARCHIVE = 'artwork/originals/pet-map-art';
/** Unbundled: native downloads each map's pack on first use (see docs/GAME_ARTWORK.md). */
const DELIVERED = 'artwork/delivery/pet-map-art';

/** Everything that determines the delivered bytes; recorded in the manifest verbatim. */
export const DELIVERY = {
  generator: 'scripts/build-map-art.mjs',
  encoder: 'sharp 0.35.5 (libvips 8.18.7, libwebp 1.6.0)',
  format: 'lossy WebP (VP8), opaque, native size',
  quality: 95,
  effort: 6,
  chroma_subsampling: '4:2:0',
  min_psnr_db: 39,
};
export const PINNED = { sharp: '0.35.5', vips: '8.18.7', webp: '1.6.0' };
const ORIGINAL_FORMAT = 'lossless WebP (VP8L)';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** RGB peak signal-to-noise ratio in dB between two equally sized 8-bit buffers. */
export function psnr(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('PSNR needs equal, non-empty images');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum ? 10 * Math.log10((255 * 255 * a.length) / sum) : Infinity;
}

/** Version 3 kept the original as the delivered file; version 4 records both. */
export function originalOf(entry) {
  return entry.original ?? { file: entry.file, sha256: entry.sha256 };
}

/** A version 4 entry: delivered file first, archived original and evidence after. */
export function deliveredEntry(entry, delivered) {
  const { file: _file, sha256: _sha, original: _original, psnr_db: _psnr, ...rest } = entry;
  const original = originalOf(entry);
  return {
    file: delivered.file,
    sha256: delivered.sha256,
    ...rest,
    original: { file: original.file, sha256: original.sha256, format: ORIGINAL_FORMAT },
    psnr_db: delivered.psnr_db,
  };
}

/** Replace each delivered `/pet-map-art/` reference in the catalogue text, nothing else. */
export function relinkCatalogue(text, renames) {
  return text.replace(/\/pet-map-art\/([a-f0-9]{20}\.webp)/g, (match, file) => {
    const next = renames.get(file);
    if (!next) throw new Error(`Catalogue names unknown map art ${file}`);
    return '/pet-map-art/' + next;
  });
}

/** sharp at `file`, refusing any version but the pinned encoder. */
export async function loadSharp(file) {
  const resolved = path.resolve(file);
  try {
    await fs.access(resolved);
  } catch {
    throw new Error(`sharp not found at ${resolved}; see docs/GAME_ARTWORK.md`);
  }
  const { default: sharp } = await import(pathToFileURL(resolved).href);
  const v = sharp.versions;
  if (v.sharp !== PINNED.sharp || v.vips !== PINNED.vips || v.webp !== PINNED.webp)
    throw new Error(
      `Need sharp ${PINNED.sharp} (libvips ${PINNED.vips}, libwebp ${PINNED.webp}); found ` +
        `sharp ${v.sharp} (libvips ${v.vips}, libwebp ${v.webp})`,
    );
  sharp.cache(false);
  return sharp;
}

async function encode(sharp, entry) {
  const original = originalOf(entry);
  const bytes = await fs.readFile(path.join(root, ARCHIVE, original.file));
  if (sha256(bytes) !== original.sha256 || !original.file.startsWith(original.sha256.slice(0, 20)))
    throw new Error(`Archived original checksum mismatch: ${original.file}`);
  if (bytes.toString('ascii', 12, 16) !== 'VP8L')
    throw new Error(`Archived original is not lossless: ${original.file}`);
  const rgba = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (
    rgba.info.width !== entry.width ||
    rgba.info.height !== entry.height ||
    sha256(rgba.data) !== entry.rgba_sha256
  )
    throw new Error(`Archived original pixels differ from recorded RGBA: ${original.file}`);
  for (let i = 3; i < rgba.data.length; i += 4)
    if (rgba.data[i] !== 255) throw new Error(`Map art must be opaque: ${original.file}`);
  const out = await sharp(bytes)
    .webp({
      quality: DELIVERY.quality,
      effort: DELIVERY.effort,
      smartSubsample: false,
      nearLossless: false,
      lossless: false,
      preset: 'default',
    })
    .toBuffer();
  const decoded = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  if (
    out.toString('ascii', 12, 16) !== 'VP8 ' ||
    decoded.info.channels !== 3 ||
    decoded.info.width !== entry.width ||
    decoded.info.height !== entry.height
  )
    throw new Error(`Unexpected delivery encoding: ${original.file}`);
  const rgb = await sharp(bytes).removeAlpha().raw().toBuffer();
  const quality = psnr(rgb, decoded.data);
  if (!(quality >= DELIVERY.min_psnr_db))
    throw new Error(`Delivered ${original.file} is below ${DELIVERY.min_psnr_db} dB PSNR`);
  const hash = sha256(out);
  return {
    file: `${hash.slice(0, 20)}.webp`,
    sha256: hash,
    psnr_db: Math.floor(quality * 100) / 100,
    bytes: out,
    originalSize: bytes.length,
  };
}

/** Run `task` over `items` with bounded concurrency, results in input order. */
export async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await task(items[i]);
      }
    }),
  );
  return results;
}

/** Format the manifest exactly as the repository formatter does. */
export function format(file) {
  const bin = path.join(root, 'node_modules/oxfmt/bin/oxfmt');
  execFileSync(process.execPath, [bin, '--write', file], { cwd: root, stdio: 'inherit' });
}

/** `--check` and `--sharp <path>` only; anything else is an error, never a silent rewrite. */
export function parseArgs(argv) {
  const options = { check: false, sharp: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check' && !options.check) options.check = true;
    else if (arg === '--sharp' && options.sharp === null) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--sharp needs a path');
      options.sharp = value;
    } else throw new Error(`Unknown or repeated argument: ${arg}`);
  }
  return options;
}

async function main(argv) {
  const { check, sharp: sharpOption } = parseArgs(argv);
  const sharpPath =
    sharpOption ?? path.join(root, '.tools/size-lab/node_modules/sharp/dist/index.mjs');
  const sharp = await loadSharp(sharpPath);
  const manifestPath = path.join(root, MANIFEST);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.version !== 3 && manifest.version !== 4)
    throw new Error('Unknown map artwork manifest version');
  const entries = [...manifest.images, ...manifest.overviews];
  const workers = Math.max(1, Math.min(8, os.availableParallelism() - 1));
  const encoded = await mapLimited(entries, workers, (entry) => encode(sharp, entry));

  const renames = new Map(entries.map((entry, i) => [entry.file, encoded[i].file]));
  const next = {
    ...manifest,
    version: 4,
    provenance: {
      ...manifest.provenance,
      conversion:
        'Archived originals: Pillow 13.0.0 lossless WebP, method 6, exact. Decoded RGBA pixels verified identical to the exported originals.',
      archive: ARCHIVE,
      delivery: DELIVERY,
    },
    images: manifest.images.map((entry, i) => deliveredEntry(entry, encoded[i])),
    overviews: manifest.overviews.map((entry, i) =>
      deliveredEntry(entry, encoded[manifest.images.length + i]),
    ),
  };
  const catalogueText = await fs.readFile(path.join(root, CATALOGUE), 'utf8');
  const nextCatalogue = relinkCatalogue(catalogueText, renames);

  const total = (key) => encoded.reduce((n, e) => n + (key ? e[key] : e.bytes.length), 0);
  const summary = `${encoded.length} map images: ${(total('originalSize') / 1e6).toFixed(3)} MB archived, ${(total() / 1e6).toFixed(3)} MB delivered, minimum ${Math.min(...encoded.map((e) => e.psnr_db)).toFixed(2)} dB PSNR`;

  if (check) {
    const formatted = path.join(os.tmpdir(), `pet-map-art-${process.pid}.json`);
    await fs.writeFile(formatted, JSON.stringify(next, null, 2) + '\n');
    format(formatted);
    const expected = await fs.readFile(formatted, 'utf8');
    await fs.rm(formatted);
    if (expected !== (await fs.readFile(manifestPath, 'utf8')))
      throw new Error(`${MANIFEST} differs from the reproducible delivery encoding`);
    if (nextCatalogue !== catalogueText) throw new Error(`${CATALOGUE} names stale map art`);
    const present = (await fs.readdir(path.join(root, DELIVERED))).sort();
    const wanted = encoded.map((e) => e.file).sort();
    if (present.join() !== wanted.join())
      throw new Error(`${DELIVERED} has stale or missing files`);
    for (const e of encoded)
      if (!(await fs.readFile(path.join(root, DELIVERED, e.file))).equals(e.bytes))
        throw new Error(`Delivered ${e.file} is not reproducible`);
    console.log(`Reproduced ${summary}.`);
    return;
  }

  const outDir = path.join(root, DELIVERED);
  await fs.mkdir(outDir, { recursive: true });
  const keep = new Set(encoded.map((e) => e.file));
  for (const file of await fs.readdir(outDir))
    if (!keep.has(file)) await fs.rm(path.join(outDir, file));
  for (const e of encoded) await fs.writeFile(path.join(outDir, e.file), e.bytes);
  await fs.writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n');
  format(manifestPath);
  await fs.writeFile(path.join(root, CATALOGUE), nextCatalogue);
  console.log(`Wrote ${summary}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
