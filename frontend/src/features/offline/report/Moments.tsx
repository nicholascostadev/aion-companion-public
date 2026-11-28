import { useId, useMemo } from 'react';
import { Button } from '../../../components/ui/Button';
import { Swatch } from '../../../components/ui/Data';
import { Icon } from '../../../components/ui/Icon';
import { Pressable } from '../../../components/ui/Pressable';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import { deathRecaps, key } from '../analysis';
import { useReport } from './context';
import { highlightGroups, highlightLabel, HighlightsView } from './EventViews';
import { SubHeading } from './parts';

/** Deaths written on the line before the rest are left to the timeline's recaps. */
const DEATHS_SHOWN = 4;

const pebble = cn(
  'inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface-2',
  'px-2.5 text-xs text-ink-2',
);
const pressable = 'transition-colors duration-150 hover:border-line-strong hover:text-ink';

/**
 * The fight's key moments on one line of Combat details: who died and when, and the leader
 * of each highlight that happened at an instant (the biggest hit, the first hit). Every
 * moment is a way to it: one press opens the timeline on that instant. The death recaps
 * stay on the timeline, and every highlight, the fight-long ones too, unfolds beneath with
 * its runners-up, so neither pushes the skills down while closed. Nothing is shown for a
 * fight that has neither.
 */
export function FightMoments({ className }: { className?: string }) {
  const { report, names, details, setDetails, goTo, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const panel = useId();
  const deaths = useMemo(() => deathRecaps(report, (id) => names.isPlayer(id)), [report, names]);
  const groups = useMemo(() => highlightGroups(report.highlights), [report.highlights]);
  // A highlight is a moment when it names an instant; a total over the fight is not.
  const timed = groups.flatMap(([kind, items]) => {
    const lead = items[0];
    return lead && lead.at_ms !== null ? [[kind, lead, lead.at_ms] as const] : [];
  });
  if (!deaths.length && !groups.length) return null;
  const open = details.highlights && groups.length > 0;
  const playerOf = (id: string | number | null) =>
    id === null ? undefined : names.players.get(key(id));

  return (
    <section
      data-ui="fight-moments"
      aria-label={t(($) => $.moments.title)}
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <SubHeading className="mb-0 shrink-0">{t(($) => $.moments.title)}</SubHeading>
        <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap items-center gap-1.5 p-0">
          {deaths.slice(0, DEATHS_SHOWN).map((death, index) => {
            const name = names.entity(death.entity);
            const time = fmt.preciseClock(death.at_ms);
            return (
              <li key={`death-${key(death.entity)}-${death.at_ms}-${index}`} className="min-w-0">
                <Pressable
                  data-moment="death"
                  className={cn(pebble, pressable)}
                  aria-label={t(($) => $.moments.deathAt, { name, time })}
                  title={t(($) => $.showOnTimeline)}
                  onClick={() => goTo('timeline', death.at_ms)}
                >
                  <Icon name="death" size={12} className="shrink-0 text-danger" />
                  <span className="min-w-0 truncate font-medium text-ink">{name}</span>
                  <span className="shrink-0 text-ink-3 figures">{time}</span>
                </Pressable>
              </li>
            );
          })}
          {deaths.length > 0 && (
            <li>
              <Button
                size="xs"
                variant="ghost"
                title={t(($) => $.moments.recapsTitle)}
                onClick={() => goTo('deaths')}
              >
                {deaths.length > DEATHS_SHOWN
                  ? t(($) => $.moments.allDeaths, { count: deaths.length })
                  : t(($) => $.moments.recaps)}
                <Icon name="arrowRight" size={12} />
              </Button>
            </li>
          )}
          {timed.map(([kind, lead, at]) => {
            const label = highlightLabel(t, kind);
            const who = names.entity(lead.player);
            const player = playerOf(lead.player);
            const time = fmt.preciseClock(at);
            return (
              <li key={`highlight-${kind}`} className="min-w-0">
                <Pressable
                  data-moment="highlight"
                  className={cn(pebble, pressable)}
                  aria-label={
                    // A highlight that is itself a moment (the first hit) has no other figure.
                    lead.value === null
                      ? t(($) => $.moments.highlightMoment, { label, name: who, time })
                      : t(($) => $.moments.highlightAt, {
                          label,
                          value: fmt.number.format(lead.value),
                          name: who,
                          time,
                        })
                  }
                  title={t(($) => $.showOnTimeline)}
                  onClick={() => goTo('timeline', at)}
                >
                  <span className="shrink-0 text-ink-3">{label}</span>
                  <span className="shrink-0 font-semibold text-ink figures">
                    {lead.value === null ? time : fmt.number.format(lead.value)}
                  </span>
                  {player && <Swatch color={colorOf(player)} />}
                  <span className="min-w-0 truncate">{who}</span>
                  {lead.value !== null && (
                    <span className="shrink-0 text-ink-3 figures">{time}</span>
                  )}
                </Pressable>
              </li>
            );
          })}
        </ul>
        {groups.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0"
            aria-expanded={open}
            aria-controls={panel}
            title={t(($) => $.moments.rankingsTitle)}
            onClick={() => setDetails({ highlights: !open })}
          >
            {t(($) => $.moments.rankings)}
            <span className="text-ink-3 figures">{fmt.integer.format(groups.length)}</span>
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
          </Button>
        )}
      </div>
      <div id={panel} className="empty:hidden">
        {open && (
          <div className="border-y border-line-soft py-5">
            <HighlightsView />
          </div>
        )}
      </div>
    </section>
  );
}
