import { useMemo } from 'react';
import { Button } from '../../../components/ui/Button';
import { Meter } from '../../../components/ui/Data';
import { Icon } from '../../../components/ui/Icon';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import { key } from '../analysis';
import { carriedBuffs } from '../breakdown';
import { useReport } from './context';
import { Note, SkillArt, SubHeading } from './parts';
import { skillColor } from './RotationView';

/**
 * The buffs the selected player carried in the selected window, as figures beside the skill
 * rows: the same measurement as the uptime summary of the buff analysis (`buffUptime`),
 * which opens from here and keeps the timeline, the other scopes and the per-skill overlap.
 * The headline is always the confirmed share; time from an application whose end was never
 * observed is an upper bound, shown muted, starred and prefixed, never added to it.
 */
export function BuffSidebar({ className }: { className?: string }) {
  const { report, player, names, window, total, observed, goTo } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const rows = useMemo(
    () => (player ? carriedBuffs(report, player.id, window) : []),
    [report, player, window],
  );
  if (!player) return null;
  const name = names.entity(player.id);
  const windowed = window.from > 0 || window.to < total;
  return (
    <aside
      data-ui="buff-sidebar"
      aria-label={t(($) => $.buffs.side.label, { name })}
      className={cn(
        'flex min-h-0 min-w-0 flex-col rounded-lg border border-line-soft bg-surface-2',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pt-2.5">
        <SubHeading className="mb-0">
          {t(($) => $.buffs.side.title)}{' '}
          <span className="font-normal text-ink-3 figures">{fmt.integer.format(rows.length)}</span>
        </SubHeading>
        <Button
          size="xs"
          variant="ghost"
          aria-haspopup="dialog"
          title={t(($) => $.buffs.side.fullTitle)}
          onClick={() => goTo('buffs')}
        >
          {t(($) => $.buffs.side.full)}
          <Icon name="arrowRight" size={12} />
        </Button>
      </header>
      <Note className="px-3 pb-2 figures">
        {t(($) => $.buffs.side.on, { name })} ·{' '}
        {windowed
          ? `${fmt.preciseClock(window.from)} – ${fmt.preciseClock(window.to)}`
          : t(($) => $.range.wholeFight)}
      </Note>
      {rows.length ? (
        <ul
          aria-label={t(($) => $.buffs.side.list, { name })}
          className={cn(
            'm-0 grid min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]',
            'gap-x-4 overflow-y-auto border-t border-line-soft px-3 py-1',
          )}
        >
          {rows.map((row) => {
            const buff = names.skill(row.skill);
            return (
              <li
                key={row.key}
                data-ui="buff-row"
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-b border-line-soft py-2 last:border-b-0"
              >
                <SkillArt id={row.skill} name={buff} size="sm" />
                <div className="min-w-0">
                  <div className="text-sm leading-tight font-medium wrap-anywhere text-ink">
                    {buff}
                  </div>
                  <div className="text-2xs text-ink-3 figures">
                    <span title={t(($) => $.buffs.columnTitle.confirmed)}>
                      {fmt.seconds(row.confirmedMs)}
                    </span>{' '}
                    ·{' '}
                    <span title={t(($) => $.buffs.columnTitle.applications)}>
                      {fmt.integer.format(row.applications)}×
                    </span>
                  </div>
                </div>
                <div className="text-right leading-tight figures">
                  <div
                    className="text-sm font-semibold text-ink"
                    title={t(($) => $.buffs.columnTitle.confirmedShare)}
                  >
                    {fmt.pct(row.confirmedShare)}
                  </div>
                  {row.openEnds > 0 && (
                    // Never a measurement: muted and starred like the open lanes of the analysis.
                    <div
                      className="text-2xs text-ink-3"
                      title={t(($) => $.buffs.columnTitle.upper)}
                    >
                      ≤ {fmt.pct(row.upperShare)}{' '}
                      <abbr className="text-warn no-underline" title={t(($) => $.buffs.openTitle)}>
                        *
                      </abbr>
                    </div>
                  )}
                </div>
                <Meter
                  size="xs"
                  className="col-span-3 flex w-full"
                  fraction={row.confirmedShare}
                  color={skillColor(key(row.skill))}
                  label={t(($) => $.buffs.side.meter, { name: buff })}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <Note className="border-t border-line-soft px-3 py-3">
          {!report.buffs.length
            ? observed('buffs') === false
              ? t(($) => $.buffs.notObserved)
              : t(($) => $.buffs.emptyBody)
            : t(($) => $.buffs.side.none)}
        </Note>
      )}
    </aside>
  );
}
