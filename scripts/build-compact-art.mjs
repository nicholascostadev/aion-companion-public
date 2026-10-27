/**
 * Build-time delivery encoding for the bundled original AION 2 icons and portraits.
 *
 * The verified originals (`artwork/originals/{game-art,pet-art,resource-art}`) stay outside
 * the shipped bundle. This script checks each against the checksum its manifest records,
 * encodes it as lossy WebP (alpha kept lossless) at the size the interface needs, and writes
 * the delivered files (`frontend/public/<set>`) and their manifests. Skill and class icons and
 * resource icons are drawn at 44 CSS px or less (tracker bars allow up to 128), so they are
 * delivered at 128 px; pet portraits are drawn up to about 230 CSS px and keep their native
 * 256 px. It is never called by the running application or by `npm run build`.
 *
 * Encoder output is only reproducible with the pinned encoder, so the script refuses any
 * other sharp/libvips/libwebp version. sharp is deliberately not a project dependency:
 *
 *   node scripts/build-compact-art.mjs [--check] [--sharp <path to sharp/dist/index.mjs>]
 *
 * `--check` re-encodes everything and fails unless the manifests and the delivered files are
 * byte-identical to that output. It writes nothing. See docs/GAME_ARTWORK.md.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, loadSharp, mapLimited, parseArgs } from './build-map-art.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const ENCODER = 'sharp 0.35.5 (libvips 8.18.7, libwebp 1.6.0)';
const common = {
  generator: 'scripts/build-compact-art.mjs',
  encoder: ENCODER,
  format: 'lossy WebP (VP8), lossless alpha, opaque images without alpha',
  resize: 'lanczos3',
  effort: 4,
  chroma_subsampling: '4:2:0',
};

/**
 * Everything that determines each set's delivered bytes; recorded in its manifest verbatim.
 * The PSNR floors sit just under the measured minimum (premultiplied colour and alpha): the
 * lowest portraits are saturated, fine-grained textures whose chroma edges soften under 4:2:0,
 * visually identical to the original at their largest drawn size (230 CSS px at 2x).
 */
export const SETS = {
  'game-art': {
    manifest: 'frontend/src/data/game-art.json',
    version: 4,
    original_format: 'lossless WebP (VP8L)',
    delivery: { ...common, size: 128, quality: 90, min_psnr_db: 28 },
  },
  'pet-art': {
    manifest: 'frontend/src/data/pet-art.json',
    version: 2,
    original_format: 'PNG',
    delivery: { ...common, size: 256, quality: 85, min_psnr_db: 23 },
  },
  'resource-art': {
    manifest: 'frontend/src/data/resource-art.json',
    version: 2,
    original_format: 'PNG',
    delivery: { ...common, size: 128, quality: 90, min_psnr_db: 33 },
  },
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The art entries of a manifest, in file order: the objects that name a file. */
export function artEntries(name, manifest) {
  if (name === 'game-art')
    return [
      ...Object.values(manifest.classes),
      ...Object.values(manifest.skills).filter((e) => e.file),
    ];
  if (name === 'pet-art') return manifest.images;
  return [manifest.odyle, manifest.cube, ...Object.values(manifest.gathering)];
}

/** The archived original of an entry: its own file before the first compact delivery. */
export function originalOf(entry) {
  return (
    entry.original ?? {
      file: entry.file,
      sha256: entry.sha256,
      width: entry.width,
      height: entry.height,
    }
  );
}

/** A compact entry: delivered file first, the archived original and the evidence after. */
export function compactEntry(entry, delivered, originalFormat) {
  const {
    file: _file,
    sha256: _sha,
    width: _width,
    height: _height,
    original: _original,
    psnr_db: _psnr,
    ...rest
  } = entry;
  const original = originalOf(entry);
  return {
    file: delivered.file,
    sha256: delivered.sha256,
    width: delivered.width,
    height: delivered.height,
    ...rest,
    original: {
      file: original.file,
      sha256: original.sha256,
      width: original.width,
      height: original.height,
      format: originalFormat,
    },
    psnr_db: delivered.psnr_db,
  };
}

/**
 * PSNR in dB of colour premultiplied by alpha, and alpha, between two equally sized RGBA
 * buffers: colour under fully transparent pixels is invisible and never counted.
 */
export function premultipliedPsnr(a, b) {
  if (a.length !== b.length || !a.length || a.length % 4)
    throw new Error('PSNR needs equal, non-empty RGBA images');
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = (a[i + c] * a[i + 3] - b[i + c] * b[i + 3]) / 255;
      sum += d * d;
    }
    const d = a[i + 3] - b[i + 3];
    sum += d * d;
  }
  return sum ? 10 * Math.log10((255 * 255 * a.length) / sum) : Infinity;
}

