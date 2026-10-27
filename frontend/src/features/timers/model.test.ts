import { getI18n } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { NOW, timer } from './fixtures';
import { countdown, serverTime, sortedTimers, timerState } from './model';

describe('timer time and certainty', () => {
  it('expires openings without inventing the next occurrence or a boss sighting', () => {
    expect(timerState(timer(), NOW + 60_000)).toBe('unknown');
    expect(timerState(timer({ state: 'open', ends_ms: NOW + 1000 }), NOW + 1000)).toBe('unknown');
    expect(timerState(timer({ state: 'alive', ends_ms: NOW + 1000 }), NOW + 1000)).toBe('unknown');
    expect(timerState(timer({ state: 'unknown' }), NOW)).toBe('unknown');
  });
  it('requires a fresh native snapshot for alive and open states', () => {
    expect(timerState(timer({ state: 'alive', due_ms: null }), NOW)).toBe('alive');
    expect(timerState(timer({ state: 'alive', due_ms: null }), NOW, true)).toBe('unknown');
    expect(timerState(timer({ state: 'open', ends_ms: NOW + 1000 }), NOW, true)).toBe('unknown');
  });
  it('puts active rows before upcoming rows and unknowns last', () => {
    expect(
      sortedTimers(
        [
          timer({ id: 'unknown', state: 'unknown' }),
          timer(),
          timer({ id: 'alive', state: 'alive', due_ms: null }),
        ],
        NOW,
        false,
      ).map((r) => r.id),
    ).toEqual(['alive', 'festival', 'unknown']);
  });
  it('clamps countdowns and formats the explicit server timezone', () => {
    const en = getI18n().getFixedT('en', 'timers');
    const pt = getI18n().getFixedT('pt-BR', 'timers');
    expect(countdown(-1000, en)).toBe('0:00');
    expect(countdown(61_000, en)).toBe('1:01');
    expect(countdown(3600_000, en)).toBe('1h 00m');
    expect(countdown(25 * 3600_000, en)).toBe('1d 1h');
    expect(countdown(3600_000, pt)).toBe('1h 00min');
    expect(serverTime(NOW, 'Asia/Taipei')).toBe('21:00');
    expect(serverTime(NOW, 'Asia/Taipei', false, 'pt-BR')).toBe('21:00');
    expect(serverTime(NOW, 'invalid')).toBeNull();
  });
});
