import { describe, expect, it } from 'vitest';
import { cubesStatus, NOW } from '../features/cubes/fixtures';
import type { WorldMotionStatus } from '../types/worldMotion';
import { isOlder, normalizeWorldMotion, shownMotion } from './worldMotion';

const fix = (x: number, observed: number) => ({
  x,
  y: 150_000,
  z: 0,
  observed_ms: observed,
});

/** Native's session ids: `{capture epoch ms}:{context counter}`. */
const EPOCH = NOW - 3_600_000;
const ctx = (counter: number, epoch = EPOCH) => `${epoch}:${counter}`;

/** Native's motion payload: a cube status's context and position, nothing else. */
const motion = (over: Partial<WorldMotionStatus> = {}): WorldMotionStatus =>
  normalizeWorldMotion({ ...cubesStatus(), cubes: undefined, ...over });

describe('normalizeWorldMotion', () => {
  it('keeps the context and your position by the cube status rules, without cubes', () => {
    const m = normalizeWorldMotion({
      ...cubesStatus({
        position: fix(1, NOW - 100),
        last_position: fix(1, NOW - 100),
      }),
      facing: { degrees: 400, observed_ms: NOW - 100 },
    });
    expect(m).toMatchObject({
      session_id: 's1',
      revision: 1,
      map_id: 'World/World_L/World_L_A',
    });
    expect(m.position?.x).toBe(1);
    expect(m.facing?.degrees).toBe(40);
    expect(m).not.toHaveProperty('cubes');
    expect(m).not.toHaveProperty('observed_total');
  });

  it('measures nothing from a stale position or an expired facing', () => {
    const old = fix(1, NOW - 20_000);
    const m = normalizeWorldMotion({
      ...cubesStatus(),
      position: old,
      last_position: old,
      facing: { degrees: 30, observed_ms: NOW - 11_000 },
    });
    expect(m.position).toBeNull();
    expect(m.last_position?.x).toBe(1);
    expect(m.facing).toBeNull();
  });

  it('places nothing of yours while capture is not running, or from garbage', () => {
    expect(normalizeWorldMotion({ ...cubesStatus(), running: false }).last_position).toBeNull();
    expect(normalizeWorldMotion('nope')).toMatchObject({
      running: false,
      position: null,
    });
  });
});

describe('isOlder', () => {
  it('orders one session by revision, then by native clock', () => {
    const base = motion({ revision: 5, now_ms: NOW });
    expect(isOlder(motion({ revision: 4, now_ms: NOW + 1000 }), base)).toBe(true);
    expect(isOlder(motion({ revision: 6, now_ms: NOW - 1000 }), base)).toBe(false);
    expect(isOlder(motion({ revision: 5, now_ms: NOW - 1 }), base)).toBe(true);
    expect(isOlder(motion({ revision: 5, now_ms: NOW }), base)).toBe(false);
    expect(isOlder(motion({ revision: 5, now_ms: null }), base)).toBe(false);
  });

  it('orders native contexts of one capture by their counter, even in the same millisecond', () => {
    // A Clear or zone change: the next context, one revision on, read in the same millisecond.
    const before = motion({ session_id: ctx(3), revision: 50, now_ms: NOW });
    const after = motion({ session_id: ctx(4), revision: 51, now_ms: NOW });
    expect(isOlder(before, after)).toBe(true);
    expect(isOlder(after, before)).toBe(false);
    // The counter decides, whatever the clocks say.
    expect(isOlder(motion({ session_id: ctx(3), now_ms: NOW + 5 }), after)).toBe(true);
    expect(isOlder(motion({ session_id: ctx(10), now_ms: NOW - 5 }), after)).toBe(false);
  });

  it('orders captures by their epoch, also against a larger revision of the one before', () => {
    const old = motion({ session_id: ctx(7), revision: 900, now_ms: NOW });
    const restarted = motion({
      session_id: ctx(0, EPOCH + 5_000),
      revision: 1,
      now_ms: NOW,
    });
    expect(isOlder(old, restarted)).toBe(true);
    expect(isOlder(restarted, old)).toBe(false);
  });

  it('orders different sessions by native clock only, unknown when it is', () => {
    const base = motion({ session_id: 's2', revision: 1, now_ms: NOW });
    expect(isOlder(motion({ session_id: 's1', revision: 99, now_ms: NOW - 1 }), base)).toBe(true);
    expect(isOlder(motion({ session_id: 's3', revision: 0, now_ms: NOW + 1 }), base)).toBe(false);
    expect(isOlder(motion({ session_id: 's1', now_ms: null }), base)).toBe(false);
    // Neither id is native's and the clocks tie: neither is known to be older.
    expect(isOlder(motion({ session_id: 's1', now_ms: NOW }), base)).toBe(false);
    expect(isOlder(base, motion({ session_id: 's1', now_ms: NOW }))).toBe(false);
  });
});

