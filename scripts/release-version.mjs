import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'Cargo.lock',
];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const cargoPattern = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m;
const lockPattern = /(\[\[package\]\]\r?\nname = "aion-companion"\r?\nversion = ")[^"]+(")/;
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));

export function nextVersion(current, bump = 'patch', tags = []) {
  if (!semver.test(current)) throw new Error(`Invalid version: ${current}`);
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error(`Invalid bump: ${bump}`);
  const compare = (a, b) => {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  let parts = current.split('.').map(Number);
  for (const tag of tags) {
    const version = tag.replace(/^v/, '');
    if (!semver.test(version)) continue;
    const candidate = version.split('.').map(Number);
    if (compare(candidate, parts) > 0) parts = candidate;
  }
  if (bump === 'major') return `${parts[0] + 1}.0.0`;
  if (bump === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

export function projectVersion(root) {
  const app = json(root, 'package.json').version;
  const lock = json(root, 'package-lock.json');
  const cargo = read(root, 'src-tauri/Cargo.toml')
    .match(cargoPattern)?.[0]
    .match(/version\s*=\s*"([^"]+)"/)?.[1];
  const cargoLock = read(root, 'Cargo.lock')
    .match(lockPattern)?.[0]
    .match(/version = "([^"]+)"/)?.[1];
  const versions = [
    app,
    lock.version,
    lock.packages?.['']?.version,
    json(root, 'src-tauri/tauri.conf.json').version,
    cargo,
    cargoLock,
  ];
  if (!semver.test(app) || versions.some((version) => version !== app)) {
    throw new Error(`App versions are out of sync: ${versions.join(', ')}`);
  }
  return app;
}

/** Replace only the requested version string, retaining the manifest's exact formatting. */
function versionString(source, path, version) {
  const expected = JSON.parse(source);
  const parent = path.slice(0, -1).reduce((value, key) => value[key], expected);
  const key = path.at(-1);
  const previous = parent[key];
  parent[key] = version;
  const target = JSON.stringify(expected);
  // Re-parsing proves which property matched, even when dependencies have the same version
  // or nested objects appear before the root version. No unrelated string may change.
  for (const match of source.matchAll(/"version"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    if (JSON.parse(match[1]) !== previous) continue;
    const start = match.index + match[0].length - match[1].length;
    const candidate =
      source.slice(0, start) + JSON.stringify(version) + source.slice(start + match[1].length);
    try {
      if (JSON.stringify(JSON.parse(candidate)) === target) return candidate;
    } catch {
      // A matching fragment inside a JSON string is not a property.
    }
  }
  throw new Error(`Could not locate version property: ${path.join('.')}`);
}

export function bumpProject(root, bump, tags = []) {
  const version = nextVersion(projectVersion(root), bump, tags);
  const outputs = new Map();
  for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
    let source = versionString(read(root, file), ['version'], version);
    if (file === 'package-lock.json')
      source = versionString(source, ['packages', '', 'version'], version);
    outputs.set(file, source);
  }
  outputs.set(
    'src-tauri/Cargo.toml',
    read(root, 'src-tauri/Cargo.toml').replace(cargoPattern, `$1${version}$2`),
  );
  outputs.set('Cargo.lock', read(root, 'Cargo.lock').replace(lockPattern, `$1${version}$2`));
  for (const [file, value] of outputs) writeFileSync(join(root, file), value);
  if (projectVersion(root) !== version) throw new Error('Version update verification failed');
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === '--check')) {
    console.log(projectVersion(root));
  } else if (args.length === 2 && args[0] === '--bump') {
    const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    console.log(bumpProject(root, args[1], tags));
  } else {
    throw new Error('Usage: node scripts/release-version.mjs [--check | --bump patch|minor|major]');
  }
}
