import { describe, expect, it } from 'vitest';
import { linkLabel, parseChange, parseInline, parseReleaseNotes } from './releaseNotesModel';

const PULL = 'https://github.com/nicholascostadev/aion-companion-public/pull';
const SINGLE = `## What's Changed
* style(ui): nest border radii concentrically by @nicholascostadev in ${PULL}/30

**Full Changelog**: https://github.com/nicholascostadev/aion-companion-public/compare/v0.7.13...v0.7.14`;

describe('release notes', () => {
  it('turns a generated single-entry release into a group and a comparison link', () => {
    const notes = parseReleaseNotes(SINGLE);
    expect(notes.blocks).toEqual([]);
    expect(notes.groups).toEqual([
      {
        kind: 'improvement',
        changes: [
          {
            type: 'style',
            kind: 'improvement',
            scopes: ['ui'],
            breaking: false,
            description: 'Nest border radii concentrically',
            author: 'nicholascostadev',
            pull: { number: 30, url: `${PULL}/30` },
            details: [],
          },
        ],
      },
    ]);
    expect(notes.compare).toEqual({
      url: 'https://github.com/nicholascostadev/aion-companion-public/compare/v0.7.13...v0.7.14',
      from: 'v0.7.13',
      to: 'v0.7.14',
    });
  });

  it('groups by kind in reading order and puts breaking changes first', () => {
    const notes = parseReleaseNotes(
      [
        `* fix(meter): keep totals by @a in ${PULL}/2`,
        `- feat(pets, alerts): add goals. by @a in ${PULL}/1`,
        '* perf: faster search (#3)',
        '* feat(recordings)!: new format',
        '* fix: BREAKING CHANGE: drop old logs',
        '* chore(deps): bump tauri',
        '* ci: cache',
        '* docs: guide',
        '* revert: undo thing',
        '* refactor(core): split',
      ].join('\n'),
    );
    expect(notes.groups.map((group) => [group.kind, group.changes.length])).toEqual([
      ['breaking', 2],
      ['feature', 1],
      ['fix', 1],
      ['performance', 1],
      ['improvement', 1],
      ['docs', 1],
      ['revert', 1],
      ['maintenance', 2],
    ]);
    const [breaking, feature] = notes.groups;
    expect(breaking!.changes.map((change) => change.kind)).toEqual(['feature', 'fix']);
    expect(breaking!.changes[1]!.description).toBe('Drop old logs');
    expect(feature!.changes[0]).toMatchObject({
      scopes: ['pets', 'alerts'],
      description: 'Add goals',
    });
    expect(notes.groups[3]!.changes[0]!.pull).toEqual({ number: 3, url: null });
    expect(notes.blocks).toEqual([]);
  });

  it('keeps every line that is not a conventional change, under its heading', () => {
    const notes = parseReleaseNotes(`## Highlights
Faster **meter**
and quieter alerts.

## What's Changed
* feat: one by @a in ${PULL}/1
  * converted on first open
* Tidy the release workflow by @a in ${PULL}/9
* wip: unknown type

## New Contributors
* @b made their first contribution in ${PULL}/9

\`\`\`
<b>raw</b>
\`\`\`
> quoted
---
**Full Changelog**: javascript:alert(1)`);
    expect(notes.groups).toHaveLength(1);
    expect(notes.groups[0]!.changes[0]!.details).toEqual(['converted on first open']);
    expect(notes.compare).toBeNull();
    expect(notes.blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Highlights' },
      { kind: 'paragraph', text: 'Faster **meter**\nand quieter alerts.' },
      { kind: 'heading', level: 2, text: "What's Changed" },
      {
        kind: 'list',
        ordered: false,
        items: [
          { text: `Tidy the release workflow by @a in ${PULL}/9`, depth: 0 },
          { text: 'wip: unknown type', depth: 0 },
        ],
      },
      { kind: 'heading', level: 2, text: 'New Contributors' },
      {
        kind: 'list',
        ordered: false,
        items: [{ text: `@b made their first contribution in ${PULL}/9`, depth: 0 }],
      },
      { kind: 'code', text: '<b>raw</b>' },
      { kind: 'quote', text: 'quoted' },
      { kind: 'rule' },
      { kind: 'paragraph', text: '**Full Changelog**: javascript:alert(1)' },
    ]);
  });

  it('leaves other list items alone', () => {
    expect(parseChange('Tidy the workflow')).toBeNull();
    expect(parseChange('wip: half done')).toBeNull();
    expect(parseChange('note: http://example.com')).toBeNull();
  });

  it('renders inline Markdown with safe links only', () => {
    expect(parseInline('a **b** *c* _d_ `e` [f](https://x.dev) [g](javascript:void)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'd' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'e' },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.dev/', children: [{ kind: 'text', text: 'f' }] },
      { kind: 'text', text: ' g' },
    ]);
    expect(parseInline('snake_case_name and 2*3*4')).toEqual([
      { kind: 'text', text: 'snake_case_name and 2*3*4' },
    ]);
    expect(parseInline(`see ${PULL}/30.`)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', href: `${PULL}/30`, children: [{ kind: 'text', text: '#30' }] },
      { kind: 'text', text: '.' },
    ]);
  });

  it('labels GitHub links and survives malformed encoding', () => {
    expect(linkLabel('https://github.com/o/r/commit/0123456789abcdef')).toBe('0123456');
    expect(linkLabel('https://github.com/o/r/compare/v1...v2')).toBe('v1...v2');
    expect(linkLabel('https://github.com/o/r/compare/v1%E0...v2')).toBe('v1%E0...v2');
    expect(
      parseReleaseNotes('**Full Changelog**: https://github.com/o/r/compare/v1%E0...v2').compare,
    ).toMatchObject({ from: 'v1%E0', to: 'v2' });
  });
});
