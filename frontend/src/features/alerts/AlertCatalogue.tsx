import { useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../../components/ui/Collapsible';
import { EmptyState } from '../../components/ui/Feedback';
import { Checkbox, SearchInput, Select, Switch } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Pressable } from '../../components/ui/Pressable';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  AlertCatalogueEntry,
  AlertConfig,
  AlertDashboard,
  AlertFactionSetting,
  AlertOccurrence,
  AlertRule,
  AlertSound,
  CatalogueCountdown,
  ObservedTimer,
} from '../../types/alerts';
import {
  CATEGORY,
  QUICK_LEADS,
  SOUNDS,
  ago,
  categoryPlural,
  catalogueMatches,
  clockIn,
  enablePreset,
  factionLabel,
  factionMatches,
  latestObservation,
  leadOption,
  minuteClock,
  patchPreset,
  presetRule,
  primaryLead,
  remaining,
  scheduleSummary,
  spawnFresh,
  soundLabel,
  viewFaction,
  withAtStart,
  withPrimaryLead,
} from './model';
import { AlertCard, CATEGORY_INK, Countdown, StateTag } from './parts';
import { RuleEditor } from './RuleEditor';

type Scope = 'all' | 'enabled';
type Configure = (change: (config: AlertConfig) => AlertConfig) => Promise<boolean>;

interface CatalogueProps {
  dashboard: AlertDashboard;
  nowMs: number;
  busy: boolean;
  configure: Configure;
  onTest: (sound: AlertSound, volume: number, popup: boolean) => void;
  now: () => number;
  nextByRule: Map<string, AlertOccurrence>;
  options: string | null;
  setOptions: (id: string | null) => void;
}

interface RowContext extends CatalogueProps {
  /** Countdown per catalogue entry id, whether or not it notifies. */
  countdowns: Map<string, CatalogueCountdown>;
}

/**
 * What this app last saw in game for a boss, exactly as observed: up, defeated, or a raw
 * state. A countdown appears only when a future time is known; nothing is predicted.
 */
