import { describe, expect, it } from 'vitest';
import contract from '../../../fixtures/contracts/group_status.json';
import { objectKeys } from '../test/companionStatus';
import { normalizeGroupStatus } from './groupStatusNormalize';

/** The contract payload, copied so a test can change it. */
const payload = (): Record<string, unknown> => structuredClone(contract);

describe('group status normalisation', () => {
  it('returns the native contract payload unchanged', () => {
    // A field native adds, drops or renames fails here until the type and normalizer follow.
    expect(normalizeGroupStatus(payload())).toStrictEqual(contract);
  });

  it('gives every object the contract’s fields, whatever native sent', () => {
    const shape = new Map(objectKeys(contract));
    for (const value of [null, 'group', [], {}, { members: [{ name: 'Solo' }], run: 'x' }])
      for (const [path, keys] of objectKeys(normalizeGroupStatus(value)))
        expect([path, keys]).toEqual([path, shape.get(path)]);
  });

  it('tolerates the development build’s protocol diagnostic and leaves it out', () => {
    const value = { ...payload(), protocol_diagnostic: { roster: [1, 2], unparsed: 'ab' } };
    expect(normalizeGroupStatus(value)).toStrictEqual(contract);
  });

  it('keeps unknown observations unknown, never zero or false', () => {
    const [first, ...rest] = contract.members;
    const status = normalizeGroupStatus({
      ...payload(),
      roster_age_ms: -1,
      capacity: '5',
      members: [
        {
          ...first,
          // A number has already lost the id's precision on the way.
          character_id: Number.MAX_SAFE_INTEGER + 2,
          slot: 1.5,
          ready_observed_ms: 'now',
          server_id: null,
          gear_score: -1,
          combat_power: undefined,
          leader: 'yes',
          ready: 0,
        },
        ...rest,
      ],
    });
    expect([status.roster_age_ms, status.capacity]).toEqual([null, null]);
    expect(status.members[0]).toStrictEqual({
      ...first,
      character_id: null,
      slot: null,
      ready_observed_ms: null,
      server_id: null,
      gear_score: null,
      combat_power: null,
      leader: null,
      ready: null,
    });
  });

  it('drops members without a name and inspections missing any figure', () => {
    const [inspected] = contract.inspections;
    const status = normalizeGroupStatus({
      ...payload(),
      members: [null, { slot: 3 }, ...contract.members],
      inspections: [{ ...inspected, gear_score: null }, { ...inspected, id: undefined }, inspected],
    });
    expect(status.members).toStrictEqual(contract.members);
    expect(status.inspections).toStrictEqual(contract.inspections);
  });

  it('reads a run in words this build does not know, or none, as unknown', () => {
    for (const run of [undefined, null, { ...contract.run, phase: 'paused' }])
      expect(normalizeGroupStatus({ ...payload(), run }).run.phase).toBe('unknown');
  });

  it('reads a ready check that does not say it is supported as unsupported', () => {
    for (const ready_check of [undefined, null, { ...contract.ready_check, supported: 'true' }])
      expect(normalizeGroupStatus({ ...payload(), ready_check }).ready_check.supported).toBe(false);
  });

  it('reads an empty or malformed payload as capture with nothing observed', () => {
    for (const value of [undefined, null, 'error', 42, []])
      expect(normalizeGroupStatus(value)).toStrictEqual({
        capture_id: 0,
        running: false,
        phase: '',
        message: '',
        roster_seen: false,
        roster_age_ms: null,
        lobby_name: null,
        capacity: null,
        party_id: null,
        members: [],
        inspections: [],
        room: false,
        dungeon_id: null,
        run: { phase: 'unknown', dungeon_id: null, run_id: null, zone_id: null },
        preparing: false,
        ready_check: {
          active: null,
          started_ms: null,
          expires_ms: null,
          observed_ms: null,
          oldest_observed_ms: null,
          source: '',
          supported: false,
        },
      });
  });
});
