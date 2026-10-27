import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/Feedback';
import { Checkbox, Select } from '../../../components/ui/Field';
import { SkillLabel } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { tableCell, tableHead, tableRow, tableScroll } from '../../../components/ui/Table';
import { cn } from '../../../lib/cn';
import { useFormat, useTranslation, type Translate } from '../../../i18n/provider';
import { seriesColors } from '../../../lib/format';
import type { ReportEvent } from '../../../types/offline';
import { damageSeries, hpSeries, key, primaryTarget, sameId } from '../analysis';
import { LineChart, type ChartMarker } from './charts';
import { useReport } from './context';
import { InlineSelect, Note, SubHeading, ViewStack, ViewTools } from './parts';
import { TimeRange } from './TimeRange';

const KINDS = [
  'damage',
  'heal',
  'cast',
  'buff',
  'buff_end',
  'hp',
  'death',
  'revive',
  'spawn',
  'zone',
  'reset',
  'position',
];
const DEFAULT_KINDS = ['damage', 'heal', 'cast', 'buff', 'death', 'revive'];
const COLUMNS = ['time', 'kind', 'source', 'target', 'skill', 'amount', 'flags'] as const;
const PAGE = 200;

const FLAGS = ['critical', 'back', 'front', 'perfect', 'double', 'parry', 'tick'] as const;

const KIND_KEYS = {
  damage: 'damage',
  heal: 'heal',
  cast: 'cast',
  buff: 'buff',
  buff_end: 'buffEnd',
  hp: 'hp',
  death: 'death',
  revive: 'revive',
  spawn: 'spawn',
  zone: 'zone',
  reset: 'reset',
  position: 'position',
} as const;

/** An event kind's name; an unknown kind is shown from its wire name. */
function kindLabel(t: Translate<'reports'>, kind: string) {
  const id = Object.hasOwn(KIND_KEYS, kind) ? KIND_KEYS[kind as keyof typeof KIND_KEYS] : null;
  return id ? t(($) => $.timeline.kind[id]) : kind.replace('_', ' ');
}
/** Event kinds take their hue from the nature palette; the word always rides along. */ const KIND_TONES: Record<
  string,
  string
> = {
  damage: 'border-transparent bg-sky/16 text-sky-ink',
  heal: 'border-transparent bg-jade/18 text-jade-ink',
  cast: 'border-transparent bg-iris/18 text-iris-ink',
  buff: 'border-transparent bg-pollen/16 text-pollen-ink',
  buff_end: 'border-transparent bg-pollen/10 text-pollen-ink',
  death: 'border-transparent bg-danger-soft text-danger',
  revive: 'border-transparent bg-success-soft text-success',
};

