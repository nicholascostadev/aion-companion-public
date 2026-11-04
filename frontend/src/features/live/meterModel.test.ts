import { describe, expect, it } from 'vitest';
import { formattersFor } from '../../i18n/formatters';
import { createTestI18n } from '../../i18n/testing';
import type { LiveStatus } from '../../types/companion';
import { aria, bryn, cara, meterReport } from './meterFixtures';
import { damageCounts, dpsFigure, fromLive, fromReport, meterSummary } from './meterModel';

const t = createTestI18n('en').getFixedT('en', 'live');
const fmt = formattersFor('en');

const counted = {
  damage: 100,
  healing: 0,
  hits: 4,
  crits: 1,
  critical_hits_observed: 2,
  damage_hits: null,
  damage_crits: null,
  damage_critical_hits_observed: null,
};

describe('damage-only hit counts', () => {
  it('prefers native damage counters over the combined damage+healing ones', () => {
    expect(
      damageCounts({
        ...counted,
        healing: 50,
        damage_hits: 3,
        damage_crits: 2,
        damage_critical_hits_observed: 2,
      }),
    ).toEqual({ hits: 3, crits: 2, observed: 2, critRate: 1 });
  });

  it('uses combined counters only when nothing was healed', () => {
    expect(damageCounts(counted)).toEqual({ hits: 4, crits: 1, observed: 2, critRate: 0.5 });
    // A skill that also healed cannot split its hits: unknown, never a guess.
    expect(damageCounts({ ...counted, healing: 10 })).toEqual({
      hits: null,
      crits: null,
      observed: null,
      critRate: null,
    });
  });

  it('reports no crit rate without a decoded crit flag', () => {
    const rate = damageCounts({
      ...counted,
      damage_hits: 3,
      damage_crits: null,
      damage_critical_hits_observed: 0,
    });
    expect(rate).toEqual({ hits: 3, crits: null, observed: null, critRate: null });
  });
});

