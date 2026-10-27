import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { BarList, Meter, Swatch } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { ClassIcon, SkillLabel } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { SortTable, type Column } from '../../../components/ui/Table';
import type { ReactNode } from 'react';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import type { ReportPlayer } from '../../../types/offline';
import {
  critRate,
  damageTaken,
  flagRate,
  key,
  playerDps,
  rate,
  sameId,
  skillRowsFromPlayer,
} from '../analysis';
import { useReport, type ReportCtx } from './context';
import { InlineSelect, Note, ShareCell, SubHeading, ViewStack } from './parts';

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

export function DamageView() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { players, report, mode, player, setPlayer, goTo, names } = ctx;
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
      <EmptyState title={t(($) => $.damage.emptyTitle)} icon={<Icon name="sprout" size={20} />}>
        {t(($) => $.damage.emptyBody)}
      </EmptyState>
    );
  return (
    <ViewStack>
      <SortTable
        label={t(($) => $.damage.table)}
        columns={columns}
        rows={players.filter((p) => p.damage > 0)}
        rowKey={(p) => key(p.id)}
        initialSort={{ key: 'damage', desc: true }}
        selected={player ? key(player.id) : null}
        onSelect={(p) => setPlayer(key(p.id))}
      />
      {player && player.damage > 0 && (
        <DetailSection
          label={t(($) => $.damage.detail, { name: names.entity(player.id) })}
          player={player}
          actions={
            <>
              <Button size="xs" variant="ghost" onClick={() => goTo('skills')}>
                {t(($) => $.damage.skillBreakdown)}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => goTo('rotation')}>
                {t(($) => $.tabs.rotation)}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => goTo('buffs')}>
                {t(($) => $.tabs.buffs)}
              </Button>
            </>
          }
        >
          <DetailGrid>
            <TopSkills player={player} />
            <TargetSplit player={player} field="damage" title={t(($) => $.damage.byTarget)} />
          </DetailGrid>
        </DetailSection>
      )}
    </ViewStack>
  );
}

function TopSkills({ player }: { player: ReportPlayer }) {
  const { names, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const rows = skillRowsFromPlayer(player).slice(0, 8);
  return (
    <div>
      <SubHeading>{t(($) => $.damage.topSkills)}</SubHeading>
      <BarList
        rows={rows.map((row) => ({
          key: key(row.id),
          label: <SkillLabel id={row.id}>{names.skill(row.id, row.name)}</SkillLabel>,
          fraction: row.share,
          color: colorOf(player),
          meterLabel: t(($) => $.player.shareMeter, { name: names.skill(row.id, row.name) }),
          value: fmt.compact.format(row.damage),
          sub: fmt.pct(row.share),
        }))}
      />
    </div>
  );
}

function TargetSplit({
  player,
  field,
  title,
}: {
  player: ReportPlayer;
  field: 'damage' | 'healing' | 'received';
  title: string;
}) {
  const { names, colorOf } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const rows = player.targets.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]);
  const total = rows.reduce((s, r) => s + r[field], 0);
  return (
    <div>
      <SubHeading>{title}</SubHeading>
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
    </div>
  );
}

export function HealingView() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { players, player, setPlayer, names, observed } = ctx;
  const healers = players.filter((p) => p.healing > 0).sort((a, b) => b.healing - a.healing);
  const total = healers.reduce((s, p) => s + p.healing, 0);
  const top = Math.max(1, ...healers.map((p) => p.healing));
  const selected = player && player.healing > 0 ? player : healers[0];
  const skills = selected ? skillRowsFromPlayer(selected, 'heal') : [];
  if (!healers.length)
    return (
      <EmptyState title={t(($) => $.healing.emptyTitle)} icon={<Icon name="leaf" size={20} />}>
        {observed('healing') === false
          ? t(($) => $.healing.notObserved)
          : t(($) => $.healing.emptyBody)}
      </EmptyState>
    );
  return (
    <ViewStack>
      <SortTable
        label={t(($) => $.healing.table)}
        rows={healers}
        rowKey={(p) => key(p.id)}
        selected={selected ? key(selected.id) : null}
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
      {selected && (
        <DetailSection player={selected}>
          <DetailGrid>
            <div>
              <SubHeading>{t(($) => $.healing.skills)}</SubHeading>
              <SortTable
                dense
                label={t(($) => $.healing.skills)}
                rows={skills}
                rowKey={(s) => key(s.id)}
                initialSort={{ key: 'healing', desc: true }}
                columns={[
                  {
                    key: 'skill',
                    label: t(($) => $.columns.skill),
                    text: true,
                    render: (s) => <SkillLabel id={s.id}>{names.skill(s.id, s.name)}</SkillLabel>,
                    sort: (s) => names.skill(s.id, s.name),
                  },
                  {
                    key: 'healing',
                    label: t(($) => $.columns.healing),
                    render: (s) => fmt.number.format(s.healing),
                    sort: (s) => s.healing,
                  },
                  {
                    key: 'share',
                    label: t(($) => $.columns.share),
                    render: (s) => fmt.pct(s.share),
                    sort: (s) => s.share,
                  },
                  {
                    key: 'hits',
                    label: t(($) => $.columns.hits),
                    render: (s) => fmt.maybe(s.hits),
                    sort: (s) => s.hits,
                  },
                  {
                    key: 'crit',
                    label: t(($) => $.columns.crit),
                    render: (s) => fmt.pct(critRate(s)),
                    sort: critRate,
                  },
                  {
                    key: 'avg',
                    label: t(($) => $.columns.avg),
                    render: (s) => fmt.maybe(s.avg),
                    sort: (s) => s.avg,
                  },
                ]}
              />
            </div>
            <TargetSplit
              player={selected}
              field="healing"
              title={t(($) => $.healing.byRecipient)}
            />
          </DetailGrid>
        </DetailSection>
      )}
    </ViewStack>
  );
}

