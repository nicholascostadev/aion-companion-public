import { describe, expect, it } from 'vitest';
import type { PetPosition } from '../../types/pets';
import { MapMotion } from './mapMotion';

const fix = (x: number, observed_ms: number): PetPosition => ({
  x,
  y: 100,
  observed_ms,
  zone_id: 7,
  map_id: 'test-map',
});
const moving = () => {
  const motion = new MapMotion();
  motion.accept(fix(0, 1000), 1000, 0);
  motion.accept(fix(1000, 1500), 1500, 500);
  return motion;
};

describe('display position prediction', () => {
  it('predicts recent velocity, stops at a bounded displacement, and preserves the measured fix', () => {
    const motion = new MapMotion();
    const measured = Object.freeze(fix(1000, 1500));
    motion.accept(fix(0, 1000), 1000, 0);
    motion.accept(measured, 1500, 500);
    const predicted = motion.sample(700);
    expect(predicted.position?.x).toBe(1400);
    expect(predicted.position?.estimated).toBe(true);
    expect(predicted.position?.observed_ms).toBe(1500);
    const stopped = motion.sample(2000);
    expect(stopped.position?.x).toBe(2500);
    expect(stopped.position?.uncertainty_m).toBe(15);
    expect(stopped.active).toBe(false);
    expect(motion.sample(5000)).toEqual(stopped);
    expect(measured.x).toBe(1000);
  });

  it('pulls a wrong estimate back to a newly confirmed stationary position', () => {
    const motion = moving();
    const old = motion.sample(1500).position!.x;
    motion.accept(fix(1000, 2500), 2500, 1500);
    expect(motion.sample(1500).position?.x).toBe(old);
    expect(motion.sample(1600).position?.x).toBeGreaterThan(1000);
    expect(motion.sample(1700).position?.x).toBe(1000);
    expect(motion.sample(1700).position?.estimated).toBe(false);
    expect(motion.sample(1700).active).toBe(false);
  });

  it('reconciles a change in direction and uses the newest measured velocity', () => {
    const motion = moving();
    motion.accept(fix(900, 2000), 2000, 1000);
    expect(motion.sample(1200).position?.x).toBe(860);
    expect(motion.sample(2200).position?.x).toBe(660);
    expect(motion.sample(2200).active).toBe(false);
  });

  it('accounts for delivery delay and cannot extend prediction with repeated polls', () => {
    const motion = new MapMotion();
    motion.accept(fix(0, 1000), 1000, 0);
    motion.accept(fix(1000, 1500), 1800, 500);
    expect(motion.sample(700).position?.x).toBe(2000);
    motion.accept(fix(1000, 1500), 2500, 900);
    expect(motion.sample(950).active).toBe(false);
    expect(motion.sample(5000).position?.x).toBe(2500);
  });

  it('caps slow movement at 1.2 seconds rather than continuing until a new packet', () => {
    const motion = new MapMotion();
    motion.accept(fix(0, 1000), 1000, 0);
    motion.accept(fix(100, 2000), 2000, 1000);
    expect(motion.sample(2200).position?.x).toBe(220);
    expect(motion.sample(2200).active).toBe(false);
    expect(motion.sample(9000).position?.x).toBe(220);
  });

  it('snaps teleports, changed maps, implausible speed, and stale observations', () => {
    for (const [next, now] of [
      [fix(10_000, 2000), 2000],
      [{ ...fix(1100, 2000), zone_id: 9 }, 2000],
      [fix(2000, 1600), 1600],
      [fix(1100, 2000), 6000],
    ] satisfies [PetPosition, number][]) {
      const motion = moving();
      motion.accept(next, now, 1000);
      expect(motion.sample(1000).position?.x).toBe(next.x);
      expect(motion.sample(1000).position?.estimated).toBe(false);
      expect(motion.sample(1000).active).toBe(false);
    }
  });

  it('requires two usable observations and clears all prediction on disconnect', () => {
    const motion = new MapMotion();
    motion.accept(fix(0, 1000), 1000, 0);
    expect(motion.sample(1000).active).toBe(false);
    motion.accept(fix(10, 1005), 1005, 5);
    expect(motion.sample(500).position?.x).toBe(10);
    expect(motion.sample(500).position?.estimated).toBe(false);
    motion.accept(null, 2000, 1000);
    expect(motion.sample(1000).position).toBeNull();
    motion.accept(fix(500, 2500), 2500, 1500);
    expect(motion.sample(2000).position?.x).toBe(500);
    expect(motion.sample(2000).active).toBe(false);
  });
});