async function encode(sharp, name, original) {
  const set = SETS[name];
  const { size, quality, effort, min_psnr_db: floor } = set.delivery;
  const bytes = await fs.readFile(path.join(root, 'artwork/originals', name, original.file));
  if (sha256(bytes) !== original.sha256 || !original.file.startsWith(original.sha256.slice(0, 20)))
    throw new Error(`Archived original checksum mismatch: ${name}/${original.file}`);
  const lossless = bytes.toString('ascii', 12, 16) === 'VP8L';
  if (set.original_format === 'PNG' ? !bytes.subarray(0, 8).equals(PNG) : !lossless)
    throw new Error(`Archived original is not ${set.original_format}: ${name}/${original.file}`);
  const meta = await sharp(bytes).metadata();
  if (meta.width !== original.width || meta.height !== original.height || size > meta.width)
    throw new Error(`Archived original size mismatch: ${name}/${original.file}`);
  const { isOpaque } = await sharp(bytes).stats();
  const scaled = () => {
    const image = sharp(bytes).ensureAlpha();
    return size === meta.width ? image : image.resize(size, size, { kernel: 'lanczos3' });
  };
  // The exact pixels the delivery encodes, kept losslessly for the fidelity check.
  const reference = await scaled().raw().toBuffer();
  const out = await (isOpaque ? scaled().removeAlpha() : scaled())
    .webp({
      quality,
      alphaQuality: 100,
      effort,
      smartSubsample: false,
      nearLossless: false,
      lossless: false,
      preset: 'default',
    })
    .toBuffer();
  const decoded = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== size || decoded.info.height !== size)
    throw new Error(`Unexpected delivery encoding: ${name}/${original.file}`);
  const fidelity = premultipliedPsnr(reference, decoded.data);
  if (!(fidelity >= floor))
    throw new Error(`Delivered ${name}/${original.file} is below ${floor} dB PSNR`);
  const hash = sha256(out);
  return {
    file: `${hash.slice(0, 20)}.webp`,
    sha256: hash,
    width: size,
    height: size,
    psnr_db: Math.floor(fidelity * 100) / 100,
    bytes: out,
    originalSize: bytes.length,
  };
}

/** Rewrite each art entry of a manifest in place with its delivery. */
function rewrite(name, manifest, delivered) {
  const set = SETS[name];
  const next = structuredClone(manifest);
  next.version = set.version;
  next.delivery = { ...set.delivery, archive: `artwork/originals/${name}` };
  for (const entry of artEntries(name, next)) {
    const done = delivered.get(originalOf(entry).file);
    const compact = compactEntry(entry, done, set.original_format);
    for (const key of Object.keys(entry)) delete entry[key];
    Object.assign(entry, compact);
  }
  // Keep the header (version, copyright, delivery) before the art.
  const { version, copyright, delivery, ...art } = next;
  return { version, copyright, delivery, ...art };
}

async function main(argv) {
  const { check, sharp: sharpOption } = parseArgs(argv);
  const sharp = await loadSharp(
    sharpOption ?? path.join(root, '.tools/size-lab/node_modules/sharp/dist/index.mjs'),
  );
  const workers = Math.max(1, Math.min(4, os.availableParallelism() - 1));
  const summary = [];
  const problems = [];
  for (const name of Object.keys(SETS)) {
    const manifestPath = path.join(root, SETS[name].manifest);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    // Entries may share one original (a class and a skill never do, skills sometimes).
    const originals = new Map();
    for (const entry of artEntries(name, manifest)) {
      const original = originalOf(entry);
      const seen = originals.get(original.file);
      if (seen && seen.sha256 !== original.sha256)
        throw new Error(`Two checksums for one original: ${name}/${original.file}`);
      originals.set(original.file, original);
    }
    const list = [...originals.values()];
    const encoded = await mapLimited(list, workers, (original) => encode(sharp, name, original));
    const delivered = new Map(list.map((original, i) => [original.file, encoded[i]]));
    const next = rewrite(name, manifest, delivered);
    const total = (key) => encoded.reduce((n, e) => n + (key ? e[key] : e.bytes.length), 0);
    summary.push(
      `${name}: ${encoded.length} images, ${(total('originalSize') / 1e6).toFixed(3)} MB archived, ${(total() / 1e6).toFixed(3)} MB delivered, minimum ${Math.min(...encoded.map((e) => e.psnr_db)).toFixed(2)} dB PSNR`,
    );
    const outDir = path.join(root, 'frontend/public', name);
    if (check) {
      const formatted = path.join(os.tmpdir(), `${name}-${process.pid}.json`);
      await fs.writeFile(formatted, JSON.stringify(next, null, 2) + '\n');
      format(formatted);
      const expected = await fs.readFile(formatted, 'utf8');
      await fs.rm(formatted);
      if (expected !== (await fs.readFile(manifestPath, 'utf8')))
        problems.push(`${SETS[name].manifest} differs from the reproducible delivery encoding`);
      const present = (await fs.readdir(outDir).catch(() => [])).sort();
      const wanted = [...new Set(encoded.map((e) => e.file))].sort();
      if (present.join() !== wanted.join()) problems.push(`${outDir} has stale or missing files`);
      for (const e of encoded) {
        const bytes = await fs.readFile(path.join(outDir, e.file)).catch(() => null);
        if (!bytes?.equals(e.bytes))
          problems.push(`Delivered ${name}/${e.file} is not reproducible`);
      }
      continue;
    }
    await fs.mkdir(outDir, { recursive: true });
    const keep = new Set(encoded.map((e) => e.file));
    for (const file of await fs.readdir(outDir))
      if (!keep.has(file)) await fs.rm(path.join(outDir, file));
    for (const e of encoded) await fs.writeFile(path.join(outDir, e.file), e.bytes);
    await fs.writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n');
    format(manifestPath);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`${check ? 'Reproduced' : 'Wrote'}:\n${summary.join('\n')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
