/**
 * Build-time metadata extraction from original, unpacked AION 2 MapData.dat files.
 * This restricted reader handles the object-group layout verified in Steam build 26077854.
 * It is not a general Unreal parser and is never called by the running application.
 * Format facts and native-source provenance: docs/CUBE_SPAWN_DATA_RESEARCH.md.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MASK = [0x25, 0xa8, 0x7e, 0x91];
const WORLD_HALF = 409_600;
const MAPS = ['World/World_L/World_L_A', 'World/World_D/World_D_A'];
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const NPC_TAG = Buffer.concat([Buffer.from([10, 0, 0, 0]), Buffer.from('NpcIdList\0')]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Read only structurally identified native cube groups, preserving all XYZ precision. */
export function readCubeGroups(raw) {
  return readPlacementGroups(raw, 'cube');
}

/** Gathering groups use the same typed native placement layout, not reference strings. */
export function readGatheringGroups(raw) {
  return readPlacementGroups(raw, 'gathering');
}

function readPlacementGroups(raw, kind) {
  if (raw.length < 8 || raw.length > MAX_FILE_BYTES) throw new Error('Unsupported map file size');
  const bytes = Buffer.from(raw);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= MASK[i % MASK.length];
  const range = (at, size) => {
    if (
      !Number.isSafeInteger(at) ||
      !Number.isSafeInteger(size) ||
      at < 0 ||
      size < 0 ||
      at + size > bytes.length
    )
      throw new Error('Truncated native map field');
  };
  const i32 = (at) => {
    range(at, 4);
    return bytes.readInt32LE(at);
  };
  const string = (at, maximum = 512) => {
    const size = i32(at);
    if (size < 1 || size > maximum) throw new Error('Unsupported native string');
    range(at + 4, size);
    if (bytes[at + size + 3] !== 0) throw new Error('Unterminated native string');
    return { text: bytes.toString('utf8', at + 4, at + size + 3), end: at + 4 + size };
  };
  // This build's initial ID table is length-prefixed UTF-8 without a trailing
  // NUL. Property/group FStrings below do include their terminator.
  const headerSize = i32(0);
  if (headerSize < 1 || headerSize > 1024 * 1024) throw new Error('Unsupported native map header');
  range(4, headerSize);
  if (!/^\d+(?:,\d+)*$/.test(bytes.toString('utf8', 4, 4 + headerSize)))
    throw new Error('Unsupported native map header');

  const array = (at, expectedName, expectedStruct, stride) => {
    const count = i32(at);
    if (count < 0 || count > 4096) throw new Error('Unsupported native array length');
    const name = string(at + 4);
    const inner = string(name.end);
    range(inner.end, 8);
    const size = bytes.readBigUInt64LE(inner.end);
    const struct = string(inner.end + 8);
    if (
      name.text !== expectedName ||
      inner.text !== 'StructProperty' ||
      struct.text !== expectedStruct
    )
      throw new Error(`Unexpected native array type: ${expectedName}`);
    if (size !== BigInt(count * stride))
      throw new Error(`Native array size mismatch: ${expectedName}`);
    range(struct.end, 17);
    let data = struct.end + 17;
    const hasGuid = bytes[data - 1];
    if (hasGuid === 1) {
      range(data, 16);
      data += 16;
    } else if (hasGuid !== 0) throw new Error('Unsupported native GUID flag');
    range(data, Number(size));
    return { count, data, end: data + Number(size) };
  };

  const groups = [];
  const names = new Set();
  const pattern =
    kind === 'cube'
      ? /EnvObj_[A-Za-z0-9_]*Hidden(?:Cube|Box)[A-Za-z0-9_]*\x00/g
      : /[A-Za-z0-9_]*Gather_Source_(?:Food|Gemstone|Herb|Od|Ore|Wood)_[A-Za-z0-9_]*\x00/g;
  for (const match of bytes.toString('latin1').matchAll(pattern)) {
    const at = match.index;
    if (at < 4 || i32(at - 4) !== match[0].length) continue;
    const name = string(at - 4);
    // The same names also occur in reference tables. Only a following typed spawn
    // array identifies a placement record; reference strings cannot discover points.
    const tag = name.end + 4;
    if (!bytes.subarray(tag, tag + NPC_TAG.length).equals(NPC_TAG)) continue;
    const npcs = array(name.end, 'NpcIdList', 'TableItemId', 4);
    const objects = array(npcs.end, 'EnvObjIdList', 'TableItemId', 4);
    if (npcs.count !== 0 || objects.count === 0 || i32(objects.end) !== 0)
      throw new Error(`Unsupported ${kind}-group fields: ${name.text}`);
    const positions = array(objects.end + 4, 'Positions', 'MapData_Position', 48);
    if (positions.count === 0) throw new Error(`${kind} group has no placements`);
    if (names.has(name.text)) throw new Error(`Duplicate native ${kind} group`);
    names.add(name.text);
    const env_object_ids = Array.from({ length: objects.count }, (_, index) => {
      const id = bytes.readUInt32LE(objects.data + index * 4);
      if (id === 0) throw new Error(`${kind} group has an empty object identifier`);
      return id;
    });
    const points = Array.from({ length: positions.count }, (_, index) => {
      // Each 48-byte placement is XYZ location then XYZ rotation: six ordinary
      // little-endian doubles. Rotation is validated, never interpreted as location.
      const values = Array.from({ length: 6 }, (_, axis) =>
        bytes.readDoubleLE(positions.data + index * 48 + axis * 8),
      );
      if (
        !values.every(Number.isFinite) ||
        Math.abs(values[0]) > WORLD_HALF ||
        Math.abs(values[1]) > WORLD_HALF ||
        Math.abs(values[2]) > 10_000_000
      )
        throw new Error(`Invalid native ${kind} coordinates: ${name.text}`);
      return values.slice(0, 3);
    });
    groups.push({ id: name.text, env_object_ids, points });
    if (groups.length > 4096) throw new Error(`Too many native ${kind} groups`);
  }
  if (groups.length === 0) throw new Error(`No supported native ${kind} groups found`);
  return groups;
}

