import { describe, expect, it } from 'vitest';
import { formattersFor } from '../i18n/formatters';
import type { LivePlayer } from '../types/companion';
import type { ReportPlayer } from '../types/offline';
import { classColor, UNKNOWN_CLASS_COLOR } from './classColors';
import {
  combatPower,
  playerRows,
  powerText,
  rowChrome,
  rowColor,
  type LiveWords,
  type PlayerRow,
  type PlayerSource,
  type PowerFormat,
} from './playerRow';

/** Plain words, so the rules read without a language; each feature supplies its own. */
const words: LiveWords = {
  you: 'You',
  youDetail: 'you',
  classRank: (className, rank) => `${className} ${rank}`,
  playerRank: (rank) => `Player ${rank}`,
  playerId: (id) => `Player #${id}`,
  pendingYou: (id) => `You #${id}`,
  pendingPlayer: (id) => `Player #${id}`,
  pendingTitle: (details) => `Name not received yet · ${details}`,
  inferredClass: (className) => `${className} (inferred)`,
  entity: (id) => `entity #${id}`,
};
/** Report words leave out "you" in titles: reports show no hover titles. */
const { youDetail: _, ...reportWords } = words;

type Reported = Pick<
  ReportPlayer,
  'id' | 'name' | 'class' | 'local' | 'server_id' | 'combat_power' | 'damage'
>;
const reported = (patch: Partial<Reported>): Reported => ({
  id: 1,
  name: null,
  class: null,
  local: false,
  server_id: null,
  combat_power: null,
  damage: 0,
  ...patch,
});
/** A native report's players, listed by damage as native lists them. */
const aria = reported({
  id: 1,
  name: 'Aria',
  class: 'Gladiator',
  local: true,
  server_id: 2301,
  combat_power: 126_600,
  damage: 300,
});
const bryn = reported({
  id: 2,
  name: 'Bryn',
  class: 'Cleric',
  server_id: 2301,
  damage: 200,
});
const nameless = reported({ id: 3, damage: 100 });
const fight = [aria, bryn, nameless];

type Live = Pick<
  LivePlayer,
  'entity' | 'label' | 'name' | 'class' | 'is_local' | 'name_known' | 'server_id' | 'damage'
>;
const live = (patch: Partial<Live>): Live => ({
  entity: 7,
  label: 'Gladiator #7',
  damage: 100,
  ...patch,
});

/** What a row shows, in reading order. */
const shown = (row: PlayerRow) => ({
  name: row.name,
  title: row.title,
  class: row.class,
  color: row.color,
  profile: row.profile?.name ?? null,
  meTag: row.meTag,
  power: row.showsPower ? row.combatPower : 'hidden',
});

