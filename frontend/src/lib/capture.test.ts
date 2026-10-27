import { describe, expect, it } from 'vitest';
import { captureState } from './capture';

describe('background capture state', () => {
  it('names native phases without any stopped state', () => {
    expect(captureState(null)).toBe('connecting');
    expect(captureState({ running: false, phase: 'starting' })).toBe('connecting');
    expect(captureState({ running: true, phase: 'starting' })).toBe('connecting');
    expect(captureState({ running: true, phase: 'waiting_for_game' })).toBe('waiting');
    expect(captureState({ running: true, phase: 'capturing' })).toBe('capturing');
    expect(captureState({ running: false, phase: 'error' })).toBe('error');
    // A worker that ended is restarted by native; until then it is reconnecting.
    expect(captureState({ running: false, phase: 'stopped' })).toBe('connecting');
  });
});
