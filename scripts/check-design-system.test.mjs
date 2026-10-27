import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW, HINTS, scan, walk } from './check-design-system.mjs';

const rules = (file, text) => scan(file, text).map((p) => p.rule);
const feature = 'frontend/src/features/demo/Demo.tsx';

test('colour literals are only allowed in theme.css and the allowlist', () => {
  assert.deepEqual(rules('frontend/src/styles/base.css', 'a { color: #fff; }'), ['colour-literal']);
  assert.deepEqual(rules('frontend/src/styles/utilities.css', 'b { color: oklch(1 0 0); }'), [
    'colour-literal',
  ]);
  assert.deepEqual(rules(feature, "const c = 'rgba(0, 0, 0, 0.4)';"), ['colour-literal']);
  assert.deepEqual(rules(feature, "const c = 'hsl(120 50% 50%)';"), ['colour-literal']);
  assert.deepEqual(rules('frontend/src/styles/theme.css', '--color-x: oklch(0.5 0.1 80);'), []);
  for (const entry of ALLOW) assert.ok(entry.reason.length > 20, `${entry.file} needs a reason`);
  assert.deepEqual(rules('frontend/src/lib/format.ts', "export const a = ['#3987e5'];"), []);
});

test('ids, entities and identifiers are not colours', () => {
  assert.deepEqual(rules(feature, "document.querySelector('#root');"), []);
  assert.deepEqual(rules(feature, "const s = 'tab#add-ons &#123; &#x2014;';"), []);
  assert.deepEqual(rules(feature, 'const x = familyColor(pet); const y = label(x);'), []);
  assert.deepEqual(rules(feature, 'const style = { background: skillColor(id) };'), []);
});

test('Tailwind arbitrary colour values are reported once, as arbitrary values', () => {
  assert.deepEqual(rules(feature, '<i className="bg-[#123456] text-ink" />'), ['arbitrary-colour']);
  assert.deepEqual(rules(feature, '<i className="text-[rgb(1,2,3)]" />'), ['arbitrary-colour']);
  assert.deepEqual(rules(feature, '<i className="shadow-[0_0_8px_#fff]" />'), ['arbitrary-colour']);
  assert.deepEqual(rules(feature, '<i className="[color:oklch(1_0_0)]" />'), ['arbitrary-colour']);
  assert.deepEqual(rules(feature, "'shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]'"), [
    'arbitrary-colour',
  ]);
  assert.deepEqual(rules(feature, '<i className="bg-[white] text-[color:red]" />'), [
    'arbitrary-colour',
    'arbitrary-colour',
  ]);
  assert.deepEqual(rules(feature, '<i className="data-[state=open]:bg-accent-soft" />'), []);
  assert.deepEqual(rules(feature, '<i className="shadow-[0_0_8px_var(--color-pollen)]" />'), []);
});

test('inline style colours are reported, tokens and data-driven values are not', () => {
  assert.deepEqual(rules(feature, "<i style={{ color: '#fff' }} />"), ['inline-colour']);
  assert.deepEqual(rules(feature, "<i style={{ background: 'white' }} />"), ['inline-colour']);
  assert.deepEqual(
    rules(feature, "<i\n  style={{\n    left: '4px',\n    borderColor: 'red',\n  }}\n/>"),
    ['inline-colour'],
  );
  assert.deepEqual(rules(feature, '<path fill="black" />'), ['inline-colour']);
  assert.deepEqual(rules(feature, "<i style={{ color: 'var(--color-ink)' }} />"), []);
  assert.deepEqual(rules(feature, '<path fill="currentColor" stroke="none" />'), []);
  assert.deepEqual(rules(feature, '<Meter color="var(--color-rose)" />'), []);
});

test('corner radii come from the token scale', () => {
  assert.deepEqual(rules(feature, '<i className="size-4 rounded-[5px]" />'), ['arbitrary-radius']);
  assert.deepEqual(rules(feature, "'before:rounded-tl-[2px]'"), ['arbitrary-radius']);
  assert.deepEqual(rules(feature, "'[border-radius:4px]'"), ['arbitrary-radius']);
  assert.deepEqual(rules(feature, "'rounded-(--radius-lg)'"), []);
  assert.deepEqual(rules(feature, '<i className="rounded-lg after:rounded-full" />'), []);
  assert.deepEqual(rules(feature, '<i className="absolute inset-0 rounded-[inherit]" />'), []);
  assert.deepEqual(rules(feature, '<i className="[&>option]:rounded-sm" />'), []);
});

test('native buttons need a primitive or a marker with a reason', () => {
  assert.deepEqual(rules(feature, '<button type="button">Go</button>'), ['native-button']);
  assert.deepEqual(rules(feature, "createElement('button')"), ['native-button']);
  assert.deepEqual(rules(feature, '<Panel as="button" />'), ['native-button']);
  assert.deepEqual(
    rules(feature, '{/* design-system-allow native-button: */}\n<button type="button" />'),
    ['native-button'],
  );
  assert.deepEqual(
    rules(
      feature,
      '{/* design-system-allow native-button: the native picker needs a bare button */}\n<button\n  type="button"\n/>',
    ),
    [],
  );
  assert.deepEqual(rules('frontend/src/components/ui/Button.tsx', '<button />'), []);
  assert.deepEqual(rules(feature, '<Button>Go</Button><Pressable />'), []);
});

test('stylesheets live in styles/ and enter only through main.tsx', () => {
  assert.deepEqual(rules('frontend/src/features/demo/demo.css', 'a { margin: 0; }'), [
    'stray-stylesheet',
  ]);
  assert.deepEqual(rules('frontend/src/styles/extra.css', 'a { margin: 0; }'), []);
  assert.deepEqual(rules(feature, "import './demo.css';"), ['stray-stylesheet']);
  assert.deepEqual(rules(feature, "import styles from './demo.module.css';"), ['stray-stylesheet']);
  assert.deepEqual(rules(feature, '<style>{css}</style>'), ['stray-stylesheet']);
  assert.deepEqual(rules('frontend/src/main.tsx', "import './styles/index.css';"), []);
});

test('problems carry a position and every rule has a fix hint', () => {
  const [problem] = scan(feature, "const a = 1;\nconst b = '#abcdef';");
  assert.deepEqual(
    { line: problem.line, column: problem.column, match: problem.match },
    { line: 2, column: 12, match: '#abcdef' },
  );
  for (const rule of [
    'colour-literal',
    'arbitrary-colour',
    'inline-colour',
    'arbitrary-radius',
    'native-button',
    'stray-stylesheet',
  ])
    assert.ok(HINTS[rule]);
});

test('the walk covers the frontend and skips tests', () => {
  const files = walk('frontend');
  assert.ok(files.includes('frontend/src/main.tsx'));
  assert.ok(files.includes('frontend/src/styles/theme.css'));
  assert.ok(!files.some((f) => /\.test\.tsx?$/.test(f) || f.includes('node_modules')));
});
