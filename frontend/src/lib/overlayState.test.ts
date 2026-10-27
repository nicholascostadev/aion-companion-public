import { describe, expect, it } from 'vitest';
import type { OverlayStatus } from '../types/companion';
import { dpsRequested, groupEnabled, groupRequested } from './overlayState';

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

  it('keeps Group enabled outside raid rooms and falls back to older fields', () => {
    const outside = { ...base, group_enabled: true, group_requested: false, group_visible: false };
    expect(groupEnabled(outside)).toBe(true);
    expect(groupRequested(outside)).toBe(false);
    expect(groupEnabled({ ...base, group_requested: true })).toBe(true);
    expect(groupEnabled({ ...base, group_visible: true })).toBe(true);
    expect(groupRequested({ ...base, group_visible: true })).toBe(true);
    expect(groupEnabled(base)).toBe(false);
    expect(groupRequested(base)).toBe(false);
  });
});
