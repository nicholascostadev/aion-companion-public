import { describe, expect, it } from 'vitest';
import {
  groupRoom,
  roomClockTicks,
  rosterColumns,
  type GroupMemberData,
  type GroupStatusData,
  type ReadyCheck,
  type Room,
} from './model';

const now = 1_800_000_000_000;
const member = (name: string, patch: Partial<GroupMemberData> = {}): GroupMemberData => ({
  name,
  server_id: 1001,
  class: 'Cleric',
  level: 45,
  ...patch,
});
const status = (members: GroupMemberData[], patch: Partial<GroupStatusData> = {}) =>
  ({
    capture_id: 1,
    running: true,
    phase: 'capturing',
    message: '',
    roster_seen: true,
    roster_age_ms: 1000,
    members,
    inspections: [],
    ready_check: {
      observed_ms: now - 5000,
      source: 'observed lobby member readiness',
      supported: true,
    },
    ...patch,
  }) satisfies GroupStatusData;
/** First leads and is ready; Second is not ready; both observed 5 seconds ago. */
const pair = [
  member('Second', { slot: 2, ready: false, ready_observed_ms: now - 5000 }),
  member('First', {
    slot: 1,
    ready: true,
    leader: true,
    ready_observed_ms: now - 5000,
  }),
];
const room = (value: GroupStatusData | null, native = true) => groupRoom(value, native, now);

