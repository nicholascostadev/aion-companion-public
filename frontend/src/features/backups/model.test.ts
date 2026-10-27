import { describe, expect, it } from 'vitest';
import { formattersFor } from '../../i18n/formatters';
import { backupPartOf, fileName, formatBytes, groupFiles, planOverLimit } from './model';

const MIB = 1024 * 1024;
const limits = { archive_bytes: 128 * MIB, total_bytes: 64 * MIB, file_bytes: 32 * MIB, files: 3 };

describe('backup model', () => {
  it('names the part each saved file belongs to', () => {
    expect(backupPartOf('offline/settings.json')).toBe('settings');
    expect(backupPartOf('offline\\pets.json')).toBe('pets');
    expect(backupPartOf('offline/logs/1760.json')).toBe('logs');
    expect(backupPartOf('offline/index.json')).toBeNull();
  });

  it('groups files in the order parts are offered, unknown files last', () => {
    const groups = groupFiles([
      { path: 'offline/logs/2.json', bytes: 5 },
      { path: 'mystery.bin', bytes: 1 },
      { path: 'offline/settings.json', bytes: 2 },
      { path: 'offline/logs/1.json', bytes: 7 },
    ]);
    expect(groups.map((group) => [group.part, group.files.length, group.bytes])).toEqual([
      ['settings', 1, 2],
      ['logs', 2, 12],
      ['other', 1, 1],
    ]);
  });

  it('finds the first limit a plan breaks', () => {
    const file = (bytes: number, path = 'a') => ({ path, bytes });
    expect(planOverLimit({ files: [file(1)], total_bytes: 1 }, limits)).toBeNull();
    expect(
      planOverLimit({ files: [file(1), file(1), file(1), file(1)], total_bytes: 4 }, limits),
    ).toEqual({ limit: 'files', files: 4 });
    expect(planOverLimit({ files: [file(65 * MIB)], total_bytes: 65 * MIB }, limits)).toEqual({
      limit: 'total_bytes',
    });
    expect(
      planOverLimit(
        { files: [file(33 * MIB, 'offline/logs/big.json')], total_bytes: 33 * MIB },
        limits,
      ),
    ).toEqual({ limit: 'file_bytes', path: 'offline/logs/big.json' });
  });

  it('writes sizes in steps of 1024 in the interface language', () => {
    const en = formattersFor('en');
    const pt = formattersFor('pt-BR');
    expect(formatBytes(en, 512)).toBe('0.5 kB');
    expect(formatBytes(en, 0)).toBe('0 kB');
    expect(formatBytes(en, 14 * 1024)).toBe('14 kB');
    expect(formatBytes(en, 3.25 * MIB)).toBe('3.3 MB');
    expect(formatBytes(pt, 3.25 * MIB)).toBe('3,3 MB');
    expect(formatBytes(en, 640 * 1024)).toBe('640 kB');
  });

  it('takes the file name from either separator', () => {
    expect(fileName('C:\\Users\\me\\a.aion-backup.json')).toBe('a.aion-backup.json');
    expect(fileName('offline/logs/1.json')).toBe('1.json');
  });
});
