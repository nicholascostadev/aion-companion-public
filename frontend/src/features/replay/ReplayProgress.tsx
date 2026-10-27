import { Meter } from '../../components/ui/Data';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { useFormat, useTranslation } from '../../i18n/provider';
import type { Snapshot } from '../../types/companion';

/** One progress line: the written fact, with a bar that grows toward its limit. */
function Progress({
  label,
  text,
  value,
  limit,
}: {
  label: string;
  /** The written fact, e.g. "Ari · kills: 3 / 5". */
  text: string;
  value: number;
  limit: number;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-4 gap-y-1 text-sm">
      <span className="min-w-0 text-ink-2">{text}</span>
      <Meter fraction={limit > 0 ? value / limit : null} label={label} />
    </li>
  );
}

export function ReplayProgress({
  counters,
  pets,
  gaps,
}: Pick<Snapshot, 'counters' | 'pets' | 'gaps'>) {
  const { t } = useTranslation('recordings');
  const fmt = useFormat();
  return (
    <>
      <div className="mt-4 grid items-start gap-4 min-[860px]:grid-cols-2">
        <Card title={t(($) => $.progress.countersTitle)} level={3} className="mb-0">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {counters.map((item) => {
              const label = `${item.character} · ${item.key}`;
              return (
                <Progress
                  key={JSON.stringify([item.character, item.key])}
                  label={label}
                  text={t(($) => $.progress.counter, {
                    label,
                    value: fmt.number.format(item.value),
                    limit: fmt.number.format(item.limit),
                  })}
                  value={item.value}
                  limit={item.limit}
                />
              );
            })}
          </ul>
          {!counters.length && (
            <EmptyState
              compact
              title={t(($) => $.progress.countersEmptyTitle)}
              icon={<Icon name="activity" size={18} />}
            >
              {t(($) => $.progress.countersEmptyBody)}
            </EmptyState>
          )}
        </Card>
        <Card title={t(($) => $.progress.petsTitle)} level={3} className="mb-0">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {pets.map((item) => {
              const label = `${item.character} · ${item.pet}`;
              return (
                <Progress
                  key={JSON.stringify([item.character, item.pet])}
                  label={label}
                  text={t(($) => $.progress.souls, {
                    label,
                    value: fmt.number.format(item.owned),
                    limit: fmt.number.format(item.required),
                  })}
                  value={item.owned}
                  limit={item.required}
                />
              );
            })}
          </ul>
          {!pets.length && (
            <EmptyState
              compact
              title={t(($) => $.progress.petsEmptyTitle)}
              icon={<Icon name="paw" size={18} />}
            >
              {t(($) => $.progress.petsEmptyBody)}
            </EmptyState>
          )}
        </Card>
      </div>
      {gaps.length > 0 && (
        <Notice tone="warn" className="mt-4">
          {t(($) => $.progress.incomplete, { gaps: gaps.join('; ') })}
        </Notice>
      )}
    </>
  );
}
