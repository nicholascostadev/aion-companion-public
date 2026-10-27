import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { DataTable } from '../../components/ui/Table';
import { useFormat, useTranslation } from '../../i18n/provider';
import type { Snapshot } from '../../types/companion';

export function DamageSummary({ players }: { players: Snapshot['players'] }) {
  const { t } = useTranslation('recordings');
  const fmt = useFormat();
  const sorted = Object.entries(players).sort(
    (first, second) => second[1].damage - first[1].damage,
  );
  const skills = sorted.flatMap(([name, player]) =>
    Object.entries(player.skills).map(([skill, damage]) => ({ name, skill, damage })),
  );
  return (
    <Card title={t(($) => $.damage.title)} level={3} className="mb-0">
      <DataTable
        headings={[t(($) => $.damage.actor), t(($) => $.damage.damage), 'DPS']}
        rows={sorted.map(([name, player]) => ({
          key: name,
          cells: [name, fmt.number.format(player.damage), fmt.number.format(player.dps)],
        }))}
      />
      {!sorted.length && (
        <EmptyState
          compact
          title={t(($) => $.damage.emptyTitle)}
          icon={<Icon name="hourglass" size={18} />}
        >
          {t(($) => $.damage.emptyBody)}
        </EmptyState>
      )}
      {skills.length > 0 && (
        <ul className="m-0 mt-4 flex max-h-58 list-none flex-col overflow-auto border-t border-line-soft p-0 pt-2 text-xs">
          {skills.map(({ name, skill, damage }) => (
            <li
              key={JSON.stringify([name, skill])}
              className="flex justify-between gap-3 border-b border-dashed border-line-soft py-1 text-ink-2 last:border-b-0"
            >
              <span className="min-w-0 truncate">
                {name} · {skill}
              </span>
              <span className="text-ink tabular-nums">{fmt.number.format(damage)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
