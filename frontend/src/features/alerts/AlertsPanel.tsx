import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Disclosure } from '../../components/ui/Disclosure';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Field, Input, SearchInput, Select, Switch } from '../../components/ui/Field';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { Trans, useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  AlertActionName,
  AlertCatalogueEntry,
  AlertCategory,
  AlertConfig,
  AlertDashboard,
  AlertDelivery,
  AlertOccurrence,
  AlertRule,
  AlertSound,
  ObservedTimer,
} from '../../types/alerts';
import { AlertCatalogue } from './AlertCatalogue';
import {
  CATEGORY,
  CATEGORY_ORDER,
  MAX_RULES,
  MUTE_OPTIONS,
  SNOOZE_SECONDS,
  categoryPlural,
  clockIn,
  customRules,
  deliveryName,
  describeSchedule,
  duplicateRule,
  enablePreset,
  inQuietHours,
  leadChip,
  localTimeZone,
  matchesQuery,
  minuteOfDay,
  muteLabel,
  needsClock,
  newRule,
  nextUp,
  type NextRow,
  type NotifyState,
  patchRule,
  phaseLabel,
  presetRule,
  remaining,
  removeRule,
  snoozable,
  ruleFromObserved,
  ruleFromTemplate,
  ruleZone,
  statusLabel,
  templateEligible,
  timeZones,
  upsertRule,
  validateQuietHours,
  zoneAbbr,
} from './model';
import {
  AlertCard,
  CategoryIcon,
  Chapter,
  Countdown,
  listRow,
  RowText,
  StateTag,
  type StateKind,
} from './parts';
import { MaintenanceChapter, NoticeLink } from './MaintenanceChapter';
import { RuleEditor } from './RuleEditor';
import { useClock } from './useClock';

/** What the panel needs from the alerts hook. */
export interface AlertsController {
  native: boolean;
  dashboard: AlertDashboard | null;
  error: string;
  busy: boolean;
  /** Native clock minus this PC's clock. */
  offsetMs: number;
  configure: (change: (config: AlertConfig) => AlertConfig) => Promise<boolean>;
  action: (name: AlertActionName, id?: string | null, seconds?: number | null) => Promise<boolean>;
  test: (sound: AlertSound, volume: number, popup: boolean) => Promise<boolean>;
  /** Native time now, for event handlers. */
  now: () => number;
}

type Filter = AlertCategory | 'all';
interface Editing {
  rule: AlertRule;
  isNew: boolean;
}
/** A confirmation shown after a preview, worded at render time. */
type TestNotice = 'popup' | 'sound' | 'devPopup';

const UPCOMING_LIMIT = 12;
const HISTORY_LIMIT = 40;
/** Custom alerts get search and filters once there are more than this many. */
const CUSTOM_FILTER_MIN = 5;
/** Whole percent, as the volume sliders step. */
const PERCENT = { style: 'percent', maximumFractionDigits: 0 } as const;

/* ---------- Header ---------- */

function MuteControl({
  config,
  nowMs,
  busy,
  onMute,
  onUnmute,
}: {
  config: AlertConfig;
  nowMs: number;
  busy: boolean;
  onMute: (seconds: number) => void;
  onUnmute: () => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const muted = config.muted_until_ms !== null && config.muted_until_ms > nowMs;
  if (muted)
    return (
      <span className="inline-flex items-center gap-2">
        <Badge tone="warn" icon={<Icon name="bellOff" size={12} />}>
          {t(($) => $.mute.mutedUntil, {
            time: clockIn(fmt, config.muted_until_ms ?? 0, undefined, nowMs),
          })}
        </Badge>
        <Button size="sm" disabled={busy} onClick={onUnmute} icon={<Icon name="bell" size={14} />}>
          {t(($) => $.mute.unmute)}
        </Button>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 text-ink-3">
      <Icon name="mute" size={14} />
      <Select
        size="sm"
        aria-label={t(($) => $.mute.label)}
        value=""
        disabled={busy || !config.enabled}
        onChange={(event) => {
          const seconds = Number(event.target.value);
          if (seconds > 0) onMute(seconds);
        }}
      >
        <option value="">{t(($) => $.mute.placeholder)}</option>
        {MUTE_OPTIONS.map((seconds) => (
          <option key={seconds} value={seconds}>
            {muteLabel(t, seconds)}
          </option>
        ))}
      </Select>
    </span>
  );
}

/** Master volume: drags locally and saves once the hand stops moving. */
function MasterVolume({
  volume,
  onCommit,
}: {
  volume: number;
  onCommit: (volume: number) => Promise<boolean>;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const value = draft ?? Math.round(volume * 100);
  return (
    <label
      className="inline-flex items-center gap-2.5 text-xs text-ink-3"
      title={t(($) => $.volume.title)}
    >
      <Icon name={value === 0 ? 'mute' : 'volume'} size={14} />
      <input
        type="range"
        data-ui="range"
        className="h-6 w-28 cursor-pointer accent-accent"
        min={0}
        max={100}
        step={5}
        aria-label={t(($) => $.volume.label)}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          setDraft(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            void onCommit(next / 100).finally(() => setDraft(null));
          }, 300);
        }}
      />
      <output className="min-w-9 text-left text-sm text-ink-2">
        {fmt.numberWith(PERCENT).format(value / 100)}
      </output>
    </label>
  );
}

/* ---------- Active and upcoming ---------- */

