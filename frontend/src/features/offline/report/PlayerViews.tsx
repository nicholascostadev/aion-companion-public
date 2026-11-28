import { Badge } from '../../../components/ui/Badge';
import { BarList, Meter, Swatch } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { ClassIcon } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { SortTable, type Column } from '../../../components/ui/Table';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import type { ReportPlayer } from '../../../types/offline';
import { critRate, flagRate, key, playerDps, rate } from '../analysis';
import { useReport, type DetailKind, type ReportCtx } from './context';
import { InlineSelect, Note, ShareCell, SubHeading } from './parts';

/** Player picker shared by the per-player views. */
export function PlayerSelect({ filter }: { filter?: (player: ReportPlayer) => boolean }) {
  const { players, player, setPlayer, names } = useReport();
  const { t } = useTranslation('reports');
  const options = filter ? players.filter(filter) : players;
  if (!options.length) return null;
  return (
    <InlineSelect
      label={t(($) => $.player.select)}
      value={player ? key(player.id) : ''}
      onChange={(e) => setPlayer(e.target.value)}
    >
      {options.map((p) => (
        <option key={key(p.id)} value={key(p.id)}>
          {names.entity(p.id)}
          {p.class ? ` · ${p.class}` : ''}
        </option>
      ))}
    </InlineSelect>
  );
}

export function PlayerName({ player }: { player: ReportPlayer }) {
  const { names, hideNames, colorOf } = useReport();
  const { t } = useTranslation('reports');
  return (
    <span className="inline-flex max-w-65 min-w-0 items-center gap-2">
      <Swatch color={colorOf(player)} />
      {/* Hidden names keep your own class private, as the text does. */}
      <ClassIcon name={hideNames && player.local ? null : player.class} />
      <span className="min-w-0 truncate font-semibold text-ink">{names.entity(player.id)}</span>
      {player.class && !hideNames && (
        <small className="text-2xs font-normal text-ink-3">{player.class}</small>
      )}
      {player.local && (
        <Badge shape="tag" tone="accent">
          {t(($) => $.player.you)}
        </Badge>
      )}
    </span>
  );
}

const seconds = (ctx: ReportCtx) => Math.max(0.001, ctx.report.duration_ms / 1000);

/** Cast count, marking how many native inferred from hits without a cast packet. */
export function CastCount({ casts, inferred }: { casts: number | null; inferred: number | null }) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  if (casts === null) return <>{UNKNOWN}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {fmt.number.format(casts)}
      {inferred ? (
        <Badge
          shape="tag"
          variant="outline"
          className="border-dashed font-medium text-ink-3"
          title={t(($) => $.player.inferredTitle, { count: inferred })}
        >
          {t(($) => $.player.inferred, { count: inferred })}
        </Badge>
      ) : null}
    </span>
  );
}

/** Crit rate across a player's healing skills only. */
function healCrit(player: ReportPlayer) {
  const heals = player.skills.filter((s) => s.healing > 0 && s.critical_hits_observed);
  if (!heals.length) return null;
  const crits = heals.reduce((n, s) => n + (s.crits ?? 0), 0);
  return rate(
    crits,
    heals.reduce((n, s) => n + (s.critical_hits_observed ?? 0), 0),
  );
}

/**
 * The party's figures for what Combat details break down, one row per player: damage dealt,
 * healing done or damage taken. These are the native engine's totals over the whole fight,
 * whatever target or time window the rows below are read in; a row chooses whose breakdown
 * shows.
 */
export function PartyComparison({ kind }: { kind: DetailKind }) {
  if (kind === 'heal') return <HealingTable />;
  if (kind === 'taken') return <TakenTable />;
  return <DamageTable />;
}

