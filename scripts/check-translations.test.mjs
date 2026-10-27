import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  flatten,
  generateTypes,
  readCatalogs,
  requiredCategories,
  validate,
  validateNamespace,
} from './check-translations.mjs';

const catalogs = (en, pt) =>
  new Map([
    ['en', new Map(Object.entries(en))],
    ['pt-BR', new Map(Object.entries(pt))],
  ]);
const one = (en, pt) => validate(catalogs({ ns: en }, { ns: pt }));

describe('translation catalog validation', () => {
  it('accepts matching messages, placeholders and plural families', () => {
    assert.deepEqual(
      one(
        {
          a: { title: 'Hi {{name}}' },
          items_one: '{{count}} item',
          items_other: '{{count}} items',
        },
        {
          a: { title: 'Olá {{name}}' },
          items_one: '{{count}} item',
          items_many: '{{count}} de itens',
          items_other: '{{count}} itens',
        },
      ),
      [],
    );
  });

  it('reports missing, extra and empty messages', () => {
    const problems = one({ a: 'A', b: 'B' }, { a: ' ', c: 'C' });
    assert.ok(problems.some((p) => p.includes('missing "b"')));
    assert.ok(problems.some((p) => p.includes('"c" is not an English message')));
    assert.ok(problems.some((p) => p.includes('"a" is empty')));
  });

  it('reports an empty catalog and a namespace missing in one language', () => {
    assert.ok(one({}, {}).some((p) => p.includes('catalog has no messages')));
    const problems = validate(catalogs({ ns: { a: 'A' }, other: { b: 'B' } }, { ns: { a: 'A' } }));
    assert.ok(problems.some((p) => p.includes('missing namespace "other"')));
  });

  it('requires the same placeholders, ignoring a plural count', () => {
    const problems = one({ a: '{{name}} won' }, { a: '{{nome}} venceu' });
    assert.ok(problems.some((p) => p.includes('uses {{nome}}')));
    assert.deepEqual(one({ a: '{{count, number}} x' }, { a: '{{count}} x' }), []);
  });

  it('requires the plural categories of each language from Intl.PluralRules', () => {
    assert.deepEqual(requiredCategories('en'), ['one', 'other']);
    assert.ok(requiredCategories('pt-BR').includes('many'));
    const problems = one({ n_one: 'one', n_other: 'many' }, { n_one: 'um', n_other: 'vários' });
    assert.ok(problems.some((p) => p.includes('plural "n"') && p.includes('pt-BR needs')));
  });

  it('rejects markup and nested translations, but allows numbered components', () => {
    assert.ok(one({ a: '<b>x</b>' }, { a: '<b>x</b>' }).some((p) => p.includes('markup')));
    assert.ok(one({ a: '$t(b)' }, { a: '$t(b)' }).some((p) => p.includes('nests')));
    assert.deepEqual(one({ a: '<0>{{k}}</0> lock' }, { a: '<0>{{k}}</0> travar' }), []);
    assert.ok(
      one({ a: '<0>x</0>' }, { a: '<1>x</1>' }).some((p) => p.includes('components differ')),
    );
  });

  it('flattens nested keys and reports non-string leaves', () => {
    const { messages, problems } = flatten({ a: { b: 'x' }, c: 1 });
    assert.deepEqual([...messages], [['a.b', 'x']]);
    assert.ok(problems.some((p) => p.startsWith('c:')));
    assert.deepEqual(validateNamespace('ns', new Map()), ['ns: missing en catalog']);
  });

  it('generates deterministic literal types from English, without the native catalog', () => {
    const input = catalogs(
      { b: { z: 'Z', a: 'A "q"' }, a: { k: 'K' }, native: { tray: 'T' } },
      { b: {}, a: {}, native: {} },
    );
    const first = generateTypes(input);
    assert.equal(first, generateTypes(input));
    assert.ok(first.indexOf('readonly a:') < first.indexOf('readonly b:'));
    assert.ok(first.includes('readonly a: "A \\"q\\"";'));
    assert.ok(!first.includes('tray'));
  });

  it('passes for the shipped catalogs', () => {
    const { catalogs: shipped, problems } = readCatalogs();
    assert.deepEqual([...problems, ...validate(shipped)], []);
  });
});
