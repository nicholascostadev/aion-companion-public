import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artEntries,
  compactEntry,
  originalOf,
  premultipliedPsnr,
  SETS,
} from './build-compact-art.mjs';

test('portraits keep their native size; icons are delivered at 128 px', () => {
  assert.equal(SETS['pet-art'].delivery.size, 256);
  assert.equal(SETS['game-art'].delivery.size, 128);
  assert.equal(SETS['resource-art'].delivery.size, 128);
  for (const { delivery } of Object.values(SETS)) {
    assert.ok(delivery.quality >= 85);
    assert.ok(delivery.min_psnr_db >= 23);
  }
});

test('a first delivery keeps the original file, its checksum and every provenance field', () => {
  const entry = {
    pet_id: 1001,
    source:
      'https://assets.playnccdn.com/static-aion2-gamedata/resources/UT_Vehicle_Portrait_X.png',
    sha256: 'a'.repeat(64),
    file: 'aaaaaaaaaaaaaaaaaaaa.png',
    original_key: 'X',
    width: 256,
    height: 256,
  };
  const delivered = {
    file: 'bbbbbbbbbbbbbbbbbbbb.webp',
    sha256: 'b'.repeat(64),
    width: 256,
    height: 256,
    psnr_db: 33.3,
  };
  const compact = compactEntry(entry, delivered, 'PNG');
  assert.deepEqual(compact, {
    file: delivered.file,
    sha256: delivered.sha256,
    width: 256,
    height: 256,
    pet_id: 1001,
    source: entry.source,
    original_key: 'X',
    original: { file: entry.file, sha256: entry.sha256, width: 256, height: 256, format: 'PNG' },
    psnr_db: 33.3,
  });
  // Encoding again reads the archived original, never the delivered file.
  assert.deepEqual(originalOf(compact), { ...originalOf(entry), format: 'PNG' });
  assert.deepEqual(compactEntry(compact, delivered, 'PNG'), compact);
});

test('art entries are exactly the objects that name a file', () => {
  const game = {
    classes: { Gladiator: { file: 'g' } },
    skills: { 1: { file: 's' }, 2: { base: 1 } },
  };
  assert.deepEqual(
    artEntries('game-art', game).map((e) => e.file),
    ['g', 's'],
  );
  const resource = { odyle: { file: 'o' }, cube: { file: 'c' }, gathering: { k: { file: 'k' } } };
  assert.deepEqual(
    artEntries('resource-art', resource).map((e) => e.file),
    ['o', 'c', 'k'],
  );
  assert.deepEqual(artEntries('pet-art', { images: [{ file: 'p' }] }), [{ file: 'p' }]);
});

test('PSNR ignores colour under fully transparent pixels but counts alpha', () => {
  const clear = Buffer.from([10, 20, 30, 0, 200, 100, 50, 255]);
  const recoloured = Buffer.from([90, 0, 255, 0, 200, 100, 50, 255]);
  assert.equal(premultipliedPsnr(clear, recoloured), Infinity);
  const alpha = Buffer.from([10, 20, 30, 40, 200, 100, 50, 255]);
  assert.ok(premultipliedPsnr(clear, alpha) < 30);
  assert.throws(() => premultipliedPsnr(clear, Buffer.from([1, 2, 3, 4])), /equal/);
});
