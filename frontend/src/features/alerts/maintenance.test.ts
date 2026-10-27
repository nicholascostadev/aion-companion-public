import { describe, expect, it } from 'vitest';
import { normalizeDashboard, normalizeServerStatus } from '../../lib/alertsNormalize';
import { NOW, dashboard, serverRow, serverStatus } from './fixtures';
import { maintenancePhase, maintenanceView, noticeCheck, NOTICE_FRESH_MS } from './maintenance';

const HOUR = 3_600_000;
const notice = (patch = {}) => ({
  title: 'Scheduled maintenance',
  url: 'https://example.invalid/notice',
  starts_ms: NOW - HOUR,
  ends_ms: NOW + 2 * HOUR,
  completed: false,
  ...patch,
});

describe('maintenance notices', () => {
  it('trusts only a recent, successful check', () => {
    expect(noticeCheck(serverStatus({ checked_ms: null, stale: true }), NOW)).toBe('waiting');
    expect(
      noticeCheck(serverStatus({ checked_ms: null, stale: true, error: 'timeout' }), NOW),
    ).toBe('unreachable');
    expect(noticeCheck(serverStatus(), NOW)).toBe('fresh');
    // Older than three minutes, a newer failure or native's own stale flag: uncertain.
    expect(noticeCheck(serverStatus({ checked_ms: NOW - NOTICE_FRESH_MS - 1 }), NOW)).toBe('stale');
    expect(noticeCheck(serverStatus({ error: 'timeout' }), NOW)).toBe('stale');
    expect(noticeCheck(serverStatus({ stale: true }), NOW)).toBe('stale');
  });

  it('never reads an elapsed estimated end as over', () => {
    expect(maintenancePhase(null, NOW)).toBe('none');
    expect(maintenancePhase(notice({ starts_ms: NOW + HOUR }), NOW)).toBe('next');
    expect(maintenancePhase(notice(), NOW)).toBe('now');
    // Past the announced end without the notice saying so: unconfirmed, not "no maintenance".
    expect(maintenancePhase(notice({ ends_ms: NOW - 1 }), NOW)).toBe('overdue');
    expect(maintenancePhase(notice({ ends_ms: NOW - 1, completed: true }), NOW)).toBe('completed');
    // Only the official completion ends it, even before the estimate.
    expect(maintenancePhase(notice({ completed: true }), NOW)).toBe('completed');
  });

  it('keeps an overdue window, its link and its estimate on screen', () => {
    const overdue = notice({ ends_ms: NOW - 10 * 60_000 });
    const view = maintenanceView(
      dashboard({ server_status: serverStatus({ maintenance: overdue }) }),
      NOW,
    );
    expect(view.phase).toBe('overdue');
    expect(view.window).toEqual(overdue);
  });

  it('says which servers the window is announced for, and whether yours is one', () => {
    const base = dashboard();
    const busy = dashboard({
      config: { ...base.config, server: '1001' },
      server_status: serverStatus({
        maintenance: notice(),
        servers: [
          serverRow({ status: 'maintenance' }),
          serverRow({ id: '2001', name: 'Server B', region: 'na-east', status: 'unknown' }),
        ],
      }),
    });
    expect(maintenanceView(busy, NOW)).toMatchObject({
      phase: 'now',
      affected: 1,
      total: 2,
      server: { id: '1001', name: 'Server A' },
      yoursListed: true,
      uncovered: null,
    });
    // Outside the window nothing is counted, whatever the rows say.
    expect(maintenanceView(busy, NOW + 3 * HOUR).affected).toBe(0);
  });

  it('names a region the Global notices do not cover', () => {
    const base = dashboard();
    const korea = dashboard({
      config: { ...base.config, region: 'kr' },
      regions: [...base.regions, { id: 'kr', name: 'Korea', timezone: 'Asia/Seoul' }],
      effective_region: 'kr',
    });
    expect(maintenanceView(korea, NOW).uncovered).toBe('Korea');
    expect(maintenanceView(dashboard(), NOW).uncovered).toBeNull();
  });
});

describe('server status payloads', () => {
  it('reads an old engine as never checked, alerts held for nothing', () => {
    const value = normalizeDashboard({ now_ms: NOW, config: { revision: 1 } });
    expect(value.config.alert_when_game_closed).toBe(false);
    expect(value.config.notify_server_back).toBe(false);
    expect(value.game_running).toBeNull();
    expect(value.delivery_paused).toBeNull();
    expect(value.server_status).toEqual({
      checked_ms: null,
      last_attempt_ms: null,
      stale: true,
      error: null,
      source: '',
      maintenance: null,
      servers: [],
    });
  });

  it('keeps unknown states unknown and accepts only https notices', () => {
    const status = normalizeServerStatus({
      checked_ms: NOW,
      stale: false,
      servers: [
        { id: '1', name: 'A', region: 'latam', status: 'maintenance', population: -3 },
        { id: '2', region: 'latam', status: 'busy', character_creation_open: 'yes' },
        { name: 'no id' },
      ],
      maintenance: notice({ url: 'javascript:alert(1)' }),
    });
    expect(status.servers).toEqual([
      serverRow({ id: '1', name: 'A', region: 'latam', status: 'maintenance' }),
      serverRow({ id: '2', name: '2', region: 'latam', status: 'unknown' }),
    ]);
    expect(status.maintenance).toBeNull();
    expect(
      normalizeServerStatus({ maintenance: notice({ ends_ms: NOW - 2 * HOUR }) }).maintenance,
    ).toBeNull();
    // Completion is only ever an explicit official true.
    expect(
      normalizeServerStatus({ maintenance: notice({ completed: 'yes' }) }).maintenance,
    ).toMatchObject({ completed: false });
    expect(
      normalizeServerStatus({ maintenance: notice({ completed: true }) }).maintenance,
    ).toMatchObject({ completed: true });
  });

  it('reads held deliveries and the maintenance-complete phase', () => {
    const value = normalizeDashboard({
      now_ms: NOW,
      config: { revision: 1, alert_when_game_closed: true, notify_server_back: true },
      game_running: false,
      delivery_paused: 'server_down',
      history: [
        { id: 'a', due_ms: NOW, fired_ms: NOW, status: 'server_down' },
        { id: 'b', due_ms: NOW, fired_ms: NOW, status: 'game_closed' },
        { id: 'c', due_ms: NOW, fired_ms: NOW, phase: 'recovery' },
      ],
    });
    expect(value.config.alert_when_game_closed).toBe(true);
    expect(value.config.notify_server_back).toBe(true);
    expect(value.game_running).toBe(false);
    expect(value.delivery_paused).toBe('server_down');
    expect(value.history.map((d) => [d.status, d.phase])).toEqual([
      ['server_down', 'start'],
      ['game_closed', 'start'],
      ['delivered', 'recovery'],
    ]);
    expect(
      normalizeDashboard({ config: { revision: 1 }, delivery_paused: 'later' }).delivery_paused,
    ).toBeNull();
  });
});