/** Build an app-owned catalogue from two original map members and their source metadata. */
export async function buildCubeCatalogue(
  mapRoot,
  archive,
  steamManifest,
  extractedAt = new Date().toISOString(),
) {
  return buildNativeMapCatalogue(mapRoot, archive, steamManifest, readCubeGroups, extractedAt);
}

/** Shared provenance for independently read native object-placement layers. */
export async function buildNativeMapCatalogue(
  mapRoot,
  archive,
  steamManifest,
  readGroups,
  extractedAt = new Date().toISOString(),
) {
  const manifest = readFileSync(steamManifest, 'utf8');
  if (!/"appid"\s+"3393110"/.test(manifest)) throw new Error('Expected AION 2 Steam manifest');
  const buildId = manifest.match(/"buildid"\s+"(\d+)"/)?.[1];
  if (!buildId) throw new Error('Installed Steam build ID unavailable');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  return {
    version: 1,
    maps: MAPS.map((map_id) => {
      const raw = readFileSync(path.join(mapRoot, map_id, 'MapData.dat'));
      return {
        map_id,
        groups: readGroups(raw),
        source_member: `AION2/Content/Data/Map/${map_id}/MapData.dat`,
        source_sha256: sha256(raw),
      };
    }),
    provenance: {
      source: 'installed-aion2-steam-client',
      app_id: 3393110,
      build_id: buildId,
      extracted_at: extractedAt,
      archive: { file: path.basename(archive), sha256: digest.digest('hex') },
      coordinates: { units: 'centimetres', order: 'native XYZ', north: '-Y', east: '+X' },
      copyright: 'Game data copyright NCSOFT / NC Corporation. Separate from the software license.',
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mapRoot, archive, steamManifest, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) {
    console.error(
      'Usage: node scripts/build-cube-spawns.mjs <unpacked map root> <original pak> <Steam app manifest> <output JSON>',
    );
    process.exitCode = 2;
  } else {
    const catalogue = await buildCubeCatalogue(mapRoot, archive, steamManifest);
    writeFileSync(output, JSON.stringify(catalogue, null, 2) + '\n');
    console.log(
      JSON.stringify(
        catalogue.maps.map((map) => ({
          map_id: map.map_id,
          groups: map.groups.length,
          points: map.groups.reduce((n, group) => n + group.points.length, 0),
        })),
      ),
    );
  }
}