function ActiveList({
  active,
  nowMs,
  busy,
  onAction,
}: {
  active: AlertDelivery[];
  nowMs: number;
  busy: boolean;
  onAction: AlertsController['action'];
}) {
  const { t } = useTranslation('alerts');
  if (!active.length) return null;
  return (
    <AlertCard
      tone="warn"
      title={t(($) => $.active.title)}
      icon={
        <span className="grid size-7 animate-breathe place-items-center rounded-full bg-warn-soft text-warn">
          <Icon name="bellRing" size={15} />
        </span>
      }
      subtitle={t(($) => $.active.subtitle)}
      actions={
        active.length > 1 && (
          <Button size="sm" disabled={busy} onClick={() => void onAction('dismiss_all')}>
            {t(($) => $.active.dismissAll)}
          </Button>
        )
      }
    >
      <ul className="m-0 list-none p-0">
        {active.map((d) => (
          <li key={d.id} className={cn(listRow, 'flex-wrap py-2.5')}>
            <CategoryIcon category={d.category} />
            <RowText
              name={deliveryName(t, d)}
              detail={
                <>
                  {phaseLabel(t, d)}
                  {d.due_ms > nowMs
                    ? ` · ${t(($) => $.active.startsIn, { time: remaining(t, d.due_ms - nowMs) })}`
                    : ''}
                </>
              }
            />
            <span className="flex shrink-0 items-center gap-1.5">
              {snoozable(d) && (
                <Button
                  size="xs"
                  disabled={busy}
                  icon={<Icon name="snooze" size={12} />}
                  onClick={() => void onAction('snooze', d.id, SNOOZE_SECONDS)}
                >
                  {t(($) => $.active.snooze)}
                </Button>
              )}
              <Button size="xs" disabled={busy} onClick={() => void onAction('dismiss', d.id)}>
                {t(($) => $.actions.dismiss, { ns: 'common' })}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </AlertCard>
  );
}

const NOTIFY_MARK: Record<NotifyState, { icon: IconName; className: string }> = {
  on: { icon: 'bellRing', className: 'text-ink-2' },
  off: { icon: 'bellOff', className: 'text-ink-4' },
  waiting_for_clock: { icon: 'bell', className: 'text-warn' },
};

/** Whether a countdown also sounds or pops up, as an icon with its meaning spelled out. */
function NotifyMark({ notify }: { notify: NotifyState }) {
  const { t } = useTranslation('alerts');
  const mark = NOTIFY_MARK[notify];
  const label = t(($) => $.notify[notify]);
  return (
    <span className={cn('mr-1 inline-flex align-[-2px]', mark.className)} title={label}>
      <Icon name={mark.icon} size={11} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Tag for what the countdown cannot say. The fallback clock is named once in the card
 * header, so rows only carry "~" and their basis in the tooltip.
 */
function stateChip(t: Translate<'alerts'>, row: NextRow, left: number | null) {
  if (row.state === 'open') return <StateTag kind="open">{t(($) => $.upcoming.open)}</StateTag>;
  if (row.state === 'unknown' || left === null)
    return <StateTag kind="unknown">{t(($) => $.upcoming.unknown)}</StateTag>;
  if (row.estimated && !row.fallback)
    return (
      <StateTag kind="estimate" title={row.basis}>
        {t(($) => $.upcoming.estimate)}
      </StateTag>
    );
  return null;
}

/**
 * What comes next, hung on one thread in time order: each event a seed on the line, the
 * ones close at hand lit.
 */
function Upcoming({
  dashboard,
  nowMs,
  busy,
  onSkip,
  onEdit,
  onEditEntry,
}: {
  dashboard: AlertDashboard;
  nowMs: number;
  busy: boolean;
  onSkip: (ruleId: string) => void;
  onEdit: (ruleId: string) => void;
  onEditEntry: (entryId: string) => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const config = dashboard.config;
  const list = nextUp(dashboard, UPCOMING_LIMIT);
  const clock = dashboard.effective_timezone;
  const zoneTag = zoneAbbr(fmt, clock, nowMs);
  return (
    <AlertCard
      title={t(($) => $.upcoming.title)}
      icon={<Icon name="hourglass" size={16} className="text-accent" />}
      subtitle={
        <>
          {dashboard.clock_estimated
            ? t(($) => $.upcoming.fallbackClock, { zone: zoneTag })
            : t(($) => $.upcoming.serverTime, { zone: zoneTag })}
          <span className="mt-1 flex flex-wrap gap-x-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <Icon name="bellRing" size={11} /> {t(($) => $.upcoming.notifies)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="bellOff" size={11} /> {t(($) => $.upcoming.countdownOnly)}
            </span>
          </span>
        </>
      }
    >
      {list.length ? (
        <ol
          className={cn(
            'relative m-0 list-none p-0',
            // The thread the events hang on.
            'before:absolute before:top-4 before:bottom-4 before:left-[13.5px] before:w-px before:bg-line',
          )}
          aria-label={t(($) => $.upcoming.listLabel)}
        >
          {list.map((row) => {
            const left = row.due_ms === null ? null : row.due_ms - nowMs;
            const rule = config.rules.find((r) => r.id === row.ruleId);
            const soon = left !== null && left > 0 && left <= 5 * 60_000;
            const open = row.state === 'open';
            const approx = row.estimated ? '~' : '';
            const name = row.name || t(($) => $.unnamedLower);
            return (
              <li
                key={row.key}
                data-soon={soon || undefined}
                className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5"
              >
                <CategoryIcon
                  category={row.category}
                  className={cn(
                    'row-span-2',
                    soon && 'shadow-[0_0_0_3px_var(--color-warn-soft)]',
                    open && 'shadow-[0_0_0_3px_var(--color-accent-soft)]',
                  )}
                />
                <b className="truncate text-sm font-semibold text-ink" title={row.name}>
                  {row.name || t(($) => $.unnamed)}
                </b>
                <span className="flex items-center justify-end gap-1.5">
                  {stateChip(t, row, left)}
                  <Countdown
                    size="sm"
                    tone={soon ? 'soon' : open ? 'open' : undefined}
                    aria-label={t(($) => $.upcoming.timeLeft)}
                  >
                    {left === null
                      ? '—'
                      : open
                        ? t(($) => $.upcoming.openShort)
                        : `${approx}${remaining(t, left)}`}
                  </Countdown>
                </span>
                <small className="truncate text-xs text-ink-3" title={row.basis}>
                  <NotifyMark notify={row.notify} />
                  {row.due_ms !== null ? (
                    <>
                      {approx}
                      {clockIn(fmt, row.due_ms, row.zone, nowMs)}{' '}
                      {zoneAbbr(fmt, row.zone, row.due_ms)}
                      <span className="text-ink-4">
                        {' · '}
                        {t(($) => $.upcoming.local, {
                          time: clockIn(fmt, row.due_ms, undefined, nowMs),
                        })}
                      </span>
                    </>
                  ) : (
                    row.basis || t(($) => $.upcoming.noSchedule)
                  )}
                  {row.server ? ` · ${row.server}` : ''}
                </small>
                <span className="-my-0.5 flex justify-end gap-0.5">
                  {left !== null && row.skippable && (
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      aria-label={t(($) => $.upcoming.skip, { name })}
                      title={t(($) => $.upcoming.skipTitle)}
                      disabled={busy}
                      onClick={() => onSkip(row.ruleId)}
                    >
                      <Icon name="skip" size={13} />
                    </Button>
                  )}
                  {(row.entryId !== null || rule) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      aria-label={t(($) => $.upcoming.edit, { name })}
                      title={
                        row.entryId !== null
                          ? t(($) => $.upcoming.optionsTitle)
                          : t(($) => $.actions.edit, { ns: 'common' })
                      }
                      onClick={() =>
                        row.entryId !== null ? onEditEntry(row.entryId) : onEdit(row.ruleId)
                      }
                    >
                      <Icon name="edit" size={13} />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          compact
          icon={<Icon name="hourglass" size={18} />}
          title={t(($) => $.upcoming.empty.title)}
        >
          {t(($) => $.upcoming.empty.body)}
        </EmptyState>
      )}
    </AlertCard>
  );
}

/* ---------- Rules ---------- */

/** Star that puts an alert on the watchlist; filled while it is on. */
function StarButton({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation('alerts');
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      aria-pressed={on}
      aria-label={t(($) => $.rule.watchlist, { name: label })}
      title={on ? t(($) => $.rule.watchlistRemove) : t(($) => $.rule.watchlistAdd)}
      disabled={disabled}
      className="text-ink-4 enabled:hover:bg-transparent enabled:hover:text-warn aria-pressed:bg-transparent aria-pressed:text-warn [&[aria-pressed=true]_svg]:fill-current"
      onClick={() => onChange(!on)}
    >
      <Icon name="star" size={15} />
    </Button>
  );
}

function RuleRow({
  rule,
  clock,
  clockReady,
  next,
  nowMs,
  busy,
  onPatch,
  onEdit,
  onDuplicate,
  onDelete,
  onTest,
}: {
  rule: AlertRule;
  clock: string;
  clockReady: boolean;
  next: AlertOccurrence | undefined;
  nowMs: number;
  busy: boolean;
  onPatch: (patch: Partial<AlertRule>) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const [confirm, setConfirm] = useState(false);
  const label = rule.name || t(($) => $.rule.untitled);
  const left = next?.due_ms != null ? next.due_ms - nowMs : null;
  const dim = !rule.enabled && 'opacity-55';
  return (
    <li
      data-state={rule.enabled ? 'on' : 'off'}
      className={cn(listRow, 'flex-wrap gap-y-1 py-2.5 min-[860px]:flex-nowrap')}
    >
      <StarButton
        on={rule.favorite}
        label={label}
        disabled={busy}
        onChange={(favorite) => onPatch({ favorite })}
      />
      <span
        className="inline-flex"
        title={rule.enabled ? t(($) => $.rule.enabled) : t(($) => $.rule.disabled)}
      >
        <Switch
          aria-label={t(($) => $.rule.enable, { name: label })}
          checked={rule.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => onPatch({ enabled })}
        />
      </span>
      <CategoryIcon category={rule.category} className={cn(dim)} />
      <span className={cn('flex min-w-0 flex-1 basis-[calc(100%-8rem)] flex-col gap-px', dim)}>
        <b className="truncate text-sm font-semibold text-ink">{label}</b>
        <small className="truncate text-xs text-ink-3">
          {describeSchedule(t, fmt, rule.schedule, ruleZone(rule, clock))}
          {needsClock(rule, clockReady) && (
            <span className="text-warn"> · {t(($) => $.rule.fallbackClock)}</span>
          )}
        </small>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {[...rule.lead_seconds]
            .sort((a, b) => b - a)
            .map((lead) => (
              <Badge key={lead} shape="tag" className="font-medium tabular-nums">
                {leadChip(t, lead)}
              </Badge>
            ))}
          <span
            className="ml-1 inline-flex items-center gap-1 text-2xs text-ink-3"
            title={t(($) => $.rule.soundPopup)}
          >
            <Icon name={rule.sound === 'none' ? 'mute' : 'volume'} size={12} />
            {rule.sound === 'none'
              ? t(($) => $.rule.silent)
              : fmt.numberWith(PERCENT).format(rule.volume)}
            {rule.popup && (
              <>
                {' · '}
                <Icon name="bellRing" size={12} /> {t(($) => $.rule.popup)}
              </>
            )}
          </span>
        </span>
      </span>
      <Countdown
        aria-label={t(($) => $.rule.next)}
        size="sm"
        className={cn('min-w-14', dim)}
        title={rule.enabled ? undefined : t(($) => $.rule.countdownOnly)}
      >
        {!rule.enabled && left === null
          ? t(($) => $.rule.off)
          : rule.schedule === null
            ? t(($) => $.rule.unknown)
            : left === null
              ? next?.state === 'open'
                ? t(($) => $.rule.open)
                : '—'
              : `${next?.estimated ? '~' : ''}${remaining(t, left)}`}
      </Countdown>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t(($) => $.rule.test, { name: label })}
          title={t(($) => $.rule.testTitle)}
          onClick={onTest}
        >
          <Icon name="play" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t(($) => $.rule.edit, { name: label })}
          title={t(($) => $.actions.edit, { ns: 'common' })}
          onClick={onEdit}
        >
          <Icon name="edit" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t(($) => $.rule.duplicate, { name: label })}
          title={t(($) => $.rule.duplicateTitle)}
          onClick={onDuplicate}
        >
          <Icon name="duplicate" size={14} />
        </Button>
        {confirm ? (
          <Button
            variant="danger"
            size="xs"
            disabled={busy}
            onClick={onDelete}
            onBlur={() => setConfirm(false)}
          >
            {t(($) => $.rule.deleteConfirm)}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t(($) => $.rule.delete, { name: label })}
            title={t(($) => $.actions.delete, { ns: 'common' })}
            className="enabled:hover:bg-danger-soft enabled:hover:text-danger"
            onClick={() => setConfirm(true)}
          >
            <Icon name="trash" size={14} />
          </Button>
        )}
      </span>
    </li>
  );
}

function TemplatePicker({
  dashboard,
  onPick,
  onClose,
}: {
  dashboard: AlertDashboard;
  onPick: (rule: AlertRule) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Filter>('all');
  const config = dashboard.config;
  const regionName = (id: string) => dashboard.regions.find((r) => r.id === id)?.name ?? id;
  const q = query.trim().toLowerCase();
  const list = dashboard.templates.filter(
    (template) =>
      (category === 'all' || template.category === category) &&
      (!q ||
        `${template.name} ${template.notes} ${template.source ?? ''}`.toLowerCase().includes(q)),
  );
  return (
    <Panel
      as="section"
      variant="flat"
      padding="none"
      aria-label={t(($) => $.templates.label)}
      className="mb-4 flex animate-sprout flex-col gap-3 p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="m-0 text-md font-semibold text-ink">{t(($) => $.templates.title)}</h4>
          <p className="mt-0.5 mb-0 text-sm text-ink-3">{t(($) => $.templates.intro)}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t(($) => $.templates.close)}
          onClick={onClose}
        >
          <Icon name="close" size={15} />
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchInput
          wrapperClassName="min-w-48 flex-1"
          placeholder={t(($) => $.templates.search)}
          aria-label={t(($) => $.templates.search)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <CategoryFilter value={category} onChange={setCategory} />
      </div>
      {list.length ? (
        <ul className="m-0 max-h-[420px] list-none overflow-auto p-0 pr-1">
          {list.map((template) => {
            const eligible = templateEligible(template, config.region);
            const when = [
              template.schedule
                ? describeSchedule(t, fmt, template.schedule, dashboard.effective_timezone)
                : t(($) => $.templates.timeUnknown),
              template.duration_seconds > 0
                ? t(($) => $.templates.open, {
                    minutes: Math.round(template.duration_seconds / 60),
                  })
                : '',
            ];
            const where = [
              template.regions.length
                ? template.regions.map(regionName).join(', ')
                : t(($) => $.templates.allRegions),
              eligible ? '' : t(($) => $.templates.notListed),
              template.source ? t(($) => $.templates.source, { source: template.source }) : '',
            ];
            return (
              <li
                key={template.id}
                className={cn(listRow, 'items-start py-2.5', !eligible && 'opacity-70')}
              >
                <CategoryIcon category={template.category} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {template.name}
                    {template.verified ? (
                      <StateTag kind="good">{t(($) => $.templates.verified)}</StateTag>
                    ) : (
                      <StateTag kind="unknown">{t(($) => $.templates.unverified)}</StateTag>
                    )}
                  </b>
                  <small className="text-xs text-ink-3">{when.filter(Boolean).join(' · ')}</small>
                  <small className="text-xs text-ink-3">{where.filter(Boolean).join(' · ')}</small>
                  {template.notes && <small className="text-xs text-ink-2">{template.notes}</small>}
                </span>
                <Button
                  size="xs"
                  icon={<Icon name="plus" size={12} />}
                  onClick={() => onPick(ruleFromTemplate(t, template))}
                >
                  {t(($) => $.templates.use)}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact title={t(($) => $.templates.empty.title)}>
          {t(($) => $.templates.empty.body)}
        </EmptyState>
      )}
    </Panel>
  );
}

function CategoryFilter({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }) {
  const { t } = useTranslation('alerts');
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
      <legend className="sr-only">{t(($) => $.filter.category)}</legend>
      <Chip pressed={value === 'all'} onClick={() => onChange('all')}>
        {t(($) => $.filter.all)}
      </Chip>
      {CATEGORY_ORDER.map((c) => (
        <Chip
          key={c}
          pressed={value === c}
          icon={<Icon name={CATEGORY[c].icon} size={12} />}
          onClick={() => onChange(c)}
        >
          {categoryPlural(t, c)}
        </Chip>
      ))}
    </fieldset>
  );
}

/* ---------- Side panels ---------- */

function ClockChapter({
  dashboard,
  nowMs,
  busy,
  onConfigure,
}: {
  dashboard: AlertDashboard;
  nowMs: number;
  busy: boolean;
  onConfigure: AlertsController['configure'];
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const config = dashboard.config;
  const zones = useMemo(() => timeZones(), []);
  // 'global' is automatic: the region follows the character's server once it is known.
  const auto = config.region === 'global';
  const servers = dashboard.servers.filter((s) => auto || s.region === config.region);
  const detected = dashboard.detected_server;
  const clock = dashboard.effective_timezone;
  const fallback = dashboard.clock_estimated;
  const regionName = (id: string | null) =>
    id ? (dashboard.regions.find((r) => r.id === id)?.name ?? id) : null;
  // Only a real region is "followed"; the fallback clock is never presented as detected.
  const following =
    auto && !fallback && dashboard.effective_region !== 'global'
      ? regionName(dashboard.effective_region)
      : null;
  return (
    <Chapter id="alerts-clock" title={t(($) => $.clock.title)} icon="calendar">
      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft">
        <div className="min-w-0 bg-surface-2 px-3 py-2">
          <dt className="truncate text-2xs font-semibold tracking-caps text-ink-3 uppercase">
            {fallback ? t(($) => $.clock.fallback) : t(($) => $.clock.server)}
          </dt>
          <dd className="m-0 text-xl font-semibold tracking-tight text-ink tabular-nums">
            {clockIn(fmt, nowMs, clock)}{' '}
            <small className="font-sans text-2xs font-normal tracking-normal text-ink-3">
              {zoneAbbr(fmt, clock, nowMs)}
              {fallback ? ` · ${t(($) => $.clock.notDetected)}` : ''}
            </small>
          </dd>
        </div>
        <div className="min-w-0 bg-surface-2 px-3 py-2">
          <dt className="truncate text-2xs font-semibold tracking-caps text-ink-3 uppercase">
            {t(($) => $.clock.pc)}
          </dt>
          <dd className="m-0 text-xl font-semibold tracking-tight text-ink tabular-nums">
            {clockIn(fmt, nowMs)}{' '}
            <small className="font-sans text-2xs font-normal tracking-normal text-ink-3">
              {zoneAbbr(fmt, localTimeZone(), nowMs)}
            </small>
          </dd>
        </div>
      </dl>
      <Field
        label={t(($) => $.clock.region)}
        hint={
          !auto
            ? t(($) => $.clock.regionManual)
            : following
              ? t(($) => $.clock.regionFollowing, { region: following })
              : t(($) => $.clock.regionAuto)
        }
      >
        {(id) => (
          <Select
            id={id}
            value={config.region}
            disabled={busy}
            onChange={(event) => {
              const region = event.target.value;
              const zone = dashboard.regions.find((r) => r.id === region)?.timezone;
              void onConfigure((c) => ({
                ...c,
                region,
                ...(zone && region !== 'global' ? { timezone: zone } : {}),
                server: dashboard.servers.some((s) => s.id === c.server && s.region === region)
                  ? c.server
                  : '',
              }));
            }}
          >
            <option value="global">
              {auto && following
                ? t(($) => $.clock.regionAutomaticFollowing, { region: following })
                : t(($) => $.clock.regionAutomatic)}
            </option>
            {dashboard.regions
              .filter((r) => r.id !== 'global')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field
        label={t(($) => $.clock.serverLabel)}
        hint={
          detected
            ? t(($) => $.clock.serverDetected, { name: detected.name })
            : t(($) => $.clock.serverNone)
        }
      >
        {(id) => (
          <Select
            id={id}
            value={config.server}
            disabled={busy}
            onChange={(event) => {
              const server = event.target.value;
              void onConfigure((c) => ({ ...c, server }));
            }}
          >
            <option value="">
              {detected
                ? t(($) => $.clock.serverAutomaticDetected, { name: detected.name })
                : t(($) => $.clock.serverAutomatic)}
            </option>
            {config.server && !servers.some((s) => s.id === config.server) && (
              <option value={config.server}>{config.server}</option>
            )}
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {auto && (
        <Disclosure
          variant="plain"
          open={fallback}
          className="-mt-1"
          summaryClassName="py-1.5 text-xs text-ink-3"
          bodyClassName="pt-1.5 pb-0 pl-0"
          summary={t(($) => $.clock.fallbackSummary, { zone: config.timezone })}
        >
          <Field label={t(($) => $.clock.timezone)} hint={t(($) => $.clock.timezoneHint)}>
            {(id) => (
              <Select
                id={id}
                value={config.timezone}
                disabled={busy}
                onChange={(event) => {
                  const timezone = event.target.value;
                  void onConfigure((c) => ({ ...c, timezone }));
                }}
              >
                {!zones.includes(config.timezone) && (
                  <option value={config.timezone}>{config.timezone}</option>
                )}
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Disclosure>
      )}
    </Chapter>
  );
}

function DeliveryChapter({
  config,
  gameRunning,
  clock,
  nowMs,
  busy,
  onConfigure,
}: {
  config: AlertConfig;
  gameRunning: boolean | null;
  clock: string;
  nowMs: number;
  busy: boolean;
  onConfigure: AlertsController['configure'];
}) {
  const { t } = useTranslation('alerts');
  const [start, setStart] = useState(config.quiet_hours?.start ?? '23:00');
  const [end, setEnd] = useState(config.quiet_hours?.end ?? '07:00');
  const quietError = validateQuietHours(t, start, end);
  const savedQuiet = config.quiet_hours;
  const dirty = savedQuiet !== null && (savedQuiet.start !== start || savedQuiet.end !== end);
  const quietNow = inQuietHours(minuteOfDay(nowMs, clock), savedQuiet);
  return (
    <Chapter title={t(($) => $.delivery.title)} icon="volume">
      <Switch
        checked={config.background_sound}
        disabled={busy}
        onCheckedChange={(background_sound) =>
          void onConfigure((c) => ({ ...c, background_sound }))
        }
        label={t(($) => $.delivery.background)}
        hint={t(($) => $.delivery.backgroundHint)}
      />
      <Switch
        checked={config.alert_when_game_closed}
        disabled={busy}
        onCheckedChange={(alert_when_game_closed) =>
          void onConfigure((c) => ({ ...c, alert_when_game_closed }))
        }
        label={t(($) => $.delivery.gameClosed)}
        hint={
          <>
            {config.alert_when_game_closed
              ? t(($) => $.delivery.gameClosedOn)
              : t(($) => $.delivery.gameClosedOff)}
            {gameRunning === false && <> {t(($) => $.delivery.gameClosedNow)}</>}
          </>
        }
      />
      <Switch
        checked={savedQuiet !== null}
        disabled={busy || (savedQuiet === null && quietError !== null)}
        onCheckedChange={(on) =>
          void onConfigure((c) => ({ ...c, quiet_hours: on ? { start, end } : null }))
        }
        label={
          <span className="inline-flex items-center gap-1.5">
            {t(($) => $.delivery.quiet)}
            {quietNow && <Icon name="quiet" size={12} className="text-info" />}
          </span>
        }
        hint={quietNow ? t(($) => $.delivery.quietNow) : t(($) => $.delivery.quietHint)}
      />
      <div className="flex flex-wrap items-end gap-2.5 pl-10.5">
        <Field label={t(($) => $.delivery.from)} error={quietError ?? undefined} className="w-28">
          {(id) => (
            <Input
              id={id}
              size="sm"
              type="time"
              step={60}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          )}
        </Field>
        <Field label={t(($) => $.delivery.to)} className="w-28">
          {(id) => (
            <Input
              id={id}
              size="sm"
              type="time"
              step={60}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          )}
        </Field>
        {dirty && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy || quietError !== null}
            onClick={() => void onConfigure((c) => ({ ...c, quiet_hours: { start, end } }))}
          >
            {t(($) => $.actions.save, { ns: 'common' })}
          </Button>
        )}
      </div>
      <small className="pl-10.5 text-2xs text-ink-3">
        {t(($) => $.delivery.quietClock, { zone: clock })}
      </small>
    </Chapter>
  );
}

function ObservedChapter({
  dashboard,
  nowMs,
  presetFor,
  onWatch,
}: {
  dashboard: AlertDashboard;
  nowMs: number;
  presetFor: (timer: ObservedTimer) => AlertCatalogueEntry | undefined;
  onWatch: (timer: ObservedTimer) => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const rules = dashboard.config.rules;
  const watched = (timer: ObservedTimer) => {
    const entry = presetFor(timer);
    if (entry) return presetRule(dashboard.config, entry).enabled;
    return rules.some(
      (r) =>
        r.schedule?.type === 'observed' &&
        ((timer.npc_id !== null && r.npc_id === timer.npc_id) ||
          (timer.event_id !== null && r.event_id === timer.event_id)),
    );
  };
  return (
    <Chapter title={t(($) => $.seen.title)} icon="observed">
      <p className="-mt-1.5 mb-0 text-xs leading-snug text-ink-3">{t(($) => $.seen.intro)}</p>
      {dashboard.observed.length ? (
        <ul className="m-0 list-none p-0">
          {dashboard.observed.map((timer) => {
            const left = timer.due_ms === null ? null : timer.due_ms - nowMs;
            const isWatched = watched(timer);
            return (
              <li key={timer.id} className={cn(listRow, 'gap-2.5 py-2')}>
                <CategoryIcon category={timer.category} size="sm" />
                <RowText
                  name={
                    timer.name ||
                    (timer.npc_id !== null
                      ? t(($) => $.draft.npc, { id: timer.npc_id })
                      : timer.event_id !== null
                        ? t(($) => $.draft.event, { id: timer.event_id })
                        : t(($) => $.draft.eventUnknown))
                  }
                  detail={t(($) => $.seen.detail, {
                    // Native's state is shown as it came; only a missing one is worded here.
                    state: timer.state || t(($) => $.seen.observed),
                    time: clockIn(fmt, timer.observed_ms, undefined, nowMs),
                  })}
                  detailTitle={timer.basis}
                />
                <Countdown size="sm">
                  {left === null || left <= 0
                    ? '—'
                    : `${timer.estimated ? '~' : ''}${remaining(t, left)}`}
                </Countdown>
                <Button
                  size="xs"
                  variant={isWatched ? 'ghost' : 'secondary'}
                  disabled={isWatched}
                  icon={isWatched ? <Icon name="check" size={12} /> : undefined}
                  onClick={() => onWatch(timer)}
                >
                  {isWatched ? t(($) => $.seen.watching) : t(($) => $.seen.watch)}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-xs text-ink-3">{t(($) => $.seen.empty)}</p>
      )}
    </Chapter>
  );
}

const STATUS_KIND: Record<AlertDelivery['status'], StateKind> = {
  delivered: 'good',
  quiet: 'estimate',
  muted: 'estimate',
  snoozed: 'estimate',
  dismissed: 'unknown',
  server_down: 'estimate',
  game_closed: 'estimate',
};

function HistoryChapter({
  history,
  nowMs,
  busy,
  onClear,
}: {
  history: AlertDelivery[];
  nowMs: number;
  busy: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const rows = [...history].sort((a, b) => b.fired_ms - a.fired_ms).slice(0, HISTORY_LIMIT);
  return (
    <Chapter
      title={t(($) => $.history.title)}
      icon="history"
      actions={
        <Button variant="ghost" size="xs" disabled={busy || !history.length} onClick={onClear}>
          {t(($) => $.history.clear)}
        </Button>
      }
    >
      {rows.length ? (
        <ul
          className="m-0 max-h-96 list-none overflow-auto p-0 pr-1"
          aria-label={t(($) => $.history.label)}
        >
          {rows.map((d) => (
            <li key={d.id} className={cn(listRow, 'gap-2.5 py-2')}>
              <CategoryIcon category={d.category} size="sm" />
              <RowText
                name={deliveryName(t, d)}
                detail={t(($) => $.history.detail, {
                  phase: phaseLabel(t, d),
                  time: clockIn(fmt, d.fired_ms, undefined, nowMs),
                })}
              />
              <StateTag kind={STATUS_KIND[d.status]}>{statusLabel(t, d.status)}</StateTag>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-ink-3">{t(($) => $.history.empty)}</p>
      )}
    </Chapter>
  );
}

/* ---------- Panel ---------- */

export function AlertsPanel({
  alerts,
  active,
  development = false,
}: {
  alerts: AlertsController;
  active: boolean;
  /** A confirmed development build: offers a silent test toast that shows outside the game. */
  development?: boolean;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const clock = useClock(1000, active);
  const { dashboard, busy } = alerts;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [templates, setTemplates] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Filter>('all');
  const [watchlist, setWatchlist] = useState(false);
  const [notice, setNotice] = useState<TestNotice | null>(null);
  /** Catalogue entry whose More options are open. */
  const [presetOptions, setPresetOptions] = useState<string | null>(null);

  useEffect(() => {
    if (presetOptions)
      document
        .getElementById(`alert-preset-${presetOptions}`)
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [presetOptions]);

  if (!dashboard)
    return (
      <EmptyState
        icon={<Icon name="bell" size={18} />}
        live={alerts.native && !alerts.error}
        title={
          alerts.native ? t(($) => $.panel.unavailable.title) : t(($) => $.panel.unavailable.native)
        }
      >
        {alerts.error ||
          (alerts.native
            ? t(($) => $.panel.unavailable.waiting)
            : t(($) => $.panel.unavailable.run))}
      </EmptyState>
    );

  const nowMs = clock + alerts.offsetMs;
  const config = dashboard.config;
  // Reminders held right now; with notifications off the off notice already says it all.
  const paused = config.enabled ? dashboard.delivery_paused : null;
  const maintenance = dashboard.server_status.maintenance;
  const catalogue = dashboard.catalogue;
  const nextByRule = new Map<string, AlertOccurrence>();
  for (const o of dashboard.upcoming) {
    const seen = nextByRule.get(o.rule_id);
    if (!seen || (o.due_ms ?? Infinity) < (seen.due_ms ?? Infinity)) nextByRule.set(o.rule_id, o);
  }
  const customs = customRules(config, catalogue);
  const rules = customs.filter(
    (r) =>
      (category === 'all' || r.category === category) &&
      (!watchlist || r.favorite) &&
      matchesQuery(t, r, query),
  );
  const sortedRules = [...rules].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      Number(b.enabled) - Number(a.enabled) ||
      a.name.localeCompare(b.name),
  );
  const full = config.rules.length >= MAX_RULES;
  const clockZone = dashboard.effective_timezone;

  const presetOf = (ruleId: string) => {
    const rule = config.rules.find((r) => r.id === ruleId);
    return rule?.preset_id ? catalogue.find((e) => e.id === rule.preset_id) : undefined;
  };
  const presetForTimer = (timer: ObservedTimer) =>
    catalogue.find((e) => {
      const rule = presetRule(config, e);
      return (
        (timer.npc_id !== null &&
          (e.members.some((m) => m.id === timer.npc_id) ||
            rule.npc_id === timer.npc_id ||
            rule.npc_ids.includes(timer.npc_id))) ||
        (timer.event_id !== null &&
          (rule.event_id === timer.event_id || rule.event_ids.includes(timer.event_id)))
      );
    });

  const open = (rule: AlertRule, isNew: boolean) => {
    setTemplates(false);
    setEditing({ rule, isNew });
  };
  const edit = (id: string) => {
    const entry = presetOf(id);
    if (entry) {
      setPresetOptions(entry.id);
      return;
    }
    const rule = config.rules.find((r) => r.id === id);
    if (rule) open(rule, false);
  };
  const test = (sound: AlertSound, volume: number, popup: boolean) =>
    void alerts.test(sound, volume, popup).then((ok) => {
      if (ok) setNotice(popup ? 'popup' : 'sound');
    });
  // Silent popup through the regular test path; Dev builds show it outside the game too.
  const testToast = () =>
    void alerts.test('none', 0, true).then((ok) => {
      if (ok) setNotice('devPopup');
    });

  return (
    <div className="flex flex-col gap-4 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="m-0 text-xl">{t(($) => $.panel.title)}</h2>
          <p className="mt-1 mb-0 text-sm leading-snug text-ink-3">{t(($) => $.panel.intro)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {development && (
            <span className="inline-flex items-center gap-2">
              <Badge tone="accent" variant="outline" shape="tag">
                {t(($) => $.panel.dev)}
              </Badge>
              <Button
                size="sm"
                disabled={busy}
                onClick={testToast}
                icon={<Icon name="bellRing" size={14} />}
                title={t(($) => $.panel.testToastHint)}
              >
                {t(($) => $.panel.testToast)}
              </Button>
            </span>
          )}
          <MasterVolume
            volume={config.volume}
            onCommit={(volume) => alerts.configure((c) => ({ ...c, volume }))}
          />
          <MuteControl
            config={config}
            nowMs={nowMs}
            busy={busy}
            onMute={(seconds) => void alerts.action('mute', null, seconds)}
            onUnmute={() => void alerts.action('unmute')}
          />
          <Switch
            className="items-center"
            checked={config.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => void alerts.configure((c) => ({ ...c, enabled }))}
            label={t(($) => $.panel.notifications)}
          />
        </div>
      </header>

      {(dashboard.error ||
        alerts.error ||
        notice ||
        !config.enabled ||
        paused ||
        dashboard.clock_estimated) && (
        <div className="flex flex-col [&>[data-ui=notice]]:my-0 gap-2">
          {dashboard.error && <Notice tone="error">{dashboard.error}</Notice>}
          {alerts.error && <Notice tone="error">{alerts.error}</Notice>}
          {notice && (
            <Notice tone="good" onDismiss={() => setNotice(null)}>
              {notice === 'popup'
                ? t(($) => $.panel.testSent)
                : notice === 'devPopup'
                  ? t(($) => $.panel.testToastSent)
                  : t(($) => $.panel.testSoundSent)}
            </Notice>
          )}
          {!config.enabled && (
            <Notice tone="info">
              {t(($) => $.panel.notificationsOff)}{' '}
              <Button
                variant="link"
                disabled={busy}
                onClick={() => void alerts.configure((c) => ({ ...c, enabled: true }))}
              >
                {t(($) => $.panel.turnOn)}
              </Button>
            </Notice>
          )}
          {paused === 'server_down' && (
            <Notice tone="warn">
              {maintenance && !maintenance.completed && maintenance.ends_ms > nowMs
                ? t(($) => $.panel.pausedMaintenanceUntil, {
                    time: `~${clockIn(fmt, maintenance.ends_ms, undefined, nowMs)}`,
                  })
                : t(($) => $.panel.pausedMaintenance)}{' '}
              {maintenance && <NoticeLink planned={maintenance} />}
            </Notice>
          )}
          {paused === 'game_closed' && (
            <Notice tone="info">
              <Trans
                t={t}
                i18nKey={($) => $.panel.pausedGameClosed}
                components={[
                  <Button
                    key="opt-in"
                    variant="link"
                    disabled={busy}
                    onClick={() =>
                      void alerts.configure((c) => ({ ...c, alert_when_game_closed: true }))
                    }
                  />,
                ]}
              />
            </Notice>
          )}
          {dashboard.clock_estimated && (
            <Notice tone="info">
              <Trans
                t={t}
                i18nKey={($) => $.panel.fallbackNotice}
                values={{ zone: clockZone }}
                components={[
                  <Button
                    key="region"
                    variant="link"
                    onClick={() =>
                      document.querySelector<HTMLSelectElement>('#alerts-clock select')?.focus()
                    }
                  />,
                ]}
              />
            </Notice>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <ActiveList
            active={dashboard.active}
            nowMs={nowMs}
            busy={busy}
            onAction={alerts.action}
          />
          <AlertCatalogue
            dashboard={dashboard}
            nowMs={nowMs}
            busy={busy}
            configure={alerts.configure}
            onTest={test}
            now={alerts.now}
            nextByRule={nextByRule}
            options={presetOptions}
            setOptions={setPresetOptions}
          />

          <AlertCard
            title={t(($) => $.custom.title)}
            icon={<Icon name="custom" size={16} className="text-alert-custom" />}
            subtitle={
              customs.length
                ? `${t(($) => $.custom.count, { count: customs.length })} · ${t(($) => $.custom.on, { count: customs.filter((r) => r.enabled).length })}`
                : t(($) => $.custom.empty)
            }
            actions={
              <>
                {dashboard.templates.length > 0 && (
                  <Button
                    size="sm"
                    disabled={full}
                    aria-expanded={templates}
                    icon={<Icon name="calendar" size={14} />}
                    onClick={() => {
                      setEditing(null);
                      setTemplates((shown) => !shown);
                    }}
                  >
                    {t(($) => $.custom.templates)}
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={full}
                  icon={<Icon name="plus" size={14} />}
                  onClick={() => open(newRule(category === 'all' ? 'custom' : category), true)}
                >
                  {t(($) => $.custom.new)}
                </Button>
              </>
            }
          >
            {full && <Notice tone="warn">{t(($) => $.custom.full, { max: MAX_RULES })}</Notice>}
            {templates && (
              <TemplatePicker
                dashboard={dashboard}
                onPick={(rule) => open(rule, true)}
                onClose={() => setTemplates(false)}
              />
            )}
            {editing && (
              <RuleEditor
                key={editing.rule.id}
                initial={editing.rule}
                isNew={editing.isNew}
                dashboard={dashboard}
                config={config}
                now={alerts.now}
                busy={busy}
                onCancel={() => setEditing(null)}
                onTest={test}
                onSave={async (rule) => {
                  const ok = await alerts.configure((c) => upsertRule(c, rule));
                  if (ok) setEditing(null);
                  return ok;
                }}
              />
            )}
            {customs.length > CUSTOM_FILTER_MIN && (
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <SearchInput
                  wrapperClassName="min-w-48 flex-1"
                  placeholder={t(($) => $.custom.searchPlaceholder)}
                  aria-label={t(($) => $.custom.searchLabel)}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <CategoryFilter value={category} onChange={setCategory} />
                <Chip
                  pressed={watchlist}
                  onPressedChange={setWatchlist}
                  icon={<Icon name="star" size={12} />}
                >
                  {t(($) => $.custom.watchlist)}
                </Chip>
              </div>
            )}
            {sortedRules.length > 0 && (
              <ul className="m-0 list-none p-0" aria-label={t(($) => $.custom.listLabel)}>
                {sortedRules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    clock={config.timezone}
                    clockReady={dashboard.clock_ready}
                    next={nextByRule.get(rule.id)}
                    nowMs={nowMs}
                    busy={busy}
                    onPatch={(patch) => void alerts.configure((c) => patchRule(c, rule.id, patch))}
                    onEdit={() => open(rule, false)}
                    onDuplicate={() => !full && open(duplicateRule(t, rule), true)}
                    onDelete={() => {
                      if (editing?.rule.id === rule.id) setEditing(null);
                      void alerts.configure((c) => removeRule(c, rule.id));
                    }}
                    onTest={() => test(rule.sound, rule.volume, rule.popup)}
                  />
                ))}
              </ul>
            )}
            {customs.length > 0 && !sortedRules.length && (
              <EmptyState compact title={t(($) => $.custom.noMatch.title)}>
                {t(($) => $.custom.noMatch.body)}
              </EmptyState>
            )}
          </AlertCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label={t(($) => $.panel.settingsLabel)}>
          <Upcoming
            dashboard={dashboard}
            nowMs={nowMs}
            busy={busy}
            onSkip={(id) => void alerts.action('skip', id)}
            onEdit={edit}
            onEditEntry={setPresetOptions}
          />
          <Panel padding="none" className="p-5 max-[760px]:p-4">
            <ClockChapter
              dashboard={dashboard}
              nowMs={nowMs}
              busy={busy}
              onConfigure={alerts.configure}
            />
            <MaintenanceChapter
              dashboard={dashboard}
              nowMs={nowMs}
              busy={busy}
              onConfigure={alerts.configure}
            />
            <DeliveryChapter
              gameRunning={dashboard.game_running}
              key={`${config.quiet_hours?.start ?? ''}-${config.quiet_hours?.end ?? ''}`}
              config={config}
              clock={clockZone}
              nowMs={nowMs}
              busy={busy}
              onConfigure={alerts.configure}
            />
          </Panel>
          <Panel padding="none" className="p-5 max-[760px]:p-4">
            <ObservedChapter
              dashboard={dashboard}
              nowMs={nowMs}
              presetFor={presetForTimer}
              onWatch={(timer) => {
                const entry = presetForTimer(timer);
                if (entry) void alerts.configure((c) => enablePreset(c, entry));
                else if (!full) open(ruleFromObserved(t, timer), true);
              }}
            />
            <HistoryChapter
              history={dashboard.history}
              nowMs={nowMs}
              busy={busy}
              onClear={() => void alerts.action('clear_history')}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
