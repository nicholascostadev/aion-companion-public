import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('..', import.meta.url));
const bash =
  process.platform === 'win32'
    ? ([
        path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe'),
        path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Git/bin/bash.exe'),
      ].find(existsSync) ?? 'bash')
    : 'bash';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'aion bash workflow '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'node_modules'));
  mkdirSync(path.join(root, 'tools'));
  cpSync(path.join(repository, 'dev.sh'), path.join(root, 'dev.sh'));
  cpSync(path.join(repository, 'scripts/dev-env.sh'), path.join(root, 'scripts/dev-env.sh'));
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const log = path.join(root, 'calls');
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'),
  );
  environment.PATH = `${path.join(root, 'tools')}${path.delimiter}${process.env.PATH ?? process.env.Path}`;
  environment.AION_TEST_LOG = log.replaceAll('\\', '/');
  const stub = [
    '#!/usr/bin/env bash',
    'tool=$(basename -- "$0")',
    'printf \'%s\\0\' "$tool" "$@" >> "$AION_TEST_LOG"',
    'printf \'\\0\' >> "$AION_TEST_LOG"',
    'if [[ "$tool:$*" == "${AION_TEST_FAIL:-}" ]]; then exit 7; fi',
    '',
  ].join('\n');
  for (const name of ['node', 'npm', 'cargo', 'powershell.exe', 'gh']) {
    writeFileSync(path.join(root, 'tools', name), stub, { mode: 0o755 });
  }
  return {
    root,
    run(args, extra = {}) {
      const result = spawnSync(
        bash,
        ['--noprofile', '--norc', path.join(root, 'dev.sh'), ...args],
        {
          cwd: tmpdir(),
          env: { ...environment, ...extra },
          encoding: 'utf8',
        },
      );
      const calls = existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\0\0')
            .filter(Boolean)
            .map((record) => record.split('\0'))
        : [];
      return { ...result, calls };
    },
  };
}

test('build keeps a target containing spaces in one argument and selects Dev identity', (t) => {
  const f = fixture(t);
  const result = f.run(['build', '--target-dir', 'target with spaces']);
  assert.equal(result.status, 0, result.stderr);
  const build = result.calls.find(([tool]) => tool === 'cargo');
  assert.deepEqual(build.slice(1, -1), [
    'build',
    '--locked',
    '-p',
    'aion-companion',
    '--features',
    'custom-protocol,development',
    '--target-dir',
  ]);
  assert.ok(build.at(-1).replaceAll('\\', '/').endsWith('/target with spaces'));
  const publish = result.calls.find(([tool]) => tool === 'powershell.exe');
  assert.equal(publish.at(-2), '-Executable');
  assert.equal(publish.at(-1), `${build.at(-1)}/debug/aion-companion.exe`);
});

for (const failure of [
  'npm:run build',
  'cargo:build --locked -p aion-companion --features custom-protocol,development --target-dir',
]) {
  test(`a failed ${failure.split(':')[0]} command stops before publication`, (t) => {
    const f = fixture(t);
    const target = path.join(f.root, 'output').replaceAll('\\', '/');
    const fail = failure.startsWith('cargo:') ? `${failure} ${target}` : failure;
    const result = f.run(['build', '--target-dir', target], { AION_TEST_FAIL: fail });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(
      result.calls.some(([tool]) => tool === 'powershell.exe'),
      false,
    );
  });
}

test('dev delegates to the existing mutex and profile host without a standalone build', (t) => {
  const result = fixture(t).run(['dev']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.calls.some(([tool]) => tool === 'cargo'),
    false,
  );
  const host = result.calls.find(([tool]) => tool === 'powershell.exe');
  assert.ok(host.includes('-File'));
  assert.ok(host.some((arg) => arg.endsWith('/scripts/start-dev.ps1')));
  assert.equal(host.at(-2), '-TargetDirectory');
});

test('native checks build embedded assets first and include both native identities', (t) => {
  const result = fixture(t).run(['check', '--native']);
  assert.equal(result.status, 0, result.stderr);
  const frontend = result.calls.findIndex((args) => args.join(' ') === 'npm run build');
  const native = result.calls.filter(([tool]) => tool === 'cargo');
  assert.ok(frontend > 0);
  assert.ok(result.calls.indexOf(native[0]) > frontend);
  assert.ok(native[0].includes('companion-core'));
  assert.ok(native[0].includes('companion-capture'));
  assert.ok(native[0].includes('aion-companion'));
  assert.ok(native[1].includes('custom-protocol,development'));
  assert.equal(result.calls.filter(([tool]) => tool === 'powershell.exe').length, 2);
});

test('an arbitrary exec preserves arguments and propagates the command exit status', (t) => {
  const result = fixture(t).run(['exec', '--', 'npm', 'argument with spaces'], {
    AION_TEST_FAIL: 'npm:argument with spaces',
  });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(result.calls, [['npm', 'argument with spaces']]);
});

test('stable installation passes the selected version without building a local executable', (t) => {
  const result = fixture(t).run(['install-stable', '--version', '0.7.11', '--run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].slice(-3), ['-Version', '0.7.11', '-Run']);
});

test('packaging accepts an absolute output directory containing spaces', (t) => {
  const f = fixture(t);
  const result = f.run([
    'package',
    '--executable',
    'release app.exe',
    '--output-dir',
    path.join(f.root, 'release output'),
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  const command = result.calls[0];
  assert.ok(command.at(-3).endsWith('/release app.exe'));
  assert.equal(command.at(-2), '-OutputDirectory');
  assert.ok(command.at(-1).endsWith('/release output'));
});

test('a failed Windows adapter propagates its failure', (t) => {
  const f = fixture(t);
  // Use a stub that always fails, including when paths contain spaces.
  writeFileSync(path.join(f.root, 'tools/powershell.exe'), '#!/usr/bin/env bash\nexit 9\n', {
    mode: 0o755,
  });
  const result = f.run(['dev']);
  assert.equal(result.status, 9, result.stderr);
});

test(
  'the existing PowerShell shortcut entry point forwards paths with spaces to Bash',
  { skip: process.platform !== 'win32' },
  (t) => {
    const f = fixture(t);
    cpSync(path.join(repository, 'build.ps1'), path.join(f.root, 'build.ps1'));
    writeFileSync(
      path.join(f.root, 'dev.sh'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\nexit 7\n',
    );
    const target = path.join(f.root, 'build output');
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(f.root, 'build.ps1'),
        '-Dev',
        '-Run',
        '-Test',
        '-TargetDirectory',
        target,
      ],
      { cwd: tmpdir(), encoding: 'utf8' },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['dev', '--target-dir', target]);
    assert.match(result.stderr, /exit 7/);
  },
);

for (const args of [
  ['build', '--target-dir'],
  ['dev', '--run'],
  ['check', '--bogus'],
  ['install-stable', '--version', '--run'],
  ['exec'],
]) {
  test(`invalid arguments fail before a build or Windows operation: ${args.join(' ')}`, (t) => {
    const result = fixture(t).run(args);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(result.calls, []);
  });
}
