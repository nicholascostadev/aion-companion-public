import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpProject, nextVersion, projectVersion } from './release-version.mjs';

function removeFixture(root) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(root).startsWith('aion-version-'));
  rmSync(root, { recursive: true, force: true });
}

test('patch/minor/major bumps honor reserved tags and ignore non-release tags', () => {
  assert.equal(nextVersion('0.1.0'), '0.1.1');
  assert.equal(nextVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(nextVersion('1.9.8', 'major'), '2.0.0');
  assert.equal(
    nextVersion('0.1.0', 'patch', ['v0.1.9', 'v0.1.10', 'preview', 'v99.0.0-beta']),
    '0.1.11',
  );
  assert.throws(() => nextVersion('0.1.0', 'invalid'));
  assert.throws(() => nextVersion('not-a-version'));
});

test('a bump keeps npm, Tauri, Cargo and both lock files in sync', () => {
  const root = mkdtempSync(join(tmpdir(), 'aion-version-'));
  try {
    mkdirSync(join(root, 'src-tauri'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'aion-companion', version: '0.1.0' }),
    );
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        version: '0.1.0',
        packages: { '': { version: '0.1.0' }, 'node_modules/example': { version: '2.3.4' } },
      }),
    );
    const tauriConfig =
      '{\r\n  "bundle": {"icon": ["icons/32x32.png", "icons/icon.ico"]},\r\n  "metadata": {"version": "0.1.0"},\r\n  "version": "0.1.0",\r\n  "title": "Aion Companion · Combat workspace"\r\n}\r\n';
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), tauriConfig);
    writeFileSync(
      join(root, 'src-tauri/Cargo.toml'),
      '[package]\nname = "aion-companion"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    writeFileSync(
      join(root, 'Cargo.lock'),
      'version = 4\n\n[[package]]\nname = "aion-companion"\nversion = "0.1.0"\n\n[[package]]\nname = "companion-core"\nversion = "0.1.0"\n',
    );
    assert.equal(projectVersion(root), '0.1.0');
    assert.equal(bumpProject(root, 'minor'), '0.2.0');
    assert.equal(projectVersion(root), '0.2.0');
    assert.equal(
      readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
      tauriConfig.replace('  "version": "0.1.0"', '  "version": "0.2.0"'),
      'Version bumps must retain compact arrays, Unicode, line endings and unrelated versions',
    );
    assert.match(
      readFileSync(join(root, 'Cargo.lock'), 'utf8'),
      /name = "companion-core"\nversion = "0.1.0"/,
    );
    assert.equal(
      JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages['node_modules/example']
        .version,
      '2.3.4',
    );
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"9.0.0"}');
    assert.throws(() => bumpProject(root, 'patch'), /out of sync/);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '0.2.0');
  } finally {
    removeFixture(root);
  }
});

test('release reservation is atomic, rerunnable and honors merge labels', () => {
  const root = mkdtempSync(join(tmpdir(), 'aion-version-'));
  try {
    const repo = join(root, 'work');
    const origin = join(root, 'origin.git');
    mkdirSync(repo);
    mkdirSync(join(repo, 'scripts'));
    mkdirSync(join(repo, 'src-tauri'));
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '--bare', '--initial-branch=master', origin);
    git('init', '--initial-branch=master');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'release-test@example.invalid');
    writeFileSync(join(repo, 'package.json'), '{"version":"0.1.0"}');
    writeFileSync(
      join(repo, 'package-lock.json'),
      '{"version":"0.1.0","packages":{"":{"version":"0.1.0"}}}',
    );
    writeFileSync(join(repo, 'src-tauri/tauri.conf.json'), '{"version":"0.1.0"}');
    writeFileSync(
      join(repo, 'src-tauri/Cargo.toml'),
      '[package]\nname = "aion-companion"\nversion = "0.1.0"\n',
    );
    writeFileSync(
      join(repo, 'Cargo.lock'),
      'version = 4\n[[package]]\nname = "aion-companion"\nversion = "0.1.0"\n',
    );
    for (const file of ['prepare-release.ps1', 'release-version.mjs']) {
      copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(repo, 'scripts', file));
    }
    git('add', '.');
    git('commit', '-m', 'Fixture');
    git('remote', 'add', 'origin', origin);
    git('push', '-u', 'origin', 'master');
    const output = join(root, 'outputs');
    const event = join(root, 'event.json');
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: { labels: [{ name: 'release:minor' }, { name: 'release:major' }] },
      }),
    );
    const reserve = (source, eventName = 'workflow_dispatch') => {
      writeFileSync(output, '');
      execFileSync(
        process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(repo, 'scripts/prepare-release.ps1'),
        ],
        {
          cwd: repo,
          env: {
            ...process.env,
            RELEASE_SOURCE: source,
            GITHUB_OUTPUT: output,
            GITHUB_EVENT_NAME: eventName,
            GITHUB_EVENT_PATH: event,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      return Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split(/\r?\n/)
          .map((line) => line.replace(/^\uFEFF/, '').split('=')),
      );
    };
    const first = reserve('pr-7');
    assert.equal(first.version, '0.1.1');
    assert.equal(git('--git-dir', origin, 'rev-parse', 'master'), first.commit);
    assert.equal(git('--git-dir', origin, 'rev-parse', 'v0.1.1'), first.commit);
    assert.deepEqual(reserve('pr-7'), first);
    assert.equal(git('--git-dir', origin, 'rev-list', '--count', 'master'), '2');
    assert.equal(reserve('pr-8').version, '0.1.2');
    assert.equal(reserve('pr-9', 'pull_request').version, '1.0.0');
    assert.equal(projectVersion(repo), '1.0.0');
  } finally {
    removeFixture(root);
  }
});
