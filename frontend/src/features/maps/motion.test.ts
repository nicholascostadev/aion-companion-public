import { describe, expect, it } from 'vitest';
import { MapMotion, type MotionFix } from './motion';

/** A fix at `x` cm east, observed at `observed` ms. */
const fix = (x: number, observed: number): MotionFix => ({
  x,
  y: 0,
  observed_ms: observed,
  zone_id: 1,
  map_id: 'm',
});

describe('display motion between native fixes', () => {
  it('eases to a new fix over 200 ms, then predicts at most 15 m or 1.2 s ahead', () => {
    const motion = new MapMotion();
    motion.accept(fix(0, 0), 0, 0);
    motion.accept(fix(1000, 500), 500, 500);
    expect(motion.sample(600).position!.estimated).toBe(true);
    expect(motion.sample(700).position!.x).toBe(1400);
    expect(motion.sample(5000).position!.x).toBe(2500);
    expect(motion.sample(5000).active).toBe(false);
  });

  it('never extends the prediction for the same fix read again', () => {
    const motion = new MapMotion();
    motion.accept(fix(0, 0), 0, 0);
    motion.accept(fix(1000, 500), 500, 500);
    motion.accept(fix(1000, 500), 1000, 1000);
    expect(motion.sample(5000).position!.x).toBe(2500);
  });
});