describe('meter model from a native report', () => {
  it('ranks only players with outgoing damage and keeps solo shares at 100%', () => {
    const model = fromReport(meterReport({ players: [aria, cara] }), { t });
    expect(model.players.map((p) => p.name)).toEqual(['Aria']);
    expect(model.everyone.map((p) => p.name)).toEqual(['Aria', 'Cara']);
    const [solo] = model.players;
    expect(solo!.share).toBe(1);
    expect(model.total).toBe(74_600);
    expect(model.totalDps).toBe(7_460);
    expect(model.localId).toBe('1');
    // Skills are damage dealt only, highest first; incoming damage is no skill.
    expect(solo!.skills.map((s) => [s.name, s.hits, s.critRate])).toEqual([
      ['Spinning Strike', 1, 1],
      ['Rending Bleed', 3, null],
      ['Impactful Crush', 1, 0],
    ]);
    expect(solo!.skills.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it('shares damage between every player who deals it', () => {
    const model = fromReport(meterReport({ players: [aria, bryn, cara] }), { t });
    expect(model.players.map((p) => [p.name, p.share])).toEqual([
      ['Aria', 0.746],
      ['Bryn', 0.254],
    ]);
    expect(model.totalCurrent).toBe(1_500);
  });

  it('uses active DPS when that mode is selected and hides names for privacy', () => {
    const model = fromReport(meterReport({ players: [aria, bryn] }), {
      hideNames: true,
      mode: 'active',
      t,
    });
    expect(model.players.map((p) => [p.name, p.dps])).toEqual([
      ['You', 9_325],
      // No active DPS reported: fall back to encounter DPS rather than invent one.
      ['Cleric 2', 2_540],
    ]);
  });

  it('copies exactly the rows and names on screen', () => {
    const model = fromReport(meterReport({ players: [aria, bryn] }), { hideNames: true, t });
    const ranking = meterSummary(
      model,
      { kind: 'ranking' },
      { caption: 'All targets', rows: 1, t, fmt },
    );
    expect(ranking).toBe(
      'Damage dealt · All targets · 0:10 · 10K/s | 1. You 74.6K · 7.5K/s (74.6%)',
    );
    const skills = meterSummary(
      model,
      { kind: 'player', id: '1' },
      { caption: 'Golem', rows: 2, t, fmt },
    );
    expect(skills).toBe(
      'Damage dealt · Golem · 0:10 · You 74.6K · 7.5K/s · 74.6% | 1. Spinning Strike 55.1K (73.9%) | 2. Rending Bleed 9.8K (13.1%)',
    );
    expect(skills).not.toContain('Aria');
  });
});

describe('meter model before any report', () => {
  it('shows live totals without inventing hit detail', () => {
    const live: LiveStatus = {
      running: true,
      phase: 'capturing',
      message: '',
      duration_ms: 4000,
      events: 3,
      stats: {},
      players: [
        {
          entity: 42,
          label: 'Ranger #42',
          is_local: true,
          damage: 4000,
          dps: 1000,
          current_dps: 800,
          share: 1,
          direct_hits: 2,
          critical_hits: 1,
          ticks: 0,
          skills: { Snipe: 3000, Volley: 1000 },
        },
      ],
    };
    const model = fromLive(live, { t });
    expect(model.source).toBe('live');
    expect(model.players[0]!.skills.map((s) => [s.name, s.share, s.hits, s.critRate])).toEqual([
      ['Snipe', 0.75, null, null],
      ['Volley', 0.25, null, null],
    ]);
    expect(model.players[0]!.critRate).toBeNull();
  });
});

describe('profile links', () => {
  it('links characters observed by name on a Global server, and nobody while names are hidden', () => {
    const fight = meterReport({
      players: [
        { ...aria, server_id: 2301 },
        { ...bryn, server_id: 1001 },
        { ...cara, server_id: null },
      ],
    });
    const profiles = (hideNames: boolean) =>
      fromReport(fight, { hideNames, t }).everyone.map((p) => [p.id, p.profile]);
    expect(profiles(false)).toEqual([
      ['1', { name: 'Aria', serverId: 2301 }],
      // A Korean id names no region; no server, no link.
      ['2', null],
      ['3', null],
    ]);
    expect(profiles(true).every(([, profile]) => profile === null)).toBe(true);
  });

  it('never links a live row whose name has not been observed yet', () => {
    const row = {
      entity: 7,
      label: 'Gladiator #7',
      name: 'Rival',
      server_id: 1304,
      damage: 100,
      dps: 10,
      current_dps: 0,
      share: 1,
      direct_hits: 1,
      critical_hits: 0,
      ticks: 0,
      skills: {},
    };
    const live = (patch: object): LiveStatus => ({
      running: true,
      phase: 'capturing',
      message: '',
      duration_ms: 10_000,
      events: 1,
      stats: {},
      players: [{ ...row, ...patch }],
    });
    expect(fromLive(live({ name_known: true }), { t }).players[0]!.profile).toEqual({
      name: 'Rival',
      serverId: 1304,
    });
    expect(fromLive(live({ name_known: false }), { t }).players[0]!.profile).toBeNull();
    expect(
      fromLive(live({ name_known: true }), { hideNames: true, t }).players[0]!.profile,
    ).toBeNull();
  });
});

describe('DPS figures', () => {
  it('rounds below a thousand and keeps compact thousands in every language', () => {
    expect(dpsFigure(fmt, 466.6)).toBe('467');
    expect(dpsFigure(fmt, 466.4)).toBe('466');
    expect(dpsFigure(fmt, 0)).toBe('0');
    expect(dpsFigure(fmt, -3)).toBe('0');
    // Rounding up to a thousand reads as compact, never as "1,000".
    expect(dpsFigure(fmt, 999.5)).toBe('1K');
    expect(dpsFigure(fmt, 999.4)).toBe('999');
    expect(dpsFigure(fmt, 12_345)).toBe('12.3K');
    expect(dpsFigure(formattersFor('pt-BR'), 466.6)).toBe('467');
    expect(dpsFigure(formattersFor('pt-BR'), 12_345)).toBe('12.3K');
  });
});
