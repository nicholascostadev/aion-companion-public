import { describe, expect, it } from 'vitest';
import bundled from './deus-demo.json';
import { demoReport, demoSources, frameAt, loadDemo, parseDemo, type DemoFight } from './demo';

const demo = parseDemo(bundled) as DemoFight;
const last = demo.frames.length - 1;
const STARTED = Date.UTC(2026, 10, 9, 20, 0);

describe('onboarding sample fight', () => {
  it('reads the bundled fight, loaded on demand', async () => {
    expect(demo).not.toBeNull();
    expect(await loadDemo()).toEqual(demo);
  });

  it('refuses a sample it cannot replay honestly', () => {
    const copy = () => structuredClone(bundled) as unknown as DemoFight;
    const backwards = copy();
    backwards.frames[2]!.damage[0] = backwards.frames[1]!.damage[0]! - 1;
    expect(parseDemo(backwards)).toBeNull();
    const short = copy();
    short.frames.pop();
    expect(parseDemo(short)).toBeNull();
    const misaligned = copy();
    misaligned.frames[1]!.damage.pop();
    expect(parseDemo(misaligned)).toBeNull();
    expect(parseDemo({ ...copy(), schemaVersion: 2 })).toBeNull();
    expect(parseDemo(null)).toBeNull();
  });

  it('ends exactly on the recorded totals, with the boss defeated', () => {
    const report = demoReport(demo, last, STARTED);
    expect(report.end_reason).toBe(demo.outcome === 'defeated' ? 'kill' : 'idle');
    expect(report.duration_ms).toBe(demo.durationMs);
    expect(report.targets[0]).toMatchObject({ name: demo.boss, boss: true });
    report.players.forEach((player, i) => {
      const recorded = demo.players[i]!;
      expect(player.damage).toBe(recorded.damage);
      expect(player.edps).toBe(recorded.dps);
      expect(player.damage_hits).toBe(recorded.hits);
      expect(player.damage_crits).toBe(recorded.criticalHits);
      expect(player.skills.map((s) => s.damage)).toEqual(recorded.skills.map((s) => s.damage));
    });
  });

  it('replays each recorded sample as it was, never ahead of it', () => {
    const middle = Math.floor(last / 2);
    const report = demoReport(demo, middle, STARTED);
    expect(report.end_reason).toBeNull();
    expect(report.duration_ms).toBe(demo.frames[middle]!.atMs);
    expect(report.players.map((p) => p.damage)).toEqual(demo.frames[middle]!.damage);
    for (const player of report.players) {
      // Skill splits follow the final shares and never exceed what was recorded so far.
      const skills = player.skills.reduce((sum, s) => sum + s.damage, 0);
      expect(Math.abs(skills - player.damage)).toBeLessThanOrEqual(player.skills.length);
      expect(player.damage_crits ?? 0).toBeLessThanOrEqual(player.damage_hits ?? 0);
    }
  });

  it('feeds the meter as live capture would, at the default settings', () => {
    const { status, overlay, offline } = demoSources(demo, 3, {
      startedMs: STARTED,
      compactStrip: false,
      locked: true,
    });
    expect(status).toMatchObject({ running: true, phase: 'capturing' });
    expect(overlay.locked).toBe(true);
    expect(offline.settings).toMatchObject({ hide_names: false, fade_after_seconds: 0 });
    expect(offline.report?.players.find((p) => p.local)?.name).toBe('foxyyyynm');
  });

  it('finds the sample at a point in the fight', () => {
    expect(frameAt(demo, 0)).toBe(0);
    expect(frameAt(demo, demo.frames[5]!.atMs + 1)).toBe(5);
    expect(frameAt(demo, demo.durationMs)).toBe(last);
  });
});