describe('the party room', () => {
  it('orders members by their observed 1-based slot, the rest in roster order', () => {
    const value = status([
      member('Loose'),
      ...pair,
      member('Zero', { slot: 0 }),
      member('Third', { slot: 3 }),
    ]);
    expect(room(value).cards.map((card) => [card.name, card.slot])).toEqual([
      ['First', 1],
      ['Second', 2],
      ['Third', 3],
      ['Loose', null],
      ['Zero', null],
    ]);
  });

  it('keeps observed fields per member and never invents the others', () => {
    const [card] = room(
      status([member('Solo', { class: '', level: 0, gear_score: 0, combat_power: 0 })]),
    ).cards;
    expect(card).toMatchObject({
      className: null,
      level: null,
      // A gear score of 0 is observed; combat power is only observed above 0.
      gearScore: 0,
      combatPower: null,
      ready: null,
      leader: false,
    });
  });

  type Readiness = Pick<
    Room,
    'ready' | 'readiness' | 'newestMs' | 'oldestAge' | 'untimed' | 'freshness'
  >;
  const readiness = (value: GroupStatusData): Readiness => {
    const { ready, readiness: state, newestMs, oldestAge, untimed, freshness } = room(value);
    return { ready, readiness: state, newestMs, oldestAge, untimed, freshness };
  };
  const live = { kind: 'live' } as const;
  const old = now - 20 * 60_000;
  it.each<[string, GroupStatusData, Readiness]>([
    [
      'counts observed readiness, the leader as ready',
      status(pair),
      {
        ready: { ready: 1, known: 2, total: 2 },
        readiness: 'some',
        newestMs: now - 5000,
        oldestAge: 5000,
        untimed: 0,
        freshness: live,
      },
    ],
    [
      'never shows old readiness as a fresh all-ready group',
      status(
        [pair[0]!, { ...pair[1]!, ready_observed_ms: now - 1000 }].map((m) =>
          m.leader ? m : { ...m, ready: true, ready_observed_ms: old },
        ),
      ),
      {
        ready: { ready: 2, known: 2, total: 2 },
        readiness: 'old',
        newestMs: old,
        oldestAge: 20 * 60_000,
        untimed: 0,
        freshness: live,
      },
    ],
    [
      'treats a known state without an observation time as unconfirmed, not unknown',
      status(
        pair.map((m) => ({ ...m, ready: true, ready_observed_ms: null })),
        { ready_check: null },
      ),
      {
        ready: { ready: 2, known: 2, total: 2 },
        readiness: 'old',
        newestMs: null,
        // Without a ready check no age is shown.
        oldestAge: null,
        // The leader is ready by rule, so only the other member lacks a time.
        untimed: 1,
        freshness: live,
      },
    ],
    [
      'counts the leader ready and leaves their own old observation out of the freshness',
      status(
        pair.map((m) =>
          m.leader
            ? { ...m, ready: false, ready_observed_ms: old }
            : { ...m, ready: true, ready_observed_ms: now - 5000 },
        ),
      ),
      {
        ready: { ready: 2, known: 2, total: 2 },
        readiness: 'all',
        newestMs: now - 5000,
        oldestAge: 5000,
        untimed: 0,
        freshness: live,
      },
    ],
    [
      'never counts a leader without a ready bit or time as untimed',
      status(
        pair.map((m) =>
          m.leader ? { ...m, ready: null, ready_observed_ms: null } : { ...m, ready: true },
        ),
      ),
      {
        ready: { ready: 2, known: 2, total: 2 },
        readiness: 'all',
        newestMs: now - 5000,
        oldestAge: 5000,
        untimed: 0,
        freshness: live,
      },
    ],
    [
      'keeps the other members unknown or not ready as observed',
      status([...pair, member('Third', { slot: 3, ready: null })], {
        capacity: 3,
      }),
      {
        ready: { ready: 1, known: 2, total: 3 },
        readiness: 'some',
        newestMs: now - 5000,
        oldestAge: 5000,
        untimed: 0,
        freshness: live,
      },
    ],
    [
      'shows no count until another member is observed: the leader alone says nothing',
      status(pair.map((m) => (m.leader ? m : { ...m, ready: null }))),
      {
        ready: null,
        readiness: null,
        newestMs: null,
        oldestAge: null,
        untimed: 0,
        freshness: live,
      },
    ],
  ])('%s', (_, value, expected) => {
    expect(readiness(value)).toEqual(expected);
  });

  it('moves the leader’s rule with the leadership', () => {
    const before = status(
      pair.map((m) =>
        m.leader
          ? { ...m, ready: false, ready_observed_ms: old }
          : { ...m, ready: true, ready_observed_ms: now - 5000 },
      ),
    );
    const after = {
      ...before,
      members: before.members.map((m) => ({ ...m, leader: !m.leader })),
    };
    const cards = room(after).cards;
    expect(cards.map((card) => [card.name, card.leader, card.ready, card.readyObservedMs])).toEqual(
      [
        // The old leader shows their own bit and time again.
        ['First', false, false, old],
        ['Second', true, true, null],
      ],
    );
    expect(room(after)).toMatchObject({
      ready: { ready: 1, known: 2, total: 2 },
      readiness: 'old',
      oldestAge: 20 * 60_000,
    });
    // The roster's wire data is left as observed.
    expect(before.members.find((m) => m.leader)?.ready).toBe(false);
  });

  it.each<[string, ReadyCheck | null, ReturnType<typeof groupRoom>['check']]>([
    [
      'reports observed readiness without claiming a round',
      { observed_ms: now, source: 'observed', supported: true },
      { active: false, startedMs: null, expiresMs: null, source: 'observed' },
    ],
    [
      'claims a round only on an explicit active one',
      {
        active: true,
        started_ms: now - 3000,
        expires_ms: now + 9000,
        supported: true,
      },
      {
        active: true,
        startedMs: now - 3000,
        expiresMs: now + 9000,
        source: null,
      },
    ],
    ['offers nothing native does not support', { active: true, supported: false }, null],
    ['offers nothing without a ready check', null, null],
  ])('ready check: %s', (_, check, expected) => {
    expect(room(status(pair, { ready_check: check })).check).toEqual(expected);
  });

  it.each<[string, Partial<GroupStatusData>, number | null, number]>([
    ['believes a size consistent with the roster', { capacity: 5 }, 5, 3],
    ['ignores a size smaller than the roster', { capacity: 1 }, null, 0],
    ['ignores a size beyond any group', { capacity: 49 }, null, 0],
    ['ignores a fractional size', { capacity: 4.5 }, null, 0],
    ['keeps the size unknown when none is reported', {}, null, 0],
  ])('capacity: %s', (_, patch, capacity, openSlots) => {
    expect(room(status(pair, patch))).toMatchObject({ capacity, openSlots });
  });

  it('averages only observed combat power', () => {
    const members = [
      member('A', { combat_power: 109_681 }),
      member('B', { combat_power: 85_680 }),
      member('C', { combat_power: null }),
    ];
    expect(room(status(members)).average).toEqual({
      average: 97_681,
      known: 2,
      total: 3,
    });
    expect(room(status([member('D')])).average).toBeNull();
  });

  it.each<[string, Partial<GroupStatusData>, boolean, Room['freshness'], boolean]>([
    ['a preview outside the native app', {}, false, { kind: 'preview' }, false],
    [
      'capture’s own state while not capturing',
      { running: false, phase: 'error' },
      true,
      { kind: 'capture', capture: 'error' },
      false,
    ],
    [
      'waiting for a group before a roster is seen',
      { roster_seen: false, roster_age_ms: null },
      true,
      { kind: 'waiting' },
      false,
    ],
    ['live within 30 seconds', { roster_age_ms: 30_000 }, true, { kind: 'live' }, false],
    [
      'seen a while ago after that',
      { roster_age_ms: 30_001 },
      true,
      { kind: 'seen', ageMs: 30_001 },
      false,
    ],
    [
      'stale after two minutes',
      { roster_age_ms: 120_001 },
      true,
      { kind: 'seen', ageMs: 120_001 },
      true,
    ],
    ['never stale in a preview', { roster_age_ms: 120_001 }, false, { kind: 'preview' }, false],
  ])('freshness: %s', (_, patch, native, freshness, stale) => {
    expect(room(status(pair, patch), native)).toMatchObject({
      freshness,
      stale,
    });
  });

  it('reads an absent status as an empty room still connecting', () => {
    expect(room(null)).toMatchObject({
      cards: [],
      capture: 'connecting',
      running: false,
      ready: null,
      capacity: null,
      freshness: { kind: 'capture', capture: 'connecting' },
    });
  });

  it.each<[string, GroupStatusData | null, boolean]>([
    ['ticks while another member’s readiness time shows', status(pair), true],
    [
      'stops for the leader’s time alone',
      status([
        { ...pair[1]!, ready_observed_ms: now },
        { ...pair[0]!, ready_observed_ms: null },
      ]),
      false,
    ],
    [
      'ticks during an active ready check',
      status([member('A')], { ready_check: { active: true, supported: true } }),
      true,
    ],
    ['stops without a room', null, false],
  ])('clock: %s', (_, value, ticks) => {
    expect(roomClockTicks(value)).toBe(ticks);
  });

  it('takes a second column only for more than one party', () => {
    expect(rosterColumns(6)).toBe(1);
    expect(rosterColumns(7)).toBe(2);
    expect(rosterColumns(12)).toBe(2);
  });
});
