// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seriesColors } from '../lib/format';
import { CLASS_COLORS, UNKNOWN_CLASS_COLOR } from '../lib/classColors';

const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

const token = (name: string) =>
  new RegExp(`--color-${name}:\\s*([^;]+);`).exec(theme)?.[1]?.trim() ?? null;

const block = (selector: RegExp) =>
  new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(theme)?.[1] ?? '';

describe('design tokens', () => {
  it('keeps the data palette identical to the validated series colours, in order', () => {
    const names = ['sky', 'ember', 'jade', 'pollen', 'berry', 'fern', 'iris', 'rose'];
    expect(names.map((name) => token(name)?.toLowerCase())).toEqual([...seriesColors]);
  });

  it('defines every class colour as a mark token', () => {
    const names = [...Object.values(CLASS_COLORS), UNKNOWN_CLASS_COLOR].map(
      (color) => /^var\(--color-([\w-]+)\)$/.exec(color)?.[1] ?? color,
    );
    expect(names.filter((name) => token(name) === null)).toEqual([]);
  });

  it('defines every semantic role with soft and line variants', () => {
    for (const role of ['accent', 'success', 'warn', 'danger', 'info']) {
      for (const suffix of ['', '-strong', '-soft', '-line']) {
        expect(token(`${role}${suffix}`), `${role}${suffix}`).not.toBeNull();
      }
    }
  });

  it('has one colour scheme for every window', () => {
    const declarations = (name: string) =>
      [...theme.matchAll(new RegExp(`--color-${name}:`, 'g'))].length;
    for (const role of ['accent', 'accent-ink', 'focus', 'ink', 'ink-3', 'line', 'marker-pinned']) {
      expect({ role, count: declarations(role) }).toEqual({ role, count: 1 });
    }
    expect(theme).not.toMatch(/data-scheme|data-view/);
    expect(theme).not.toContain('--font-display');
  });

  it('turns only the surfaces to glass in the in-game windows', () => {
    const glass = block(/html\[data-surface='glass'\]/);
    const roles = [...glass.matchAll(/--color-([\w-]+):/g)].map((match) => match[1]);
    expect(glass).toContain('--color-canvas: transparent');
    expect(roles).toContain('surface');
    for (const role of roles) {
      expect(role).toMatch(/^(canvas|surface(-2|-3|-hover)?|sunken|veil)$/);
    }
  });

  it('turns deep glass back into the solid surfaces of the workspace', () => {
    const deep = block(/\[data-glass='deep'\]/);
    for (const role of ['surface', 'surface-2', 'surface-3', 'surface-hover', 'sunken', 'veil']) {
      expect({ role, value: token(role) }).toEqual({ role, value: `var(--solid-${role})` });
      expect(deep).toContain(`--color-${role}: var(--solid-${role});`);
    }
  });

  it('keeps the three map markers apart from the gold accent', () => {
    expect(token('marker-goal')).toBe('var(--color-accent)');
    expect(token('marker-pinned')).toBe('var(--color-sky-ink)');
    expect(token('marker-live')).toBe('var(--color-iris)');
  });
});