function DamageTable() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { players, report, mode, player, setPlayer, names } = ctx;
  const total = players.reduce((sum, p) => sum + p.damage, 0);
  const top = Math.max(1, ...players.map((p) => p.damage));
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
      label: t(($) => $.columns.damage),
      render: (p) => fmt.number.format(p.damage),
      sort: (p) => p.damage,
    },
    {
      key: 'share',
      label: t(($) => $.columns.share),
      render: (p) => (
        <ShareCell
          fraction={p.damage / top}
          color={ctx.colorOf(p)}
          label={t(($) => $.damage.shareMeter, { name: names.entity(p.id) })}
        >
          {fmt.pct(rate(p.damage, total))}
        </ShareCell>
      ),
      sort: (p) => p.damage,
    },
    {
      key: 'dps',
      label: mode === 'active' ? 'aDPS' : 'DPS',
      title:
        mode === 'active'
          ? t(($) => $.damage.dpsActiveTitle)
          : t(($) => $.damage.dpsEncounterTitle),
      render: (p) => fmt.maybe(playerDps(p, report, mode)),
      sort: (p) => playerDps(p, report, mode),
    },
    {
      key: 'edps',
      label: 'eDPS',
      title: t(($) => $.damage.edpsTitle),
      render: (p) => fmt.maybe(p.edps),
      sort: (p) => p.edps,
    },
    {
      key: 'adps',
      label: 'aDPS',
      title: t(($) => $.damage.adpsTitle),
      render: (p) => fmt.maybe(p.adps),
      sort: (p) => p.adps,
    },
    {
      key: 'active',
      label: t(($) => $.columns.active),
      title: t(($) => $.damage.activeTitle),
      render: (p) => (
        <span
          title={
            p.activity_method
              ? t(($) => $.damage.activityMethod, { method: p.activity_method })
              : t(($) => $.damage.activity)
          }
        >
          {fmt.pct(p.active_pct, 0)}
        </span>
      ),
      sort: (p) => p.active_pct,
    },
    {
      key: 'crit',
      label: t(($) => $.columns.crit),
      title: t(($) => $.damage.critTitle),
      render: (p) => fmt.pct(critRate(p)),
      sort: critRate,
    },
    {
      key: 'back',
      label: t(($) => $.columns.back),
      title: t(($) => $.damage.backTitle),
      render: (p) => fmt.pct(flagRate(p, 'back')),
      sort: (p) => flagRate(p, 'back'),
    },
    {
      key: 'perfect',
      label: t(($) => $.columns.perfect),
      render: (p) => fmt.pct(flagRate(p, 'perfect')),
      sort: (p) => flagRate(p, 'perfect'),
    },
    {
      key: 'casts',
      label: t(($) => $.columns.casts),
      render: (p) => <CastCount casts={p.casts} inferred={p.inferred_casts} />,
      sort: (p) => p.casts,
    },
    {
      key: 'deaths',
      label: t(($) => $.columns.deaths),
      render: (p) => fmt.maybe(p.deaths),
      sort: (p) => p.deaths,
    },
  ];
  if (!players.some((p) => p.damage > 0))
    return (
      <EmptyState
        compact
        title={t(($) => $.damage.emptyTitle)}
        icon={<Icon name="sprout" size={18} />}
      >
        {t(($) => $.damage.emptyBody)}
      </EmptyState>
    );
  return (
    <SortTable
      dense
      label={t(($) => $.damage.table)}
      columns={columns}
      rows={players.filter((p) => p.damage > 0)}
      rowKey={(p) => key(p.id)}
      initialSort={{ key: 'damage', desc: true }}
      selected={player ? key(player.id) : null}
      onSelect={(p) => setPlayer(key(p.id))}
    />
  );
}

function HealingTable() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { players, player, setPlayer, names, observed } = ctx;
  const healers = players.filter((p) => p.healing > 0).sort((a, b) => b.healing - a.healing);
  const total = healers.reduce((s, p) => s + p.healing, 0);
  const top = Math.max(1, ...healers.map((p) => p.healing));
  if (!healers.length)
    return (
      <EmptyState
        compact
        title={t(($) => $.healing.emptyTitle)}
        icon={<Icon name="leaf" size={18} />}
      >
        {observed('healing') === false
          ? t(($) => $.healing.notObserved)
          : t(($) => $.healing.emptyBody)}
      </EmptyState>
    );
  return (
    <SortTable
      dense
      label={t(($) => $.healing.table)}
      rows={healers}
      rowKey={(p) => key(p.id)}
      selected={player ? key(player.id) : null}
      onSelect={(p) => setPlayer(key(p.id))}
      initialSort={{ key: 'healing', desc: true }}
      columns={[
        {
          key: 'name',
          label: t(($) => $.columns.player),
          text: true,
          sticky: true,
          render: (p) => <PlayerName player={p} />,
          sort: (p) => names.entity(p.id),
        },
        {
          key: 'healing',
          label: t(($) => $.columns.healing),
          render: (p) => fmt.number.format(p.healing),
          sort: (p) => p.healing,
        },
        {
          key: 'share',
          label: t(($) => $.columns.share),
          render: (p) => (
            <ShareCell
              fraction={p.healing / top}
              color={ctx.colorOf(p)}
              label={t(($) => $.healing.shareMeter, { name: names.entity(p.id) })}
            >
              {fmt.pct(rate(p.healing, total))}
            </ShareCell>
          ),
          sort: (p) => p.healing,
        },
        {
          key: 'hps',
          label: 'HPS',
          title: t(($) => $.healing.hpsTitle),
          render: (p) => fmt.number.format(p.healing / seconds(ctx)),
          sort: (p) => p.healing,
        },
        {
          key: 'crit',
          label: t(($) => $.columns.crit),
          title: t(($) => $.healing.critTitle),
          render: (p) => fmt.pct(healCrit(p)),
          sort: healCrit,
        },
      ]}
    />
  );
}

