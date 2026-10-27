import { describe, expect, it } from 'vitest';
import { nativeReport, report } from '../features/offline/fixtures';
import {
  normalizeLiveStatus,
  normalizeLogList,
  normalizeReport,
  normalizeSettings,
  normalizeStatus,
  SETTINGS_FALLBACK,
} from './offlineNormalize';

describe('offline payload normalization', () => {
  it('maps native wire facts without inventing values', () => {
    const r = report();
    const aria = r.players[0]!;
    expect(aria.active_pct).toBeCloseTo(0.667);
    expect(aria.activity_method).toMatch(/one-second bins/);
    expect(aria.healing_received).toBe(120);
    // Absent counters stay unknown instead of becoming zero.
    expect(r.players[1]!.critical_hits_observed).toBeNull();
    expect(r.players[1]!.edps).toBeNull();
    // Wire id 0 means "not observed".
    expect(r.events.find((e) => e.kind === 'death')?.source).toBeNull();
    expect(r.events[0]!.instance).toBeNull();
    expect(r.hp.every((s) => s.entity !== 0 && s.entity !== null)).toBe(true);
    // first_hit's 0 is "no amount", not a 0-damage hit.
    expect(r.highlights.find((h) => h.kind === 'first_hit')?.value).toBeNull();
    // Decoded variant choices are labelled as such, never named.
    expect(aria.skills[0]!.specialties).toEqual([
      { slot: null, name: 'Variant choice 12', description: null, count: null },
    ]);
    expect(r.buffs[1]!.end_ms).toBeNull();
    expect(r.events.find((e) => e.tick)?.amount).toBe(2000);
  });

  it('keeps current-only HP updates with the last observed max', () => {
    const r = report({
      targets: [
        { id: 50, name: 'Boss', boss: true, max_hp: 1000, current_hp: 0, damage: 1000 },
        { id: 60, name: 'Add', current_hp: 50, max_hp: null, damage: 10 },
      ],
      hp: [
        { entity: 50, at_ms: 0, current: 1000, max: 1000 },
        { entity: 50, at_ms: 1000, current: 800, max: null },
        { entity: 50, at_ms: 2000, current: 600 },
        // A max-only update changes the known max without adding a sample.
        { entity: 50, at_ms: 2500, current: null, max: 2000 },
        { entity: 50, at_ms: 3000, current: 1200, max: null },
        // An observed zero is a real value, not a missing one.
        { entity: 50, at_ms: 4000, current: 0, max: null },
        // No max was ever observed for this entity, so there is no fraction to show.
        { entity: 60, at_ms: 1000, current: 50, max: null },
      ],
    });
    expect(r.hp.map((s) => [s.entity, s.at_ms, s.current, s.max])).toEqual([
      [50, 0, 1000, 1000],
      [50, 1000, 800, 1000],
      [50, 2000, 600, 1000],
      [50, 3000, 1200, 2000],
      [50, 4000, 0, 2000],
    ]);
  });

  it('uses the target max for current-only HP when the spawn sample is not in the tail', () => {
    const r = report({
      events_truncated: true,
      targets: [{ id: 50, name: 'Boss', boss: true, max_hp: 5000, current_hp: 2000 }],
      hp: [
        { entity: 50, at_ms: 9000, current: 2500, max: null },
        { entity: 50, at_ms: 9500, current: 2000, max: null },
      ],
    });
    expect(r.hp.map((s) => [s.current, s.max])).toEqual([
      [2500, 5000],
      [2000, 5000],
    ]);
  });

  it('reads truncation and keeps an empty live report empty', () => {
    expect(
      report({ events_truncated: true, event_window_start_ms: 4000 }).event_window_start_ms,
    ).toBe(4000);
    const empty = normalizeStatus({
      report: { id: '', players: [], events: [], started_ms: 0 },
    }).report;
    expect(empty?.players).toEqual([]);
    expect(empty?.started_ms).toBeNull();
    expect(empty?.id).toBeNull();
  });

  it('marks details and never takes a summary for a full report', () => {
    const full = report({ event_count: 1234 });
    expect(full.detail_level).toBe('full');
    expect(full.event_count).toBe(1234);
    expect(report().event_count).toBeNull();
    expect(normalizeReport({ ...nativeReport, detail_level: 'summary' })).toBeNull();
    expect(
      normalizeStatus({ report: { ...nativeReport, detail_level: 'summary' } }).report,
    ).toBeNull();
  });

  it('reads the compact live status as a summary without report details', () => {
    const status = normalizeLiveStatus({
      settings: SETTINGS_FALLBACK,
      library_count: 4,
      report: {
        ...nativeReport,
        detail_level: 'summary',
        events: [],
        buffs: [],
        hp: [],
        event_count: 98,
      },
    });
    const summary = status.report;
    expect(summary?.detail_level).toBe('summary');
    expect(summary?.event_count).toBe(98);
    expect(summary?.players.map((p) => p.name)).toEqual(report().players.map((p) => p.name));
    expect(summary?.targets).toEqual(report().targets);
    expect(summary?.highlights).toEqual(report().highlights);
    expect(summary?.coverage).toEqual(report().coverage);
    expect(summary?.hp).toEqual([]);
    expect(summary && 'events' in summary).toBe(false);
    expect(summary && 'buffs' in summary).toBe(false);
    expect(status.library_count).toBe(4);
    // A reply that still carries details is reduced to a summary all the same.
    const detailed = normalizeLiveStatus({ report: nativeReport }).report;
    expect(detailed?.detail_level).toBe('summary');
    expect(detailed && 'events' in detailed).toBe(false);
  });

  it('keeps open buff trackers and estimate metadata, and drops malformed entries', () => {
    const status = normalizeStatus({
      trackers: [
        {
          bar_id: 'b',
          skill: 1,
          remaining_ms: null,
          kind: 'buff',
          estimated: false,
          basis: 'observed buff duration',
        },
        {
          bar_id: 'b',
          skill: 2,
          remaining_ms: 0,
          kind: 'cooldown',
          estimated: true,
          basis: 'catalogue duration since cast',
        },
        { skill: 3 },
      ],
      alerts: [
        {
          id: 'a',
          name: 'Reset',
          due_ms: 10,
          remaining_ms: 5,
          sound: 'bell',
          volume: 0.5,
          lead_seconds: 60,
        },
      ],
      capabilities: { ready_check: false, protocol: 'Global', nested: { no: true } },
      error: 'disk full',
    });
    expect(status.trackers).toHaveLength(2);
    expect(status.trackers[0]!.remaining_ms).toBeNull();
    expect(status.trackers[1]!.estimated).toBe(true);
    expect(status.alerts[0]!.lead_seconds).toBe(60);
    expect(status.capabilities).toEqual({ ready_check: false, protocol: 'Global' });
    expect(status.error).toBe('disk full');
    expect(status.settings).toBeNull();
    expect(status.report).toBeNull();
  });

  it('fills only missing settings from native defaults and clamps ranges', () => {
    const s = normalizeSettings({
      opacity: 5,
      hotkeys: { toggle_lock: 'Ctrl+Alt+L' },
      alerts: [{ name: 'x' }],
    });
    expect(s?.opacity).toBe(1);
    expect(s?.hotkeys.toggle_lock).toBe('Ctrl+Alt+L');
    expect(s?.hotkeys.reset).toBe(SETTINGS_FALLBACK.hotkeys.reset);
    expect(s?.alerts[0]?.at_ms).toBeNull();
    expect(s?.boss_alerts).toBe(false);
    expect(normalizeSettings(null)).toBeNull();
  });

  it('reads library rows with name lists or counts', () => {
    const rows = normalizeLogList([
      { id: 'fight-1', players: ['Aria', 'Bryn'], damage: 10, run_id: '' },
      { id: 'fight-2', players: 3 },
      { label: 'no id' },
    ]);
    expect(rows.map((r) => [r.id, r.players])).toEqual([
      ['fight-1', 2],
      ['fight-2', 3],
    ]);
    expect(rows[0]!.player_names).toEqual(['Aria', 'Bryn']);
    expect(rows[0]!.run_id).toBeNull();
  });
});
