import { describe, expect, it } from 'vitest';
import demo from './deus-demo.json';

describe('bundled Deus fight', () => {
  it('contains only anonymous player identities except the consenting owner', () => {
    expect(demo.players.filter((player) => player.self).map((player) => player.name)).toEqual([
      'foxyyyynm',
    ]);
    demo.players.forEach((player, index) => {
      expect(player.id).toBe(`player-${index + 1}`);
      expect(player.name).toBe(player.self ? 'foxyyyynm' : `Player ${index + 1}`);
      expect(Object.keys(player).sort()).toEqual(
        ['id', 'name', 'class', 'self', 'damage', 'dps', 'hits', 'criticalHits', 'skills'].sort(),
      );
      player.skills.forEach((skill) => {
        expect(Object.keys(skill).sort()).toEqual(
          ['id', 'name', 'damage', 'hits', 'criticalHits'].sort(),
        );
      });
    });
    expect(Object.keys(demo).sort()).toEqual(
      [
        'schemaVersion',
        'boss',
        'instance',
        'durationMs',
        'outcome',
        'sampleIntervalMs',
        'players',
        'frames',
      ].sort(),
    );
  });

  it('replays consistent cumulative damage and inspectable skills through the fight end', () => {
    expect(demo.boss).toBe('Atiel');
    expect(demo.instance).toBe('Deus Research Base');
    expect(demo.frames[0]?.atMs).toBe(0);
    expect(demo.frames.at(-1)?.atMs).toBe(demo.durationMs);
    expect(demo.frames.at(-1)?.damage).toEqual(demo.players.map((player) => player.damage));
    demo.frames.forEach((frame, index) => {
      expect(frame.damage).toHaveLength(demo.players.length);
      if (index === 0) return;
      const previous = demo.frames[index - 1];
      if (!previous) throw new Error('Missing previous replay frame');
      expect(frame.atMs).toBeGreaterThan(previous.atMs);
      frame.damage.forEach((damage, player) => {
        expect(damage).toBeGreaterThanOrEqual(previous.damage[player] ?? 0);
      });
    });
    demo.players.forEach((player) => {
      expect(player.skills.reduce((sum, skill) => sum + skill.damage, 0)).toBe(player.damage);
      expect(player.dps).toBe(Math.round(player.damage / (demo.durationMs / 1000)));
      expect(player.criticalHits).toBeLessThanOrEqual(player.hits);
    });
  });
});
