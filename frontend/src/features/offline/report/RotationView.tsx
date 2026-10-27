import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Chip } from '../../../components/ui/Chip';
import { KeyValueList, Meter, Swatch } from '../../../components/ui/Data';
import { EmptyState } from '../../../components/ui/Feedback';
import { SkillIcon, SkillLabel } from '../../../components/ui/GameArt';
import { Icon } from '../../../components/ui/Icon';
import { Pressable } from '../../../components/ui/Pressable';
import { SortTable } from '../../../components/ui/Table';
import { cn } from '../../../lib/cn';
import { UNKNOWN } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { seriesColors } from '../../../lib/format';
import { castDetail, castsFor, key, opener, type ActiveEffect, type Cast } from '../analysis';
import { useReport } from './context';
import { Note, SubHeading, ViewStack, ViewTools } from './parts';
import { PlayerSelect } from './PlayerViews';
import { TimeRange } from './TimeRange';

/** Stable hue per skill so a skill reads the same across lane, opener and list. */
export function skillColor(id: string | number) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return seriesColors[Math.abs(h) % seriesColors.length] ?? seriesColors[0];
}

const abbreviation = (name: string) =>
  name
    .replace(/#\d+/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

const SCOPES: readonly ActiveEffect['scope'][] = ['self', 'party', 'target', 'other'];

export function RotationView() {
  const { report, player, names, window, setWindow, total, observed } = useReport();
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const tenths = fmt.numberWith({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const casts = useMemo(() => (player ? castsFor(report, player.id) : []), [report, player]);
  const visible = useMemo(
    () =>
      casts
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => c.at_ms >= window.from && c.at_ms <= window.to),
    [casts, window],
  );
  // Selection belongs to one player; switching players starts with nothing selected.
  const [selection, setSelection] = useState<{ player: string; index: number } | null>(null);
  const selected =
    selection && player && selection.player === key(player.id) ? selection.index : null;
  const setSelected = (index: number) => {
    if (player) setSelection({ player: key(player.id), index });
  };
  const detail = useMemo(
    () =>
      player && selected !== null ? castDetail(report, casts, selected, player.id, names) : null,
    [report, casts, selected, player, names],
  );
  const open = useMemo(() => opener(casts), [casts]);
  // A truncated live timeline does not contain the real first casts.
  const truncated = report.events_truncated && (report.event_window_start_ms ?? 0) > 0;

  if (!player)
    return (
      <EmptyState title={t(($) => $.skills.noPlayers)} icon={<Icon name="sprout" size={20} />} />
    );
  if (!casts.length)
    return (
      <ViewStack>
        <ViewTools>
          <PlayerSelect />
        </ViewTools>
        <EmptyState title={t(($) => $.rotation.emptyTitle)} icon={<Icon name="sprout" size={20} />}>
          {t(($) => $.rotation.emptyBody)}
        </EmptyState>
      </ViewStack>
    );
  const verified = casts.filter((c) => !c.fromHits).length;
  const inferred = casts.length - verified;
  const span = Math.max(1, window.to - window.from);
  const select = (index: number) => {
    setSelected(index);
    const cast = casts[index];
    if (cast && (cast.at_ms < window.from || cast.at_ms > window.to)) {
      const width = window.to - window.from;
      setWindow({
        from: Math.max(0, cast.at_ms - width / 2),
        to: Math.max(0, cast.at_ms - width / 2) + width,
      });
    }
  };
  const name = (c: Cast) => names.skill(c.skill);
  const visibleRows = visible.slice(0, 400);
  const position = {
    index: fmt.integer.format((selected ?? 0) + 1),
    total: fmt.integer.format(casts.length),
    time: detail ? fmt.preciseClock(detail.cast.at_ms) : '',
  };

  return (
    <ViewStack>
      <ViewTools>
        <PlayerSelect />
        <span className="text-xs text-ink-3">
          {[
            t(($) => $.rotation.observedCasts, { count: verified }),
            inferred > 0 && t(($) => $.rotation.sequenceEntries, { count: inferred }),
            t(($) => $.rotation.skillCount, {
              count: new Set(casts.map((c) => key(c.skill))).size,
            }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </ViewTools>
      {inferred > 0 && (
        <Note>
          {observed('casts') === false
            ? t(($) => $.rotation.inferredNoPackets)
            : t(($) => $.rotation.inferredSome)}
        </Note>
      )}
      <section aria-label={t(($) => $.rotation.opener)}>
        {truncated ? (
          <>
            <SubHeading>{t(($) => $.rotation.openerUnavailable)}</SubHeading>
            <Note>
              {t(($) => $.rotation.openerTruncated, {
                start: fmt.preciseClock(report.event_window_start_ms ?? 0),
              })}
            </Note>
          </>
        ) : (
          <SubHeading>
            {t(($) => $.rotation.openerFirst, {
              seconds: fmt.integer.format(
                Math.round(((open.at(-1)?.at_ms ?? 0) - (open[0]?.at_ms ?? 0)) / 1000),
              ),
            })}
          </SubHeading>
        )}
        {!truncated && (
          <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {open.map((c, i) => (
              <li key={i}>
                <Chip
                  className="h-8 gap-2 pr-3 pl-1"
                  pressed={selected === i}
                  onClick={() => select(i)}
                  title={`${name(c)} · ${fmt.preciseClock(c.at_ms)}`}
                  icon={<SkillGlyph skill={c.skill} name={name(c)} />}
                >
                  {name(c)}
                  <small className="text-2xs text-ink-3 tabular-nums">
                    {t(($) => $.rotation.after, {
                      seconds: tenths.format((c.at_ms - (open[0]?.at_ms ?? 0)) / 1000),
                    })}
                  </small>
                </Chip>
              </li>
            ))}
          </ol>
        )}
      </section>
      <TimeRange
        total={total}
        window={window}
        onChange={setWindow}
        marks={casts.map((c) => ({ at: c.at_ms, kind: 'cast' as const, label: name(c) }))}
      />
      {/* The casts hang on one vine across the window, like beads on a stem. */}
      <fieldset
        className={cn(
          'relative m-0 h-12 overflow-hidden rounded-full border border-line-soft bg-sunken p-0 inset-shadow-well',
          'bg-[repeating-linear-gradient(90deg,transparent_0_calc(10%-1px),var(--color-line-soft)_calc(10%-1px)_10%)]',
        )}
      >
        <legend className="sr-only">{t(($) => $.rotation.lane)}</legend>
        <span aria-hidden="true" className="absolute inset-x-4 top-1/2 h-px bg-line-strong" />
        <div className="absolute inset-y-0 right-4 left-4">
          {visible.map(({ c, index }) => (
            <Pressable
              key={index}
              data-inferred={c.fromHits || undefined}
              className={cn(
                'absolute top-1/2 -ml-3 flex size-6 -translate-y-1/2 items-center justify-center overflow-hidden rounded-md',
                'border-2 border-sunken text-2xs font-bold text-ink text-halo',
                'transition-[scale,box-shadow,border-color] duration-200 ease-spring hover:z-[2] hover:scale-115',
                'data-inferred:border-dashed data-inferred:border-ink-3 data-inferred:opacity-75',
                'aria-pressed:z-[1] aria-pressed:scale-115 aria-pressed:border-ink aria-pressed:shadow-glow',
              )}
              style={{
                left: `${((c.at_ms - window.from) / span) * 100}%`,
                background: skillColor(c.skill),
              }}
              aria-pressed={selected === index}
              title={`${name(c)} · ${fmt.preciseClock(c.at_ms)}`}
              onClick={() => select(index)}
            >
              <SkillIcon
                id={c.skill}
                size={20}
                className="absolute inset-0 size-full rounded-[inherit]"
                fallback={abbreviation(name(c))}
              />
            </Pressable>
          ))}
        </div>
        {!visible.length && (
          <span className="relative grid h-full place-items-center text-xs text-ink-3">
            {t(($) => $.rotation.noneInWindow)}
          </span>
        )}
      </fieldset>
      <div className="@container">
        <div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1.2fr)_minmax(17rem,1fr)]">
          <div className="min-w-0">
            <SortTable
              dense
              label={t(($) => $.rotation.list)}
              className="max-h-110 overflow-auto"
              rows={visibleRows}
              rowKey={({ index }) => String(index)}
              selected={selected === null ? null : String(selected)}
              onSelect={({ index }) => select(index)}
              columns={[
                { key: 'n', label: '#', render: ({ index }) => fmt.integer.format(index + 1) },
                {
                  key: 'time',
                  label: t(($) => $.rotation.time),
                  text: true,
                  render: ({ c }) => fmt.preciseClock(c.at_ms),
                },
                {
                  key: 'skill',
                  label: t(($) => $.columns.skill),
                  text: true,
                  render: ({ c }) => (
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Swatch color={skillColor(c.skill)} />
                      <SkillLabel id={c.skill}>{name(c)}</SkillLabel>
                      {c.fromHits && (
                        <Badge
                          shape="tag"
                          variant="outline"
                          className="border-dashed font-medium text-ink-3"
                          title={t(($) => $.rotation.hitTitle)}
                        >
                          {t(($) => $.rotation.hit)}
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'gap',
                  label: t(($) => $.rotation.gap),
                  render: ({ c, index }) =>
                    index > 0
                      ? fmt.seconds(c.at_ms - (casts[index - 1]?.at_ms ?? c.at_ms))
                      : UNKNOWN,
                },
              ]}
            />
            {visible.length > 400 && (
              <Note className="mt-2">
                {t(($) => $.rotation.listLimited, { shown: fmt.integer.format(400) })}
              </Note>
            )}
          </div>
          <aside
            className="rounded-lg border border-line-soft bg-surface-2 p-4 @3xl:sticky @3xl:top-28"
            aria-label={t(($) => $.rotation.detail)}
            aria-live="polite"
          >
            {detail ? (
              <>
                <header className="mb-4 flex items-center gap-3">
                  <SkillGlyph skill={detail.cast.skill} name={name(detail.cast)} large />
                  <div className="min-w-0">
                    <h4 className="m-0 truncate text-md font-semibold text-ink">
                      {name(detail.cast)}
                    </h4>
                    <span className="text-xs text-ink-3 tabular-nums">
                      {detail.cast.fromHits
                        ? t(($) => $.rotation.entryOf, position)
                        : t(($) => $.rotation.castOf, position)}
                    </span>
                  </div>
                  <span className="ml-auto flex gap-0.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label={t(($) => $.rotation.previous)}
                      disabled={!selected}
                      onClick={() => select((selected ?? 1) - 1)}
                    >
                      <Icon name="chevronLeft" size={14} />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label={t(($) => $.rotation.next)}
                      disabled={selected === null || selected >= casts.length - 1}
                      onClick={() => select((selected ?? -1) + 1)}
                    >
                      <Icon name="chevronRight" size={14} />
                    </Button>
                  </span>
                </header>
                <KeyValueList
                  className="mb-4"
                  items={[
                    {
                      label: t(($) => $.skills.target),
                      value:
                        detail.cast.target !== null
                          ? names.entity(detail.cast.target)
                          : detail.hits[0]?.target !== null && detail.hits[0]?.target !== undefined
                            ? names.entity(detail.hits[0].target)
                            : UNKNOWN,
                    },
                    {
                      label: t(($) => $.columns.damage),
                      value: detail.hits.length ? fmt.number.format(detail.damage) : UNKNOWN,
                    },
                    detail.healing > 0 && {
                      label: t(($) => $.columns.healing),
                      value: fmt.number.format(detail.healing),
                    },
                    {
                      label: detail.windowEstimated
                        ? t(($) => $.rotation.hitsEstimated)
                        : t(($) => $.columns.hits),
                      title: detail.windowEstimated
                        ? t(($) => $.rotation.hitsEstimatedTitle)
                        : undefined,
                      value:
                        detail.critObserved > 0
                          ? t(($) => $.rotation.hitsCrit, {
                              hits: fmt.integer.format(detail.hits.length),
                              crits: fmt.integer.format(detail.crits),
                              observed: fmt.integer.format(detail.critObserved),
                            })
                          : fmt.integer.format(detail.hits.length),
                    },
                    {
                      label: t(($) => $.rotation.sincePrevious),
                      value: fmt.seconds(detail.gapBeforeMs),
                    },
                    detail.cast.charge !== null && {
                      label: t(($) => $.skills.charge),
                      value: t(($) => $.skills.chargeLevel, { level: detail.cast.charge }),
                    },
                    {
                      label: t(($) => $.boss.targetHp),
                      value: detail.targetHp ? (
                        <span className="inline-flex w-full max-w-48 items-center gap-2">
                          <Meter
                            fraction={detail.targetHp.current / detail.targetHp.max}
                            color="var(--color-rose)"
                            label={t(($) => $.rotation.targetHpAtCast)}
                          />
                          {fmt.pct(detail.targetHp.current / detail.targetHp.max)}
                        </span>
                      ) : (
                        UNKNOWN
                      ),
                    },
                  ]}
                />
                {SCOPES.map((scope) => {
                  const effects = detail.effects.filter((e) => e.scope === scope);
                  if (!effects.length && scope === 'other') return null;
                  return (
                    <section key={scope} className="border-t border-line-soft pt-2.5 pb-1">
                      <h5 className="m-0 mb-1.5 text-xs font-semibold text-ink-2">
                        {t(($) => $.rotation.scope[scope])}{' '}
                        <small className="font-normal text-ink-3 tabular-nums">
                          {fmt.integer.format(effects.length)}
                        </small>
                      </h5>
                      {effects.length ? (
                        <ul className="m-0 mb-2 flex list-none flex-col gap-1 p-0 text-sm">
                          {effects.map((e, i) => (
                            <li key={i} className="flex min-w-0 items-center gap-1.5">
                              <SkillLabel id={e.span.skill}>{names.skill(e.span.skill)}</SkillLabel>
                              {scope !== 'self' && (
                                <small className="text-2xs text-ink-3">
                                  {names.entity(e.span.target)}
                                </small>
                              )}
                              <small className="ml-auto shrink-0 text-2xs text-ink-3 tabular-nums">
                                {e.remainingMs === null
                                  ? t(($) => $.rotation.endNotObserved)
                                  : t(($) => $.rotation.left, {
                                      time: fmt.countdown(e.remainingMs),
                                    })}
                              </small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Note className="mb-2">
                          {observed('buffs') === false
                            ? t(($) => $.rotation.buffsNotObserved)
                            : t(($) => $.rotation.noneActive)}
                        </Note>
                      )}
                    </section>
                  );
                })}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="grid size-10 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent">
                  <Icon name="crosshair" size={18} />
                </span>
                <Note className="max-w-60">{t(($) => $.rotation.selectHint)}</Note>
              </div>
            )}
          </aside>
        </div>
      </div>
    </ViewStack>
  );
}

/** A skill's colour chip with its original icon, or its initials when none is verified. */
function SkillGlyph({
  skill,
  name,
  large = false,
}: {
  skill: string | number;
  name: string;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden font-bold text-ink text-halo',
        large ? 'size-9 rounded-lg text-xs' : 'size-6 rounded-full text-2xs',
      )}
      style={{ background: skillColor(skill) }}
    >
      <SkillIcon
        id={skill}
        size={large ? 36 : 24}
        className="absolute inset-0 size-full rounded-none"
        fallback={abbreviation(name)}
      />
    </span>
  );
}
