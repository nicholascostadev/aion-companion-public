import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { normalizeReport } from '../../lib/offlineNormalize';
import type { CombatReport } from '../../types/offline';

/* Native-shape meter reports for tests: one fight, outgoing damage per skill. */

export const strike = {
  id: 11010000,
  name: 'Spinning Strike',
  damage: 55_100,
  healing: 0,
  hits: 1,
  crits: 1,
  critical_hits_observed: 1,
  damage_hits: 1,
  damage_crits: 1,
  damage_critical_hits_observed: 1,
};
export const crush = {
  id: 11020000,
  name: 'Impactful Crush',
  damage: 9_700,
  healing: 0,
  hits: 1,
  crits: null,
  critical_hits_observed: 1,
  damage_hits: 1,
  damage_crits: 0,
  damage_critical_hits_observed: 1,
};
/** A periodic skill: hits observed, no decoded crit flag. */
export const bleed = {
  id: 11030000,
  name: 'Rending Bleed',
  damage: 9_800,
  healing: 0,
  hits: 3,
  crits: null,
  critical_hits_observed: 0,
  damage_hits: 3,
  damage_crits: null,
  damage_critical_hits_observed: 0,
};
/** Incoming damage only: never ranked as a skill of the player. */
const claw = { id: 99, name: 'Claw', damage: 0, received: 300 };

export const aria = {
  id: 1,
  name: 'Aria',
  class: 'Gladiator',
  local: true,
  damage: 74_600,
  healing: 0,
  received: 300,
  edps: 7_460,
  adps: 9_325,
  current_dps: 1_200,
  damage_hits: 5,
  damage_crits: 1,
  damage_critical_hits_observed: 2,
  skills: [crush, strike, bleed, claw],
};
export const bryn = {
  id: 2,
  name: 'Bryn',
  class: 'Cleric',
  local: false,
  damage: 25_400,
  healing: 4_000,
  edps: 2_540,
  current_dps: 300,
  damage_hits: 4,
  damage_crits: 2,
  damage_critical_hits_observed: 4,
  skills: [
    {
      id: 17010000,
      name: 'Smite',
      damage: 25_400,
      healing: 0,
      damage_hits: 4,
      damage_crits: 2,
      damage_critical_hits_observed: 4,
    },
  ],
};
/** Took damage, dealt none: never ranked. */
export const cara = {
  id: 3,
  name: 'Cara',
  class: 'Templar',
  local: false,
  damage: 0,
  received: 900,
};

export function meterReport(patch: Record<string, unknown> = {}): CombatReport {
  const value = normalizeReport({
    id: 'fight-a',
    label: null,
    started_ms: new Date(2026, 9, 17, 14, 18).getTime(),
    duration_ms: 10_000,
    end_reason: null,
    players: [aria],
    targets: [{ id: 50, name: 'Training Golem', boss: false, dummy: false, damage: 74_600 }],
    events: [],
    ...patch,
  });
  if (!value) throw new Error('fixture did not normalize');
  return value;
}

/** One skill per entry, each a little weaker than the one before. */
export function manySkills(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 11000000 + i,
    name: `Skill ${i + 1}`,
    damage: 1000 - i * 10,
    damage_hits: 1,
    damage_crits: 0,
    damage_critical_hits_observed: 1,
  }));
}

/**
 * Lays the meter's row list out `height` pixels tall, as a window would (jsdom has no
 * layout): rows are 21px high with a 2px gap, the first 2px below the list's top. `resize`
 * changes the height and notifies the list's resize observers, as enlarging the window does;
 * `zoom` scales the rows, as the meter's scale setting does, keeping the list's height.
 */
export function layOutMeterList(height: number) {
  let current = height;
  let scale = 1;
  const observers = new Set<() => void>();
  const rect = (top: number, size: number) => new DOMRect(0, top, 300, size);
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    if (this.matches('ol[data-hit-clip]')) return rect(0, current);
    if (this.matches('[data-meter-row]'))
      return rect((2 + [...this.parentElement!.children].indexOf(this) * 23) * scale, 21 * scale);
    return rect(0, 0);
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly notify: () => void;
      constructor(callback: () => void) {
        this.notify = callback;
      }
      observe() {
        observers.add(this.notify);
      }
      unobserve() {
        observers.delete(this.notify);
      }
      disconnect() {
        observers.delete(this.notify);
      }
    },
  );
  return {
    resize(next: number) {
      current = next;
      act(() => {
        for (const notify of observers) notify();
      });
    },
    zoom(next: number) {
      scale = next;
    },
    restore() {
      spy.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}
