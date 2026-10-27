import { describe, expect, it } from 'vitest';
import type { ObservedTimer } from '../../types/alerts';
import { formattersFor } from '../../i18n/formatters';
import { createTestI18n } from '../../i18n/testing';
import { normalizeConfig, normalizeDashboard } from '../../lib/alertsNormalize';
import { NOW, catalogue, dashboard, entry, rule } from './fixtures';
import {
  ago,
  catalogueMatches,
  compactTimes,
  customRules,
  describeSchedule,
  duplicateRule,
  factionLabel,
  enablePreset,
  factionMatches,
  inQuietHours,
  isConfigured,
  latestObservation,
  leadLabel,
  leadOption,
  minuteOfDay,
  muteLabel,
  needsClock,
  patchPreset,
  patchRule,
  presetRule,
  primaryLead,
  remaining,
  ruleFromObserved,
  ruleFromTemplate,
  scheduleSummary,
  nextUp,
  soonest,
  upsertRule,
  validateQuietHours,
  validateRule,
  viewFaction,
  weekdayLabel,
  withAtStart,
  withPrimaryLead,
  spawnFresh,
  SPAWN_FRESH_MS,
} from './model';

/* Existing expectations are the English (en-US) wording. */
const t = createTestI18n('en').getFixedT('en', 'alerts');
const fmt = formattersFor('en');

describe('alert rule validation', () => {
  it('accepts a complete calendar rule', () => {
    expect(validateRule(t, rule())).toEqual({});
  });

  it('rejects bad names, times, reminders, volume and zones', () => {
    const errors = validateRule(
      t,
      rule({
        name: ' ',
        schedule: { type: 'calendar', times: ['25:00'], weekdays: [] },
        lead_seconds: [60, 60],
        volume: 1.5,
        timezone: 'Mars/Olympus',
      }),
    );
    expect(Object.keys(errors).sort()).toEqual(
      ['lead_seconds', 'name', 'times', 'timezone', 'volume'].sort(),
    );
    expect(validateRule(t, rule({ lead_seconds: [] })).lead_seconds).toMatch(/at least one/);
    expect(validateRule(t, rule({ lead_seconds: [90_000] })).lead_seconds).toMatch(/24 hours/);
    expect(
      validateRule(t, rule({ schedule: { type: 'calendar', times: [], weekdays: [] } })).times,
    ).toMatch(/at least one/);
  });

  it('checks interval, once and observed schedules', () => {
    expect(
      validateRule(t, rule({ schedule: { type: 'interval', anchor_ms: NOW, every_seconds: 30 } }))
        .every_seconds,
    ).toBeDefined();
    expect(validateRule(t, rule({ schedule: { type: 'once', at_ms: 0 } })).at_ms).toBeDefined();
    expect(validateRule(t, rule({ schedule: { type: 'observed' } })).binding).toBeDefined();
    expect(validateRule(t, rule({ schedule: { type: 'observed' }, npc_id: 7 }))).toEqual({});
    expect(validateRule(t, rule({ respawn_seconds: 10 })).respawn_seconds).toBeDefined();
  });

  it('allows an unknown schedule: nothing fires and no time is invented', () => {
    expect(validateRule(t, rule({ schedule: null }))).toEqual({});
    expect(describeSchedule(t, fmt, null, 'UTC')).toBe('Time unknown');
  });
});

