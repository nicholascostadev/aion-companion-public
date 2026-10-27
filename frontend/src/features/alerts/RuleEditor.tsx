import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Notice } from '../../components/ui/Feedback';
import {
  controlClasses,
  Field,
  Input,
  SearchInput,
  Select,
  Switch,
  Textarea,
} from '../../components/ui/Field';
import { Icon, type IconName } from '../../components/ui/Icon';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  AlertCatalogueEntry,
  AlertConfig,
  AlertDashboard,
  AlertRule,
  AlertSchedule,
  AlertScheduleType,
  AlertSound,
} from '../../types/alerts';
import { FieldGroup, RangeField } from '../offline/SettingsLayout';
import {
  CATEGORY_ORDER,
  LEAD_PRESETS,
  MAX_LEADS,
  SOUNDS,
  WEEKDAYS,
  categoryLabel,
  describeSchedule,
  fromLocalInput,
  leadChip,
  leadLabel,
  needsClock,
  ruleZone,
  soundLabel,
  timeZones,
  toLocalInput,
  validateRule,
  weekdayLabel,
  type RuleErrors,
} from './model';

type ScheduleChoice = AlertScheduleType | 'unknown';

const MINUTE = 60_000;
const roundTo = (ms: number, step: number) => Math.ceil(ms / step) * step;
/** Whole percent, as the volume sliders step. */
const PERCENT = { style: 'percent', maximumFractionDigits: 0 } as const;

function defaultSchedule(type: ScheduleChoice, rule: AlertRule, now: number): AlertSchedule | null {
  switch (type) {
    case 'unknown':
      return null;
    case 'once':
      return { type: 'once', at_ms: roundTo(now + 60 * MINUTE, 5 * MINUTE) };
    case 'interval':
      return {
        type: 'interval',
        anchor_ms: roundTo(now, MINUTE),
        every_seconds: rule.respawn_seconds ?? 3600,
      };
    case 'calendar':
      return { type: 'calendar', times: [], weekdays: [] };
    case 'observed':
      return { type: 'observed' };
  }
}

/** Seconds shown in whole minutes or hours. */
function UnitSeconds({
  id,
  value,
  onChange,
  min = 1,
  units = ['min', 'h'],
}: {
  id: string;
  value: number;
  onChange: (seconds: number) => void;
  min?: number;
  units?: ('min' | 'h')[];
}) {
  const { t } = useTranslation('alerts');
  const [unit, setUnit] = useState<'min' | 'h'>(
    units.includes('h') && value >= 3600 && value % 3600 === 0 ? 'h' : 'min',
  );
  const scale = unit === 'h' ? 3600 : 60;
  return (
    <span className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        className="w-24 tabular-nums"
        min={min}
        step={1}
        value={Number.isFinite(value) ? Math.round((value / scale) * 100) / 100 : ''}
        onChange={(event) => onChange(Math.round(Number(event.target.value) * scale))}
      />
      {units.length > 1 ? (
        <Select
          aria-label={t(($) => $.editor.unit)}
          wrapperClassName="w-28"
          value={unit}
          onChange={(event) => setUnit(event.target.value as 'min' | 'h')}
        >
          <option value="min">{t(($) => $.editor.minutes)}</option>
          <option value="h">{t(($) => $.editor.hours)}</option>
        </Select>
      ) : (
        <span className="text-xs text-ink-3">
          {unit === 'h' ? t(($) => $.editor.hours) : t(($) => $.editor.minutes)}
        </span>
      )}
    </span>
  );
}

/** A value in a removable list (a reminder, a time): the word, then a small ✕. */
function RemovableTag({
  children,
  removeLabel,
  onRemove,
}: {
  children: ReactNode;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <li>
      <Badge tone="accent" className="gap-0.5 pr-0.5 text-ink tabular-nums">
        {children}
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          className="size-5 text-ink-2"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <Icon name="close" size={12} />
        </Button>
      </Badge>
    </li>
  );
}

