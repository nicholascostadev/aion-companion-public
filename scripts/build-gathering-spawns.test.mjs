import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gatheringResources } from './build-gathering-spawns.mjs';

const row = (id = 1500045) => ({
  id,
  category: 'food',
  name: { en: 'Kukuru', 'pt-BR': 'Kukuru' },
  icon_key: null,
  item_id: 610680044,
  native: {
    usage: 'EEnvObjectUsage::GatherSource',
    gather_source_id: 1081006,
    gather_alias: 'Native_Alias',
    material_group: 'Native_Group',
    name_key: 'Native_Name',
    item_icon_key: 'Icon_Item_Gather_Food_L_c_002',
    material_variants: [
      {
        value: 1,
        item: { itemId: 610680044, alias: 'Native_Item', icon: 'Icon_Item_Gather_Food_L_c_002' },
      },
    ],
  },
});
const groups = [
  { id: 'Gather_Source_Food_L_lv4_A', env_object_ids: [1500045], points: [[1, 2, 3]] },
];

test('metadata joins require every original environment ID and never infer requirements from lv tokens', () => {
  const resources = gatheringResources(groups, { version: 1, resources: [row()] });
  assert.equal(resources[0].name.en, 'Kukuru');
  assert.equal(resources[0].icon_key, null);
  assert.ok(!Object.hasOwn(resources[0], 'required_level'));
  assert.ok(!Object.hasOwn(resources[0], 'required_skill'));
  assert.throws(() => gatheringResources(groups, { version: 1, resources: [] }), /Unresolved/);
  assert.throws(
    () => gatheringResources(groups, { version: 1, resources: [row(), row()] }),
    /ambiguous/,
  );
  assert.throws(
    () => gatheringResources(groups, { version: 1, resources: [row(99)] }),
    /ambiguous/,
  );
  assert.throws(
    () => gatheringResources(groups, { version: 1, resources: [{ ...row(), category: 'herb' }] }),
    /category mismatch/,
  );
  assert.throws(
    () =>
      gatheringResources(groups, {
        version: 1,
        resources: [{ ...row(), icon_key: 'Icon_Item_Gather_Wrong' }],
      }),
    /Broken native/,
  );
});

test('bundled gathering retains all 5401 original placements with resolved identities, categories, localized names and source hashes', () => {
  const data = JSON.parse(
    readFileSync(new URL('../frontend/src/data/gathering-spawns.json', import.meta.url)),
  );
  const art = JSON.parse(
    readFileSync(new URL('../frontend/src/data/resource-art.json', import.meta.url)),
  ).gathering;
  assert.equal(data.version, 1);
  assert.equal(data.provenance.build_id, '26077854');
  assert.equal(data.provenance.app_id, 3393110);
  assert.match(data.provenance.archive.sha256, /^[a-f0-9]{64}$/);
  assert.equal(data.provenance.metadata.length, 7);
  for (const source of data.provenance.metadata) {
    assert.match(source.member, /\.dat$/);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  const resources = new Map(data.resources.map((r) => [r.id, r]));
  assert.equal(data.resources.length, 27);
  assert.equal(resources.size, 27);
  assert.deepEqual([...new Set(data.resources.map((r) => r.category))].sort(), [
    'aether',
    'food',
    'gemstone',
    'herb',
    'ore',
    'wood',
  ]);
  for (const resource of resources.values()) {
    assert.ok(resource.name.en && resource.name['pt-BR']);
    assert.ok(resource.item_id > 0 && resource.native.gather_source_id > 0);
    if (resource.icon_key !== null) {
      assert.equal(resource.icon_key, resource.native.item_icon_key);
      assert.equal(art[resource.icon_key].original_key, resource.icon_key);
    }
  }
  const expected = new Map([
    ['World/World_L/World_L_A', [130, 2709]],
    ['World/World_D/World_D_A', [39, 2692]],
  ]);
  const placementHashes = new Map([
    ['World/World_L/World_L_A', 'f86092ba355ef3d68ac15f65fe4e89c3c5943ebf53bd85b3df9ae6fcb666af58'],
    ['World/World_D/World_D_A', '1435fb18eb8f83d41894996cdc388f90852ff5ab2c04014d0281183c88bcba72'],
  ]);
  assert.equal(data.maps.length, expected.size);
  const used = new Set();
  for (const map of data.maps) {
    const [n, count] = expected.get(map.map_id);
    assert.equal(map.groups.length, n);
    assert.equal(
      createHash('sha256').update(JSON.stringify(map.groups)).digest('hex'),
      placementHashes.get(map.map_id),
    );
    assert.equal(new Set(map.groups.map((g) => g.id)).size, n);
    assert.equal(
      map.groups.reduce((n, g) => n + g.points.length, 0),
      count,
    );
    assert.match(map.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(map.source_member, `AION2/Content/Data/Map/${map.map_id}/MapData.dat`);
    for (const group of map.groups) {
      assert.equal(group.env_object_ids.length, 1);
      const id = group.env_object_ids[0];
      used.add(id);
      assert.ok(resources.has(id));
      for (const point of group.points) {
        assert.equal(point.length, 3);
        assert.ok(point.every(Number.isFinite));
        assert.ok(Math.abs(point[0]) <= 409600 && Math.abs(point[1]) <= 409600);
      }
    }
  }
  assert.equal(used.size, 27);
  assert.equal(resources.get(1500045).name.en, 'Kukuru');
  assert.equal(resources.get(1550041).name.en, 'Morfa');
});
