import { useId, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Swatch } from '../../../components/ui/Data';
import { Icon } from '../../../components/ui/Icon';
import { SortTable, type Column } from '../../../components/ui/Table';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import type { ReportPlayer } from '../../../types/offline';
import { key, rate } from '../analysis';
import { bossActivity, type BossActivity as Activity } from '../breakdown';
import { useReport } from './context';
import { Figure, Note, ShareCell, SubHeading } from './parts';
import { PlayerName } from './PlayerViews';

/**
 * How steadily the selected player kept hitting the boss in the selected window, as one
 * compact band: its figures on a single line, then active and gap stretches on the window's
 * clock. The method (one-second bins, see `bossActivity`) and the key of the band unfold from
 * the help button, the party's figures from their own; neither pushes the skills down while
 * closed. What a truncated live report cannot measure is always marked and said.
 */
export function BossActivity({ className }: { className?: string }) {
  const { report, player, players, names, window, setPlayer, goTo, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const [open, setOpen] = useState<'method' | 'party' | null>(null);
  const panel = useId();
  const activities = useMemo(
    () =>
      bossActivity(
        report,
        players.map((p) => p.id),
        window,
      ),
    [report, players, window],
  );
  if (!player) return null;
  const mine = activities?.get(key(player.id));
  if (!activities || !mine)
    return (
      <section
        aria-label={t(($) => $.skills.activity.title)}
        className={cn('flex flex-wrap items-baseline gap-x-4 gap-y-1', className)}
      >
        <SubHeading className="mb-0">{t(($) => $.skills.activity.title)}</SubHeading>
        <Note>{t(($) => $.skills.activity.noBoss)}</Note>
      </section>
    );

  const span = Math.max(1, window.to - window.from);
  const left = (at: number) => `${((at - window.from) / span) * 100}%`;
  const width = (from: number, to: number) => `${((to - from) / span) * 100}%`;
  // The report holds no events before this point of the window: unknown, never a gap.
  const unrecorded = mine.from > window.from;
  const gap = mine.longestGap;
  const measured = mine.to - mine.from;
  const partyDamage = players.reduce((sum, p) => sum + p.damage, 0);
  const of = (p: ReportPlayer): Activity | undefined => activities.get(key(p.id));
  const toggle = (which: 'method' | 'party') => setOpen(open === which ? null : which);
  const columns: Column<ReportPlayer>[] = [
    {
      key: 'name',
      label: t(($) => $.columns.player),
      text: true,
      sticky: true,
      render: (p) => <PlayerName player={p} />,
      sort: (p) => names.entity(p.id),
    },
    {
      key: 'damage',
      label: t(($) => $.skills.activity.damageShare),
      title: t(($) => $.skills.activity.damageShareTitle),
      render: (p) => fmt.pct(rate(p.damage, partyDamage)),
      sort: (p) => p.damage,
    },
    {
      key: 'active',
      label: t(($) => $.skills.activity.share),
      title: t(($) => $.skills.activity.shareTitle),
      render: (p) => (
        <ShareCell
          fraction={of(p)?.share ?? null}
          color={colorOf(p)}
          label={t(($) => $.skills.activity.label, { name: names.entity(p.id) })}
        >
          {fmt.pct(of(p)?.share)}
        </ShareCell>
      ),
      sort: (p) => of(p)?.share ?? null,
    },
    {
      key: 'activeTime',
      label: t(($) => $.skills.activity.activeTime),
      render: (p) => fmt.seconds(of(p)?.activeMs),
      sort: (p) => of(p)?.activeMs ?? null,
    },
    {
      key: 'gapTime',
      label: t(($) => $.skills.activity.gapTime),
      render: (p) => fmt.seconds(of(p)?.gapMs),
      sort: (p) => of(p)?.gapMs ?? null,
    },
    {
      key: 'longestGap',
      label: t(($) => $.skills.activity.longestGap),
      render: (p) => {
        const longest = of(p)?.longestGap;
        return longest ? fmt.seconds(longest.to - longest.from) : UNKNOWN;
      },
      sort: (p) => {
        const longest = of(p)?.longestGap;
        return longest ? longest.to - longest.from : null;
      },
    },
  ];

  return (
    <section
      data-ui="boss-activity"
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      aria-label={t(($) => $.skills.activity.label, { name: names.entity(player.id) })}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <SubHeading className="mb-0 shrink-0">{t(($) => $.skills.activity.title)}</SubHeading>
        <dl className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
          <Figure
            label={t(($) => $.skills.activity.share)}
            title={t(($) => $.skills.activity.shareTitle)}
            className="[&>dd]:font-semibold"
          >
            {fmt.pct(mine.share)}
          </Figure>
          <Figure label={t(($) => $.skills.activity.activeTime)} className="[&>dd]:font-semibold">
            {measured > 0
              ? t(($) => $.skills.activity.ofSpan, {
                  active: fmt.seconds(mine.activeMs),
                  span: fmt.seconds(measured),
                })
              : UNKNOWN}
          </Figure>
          <Figure label={t(($) => $.skills.activity.gapTime)} className="[&>dd]:font-semibold">
            {measured > 0 ? fmt.seconds(mine.gapMs) : UNKNOWN}
          </Figure>
          <Figure
            label={t(($) => $.skills.activity.longestGap)}
            className="items-center [&>dd]:inline-flex [&>dd]:items-center [&>dd]:gap-1.5 [&>dd]:font-semibold"
          >
            {gap ? (
              <>
                {fmt.seconds(gap.to - gap.from)}
                <small className="text-2xs font-normal text-ink-3">
                  {fmt.preciseClock(gap.from)} – {fmt.preciseClock(gap.to)}
                </small>
                <Button
                  size="xs"
                  variant="ghost"
                  iconOnly
                  aria-label={t(($) => $.skills.activity.showGap)}
                  title={t(($) => $.skills.activity.showGap)}
                  onClick={() => goTo('timeline', (gap.from + gap.to) / 2)}
                >
                  <Icon name="activity" size={12} />
                </Button>
              </>
            ) : measured > 0 ? (
              t(($) => $.skills.activity.noGap)
            ) : (
              UNKNOWN
            )}
          </Figure>
        </dl>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {unrecorded && (
            <span className="mr-1 inline-flex items-center gap-1.5 text-2xs text-ink-3">
              <i
                aria-hidden="true"
                className="inline-block size-2 rounded-xs bg-surface-3 bg-hatch"
              />
              {t(($) => $.skills.activity.keyUnrecorded)}
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-expanded={open === 'method'}
            aria-controls={panel}
            aria-label={t(($) => $.skills.activity.how)}
            title={t(($) => $.skills.activity.how)}
            onClick={() => toggle('method')}
          >
            <Icon name="info" size={12} />
          </Button>
          {players.length > 1 && (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={open === 'party'}
              aria-controls={panel}
              onClick={() => toggle('party')}
            >
              {t(($) => $.skills.activity.party)}
              <Icon name={open === 'party' ? 'chevronUp' : 'chevronDown'} size={12} />
            </Button>
          )}
        </span>
      </div>
      {/* A picture of the figures beside it, on the same clock as the range track above. */}
      <div
        data-ui="activity-band"
        aria-hidden="true"
        className="relative h-2.5 overflow-hidden rounded-full border border-line-soft bg-sunken inset-shadow-well"
      >
        {unrecorded && (
          <span
            data-state="unrecorded"
            className="absolute inset-y-0 left-0 bg-surface-3 bg-hatch"
            style={{ width: width(window.from, mine.from) }}
            title={t(($) => $.skills.activity.keyUnrecorded)}
          />
        )}
        {mine.segments.map((segment) => {
          const words = {
            start: fmt.preciseClock(segment.from),
            end: fmt.preciseClock(segment.to),
            length: fmt.seconds(segment.to - segment.from),
          };
          return (
            <span
              key={segment.from}
              data-state={segment.active ? 'active' : 'gap'}
              className={cn('absolute inset-y-0', segment.active && 'origin-left animate-grow')}
              style={{
                left: left(segment.from),
                width: width(segment.from, segment.to),
                background: segment.active ? colorOf(player) : undefined,
              }}
              title={
                segment.active
                  ? t(($) => $.skills.activity.segmentActive, words)
                  : t(($) => $.skills.activity.segmentGap, words)
              }
            />
          );
        })}
      </div>
      {unrecorded && (
        <Note>{t(($) => $.skills.activity.truncated, { start: fmt.preciseClock(mine.from) })}</Note>
      )}
      <div id={panel} className="empty:hidden">
        {open === 'method' && (
          <div className="flex flex-col gap-1.5 pt-1">
            <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-2xs text-ink-3">
              <li className="inline-flex items-center gap-1.5">
                <Swatch color={colorOf(player)} />
                {t(($) => $.skills.activity.keyActive)}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <i
                  aria-hidden="true"
                  className="inline-block size-2 rounded-xs border border-line-strong bg-sunken"
                />
                {t(($) => $.skills.activity.keyGap)}
              </li>
            </ul>
            <Note className="max-w-3xl">{t(($) => $.skills.activity.method)}</Note>
          </div>
        )}
        {open === 'party' && (
          <SortTable
            dense
            className="mt-1"
            label={t(($) => $.skills.activity.partyTable)}
            columns={columns}
            rows={players}
            rowKey={(p) => key(p.id)}
            initialSort={{ key: 'active', desc: true }}
            selected={key(player.id)}
            onSelect={(p) => setPlayer(key(p.id))}
          />
        )}
      </div>
    </section>
  );
}
