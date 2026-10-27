import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildMapPacks, MAGIC, parseArgs } from './build-map-packs.mjs';

const image = (text, membership) => {
  const bytes = Buffer.from(text);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { entry: { file: `${sha256.slice(0, 20)}.webp`, sha256, ...membership }, bytes };
};

test('packs only the requested map, including its overview, in deterministic order', async () => {
  const a = image('tile-a', { map_ids: ['World/A'] });
  const overview = image('overview-a', { map_id: 'World/A' });
  const b = image('tile-b', { map_ids: ['World/B'] });
  const data = new Map([a, overview, b].map(({ entry, bytes }) => [entry.file, bytes]));
  const manifest = {
    maps: [{ id: 'World/A' }, { id: 'World/B' }],
    images: [a.entry, b.entry],
    overviews: [overview.entry],
  };
  const packs = await buildMapPacks(manifest, async (file) => data.get(file));
  assert.equal(packs.length, 2);
  assert.deepEqual(
    packs[0].metadata.files.map((file) => file.file).sort(),
    [a.entry.file, overview.entry.file].sort(),
  );
  assert.deepEqual(
    packs[1].metadata.files.map((file) => file.file),
    [b.entry.file],
  );
  assert.ok(packs[0].bytes.subarray(0, 8).equals(MAGIC));
  assert.equal(packs[1].bytes.readUInt32LE(8), b.bytes.length);
  assert.deepEqual(packs[1].bytes.subarray(12), b.bytes);
  assert.equal(packs[0].metadata.sha256, createHash('sha256').update(packs[0].bytes).digest('hex'));
  assert.deepEqual(
    packs,
    await buildMapPacks({ ...manifest, images: [...manifest.images].reverse() }, async (file) =>
      data.get(file),
    ),
  );
});

test('rejects changed image bytes, unknown paths and repeated entries before packaging', async () => {
  const a = image('tile', { map_ids: ['World/A'] });
  const manifest = { maps: [{ id: 'World/A' }], images: [a.entry], overviews: [] };
  await assert.rejects(
    buildMapPacks(manifest, async () => Buffer.from('corrupt')),
    /checksum/,
  );
  await assert.rejects(
    buildMapPacks(
      { ...manifest, images: [{ ...a.entry, file: '../tile.webp' }] },
      async () => a.bytes,
    ),
    /Invalid/,
  );
  await assert.rejects(
    buildMapPacks({ ...manifest, images: [a.entry, a.entry] }, async () => a.bytes),
    /repeated/,
  );
});

test('index checks never write and output mode requires an explicit directory', () => {
  assert.deepEqual(parseArgs([]), { mode: 'check' });
  assert.deepEqual(parseArgs(['--check']), { mode: 'check' });
  assert.deepEqual(parseArgs(['--write-index']), { mode: 'write' });
  assert.deepEqual(parseArgs(['--output', 'a directory']), {
    mode: 'output',
    output: 'a directory',
  });
  assert.throws(() => parseArgs(['--output']), /Usage/);
  assert.throws(() => parseArgs(['--chek']), /Usage/);
});
