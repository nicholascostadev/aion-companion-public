import { describe, expect, it } from 'vitest';
import contract from '../../../fixtures/contracts/live_status.json';
import { objectKeys } from '../test/companionStatus';
import { normalizeLiveStatus } from './liveStatusNormalize';

/** The contract payload, copied so a test can change it. */
const payload = (): Record<string, unknown> => structuredClone(contract);
const firstPlayer = (patch: Record<string, unknown>) => {
  const value = payload();
  const [first, ...rest] = contract.players;
  value.players = [{ ...first, ...patch }, ...rest];
  return value;
};

describe('live status normalisation', () => {
  it('returns the native contract payload unchanged', () => {
    // A field native adds, drops or renames fails here until the type and normalizer follow.
    expect(normalizeLiveStatus(payload())).toStrictEqual(contract);
  });

  it('gives every object the contract’s fields, whatever native sent', () => {
    const shape = new Map(objectKeys(contract, ['players[].skills']));
    const values = [null, 'live', [], {}, { players: [{ entity: 3 }], odyle: {} }];
    // Counters are `{}` until the capture worker first publishes them.
    const found = values
      .flatMap((value) => objectKeys(normalizeLiveStatus(value), ['players[].skills']))
      .filter(([path]) => path !== 'stats');
    expect(found).toEqual(found.map(([path]) => [path, shape.get(path)]));
  });

  it('leaves out keys outside the contract', () => {
    const value = payload();
    value.diagnostic = { frames: 3 };
    (value.players as Record<string, unknown>[])[0]!.debug = true;
    expect(normalizeLiveStatus(value)).toStrictEqual(contract);
  });

  it('reads the counters as all ten or none', () => {
    expect(normalizeLiveStatus({ ...payload(), stats: {} }).stats).toStrictEqual({});
    // An unpublished worker, a partial set and a malformed counter are not published counters.
    expect(normalizeLiveStatus({ ...payload(), stats: undefined }).stats).toStrictEqual({});
    const { metadata_dropped: _, ...nine } = contract.stats;
    expect(normalizeLiveStatus({ ...payload(), stats: nine }).stats).toStrictEqual({});
    const negative = { ...contract.stats, gaps: -1 };
    expect(normalizeLiveStatus({ ...payload(), stats: negative }).stats).toStrictEqual({});
  });

  it('keeps unknown observations unknown, never zero', () => {
    const status = normalizeLiveStatus({
      ...firstPlayer({ server_id: 'EU', gear_score: -5, combat_power: 1.5, name: 7 }),
      odyle: { base: 142, bonus: null, observed_ms: 1 },
    });
    expect(status.odyle).toBeNull();
    expect(status.players[0]).toMatchObject({
      server_id: null,
      gear_score: null,
      combat_power: null,
      name: null,
    });
  });

  it('reads a missing name_known from whether a name was observed', () => {
    const named = normalizeLiveStatus(firstPlayer({ name_known: undefined }));
    expect(named.players[0]).toMatchObject({ name: 'Mossglow', name_known: true });
    const unnamed = normalizeLiveStatus(firstPlayer({ name: null, name_known: undefined }));
    expect(unnamed.players[0]).toMatchObject({ name: null, name_known: false });
  });

  it('drops rows that name no entity and skills without a whole damage', () => {
    const status = normalizeLiveStatus({
      ...firstPlayer({ skills: { Strike: 30, Broken: 'x', Half: 0.5 } }),
      history: [{ id: 'one', duration_ms: 1, events: 1 }, ...contract.history],
    });
    const malformed = normalizeLiveStatus({
      ...payload(),
      players: [null, { label: 'No entity' }, { entity: -1 }, contract.players[1]],
    });
    expect(status.players[0]!.skills).toStrictEqual({ Strike: 30 });
    expect(status.history).toStrictEqual(contract.history);
    expect(malformed.players.map((player) => player.entity)).toEqual([22]);
  });

  it('reads an empty or malformed payload as capture with nothing observed', () => {
    for (const value of [undefined, null, 'error', 42, []])
      expect(normalizeLiveStatus(value)).toStrictEqual({
        odyle: null,
        running: false,
        phase: '',
        message: '',
        duration_ms: 0,
        events: 0,
        stats: {},
        players: [],
        named_entities: 0,
        roster_seen: false,
        party_members: 0,
        local_known: false,
        // Native's defaults, as the meter shows them before native answers.
        party_only: false,
        auto_end: true,
        encounter: 1,
        encounter_ended: false,
        skill_labels: 0,
        history: [],
      });
  });
});
