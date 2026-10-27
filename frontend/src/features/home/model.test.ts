import { getI18n } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { LivePlayer, LiveStatus } from '../../types/companion';
import type { LogMeta } from '../../types/offline';
import {
  dayPart,
  fightInProgress,
  fightResult,
  fightTrends,
  firstSteps,
  localName,
  setupBlocking,
  since,
} from './model';

const log = (id: string, patch: Partial<LogMeta> = {}): LogMeta => ({
  id,
  label: null,
  started_ms: null,
  duration_ms: 60_000,
  damage: null,
  dps: null,
  players: 6,
  player_names: [],
  boss: 'Kashapa',
  zone_id: null,
  run_id: null,
  end_reason: 'kill',
  ...patch,
});

const live = (patch: Partial<LiveStatus> = {}): LiveStatus => ({
  running: true,
  phase: 'capturing',
  message: '',
  duration_ms: 0,
  events: 0,
  players: [],
  stats: {},
  ...patch,
});

const me: LivePlayer = {
  entity: 1,
  label: 'Ranger #1',
  damage: 10,
  dps: 0,
  current_dps: 0,
  share: 1,
  direct_hits: 0,
  critical_hits: 0,
  ticks: 0,
  skills: {},
};

const en = () => getI18n().getFixedT('en', 'home');
const pt = () => getI18n().getFixedT('pt-BR', 'home');

describe('home model', () => {
  it('greets by the part of the day', () => {
    expect(dayPart(7).id).toBe('morning');
    expect(dayPart(13).id).toBe('afternoon');
    expect(dayPart(20).id).toBe('evening');
    expect(dayPart(2).id).toBe('night');
  });

  it('names the local character only when capture knows it', () => {
    expect(localName(live({ players: [{ ...me, is_local: true, name: 'Lyra' }] }), null)).toBe(
      'Lyra',
    );
    expect(
      localName(
        live({ players: [{ ...me, is_local: true, name: 'Lyra', name_known: false }] }),
        null,
      ),
    ).toBeNull();
    expect(localName(live(), 'Profile')).toBe('Profile');
    expect(localName(live(), null)).toBeNull();
  });

  it('sees a fight in progress only while capture is live and it has not ended', () => {
    const player = me;
    expect(fightInProgress(live({ duration_ms: 5000, players: [player] }))).toBe(true);
    expect(
      fightInProgress(live({ duration_ms: 5000, players: [player], encounter_ended: true })),
    ).toBe(false);
    expect(fightInProgress(live({ duration_ms: 5000 }))).toBe(false);
    expect(
      fightInProgress(live({ phase: 'waiting_for_game', duration_ms: 5000, players: [player] })),
    ).toBe(false);
  });

  it('names a confirmed setup problem only while it is what stops capture', () => {
    expect(setupBlocking('error', 'missing', '')).toBe('missing');
    // Between retries capture reconnects; the problem stays named instead of flickering.
    expect(setupBlocking('connecting', 'unavailable', '')).toBe('unavailable');
    expect(setupBlocking('error', 'unsupported', '')).toBe('unsupported');
    // A working driver, an unknown probe or an unreadable capture status keep their own state.
    expect(setupBlocking('error', null, '')).toBeNull();
    expect(setupBlocking('waiting', 'missing', '')).toBeNull();
    expect(setupBlocking('capturing', 'missing', '')).toBeNull();
    expect(setupBlocking('error', 'missing', 'Error: status unavailable')).toBeNull();
  });

  it('words a result only from what native recorded', () => {
    expect(fightResult('kill', en())).toEqual({ label: 'Kill', tone: 'success' });
    expect(fightResult('reset', en()).label).toBe('Boss reset');
    expect(fightResult(null, en()).label).toBe('In progress');
    expect(fightResult('something_new', en()).label).toBe('Ended');
    expect(fightResult('reset', pt())).toEqual({ label: 'Chefe reiniciou', tone: 'warn' });
  });

  it('compares each fight with the previous one on the same boss', () => {
    const trends = fightTrends([
      log('c', { dps: 1100 }),
      log('x', { boss: 'Other', dps: 5000 }),
      log('b', { dps: 1000 }),
      log('a', { dps: null }),
      log('z', { dps: 900 }),
    ]);
    expect(trends.get('c')?.change).toBeCloseTo(0.1);
    expect(trends.get('c')?.best).toBe(true);
    expect(trends.get('b')?.change).toBeCloseTo(100 / 900);
    expect(trends.get('b')?.best).toBe(false);
    // A fight without a figure, and a boss seen once, get no trend and no best.
    expect(trends.get('a')).toEqual({ change: null, best: false });
    expect(trends.get('x')).toEqual({ change: null, best: false });
  });

  it('writes coarse ages', () => {
    const now = new Date(2026, 9, 19, 20, 0).getTime();
    expect(since(now - 20_000, now, en())).toBe('just now');
    expect(since(now - 9 * 60_000, now, en())).toBe('9 min ago');
    expect(since(now - 3 * 3_600_000, now, en())).toBe('3 h ago');
    expect(since(new Date(2026, 9, 18, 22, 0).getTime(), now, en())).toBe('Yesterday');
    expect(since(new Date(2026, 9, 15, 12, 0).getTime(), now, en())).toBe('4 days ago');
    expect(since(now - 9 * 60_000, now, pt())).toBe('há 9 min');
    expect(since(new Date(2026, 9, 18, 22, 0).getTime(), now, pt())).toBe('Ontem');
    expect(since(new Date(2026, 9, 15, 12, 0).getTime(), now, pt())).toBe('há 4 dias');
  });

  it('ticks the first steps off from observed state', () => {
    const none = firstSteps({
      capturing: false,
      meterShown: false,
      savedFights: null,
      alertOn: false,
      farming: false,
    });
    expect(none.map((s) => s.done)).toEqual([false, false, false, false, false]);
    const some = firstSteps({
      capturing: true,
      meterShown: true,
      savedFights: 3,
      alertOn: false,
      farming: true,
    });
    expect(some.filter((s) => s.done).map((s) => s.id)).toEqual(['game', 'meter', 'fight', 'pets']);
  });
});
