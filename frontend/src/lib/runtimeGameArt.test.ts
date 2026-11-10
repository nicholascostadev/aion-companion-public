import { describe, expect, it } from 'vitest';
import manifest from '../data/game-art.json';
import { runtimeManifest, type ArtManifest } from '../../../scripts/runtime-game-art';

describe('production artwork lookup manifest', () => {
  it('preserves every skill lookup and class/Daevanion lookup without shipping provenance', () => {
    const runtime = runtimeManifest(manifest);
    const source: ArtManifest = manifest;
    expect(Object.keys(runtime.classes)).toEqual(Object.keys(manifest.classes));
    expect(Object.keys(runtime.skills)).toEqual(Object.keys(manifest.skills));
    for (const [name, entry] of Object.entries(manifest.classes)) {
      expect(runtime.classes[name]).toEqual({ file: entry.file, original_key: entry.original_key });
    }
    for (const [id, entry] of Object.entries(source.skills)) {
      const before = 'base' in entry ? source.skills[String(entry.base)] : entry;
      const after =
        runtime.skills[id]?.base === undefined
          ? runtime.skills[id]
          : runtime.skills[String(runtime.skills[id]?.base)];
      for (const key of ['file', 'name', 'class'] as const) {
        expect(after?.[key]).toEqual(before?.[key]);
      }
      expect(
        Object.keys(runtime.skills[id] ?? {}).every((key) =>
          ['file', 'name', 'class', 'base'].includes(key),
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(runtime).length).toBeLessThan(JSON.stringify(manifest).length - 200_000);
    expect(Object.values(manifest.classes)[0]?.source).toBeTruthy();
  });
});
