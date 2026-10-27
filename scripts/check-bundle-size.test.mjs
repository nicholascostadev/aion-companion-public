import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundleSizeLimits, checkBundleSize, checkInstallerSize } from './check-bundle-size.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'aion bundle size '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'frontend/public/pet-map-art/nested'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  return root;
}

test('counts nested assets, accepts the exact limit and excludes unshipped source art', async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, 'frontend/public/pet-map-art/nested/tile.webp'),
    Buffer.alloc(10),
  );
  await writeFile(path.join(root, 'frontend/public/icon.png'), Buffer.alloc(5));
  await mkdir(path.join(root, 'artwork-source'));
  await writeFile(path.join(root, 'artwork-source/original.webp'), Buffer.alloc(100));
  const measurements = await checkBundleSize(root, { limits: { maps: 10, public: 15, dist: 20 } });
  assert.deepEqual(
    measurements.map(({ bytes }) => bytes),
    [10, 15],
  );
  assert.ok(measurements.every(({ bytes, limit }) => bytes <= limit));
});

test('detects excess maps, unrelated public assets and built-only payloads', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'frontend/public/pet-map-art/tile.webp'), Buffer.alloc(11));
  await writeFile(path.join(root, 'frontend/public/extra.bin'), Buffer.alloc(20));
  await writeFile(path.join(root, 'dist/accidental-original.webp'), Buffer.alloc(41));
  const measurements = await checkBundleSize(root, {
    built: true,
    limits: { maps: 10, public: 30, dist: 40 },
  });
  assert.deepEqual(
    measurements.map(({ bytes }) => bytes),
    [11, 31, 41],
  );
  assert.ok(measurements.every(({ bytes, limit }) => bytes > limit));
});

test('fails when the built frontend is absent instead of treating it as zero bytes', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'dist'), { recursive: true });
  await assert.rejects(checkBundleSize(root, { built: true }), { code: 'ENOENT' });
});

test('the build command fails on oversized assets and succeeds after they are reduced', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts/check-bundle-size.mjs');
  await copyFile(new URL('./check-bundle-size.mjs', import.meta.url), script);
  const tile = path.join(root, 'frontend/public/pet-map-art/tile.webp');
  await writeFile(tile, '');
  await truncate(tile, bundleSizeLimits.maps + 1);
  const oversized = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(oversized.status, 1, oversized.stderr);
  assert.match(oversized.stdout, /FAIL Map artwork/);
  assert.match(oversized.stderr, /Bundle size budget exceeded/);
  await truncate(tile, 0);
  const reduced = spawnSync(process.execPath, [script, '--dist'], { encoding: 'utf8' });
  assert.equal(reduced.status, 0, reduced.stderr);
  assert.match(reduced.stdout, /OK Built frontend/);
});

test('the on-demand map directory may be absent, but the public directory must exist', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'frontend/public/pet-map-art'), { recursive: true });
  assert.equal((await checkBundleSize(root))[0].bytes, 0);
  await rm(path.join(root, 'frontend/public'), { recursive: true });
  await assert.rejects(checkBundleSize(root), { code: 'ENOENT' });
});

test('installer size checks read paths containing spaces and detect oversized output', async (t) => {
  const root = await fixture(t);
  const installer = path.join(root, 'app setup.exe');
  await writeFile(installer, Buffer.alloc(11));
  const measured = await checkInstallerSize(installer, 10);
  assert.ok(measured.bytes > measured.limit);
  await truncate(installer, 10);
  const reduced = await checkInstallerSize(installer, 10);
  assert.equal(reduced.bytes, reduced.limit);
});
