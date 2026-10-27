import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/Feedback';
import { SkillLabel } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { SortTable, type Column } from '../../../components/ui/Table';
import { UNKNOWN, type Formatters } from '../../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../../i18n/provider';
import type { SkillCharge, SkillSpecialty } from '../../../types/offline';
import {
  critRate,
  flagRate,
  key,
  multiRate,
  skillRowsFromPlayer,
  skillStatsFromEvents,
  type PositionalFlag,
  type SkillRow,
} from '../analysis';
import { useReport } from './context';
import { InlineSelect, Note, ShareCell, ViewStack, ViewTools } from './parts';
import { CastCount, PlayerSelect } from './PlayerViews';
import { TimeRange } from './TimeRange';

function chargeText(t: Translate<'reports'>, fmt: Formatters, charge: SkillCharge | null) {
  if (charge === null) return UNKNOWN;
  if (typeof charge === 'number') return t(($) => $.skills.chargeLevel, { level: charge });
  return Object.entries(charge)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, count]) =>
      t(($) => $.skills.chargeLevelCount, { level, times: fmt.number.format(count) }),
    )
    .join(' ');
}

function Specialties({ items }: { items: SkillSpecialty[] }) {
  const { t } = useTranslation('reports');
  if (!items.length) return null;
  return (
    <span className="inline-flex gap-1">
      {items.map((s, i) => (
        <Badge
          key={i}
          shape="tag"
          variant="outline"
          className="border-iris-ink/45 font-medium text-iris-ink"
          title={[
            s.name,
            s.description,
            s.count !== null ? t(($) => $.skills.uses, { count: s.count }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {s.slot !== null ? `S${s.slot}` : ''}
          {s.name ? `${s.slot !== null ? ' ' : ''}${s.name}` : ''}
        </Badge>
      ))}
    </span>
  );
}

export function SkillsView() {
  const ctx = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { report, player, names, window, setWindow, total } = ctx;
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<'damage' | 'heal'>('damage');
  const windowed = window.from > 0 || window.to < total;
  const filtered = windowed || target !== '';
  const rows = useMemo<SkillRow[]>(() => {
    if (!player) return [];
    if (!filtered) return skillRowsFromPlayer(player, kind);
    const id = target ? (player.targets.find((x) => key(x.id) === target)?.id ?? null) : null;
    return skillStatsFromEvents(
      report,
      { source: player.id, target: id, window: windowed ? window : null, kind },
      names,
    ).map((row) => {
      // Specialties and names come from the native catalogue rows.
      const native = player.skills.find((s) => key(s.id) === key(row.id));
      return native ? { ...row, name: native.name, specialties: native.specialties } : row;
    });
  }, [player, filtered, target, kind, report, window, windowed, names]);

  if (!player)
    return (
      <EmptyState title={t(($) => $.skills.noPlayers)} icon={<Icon name="sprout" size={20} />} />
    );
  const flags = player.flags_observed !== null || rows.some((r) => r.flags_observed);
  const flagColumn = (flag: PositionalFlag): Column<SkillRow> => ({
    key: flag,
    label: t(($) => $.skills.flag[flag]),
    title: t(($) => $.skills.flagTitle[flag]),
    render: (r) => fmt.pct(flagRate(r, flag)),
    sort: (r) => flagRate(r, flag),
  });
  const value = (r: SkillRow) => (kind === 'damage' ? r.damage : r.healing);
  const span = Math.max(0.001, (windowed ? window.to - window.from : report.duration_ms) / 1000);

  const columns: Column<SkillRow>[] = [
    {
      key: 'skill',
      label: t(($) => $.columns.skill),
      text: true,
      sticky: true,
      render: (r) => (
        <span className="inline-flex max-w-80 min-w-0 items-center gap-1.5">
          <SkillLabel id={r.id}>{names.skill(r.id, r.name)}</SkillLabel>
          <Specialties items={r.specialties} />
        </span>
      ),
      sort: (r) => names.skill(r.id, r.name),
    },
    {
      key: 'value',
      label: kind === 'damage' ? t(($) => $.columns.damage) : t(($) => $.columns.healing),
      render: (r) => fmt.number.format(value(r)),
      sort: value,
    },
    {
      key: 'share',
      label: t(($) => $.columns.share),
      render: (r) => (
        <ShareCell
          fraction={r.share}
          color={ctx.colorOf(player)}
          label={t(($) => $.player.shareMeter, { name: names.skill(r.id, r.name) })}
        >
          {fmt.pct(r.share)}
        </ShareCell>
      ),
      sort: (r) => r.share,
    },
    {
      key: 'ps',
      label: kind === 'damage' ? 'DPS' : 'HPS',
      render: (r) => fmt.number.format(value(r) / span),
      sort: value,
    },
    {
      key: 'casts',
      label: t(($) => $.columns.casts),
      title: t(($) => $.skills.castsTitle),
      render: (r) => <CastCount casts={r.casts} inferred={r.inferred_casts} />,
      sort: (r) => r.casts,
    },
    {
      key: 'hits',
      label: t(($) => $.columns.hits),
      title: t(($) => $.skills.hitsTitle),
      render: (r) => fmt.maybe(r.hits),
      sort: (r) => r.hits,
    },
    {
      key: 'direct',
      label: t(($) => $.skills.direct),
      title: t(($) => $.skills.directTitle),
      render: (r) => fmt.maybe(r.direct_hits),
      sort: (r) => r.direct_hits,
    },
    {
      key: 'crit',
      label: t(($) => $.columns.crit),
      title: t(($) => $.damage.critTitle),
      render: (r) => fmt.pct(critRate(r)),
      sort: critRate,
    },
    flagColumn('back'),
    flagColumn('front'),
    flagColumn('perfect'),
    flagColumn('double'),
    flagColumn('parry'),
    {
      key: 'multi',
      label: t(($) => $.skills.multi),
      title: t(($) => $.skills.multiTitle),
      render: (r) => fmt.pct(multiRate(r)),
      sort: multiRate,
    },
    {
      key: 'min',
      label: t(($) => $.skills.min),
      render: (r) => fmt.maybe(r.min),
      sort: (r) => r.min,
    },
    {
      key: 'avg',
      label: t(($) => $.columns.avg),
      render: (r) => fmt.maybe(r.avg),
      sort: (r) => r.avg,
    },
    {
      key: 'max',
      label: t(($) => $.skills.max),
      render: (r) => (r.hits ? fmt.maybe(r.max) : UNKNOWN),
      sort: (r) => (r.hits ? r.max : null),
    },
    {
      key: 'gap',
      label: t(($) => $.skills.gap),
      title: t(($) => $.skills.gapTitle),
      render: (r) => fmt.seconds(r.cast_gap_ms),
      sort: (r) => r.cast_gap_ms,
    },
    {
      key: 'charge',
      label: t(($) => $.skills.charge),
      title: t(($) => $.skills.chargeTitle),
      text: true,
      render: (r) => chargeText(t, fmt, r.charge),
    },
  ];

  return (
    <ViewStack>
      <ViewTools>
        <PlayerSelect />
        <InlineSelect
          label={t(($) => $.skills.target)}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">{t(($) => $.skills.allTargets)}</option>
          {player.targets
            .filter((x) => x.damage > 0 || x.healing > 0)
            .map((x) => (
              <option key={key(x.id)} value={key(x.id)}>
                {x.name ?? names.entity(x.id)}
              </option>
            ))}
        </InlineSelect>
        <SegmentedControl
          size="sm"
          label={t(($) => $.skills.kind)}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'damage', label: t(($) => $.columns.damage) },
            {
              value: 'heal',
              label: t(($) => $.columns.healing),
              disabled: player.healing <= 0,
            },
          ]}
        />
        <Badge
          shape="tag"
          variant="outline"
          className={filtered ? 'border-dashed text-ink-3' : undefined}
          title={filtered ? t(($) => $.skills.fromEventsTitle) : t(($) => $.skills.totalsTitle)}
        >
          {filtered ? t(($) => $.skills.fromEvents) : t(($) => $.skills.totals)}
        </Badge>
      </ViewTools>
      <TimeRange total={total} window={window} onChange={setWindow} />
      {!flags && <Note>{t(($) => $.skills.noFlags)}</Note>}
      <SortTable
        label={t(($) => $.skills.table, { name: names.entity(player.id) })}
        columns={columns}
        rows={rows}
        rowKey={(r) => key(r.id)}
        initialSort={{ key: 'value', desc: true }}
        empty={
          <EmptyState
            compact
            title={t(($) => $.skills.emptyTitle)}
            icon={<Icon name="binoculars" size={18} />}
          >
            {t(($) => $.skills.emptyBody)}
          </EmptyState>
        }
      />
    </ViewStack>
  );
}
