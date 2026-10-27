import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox, Input, SearchInput, Select } from '../../components/ui/Field';
import { ClassLabel } from '../../components/ui/GameArt';
import { UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { ClassName, Comparison, ComparisonSide, memberRow } from './GroupIcons';
import type { GroupInspectionData } from './model';

interface Props {
  captureId: number;
  inspections: GroupInspectionData[];
  running: boolean;
}

/** Applicants whose profile was opened in game: search, user minimum GS and a two-way compare. */
export function InspectedProfiles({ captureId, inspections: all, running }: Props) {
  const { t } = useTranslation('group');
  const fmt = useFormat();
  const [search, setSearch] = useState('');
  const [minimum, setMinimum] = useState(0);
  const [sort, setSort] = useState('recent');
  const [dismissed, setDismissed] = useState({ capture: 0, through: 0 });
  const [selection, setSelection] = useState<{ capture: number; ids: number[] }>({
    capture: 0,
    ids: [],
  });
  const selected = selection.capture === captureId ? selection.ids : [];
  const inspections = useMemo(
    () =>
      all.filter((profile) => captureId !== dismissed.capture || profile.id > dismissed.through),
    [all, captureId, dismissed],
  );
  const rows = useMemo(
    () =>
      inspections
        .filter((profile) =>
          `${profile.name} ${profile.class}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === 'gear' ? b.gear_score - a.gear_score || b.id - a.id : b.id - a.id,
        ),
    [inspections, search, sort],
  );
  const comparison = inspections.filter((profile) => selected.includes(profile.id));

  return (
    <div className="mt-1">
      <div className="mt-0.5 mb-1.5 flex flex-wrap gap-1">
        <SearchInput
          size="sm"
          wrapperClassName="basis-full"
          aria-label={t(($) => $.inspected.find)}
          placeholder={t(($) => $.inspected.findPlaceholder)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Input
          size="sm"
          className="w-18"
          type="number"
          aria-label={t(($) => $.inspected.minGear)}
          title={t(($) => $.inspected.minGearTitle)}
          min={0}
          max={1_000_000}
          value={minimum || ''}
          placeholder={t(($) => $.inspected.minGearPlaceholder)}
          onChange={(e) => setMinimum(Math.max(0, Math.min(1_000_000, Number(e.target.value))))}
        />
        <Select
          size="sm"
          wrapperClassName="flex-1"
          aria-label={t(($) => $.inspected.sort)}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="recent">{t(($) => $.inspected.sortRecent)}</option>
          <option value="gear">{t(($) => $.inspected.sortGear)}</option>
        </Select>
        <Button
          size="sm"
          disabled={!inspections.length}
          onClick={() => {
            setDismissed({
              capture: captureId,
              through: Math.max(0, ...inspections.map((p) => p.id)),
            });
            setSelection({ capture: captureId, ids: [] });
          }}
        >
          {t(($) => $.inspected.clear)}
        </Button>
      </div>
      <ul
        className="m-0 grid list-none grid-cols-1 gap-1 p-0 @min-[34rem]:grid-cols-2"
        aria-label={t(($) => $.inspected.label)}
      >
        {rows.map((profile) => {
          const below = minimum > 0 && profile.gear_score < minimum;
          return (
            <li
              key={profile.id}
              data-state={below ? 'below' : undefined}
              className={cn(
                memberRow,
                'grid-cols-[1rem_minmax(0,1fr)_auto] gap-2 px-2 py-1.25',
                below ? 'border-warn-line' : 'border-line-soft',
              )}
            >
              <Checkbox
                aria-label={t(($) => $.member.compare, { name: profile.name })}
                checked={selected.includes(profile.id)}
                disabled={selected.length >= 2 && !selected.includes(profile.id)}
                onCheckedChange={(checked) =>
                  setSelection({
                    capture: captureId,
                    ids: checked
                      ? [...selected, profile.id]
                      : selected.filter((id) => id !== profile.id),
                  })
                }
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-bold">{profile.name}</span>
                <span className="flex min-w-0 items-baseline gap-1.25 text-xs whitespace-nowrap text-ink-3 tabular-nums">
                  <ClassName name={profile.class || null} />
                  <span className="min-w-0 truncate">
                    {t(($) => $.level, { level: profile.level || UNKNOWN })} ·{' '}
                    {typeof profile.combat_power === 'number' && profile.combat_power > 0 && (
                      <>
                        {t(($) => $.inspected.combatPower, {
                          value: fmt.number.format(profile.combat_power),
                        })}{' '}
                        ·{' '}
                      </>
                    )}
                    {typeof profile.server_id === 'number' && (
                      <>{t(($) => $.inspected.server, { id: profile.server_id })} · </>
                    )}
                    <time dateTime={new Date(profile.observed_ms).toISOString()}>
                      {fmt.hourMinute(profile.observed_ms)}
                    </time>
                  </span>
                </span>
              </span>
              <span className="flex flex-col items-end leading-tight tabular-nums">
                <b className={below ? 'text-warn' : 'text-accent'}>
                  {fmt.number.format(profile.gear_score)}
                </b>
                <small
                  className={cn('text-3xs', below ? 'text-warn' : 'text-ink-3')}
                  title={
                    minimum > 0
                      ? t(($) => $.inspected.minimumIs, { value: fmt.number.format(minimum) })
                      : ''
                  }
                >
                  {minimum > 0
                    ? below
                      ? t(($) => $.inspected.belowMin)
                      : t(($) => $.inspected.meetsMin)
                    : t(($) => $.inspected.gs)}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      {!rows.length && (
        <p className="m-0 flex flex-col gap-0.75 px-1 py-3 text-center text-xs text-ink-2">
          {search ? t(($) => $.inspected.noMatch) : t(($) => $.inspected.empty)}
          {!search && (
            <small className="text-2xs text-ink-3">
              {running ? t(($) => $.inspected.emptyRunning) : t(($) => $.inspected.emptyWaiting)}
            </small>
          )}
        </p>
      )}
      {comparison.length > 0 && (
        <Comparison
          label={t(($) => $.compare.profiles)}
          note={
            comparison.length === 1 ? (
              t(($) => $.compare.selectProfile)
            ) : (
              <>
                {t(($) => $.compare.gearScoreDifference)}{' '}
                <b className="text-ink">
                  {fmt.number.format(
                    Math.abs((comparison[0]?.gear_score ?? 0) - (comparison[1]?.gear_score ?? 0)),
                  )}
                </b>
                . {t(($) => $.compare.profilesCaveat)}
              </>
            )
          }
        >
          {comparison.map((profile) => (
            <ComparisonSide
              key={profile.id}
              name={profile.name}
              sub={
                <>
                  <ClassLabel name={profile.class || null} size={14}>
                    {profile.class || t(($) => $.classUnknown)}
                  </ClassLabel>{' '}
                  · {t(($) => $.level, { level: profile.level || UNKNOWN })}
                </>
              }
              figures={t(($) => $.gearScoreFigure, {
                gearScore: fmt.number.format(profile.gear_score),
              })}
            />
          ))}
        </Comparison>
      )}
    </div>
  );
}