export function TakenView() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { players, player, setPlayer, names, report, window, total } = ctx;
  const hurt = players.filter((p) => p.received > 0).sort((a, b) => b.received - a.received);
  const selected = player && player.received > 0 ? player : hurt[0];
  const windowed = window.from > 0 || window.to < total;
  const rows = selected ? damageTaken(report, selected.id, windowed ? window : null) : [];
  if (!hurt.length)
    return (
      <EmptyState title={t(($) => $.taken.emptyTitle)} icon={<Icon name="leaf" size={20} />}>
        {t(($) => $.taken.emptyBody)}
      </EmptyState>
    );
  const top = Math.max(1, ...hurt.map((p) => p.received));
  return (
    <ViewStack>
      <SortTable
        label={t(($) => $.taken.table)}
        rows={hurt}
        rowKey={(p) => key(p.id)}
        selected={selected ? key(selected.id) : null}
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
      {selected && (
        <DetailSection
          player={selected}
          actions={
            windowed && (
              <Badge shape="tag" tone="info" variant="outline">
                {t(($) => $.taken.zoomed)}
              </Badge>
            )
          }
        >
          <SortTable
            dense
            label={t(($) => $.taken.bySource)}
            rows={rows}
            rowKey={(r) => `${key(r.source)}|${key(r.skill)}`}
            initialSort={{ key: 'amount', desc: true }}
            empty={
              <Note className="px-3 py-4 text-center">
                {windowed ? t(($) => $.taken.noHitsWindow) : t(($) => $.taken.noHits)}
              </Note>
            }
            columns={[
              {
                key: 'source',
                label: t(($) => $.columns.from),
                text: true,
                render: (r) => (r.source === null ? UNKNOWN : names.entity(r.source)),
                sort: (r) => names.entity(r.source),
              },
              {
                key: 'skill',
                label: t(($) => $.columns.skill),
                text: true,
                render: (r) => <SkillLabel id={r.skill}>{names.skill(r.skill)}</SkillLabel>,
                sort: (r) => names.skill(r.skill),
              },
              {
                key: 'amount',
                label: t(($) => $.columns.damage),
                render: (r) => fmt.number.format(r.amount),
                sort: (r) => r.amount,
              },
              {
                key: 'hits',
                label: t(($) => $.columns.hits),
                render: (r) => fmt.number.format(r.hits),
                sort: (r) => r.hits,
              },
              {
                key: 'max',
                label: t(($) => $.columns.biggest),
                render: (r) => fmt.number.format(r.max),
                sort: (r) => r.max,
              },
              {
                key: 'share',
                label: t(($) => $.columns.share),
                render: (r) =>
                  fmt.pct(
                    rate(
                      r.amount,
                      rows.reduce((s, x) => s + x.amount, 0),
                    ),
                  ),
                sort: (r) => r.amount,
              },
            ]}
          />
          {sameId(selected.id, player?.id) ? null : (
            <Note className="mt-2">{t(($) => $.taken.mostHit)}</Note>
          )}
        </DetailSection>
      )}
    </ViewStack>
  );
}

/** The selected player's breakdown below a table: a hairline, not another box. */
function DetailSection({
  player,
  label,
  actions,
  children,
}: {
  player: ReportPlayer;
  label?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line-soft pt-5" aria-label={label}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <h3 className="m-0 text-md">
          <PlayerName player={player} />
        </h3>
        {actions && <span className="flex flex-wrap items-center gap-1">{actions}</span>}
      </header>
      {children}
    </section>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-x-10 gap-y-6">
      {children}
    </div>
  );
}
