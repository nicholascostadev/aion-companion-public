import type { Formatters } from '../../i18n/formatters';
import type { BackupFile, BackupLimits, BackupPart, BackupPlan } from '../../types/backups';

/** Which part a saved file belongs to, by its path in the data folder; null if unknown. */
export function backupPartOf(path: string): BackupPart | null {
  const at = path
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .toLowerCase();
  if (at === 'offline/settings.json') return 'settings';
  if (at === 'offline/pets.json') return 'pets';
  if (at.startsWith('offline/logs/')) return 'logs';
  return null;
}

export type BackupGroup = BackupPart | 'other';

/** Files and bytes per part, in the order parts are offered; unknown paths last. */
export function groupFiles<T extends BackupFile>(list: readonly T[]) {
  const order: BackupGroup[] = ['settings', 'pets', 'logs', 'other'];
  const groups = new Map<BackupGroup, { files: T[]; bytes: number }>();
  for (const file of list) {
    const part = backupPartOf(file.path) ?? 'other';
    const group = groups.get(part) ?? { files: [], bytes: 0 };
    group.files.push(file);
    group.bytes += file.bytes;
    groups.set(part, group);
  }
  return order.flatMap((part) => {
    const group = groups.get(part);
    return group ? [{ part, ...group }] : [];
  });
}

export type LimitBreak =
  | { limit: 'files'; files: number }
  | { limit: 'total_bytes' }
  | { limit: 'file_bytes'; path: string };

/** The first of native's limits a plan breaks, if any. */
export function planOverLimit(plan: BackupPlan, limits: BackupLimits): LimitBreak | null {
  if (plan.files.length > limits.files) return { limit: 'files', files: plan.files.length };
  if (plan.total_bytes > limits.total_bytes) return { limit: 'total_bytes' };
  const large = plan.files.find((file) => file.bytes > limits.file_bytes);
  return large ? { limit: 'file_bytes', path: large.path } : null;
}

const UNITS = ['kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * A file size in the interface language, in steps of 1024 as Windows shows them, never
 * smaller than kilobytes: 0.5 kB, 14 kB, 3.2 MB.
 */
export function formatBytes(fmt: Formatters, bytes: number): string {
  let value = Math.max(0, bytes) / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return fmt
    .numberWith({
      style: 'unit',
      unit: UNITS[unit],
      unitDisplay: 'short',
      maximumFractionDigits: value >= 100 ? 0 : 1,
    })
    .format(value);
}

/** The file name at the end of a path, for a compact line; the full path stays in a title. */
export const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