const legendClass = 'mb-1.5 p-0 text-xs font-semibold text-ink-2';

function LeadEditor({
  leads,
  onChange,
  error,
}: {
  leads: number[];
  onChange: (leads: number[]) => void;
  error?: string | undefined;
}) {
  const { t } = useTranslation('alerts');
  const [custom, setCustom] = useState('');
  const sorted = [...leads].sort((a, b) => b - a);
  const add = (seconds: number) => {
    if (!leads.includes(seconds) && leads.length < MAX_LEADS) onChange([...leads, seconds]);
  };
  const customSeconds = Math.round(Number(custom) * 60);
  const customValid =
    custom !== '' &&
    Number.isFinite(customSeconds) &&
    customSeconds >= 0 &&
    customSeconds <= 86_400;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      {/* The block heading above already says Reminders; the legend still names the group. */}
      <legend className="sr-only">{t(($) => $.editor.remindersLegend)}</legend>
      <ul
        className="m-0 flex list-none flex-wrap gap-1.5 p-0"
        aria-label={t(($) => $.editor.remindersList)}
      >
        {sorted.map((lead) => (
          <RemovableTag
            key={lead}
            removeLabel={t(($) => $.editor.removeReminder, { lead: leadLabel(t, lead) })}
            onRemove={() => onChange(leads.filter((l) => l !== lead))}
          >
            {leadLabel(t, lead)}
          </RemovableTag>
        ))}
        {!sorted.length && (
          <li>
            <Badge
              variant="outline"
              className={cn('border-dashed text-ink-3', error && 'border-danger')}
            >
              {t(($) => $.editor.noReminders)}
            </Badge>
          </li>
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        {LEAD_PRESETS.filter((p) => !leads.includes(p)).map((preset) => (
          <Chip
            key={preset}
            disabled={leads.length >= MAX_LEADS}
            icon={<Icon name="plus" size={11} />}
            onClick={() => add(preset)}
          >
            {leadChip(t, preset)}
          </Chip>
        ))}
        <span className="ml-1 inline-flex items-center gap-1.5">
          <Input
            size="sm"
            type="number"
            className="w-20 tabular-nums"
            min={0}
            max={1440}
            step={1}
            placeholder={t(($) => $.editor.customPlaceholder)}
            aria-label={t(($) => $.editor.customLabel)}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <Button
            size="xs"
            disabled={!customValid || leads.includes(customSeconds) || leads.length >= MAX_LEADS}
            onClick={() => {
              add(customSeconds);
              setCustom('');
            }}
          >
            {t(($) => $.editor.addReminder)}
          </Button>
        </span>
      </div>
      {error ? (
        <small className="text-2xs text-danger" role="alert">
          {error}
        </small>
      ) : (
        <small className="text-2xs text-ink-3">{t(($) => $.editor.remindersHint)}</small>
      )}
    </fieldset>
  );
}

function CalendarEditor({
  schedule,
  onChange,
  error,
}: {
  schedule: Extract<AlertSchedule, { type: 'calendar' }>;
  onChange: (schedule: AlertSchedule) => void;
  error?: string | undefined;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const [time, setTime] = useState('');
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && !schedule.times.includes(time);
  const add = () => {
    if (!valid) return;
    onChange({ ...schedule, times: [...schedule.times, time].sort() });
    setTime('');
  };
  const toggleDay = (day: number) =>
    onChange({
      ...schedule,
      weekdays: schedule.weekdays.includes(day)
        ? schedule.weekdays.filter((d) => d !== day)
        : [...schedule.weekdays, day].sort((a, b) => a - b),
    });
  return (
    <>
      <Field label={t(($) => $.editor.times)} error={error} wide>
        {(id) => (
          <div className="flex flex-col gap-2">
            {schedule.times.length > 0 && (
              <ul
                className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                aria-label={t(($) => $.editor.timesList)}
              >
                {schedule.times.map((time) => (
                  <RemovableTag
                    key={time}
                    removeLabel={t(($) => $.editor.removeTime, { time })}
                    onRemove={() =>
                      onChange({ ...schedule, times: schedule.times.filter((x) => x !== time) })
                    }
                  >
                    {time}
                  </RemovableTag>
                ))}
              </ul>
            )}
            <span className="flex items-center gap-2">
              <Input
                id={id}
                type="time"
                className="w-32"
                step={60}
                value={time}
                onChange={(event) => setTime(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!valid}
                icon={<Icon name="plus" size={13} />}
                onClick={add}
              >
                {t(($) => $.editor.addTime)}
              </Button>
            </span>
          </div>
        )}
      </Field>
      <fieldset className="col-span-full m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className={legendClass}>{t(($) => $.editor.days)}</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => (
            <Chip
              key={day}
              className="min-w-11 justify-center"
              pressed={schedule.weekdays.includes(day)}
              onClick={() => toggleDay(day)}
            >
              {weekdayLabel(fmt, day)}
            </Chip>
          ))}
        </div>
        <small className="text-2xs text-ink-3">
          {schedule.weekdays.length === 0 || schedule.weekdays.length === 7
            ? t(($) => $.editor.everyDay)
            : t(($) => $.editor.someDays)}
        </small>
      </fieldset>
    </>
  );
}