describe('shownMotion', () => {
  const status = cubesStatus({
    revision: 10,
    position: fix(100, NOW),
    last_position: fix(100, NOW),
  });

  it('draws you from the pushed fix when it is newer in the same context', () => {
    const pushed = motion({
      revision: 11,
      now_ms: NOW + 50,
      position: fix(200, NOW + 50),
    });
    expect(shownMotion(status, pushed)?.position?.x).toBe(200);
  });

  it('never moves you back for a late poll or an older motion read', () => {
    const pushed = motion({
      revision: 12,
      now_ms: NOW + 80,
      position: fix(300, NOW + 80),
    });
    const latePoll = cubesStatus({
      revision: 11,
      now_ms: NOW + 90,
      position: fix(200, NOW + 40),
      last_position: fix(200, NOW + 40),
    });
    expect(shownMotion(latePoll, pushed)?.position?.x).toBe(300);
    const oldRead = motion({
      revision: 9,
      now_ms: NOW - 50,
      position: fix(50, NOW - 50),
    });
    expect(shownMotion(status, oldRead)?.position?.x).toBe(100);
  });

  it('follows the poll once it is newer, e.g. after a missed event', () => {
    const pushed = motion({
      revision: 8,
      now_ms: NOW - 100,
      position: fix(50, NOW - 100),
    });
    expect(shownMotion(status, pushed)).toBe(status);
  });

  it('hides you while the pushed fix is of a newer context than the map and cubes', () => {
    const zoned = motion({
      session_id: 's2',
      revision: 1,
      zone_id: 2020,
      map_id: 'World/World_D/World_D_A',
      now_ms: NOW + 100,
      position: fix(-9, NOW + 100),
    });
    const shown = shownMotion(status, zoned);
    expect(shown?.session_id).toBe('s1');
    expect(shown?.map_id).toBe(status.map_id);
    expect(shown).toMatchObject({
      position: null,
      last_position: null,
      facing: null,
    });
    // A Clear: same zone and map, another session.
    const cleared = motion({
      session_id: 's2',
      revision: 1,
      now_ms: NOW + 100,
    });
    expect(shownMotion(status, cleared)?.last_position).toBeNull();
  });

  it('hides your old position once a Clear or zone change is pushed in the same millisecond', () => {
    const polled = cubesStatus({
      session_id: ctx(3),
      revision: 50,
      position: fix(100, NOW),
      last_position: fix(100, NOW),
    });
    const cleared = motion({
      session_id: ctx(4),
      revision: 51,
      now_ms: NOW,
      position: null,
    });
    expect(shownMotion(polled, cleared)).toMatchObject({
      session_id: ctx(3),
      last_position: null,
    });
    const zoned = motion({
      session_id: ctx(4),
      revision: 51,
      zone_id: 2020,
      map_id: 'World/World_D/World_D_A',
      now_ms: NOW,
      position: fix(-9, NOW),
    });
    expect(shownMotion(polled, zoned)).toMatchObject({
      map_id: polled.map_id,
      position: null,
    });
    // A new capture, whose revisions start again below the old capture's.
    const restarted = motion({
      session_id: ctx(0, EPOCH + 5_000),
      revision: 1,
      now_ms: NOW,
    });
    expect(shownMotion(polled, restarted)?.last_position).toBeNull();
  });

  it('keeps the poll when the other context is known to be older', () => {
    const before = motion({
      session_id: 's0',
      now_ms: NOW - 100,
      position: fix(-1, NOW - 100),
    });
    expect(shownMotion(status, before)).toBe(status);
    // A late read of the context before, in the same millisecond and with its own fix.
    const polled = cubesStatus({
      session_id: ctx(4),
      revision: 51,
      position: fix(100, NOW),
    });
    const late = motion({
      session_id: ctx(3),
      revision: 50,
      now_ms: NOW,
      position: fix(-1, NOW),
    });
    expect(shownMotion(polled, late)).toBe(polled);
  });

  it('hides you while the order of the other context is not known', () => {
    const unknown = motion({ session_id: 's0', now_ms: null });
    expect(shownMotion(status, unknown)).toMatchObject({
      session_id: 's1',
      position: null,
    });
    const tied = motion({ session_id: 's0', now_ms: NOW });
    expect(shownMotion(status, tied)?.last_position).toBeNull();
  });

  it('draws nothing without a cube status, whatever was pushed', () => {
    expect(shownMotion(null, motion())).toBeNull();
    expect(shownMotion(status, null)).toBe(status);
  });
});
