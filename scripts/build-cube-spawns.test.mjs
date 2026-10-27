import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readCubeGroups, readGatheringGroups } from './build-cube-spawns.mjs';

const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
};
const fstring = (text) =>
  Buffer.concat([i32(Buffer.byteLength(text) + 1), Buffer.from(text + '\0')]);
const structArray = (name, type, count, payload, size = payload.length) => {
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(size));
  return Buffer.concat([
    i32(count),
    fstring(name),
    fstring('StructProperty'),
    length,
    fstring(type),
    Buffer.alloc(17),
    payload,
  ]);
};
const groupName = 'EnvObj_L1_Test_HiddenCube_01';
function group(points, { size, name = groupName } = {}) {
  const ids = Buffer.concat([i32(1200039), i32(1200041)]);
  const placements = Buffer.alloc(points.length * 48);
  for (let p = 0; p < points.length; p++)
    [...points[p], 123.5, -45.25, 67.125].forEach((value, axis) =>
      placements.writeDoubleLE(value, p * 48 + axis * 8),
    );
  return Buffer.concat([
    fstring(name),
    structArray('NpcIdList', 'TableItemId', 0, Buffer.alloc(0)),
    structArray('EnvObjIdList', 'TableItemId', 2, ids),
    i32(0),
    structArray('Positions', 'MapData_Position', points.length, placements, size),
  ]);
}
function file(...parts) {
  const header = Buffer.from('123,456');
  const bytes = Buffer.concat([i32(header.length), header, ...parts]);
  const mask = [0x25, 0xa8, 0x7e, 0x91];
  return bytes.map((value, index) => value ^ mask[index % 4]);
}

test('native XYZ arrays preserve eight-byte precision and separate rotation with a 48-byte stride', () => {
  const points = [
    [12.25 + 2 ** -30, -34.5, 56.75],
    [-123.125, 234.25, -345.5],
  ];
  const [parsed] = readCubeGroups(file(group(points)));
  assert.equal(parsed.id, groupName);
  assert.deepEqual(parsed.env_object_ids, [1200039, 1200041]);
  assert.deepEqual(parsed.points, points);
});

test('reference-table group names cannot create placements or duplicate a real group', () => {
  const references = Buffer.concat([fstring(groupName), i32(998), fstring(groupName), i32(999)]);
  const parsed = readCubeGroups(file(references, group([[10, 20, 30]]), references));
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].points, [[10, 20, 30]]);
});

test('gathering reads typed placements for all six categories without including cube or reference strings', () => {
  const names = ['Food', 'Gemstone', 'Herb', 'Od', 'Ore', 'Wood'].map(
    (c) => `Gather_Source_${c}_L_lv1_A`,
  );
  const input = file(
    fstring(names[0]),
    i32(99),
    group([[90, 80, 70]]),
    ...names.map((name, i) => group([[i + 0.123456789, -i, 80]], { name })),
  );
  const groups = readGatheringGroups(input);
  assert.deepEqual(
    groups.map((g) => g.id),
    names,
  );
  assert.deepEqual(
    groups.map((g) => g.points[0]),
    names.map((_, i) => [i + 0.123456789, -i, 80]),
  );
  assert.equal(readCubeGroups(input).length, 1);
  assert.throws(
    () => readGatheringGroups(file(group([[1, 2, 3]], { name: names[0], size: 40 }))),
    /size mismatch/,
  );
});

test('corrupt arrays, truncated data and duplicate placement groups reject the whole extraction', () => {
  assert.throws(() => readCubeGroups(file(group([[1, 2, 3]], { size: 24 }))), /size mismatch/);
  const complete = file(group([[1, 2, 3]]));
  assert.throws(() => readCubeGroups(complete.subarray(0, complete.length - 1)), /Truncated/);
  assert.throws(() => readCubeGroups(file(group([[1, 2, 3]]), group([[4, 5, 6]]))), /Duplicate/);
  assert.throws(() => readCubeGroups(Buffer.alloc(20)), /Unsupported/);
});

test('non-finite and off-map locations are rejected instead of projected onto a different map', () => {
  for (const point of [
    [NaN, 0, 0],
    [0, Infinity, 0],
    [409_601, 0, 0],
    [0, -409_601, 0],
  ])
    assert.throws(() => readCubeGroups(file(group([point]))), /Invalid native cube coordinates/);
});

test('bundled candidates retain original native groups, unique XYZ, source hashes and confirmed coverage', () => {
  const catalogue = JSON.parse(
    readFileSync(new URL('../frontend/src/data/cube-spawns.json', import.meta.url), 'utf8'),
  );
  assert.equal(catalogue.version, 1);
  assert.equal(catalogue.provenance.app_id, 3393110);
  assert.equal(catalogue.provenance.build_id, '26077854');
  assert.match(catalogue.provenance.archive.sha256, /^[a-f0-9]{64}$/);
  const expected = new Map([
    ['World/World_L/World_L_A', [95, 1440]],
    ['World/World_D/World_D_A', [59, 1371]],
  ]);
  assert.equal(catalogue.maps.length, expected.size);
  for (const map of catalogue.maps) {
    const [groups, count] = expected.get(map.map_id);
    assert.equal(map.source_member, `AION2/Content/Data/Map/${map.map_id}/MapData.dat`);
    assert.match(map.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(map.groups.length, groups);
    assert.equal(new Set(map.groups.map((g) => g.id)).size, groups);
    const points = map.groups.flatMap((g) => g.points);
    assert.equal(points.length, count);
    assert.equal(new Set(points.map((point) => point.join(','))).size, count);
    for (const point of points) {
      assert.equal(point.length, 3);
      assert.ok(point.every(Number.isFinite));
      assert.ok(Math.abs(point[0]) <= 409_600 && Math.abs(point[1]) <= 409_600);
    }
  }
});