function ObservedEditor({
  rule,
  dashboard,
  onChange,
  errors,
  fixed = false,
}: {
  rule: AlertRule;
  dashboard: AlertDashboard;
  onChange: (patch: Partial<AlertRule>) => void;
  errors: RuleErrors;
  /** Built-in alerts keep their own boss binding; only the estimate is the user's. */
  fixed?: boolean;
}) {
  const { t } = useTranslation('alerts');
  const [query, setQuery] = useState('');
  // Only NPCs native knows: the bundled boss catalogue plus bosses it observed.
  const npcs = useMemo(() => {
    const byId = new Map<number, string>();
    for (const boss of dashboard.bosses) byId.set(boss.id, boss.name);
    for (const timer of dashboard.observed)
      if (timer.npc_id !== null && !byId.has(timer.npc_id))
        byId.set(timer.npc_id, timer.name || t(($) => $.draft.npc, { id: timer.npc_id }));
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [dashboard.bosses, dashboard.observed, t]);
  const events = useMemo(() => {
    const byId = new Map<number, string>();
    for (const timer of dashboard.observed)
      if (timer.event_id !== null && !byId.has(timer.event_id))
        byId.set(timer.event_id, timer.name || t(($) => $.draft.event, { id: timer.event_id }));
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [dashboard.observed, t]);
  const q = query.trim().toLowerCase();
  const matches = npcs
    .filter((n) => !q || n.name.toLowerCase().includes(q) || String(n.id) === q)
    .slice(0, 60);
  const selected = npcs.find((n) => n.id === rule.npc_id) ?? null;
  if (selected && !matches.some((m) => m.id === selected.id)) matches.unshift(selected);
  const hasEstimate = rule.respawn_seconds !== null;
  const estimate = (
    <>
      <div className="flex min-w-0 flex-col pt-1">
        <Switch
          checked={hasEstimate}
          onCheckedChange={(on) => onChange({ respawn_seconds: on ? 3600 : null })}
          label={t(($) => $.editor.estimate)}
          hint={t(($) => $.editor.estimateHint)}
        />
      </div>
      {hasEstimate && (
        <Field label={t(($) => $.editor.respawn)} error={errors.respawn_seconds}>
          {(id) => (
            <UnitSeconds
              id={id}
              value={rule.respawn_seconds ?? 0}
              onChange={(respawn_seconds) => onChange({ respawn_seconds })}
            />
          )}
        </Field>
      )}
    </>
  );
  if (fixed) return estimate;
  return (
    <>
      <Field
        label={t(($) => $.editor.boss)}
        error={errors.binding}
        hint={
          selected
            ? t(($) => $.editor.watchingBoss, { name: selected.name, id: selected.id })
            : npcs.length
              ? t(($) => $.editor.bossHint)
              : t(($) => $.editor.noBosses)
        }
        wide
      >
        {(id) => (
          <div className="flex flex-col gap-1.5">
            <SearchInput
              placeholder={t(($) => $.editor.bossSearchPlaceholder)}
              aria-label={t(($) => $.editor.bossSearchLabel)}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* A short list box: a native select keeps keyboard and type-ahead. */}
            <select
              id={id}
              data-ui="select"
              className={cn(
                controlClasses,
                'w-full p-1 [&>option]:rounded-sm [&>option]:px-1.5 [&>option]:py-0.5',
              )}
              size={Math.min(6, Math.max(2, matches.length + 1))}
              value={rule.npc_id === null ? '' : String(rule.npc_id)}
              onChange={(event) => {
                const npc = npcs.find((n) => String(n.id) === event.target.value) ?? null;
                onChange({
                  npc_id: npc?.id ?? null,
                  ...(npc && !rule.name.trim() ? { name: npc.name } : {}),
                });
              }}
            >
              <option value="">{t(($) => $.editor.noBoss)}</option>
              {matches.map((n) => (
                <option key={n.id} value={String(n.id)}>
                  {n.name} · {n.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </Field>
      <Field
        label={t(($) => $.editor.event)}
        hint={events.length ? t(($) => $.editor.eventHint) : t(($) => $.editor.noEvents)}
      >
        {(id) => (
          <Select
            id={id}
            value={rule.event_id === null ? '' : String(rule.event_id)}
            disabled={!events.length && rule.event_id === null}
            onChange={(event) => {
              const value = event.target.value;
              onChange({ event_id: value === '' ? null : Number(value) });
            }}
          >
            <option value="">{t(($) => $.editor.noEvent)}</option>
            {rule.event_id !== null && !events.some((e) => e.id === rule.event_id) && (
              <option value={String(rule.event_id)}>
                {t(($) => $.draft.event, { id: rule.event_id })}
              </option>
            )}
            {events.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name} · {e.id}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {estimate}
    </>
  );
}

/** Responsive grid of fields inside the editor. */
const editorGrid =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] items-start gap-x-5 gap-y-4';

/** A titled part of the editor (schedule, reminders, delivery), divided by a hairline. */
function EditorBlock({
  label,
  icon,
  children,
}: {
  label: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-line-soft pt-4" aria-label={label}>
      <h5 className="m-0 flex items-center gap-1.5 text-2xs font-semibold tracking-caps text-ink-2 uppercase">
        <Icon name={icon} size={13} className="text-ink-3" /> {label}
      </h5>
      {children}
    </section>
  );
}

export function RuleEditor({
  initial,
  isNew,
  preset,
  dashboard,
  config,
  now,
  busy,
  onSave,
  onCancel,
  onTest,
}: {
  initial: AlertRule;
  isNew: boolean;
  /** Set for a ready-made alert: its name, binding and default schedule are built in. */
  preset?: AlertCatalogueEntry | undefined;
  dashboard: AlertDashboard;
  config: AlertConfig;
  now: () => number;
  busy: boolean;
  onSave: (rule: AlertRule) => Promise<boolean>;
  onCancel: () => void;
  onTest: (sound: AlertSound, volume: number, popup: boolean) => void;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const [rule, setRule] = useState(initial);
  const [tried, setTried] = useState(false);
  const zones = useMemo(() => timeZones(), []);
  // A built-in alert never asks for a name: native owns it.
  const named = preset && !rule.name.trim() ? { ...rule, name: preset.name } : rule;
  // Validated on every render, so the messages follow the interface language.
  const errors = validateRule(t, named);
  const shown: RuleErrors = tried ? errors : {};
  const set = (patch: Partial<AlertRule>) => setRule((current) => ({ ...current, ...patch }));
  const schedule = rule.schedule;
  const choice: ScheduleChoice = schedule?.type ?? 'unknown';
  // Built-in schedules follow the region's clock; custom ones always use the saved clock.
  const clock = preset ? dashboard.effective_timezone : config.timezone;
  const zone = rule.timezone ?? clock;
  // A built-in alert follows native's schedule for the region unless the user takes it over.
  const ownSchedule = !preset || rule.schedule_override;
  const percent = fmt.numberWith(PERCENT);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    await onSave({ ...named, name: named.name.trim(), notes: rule.notes.trim() });
  };

  const restoreSchedule = () =>
    preset &&
    set({
      schedule_override: false,
      schedule: preset.rule.schedule,
      timezone: preset.rule.timezone,
      duration_seconds: preset.rule.duration_seconds,
    });

  return (
    <form
      data-preset={preset ? true : undefined}
      className={cn(
        'mb-4 flex animate-sprout flex-col gap-4 rounded-lg border border-accent-line bg-surface-2 p-5',
        'shadow-[0_0_0_3px_var(--color-accent-soft)] max-[760px]:p-4',
        preset && 'mb-0',
      )}
      aria-label={
        isNew
          ? t(($) => $.editor.formNew)
          : preset
            ? t(($) => $.editor.formOptions, { name: preset.name })
            : t(($) => $.editor.formEdit, { name: initial.name || t(($) => $.unnamedLower) })
      }
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="m-0 text-lg font-semibold tracking-tight text-ink">
            {isNew
              ? t(($) => $.editor.headingNew)
              : preset
                ? t(($) => $.editor.headingOptions)
                : t(($) => $.editor.headingEdit)}
          </h4>
          {preset && (
            <p className="mt-0.5 mb-0 text-sm leading-snug text-ink-3">
              {preset.note || t(($) => $.editor.builtIn)}
              {preset.source ? ` ${t(($) => $.editor.source, { source: preset.source })}` : ''}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t(($) => $.editor.close)}
          onClick={onCancel}
        >
          <Icon name="close" size={15} />
        </Button>
      </header>

      <div className={editorGrid}>
        {!preset && (
          <Field label={t(($) => $.editor.name)} error={shown.name}>
            {(id) => (
              <Input
                id={id}
                type="text"
                maxLength={80}
                value={rule.name}
                placeholder={t(($) => $.editor.namePlaceholder)}
                onChange={(event) => set({ name: event.target.value })}
              />
            )}
          </Field>
        )}
        {!preset && (
          <Field label={t(($) => $.editor.category)}>
            {(id) => (
              <Select
                id={id}
                value={rule.category}
                onChange={(event) => set({ category: event.target.value as AlertRule['category'] })}
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(t, c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex min-w-0 flex-col gap-2.5 pt-1">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
            label={t(($) => $.editor.enabled)}
          />
          <Switch
            checked={rule.favorite}
            onCheckedChange={(favorite) => set({ favorite })}
            label={t(($) => $.editor.watchlist)}
            hint={t(($) => $.editor.watchlistHint)}
          />
        </div>
        {preset && preset.members.length > 1 && (
          <FieldGroup label={t(($) => $.editor.covers)}>
            <small className="text-xs text-ink-2">
              {preset.members.map((m) => m.name).join(', ')}
            </small>
          </FieldGroup>
        )}
      </div>

      <EditorBlock label={t(($) => $.editor.schedule)} icon="calendar">
        {preset && (
          <Switch
            checked={rule.schedule_override}
            onCheckedChange={(on) => (on ? set({ schedule_override: true }) : restoreSchedule())}
            label={t(($) => $.editor.ownSchedule)}
            hint={
              rule.schedule_override
                ? t(($) => $.editor.ownScheduleHint)
                : t(($) => $.editor.builtInSchedule, {
                    schedule: describeSchedule(
                      t,
                      fmt,
                      preset.rule.schedule,
                      ruleZone(preset.rule, clock),
                    ),
                  })
            }
          />
        )}
        {ownSchedule && (
          <SegmentedControl<ScheduleChoice>
            label={t(($) => $.editor.scheduleType)}
            size="sm"
            className="flex-wrap"
            value={choice}
            onChange={(type) => set({ schedule: defaultSchedule(type, rule, now()) })}
            options={[
              {
                value: 'calendar',
                label: t(($) => $.editor.types.calendar),
                title: t(($) => $.editor.types.calendarTitle),
              },
              {
                value: 'interval',
                label: t(($) => $.editor.types.interval),
                title: t(($) => $.editor.types.intervalTitle),
              },
              {
                value: 'once',
                label: t(($) => $.editor.types.once),
                title: t(($) => $.editor.types.onceTitle),
              },
              {
                value: 'observed',
                label: t(($) => $.editor.types.observed),
                title: t(($) => $.editor.types.observedTitle),
              },
              {
                value: 'unknown',
                label: t(($) => $.editor.types.unknown),
                title: t(($) => $.editor.types.unknownTitle),
              },
            ]}
          />
        )}
        <div className={editorGrid}>
          {ownSchedule && schedule === null && (
            <p className="col-span-full m-0 text-sm text-ink-3">{t(($) => $.editor.unknownNote)}</p>
          )}
          {ownSchedule && schedule?.type === 'once' && (
            <Field
              label={t(($) => $.editor.dateTime)}
              hint={t(($) => $.editor.pcClock)}
              error={shown.at_ms}
            >
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={schedule.at_ms > 0 ? toLocalInput(schedule.at_ms) : ''}
                  onChange={(event) =>
                    set({
                      schedule: { type: 'once', at_ms: fromLocalInput(event.target.value) ?? 0 },
                    })
                  }
                />
              )}
            </Field>
          )}
          {ownSchedule && schedule?.type === 'interval' && (
            <>
              <Field
                label={t(($) => $.editor.knownStart)}
                hint={t(($) => $.editor.knownStartHint)}
                error={shown.anchor_ms}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={schedule.anchor_ms > 0 ? toLocalInput(schedule.anchor_ms) : ''}
                    onChange={(event) =>
                      set({
                        schedule: {
                          ...schedule,
                          anchor_ms: fromLocalInput(event.target.value) ?? 0,
                        },
                      })
                    }
                  />
                )}
              </Field>
              <Field label={t(($) => $.editor.repeats)} error={shown.every_seconds}>
                {(id) => (
                  <UnitSeconds
                    id={id}
                    value={schedule.every_seconds}
                    onChange={(every_seconds) => set({ schedule: { ...schedule, every_seconds } })}
                  />
                )}
              </Field>
              <FieldGroup
                wide
                label={t(($) => $.editor.quickAnchor)}
                hint={t(($) => $.editor.quickAnchorHint)}
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    icon={<Icon name="fieldBoss" size={13} />}
                    onClick={() =>
                      set({ schedule: { ...schedule, anchor_ms: roundTo(now() - 30_000, 1000) } })
                    }
                  >
                    {t(($) => $.editor.spawnedNow)}
                  </Button>
                  <Button
                    size="sm"
                    icon={<Icon name="repeat" size={13} />}
                    disabled={!(schedule.every_seconds >= 60)}
                    onClick={() =>
                      set({
                        schedule: {
                          ...schedule,
                          anchor_ms: roundTo(now() + schedule.every_seconds * 1000, 1000),
                        },
                      })
                    }
                  >
                    {t(($) => $.editor.defeatedNow, {
                      time: leadChip(t, schedule.every_seconds),
                    })}
                  </Button>
                </div>
              </FieldGroup>
            </>
          )}
          {ownSchedule && schedule?.type === 'calendar' && (
            <>
              <CalendarEditor
                schedule={schedule}
                error={shown.times}
                onChange={(next) => set({ schedule: next })}
              />
              <Field
                label={t(($) => $.editor.clock)}
                error={shown.timezone}
                hint={
                  rule.timezone
                    ? t(($) => $.editor.ownZone)
                    : t(($) => $.editor.serverZone, { zone: clock })
                }
              >
                {(id) => (
                  <Select
                    id={id}
                    value={rule.timezone ?? ''}
                    onChange={(event) => set({ timezone: event.target.value || null })}
                  >
                    <option value="">
                      {t(($) => $.editor.serverClockOption, { zone: clock })}
                    </option>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          {schedule?.type === 'observed' && (
            <ObservedEditor
              rule={rule}
              dashboard={dashboard}
              onChange={set}
              errors={shown}
              fixed={Boolean(preset)}
            />
          )}
          {ownSchedule && (
            <Field
              label={t(($) => $.editor.openWindow)}
              hint={t(($) => $.editor.openWindowHint)}
              error={shown.duration_seconds}
            >
              {(id) => (
                <UnitSeconds
                  id={id}
                  min={0}
                  value={rule.duration_seconds}
                  onChange={(duration_seconds) => set({ duration_seconds })}
                />
              )}
            </Field>
          )}
        </div>
        {needsClock(rule, dashboard.clock_ready) && (
          <Notice tone="info" className="my-0">
            {t(($) => $.editor.fallbackNotice, { zone })}
          </Notice>
        )}
      </EditorBlock>

      <EditorBlock label={t(($) => $.editor.reminders)} icon="bell">
        <LeadEditor
          leads={rule.lead_seconds}
          error={shown.lead_seconds}
          onChange={(lead_seconds) => set({ lead_seconds })}
        />
      </EditorBlock>

      <EditorBlock label={t(($) => $.editor.delivery)} icon="volume">
        <div className={editorGrid}>
          <Field label={t(($) => $.editor.sound)}>
            {(id) => (
              <Select
                id={id}
                value={rule.sound}
                onChange={(event) => set({ sound: event.target.value as AlertSound })}
              >
                {SOUNDS.map((sound) => (
                  <option key={sound} value={sound}>
                    {soundLabel(t, sound)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t(($) => $.editor.volume)}
            error={shown.volume}
            hint={t(($) => $.editor.volumeHint, { volume: percent.format(config.volume) })}
          >
            {(id) => (
              <RangeField
                id={id}
                min={0}
                max={100}
                step={5}
                disabled={rule.sound === 'none'}
                value={Math.round(rule.volume * 100)}
                display={percent.format(rule.volume)}
                onChange={(value) => set({ volume: value / 100 })}
              />
            )}
          </Field>
          <div className="flex min-w-0 flex-col pt-1">
            <Switch
              checked={rule.popup}
              onCheckedChange={(popup) => set({ popup })}
              label={t(($) => $.editor.popup)}
              hint={t(($) => $.editor.popupHint)}
            />
          </div>
          <FieldGroup label={t(($) => $.editor.preview)}>
            <Button
              size="sm"
              className="self-start"
              disabled={rule.sound === 'none' && !rule.popup}
              icon={<Icon name="play" size={13} />}
              onClick={() => onTest(rule.sound, rule.volume, rule.popup)}
            >
              {t(($) => $.editor.test)}
            </Button>
          </FieldGroup>
        </div>
      </EditorBlock>

      <Field label={t(($) => $.editor.notes)} error={shown.notes} wide>
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            maxLength={500}
            className="w-full resize-y"
            value={rule.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        )}
      </Field>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-4">
        {tried && Object.keys(errors).length > 0 && (
          <span className="mr-auto text-xs text-danger" role="alert">
            {t(($) => $.editor.fix)}
          </span>
        )}
        {preset && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            title={t(($) => $.editor.restoreTitle)}
            icon={<Icon name="reset" size={13} />}
            onClick={() =>
              setRule({
                ...preset.rule,
                id: rule.id,
                preset_id: preset.id,
                enabled: rule.enabled,
                favorite: rule.favorite,
              })
            }
          >
            {t(($) => $.editor.restore)}
          </Button>
        )}
        <Button size="sm" onClick={onCancel}>
          {t(($) => $.actions.cancel, { ns: 'common' })}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {isNew ? t(($) => $.editor.add) : t(($) => $.editor.save)}
        </Button>
      </footer>
    </form>
  );
}
