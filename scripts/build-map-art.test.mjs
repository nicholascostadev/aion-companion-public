import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveredEntry, originalOf, parseArgs, psnr, relinkCatalogue } from './build-map-art.mjs';

test('arguments are explicit; typos and missing paths never regenerate', () => {
  assert.deepEqual(parseArgs([]), { check: false, sharp: null });
  assert.deepEqual(parseArgs(['--check', '--sharp', 'x/index.mjs']), {
    check: true,
    sharp: 'x/index.mjs',
  });
  assert.throws(() => parseArgs(['--checkk']), /Unknown/);
  assert.throws(() => parseArgs(['--check', '--check']), /repeated/);
  assert.throws(() => parseArgs(['--sharp']), /needs a path/);
  assert.throws(() => parseArgs(['--sharp', '--check']), /needs a path/);
});

test('PSNR is infinite for identical pixels and drops with error', () => {
  const a = Buffer.from([10, 20, 30, 40]);
  assert.equal(psnr(a, Buffer.from(a)), Infinity);
  const near = psnr(a, Buffer.from([11, 20, 30, 40]));
  const far = psnr(a, Buffer.from([30, 20, 30, 40]));
  assert.ok(near > far && far > 0);
  assert.throws(() => psnr(a, Buffer.from([1])), /equal/);
});

test('a version 3 entry keeps its original file and every provenance hash', () => {
  const v3 = {
    file: 'aaaaaaaaaaaaaaaaaaaa.webp',
    sha256: 'a'.repeat(64),
    width: 1024,
    height: 1024,
    map_ids: ['Intersever/Abyss/Abyss_Reshanta_A'],
    source_sha256: 'b'.repeat(64),
    rgba_sha256: 'c'.repeat(64),
  };
  const delivered = { file: 'dddddddddddddddddddd.webp', sha256: 'd'.repeat(64), psnr_db: 45.1 };
  const v4 = deliveredEntry(v3, delivered);
  assert.deepEqual(v4, {
    file: delivered.file,
    sha256: delivered.sha256,
    width: 1024,
    height: 1024,
    map_ids: v3.map_ids,
    source_sha256: v3.source_sha256,
    rgba_sha256: v3.rgba_sha256,
    original: { file: v3.file, sha256: v3.sha256, format: 'lossless WebP (VP8L)' },
    psnr_db: 45.1,
  });
  // Regenerating from version 4 reads the archived original, not the delivered file.
  assert.deepEqual(originalOf(v4), { ...originalOf(v3), format: 'lossless WebP (VP8L)' });
  assert.deepEqual(deliveredEntry(v4, delivered), v4);
});

test('catalogue relinking replaces only known map art references', () => {
  const renames = new Map([['aaaaaaaaaaaaaaaaaaaa.webp', 'bbbbbbbbbbbbbbbbbbbb.webp']]);
  const text = '{"file":"/pet-map-art/aaaaaaaaaaaaaaaaaaaa.webp","x":0}';
  assert.equal(
    relinkCatalogue(text, renames),
    '{"file":"/pet-map-art/bbbbbbbbbbbbbbbbbbbb.webp","x":0}',
  );
  assert.throws(
    () => relinkCatalogue('"/pet-map-art/cccccccccccccccccccc.webp"', renames),
    /unknown map art/,
  );
});
