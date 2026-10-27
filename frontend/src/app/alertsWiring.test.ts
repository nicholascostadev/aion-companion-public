import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Native owns alert delivery: it ticks while every window is hidden and plays each sound
 * once. A webview player in any window would sound alerts twice, so none may remain.
 */
const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('alert delivery wiring', () => {
  it('has no webview alert player left in any window', () => {
    expect(existsSync(join(src, 'hooks', 'useAlertSounds.ts'))).toBe(false);
    for (const file of sources(src)) {
      const text = readFileSync(file, 'utf8');
      expect({ file: relative(src, file), legacy: /useAlertSounds|claimAlert/.test(text) }).toEqual(
        {
          file: relative(src, file),
          legacy: false,
        },
      );
    }
  });

  it('plays web audio only from the explicit browser preview', () => {
    const users = sources(src)
      .filter((file) => /playSound\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(src, file).replaceAll('\\', '/'))
      .sort();
    expect(users).toEqual(['hooks/useAlerts.ts', 'lib/sound.ts']);
  });

  it('keeps the window entry points free of sound playback', () => {
    for (const name of ['App.tsx', 'OverlayApp.tsx', 'MenuApp.tsx', 'AlertPopupApp.tsx']) {
      expect(readFileSync(join(src, 'app', name), 'utf8')).not.toMatch(/lib\/sound/);
    }
  });
});
