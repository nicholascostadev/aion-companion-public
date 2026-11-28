import { Meter } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import type { ReportPlayer } from '../../../types/offline';
import { key, rate, type TakenRow } from '../analysis';
import { useReport } from './context';
import { Figure, SkillArt } from './parts';

/** What the hits a player took can be ordered by. */
export const TAKEN_SORTS = ['value', 'name', 'hits', 'max'] as const;
export type TakenSort = (typeof TAKEN_SORTS)[number];
export interface TakenOrder {
  key: TakenSort;
  desc: boolean;
}
export const DEFAULT_TAKEN_ORDER: TakenOrder = { key: 'value', desc: true };

/** The hits a player took, narrowed by a search over skill and source, in the chosen order. */
export function arrangeTaken(
  rows: TakenRow[],
  query: string,
  order: TakenOrder,
  label: (row: TakenRow) => string,
): TakenRow[] {
  const needle = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const found = needle ? rows.filter((row) => label(row).toLowerCase().includes(needle)) : rows;
  const direction = order.desc ? -1 : 1;
  const figure = (row: TakenRow) =>
    order.key === 'hits' ? row.hits : order.key === 'max' ? row.max : row.amount;
  return [...found].sort((a, b) =>
    order.key === 'name'
      ? direction * label(a).localeCompare(label(b))
      : direction * (figure(a) - figure(b)) || b.amount - a.amount,
  );
}

/**
 * The damage the selected player took in the window, as rows like the skill rows: the
 * skill's original art, its name over who it came from, the damage and its share of what
 * the player took, then hits and the biggest one. Always from the recorded events, never
 * from the fight totals, and the list says so above.
 */
export function TakenRows({
  player,
  rows,
  all,
  windowed,
}: {
  player: ReportPlayer;
  /** The rows to list, already searched and ordered. */
  rows: TakenRow[];
  /** Every row of the window, which the shares are of. */
  all: TakenRow[];
  windowed: boolean;
}) {
  const { names, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const total = all.reduce((sum, row) => sum + row.amount, 0);
  if (!rows.length)
    return all.length ? (
      <EmptyState
        compact
        title={t(($) => $.taken.noMatchTitle)}
        icon={<Icon name="search" size={18} />}
      >
        {t(($) => $.taken.noMatchBody)}
      </EmptyState>
    ) : (
      <EmptyState
        compact
        title={t(($) => $.taken.emptyTitle)}
        icon={<Icon name="leaf" size={18} />}
      >
        {windowed ? t(($) => $.taken.noHitsWindow) : t(($) => $.taken.noHits)}
      </EmptyState>
    );
  return (
    <ul
      data-ui="taken-rows"
      aria-label={t(($) => $.taken.rows, { name: names.entity(player.id) })}
      className="m-0 list-none border-y border-line-soft p-0"
    >
      {rows.map((row) => {
        const skill = names.skill(row.skill);
        const share = rate(row.amount, total);
        return (
          <li
            key={`${key(row.source)}|${key(row.skill)}`}
            data-ui="taken-row"
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-line-soft px-2.5 py-2.5 last:border-b-0"
          >
            <SkillArt id={row.skill} name={skill} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="min-w-0 text-md leading-snug font-semibold wrap-anywhere text-ink">
                  {skill}
                </span>
                <span className="ml-auto flex shrink-0 items-baseline gap-3 figures">
                  <span className="text-md font-semibold text-ink">
                    <span className="sr-only">{t(($) => $.columns.taken)} </span>
                    {fmt.number.format(row.amount)}
                  </span>
                  <span className="w-14 text-right text-sm text-ink-2">
                    <span className="sr-only">{t(($) => $.columns.share)} </span>
                    {fmt.pct(share)}
                  </span>
                </span>
              </div>
              <div className="text-xs text-ink-3">
                {t(($) => $.taken.from, {
                  name: row.source === null ? UNKNOWN : names.entity(row.source),
                })}
              </div>
              <Meter
                className="mt-1.5 flex w-full"
                fraction={share}
                color={colorOf(player)}
                label={t(($) => $.player.shareMeter, { name: skill })}
              />
              <dl className="m-0 mt-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-1 text-sm">
                <Figure label={t(($) => $.columns.hits)}>{fmt.number.format(row.hits)}</Figure>
                <Figure label={t(($) => $.columns.biggest)}>{fmt.number.format(row.max)}</Figure>
              </dl>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
