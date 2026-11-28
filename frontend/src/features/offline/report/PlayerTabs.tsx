import type { ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Swatch } from '../../../components/ui/Data';
import { ClassIcon } from '../../../components/ui/GameArt';
import { Pressable } from '../../../components/ui/Pressable';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import type { ReportPlayer } from '../../../types/offline';
import { critRate, flagRate, key, playerDps, rate, sameId, type PositionalFlag } from '../analysis';
import { useReport } from './context';
import { Figure } from './parts';
import { CastCount } from './PlayerViews';

const FLAGS: readonly PositionalFlag[] = ['back', 'front', 'perfect', 'double', 'parry'];

/**
 * Every player of the fight as a pebble, ranked by damage, with their share of the party's
 * damage: one press changes whose breakdown shows. A hidden local player keeps their class
 * private here as everywhere: no emblem, a neutral colour, and the name the report gives.
 */
export function PlayerTabs({ className }: { className?: string }) {
  const { players, player, setPlayer, names, hideNames, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const total = players.reduce((sum, p) => sum + p.damage, 0);
  if (!players.length) return null;
  return (
    <fieldset
      data-ui="player-tabs"
      className={cn('m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0', className)}
    >
      <legend className="sr-only">{t(($) => $.player.select)}</legend>
      {players.map((p) => {
        const chosen = sameId(p.id, player?.id);
        const name = names.entity(p.id);
        const share = fmt.pct(rate(p.damage, total));
        return (
          <Pressable
            key={key(p.id)}
            aria-pressed={chosen}
            title={t(($) => $.player.tabTitle, { name, share })}
            onClick={() => setPlayer(key(p.id))}
            className={cn(
              'group flex h-8 max-w-full min-w-0 items-center gap-2 rounded-full border border-line bg-surface-2',
              'pr-3 pl-2.5 text-sm text-ink-2 hover:border-line-strong hover:text-ink',
              'aria-pressed:border-accent-line aria-pressed:bg-accent-soft aria-pressed:text-ink',
            )}
          >
            <Swatch color={colorOf(p)} />
            <ClassIcon name={hideNames && p.local ? null : p.class} size={16} />
            <span className="max-w-44 min-w-0 truncate font-medium">{name}</span>
            {p.local && !hideNames && (
              <Badge shape="tag" tone="accent">
                {t(($) => $.player.you)}
              </Badge>
            )}
            <span className="text-xs text-ink-3 figures group-aria-pressed:text-accent">
              {share}
            </span>
          </Pressable>
        );
      })}
    </fieldset>
  );
}

/** One headline figure of the output summary: a caps label over the value. */
function Headline({
  label,
  title,
  tone,
  children,
}: {
  label: string;
  title?: string | undefined;
  tone?: 'accent' | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">{label}</dt>
      <dd
        className={cn(
          'm-0 text-lg leading-tight font-semibold tracking-tight figures',
          tone === 'accent' ? 'text-accent' : 'text-ink',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * The selected player's output over the whole fight, as native counted it. These are fight
 * totals and say so: a time window or target chosen below never changes them, so they are
 * never passed off as figures of that selection. What native did not observe stays a dash.
 */
export function PlayerSummary({ player, className }: { player: ReportPlayer; className?: string }) {
  const { report, players, names, mode, observed } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const seconds = report.duration_ms / 1000;
  const total = players.reduce((sum, p) => sum + p.damage, 0);
  const name = names.entity(player.id);
  // No healing in a fight whose heal packets were not observed is unknown, not zero.
  const hps =
    seconds <= 0 || (player.healing <= 0 && observed('healing') === false)
      ? UNKNOWN
      : fmt.number.format(player.healing / seconds);
  return (
    <section
      data-ui="player-summary"
      aria-label={t(($) => $.player.summary, { name })}
      className={cn('flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2.5', className)}
    >
      <Badge
        shape="tag"
        variant="outline"
        className="shrink-0"
        title={t(($) => $.player.wholeFightTitle)}
      >
        {t(($) => $.player.wholeFight)}
      </Badge>
      <dl className="m-0 flex flex-wrap items-end gap-x-7 gap-y-2">
        <Headline label={t(($) => $.columns.damage)}>{fmt.number.format(player.damage)}</Headline>
        <Headline
          label={mode === 'active' ? 'aDPS' : 'DPS'}
          title={
            mode === 'active'
              ? t(($) => $.damage.dpsActiveTitle)
              : t(($) => $.damage.dpsEncounterTitle)
          }
          tone="accent"
        >
          {fmt.maybe(playerDps(player, report, mode))}
        </Headline>
        <Headline label="HPS" title={t(($) => $.healing.hpsTitle)}>
          {hps}
        </Headline>
        <Headline label={t(($) => $.player.partyShare)} title={t(($) => $.player.partyShareTitle)}>
          {fmt.pct(rate(player.damage, total))}
        </Headline>
      </dl>
      <dl className="m-0 flex min-w-64 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <Figure label={t(($) => $.columns.hits)} title={t(($) => $.skills.hitsTitle)}>
          {fmt.maybe(player.hits)}
        </Figure>
        <Figure label={t(($) => $.columns.crit)} title={t(($) => $.damage.critTitle)}>
          {fmt.pct(critRate(player))}
        </Figure>
        {FLAGS.map((flag) => (
          <Figure
            key={flag}
            label={t(($) => $.skills.flag[flag])}
            title={t(($) => $.skills.flagTitle[flag])}
          >
            {fmt.pct(flagRate(player, flag))}
          </Figure>
        ))}
        <Figure label={t(($) => $.columns.casts)} title={t(($) => $.skills.castsTitle)}>
          <CastCount casts={player.casts} inferred={player.inferred_casts} />
        </Figure>
        <Figure label={t(($) => $.columns.deaths)}>{fmt.maybe(player.deaths)}</Figure>
        <Figure
          label={t(($) => $.columns.active)}
          title={
            player.activity_method
              ? t(($) => $.damage.activityMethod, { method: player.activity_method })
              : t(($) => $.damage.activity)
          }
        >
          {fmt.pct(player.active_pct, 0)}
        </Figure>
      </dl>
    </section>
  );
}