export function TimelineView({ focus }: { focus: { at: number; seq: number } | null }) {
  const { report, names, window, setWindow, total, observed, players } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const boss = primaryTarget(report);
  const hpEntities = useMemo(() => {
    const ids = new Map<string, string | number>();
    for (const s of report.hp) ids.set(key(s.entity), s.entity);
    return [...ids.values()];
  }, [report.hp]);
  const [hpEntity, setHpEntity] = useState('');
  const effectiveHp =
    hpEntity ||
    (boss && hpEntities.some((id) => sameId(id, boss.id)) ? key(boss.id) : key(hpEntities[0]));
  const [dpsSource, setDpsSource] = useState('');
  const [kinds, setKinds] = useState<string[]>(DEFAULT_KINDS);
  const [who, setWho] = useState('');
  const [critsOnly, setCritsOnly] = useState(false);
  const [pageState, setPageState] = useState({ filter: '', page: 0 });
  // A cursor picked here wins until another view focuses a new moment.
  const [picked, setPicked] = useState<{ seq: number; at: number } | null>(null);
  const cursor = picked && picked.seq === (focus?.seq ?? 0) ? picked.at : (focus?.at ?? null);
  const setCursor = (at: number) => setPicked({ seq: focus?.seq ?? 0, at });

  const markers = useMemo<ChartMarker[]>(() => {
    const list: ChartMarker[] = report.events
      .filter((e) => e.kind === 'death' || e.kind === 'revive')
      .map((e) => ({
        at: e.at_ms,
        kind: e.kind as 'death' | 'revive',
        label:
          e.kind === 'death'
            ? t(($) => $.timeline.died, { name: names.entity(e.target ?? e.source) })
            : t(($) => $.timeline.revived, { name: names.entity(e.target ?? e.source) }),
      }));
    if (cursor !== null)
      list.push({ at: cursor, kind: 'selected', label: t(($) => $.timeline.selected) });
    return list;
  }, [report.events, names, cursor, t]);

  const hp = useMemo(
    () =>
      effectiveHp
        ? hpSeries(report, effectiveHp).map((s) => ({ t: s.at_ms, v: (s.current / s.max) * 100 }))
        : [],
    [report, effectiveHp],
  );
  const dps = useMemo(() => {
    const source = dpsSource ? (players.find((p) => key(p.id) === dpsSource)?.id ?? null) : null;
    return damageSeries(report, 1000, source).map((v, i) => ({ t: i * 1000 + 500, v }));
  }, [report, dpsSource, players]);

  const events = useMemo(
    () =>
      report.events.filter(
        (e) =>
          kinds.includes(e.kind) &&
          e.at_ms >= window.from &&
          e.at_ms <= window.to &&
          (!who || sameId(e.source, who) || sameId(e.target, who)) &&
          (!critsOnly || e.critical === true),
      ),
    [report.events, kinds, window, who, critsOnly],
  );
  const pages = Math.max(1, Math.ceil(events.length / PAGE));
  // Changing any filter returns to the first page.
  const filterKey = `${kinds.join()}|${window.from}|${window.to}|${who}|${critsOnly}`;
  const page = pageState.filter === filterKey ? Math.min(pageState.page, pages - 1) : 0;
  const setPage = (next: number) => setPageState({ filter: filterKey, page: next });

  const deaths = report.events.filter((e) => e.kind === 'death').map((e) => e.at_ms);
  const jump = (direction: 1 | -1) => {
    const ref = cursor ?? (direction > 0 ? window.from - 1 : window.to + 1);
    const at =
      direction > 0 ? deaths.find((d) => d > ref) : [...deaths].reverse().find((d) => d < ref);
    if (at === undefined) return;
    setCursor(at);
    const width = window.to - window.from;
    const from = Math.max(0, Math.min(total - width, at - width / 2));
    setWindow({ from, to: from + width });
  };
  const toggleKind = (kind: string) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );

  return (
    <ViewStack>
      <TimeRange
        total={total}
        window={window}
        onChange={setWindow}
        marks={deaths.map((at) => ({
          at,
          kind: 'death' as const,
          label: t(($) => $.timeline.death),
        }))}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-x-8 gap-y-6">
        <section aria-label={t(($) => $.timeline.hpOverTime)}>
          <header className="mb-2 flex items-center justify-between gap-2">
            <SubHeading className="mb-0">HP</SubHeading>
            {hpEntities.length > 0 && (
              <Select
                size="sm"
                aria-label={t(($) => $.timeline.hpOf)}
                wrapperClassName="max-w-52"
                value={effectiveHp}
                onChange={(e) => setHpEntity(e.target.value)}
              >
                {hpEntities.map((id) => (
                  <option key={key(id)} value={key(id)}>
                    {names.entity(id)}
                  </option>
                ))}
              </Select>
            )}
          </header>
          {hp.length ? (
            <LineChart
              label={t(($) => $.timeline.hpChart, { name: names.entity(effectiveHp) })}
              points={hp}
              window={window}
              color={seriesColors[7]}
              yMax={100}
              step
              formatValue={(v) => fmt.pct(v / 100, 0)}
              markers={markers}
            />
          ) : (
            <EmptyState
              compact
              title={t(($) => $.timeline.noHpTitle)}
              icon={<Icon name="activity" size={18} />}
            >
              {observed('hp') === false
                ? t(($) => $.timeline.hpNotObserved)
                : t(($) => $.timeline.noHpBody)}
            </EmptyState>
          )}
        </section>
        <section aria-label={t(($) => $.timeline.dpsOverTime)}>
          <header className="mb-2 flex items-center justify-between gap-2">
            <SubHeading className="mb-0">{t(($) => $.timeline.dps)}</SubHeading>
            <Select
              size="sm"
              aria-label={t(($) => $.timeline.damageOf)}
              wrapperClassName="max-w-52"
              value={dpsSource}
              onChange={(e) => setDpsSource(e.target.value)}
            >
              <option value="">{t(($) => $.timeline.allPlayers)}</option>
              {players.map((p) => (
                <option key={key(p.id)} value={key(p.id)}>
                  {names.entity(p.id)}
                </option>
              ))}
            </Select>
          </header>
          <LineChart
            label={t(($) => $.timeline.dpsOverTime)}
            points={dps}
            window={window}
            color={seriesColors[0]}
            markers={markers}
          />
        </section>
      </div>
      <section aria-label={t(($) => $.timeline.eventLog)} className="flex flex-col gap-2.5">
        <ViewTools>
          <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
            <legend className="sr-only">{t(($) => $.timeline.kinds)}</legend>
            {KINDS.filter((k) => k === 'damage' || report.events.some((e) => e.kind === k)).map(
              (kind) => (
                <Chip
                  key={kind}
                  size="xs"
                  pressed={kinds.includes(kind)}
                  onPressedChange={() => toggleKind(kind)}
                >
                  {kindLabel(t, kind)}
                </Chip>
              ),
            )}
          </fieldset>
          <InlineSelect
            label={t(($) => $.timeline.involving)}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">{t(($) => $.timeline.anyone)}</option>
            {players.map((p) => (
              <option key={key(p.id)} value={key(p.id)}>
                {names.entity(p.id)}
              </option>
            ))}
            {report.targets.map((target) => (
              <option key={`t${key(target.id)}`} value={key(target.id)}>
                {names.entity(target.id)}
              </option>
            ))}
          </InlineSelect>
          <Checkbox
            label={t(($) => $.timeline.critsOnly)}
            checked={critsOnly}
            onCheckedChange={(checked) => setCritsOnly(checked)}
          />
          <span className="ml-auto flex gap-1">
            <Button
              size="xs"
              disabled={!deaths.length}
              icon={<Icon name="chevronLeft" size={13} />}
              onClick={() => jump(-1)}
              title={t(($) => $.timeline.previousDeath)}
            >
              {t(($) => $.timeline.death)}
            </Button>
            <Button
              size="xs"
              disabled={!deaths.length}
              onClick={() => jump(1)}
              title={t(($) => $.timeline.nextDeath)}
            >
              {t(($) => $.timeline.death)} <Icon name="chevronRight" size={13} />
            </Button>
          </span>
        </ViewTools>
        <Note>
          {pages > 1
            ? t(($) => $.timeline.eventsPaged, {
                count: events.length,
                page: fmt.integer.format(page + 1),
                pages: fmt.integer.format(pages),
              })
            : t(($) => $.timeline.events, { count: events.length })}
        </Note>
        <div className={cn(tableScroll, 'max-h-115 overflow-auto')}>
          <table
            data-ui="table"
            className="w-full border-collapse text-sm tabular-nums"
            aria-label={t(($) => $.timeline.eventsTable)}
          >
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      tableHead,
                      'px-2 py-1.5',
                      column === 'amount' ? 'text-right' : 'text-left',
                    )}
                  >
                    {t(($) => $.timeline.column[column])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events
                .slice(page * PAGE, page * PAGE + PAGE)
                .map((e, i) => eventRow(e, `${e.at_ms}-${i}`))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-xs text-ink-3 tabular-nums">
            <Button size="xs" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t(($) => $.timeline.previous)}
            </Button>
            <span>
              {fmt.integer.format(page + 1)} / {fmt.integer.format(pages)}
            </span>
            <Button size="xs" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              {t(($) => $.timeline.next)}
            </Button>
          </div>
        )}
      </section>
    </ViewStack>
  );

  function eventRow(e: ReportEvent, rowKey: string) {
    const selected = cursor === e.at_ms;
    const amount =
      e.kind === 'hp' && e.current_hp != null
        ? e.max_hp
          ? `${fmt.compact.format(e.current_hp)} (${fmt.pct(e.current_hp / e.max_hp, 0)})`
          : fmt.compact.format(e.current_hp)
        : e.amount != null && e.amount > 0
          ? fmt.number.format(e.amount)
          : e.duration_ms != null
            ? t(($) => $.timeline.duration, {
                seconds: fmt
                  .numberWith({ minimumFractionDigits: 1, maximumFractionDigits: 1 })
                  .format(e.duration_ms / 1000),
              })
            : '';
    const cell = cn(tableCell, 'px-2 py-1.5 text-left');
    return (
      <tr
        key={rowKey}
        data-selected={selected || undefined}
        className={cn(tableRow, 'cursor-pointer', selected && 'bg-row-selected')}
        onClick={() => setCursor(e.at_ms)}
      >
        <td className={cn(cell, selected && 'shadow-[inset_2px_0_0_var(--color-accent)]')}>
          {fmt.preciseClock(e.at_ms)}
        </td>
        <td className={cell}>
          <Badge shape="tag" className={cn('min-w-14 justify-center', KIND_TONES[e.kind])}>
            {kindLabel(t, e.kind)}
          </Badge>
        </td>
        <td className={cell}>{e.source != null ? names.entity(e.source) : ''}</td>
        <td className={cell}>{e.target != null ? names.entity(e.target) : ''}</td>
        <td className={cell}>
          {e.skill != null ? <SkillLabel id={e.skill}>{names.skill(e.skill)}</SkillLabel> : ''}
        </td>
        <td className={cn(cell, 'text-right')}>{amount}</td>
        <td className={cell}>
          <span className="inline-flex gap-1">
            {FLAGS.filter((flag) => e[flag] === true).map((flag) => (
              <Badge
                key={flag}
                shape="tag"
                variant="outline"
                tone={flag === 'critical' ? 'warn' : 'neutral'}
              >
                {t(($) => $.timeline.flag[flag])}
              </Badge>
            ))}
            {(e.hit_count ?? 1) > 1 && (
              <Badge shape="tag" variant="outline">
                ×{fmt.integer.format(e.hit_count ?? 1)}
              </Badge>
            )}
          </span>
        </td>
      </tr>
    );
  }
}
