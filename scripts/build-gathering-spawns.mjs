/**
 * Build-time bundling of original client placements and app-owned native metadata
 * extraction results. Never invoked by the app; see docs/GATHERING_RESEARCH.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativeMapCatalogue, readGatheringGroups } from './build-cube-spawns.mjs';

const CATEGORIES = new Set(['food', 'gemstone', 'herb', 'aether', 'ore', 'wood']);

/** Validate every metadata join; an unresolved or ambiguous placement cannot be bundled. */
export function gatheringResources(groups, extraction) {
  if (extraction.version !== 1 || !Array.isArray(extraction.resources))
    throw new Error('Unsupported native resource extraction');
  const ids = new Set(groups.flatMap((g) => g.env_object_ids));
  const resources = new Map();
  for (const row of extraction.resources) {
    if (
      !Number.isSafeInteger(row.id) ||
      !ids.has(row.id) ||
      resources.has(row.id) ||
      !CATEGORIES.has(row.category) ||
      !row.name?.en ||
      !row.name?.['pt-BR'] ||
      !Number.isSafeInteger(row.item_id) ||
      row.item_id < 1 ||
      !(row.icon_key === null || /^Icon_Item_Gather_[A-Za-z0-9_]+$/.test(row.icon_key)) ||
      row.native?.usage !== 'EEnvObjectUsage::GatherSource' ||
      !row.native.gather_source_id ||
      !row.native.gather_alias ||
      !row.native.material_group ||
      !row.native.name_key
    )
      throw new Error(`Invalid or ambiguous native gathering resource: ${row.id}`);
    const material = row.native.material_variants.find((m) => m.value === 1)?.item;
    if (
      material?.itemId !== row.item_id ||
      material.icon !== row.native.item_icon_key ||
      (row.icon_key !== null && row.icon_key !== material.icon)
    )
      throw new Error(`Broken native material/icon join: ${row.id}`);
    resources.set(row.id, {
      id: row.id,
      category: row.category,
      name: row.name,
      icon_key: row.icon_key,
      item_id: row.item_id,
      native: {
        env_alias: row.native.env_alias,
        name_key: row.native.name_key,
        gather_alias: row.native.gather_alias,
        gather_source_id: row.native.gather_source_id,
        gather_type: row.native.gather_type,
        material_group: row.native.material_group,
        item_alias: material.alias,
        item_icon_key: material.icon,
      },
    });
  }
  if (resources.size !== ids.size) throw new Error('Unresolved gathering placement');
  for (const group of groups) {
    if (group.env_object_ids.length !== 1) throw new Error('Ambiguous gathering placement group');
    const category = {
      Food: 'food',
      Gemstone: 'gemstone',
      Herb: 'herb',
      Od: 'aether',
      Ore: 'ore',
      Wood: 'wood',
    }[group.id.match(/Gather_Source_(Food|Gemstone|Herb|Od|Ore|Wood)_/)?.[1]];
    if (resources.get(group.env_object_ids[0])?.category !== category)
      throw new Error('Native gathering category mismatch');
  }
  return [...resources.values()].sort((a, b) => a.id - b.id);
}

export async function buildGatheringCatalogue(
  mapRoot,
  archive,
  steamManifest,
  extraction,
  extractedAt,
) {
  // Reuse the same source/build/hash checks and coordinate convention as cubes.
  const source = await buildNativeMapCatalogue(
    mapRoot,
    archive,
    steamManifest,
    readGatheringGroups,
    extractedAt,
  );
  const maps = source.maps;
  if (extraction.provenance?.client_build !== source.provenance.build_id)
    throw new Error('Metadata and placement client builds differ');
  const tables = extraction.provenance.tables;
  if (
    !Array.isArray(tables) ||
    tables.length !== 7 ||
    tables.some(
      (t) =>
        !/^[a-f0-9]{64}$/.test(t.sha256) ||
        !/^pakchunk[\w-]+\.pak$/.test(t.archive) ||
        !/^AION2\/Content\//i.test(t.member) ||
        t.member.includes('..'),
    )
  )
    throw new Error('Missing native gathering metadata provenance');
  const required = [
    'EnvObjData.dat',
    'GatherSource.dat',
    'GatherSourceMaterial.dat',
    'Item.dat',
    'L10N/en-US/L10NString.dat',
    'L10N/pt-BR/L10NString.dat',
    'key_manifest.dat',
  ];
  if (required.some((name) => tables.filter((t) => t.member.endsWith('/' + name)).length !== 1))
    throw new Error('Incomplete native gathering metadata provenance');
  return {
    version: 1,
    resources: gatheringResources(
      maps.flatMap((m) => m.groups),
      extraction,
    ),
    maps,
    provenance: {
      ...source.provenance,
      metadata: tables,
      availability: 'Possible placements only; no live availability or respawn timing is inferred.',
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mapRoot, archive, steamManifest, metadata, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) {
    console.error(
      'Usage: node scripts/build-gathering-spawns.mjs <unpacked map root> <original pak> <Steam app manifest> <own native resource extraction JSON> <output JSON>',
    );
    process.exitCode = 2;
  } else {
    const catalogue = await buildGatheringCatalogue(
      mapRoot,
      archive,
      steamManifest,
      JSON.parse(readFileSync(metadata, 'utf8')),
    );
    writeFileSync(output, JSON.stringify(catalogue, null, 2) + '\n');
    console.log(
      JSON.stringify(
        catalogue.maps.map((m) => ({
          map_id: m.map_id,
          groups: m.groups.length,
          points: m.groups.reduce((n, g) => n + g.points.length, 0),
        })),
      ),
    );
  }
}