function SightingStatus({
  entry,
  sighting,
  nowMs,
  live,
}: {
  entry: AlertCatalogueEntry;
  sighting: ObservedTimer;
  nowMs: number;
  live: boolean | undefined;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const at = clockIn(fmt, sighting.observed_ms, undefined, nowMs);
  const elapsed = nowMs - sighting.observed_ms;
  const title = [
    sighting.name && sighting.name !== entry.name ? sighting.name : '',
    sighting.basis,
    elapsed < 60_000
      ? t(($) => $.catalogue.status.seenJustNow)
      : t(($) => $.catalogue.status.seenAgo, { age: ago(t, elapsed) }),
  ]
    .filter(Boolean)
    .join(' · ');
  if (sighting.due_ms !== null && sighting.due_ms > nowMs)
    return (
      <span className="inline-flex shrink-0 items-baseline gap-2" title={title}>
        {sighting.state === 'Defeated' && (
          <small className="text-2xs text-ink-3">
            {t(($) => $.catalogue.status.defeatedAt, { time: at })}
          </small>
        )}
        <Countdown size="sm" aria-label={t(($) => $.catalogue.status.next, { name: entry.name })}>
          {sighting.estimated ? '~' : ''}
          {remaining(t, sighting.due_ms - nowMs)}
        </Countdown>
      </span>
    );
  if (spawnFresh(sighting, nowMs, live))
    return (
      <StateTag kind="up" title={title}>
        {t(($) => $.catalogue.status.upSince, { time: at })}
      </StateTag>
    );
  // An older spawn says when it was seen, never that the boss is still up.
  if (sighting.state === 'Spawned')
    return (
      <StateTag kind="unknown" title={`${title} · ${t(($) => $.catalogue.status.stillUpUnknown)}`}>
        {t(($) => $.catalogue.status.lastSeen, { time: at })}
      </StateTag>
    );
  if (sighting.state === 'Defeated')
    return (
      <StateTag kind="down" title={`${title} · ${t(($) => $.catalogue.status.nextSpawnUnknown)}`}>
        {t(($) => $.catalogue.status.defeatedAt, { time: at })}
      </StateTag>
    );
  // Raw game states are shown as seen, never read as alive or dead.
  return (
    <StateTag kind="unknown" title={[sighting.state, title].join(' · ')}>
      {t(($) => $.catalogue.status.seenAt, { time: at })}
    </StateTag>
  );
}

/**
 * Where the row stands, in the fewest words. Countdowns show whether or not the
 * notification is on; older engines without them report enabled reminders only.
 */
function RowStatus({
  entry,
  rule,
  next,
  countdown,
  sighting,
  nowMs,
  clockReady,
  live,
}: {
  entry: AlertCatalogueEntry;
  rule: AlertRule;
  next: AlertOccurrence | undefined;
  countdown: CatalogueCountdown | undefined;
  sighting: ObservedTimer | null;
  nowMs: number;
  clockReady: boolean;
  live: boolean | undefined;
}) {
  const { t } = useTranslation('alerts');
  const nextLabel = t(($) => $.catalogue.status.next, { name: entry.name });
  // Sightings carry what was seen (up, defeated); they speak for observed bosses.
  const observed = countdown?.clock === 'observed' && sighting;
  if (countdown && !observed) {
    if (countdown.state === 'open')
      return (
        <StateTag kind="open" title={countdown.basis}>
          {t(($) => $.catalogue.status.openNow)}
        </StateTag>
      );
    if (countdown.state === 'scheduled' && countdown.due_ms !== null)
      return (
        <Countdown size="sm" aria-label={nextLabel} title={countdown.basis}>
          {countdown.estimated ? '~' : ''}
          {remaining(t, countdown.due_ms - nowMs)}
        </Countdown>
      );
  } else if (!countdown) {
    if (rule.enabled && next?.state === 'open')
      return <StateTag kind="open">{t(($) => $.catalogue.status.openNow)}</StateTag>;
    if (rule.enabled && next?.due_ms != null && next.state === 'scheduled' && next.due_ms > nowMs)
      return (
        <Countdown size="sm" aria-label={nextLabel} title={next.basis}>
          {next.estimated ? '~' : ''}
          {remaining(t, next.due_ms - nowMs)}
        </Countdown>
      );
  }
  // Sightings are shown even while the alert is off: knowing a boss is up is useful.
  if (sighting)
    return <SightingStatus entry={entry} sighting={sighting} nowMs={nowMs} live={live} />;
  // With countdowns, what is known (or not) shows whatever the notification switch says.
  if (!countdown && !rule.enabled) return null;
  if (rule.schedule?.type === 'calendar' && !clockReady && !countdown)
    return <StateTag kind="unknown">{t(($) => $.catalogue.status.waitingServer)}</StateTag>;
  if (countdown?.clock === 'observed' || (!countdown && rule.schedule?.type === 'observed'))
    return (
      <StateTag
        kind="unknown"
        title={t(($) => $.catalogue.status.noReportsTitle, {
          basis: countdown?.basis || t(($) => $.catalogue.status.waitingObservation),
        })}
      >
        {t(($) => $.catalogue.status.noReports)}
      </StateTag>
    );
  return (
    <StateTag kind="unknown" title={countdown?.basis || undefined}>
      {t(($) => $.catalogue.status.timeUnknown)}
    </StateTag>
  );
}

function CatalogueRow({ entry, ctx }: { entry: AlertCatalogueEntry; ctx: RowContext }) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const { dashboard, busy, configure } = ctx;
  const config = dashboard.config;
  const rule = presetRule(config, entry);
  const on = rule.enabled;
  const optionsOpen = ctx.options === entry.id;
  const countdown = ctx.countdowns.get(entry.id);
  const lead = primaryLead(rule.lead_seconds);
  const atStart = rule.lead_seconds.includes(0);
  const boss = entry.category !== 'event';
  const patch = (change: Partial<AlertRule>) =>
    void configure((c) => patchPreset(c, entry, change));
  const members = entry.members.map((m) => m.name);
  const detail = [
    scheduleSummary(t, fmt, rule),
    members.length > 1
      ? `${members.slice(0, 2).join(', ')}${members.length > 2 ? ` +${members.length - 2}` : ''}`
      : '',
    entry.recharge_minute !== null
      ? t(($) => $.catalogue.row.recharge, { time: minuteClock(entry.recharge_minute) })
      : '',
  ].filter(Boolean);
  const title = [
    members.length > 1 ? members.join(', ') : '',
    entry.note,
    entry.source ? t(($) => $.catalogue.row.source, { source: entry.source }) : '',
    rule.schedule_override ? t(($) => $.catalogue.row.usesOwn) : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <Collapsible
      open={optionsOpen}
      onOpenChange={(open) => ctx.setOptions(open ? entry.id : null)}
      render={<li />}
      id={`alert-preset-${entry.id}`}
      data-state={on ? 'on' : 'off'}
      className={cn(
        'relative scroll-mt-24 rounded-md border-t border-line-soft first:border-t-0',
        // A notifying alert grows a small stem on its leading edge.
        'before:absolute before:top-3 before:left-0 before:h-5 before:w-0.5 before:origin-center before:scale-y-0 before:rounded-full before:bg-accent before:transition-transform before:duration-300 before:ease-grow',
        'data-[state=on]:before:scale-y-100',
        optionsOpen && 'border-transparent bg-row-selected',
      )}
    >
      <div className="flex min-h-11 items-center gap-3 py-2 pr-1 pl-3">
        <span
          className="inline-flex"
          title={
            on ? t(($) => $.catalogue.row.notificationsOn) : t(($) => $.catalogue.row.countdownOnly)
          }
        >
          <Switch
            aria-label={t(($) => $.catalogue.row.notify, { name: entry.name })}
            checked={on}
            disabled={busy}
            onCheckedChange={(enable) =>
              void configure((c) =>
                enable ? enablePreset(c, entry) : patchPreset(c, entry, { enabled: false }),
              )
            }
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col" title={title || undefined}>
          <b
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-sm',
              on ? 'font-semibold text-ink' : 'font-medium text-ink-2',
            )}
          >
            <span className="truncate">{entry.name}</span>
            {rule.favorite && (
              <span
                className="inline-flex shrink-0 text-warn"
                title={t(($) => $.catalogue.row.onWatchlist)}
              >
                <Icon name="star" size={11} className="fill-current" />
              </span>
            )}
            {rule.schedule_override && (
              <StateTag kind="neutral">{t(($) => $.catalogue.row.ownSchedule)}</StateTag>
            )}
          </b>
          <small className="truncate text-xs text-ink-3">{detail.join(' · ')}</small>
        </span>
        <RowStatus
          entry={entry}
          rule={rule}
          next={ctx.nextByRule.get(rule.id)}
          countdown={countdown}
          sighting={boss ? latestObservation(dashboard.observed, entry, rule) : null}
          nowMs={ctx.nowMs}
          clockReady={dashboard.clock_ready}
          live={dashboard.live_observations}
        />
      </div>
      {on && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pr-1 pb-2.5 pl-[3.375rem] text-xs text-ink-3 max-[860px]:pl-3">
          <label className="inline-flex items-center gap-2 text-xs text-ink-3">
            <span>{t(($) => $.catalogue.row.alertMe)}</span>
            <Select
              size="sm"
              aria-label={t(($) => $.catalogue.row.reminderFor, { name: entry.name })}
              value={lead === null ? 'multi' : String(lead)}
              disabled={busy}
              onChange={(event) =>
                patch({
                  lead_seconds: withPrimaryLead(rule.lead_seconds, Number(event.target.value)),
                })
              }
            >
              {lead === null && (
                <option value="multi" disabled>
                  {t(($) => $.leadOption.several, {
                    list: rule.lead_seconds
                      .filter((l) => l > 0)
                      .sort((a, b) => b - a)
                      .map((l) => `${l / 60}`)
                      .join(', '),
                  })}
                </option>
              )}
              {lead !== null && lead > 0 && !QUICK_LEADS.includes(lead) && (
                <option value={lead}>{leadOption(t, lead)}</option>
              )}
              {QUICK_LEADS.map((s) => (
                <option key={s} value={s}>
                  {leadOption(t, s)}
                </option>
              ))}
              <option value={0}>{leadOption(t, 0)}</option>
            </Select>
          </label>
          {lead !== 0 && (
            <Checkbox
              className="items-center text-xs"
              label={
                <span className="text-xs text-ink-2">
                  {boss ? t(($) => $.catalogue.row.alsoSpawn) : t(($) => $.catalogue.row.alsoStart)}
                </span>
              }
              checked={atStart}
              disabled={busy}
              onCheckedChange={(checked) =>
                patch({ lead_seconds: withAtStart(rule.lead_seconds, checked) })
              }
            />
          )}
          <span className="inline-flex items-center gap-1.5">
            <Icon name={rule.sound === 'none' ? 'mute' : 'volume'} size={13} />
            <Select
              size="sm"
              aria-label={t(($) => $.catalogue.row.soundFor, { name: entry.name })}
              value={rule.sound}
              disabled={busy}
              onChange={(event) => patch({ sound: event.target.value as AlertSound })}
            >
              {SOUNDS.map((sound) => (
                <option key={sound} value={sound}>
                  {soundLabel(t, sound)}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={t(($) => $.catalogue.row.test, { name: entry.name })}
              title={t(($) => $.catalogue.row.testTitle)}
              disabled={rule.sound === 'none' && !rule.popup}
              onClick={() => ctx.onTest(rule.sound, rule.volume, rule.popup)}
            >
              <Icon name="play" size={13} />
            </Button>
          </span>
          {countdown?.notify === 'waiting_for_clock' && (
            <span className="text-warn">{t(($) => $.catalogue.row.waitingClock)}</span>
          )}
          {!config.enabled && <span>{t(($) => $.catalogue.row.notificationsOff)}</span>}
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                aria-label={t(($) => $.catalogue.row.moreFor, { name: entry.name })}
              />
            }
          >
            {t(($) => $.catalogue.row.more)}
            <Icon
              name="chevronDown"
              size={12}
              className={cn(
                'transition-transform duration-200 ease-grow',
                optionsOpen && 'rotate-180',
              )}
            />
          </CollapsibleTrigger>
        </div>
      )}
      <CollapsiblePanel className="px-2 pb-3">
        <RuleEditor
          key={rule.id}
          initial={rule}
          isNew={false}
          preset={entry}
          dashboard={dashboard}
          config={config}
          now={ctx.now}
          busy={busy}
          onCancel={() => ctx.setOptions(null)}
          onTest={ctx.onTest}
          onSave={async (saved) => {
            const ok = await configure((c) => patchPreset(c, entry, saved));
            if (ok) ctx.setOptions(null);
            return ok;
          }}
        />
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** A category of the catalogue: a caps heading in the category's hue, then its list. */
function Section({
  id,
  title,
  icon,
  count,
  enabled,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  count: number;
  enabled: number;
  children: ReactNode;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  return (
    <section className="mt-6" aria-labelledby={id}>
      <h4
        id={id}
        className="m-0 mb-1 flex items-center gap-2 border-b border-line-soft pb-2 text-2xs font-semibold tracking-caps text-ink-2 uppercase"
      >
        {icon}
        {title}
        <small className="text-2xs font-normal tracking-normal text-ink-3 normal-case tabular-nums">
          {fmt.integer.format(count)}
          {enabled ? ` · ${t(($) => $.catalogue.on, { count: enabled })}` : ''}
        </small>
      </h4>
      {children}
    </section>
  );
}

/** Faction words carry a quiet tint of their own; the word itself always names it. */
const FACTION_TONE = {
  elyos: 'bg-pollen/14 text-pollen-ink',
  asmodian: 'bg-iris/16 text-iris-ink',
} as const;

function MapGroup({
  map,
  entries,
  ctx,
  open,
  onToggle,
}: {
  map: string;
  entries: AlertCatalogueEntry[];
  ctx: RowContext;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('alerts');
  const config = ctx.dashboard.config;
  const enabled = entries.filter((e) => presetRule(config, e).enabled).length;
  const factions = new Set(entries.map((e) => e.faction));
  const faction = factions.size === 1 ? [...factions][0]! : 'all';
  return (
    <Collapsible open={open} onOpenChange={onToggle} render={<li />} className="mt-1">
      <CollapsibleTrigger
        render={
          <Pressable className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-row-hover" />
        }
      >
        <Icon
          name="chevronRight"
          size={14}
          className={cn(
            'text-ink-3 transition-transform duration-200 ease-grow',
            open && 'rotate-90',
          )}
        />
        <b className="font-semibold">{map}</b>
        {faction !== 'all' && (
          <span
            className={cn(
              'rounded-full px-2 text-2xs leading-[18px] font-semibold',
              FACTION_TONE[faction],
            )}
          >
            {factionLabel(t, faction)}
          </span>
        )}
        <small className="ml-auto text-xs text-ink-3 tabular-nums">
          {t(($) => $.catalogue.bosses, { count: entries.length })}
          {enabled ? ` · ${t(($) => $.catalogue.on, { count: enabled })}` : ''}
        </small>
      </CollapsibleTrigger>
      {/* The bosses of a map hang from one branch. */}
      <CollapsiblePanel
        render={<ul />}
        className="m-0 mb-2 ml-[15px] list-none border-l border-line-soft p-0 pl-1"
        aria-label={t(($) => $.catalogue.mapBosses, { map })}
      >
        {entries.map((entry) => (
          <CatalogueRow key={entry.id} entry={entry} ctx={ctx} />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

const FACTION_OPTIONS: Exclude<AlertFactionSetting, 'auto'>[] = ['all', 'elyos', 'asmodian'];

/**
 * Every ready-made event and boss alert, listed from the first open. One switch turns an
 * entry on with sensible defaults; its reminder and sound sit inline, the rest behind More.
 */
export function AlertCatalogue({
  dashboard,
  nowMs,
  busy,
  configure,
  onTest,
  now,
  nextByRule,
  options,
  setOptions,
}: CatalogueProps) {
  const { t } = useTranslation('alerts');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const config = dashboard.config;
  const catalogue = dashboard.catalogue;
  const faction = viewFaction(dashboard);
  const searching = query.trim() !== '';
  const ctx: RowContext = {
    dashboard,
    nowMs,
    busy,
    configure,
    onTest,
    now,
    nextByRule,
    options,
    setOptions,
    countdowns: new Map(dashboard.catalogue_upcoming.map((c) => [c.entry_id, c])),
  };

  if (!catalogue.length)
    return (
      <AlertCard title={t(($) => $.catalogue.title)}>
        <EmptyState
          compact
          live
          icon={<Icon name="event" size={18} />}
          title={t(($) => $.catalogue.loadingTitle)}
        >
          {t(($) => $.catalogue.loadingBody)}
        </EmptyState>
      </AlertCard>
    );

  const isOn = (e: AlertCatalogueEntry) => presetRule(config, e).enabled;
  // An alert that is on is never hidden by the faction view.
  const visible = catalogue.filter(
    (e) =>
      (scope === 'all' || isOn(e)) &&
      (isOn(e) || factionMatches(e, faction)) &&
      catalogueMatches(e, query),
  );
  const totalOn = catalogue.filter(isOn).length;
  const events = visible.filter((e) => e.category === 'event');
  const world = visible.filter((e) => e.category === 'world_boss');
  const field = visible.filter((e) => e.category === 'field_boss');
  // Entries without a map share one group, keyed apart from any real map name.
  const OTHER = '\u0000other';
  const maps = new Map<string, AlertCatalogueEntry[]>();
  for (const e of field) {
    const key = e.map ?? OTHER;
    maps.set(key, [...(maps.get(key) ?? []), e]);
  }
  const countOn = (list: AlertCatalogueEntry[]) => list.filter(isOn).length;
  const autoName =
    dashboard.effective_faction === null
      ? t(($) => $.catalogue.automatic)
      : t(($) => $.catalogue.automaticFaction, {
          faction: factionLabel(t, dashboard.effective_faction),
        });
  const sectionIcon = (category: AlertCatalogueEntry['category']) => (
    <Icon name={CATEGORY[category].icon} size={14} className={CATEGORY_INK[category]} />
  );

  return (
    <AlertCard
      title={t(($) => $.catalogue.title)}
      icon={<Icon name="event" size={16} className="text-alert-event" />}
      subtitle={t(($) => $.catalogue.subtitle)}
      actions={
        <Badge tone={totalOn ? 'accent' : 'neutral'} dot={totalOn > 0}>
          {totalOn
            ? t(($) => $.catalogue.notifying, { count: totalOn })
            : t(($) => $.catalogue.countdownsOnly)}
        </Badge>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchInput
          wrapperClassName="min-w-52 flex-1"
          placeholder={t(($) => $.catalogue.searchPlaceholder)}
          aria-label={t(($) => $.catalogue.searchLabel)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <fieldset className="m-0 flex gap-1.5 border-0 p-0">
          <legend className="sr-only">{t(($) => $.catalogue.show)}</legend>
          <Chip pressed={scope === 'all'} onClick={() => setScope('all')}>
            {t(($) => $.catalogue.all)}
          </Chip>
          <Chip pressed={scope === 'enabled'} onClick={() => setScope('enabled')}>
            {t(($) => $.catalogue.notifyingFilter)}
          </Chip>
        </fieldset>
        <label className="inline-flex items-center gap-2 text-xs text-ink-3">
          <span>{t(($) => $.catalogue.faction)}</span>
          <Select
            size="sm"
            aria-label={t(($) => $.catalogue.faction)}
            wrapperClassName="min-w-40"
            value={config.faction}
            disabled={busy}
            onChange={(event) => {
              const faction = event.target.value as AlertFactionSetting;
              void configure((c) => ({ ...c, faction }));
            }}
          >
            <option value="auto">{autoName}</option>
            {FACTION_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {factionLabel(t, f)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {!visible.length && (
        <EmptyState
          compact
          className="mt-4"
          title={
            scope === 'enabled' && !searching
              ? t(($) => $.catalogue.emptyOnTitle)
              : t(($) => $.catalogue.noMatchTitle)
          }
        >
          {scope === 'enabled' && !searching
            ? t(($) => $.catalogue.emptyOnBody)
            : t(($) => $.catalogue.noMatchBody)}
        </EmptyState>
      )}

      {events.length > 0 && (
        <Section
          id="alerts-sec-event"
          title={categoryPlural(t, 'event')}
          icon={sectionIcon('event')}
          count={events.length}
          enabled={countOn(events)}
        >
          <ul className="m-0 list-none p-0" aria-label={categoryPlural(t, 'event')}>
            {events.map((entry) => (
              <CatalogueRow key={entry.id} entry={entry} ctx={ctx} />
            ))}
          </ul>
        </Section>
      )}
      {world.length > 0 && (
        <Section
          id="alerts-sec-world"
          title={categoryPlural(t, 'world_boss')}
          icon={sectionIcon('world_boss')}
          count={world.length}
          enabled={countOn(world)}
        >
          <ul className="m-0 list-none p-0" aria-label={categoryPlural(t, 'world_boss')}>
            {world.map((entry) => (
              <CatalogueRow key={entry.id} entry={entry} ctx={ctx} />
            ))}
          </ul>
        </Section>
      )}
      {field.length > 0 && (
        <Section
          id="alerts-sec-field"
          title={categoryPlural(t, 'field_boss')}
          icon={sectionIcon('field_boss')}
          count={field.length}
          enabled={countOn(field)}
        >
          <ul className="m-0 list-none p-0" aria-label={t(($) => $.catalogue.fieldByMap)}>
            {[...maps].map(([key, entries]) => (
              <MapGroup
                key={key}
                map={key === OTHER ? t(($) => $.catalogue.otherMap) : key}
                entries={entries}
                ctx={ctx}
                open={
                  searching ||
                  scope === 'enabled' ||
                  !collapsed.has(key) ||
                  entries.some((e) => e.id === options)
                }
                onToggle={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </Section>
      )}
    </AlertCard>
  );
}