describe('quiet hours and clocks', () => {
  it('spans midnight', () => {
    const quiet = { start: '23:00', end: '07:00' };
    expect(inQuietHours(23 * 60 + 30, quiet)).toBe(true);
    expect(inQuietHours(3 * 60, quiet)).toBe(true);
    expect(inQuietHours(7 * 60, quiet)).toBe(false);
    expect(inQuietHours(12 * 60, quiet)).toBe(false);
    expect(inQuietHours(13 * 60, { start: '12:00', end: '14:00' })).toBe(true);
    expect(inQuietHours(13 * 60, null)).toBe(false);
    expect(validateQuietHours(t, '22:00', '22:00')).toMatch(/differ/);
    expect(validateQuietHours(t, '7:00', '08:00')).toMatch(/HH:mm/);
  });

  it('reads the minute of day in the server clock', () => {
    expect(minuteOfDay(NOW, 'UTC')).toBe(12 * 60);
    expect(minuteOfDay(NOW, 'Asia/Seoul')).toBe(21 * 60);
  });

  it('formats leads and countdowns', () => {
    expect(leadLabel(t, 0)).toBe('At start');
    expect(leadLabel(t, 300)).toBe('5 min before');
    expect(leadLabel(t, 5400)).toBe('1 h 30 min before');
    expect(remaining(t, 65_000)).toBe('1:05');
    expect(remaining(t, 3_900_000)).toBe('1h 05m');
    expect(remaining(t, -1)).toBe('now');
  });

  it('holds daily times until the server clock is known', () => {
    expect(needsClock(rule(), false)).toBe(true);
    expect(needsClock(rule({ timezone: 'Asia/Seoul' }), false)).toBe(false);
    expect(needsClock(rule(), true)).toBe(false);
    expect(needsClock(rule({ schedule: { type: 'observed' }, npc_id: 1 }), false)).toBe(false);
  });

  it('shortens long daily time lists', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:30`);
    expect(compactTimes(t, hourly)).toBe('Every hour at :30');
    expect(
      compactTimes(t, ['23:00', '02:00', '05:00', '08:00', '11:00', '14:00', '17:00', '20:00']),
    ).toBe('Every 3 h · 02:00, 05:00, …');
    expect(compactTimes(t, ['20:00', '12:00'])).toBe('12:00, 20:00');
    expect(compactTimes(t, ['01:00', '02:10', '07:00', '09:00', '22:00'])).toBe(
      '01:00, 02:10, 07:00 +2',
    );
    expect(scheduleSummary(t, fmt, entry().rule)).toBe('Every 3 h · 02:00, 05:00, … · open 10 min');
    expect(scheduleSummary(t, fmt, rule({ schedule: null }))).toBe('Time not known yet');
  });
});

describe('ready-made catalogue', () => {
  it('saves an untouched entry only when it is switched on, turning alerts on the first time', () => {
    const rift = entry();
    const off = { ...dashboard().config, enabled: false, rules: [] };
    expect(presetRule(off, rift)).toBe(rift.rule);
    expect(isConfigured(off, rift)).toBe(false);
    const on = enablePreset(off, rift);
    expect(on.enabled).toBe(true);
    expect(on.rules).toEqual([{ ...rift.rule, enabled: true, preset_id: 'event-rift' }]);
    // Not the first alert: the master switch stays as the user left it.
    const later = enablePreset({ ...on, enabled: false }, entry({ id: 'other', name: 'Invasion' }));
    expect(later.enabled).toBe(false);
  });

  it('keeps customisations when an entry is switched off and back on', () => {
    const rift = entry();
    let config = enablePreset({ ...dashboard().config, rules: [] }, rift);
    config = patchPreset(config, rift, { sound: 'ping', lead_seconds: [600] });
    config = patchPreset(config, rift, { enabled: false });
    config = enablePreset(config, rift);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]).toMatchObject({
      id: 'preset-event-rift',
      preset_id: 'event-rift',
      enabled: true,
      sound: 'ping',
      lead_seconds: [600],
    });
  });

  it('separates custom alerts from configured entries, keeping orphans', () => {
    const rift = entry();
    const config = enablePreset(dashboard().config, rift);
    const orphan = rule({ id: 'gone', preset_id: 'retired-entry' });
    const all = upsertRule(config, orphan);
    expect(customRules(all, [rift]).map((r) => r.id)).toEqual(['r1', 'r2', 'gone']);
  });

  it('edits one before-start reminder and the at-start choice inline', () => {
    expect(primaryLead([300, 0])).toBe(300);
    expect(primaryLead([0])).toBe(0);
    expect(primaryLead([900, 300])).toBeNull();
    expect(withPrimaryLead([300, 0], 600)).toEqual([600, 0]);
    expect(withPrimaryLead([300], 600)).toEqual([600]);
    expect(withPrimaryLead([300], 0)).toEqual([0]);
    expect(withAtStart([300], true)).toEqual([300, 0]);
    expect(withAtStart([300, 0], false)).toEqual([300]);
    // The last reminder is never removed.
    expect(withAtStart([0], false)).toEqual([0]);
  });

  it('follows the detected faction unless the user picks one', () => {
    const d = dashboard({ effective_faction: 'asmodian' });
    expect(viewFaction(d)).toBe('asmodian');
    expect(viewFaction({ ...d, effective_faction: null })).toBe('all');
    expect(viewFaction({ ...d, config: { ...d.config, faction: 'elyos' } })).toBe('elyos');
    const [, , elyos, asmo] = catalogue();
    expect(factionMatches(elyos!, 'asmodian')).toBe(false);
    expect(factionMatches(asmo!, 'asmodian')).toBe(true);
    expect(factionMatches(entry(), 'elyos')).toBe(true);
    expect(catalogueMatches(catalogue()[1]!, 'argo')).toBe(true);
    expect(catalogueMatches(elyos!, 'verteron')).toBe(true);
  });

  it('finds the newest sighting of any boss an entry covers', () => {
    const siege = catalogue()[1]!;
    const seen = (npc_id: number, observed_ms: number, state = 'Spawned') => ({
      id: `npc-${npc_id}`,
      name: '',
      category: 'world_boss' as const,
      npc_id,
      event_id: null,
      due_ms: null,
      observed_ms,
      server: 'eu/1',
      state,
      basis: '',
      estimated: false,
    });
    const list = [
      seen(2_200_001, NOW - 9000),
      seen(2_200_003, NOW - 1000, 'Defeated'),
      seen(9, NOW),
    ];
    expect(latestObservation(list, siege, siege.rule)?.npc_id).toBe(2_200_003);
    expect(latestObservation([seen(9, NOW)], siege, siege.rule)).toBeNull();
    expect(ago(t, 30_000)).toBe('just now');
    expect(ago(t, 125 * 60_000)).toBe('2 h 05 min');
  });
});

describe('rule edits', () => {
  it('turns a template into a rule draft without guessing unknown times', () => {
    const draft = ruleFromTemplate(t, {
      id: 'festival',
      name: 'Shugo Festival',
      category: 'event',
      schedule: null,
      duration_seconds: 0,
      regions: ['eu'],
      source: 'In-game notice',
      notes: 'Opens on the hour.',
      verified: false,
      npc_id: null,
    });
    expect(draft.schedule).toBeNull();
    expect(draft.enabled).toBe(false);
    expect(draft.notes).toContain('Source: In-game notice');
    expect(draft.notes).toContain('Unverified');
    expect(draft.lead_seconds).toContain(0);
  });

  it('duplicates with a new id and binds observed timers to native ids only', () => {
    const copy = duplicateRule(t, rule({ favorite: true }));
    expect(copy.id).not.toBe('r1');
    // A copy of a built-in alert is a plain custom alert native will accept.
    const builtIn = duplicateRule(
      t,
      rule({ preset_id: 'world-siege', npc_ids: [1, 2], event_ids: [3], schedule_override: true }),
    );
    expect(builtIn).toMatchObject({
      preset_id: null,
      npc_ids: [],
      event_ids: [],
      schedule_override: false,
    });
    expect(copy.name).toBe('Shugo Festival (copy)');
    expect(copy.favorite).toBe(false);
    const watch = ruleFromObserved(t, {
      name: '',
      category: 'field_boss',
      npc_id: 42,
      event_id: null,
    });
    expect(watch.schedule).toEqual({ type: 'observed' });
    expect(watch.npc_id).toBe(42);
    expect(watch.name).toBe('NPC #42');
  });

  it('applies deltas without touching other rules', () => {
    const config = dashboard().config;
    const patched = patchRule(config, 'r2', { enabled: true });
    expect(patched.rules[0]).toBe(config.rules[0]);
    expect(patched.rules[1]?.enabled).toBe(true);
    const added = upsertRule(config, rule({ id: 'r3' }));
    expect(added.rules.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('lists every timed countdown in Next up, notifying or not, with honest skip rights', () => {
    const d = dashboard({
      catalogue: catalogue(),
      upcoming: [
        {
          rule_id: 'r1',
          name: 'Shugo Festival',
          category: 'event',
          due_ms: NOW + 600_000,
          remaining_ms: 600_000,
          state: 'scheduled',
          basis: 'Configured server schedule',
          estimated: false,
          source: null,
          server: null,
        },
        {
          rule_id: 'preset-event-rift',
          name: 'Spacetime Rift',
          category: 'event',
          due_ms: null,
          remaining_ms: null,
          state: 'unknown',
          basis: '',
          estimated: false,
          source: null,
          server: null,
        },
      ],
      catalogue_upcoming: normalizeDashboard({
        now_ms: NOW,
        config: { revision: 1 },
        catalogue_upcoming: [
          {
            entry_id: 'event-rift',
            rule_id: 'preset-event-rift',
            name: 'Spacetime Rift',
            category: 'event',
            due_ms: NOW + 60_000,
            state: 'scheduled',
            clock: 'fallback',
            timezone: 'UTC',
            estimated: true,
            notify: 'waiting_for_clock',
          },
          {
            entry_id: 'world-siege',
            name: 'Siege Bosses',
            category: 'world_boss',
            due_ms: NOW + 7_200_000,
            state: 'scheduled',
            clock: 'server',
            notify: 'off',
          },
          {
            entry_id: 'field-2100100',
            name: 'Test Guardian',
            category: 'field_boss',
            due_ms: null,
            state: 'unknown',
            clock: 'observed',
            notify: 'off',
          },
          { name: 'no entry id' },
        ],
      }).catalogue_upcoming,
    });
    const rows = nextUp(d, 12);
    expect(rows.map((r) => [r.name, r.notify, r.skippable])).toEqual([
      ['Spacetime Rift', 'waiting_for_clock', false],
      ['Shugo Festival', 'on', true],
      ['Siege Bosses', 'off', false],
    ]);
    expect(rows[0]).toMatchObject({ fallback: true, estimated: true, zone: 'UTC' });
    // The custom alert keeps its own clock; the built-in follows the region's.
    expect(rows[1]?.zone).toBe('Europe/Berlin');
    expect(rows[2]).toMatchObject({ ruleId: 'preset-world-siege', zone: 'Europe/Berlin' });
    expect(nextUp({ ...d, config: { ...d.config, enabled: false } }, 12)[1]).toMatchObject({
      notify: 'off',
      skippable: false,
    });
    // Older engines without catalogue countdowns still list reminders.
    expect(nextUp({ ...d, catalogue_upcoming: [] }, 12).map((r) => r.name)).toEqual([
      'Shugo Festival',
      'Spacetime Rift',
    ]);
  });

  it('picks the next alert for the DPS meter only when close and enabled', () => {
    const d = dashboard();
    expect(soonest(d, NOW, 5 * 60_000)).toEqual({
      name: 'Shugo Festival',
      remainingMs: 90_000,
      open: false,
    });
    expect(soonest(d, NOW, 60_000)).toBeNull();
    expect(soonest({ ...d, config: { ...d.config, enabled: false } }, NOW, 5 * 60_000)).toBeNull();
  });
});

describe('alert payload normalization', () => {
  it('keeps unknown native fields so a save never drops them', () => {
    const config = normalizeConfig({
      revision: 2,
      future_flag: true,
      rules: [{ id: 'a', name: 'A', schedule: { type: 'weird' }, extra: 1 }],
    }) as unknown as Record<string, unknown> & { rules: Record<string, unknown>[] };
    expect(config.future_flag).toBe(true);
    expect(config.rules[0]?.extra).toBe(1);
    expect(config.rules[0]?.schedule).toBeNull();
    expect(config.region).toBe('global');
  });

  it('drops malformed rows and fills catalogue bosses', () => {
    const d = normalizeDashboard({
      now_ms: NOW,
      config: { revision: 1 },
      upcoming: [{ name: 'no id' }],
      active: [{ id: 'x', due_ms: 1, fired_ms: 2, status: 'delivered' }, { id: 'bad' }],
      bosses: [{ id: 5 }, { name: 'nameless' }],
    });
    expect(d.upcoming).toEqual([]);
    expect(d.active.map((a) => a.id)).toEqual(['x']);
    expect(d.bosses).toEqual([{ id: 5, name: 'NPC #5' }]);
    expect(() => normalizeDashboard({})).toThrow(/alert settings/);
  });

  it('keeps whether capture is observing, and leaves it unknown when native is silent', () => {
    const base = { now_ms: NOW, config: { revision: 1 } };
    expect(normalizeDashboard({ ...base, live_observations: true }).live_observations).toBe(true);
    expect(normalizeDashboard({ ...base, live_observations: false }).live_observations).toBe(false);
    expect('live_observations' in normalizeDashboard(base)).toBe(false);
    expect('live_observations' in normalizeDashboard({ ...base, live_observations: 1 })).toBe(
      false,
    );
  });

  it('reads a spawn as up only within two minutes of a live sighting', () => {
    const seen = (state: string, observed_ms: number): ObservedTimer => ({
      id: 'npc-1',
      name: 'Dartan',
      category: 'field_boss',
      npc_id: 1,
      event_id: null,
      due_ms: null,
      observed_ms,
      server: 'eu/1001',
      state,
      basis: 'In-game Field Boss list',
      estimated: false,
    });
    expect(spawnFresh(seen('Spawned', NOW), NOW)).toBe(true);
    expect(spawnFresh(seen('Spawned', NOW - SPAWN_FRESH_MS + 1), NOW, true)).toBe(true);
    expect(spawnFresh(seen('Spawned', NOW - SPAWN_FRESH_MS), NOW)).toBe(false);
    // An old saved record, days before now, never reads as alive.
    expect(spawnFresh(seen('Spawned', NOW - 110_000_000), NOW)).toBe(false);
    expect(spawnFresh(seen('Spawned', NOW + 5_000), NOW)).toBe(false);
    expect(spawnFresh(seen('Spawned', NOW), NOW, false)).toBe(false);
    expect(spawnFresh(seen('Respawning', NOW), NOW)).toBe(false);
  });

  it('reads catalogue entries and tolerates payloads without them', () => {
    const old = normalizeDashboard({ now_ms: NOW, config: { revision: 1, rules: [{ id: 'a' }] } });
    expect(old.catalogue).toEqual([]);
    expect(old.clock_ready).toBe(false);
    expect(old.clock_estimated).toBe(true);
    expect(old.clock_source).toBe('fallback');
    expect(old.catalogue_upcoming).toEqual([]);
    expect(old.effective_faction).toBeNull();
    expect(old.config).toMatchObject({ volume: 1, faction: 'auto' });
    expect(old.config.rules[0]).toMatchObject({
      preset_id: null,
      npc_ids: [],
      event_ids: [],
      schedule_override: false,
    });

    const d = normalizeDashboard({
      now_ms: NOW,
      config: { revision: 1, region: 'global', volume: 0.5, faction: 'elyos' },
      catalogue: [
        {
          id: 'field-1',
          name: 'Test Guardian',
          category: 'field_boss',
          map: 'Verteron',
          faction: 'elyos',
          members: [{ id: 1, name: 'Test Guardian' }, { name: 'bad' }],
          rule: { id: 'preset-field-1', enabled: true, sound: 'ping', npc_ids: [1, 'x'] },
          recharge_minute: 540,
        },
        { name: 'no id' },
      ],
      effective_region: 'kr',
      effective_timezone: 'Asia/Seoul',
      effective_faction: 'asmodian',
      clock_ready: true,
    });
    expect(d.config).toMatchObject({ volume: 0.5, faction: 'elyos' });
    expect(d.catalogue).toHaveLength(1);
    expect(d.catalogue[0]).toMatchObject({
      map: 'Verteron',
      members: [{ id: 1, name: 'Test Guardian' }],
      recharge_minute: 540,
      // A default rule is always off and always tied to its entry.
      rule: { enabled: false, preset_id: 'field-1', sound: 'ping', npc_ids: [1] },
    });
    expect(d).toMatchObject({
      effective_region: 'kr',
      effective_timezone: 'Asia/Seoul',
      effective_faction: 'asmodian',
      clock_ready: true,
    });
  });
});

describe('alert wording in Brazilian Portuguese', () => {
  const pt = createTestI18n('pt-BR').getFixedT('pt-BR', 'alerts');
  const ptFmt = formattersFor('pt-BR');

  it('words reminders, countdowns and schedules', () => {
    expect(leadLabel(pt, 0)).toBe('No início');
    expect(leadLabel(pt, 5400)).toBe('1 h 30 min antes');
    expect(leadOption(pt, 60)).toBe('1 minuto antes');
    expect(leadOption(pt, 120)).toBe('2 minutos antes');
    expect(remaining(pt, 3_900_000)).toBe('1h 05min');
    expect(remaining(pt, 65_000)).toBe('1:05');
    expect(remaining(pt, -1)).toBe('agora');
    expect(ago(pt, 30_000)).toBe('agora mesmo');
    expect(scheduleSummary(pt, ptFmt, entry().rule)).toBe(
      'A cada 3 h · 02:00, 05:00, … · aberto por 10 min',
    );
    // Weekday names come from Intl in the interface language, never an English list.
    expect(
      describeSchedule(pt, ptFmt, { type: 'calendar', times: ['20:00'], weekdays: [4, 0] }, 'UTC'),
    ).toBe('seg., sex. · 20:00 (UTC)');
    expect(weekdayLabel(ptFmt, 6)).toBe('dom.');
  });

  it('validates in Portuguese', () => {
    const errors = validateRule(pt, rule({ name: ' ', lead_seconds: [] }));
    expect(errors.name).toBe('Dê um nome ao alerta.');
    expect(errors.lead_seconds).toBe('Adicione pelo menos um lembrete.');
    expect(validateQuietHours(pt, '22:00', '22:00')).toBe(
      'O início e o fim precisam ser diferentes.',
    );
  });

  it('keeps user-authored and game names verbatim in drafts', () => {
    expect(duplicateRule(pt, rule()).name).toBe('Shugo Festival (cópia)');
    expect(factionLabel(pt, 'asmodian')).toBe('Asmodian');
    expect(factionLabel(pt, 'all')).toBe('Ambas as facções');
    expect(
      ruleFromObserved(pt, { name: '', category: 'event', npc_id: null, event_id: 3 }).name,
    ).toBe('Evento observado');
  });

  it('chooses plural forms, with numbers in the Portuguese style', () => {
    expect(muteLabel(pt, 3600)).toBe('1 hora');
    expect(muteLabel(pt, 7200)).toBe('2 horas');
    expect(pt(($) => $.custom.on, { count: 0 })).toBe('0 ativos');
    expect(pt(($) => $.custom.on, { count: 1 })).toBe('1 ativo');
    expect(pt(($) => $.custom.on, { count: 2 })).toBe('2 ativos');
    expect(pt(($) => $.catalogue.bosses, { count: 1234 })).toBe('1.234 chefes');
    expect(pt(($) => $.catalogue.bosses, { count: 1_000_000 })).toBe('1.000.000 chefes');
    expect(t(($) => $.catalogue.bosses, { count: 1234 })).toBe('1,234 bosses');
    expect(ptFmt.numberWith({ style: 'percent', maximumFractionDigits: 0 }).format(0.8)).toBe(
      '80%',
    );
  });
});
