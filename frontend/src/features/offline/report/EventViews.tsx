import { useMemo } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Swatch } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { SkillLabel } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { tableCell, tableRow, tableScroll } from '../../../components/ui/Table';
import { cn } from '../../../lib/cn';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../../i18n/provider';
import type { Highlight } from '../../../types/offline';
import { deathRecaps, key } from '../analysis';
import { useReport } from './context';
import { Note } from './parts';

/**
 * Deaths read as a thread through the fight: each one a node on a single line, with the
 * hits that led to it beneath. No card per death.
 */
export function DeathsView() {
  const { report, names, observed, goTo, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const recaps = useMemo(() => deathRecaps(report, (id) => names.isPlayer(id)), [report, names]);
  if (!recaps.length)
    return (
      <EmptyState title={t(($) => $.deaths.emptyTitle)} icon={<Icon name="leaf" size={20} />}>
        {observed('deaths') === false
          ? t(($) => $.deaths.notObserved)
          : t(($) => $.deaths.emptyBody)}
      </EmptyState>
    );
  const cell = cn(tableCell, 'px-2.5 py-1.5 text-sm');
  const tenths = fmt.numberWith({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <ol
      aria-label={t(($) => $.tabs.deaths)}
      className="relative m-0 list-none p-0 before:absolute before:top-3 before:bottom-3 before:left-[5px] before:w-px before:bg-line"
    >
      {recaps.map((death, i) => {
        const player = names.players.get(key(death.entity));
        return (
          <li
            key={`${key(death.entity)}-${death.at_ms}-${i}`}
            className="relative pb-7 pl-8 last:pb-0"
          >
            <span
              aria-hidden="true"
              className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-danger bg-surface shadow-[0_0_0_4px_var(--color-surface)]"
            />
            <header className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {player && <Swatch color={colorOf(player)} />}
              <b className="font-semibold text-ink">{names.entity(death.entity)}</b>
              <span className="text-xs text-ink-3 tabular-nums">
                {t(($) => $.deaths.diedAt, { time: fmt.preciseClock(death.at_ms) })}
              </span>
              <Badge
                shape="tag"
                variant="outline"
                tone={death.revivedAt === null ? 'neutral' : 'success'}
              >
                {death.revivedAt === null
                  ? t(($) => $.deaths.notRevived)
                  : t(($) => $.deaths.revived, {
                      seconds: tenths.format((death.revivedAt - death.at_ms) / 1000),
                    })}
              </Badge>
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                icon={<Icon name="activity" size={12} />}
                onClick={() => goTo('timeline', death.at_ms)}
              >
                {t(($) => $.showOnTimeline)}
              </Button>
            </header>
            {death.lastHits.length ? (
              <>
                <Note className="mb-2.5">
                  {[
                    t(($) => $.deaths.recap, {
                      count: death.hitCount,
                      damage: fmt.number.format(death.hitTotal),
                    }),
                    death.hitCount > death.lastHits.length &&
                      t(($) => $.deaths.showingLast, {
                        shown: fmt.integer.format(death.lastHits.length),
                      }),
                    death.killer !== null &&
                      t(($) => $.deaths.lastHitFrom, { name: names.entity(death.killer) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Note>
                <div className={tableScroll}>
                  <table
                    data-ui="table"
                    className="w-full border-collapse text-sm tabular-nums"
                    aria-label={t(($) => $.deaths.hitsBefore, { name: names.entity(death.entity) })}
                  >
                    <tbody>
                      {death.lastHits.map((hit, j) => (
                        <tr key={j} className={tableRow}>
                          <td className={cn(cell, 'w-16 text-left text-ink-3')}>
                            {t(($) => $.deaths.before, {
                              seconds: tenths.format((death.at_ms - hit.at_ms) / 1000),
                            })}
                          </td>
                          <td className={cn(cell, 'text-left')}>{names.entity(hit.source)}</td>
                          <td className={cn(cell, 'text-left')}>
                            <SkillLabel id={hit.skill}>{names.skill(hit.skill)}</SkillLabel>
                          </td>
                          <td className={cn(cell, 'text-right')}>
                            {hit.amount === null || hit.amount === undefined
                              ? UNKNOWN
                              : fmt.number.format(hit.amount)}
                          </td>
                          <td className={cn(cell, 'w-14 text-left')}>
                            {hit.critical ? (
                              <Badge shape="tag" tone="warn" variant="outline">
                                {t(($) => $.columns.crit)}
                              </Badge>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Note>{t(($) => $.deaths.noHits)}</Note>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const HIGHLIGHT_KEYS = {
  biggest_hit: 'biggestHit',
  first_hit: 'firstHit',
  healing: 'healing',
  healing_received: 'healingReceived',
  damage_taken: 'damageTaken',
} as const;

/** A highlight kind's name; an unknown kind is shown from its wire name. */
function highlightLabel(t: Translate<'reports'>, kind: string) {
  const id = Object.hasOwn(HIGHLIGHT_KEYS, kind)
    ? HIGHLIGHT_KEYS[kind as keyof typeof HIGHLIGHT_KEYS]
    : null;
  return id ? t(($) => $.highlights[id]) : null;
}

/**
 * Each highlight is a specimen: a caps label, one large figure and who earned it, rooted on
 * a hairline with a short stem in the player's colour.
 */
export function HighlightsView() {
  const { report, names, goTo, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const groups = useMemo(() => {
    const map = new Map<string, Highlight[]>();
    for (const h of report.highlights) map.set(h.kind, [...(map.get(h.kind) ?? []), h]);
    // Totals rank best first so the card leads with the top player.
    for (const list of map.values()) list.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return [...map.entries()];
  }, [report.highlights]);
  if (!groups.length)
    return (
      <EmptyState title={t(($) => $.highlights.emptyTitle)} icon={<Icon name="sprout" size={20} />}>
        {t(($) => $.highlights.emptyBody)}
      </EmptyState>
    );
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-x-8 gap-y-8">
      {groups.map(([kind, items]) => {
        const lead = items[0]!;
        const player = lead.player === null ? undefined : names.players.get(key(lead.player));
        return (
          <section
            key={kind}
            aria-label={highlightLabel(t, kind) ?? kind}
            className="relative flex flex-col gap-1 border-t border-line pt-3.5"
          >
            <span
              aria-hidden="true"
              className="absolute -top-px left-0 h-0.5 w-10 origin-left animate-grow rounded-full bg-accent"
              style={player ? { background: colorOf(player) } : undefined}
            />
            <h4 className="m-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
              {highlightLabel(t, kind) ?? kind.replace(/_/g, ' ')}
            </h4>
            <p className="m-0 text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {lead.value === null
                ? fmt.preciseClock(lead.at_ms ?? 0)
                : fmt.number.format(lead.value)}
            </p>
            <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-ink">
              {player && <Swatch color={colorOf(player)} />}
              {names.entity(lead.player)}
              {lead.at_ms !== null && lead.value !== null && (
                <span className="font-normal text-ink-3 tabular-nums">
                  {' '}
                  · {fmt.preciseClock(lead.at_ms)}
                </span>
              )}
            </p>
            {items.length > 1 && (
              <ol className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-xs text-ink-2">
                {items.slice(1, 5).map((h, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="w-3 text-ink-4 tabular-nums">{i + 2}</span>
                    <span className="min-w-0 flex-1 truncate">{names.entity(h.player)}</span>
                    <span className="tabular-nums">
                      {h.value === null ? UNKNOWN : fmt.number.format(h.value)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {lead.at_ms !== null && (
              <Button
                variant="link"
                className="mt-2 self-start text-xs"
                onClick={() => goTo('timeline', lead.at_ms ?? 0)}
              >
                {t(($) => $.showOnTimeline)}
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}