function TakenTable() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { players, player, setPlayer, names } = ctx;
  const hurt = players.filter((p) => p.received > 0).sort((a, b) => b.received - a.received);
  if (!hurt.length)
    return (
      <EmptyState
        compact
        title={t(($) => $.taken.emptyTitle)}
        icon={<Icon name="leaf" size={18} />}
      >
        {t(($) => $.taken.emptyBody)}
      </EmptyState>
    );
  const top = Math.max(1, ...hurt.map((p) => p.received));
  return (
    <SortTable
      dense
      label={t(($) => $.taken.table)}
      rows={hurt}
      rowKey={(p) => key(p.id)}
      selected={player ? key(player.id) : null}
      onSelect={(p) => setPlayer(key(p.id))}
      initialSort={{ key: 'received', desc: true }}
      columns={[
        {
          key: 'name',
          label: t(($) => $.columns.player),
          text: true,
          sticky: true,
          render: (p) => <PlayerName player={p} />,
          sort: (p) => names.entity(p.id),
        },
        {
          key: 'received',
          label: t(($) => $.columns.taken),
          render: (p) => fmt.number.format(p.received),
          sort: (p) => p.received,
        },
        {
          key: 'bar',
          label: t(($) => $.columns.relative),
          render: (p) => (
            <span className="inline-flex w-24 items-center">
              <Meter
                fraction={p.received / top}
                color={ctx.colorOf(p)}
                label={t(($) => $.taken.relativeMeter, { name: names.entity(p.id) })}
              />
            </span>
          ),
        },
        {
          key: 'dtps',
          label: 'DTPS',
          title: t(($) => $.taken.dtpsTitle),
          render: (p) => fmt.number.format(p.received / seconds(ctx)),
          sort: (p) => p.received,
        },
        {
          key: 'healed',
          label: t(($) => $.columns.healed),
          title: t(($) => $.taken.healedTitle),
          render: (p) => fmt.maybe(p.healing_received),
          sort: (p) => p.healing_received,
        },
        {
          key: 'deaths',
          label: t(($) => $.columns.deaths),
          render: (p) => fmt.maybe(p.deaths),
          sort: (p) => p.deaths,
        },
      ]}
    />
  );
}

/**
 * One player's damage or healing by who received it, over the whole fight as native counted
 * it: a target or time window chosen for the rows never changes these, and the block says so.
 */
export function TargetSplit({
  player,
  field,
  title,
  className,
}: {
  player: ReportPlayer;
  field: 'damage' | 'healing';
  title: string;
  className?: string;
}) {
  const { names, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const rows = player.targets.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]);
  const total = rows.reduce((s, r) => s + r[field], 0);
  return (
    <section data-ui="target-split" aria-label={title} className={className}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <SubHeading className="mb-0">{title}</SubHeading>
        <span className="text-2xs text-ink-3" title={t(($) => $.player.wholeFightTitle)}>
          {t(($) => $.player.wholeFight)}
        </span>
      </header>
      {rows.length ? (
        <BarList
          rows={rows.slice(0, 8).map((r) => ({
            key: key(r.id),
            label: r.name ?? names.entity(r.id),
            fraction: rate(r[field], total),
            color: colorOf(player),
            meterLabel: t(($) => $.player.shareMeter, { name: r.name ?? key(r.id) }),
            value: fmt.compact.format(r[field]),
            sub: fmt.pct(rate(r[field], total)),
          }))}
        />
      ) : (
        <Note>{t(($) => $.player.noneRecorded)}</Note>
      )}
    </section>
  );
}
