import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Checkbox, Input, SearchInput, Select } from '../../components/ui/Field';
import { ClassLabel } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import {
  CaptionState,
  CaptionTitle,
  OverlayCaption,
  overlayWindow,
  WindowButton,
} from '../../components/ui/Overlay';
import { UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import {
  ClassName,
  CombatPowerIcon,
  Chevron,
  Comparison,
  ComparisonSide,
  memberRow,
  ReadyMark,
} from './GroupIcons';
import { InspectedProfiles } from './InspectedProfiles';
import { captureState } from '../../lib/capture';
import {
  ago,
  averageCombatPower,
  knownCapacity,
  GROUP_WIDTH,
  memberCards,
  readiness,
  READY_FRESH_MS,
  readyCheck,
  rosterColumns,
  type GroupStatusData,
  type MemberCard,
} from './model';

interface Props {
  status: GroupStatusData | null;
  native: boolean;
  error: string;
  onHide: () => void;
  /**
   * The window size (logical px) that shows everything without scrolling: the chosen
   * width and the natural height of the content at the current width.
   */
  onFit?: (size: { width: number; height: number }) => void;
}
const FRESH_MS = 30_000;
/** Beyond this the roster is likely out of date (e.g. after leaving the lobby view). */
const STALE_MS = 120_000;
const COLLAPSE_KEY = 'aion-companion:group-collapsed';
type Sort = 'slot' | 'gear' | 'power' | 'name';

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

function Member({
  card,
  dim,
  below,
  stale,
  compare,
  now,
}: {
  card: MemberCard;
  dim: boolean;
  below: boolean;
  stale: boolean;
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
        memberRow,
        'py-1',
        compare
          ? 'grid-cols-[1rem_minmax(0,1fr)_auto_1rem]'
          : 'grid-cols-[minmax(0,1fr)_auto_1rem]',
        below ? 'border-warn-line' : 'border-line-soft',
        stale && 'border-dashed',
        dim && 'opacity-60',
      )}
      title={cardTitle(card, t)}
    >
      {compare && (
        <Checkbox
          aria-label={t(($) => $.member.compare, { name: card.name })}
          checked={compare.checked}
          disabled={compare.disabled}
          onCheckedChange={(checked) => compare.onChange(checked)}
        />
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5 text-sm leading-tight font-bold">
          <span className="truncate">{card.name}</span>
          {card.leader && (
            <span className="shrink-0 text-accent" title={t(($) => $.member.leader)}>
              <Icon name="leader" size={12} />
              <span className="sr-only">{t(($) => $.member.leader)}</span>
            </span>
          )}
          {below && (
            <Badge tone="warn" shape="tag">
              {t(($) => $.member.belowMin)}
            </Badge>
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-1.25 text-xs leading-tight whitespace-nowrap text-ink-3 tabular-nums">
          <ClassName name={card.className} />
          <span className="min-w-0 truncate">
            {t(($) => $.stats, {
              gearScore: fmt.maybe(card.gearScore),
              level: card.level ?? UNKNOWN,
            })}
          </span>
        </span>
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken px-1.5 py-0.5 text-ink-2 tabular-nums"
        title={
          card.combatPower === null
            ? t(($) => $.member.combatPowerUnknown)
            : t(($) => $.member.combatPower)
        }
      >
        <CombatPowerIcon />
        <b
          className={cn(
            'text-xs',
            card.combatPower === null ? 'font-medium text-ink-3' : 'text-ink',
          )}
        >
          {fmt.maybe(card.combatPower)}
        </b>
        <span className="sr-only"> {t(($) => $.member.combatPower)}</span>
      </span>
      <ReadyMark ready={card.ready} observedMs={card.readyObservedMs} now={now} />
    </li>
  );
}

function readStoredCollapse() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** An empty place in the roster: a dashed outline where a member would stand. */
const slot =
  'grid min-h-8 place-items-center rounded-lg border border-dashed border-line-strong text-xs text-ink-3';
/** A quiet line of context under the lobby name (readiness, a stale roster). */
const note = 'mx-1 mt-0 mb-2 flex gap-1.5 text-xs';
/** The secondary actions under the roster: text-like, lighting up on hover. */
const more = 'h-7 justify-start rounded-md px-1.5 text-xs font-normal text-ink-3';

export function GroupPanel({ status, native, error, onHide, onFit }: Props) {
  const { t } = useTranslation(['group', 'common']);
  const fmt = useFormat();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [inspecting, setInspecting] = useState(false);
  const [collapsed, setCollapsed] = useState(readStoredCollapse);
  const [tools, setTools] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('slot');
  const [minGear, setMinGear] = useState(0);
  const [minPower, setMinPower] = useState(0);
  const [compare, setCompare] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // Collapse still works for this session.
    }
  }, [collapsed]);
  const check = readyCheck(status);
  const cards = memberCards(status);
  // Relative readiness times (and old per-member marks) need a clock only while shown.
  const ticking =
    (!!check && (check.active || check.observedMs !== null)) ||
    cards.some((card) => card.readyObservedMs !== null);
  const oldestAge = check && check.oldestMs !== null ? Math.max(0, now - check.oldestMs) : null;
  // Known states without an observation time cannot be confirmed as current either.
  const untimed = cards.filter(
    (card) => card.ready !== null && card.readyObservedMs === null,
  ).length;
  // Old readiness never reads as a fresh all-green group.
  const readinessOld = (oldestAge !== null && oldestAge > READY_FRESH_MS) || untimed > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const capacity = knownCapacity(status);
  const ready = readiness(cards);
  const average = averageCombatPower(cards);
  // Capture runs in the background from app launch; the panel only reports its state.
  const capture = captureState(status);
  const running = capture === 'capturing';
  const captureError =
    native && capture === 'error'
      ? status?.message || t(($) => $.capture.label.error, { ns: 'common' })
      : '';
  const lobby = status?.lobby_name?.trim();
  const age = status?.roster_age_ms ?? null;
  const stale = native && running && age !== null && age > STALE_MS;
  const freshness = !native
    ? t(($) => $.freshness.preview)
    : !running
      ? t(($) => $.capture.label[capture], { ns: 'common' })
      : !status?.roster_seen || age === null
        ? t(($) => $.freshness.waitingForGroup)
        : age <= FRESH_MS
          ? t(($) => $.freshness.live)
          : t(($) => $.freshness.seen, { ago: ago(age, t) });
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
  const readyState = !ready
    ? undefined
    : readinessOld
      ? 'old'
      : ready.ready === ready.total
        ? 'all'
        : 'some';

  // Every place in the roster (members and open slots, or the matches while finding) is
  // shown at once: a raid takes two columns of a party each instead of scrolling.
  const places = tools ? Math.max(1, shown.length) : cards.length + openSlots;
  const columns = rosterColumns(
    Math.max(places, inspecting ? inspections : 0),
    // The monitor's width (or the window's, if already wider, as in a browser preview).
    Math.max(typeof screen === 'undefined' ? 0 : screen.availWidth, innerWidth),
  );
  const width = columns === 2 ? GROUP_WIDTH.double : GROUP_WIDTH.single;
  const rows = Math.ceil(places / 2);

  // Ask for a window as large as the content. The natural height is the sheet plus
  // whatever the body would scroll, so it stays right while the window is still too small.
  useLayoutEffect(() => {
    const sheet = root.current;
    if (!onFit || !sheet) return;
    let frame = 0;
    let sent = '';
    const measure = () => {
      frame = 0;
      const scroller = body.current;
      const hidden = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
      const height = Math.ceil(sheet.getBoundingClientRect().height + hidden);
      const key = `${width}x${height}`;
      if (height <= 0 || key === sent) return;
      sent = key;
      onFit({ width, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    observer.observe(sheet);
    if (content.current) observer.observe(content.current);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onFit, width, collapsed]);

  return (
    <section
      ref={root}
      className={overlayWindow({ glass: 'deep', className: '@container h-auto max-h-full' })}
      data-state={collapsed ? 'collapsed' : undefined}
      aria-label={t(($) => $.title)}
    >
      <OverlayCaption
        className={cn('h-[34px] cursor-move pr-1.5', collapsed && 'border-b-0')}
        data-tauri-drag-region="deep"
      >
        <CaptionTitle
          icon={<Icon name="group" size={15} />}
          label={t(($) => $.title)}
          data-tauri-drag-region="deep"
        >
          <span
            className="ml-1 text-xs font-semibold text-ink-2 tabular-nums"
            aria-label={
              capacity === null
                ? t(($) => $.caption.members, { count: cards.length })
                : t(($) => $.caption.membersOf, { members: cards.length, count: capacity })
            }
          >
            {cards.length}
            {capacity !== null && `/${capacity}`}
          </span>
        </CaptionTitle>
        {ready ? (
          <span
            data-state={readyState}
            className={cn(
              'text-xs font-semibold whitespace-nowrap',
              readyState === 'all'
                ? 'text-success'
                : readyState === 'old'
                  ? 'text-ink-3'
                  : 'text-warn',
            )}
            title={[
              ready.known < ready.total
                ? t(($) => $.caption.readyObservedFor, { known: ready.known, total: ready.total })
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
        ) : (
          <CaptionState
            tone={stale ? 'warn' : running ? 'live' : 'muted'}
            title={t(($) => $.caption.readyChecksNotObserved)}
          >
            {freshness}
          </CaptionState>
        )}
        <WindowButton
          aria-label={collapsed ? t(($) => $.caption.expand) : t(($) => $.caption.collapse)}
          aria-expanded={!collapsed}
          title={collapsed ? t(($) => $.caption.expandTitle) : t(($) => $.caption.collapseTitle)}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Chevron open={!collapsed} />
        </WindowButton>
        <WindowButton
          close
          aria-label={t(($) => $.caption.hide)}
          title={t(($) => $.caption.hide)}
          onClick={onHide}
        >
          <Icon name="close" size={14} />
        </WindowButton>
      </OverlayCaption>
      {!collapsed && (
        <>
          {/* Scrolls only if the content is taller than the monitor's work area. */}
          <div ref={body} className="min-h-0 flex-auto overflow-y-auto">
            <div ref={content} className="px-2 pt-2 pb-1.5">
              {(lobby || cards.length > 0) && (
                <h1
                  className={cn(
                    'mx-1 mb-1.5 truncate text-sm leading-snug',
                    lobby ? 'font-semibold text-ink' : 'font-normal text-ink-3 italic',
                  )}
                  title={lobby || t(($) => $.lobby.notDetected)}
                >
                  {lobby || t(($) => $.lobby.unknown)}
                </h1>
              )}
              {(error || captureError) && (
                <output
                  className="mb-2 block rounded-lg border border-danger-line bg-danger-soft px-2.5 py-1.5 text-left text-xs text-danger-strong"
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
                    'rounded-lg border border-success-line bg-success-soft px-2 py-1 text-left text-ink-2',
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
                check.observedMs !== null &&
                ready && (
                  <p className={cn(note, 'text-ink-3')} title={check.source ?? undefined}>
                    {t(($) => $.readyCheck.observed, {
                      ago: ago(Math.max(0, now - check.observedMs), t),
                    })}
                    {oldestAge !== null && check.oldestMs !== check.observedMs && (
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
                <div className="mb-1.5 flex flex-wrap gap-1" aria-label={t(($) => $.tools.label)}>
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
                    'm-0 grid list-none auto-rows-fr grid-cols-1 gap-1 p-0',
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
                      stale={stale}
                      compare={
                        tools
                          ? {
                              checked: compare.includes(card.key),
                              disabled: compare.length >= 2 && !compare.includes(card.key),
                              onChange: (on) =>
                                setCompare(
                                  on
                                    ? [...compare, card.key]
                                    : compare.filter((k) => k !== card.key),
                                ),
                            }
                          : undefined
                      }
                    />
                  ))}
                  {!tools &&
                    Array.from({ length: openSlots }, (_, i) => (
                      <li key={`slot-${i}`} className={slot}>
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
                                Math.abs(
                                  (compared[0]?.gearScore ?? 0) - (compared[1]?.gearScore ?? 0),
                                ),
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
                      figures={
                        <>
                          {t(($) => $.figures, {
                            gearScore: fmt.maybe(c.gearScore),
                            combatPower: fmt.maybe(c.combatPower),
                          })}
                        </>
                      }
                    />
                  ))}
                </Comparison>
              )}
              <div className="mt-1.5 flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(more, 'flex-1')}
                  aria-expanded={inspecting}
                  onClick={() => setInspecting(!inspecting)}
                >
                  {t(($) => $.actions.inspected)}{' '}
                  <span className="rounded-full bg-surface-3 px-1.5 text-ink-2 tabular-nums">
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
                <InspectedProfiles
                  captureId={status?.capture_id ?? 0}
                  inspections={status?.inspections ?? []}
                  running={running}
                />
              )}
            </div>
          </div>
          <footer className="flex flex-none items-baseline justify-between gap-2 border-t border-line-soft px-3 pt-1.5 pb-2 text-xs text-ink-3">
            <span className="truncate">{ready ? freshness : t(($) => $.footer.acceptInGame)}</span>
            <span
              className="shrink-0 tabular-nums"
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
              <b className="text-sm font-bold text-ink">{fmt.maybe(average?.average)}</b>{' '}
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
      )}
    </section>
  );
}
