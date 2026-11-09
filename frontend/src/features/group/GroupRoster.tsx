import { useEffect, useState, type CSSProperties } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Checkbox, Input, SearchInput, Select } from '../../components/ui/Field';
import { ClassIcon, ClassLabel } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { CaptionState } from '../../components/ui/Overlay';
import { UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { captureState } from '../../lib/capture';
import { classColor } from '../../lib/classColors';
import { cn } from '../../lib/cn';
import { Chevron, Comparison, ComparisonSide, ReadyMark } from './GroupIcons';
import { InspectedProfiles } from './InspectedProfiles';
import {
  ago,
  averageCombatPower,
  knownCapacity,
  memberCards,
  observedReadiness,
  readiness,
  READY_FRESH_MS,
  readyCheck,
  rosterColumns,
  type GroupStatusData,
  type MemberCard,
} from './model';

const FRESH_MS = 30_000;
/** Beyond this the roster is likely out of date (e.g. after leaving the lobby view). */
const STALE_MS = 120_000;
type Sort = 'slot' | 'gear' | 'power' | 'name';

/**
 * The party room as the DPS meter shows it before a run: the roster's own content, drawn
 * straight onto the meter's sheet under its caption (no panel or caption of its own).
 * `GroupCount` and `GroupState` are the pieces the caption carries.
 */
interface Props {
  status: GroupStatusData | null;
  native: boolean;
  error: string;
  /** The clock readiness ages are measured against (`useGroupClock`). */
  now: number;
}

/** What the roster and its caption read from one status. */
function summary(status: GroupStatusData | null, native: boolean, now: number) {
  const cards = memberCards(status);
  const check = readyCheck(status);
  const capture = captureState(status);
  const running = capture === 'capturing';
  const age = status?.roster_age_ms ?? null;
  // The leader is ready by rule, so only the other members' observations age the summary.
  // Known states without an observation time cannot be confirmed as current either.
  const { newestMs, oldestMs, untimed } = observedReadiness(cards);
  const oldestAge = check && oldestMs !== null ? Math.max(0, now - oldestMs) : null;
  return {
    cards,
    check,
    capture,
    running,
    age,
    newestMs,
    oldestMs,
    oldestAge,
    untimed,
    capacity: knownCapacity(status),
    ready: readiness(cards),
    stale: native && running && age !== null && age > STALE_MS,
    // Old readiness never reads as a fresh all-green group.
    readinessOld: (oldestAge !== null && oldestAge > READY_FRESH_MS) || untimed > 0,
  };
}

/** A clock for readiness ages; it ticks only while a readiness time is shown. */
export function useGroupClock(status: GroupStatusData | null) {
  const [now, setNow] = useState(() => Date.now());
  const ticking =
    !!readyCheck(status)?.active ||
    memberCards(status).some((card) => card.readyObservedMs !== null);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function useFreshness(status: GroupStatusData | null, native: boolean) {
  const { t } = useTranslation(['group', 'common']);
  const capture = captureState(status);
  const age = status?.roster_age_ms ?? null;
  return !native
    ? t(($) => $.freshness.preview)
    : capture !== 'capturing'
      ? t(($) => $.capture.label[capture], { ns: 'common' })
      : !status?.roster_seen || age === null
        ? t(($) => $.freshness.waitingForGroup)
        : age <= FRESH_MS
          ? t(($) => $.freshness.live)
          : t(($) => $.freshness.seen, { ago: ago(age, t) });
}

/** Members over the room's size, for the caption: 3/5. */
export function GroupCount({ status }: { status: GroupStatusData | null }) {
  const { t } = useTranslation('group');
  const members = memberCards(status).length;
  const capacity = knownCapacity(status);
  return (
    <span
      className="shrink-0 text-2xs font-semibold text-ink-2 figures"
      aria-label={
        capacity === null
          ? t(($) => $.caption.members, { count: members })
          : t(($) => $.caption.membersOf, { members, count: capacity })
      }
    >
      {members}
      {capacity !== null && `/${capacity}`}
    </span>
  );
}

/** Readiness when observed, else how fresh the roster is, for the caption. */
export function GroupState({
  status,
  native,
  now,
}: {
  status: GroupStatusData | null;
  native: boolean;
  now: number;
}) {
  const { t } = useTranslation('group');
  const freshness = useFreshness(status, native);
  const { ready, readinessOld, oldestAge, untimed, stale, running } = summary(status, native, now);
  if (!ready)
    return (
      <CaptionState
        tone={stale ? 'warn' : running ? 'live' : 'muted'}
        title={t(($) => $.caption.readyChecksNotObserved)}
      >
        {freshness}
      </CaptionState>
    );
  const state = readinessOld ? 'old' : ready.ready === ready.total ? 'all' : 'some';
  return (
    <span
      data-state={state}
      className={cn(
        'shrink-0 text-2xs font-semibold whitespace-nowrap',
        state === 'all' ? 'text-success' : state === 'old' ? 'text-ink-3' : 'text-warn',
      )}
      title={[
        ready.known < ready.total
          ? t(($) => $.caption.readyKnownFor, { known: ready.known, total: ready.total })
          : t(($) => $.caption.memberReadiness),
        oldestAge !== null
          ? t(($) => $.caption.oldestObservation, { ago: ago(oldestAge, t) })
          : null,
        untimed > 0 ? t(($) => $.caption.untimed, { count: untimed }) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {t(($) => $.caption.ready, { count: ready.ready })}
    </span>
  );
}

function cardTitle(card: MemberCard, t: Translate<'group'>) {
  const heading = t(($) => $.member.heading, {
    name: card.name,
    className: card.className ?? t(($) => $.classUnknown),
  });
  const server =
    card.serverId === null
      ? t(($) => $.member.serverUnknown)
      : t(($) => $.member.server, { id: card.serverId });
  return `${heading}\n${
    card.slot === null ? server : t(($) => $.member.serverSlot, { server, slot: card.slot })
  }`;
}

/**
 * A member uses the meter's player layout: filled in its class colour like a full meter bar,
 * with no edge of its own, the solid class emblem, name over class, gear score and level,
 * with Combat Power where the meter shows DPS, then the ready mark. The padding matches the
 * meter row's, so both views keep the same row height.
 */
function Member({
  card,
  dim,
  below,
  compare,
  now,
}: {
  card: MemberCard;
  dim: boolean;
  below: boolean;
  now: number;
  compare?:
    | { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }
    | undefined;
}) {
  const { t } = useTranslation('group');
  const fmt = useFormat();
  return (
    <li
      className={cn(
        'grid min-h-7 items-center gap-1.5 rounded-sm bg-row-hover bg-mark-fade-25 py-0.5 pr-1.75 pl-1.25 leading-tight',
        compare
          ? 'grid-cols-[1rem_1.375rem_minmax(0,1fr)_auto_1rem]'
          : 'grid-cols-[1.375rem_minmax(0,1fr)_auto_1rem]',
        dim && 'opacity-60',
      )}
      style={{ '--mark': classColor(card.className) } as CSSProperties}
      title={cardTitle(card, t)}
      data-hit="row"
      data-meter-row
    >
      {compare && (
        <Checkbox
          aria-label={t(($) => $.member.compare, { name: card.name })}
          checked={compare.checked}
          disabled={compare.disabled}
          onCheckedChange={(checked) => compare.onChange(checked)}
        />
      )}
      <span className="flex size-5.5 items-center justify-center">
        <ClassIcon name={card.className} size={22} solid />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1 text-xs font-semibold">
          <span className="truncate">{card.name}</span>
          {card.leader && (
            <span className="shrink-0 text-accent" title={t(($) => $.member.leader)}>
              <Icon name="leader" size={11} />
              <span className="sr-only">{t(($) => $.member.leader)}</span>
            </span>
          )}
          {below && (
            <Badge tone="warn" shape="tag">
              {t(($) => $.member.belowMin)}
            </Badge>
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-1 text-3xs whitespace-nowrap text-ink-3 figures">
          <span
            className={cn(
              'shrink-0',
              card.className ? 'font-semibold text-ink-2' : 'font-medium italic',
            )}
          >
            {card.className ?? t(($) => $.classUnknown)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">
            {t(($) => $.stats, {
              gearScore: fmt.maybe(card.gearScore),
              level: card.level ?? UNKNOWN,
            })}
          </span>
        </span>
      </span>
      <span
        className="flex flex-col items-end"
        title={
          card.combatPower === null
            ? t(($) => $.member.combatPowerUnknown)
            : t(($) => $.member.combatPower)
        }
      >
        <b
          className={cn(
            'text-xs leading-4 font-bold whitespace-nowrap figures',
            card.combatPower === null ? 'font-medium text-ink-3' : 'text-ink',
          )}
        >
          {fmt.maybe(card.combatPower)}
        </b>
        <span className="text-4xs font-semibold text-ink-3" aria-hidden="true">
          {t(($) => $.footer.unit)}
        </span>
        <span className="sr-only"> {t(($) => $.member.combatPower)}</span>
      </span>
      <ReadyMark
        ready={card.ready}
        observedMs={card.readyObservedMs}
        leader={card.leader}
        now={now}
      />
    </li>
  );
}

/** An empty place in the roster: a dashed outline where a member would stand. */
const slot =
  'grid min-h-7 place-items-center rounded-sm border border-dashed border-line-strong text-3xs text-ink-3';
/** A quiet line of context under the lobby name (readiness, a stale roster). */
const note = 'mx-0.5 mt-0 mb-1 flex gap-1.5 text-3xs';
/** The secondary actions under the roster: text-like, lighting up on hover. */
const more = 'h-6 justify-start rounded-sm px-1.5 text-3xs font-normal text-ink-3';

export function GroupRoster({ status, native, error, now }: Props) {
  const { t } = useTranslation(['group', 'common']);
  const fmt = useFormat();
  const [inspecting, setInspecting] = useState(false);
  const [tools, setTools] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('slot');
  const [minGear, setMinGear] = useState(0);
  const [minPower, setMinPower] = useState(0);
  const [compare, setCompare] = useState<string[]>([]);
  const freshness = useFreshness(status, native);
  const {
    cards,
    check,
    capture,
    running,
    age,
    newestMs,
    oldestMs,
    oldestAge,
    capacity,
    ready,
    stale,
  } = summary(status, native, now);
  const average = averageCombatPower(cards);
  const captureError =
    native && capture === 'error'
      ? status?.message || t(($) => $.capture.label.error, { ns: 'common' })
      : '';
  const lobby = status?.lobby_name?.trim();
  const openSlots = capacity === null ? 0 : capacity - cards.length;
  const inspections = status?.inspections.length ?? 0;

  const shown = (() => {
    if (!tools) return cards;
    const needle = search.trim().toLocaleLowerCase();
    const filtered = needle
      ? cards.filter((c) => `${c.name} ${c.className ?? ''}`.toLocaleLowerCase().includes(needle))
      : cards;
    const by: Record<Sort, (a: MemberCard, b: MemberCard) => number> = {
      slot: () => 0,
      gear: (a, b) => (b.gearScore ?? -1) - (a.gearScore ?? -1),
      power: (a, b) => (b.combatPower ?? -1) - (a.combatPower ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...filtered].sort(by[sort]);
  })();
  const below = (card: MemberCard) =>
    tools &&
    ((minGear > 0 && card.gearScore !== null && card.gearScore < minGear) ||
      (minPower > 0 && card.combatPower !== null && card.combatPower < minPower));
  const compared = cards.filter((c) => compare.includes(c.key));
  // A raid reads as its parties side by side once the meter is wide enough for two columns.
  const places = tools ? Math.max(1, shown.length) : cards.length + openSlots;
  const columns = rosterColumns(places);
  const rows = Math.ceil(places / 2);

  return (
    <>
      {/* The meter grows with the room up to five lines of members (`useMeterFit`), then
          this scrolls under the caption and above the footer, as it does when the screen
          is too short. */}
      <div className="@container min-h-0 flex-1 overflow-y-auto" data-meter-viewport data-hit-clip>
        <div className="px-1.5 pt-1 pb-1" data-meter-content>
          {(lobby || cards.length > 0) && (
            <h2
              className={cn(
                'mx-0.5 mt-0 mb-1 truncate text-xs leading-snug',
                lobby ? 'font-semibold text-ink' : 'font-normal text-ink-3 italic',
              )}
              title={lobby || t(($) => $.lobby.notDetected)}
            >
              {lobby || t(($) => $.lobby.unknown)}
            </h2>
          )}
          {(error || captureError) && (
            <output
              className="mb-1 block rounded-sm border border-danger-line bg-danger-soft px-2 py-1 text-left text-3xs text-danger-strong"
              aria-label={t(($) => $.error)}
            >
              {error || captureError}
            </output>
          )}
          {check?.active ? (
            // Only an explicit round from the game earns a "Ready check" banner.
            <output
              className={cn(
                note,
                'rounded-sm border border-success-line bg-success-soft px-1.5 py-0.5 text-left text-ink-2',
              )}
              title={check.source ?? undefined}
            >
              <b className="text-success">{t(($) => $.readyCheck.title)}</b>
              {check.startedMs !== null && (
                <span>
                  {t(($) => $.readyCheck.started, {
                    ago: ago(Math.max(0, now - check.startedMs), t),
                  })}
                </span>
              )}
              {check.expiresMs !== null && check.expiresMs > now && (
                <span>
                  ·{' '}
                  {t(($) => $.readyCheck.left, {
                    seconds: Math.ceil((check.expiresMs - now) / 1000),
                  })}
                </span>
              )}
            </output>
          ) : (
            check &&
            newestMs !== null &&
            ready && (
              <p className={cn(note, 'text-ink-3')} title={check.source ?? undefined}>
                {t(($) => $.readyCheck.observed, {
                  ago: ago(Math.max(0, now - newestMs), t),
                })}
                {oldestAge !== null && oldestMs !== newestMs && (
                  <> · {t(($) => $.readyCheck.oldest, { ago: ago(oldestAge, t) })}</>
                )}
              </p>
            )
          )}
          {stale && cards.length > 0 && (
            <p className={cn(note, 'text-warn')}>
              {t(($) => $.rosterStale, { ago: ago(age ?? 0, t) })}
            </p>
          )}
          {tools && cards.length > 0 && (
            <div
              className="mb-1 flex flex-wrap gap-1"
              aria-label={t(($) => $.tools.label)}
              data-hit
            >
              <SearchInput
                size="sm"
                wrapperClassName="basis-full"
                aria-label={t(($) => $.tools.find)}
                placeholder={t(($) => $.tools.findPlaceholder)}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select
                size="sm"
                wrapperClassName="flex-1"
                aria-label={t(($) => $.tools.sort)}
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                <option value="slot">{t(($) => $.tools.sortSlot)}</option>
                <option value="gear">{t(($) => $.tools.sortGear)}</option>
                <option value="power">{t(($) => $.tools.sortPower)}</option>
                <option value="name">{t(($) => $.tools.sortName)}</option>
              </Select>
              <Input
                size="sm"
                className="w-18"
                type="number"
                aria-label={t(($) => $.tools.minGear)}
                placeholder={t(($) => $.tools.minGearPlaceholder)}
                min={0}
                value={minGear || ''}
                onChange={(e) =>
                  setMinGear(Math.max(0, Math.min(1_000_000, Number(e.target.value))))
                }
              />
              <Input
                size="sm"
                className="w-18"
                type="number"
                aria-label={t(($) => $.tools.minPower)}
                placeholder={t(($) => $.tools.minPowerPlaceholder)}
                min={0}
                value={minPower || ''}
                onChange={(e) =>
                  setMinPower(Math.max(0, Math.min(100_000_000, Number(e.target.value))))
                }
              />
            </div>
          )}
          {cards.length > 0 ? (
            <ul
              className={cn(
                'm-0 grid list-none grid-cols-1 gap-0.5 p-0',
                // Column by column, so slots 1..6 and 7..12 read as the raid's parties.
                columns === 2 &&
                  '@min-[34rem]:grid-flow-col @min-[34rem]:grid-cols-2 @min-[34rem]:grid-rows-(--group-rows)',
              )}
              style={{ '--group-rows': `repeat(${rows}, minmax(0, 1fr))` } as CSSProperties}
              aria-label={t(($) => $.roster.label)}
            >
              {shown.map((card) => (
                <Member
                  key={card.key}
                  card={card}
                  now={now}
                  dim={(native && !running) || stale}
                  below={below(card)}
                  compare={
                    tools
                      ? {
                          checked: compare.includes(card.key),
                          disabled: compare.length >= 2 && !compare.includes(card.key),
                          onChange: (on) =>
                            setCompare(
                              on ? [...compare, card.key] : compare.filter((k) => k !== card.key),
                            ),
                        }
                      : undefined
                  }
                />
              ))}
              {!tools &&
                Array.from({ length: openSlots }, (_, i) => (
                  // An open place counts as a line, as the member who takes it will.
                  <li key={`slot-${i}`} className={slot} data-meter-row>
                    {t(($) => $.roster.openSlot)}
                  </li>
                ))}
              {tools && !shown.length && <li className={slot}>{t(($) => $.roster.noMatch)}</li>}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={<Icon name="group" size={18} />}
              title={t(($) => $.roster.emptyTitle)}
            >
              {running || !native
                ? t(($) => $.roster.emptyRunning)
                : t(($) => $.roster.emptyWaiting)}
            </EmptyState>
          )}
          {tools && compared.length > 0 && (
            <Comparison
              label={t(($) => $.compare.members)}
              note={
                compared.length === 1 ? (
                  t(($) => $.compare.selectMember)
                ) : (
                  <>
                    {t(($) => $.compare.gsDifference)}{' '}
                    <b className="text-ink">
                      {compared[0]?.gearScore === null || compared[1]?.gearScore === null
                        ? UNKNOWN
                        : fmt.number.format(
                            Math.abs((compared[0]?.gearScore ?? 0) - (compared[1]?.gearScore ?? 0)),
                          )}
                    </b>{' '}
                    · {t(($) => $.compare.cpDifference)}{' '}
                    <b className="text-ink">
                      {compared[0]?.combatPower === null || compared[1]?.combatPower === null
                        ? UNKNOWN
                        : fmt.number.format(
                            Math.abs(
                              (compared[0]?.combatPower ?? 0) - (compared[1]?.combatPower ?? 0),
                            ),
                          )}
                    </b>
                    . {t(($) => $.compare.membersCaveat)}
                  </>
                )
              }
            >
              {compared.map((c) => (
                <ComparisonSide
                  key={c.key}
                  name={c.name}
                  sub={
                    <>
                      <ClassLabel name={c.className} size={14}>
                        {c.className ?? t(($) => $.classUnknown)}
                      </ClassLabel>{' '}
                      · {t(($) => $.level, { level: c.level ?? UNKNOWN })}
                    </>
                  }
                  figures={t(($) => $.figures, {
                    gearScore: fmt.maybe(c.gearScore),
                    combatPower: fmt.maybe(c.combatPower),
                  })}
                />
              ))}
            </Comparison>
          )}
          <div className="mt-1 flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(more, 'flex-1')}
              data-hit
              aria-expanded={inspecting}
              onClick={() => setInspecting(!inspecting)}
            >
              {t(($) => $.actions.inspected)}{' '}
              <span className="rounded-full bg-surface-3 px-1.5 text-ink-2 figures">
                {inspections}
              </span>
              <span className="ml-auto flex">
                <Chevron open={inspecting} />
              </span>
            </Button>
            {cards.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={more}
                data-hit
                aria-pressed={tools}
                onClick={() => {
                  setTools(!tools);
                  setCompare([]);
                }}
              >
                {t(($) => $.actions.findCompare)}
              </Button>
            )}
          </div>
          {inspecting && (
            // An opened list takes input as a whole while the meter is locked.
            <div data-hit>
              <InspectedProfiles
                captureId={status?.capture_id ?? 0}
                inspections={status?.inspections ?? []}
                running={running}
              />
            </div>
          )}
        </div>
      </div>
      <footer className="flex min-h-5.5 flex-none items-center justify-between gap-2 border-t border-line-soft bg-sunken/40 py-px pr-1.5 pl-2 text-3xs text-ink-3">
        <span className="truncate">{ready ? freshness : t(($) => $.footer.acceptInGame)}</span>
        <span
          className="shrink-0 figures"
          title={
            average && average.known < average.total
              ? t(($) => $.footer.averagePartial, {
                  known: average.known,
                  total: average.total,
                })
              : t(($) => $.footer.averageTitle)
          }
        >
          {t(($) => $.footer.average)}{' '}
          <b className="text-2xs font-bold text-ink">{fmt.maybe(average?.average)}</b>{' '}
          {t(($) => $.footer.unit)}
          {average && average.known < average.total && (
            <small>
              {' '}
              ({average.known}/{average.total})
            </small>
          )}
        </span>
      </footer>
    </>
  );
}
