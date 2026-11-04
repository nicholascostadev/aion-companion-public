import { describe, expect, it } from 'vitest';
import type { OverlayStatus } from '../types/companion';
import { dpsRequested } from './overlayState';

const base: OverlayStatus = {
  locked: false,
  ready: true,
  visible: false,
  can_lock: true,
  errors: [],
};

describe('overlay status readings', () => {
  it('follows the DPS choice while focus hides the meter, and visibility on older natives', () => {
    expect(dpsRequested({ ...base, requested_visible: true, visible: false })).toBe(true);
    expect(dpsRequested({ ...base, requested_visible: false, visible: true })).toBe(false);
    expect(dpsRequested({ ...base, visible: true })).toBe(true);
  });
});