describe('privacy: what each row shows with names shown and hidden', () => {
  const gladiator = classColor('Gladiator');
  const cleric = classColor('Cleric');
  it.each<[string, PlayerSource, boolean, ReturnType<typeof shown>[]]>([
    [
      'meter, names shown: observed names, classes, profiles and combat power',
      { kind: 'meter', players: fight, words },
      false,
      [
        {
          name: 'Aria',
          title: 'Aria · Gladiator · you',
          class: 'Gladiator',
          color: gladiator,
          profile: 'Aria',
          meTag: true,
          power: 126_600,
        },
        {
          name: 'Bryn',
          title: 'Bryn · Cleric',
          class: 'Cleric',
          color: cleric,
          profile: 'Bryn',
          meTag: false,
          power: null,
        },
        {
          name: 'Player #3',
          title: 'Player #3',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: false,
          power: null,
        },
      ],
    ],
    [
      'meter, names hidden: you and class with rank; your own class and colour stay private',
      { kind: 'meter', players: fight, words },
      true,
      [
        {
          name: 'You',
          title: 'You',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
        {
          name: 'Cleric 2',
          title: 'Cleric 2',
          class: 'Cleric',
          color: cleric,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
        {
          name: 'Player 3',
          title: 'Player 3',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
      ],
    ],
    [
      'report, names hidden: the same labels and private class as the meter',
      { kind: 'report', players: fight, words: reportWords },
      true,
      [
        {
          name: 'You',
          title: 'You',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
        {
          name: 'Cleric 2',
          title: 'Cleric 2',
          class: 'Cleric',
          color: cleric,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
        {
          name: 'Player 3',
          title: 'Player 3',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
      ],
    ],
    [
      'live totals, names shown: observed names, pending identities never named',
      {
        kind: 'live',
        players: [
          live({
            entity: 7,
            name: 'Aria',
            class: 'Chanter',
            name_known: true,
            server_id: 2301,
          }),
          live({
            entity: 9,
            label: 'Chanter #9',
            class: 'Chanter',
            name_known: false,
          }),
          live({ entity: 4, is_local: true, server_id: 2301 }),
        ],
        words,
      },
      false,
      [
        {
          name: 'Aria',
          title: 'Aria · Chanter',
          class: 'Chanter',
          color: classColor('Chanter'),
          profile: 'Aria',
          meTag: false,
          power: null,
        },
        {
          name: 'Player #9',
          title: 'Name not received yet · Chanter (inferred) · entity #9',
          class: 'Chanter',
          color: classColor('Chanter'),
          profile: null,
          meTag: false,
          power: null,
        },
        // Older payloads without identity fields keep the backend label, and link no one.
        {
          name: 'Gladiator #7',
          title: 'Gladiator #7 · you',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: true,
          power: null,
        },
      ],
    ],
    [
      'live totals, names hidden: the meter’s labels, by damage rank',
      {
        kind: 'live',
        players: [
          live({
            entity: 7,
            name: 'Aria',
            class: 'Chanter',
            name_known: true,
            damage: 50,
          }),
          live({
            entity: 4,
            name: 'Me',
            class: 'Ranger',
            is_local: true,
            damage: 300,
          }),
          live({ entity: 9, class: 'Chanter', name_known: false, damage: 100 }),
        ],
        words,
      },
      true,
      [
        {
          name: 'Chanter 3',
          title: 'Chanter 3',
          class: 'Chanter',
          color: classColor('Chanter'),
          profile: null,
          meTag: false,
          power: 'hidden',
        },
        {
          name: 'You',
          title: 'You',
          class: null,
          color: UNKNOWN_CLASS_COLOR,
          profile: null,
          meTag: false,
          power: 'hidden',
        },
        {
          name: 'Chanter 2',
          title: 'Chanter 2',
          class: 'Chanter',
          color: classColor('Chanter'),
          profile: null,
          meTag: false,
          power: 'hidden',
        },
      ],
    ],
  ])('%s', (_, source, hideNames, expected) => {
    expect(playerRows(source, hideNames).map(shown)).toEqual(expected);
  });

  it('links only a name observed with a Global server', () => {
    const profiles = playerRows(
      {
        kind: 'meter',
        players: [
          { ...aria, server_id: 2301 },
          // A Korean id names no region; no server, no link.
          { ...bryn, server_id: 1001 },
          { ...bryn, id: 5, server_id: null },
        ],
        words,
      },
      false,
    ).map((row) => row.profile);
    expect(profiles).toEqual([{ name: 'Aria', serverId: 2301 }, null, null]);
  });

  it('never links a live identity whose name has not been observed, whatever its label', () => {
    const row = (patch: Partial<Live>) =>
      playerRows(
        {
          kind: 'live',
          players: [live({ name: 'Rival', server_id: 1304, ...patch })],
          words,
        },
        false,
      )[0]!.profile;
    expect(row({ name_known: true })).toEqual({
      name: 'Rival',
      serverId: 1304,
    });
    expect(row({ name_known: false })).toBeNull();
    expect(row({})).toBeNull();
  });

  it.each<[string, Parameters<typeof rowColor>[0], boolean, string]>([
    ['colours a player in their class', { class: 'Cleric', local: false }, false, cleric],
    [
      'keeps your class colour with names shown',
      { class: 'Gladiator', local: true },
      false,
      gladiator,
    ],
    [
      'hides your class colour with names hidden',
      { class: 'Gladiator', local: true },
      true,
      UNKNOWN_CLASS_COLOR,
    ],
    [
      'keeps the others’ colours with names hidden',
      { class: 'Cleric', local: false },
      true,
      cleric,
    ],
    ['colours no player neutral', null, false, UNKNOWN_CLASS_COLOR],
  ])('row colour: %s', (_, player, hideNames, color) => {
    expect(rowColor(player, hideNames)).toBe(color);
  });

  it('pins a known difference: an unnamed local player reads "You" in reports, its id on the meter', () => {
    // Kept as found (both views always did this); reported for a decision.
    const unnamedYou = [reported({ id: 4, local: true, damage: 10 })];
    expect(playerRows({ kind: 'meter', players: unnamedYou, words }, false)[0]!.name).toBe(
      'Player #4',
    );
    expect(
      playerRows({ kind: 'report', players: unnamedYou, words: reportWords }, false)[0]!.name,
    ).toBe('You');
  });
});

describe('hidden-name labels', () => {
  const labels = (source: PlayerSource) => playerRows(source, true).map((row) => row.name);
  const cleric = (id: number, damage: number) =>
    reported({ id, name: `C${id}`, class: 'Cleric', damage });

  it.each<[string, 'meter' | 'report', Reported[], string[]]>([
    [
      'the meter numbers by damage rank, ties in listed order',
      'meter',
      [cleric(1, 100), cleric(2, 300), cleric(3, 300), reported({ id: 4, damage: 0 })],
      ['Cleric 3', 'Cleric 1', 'Cleric 2', 'Player 4'],
    ],
    [
      'a report numbers by listed position',
      'report',
      [cleric(1, 100), cleric(2, 300), cleric(3, 300), reported({ id: 4, damage: 0 })],
      ['Cleric 1', 'Cleric 2', 'Cleric 3', 'Player 4'],
    ],
    [
      'you are "You" wherever you rank, and still take your number from the others',
      'meter',
      [cleric(1, 100), { ...cleric(2, 500), local: true }, cleric(3, 50)],
      ['Cleric 2', 'You', 'Cleric 3'],
    ],
  ])('%s', (_, kind, players, expected) => {
    expect(labels({ kind, players, words: kind === 'meter' ? words : reportWords })).toEqual(
      expected,
    );
  });

  it('labels a player alike on the meter row and in its details window for a native report', () => {
    // Native lists a report's players by damage, ties by id, so the meter's damage rank and the
    // report's position always agree; the same fight never shows two labels for one player.
    const native = [
      cleric(4, 900),
      { ...cleric(1, 500), local: true },
      cleric(2, 500),
      reported({ id: 9, damage: 500 }),
      cleric(3, 0),
    ];
    const meter = labels({ kind: 'meter', players: native, words });
    expect(meter).toEqual(['Cleric 1', 'You', 'Cleric 3', 'Player 4', 'Cleric 5']);
    expect(labels({ kind: 'report', players: native, words: reportWords })).toEqual(meter);
  });
});

describe('combat power', () => {
  it.each<[unknown, number | null]>([
    [126_600, 126_600],
    [1, 1],
    [0, null],
    [-5, null],
    [null, null],
    [undefined, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ['126600', null],
  ])('%s is observed as %s', (raw, expected) => {
    expect(combatPower(raw)).toBe(expected);
  });

  const en = formattersFor('en');
  const pt = formattersFor('pt-BR');
  it.each<[unknown, PowerFormat, ReturnType<typeof formattersFor>, string | null]>([
    [126_600, 'compact', en, '126.6K'],
    [98_400, 'compact', pt, '98.4K'],
    [null, 'compact', en, '—'],
    [109_681, 'full', en, '109,681'],
    [109_681, 'full', pt, '109.681'],
    [0, 'full', en, '—'],
    [109_681, 'inline', en, '109,681'],
    [null, 'inline', en, null],
    [0, 'inline', en, null],
  ])('%s written %s is %s', (raw, format, fmt, expected) => {
    expect(format === 'inline' ? powerText(raw, format, fmt) : powerText(raw, format, fmt)).toBe(
      expected,
    );
  });
});

describe('row chrome', () => {
  it('gives meter and room rows one height and padding, filled in the row colour', () => {
    const chrome = rowChrome(classColor('Ranger'));
    expect(chrome.className.split(' ')).toEqual(
      expect.arrayContaining(['min-h-7', 'py-0.5', 'pr-1.75', 'pl-1.25', 'bg-row-hover']),
    );
    expect(chrome.style).toEqual({ '--mark': 'var(--color-class-ranger)' });
  });
});
