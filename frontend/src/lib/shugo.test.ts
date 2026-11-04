import { describe, expect, it } from 'vitest';
import { shugoProfile } from './shugo';

describe('Shugo.gg profile eligibility', () => {
  it('offers observed names on Global servers in every sub-region', () => {
    expect(shugoProfile('Aahz', 1304)).toEqual({ name: 'Aahz', serverId: 1304 });
    for (const id of [1101, 2205, 2320, 1406, 2518]) expect(shugoProfile('슉', id)).not.toBeNull();
  });

  it('never offers a Korean or Taiwanese id, which names no region, or an unknown server', () => {
    for (const id of [1001, 2021, 1601, 3001, null, undefined])
      expect(shugoProfile('Aahz', id)).toBeNull();
  });

  it('never looks up placeholders or text that is not a single name', () => {
    for (const name of [null, '', 'Player #12', 'a/b', 'two words', 'x?y', 'x'.repeat(33)])
      expect(shugoProfile(name, 1304)).toBeNull();
    expect(shugoProfile('x'.repeat(32), 1304)).not.toBeNull();
  });
});
