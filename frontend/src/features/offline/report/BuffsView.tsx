import { useMemo, useState } from 'react';
import { EmptyState } from '../../../components/ui/Feedback';
import { SkillLabel } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import {
  tableCell,
  tableHead,
  tableRow,
  tableScroll,
  tableSticky,
} from '../../../components/ui/Table';
import { cn } from '../../../lib/cn';
import { useFormat, useTranslation } from '../../../i18n/provider';
import type { BuffSpan } from '../../../types/offline';
import {
  buffLanes,
  buffsPerSkill,
  castsFor,
  key,
  primaryTarget,
  sameId,
  spanEnd,
} from '../analysis';
import { useReport } from './context';
import { InlineSelect, Note, SubHeading, ViewStack, ViewTools } from './parts';
import { PlayerSelect } from './PlayerViews';
import { skillColor } from './RotationView';
import { TimeRange } from './TimeRange';

type Scope = 'self' | 'target' | 'party' | 'all';
const MAX_LANES = 40;
const MATRIX_SKILLS = 14;
const MATRIX_BUFFS = 8;

export function BuffsView() {
  const { report, player, names, window, setWindow, total, observed } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const [scope, setScope] = useState<Scope>('self');
  const [overlay, setOverlay] = useState('');
  const boss = primaryTarget(report);

  const filter = useMemo(() => {
    const id = player?.id;
    const scopes: Record<Scope, (s: BuffSpan) => boolean> = {
      self: (s) => sameId(s.target, id),
      target: (s) => (boss ? sameId(s.target, boss.id) : !names.isPlayer(s.target)),
      party: (s) => names.isPlayer(s.target),
      all: () => true,
    };
    return scopes[scope];
  }, [scope, player, boss, names]);
  const lanes = useMemo(() => buffLanes(report, window, filter), [report, window, filter]);
  const casts = useMemo(
    () =>
      player && overlay
        ? castsFor(report, player.id, window).filter((c) => key(c.skill) === overlay)
        : [],
    [report, player, overlay, window],
  );
  const matrix = useMemo(
    () =>
      player
        ? buffsPerSkill(report, player.id, window.from > 0 || window.to < total ? window : null)
        : [],
    [report, player, window, total],
  );
  const columns = useMemo(() => {
    const best = new Map<
      string,
      { buff: string | number; scope: 'self' | 'target'; score: number }
    >();
    for (const row of matrix)
      for (const b of row.buffs) {
        const id = `${b.scope}:${key(b.buff)}`;
        const score = b.damageShare * row.damage;
        const current = best.get(id);
        best.set(id, { buff: b.buff, scope: b.scope, score: (current?.score ?? 0) + score });
      }
    return [...best.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, MATRIX_BUFFS);
  }, [matrix]);

  if (!report.buffs.length)
    return (
      <EmptyState title={t(($) => $.buffs.emptyTitle)} icon={<Icon name="leaf" size={20} />}>
        {observed('buffs') === false ? t(($) => $.buffs.notObserved) : t(($) => $.buffs.emptyBody)}
      </EmptyState>
    );
  const span = Math.max(1, window.to - window.from);
  const pos = (at: number) =>
    `${((Math.max(window.from, Math.min(window.to, at)) - window.from) / span) * 100}%`;
  const width = (a: number, b: number) =>
    `${((Math.min(window.to, b) - Math.max(window.from, a)) / span) * 100}%`;
  const cell = cn(tableCell, 'px-2 py-1.5');

  return (
    <ViewStack>
      <ViewTools>
        <PlayerSelect />
        <SegmentedControl
          size="sm"
          label={t(($) => $.buffs.scope)}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'self', label: t(($) => $.buffs.onPlayer) },
            {
              value: 'target',
              label: boss
                ? boss.name
                  ? t(($) => $.buffs.onNamed, { name: boss.name })
                  : t(($) => $.buffs.onTarget)
                : t(($) => $.buffs.onTargets),
            },
            { value: 'party', label: t(($) => $.buffs.party) },
            { value: 'all', label: t(($) => $.buffs.all) },
          ]}
        />
        <InlineSelect
          label={t(($) => $.buffs.overlay)}
          value={overlay}
          onChange={(e) => setOverlay(e.target.value)}
        >
          <option value="">{t(($) => $.buffs.overlayNone)}</option>
          {player?.skills
            .filter((s) => s.damage > 0 || s.healing > 0)
            .map((s) => (
              <option key={key(s.id)} value={key(s.id)}>
                {names.skill(s.id, s.name)}
              </option>
            ))}
        </InlineSelect>
      </ViewTools>
      <TimeRange total={total} window={window} onChange={setWindow} />
      <section className="flex flex-col gap-1" aria-label={t(($) => $.buffs.timeline)}>
        {lanes.length ? (
          <>
            {lanes.slice(0, MAX_LANES).map((lane) => (
              <div
                className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]"
                key={lane.key}
              >
                <div
                  className="flex min-w-0 flex-col text-sm leading-tight"
                  title={t(($) => $.buffs.laneTitle, {
                    skill: names.skill(lane.skill),
                    target: names.entity(lane.target),
                  })}
                >
                  <span className="min-w-0 truncate text-ink">
                    <SkillLabel id={lane.skill}>{names.skill(lane.skill)}</SkillLabel>
                  </span>
                  <small className="truncate text-2xs text-ink-3">
                    {scope !== 'self' && <>{names.entity(lane.target)} · </>}
                    {t(($) => $.buffs.uptime, {
                      pct: fmt.pct((lane.uptimeMs + lane.openMs) / span, 0),
                    })}
                    {lane.openMs > 0 && (
                      <abbr className="text-warn no-underline" title={t(($) => $.buffs.openTitle)}>
                        {' '}
                        *
                      </abbr>
                    )}{' '}
                    · {fmt.number.format(lane.applications)}×
                  </small>
                </div>
                {/* A lane is a stem; each application a pod growing along it. */}
                <div className="relative h-5 overflow-hidden rounded-full bg-sunken">
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 top-1/2 h-px bg-line-soft"
                  />
                  {lane.spans.map((s, i) => {
                    const end = spanEnd(s, report);
                    if (end < window.from || s.start_ms > window.to) return null;
                    return (
                      <span
                        key={i}
                        className={cn(
                          'absolute inset-y-[3px] min-w-[3px] origin-left animate-grow',
                          s.end_ms === null
                            ? 'rounded-l-full bg-hatch opacity-65'
                            : 'rounded-full opacity-90',
                        )}
                        style={{
                          left: pos(s.start_ms),
                          width: width(s.start_ms, end),
                          backgroundColor: skillColor(lane.skill),
                        }}
                        title={
                          s.source !== null
                            ? t(($) => $.buffs.spanFrom, {
                                skill: names.skill(lane.skill),
                                start: fmt.preciseClock(s.start_ms),
                                end:
                                  s.end_ms === null
                                    ? t(($) => $.buffs.endNotObserved)
                                    : fmt.preciseClock(s.end_ms),
                                source: names.entity(s.source),
                              })
                            : t(($) => $.buffs.span, {
                                skill: names.skill(lane.skill),
                                start: fmt.preciseClock(s.start_ms),
                                end:
                                  s.end_ms === null
                                    ? t(($) => $.buffs.endNotObserved)
                                    : fmt.preciseClock(s.end_ms),
                              })
                        }
                      />
                    );
                  })}
                  {casts.map((c, i) => (
                    <i
                      key={i}
                      className="absolute inset-y-0 -ml-px w-0.5 bg-ink shadow-[0_0_0_1px_var(--color-canvas)]"
                      style={{ left: pos(c.at_ms) }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
            ))}
            {lanes.length > MAX_LANES && (
              <Note className="mt-1">
                {t(($) => $.buffs.lanesLimited, {
                  shown: fmt.number.format(MAX_LANES),
                  count: lanes.length,
                })}
              </Note>
            )}
            {overlay && (
              <Note className="mt-1 flex items-center gap-2">
                <i
                  className="inline-block h-3 w-0.5 bg-ink shadow-[0_0_0_1px_var(--color-canvas)]"
                  aria-hidden="true"
                />{' '}
                {t(($) => $.buffs.overlayCasts, {
                  count: casts.length,
                  skill: names.skill(overlay),
                })}
              </Note>
            )}
          </>
        ) : (
          <EmptyState
            compact
            title={t(($) => $.buffs.emptyScope)}
            icon={<Icon name="binoculars" size={18} />}
          />
        )}
      </section>
      <section aria-label={t(($) => $.buffs.perSkill)}>
        <SubHeading className="mb-1">{t(($) => $.buffs.perSkill)}</SubHeading>
        <Note className="mb-3 max-w-3xl">{t(($) => $.buffs.perSkillNote)}</Note>
        {matrix.length && columns.length ? (
          <div className={tableScroll}>
            <table data-ui="table" className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr>
                  <th scope="col" className={cn(tableHead, 'left-0 z-[3] px-2 py-1.5 text-left')}>
                    {t(($) => $.columns.skill)}
                  </th>
                  {columns.map(([id, c]) => (
                    <th
                      key={id}
                      scope="col"
                      className={cn(tableHead, 'px-2 py-1.5 text-center')}
                      title={
                        c.scope === 'self'
                          ? t(($) => $.buffs.columnSelf, { buff: names.skill(c.buff) })
                          : t(($) => $.buffs.columnTarget, { buff: names.skill(c.buff) })
                      }
                    >
                      <span className="inline-block max-w-30 truncate align-bottom">
                        {names.skill(c.buff)}
                      </span>
                      <small className="block text-2xs font-normal tracking-normal normal-case">
                        {c.scope === 'self' ? t(($) => $.buffs.self) : t(($) => $.buffs.target)}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.slice(0, MATRIX_SKILLS).map((row) => (
                  <tr key={key(row.skill)} className={tableRow}>
                    <th
                      scope="row"
                      className={cn(cell, tableSticky, 'text-left font-medium text-ink')}
                    >
                      <SkillLabel id={row.skill}>{names.skill(row.skill)}</SkillLabel>
                      <small className="text-2xs font-normal text-ink-3">
                        {' '}
                        · {t(($) => $.buffs.hits, { count: row.hits })}
                      </small>
                    </th>
                    {columns.map(([id, c]) => {
                      const found = row.buffs.find(
                        (b) => b.scope === c.scope && key(b.buff) === key(c.buff),
                      );
                      const value = found?.damageShare ?? 0;
                      return (
                        <td
                          key={id}
                          className={cn(cell, 'min-w-16 text-center', !found && 'text-ink-4')}
                          style={{
                            // Heat as a wash of the first palette colour, deeper with the share.
                            background: `color-mix(in oklab, var(--color-sky) ${Math.round(value * 70)}%, transparent)`,
                          }}
                          title={
                            found
                              ? found.open
                                ? t(($) => $.buffs.cellOpen, {
                                    damage: fmt.pct(found.damageShare),
                                    hits: fmt.pct(found.hitShare),
                                  })
                                : t(($) => $.buffs.cell, {
                                    damage: fmt.pct(found.damageShare),
                                    hits: fmt.pct(found.hitShare),
                                  })
                              : t(($) => $.buffs.never)
                          }
                        >
                          {found ? `${fmt.pct(value, 0)}${found.open ? ' *' : ''}` : '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            compact
            title={t(($) => $.buffs.noOverlapTitle)}
            icon={<Icon name="binoculars" size={18} />}
          >
            {t(($) => $.buffs.noOverlapBody)}
          </EmptyState>
        )}
      </section>
    </ViewStack>
  );
}
