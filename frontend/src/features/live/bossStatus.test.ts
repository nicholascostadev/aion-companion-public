import { describe, expect, it } from 'vitest';
import type { BossProjection } from '../offline/analysis';
import { bossStatus } from './bossStatus';

const target = {
  id: 50,
  npc_id: 900,
  name: 'Test Boss',
  boss: true,
  dummy: false,
  current_hp: 5000,
  max_hp: 10000,
  dead: false,
  damage: 5000,
  berserk_seconds: 120,
};
function projection(patch: Partial<BossProjection> = {}): BossProjection {
  return {
    target,
    current: 5000,
    max: 10000,
    fraction: 0.5,
    dps: 500,
    dpsSource: 'hp',
    ttkMs: 10_000,
    berserkMs: 90_000,
    beatsBerserk: true,
    ...patch,
  };
}

describe('bossStatus', () => {
  it('is absent without a target', () => {
    expect(bossStatus(null, false)).toBeNull();
  });

  it('counts rage down live and judges the pace', () => {
    const status = bossStatus(projection(), false)!;
    expect(status).toMatchObject({ role: 'boss', fraction: 0.5, dead: false, killMs: 10_000 });
    expect(status.rage).toEqual({ kind: 'countdown', ms: 90_000, frozen: false });
    expect(status.pace).toBe('good');
    expect(bossStatus(projection({ beatsBerserk: false }), false)!.pace).toBe('bad');
  });

  it('keeps unseen HP unknown instead of zero or dead', () => {
    const status = bossStatus(
      projection({ current: null, max: null, fraction: null, ttkMs: null, beatsBerserk: null }),
      false,
    )!;
    expect(status).toMatchObject({ current: null, max: null, fraction: null, dead: false });
    expect(status.killMs).toBeNull();
    expect(status.rage.kind).toBe('countdown');
    expect(status.pace).toBeNull();
  });

  it('states an unknown rage timer for a boss without one', () => {
    const status = bossStatus(projection({ berserkMs: null, beatsBerserk: null }), false)!;
    expect(status.rage).toEqual({ kind: 'unknown' });
    expect(status.pace).toBeNull();
  });

  it('reports rage once the timer runs out on a living boss', () => {
    const status = bossStatus(projection({ berserkMs: -4000, beatsBerserk: false }), false)!;
    expect(status.rage).toEqual({ kind: 'enraged', frozen: false });
    expect(status.pace).toBeNull();
  });

  it('stops the rage timer once the boss is defeated', () => {
    const dead = projection({
      target: { ...target, dead: true, current_hp: 0 },
      current: 0,
      fraction: 0,
      ttkMs: 0,
      berserkMs: 60_000,
    });
    const status = bossStatus(dead, true)!;
    expect(status).toMatchObject({ dead: true, current: 0, fraction: 0, killMs: 0 });
    expect(status.rage).toEqual({ kind: 'stopped' });
    expect(status.pace).toBeNull();
    // An observed zero is a kill too, even before native flags the death.
    expect(bossStatus(projection({ current: 0, fraction: 0 }), false)!.rage.kind).toBe('stopped');
  });

  it('freezes a living boss when the fight ended', () => {
    const status = bossStatus(projection(), true)!;
    expect(status.rage).toEqual({ kind: 'countdown', ms: 90_000, frozen: true });
    expect(status.killMs).toBeNull();
    expect(status.pace).toBeNull();
    expect(bossStatus(projection({ berserkMs: 0 }), true)!.rage).toEqual({
      kind: 'enraged',
      frozen: true,
    });
  });

  it('has no rage for training dummies and ordinary targets', () => {
    const dummy = projection({ target: { ...target, boss: false, dummy: true } });
    expect(bossStatus(dummy, false)).toMatchObject({ role: 'dummy', rage: { kind: 'none' } });
    const mob = projection({ target: { ...target, boss: null, dummy: null } });
    expect(bossStatus(mob, false)).toMatchObject({ role: 'target', rage: { kind: 'none' } });
  });
});
