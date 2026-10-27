import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Field, Input, Select, Switch } from '../../components/ui/Field';
import { ClassLabel, SkillIcon, SkillLabel } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { WindowSwitch, windowState } from '../../components/ui/WindowSwitch';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  PolledOfflineStatus,
  ReportTotals,
  TrackerBar,
  TrackerPreset,
} from '../../types/offline';
import { HotkeyInput } from './HotkeyInput';
import { newId, type SettingsDraft } from './settingsModel';
import {
  FieldGroup,
  RangeField,
  SettingsGrid,
  SettingsGroup,
  SettingsSection,
} from './SettingsLayout';
import { activePreset, trackerKind, trackerTime, trackerTitle } from './trackers';

export const CLASSES = [
  'Gladiator',
  'Templar',
  'Assassin',
  'Ranger',
  'Sorcerer',
  'Spiritmaster',
  'Cleric',
  'Chanter',
];
/** Reference screen for the layout board; bar positions are window pixels. */
const BOARD = { width: 1920, height: 1080 };

function skillNames(report: ReportTotals | null, status: PolledOfflineStatus | null) {
  const names = new Map<number, string>();
  for (const p of report?.players ?? [])
    for (const s of p.skills) if (typeof s.id === 'number' && s.name) names.set(s.id, s.name);
  for (const t of status?.trackers ?? []) if (t.name) names.set(t.skill, t.name);
  return names;
}

function SkillPicker({
  skills,
  onChange,
  names,
  suggestions,
  error,
}: {
  skills: number[];
  onChange: (skills: number[]) => void;
  names: Map<number, string>;
  suggestions: number[];
  error?: string | undefined;
}) {
  const { t } = useTranslation('trackers');
  const [text, setText] = useState('');
  const add = (ids: number[]) => onChange([...new Set([...skills, ...ids])]);
  const commit = () => {
    const ids = text
      .split(/[\s,;]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) add(ids);
    setText('');
  };
  const remaining = suggestions.filter((id) => !skills.includes(id)).slice(0, 18);
  return (
    <div className="flex w-full flex-col gap-2.5">
      <span className="text-xs font-semibold text-ink-2">{t(($) => $.picker.title)}</span>
      <ul
        className="m-0 flex list-none flex-wrap gap-1.5 p-0"
        aria-label={t(($) => $.picker.title)}
      >
        {skills.map((id) => (
          <li
            key={id}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong bg-surface py-0.5 pr-0.5 pl-1.5 text-xs text-ink"
          >
            <SkillIcon id={id} size={18} className="rounded-full" />
            <span>{names.get(id) ?? t(($) => $.skillId, { id })}</span>
            <small className="text-2xs text-ink-3 tabular-nums">{id}</small>
            <Button
              size="xs"
              variant="ghost"
              iconOnly
              className="size-6"
              aria-label={t(($) => $.picker.remove, { name: names.get(id) ?? String(id) })}
              onClick={() => onChange(skills.filter((s) => s !== id))}
            >
              <Icon name="close" size={12} />
            </Button>
          </li>
        ))}
        {!skills.length && <li className="text-xs text-ink-3">{t(($) => $.picker.empty)}</li>}
      </ul>
      <span className="flex gap-1.5">
        <Input
          size="sm"
          className="flex-1"
          aria-label={t(($) => $.picker.addLabel)}
          aria-invalid={error ? true : undefined}
          placeholder={t(($) => $.picker.placeholder)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button size="sm" onClick={commit} disabled={!text.trim()}>
          {t(($) => $.picker.add)}
        </Button>
      </span>
      {error && <small className="text-2xs text-danger">{error}</small>}
      {remaining.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <small className="mr-1 text-2xs text-ink-3">{t(($) => $.picker.suggestions)}</small>
          {remaining.map((id) => (
            <Chip
              key={id}
              size="xs"
              icon={<Icon name="plus" size={11} />}
              onClick={() => add([id])}
            >
              <SkillIcon id={id} size={14} className="rounded-full" /> {names.get(id) ?? `#${id}`}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** Scaled screen where bars can be dragged into place: a preview of the in-game layer. */
function LayoutBoard({
  preset,
  selected,
  onSelect,
  onMove,
}: {
  preset: TrackerPreset;
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const { t } = useTranslation('trackers');
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const scale = () => (board.current?.getBoundingClientRect().width ?? BOARD.width) / BOARD.width;
  const onDown = (event: PointerEvent<HTMLButtonElement>, bar: TrackerBar) => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return;
    const k = scale();
    drag.current = {
      id: bar.id,
      dx: (event.clientX - rect.left) / k - bar.x,
      dy: (event.clientY - rect.top) / k - bar.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect(bar.id);
  };
  const onMovePointer = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    const rect = board.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const k = scale();
    const x = Math.round(
      Math.min(BOARD.width - 20, Math.max(0, (event.clientX - rect.left) / k - state.dx)),
    );
    const y = Math.round(
      Math.min(BOARD.height - 20, Math.max(0, (event.clientY - rect.top) / k - state.dy)),
    );
    onMove(state.id, x, y);
  };
  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg border border-line-strong bg-sunken bg-ruled"
      ref={board}
      aria-label={t(($) => $.board.label)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 bottom-1.5 text-2xs text-ink-4"
      >
        {t(($) => $.board.caption)}
      </span>
      {preset.bars.map((bar) => {
        const name = bar.name || t(($) => $.bar.fallbackName);
        const slots = Math.max(1, bar.skills.length);
        const w = bar.appearance === 'bars' ? bar.icon_size * 5 : slots * (bar.icon_size + 4);
        const h = bar.appearance === 'bars' ? slots * (bar.icon_size * 0.6 + 4) : bar.icon_size;
        return (
          <Pressable
            key={bar.id}
            data-selected={selected === bar.id || undefined}
            data-hidden={bar.hidden || undefined}
            className={cn(
              'absolute flex min-h-2.5 min-w-[18px] cursor-grab touch-none items-center overflow-hidden rounded-xs px-1',
              'border border-accent-line bg-accent-soft text-3xs leading-none text-ink',
              'transition-[background-color,border-color] duration-150 hover:border-accent active:cursor-grabbing',
              'data-selected:z-[1] data-selected:border-warn data-selected:bg-warn-soft data-selected:shadow-glow',
              'data-hidden:border-dashed data-hidden:opacity-50',
            )}
            style={{
              left: `${(bar.x / BOARD.width) * 100}%`,
              top: `${(bar.y / BOARD.height) * 100}%`,
              width: `${(w / BOARD.width) * 100}%`,
              height: `${(h / BOARD.height) * 100}%`,
            }}
            onPointerDown={(e) => onDown(e, bar)}
            onPointerMove={onMovePointer}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 50 : 5;
              const d = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[e.key];
              if (!d) return;
              e.preventDefault();
              onMove(bar.id, bar.x + (d[0] ?? 0), bar.y + (d[1] ?? 0));
            }}
            aria-label={t(($) => $.board.bar, { name, x: bar.x, y: bar.y })}
          >
            <span className="truncate" title={name}>
              {name}
            </span>
          </Pressable>
        );
      })}
    </div>
  );
}

function BarEditor({
  bar,
  at,
  draft,
  names,
  suggestions,
  onChange,
  onRemove,
}: {
  bar: TrackerBar;
  at: string;
  draft: SettingsDraft;
  names: Map<number, string>;
  suggestions: number[];
  onChange: (bar: TrackerBar) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('trackers');
  const fmt = useFormat();
  const e = draft.errors;
  const set = <K extends keyof TrackerBar>(key: K, value: TrackerBar[K]) =>
    onChange({ ...bar, [key]: value });
  const int = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));
  return (
    <div className="flex flex-col items-start gap-5 rounded-lg border border-line-soft bg-surface-2 p-4">
      <SettingsGrid className="w-full">
        <Field label={t(($) => $.editor.name)}>
          {(id) => (
            <Input
              id={id}
              value={bar.name}
              maxLength={80}
              onChange={(ev) => set('name', ev.target.value)}
            />
          )}
        </Field>
        <Field label={t(($) => $.editor.tracks)}>
          {() => (
            <SegmentedControl
              size="sm"
              label={t(($) => $.editor.mode)}
              value={bar.mode}
              onChange={(v) => set('mode', v)}
              options={[
                { value: 'cooldowns', label: t(($) => $.editor.modes.cooldowns) },
                { value: 'buffs', label: t(($) => $.editor.modes.buffs) },
                { value: 'both', label: t(($) => $.editor.modes.both) },
              ]}
            />
          )}
        </Field>
        <Field label={t(($) => $.editor.look)}>
          {() => (
            <SegmentedControl
              size="sm"
              label={t(($) => $.editor.appearance)}
              value={bar.appearance}
              onChange={(v) => set('appearance', v)}
              options={[
                { value: 'icons', label: t(($) => $.editor.appearances.icons) },
                { value: 'bars', label: t(($) => $.editor.appearances.bars) },
              ]}
            />
          )}
        </Field>
        <Field label={t(($) => $.editor.iconSize)} error={e[`${at}.icon_size`]}>
          {(id) => (
            <RangeField
              id={id}
              min={16}
              max={128}
              step={2}
              value={bar.icon_size}
              display={t(($) => $.editor.pixels, { value: fmt.integer.format(bar.icon_size) })}
              onChange={(value) => set('icon_size', value)}
            />
          )}
        </Field>
        <Field label="X" error={e[`${at}.x`]}>
          {(id) => (
            <Input
              id={id}
              type="number"
              className="w-28"
              step={1}
              value={Number.isNaN(bar.x) ? '' : bar.x}
              onChange={(ev) => set('x', int(ev.target.value))}
            />
          )}
        </Field>
        <Field label="Y" error={e[`${at}.y`]}>
          {(id) => (
            <Input
              id={id}
              type="number"
              className="w-28"
              step={1}
              value={Number.isNaN(bar.y) ? '' : bar.y}
              onChange={(ev) => set('y', int(ev.target.value))}
            />
          )}
        </Field>
        <Switch
          checked={bar.hidden}
          onCheckedChange={(v) => set('hidden', v)}
          label={t(($) => $.editor.hidden)}
          hint={t(($) => $.editor.hiddenHint)}
        />
      </SettingsGrid>
      <SkillPicker
        skills={bar.skills}
        onChange={(skills) => set('skills', skills)}
        names={names}
        suggestions={suggestions}
        error={e[`${at}.skills`]}
      />
      <Button size="sm" variant="danger" icon={<Icon name="trash" size={13} />} onClick={onRemove}>
        {t(($) => $.editor.remove)}
      </Button>
    </div>
  );
}

export interface TrackerSurfaceControls {
  known: boolean;
  requested: boolean;
  /** Held back by the native side while AION is unfocused. */
  held?: boolean;
  editing: boolean;
  busy: boolean;
  onToggle: () => void;
  onArrange: (editing: boolean) => void;
}

/** Controls for the in-game tracker layer. */
function SurfaceControls({ surface, dirty }: { surface: TrackerSurfaceControls; dirty: boolean }) {
  const { t } = useTranslation('trackers');
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <WindowSwitch
        on={surface.known && surface.requested}
        icon="trackers"
        label={t(($) => $.surface.label)}
        state={windowState({
          known: surface.known,
          requested: surface.requested,
          held: surface.held ?? false,
        })}
        busy={surface.busy}
        disabled={!surface.known}
        title={t(($) => $.surface.toggleTitle)}
        onClick={surface.onToggle}
      />
      <Button
        size="sm"
        icon={<Icon name="grip" size={13} />}
        aria-pressed={surface.editing}
        disabled={!surface.known || surface.busy || (dirty && !surface.editing)}
        title={dirty ? t(($) => $.surface.dirtyTitle) : undefined}
        onClick={() => surface.onArrange(!surface.editing)}
      >
        {surface.editing ? t(($) => $.surface.finish) : t(($) => $.surface.arrange)}
      </Button>
      <small className="basis-full text-2xs leading-snug text-ink-3">
        {surface.editing ? t(($) => $.surface.editingHint) : t(($) => $.surface.hint)}
      </small>
    </div>
  );
}

export function TrackersPanel({
  status,
  draft,
  native,
  onOpenAlerts,
  surface,
}: {
  status: PolledOfflineStatus | null;
  draft: SettingsDraft;
  native: boolean;
  /** Alerts have their own workspace tab. */
  onOpenAlerts: () => void;
  surface: TrackerSurfaceControls;
}) {
  const { t: tr } = useTranslation('trackers');
  const fmt = useFormat();
  const s = draft.draft;
  const [editing, setEditing] = useState<string | null>(null);
  const [bar, setBar] = useState<string | null>(null);
  const names = useMemo(() => skillNames(status?.report ?? null, status), [status]);
  const suggestions = useMemo(() => {
    const local = status?.report?.players.find((p) => p.local) ?? status?.report?.players[0];
    return (local?.skills ?? [])
      .filter((sk) => sk.damage > 0 || sk.healing > 0 || (sk.casts ?? 0) > 0)
      .flatMap((sk) => (typeof sk.id === 'number' ? [sk.id] : []));
  }, [status]);
  if (!s)
    return (
      <EmptyState
        live={native}
        title={native ? tr(($) => $.unavailable.title) : tr(($) => $.unavailable.titleBrowser)}
        icon={<Icon name="trackers" size={20} />}
      >
        {native ? tr(($) => $.unavailable.body) : tr(($) => $.unavailable.bodyBrowser)}
      </EmptyState>
    );
  const e = draft.errors;
  const presetIndex = s.presets.findIndex((p) => p.id === (editing ?? activePreset(s)?.id));
  const preset = s.presets[presetIndex] ?? null;
  const updatePreset = (change: (p: TrackerPreset) => TrackerPreset) =>
    draft.update((current) => ({
      ...current,
      presets: current.presets.map((p, i) => (i === presetIndex ? change(p) : p)),
    }));
  const updateBar = (id: string, change: (b: TrackerBar) => TrackerBar) =>
    updatePreset((p) => ({
      ...p,
      bars: p.bars.map((b) => (b.id === id ? change(b) : b)),
    }));
  const addPreset = () => {
    const id = newId('preset');
    draft.update((current) => ({
      ...current,
      presets: [
        ...current.presets,
        {
          id,
          name: tr(($) => $.defaults.preset, { index: current.presets.length + 1 }),
          class: null,
          keybind: null,
          bars: [],
        },
      ],
      active_preset: current.active_preset ?? id,
    }));
    setEditing(id);
  };
  const addBar = () => {
    const id = newId('bar');
    updatePreset((p) => ({
      ...p,
      bars: [
        ...p.bars,
        {
          id,
          name: tr(($) => $.defaults.bar, { index: p.bars.length + 1 }),
          mode: 'cooldowns',
          skills: [],
          x: 760,
          y: 820 + p.bars.length * 48,
          icon_size: 36,
          appearance: 'icons',
          hidden: false,
        },
      ],
    }));
    setBar(id);
  };
  const selectedBar = preset?.bars.find((b) => b.id === bar) ?? null;
  const live = status?.trackers ?? [];

  return (
    <div className="flex flex-col gap-4 pb-16">
      <SettingsGroup>
        <SettingsSection
          title={tr(($) => $.live.title)}
          description={tr(($) => $.live.description)}
        >
          <SurfaceControls surface={surface} dirty={draft.dirty} />
          {live.length ? (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 p-0">
              {live.map((t, i) => {
                const kind = trackerKind(t, tr);
                return (
                  <li
                    key={`${t.bar_id}-${t.skill}-${i}`}
                    data-kind={t.kind}
                    data-estimated={t.estimated || undefined}
                    className={cn(
                      'flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2',
                      t.kind === 'cooldown'
                        ? 'border-sky/40 bg-sky/10'
                        : 'border-jade/45 bg-jade/12',
                      t.estimated && 'border-dashed',
                    )}
                    title={trackerTitle(t, tr, fmt)}
                  >
                    <b className="min-w-0 text-sm font-semibold text-ink">
                      <SkillLabel id={t.skill} size={16}>
                        {t.name ?? names.get(t.skill) ?? tr(($) => $.skillId, { id: t.skill })}
                      </SkillLabel>
                    </b>
                    <span className="text-xl font-semibold text-ink tabular-nums">
                      {trackerTime(t, tr, fmt)}
                    </span>
                    <small
                      className={cn(
                        'text-2xs',
                        t.kind === 'cooldown' ? 'text-sky-ink' : 'text-jade-ink',
                      )}
                    >
                      {t.estimated
                        ? t.basis
                          ? tr(($) => $.live.estimatedFrom, { kind, basis: t.basis })
                          : tr(($) => $.live.estimated, { kind })
                        : t.basis
                          ? tr(($) => $.live.measured, { kind, basis: t.basis })
                          : kind}
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="m-0 max-w-2xl text-sm text-ink-3">
              {activePreset(s) ? tr(($) => $.live.idle) : tr(($) => $.live.noPreset)}
            </p>
          )}
        </SettingsSection>

        <SettingsSection
          title={tr(($) => $.presets.title)}
          label={tr(($) => $.presets.label)}
          description={tr(($) => $.presets.description)}
          className="min-[900px]:grid-cols-1 min-[1180px]:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
        >
          <div className="grid gap-6 min-[760px]:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)]">
            <aside className="flex flex-col gap-2" aria-label={tr(($) => $.presets.list)}>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {s.presets.map((p) => (
                  <li key={p.id}>
                    <Pressable
                      aria-pressed={p.id === preset?.id}
                      onClick={() => setEditing(p.id)}
                      className={selectableRow(
                        p.id === preset?.id,
                        'flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 px-3 py-2 text-sm text-ink-2 hover:text-ink aria-pressed:text-ink',
                      )}
                    >
                      <span className="min-w-0 truncate font-semibold">
                        {p.name || tr(($) => $.presets.untitled)}
                      </span>
                      {p.id === s.active_preset && (
                        <Badge shape="tag" tone="accent" dot="live">
                          {tr(($) => $.presets.active)}
                        </Badge>
                      )}
                      {p.class && (
                        <small className="basis-full text-2xs text-ink-3">
                          <ClassLabel name={p.class} size={14}>
                            {p.class}
                          </ClassLabel>
                        </small>
                      )}
                    </Pressable>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                icon={<Icon name="plus" size={13} />}
                onClick={addPreset}
                disabled={s.presets.length >= 100}
              >
                {tr(($) => $.presets.add)}
              </Button>
            </aside>
            {preset ? (
              <div className="flex min-w-0 flex-col gap-5">
                <SettingsGrid>
                  <Field label={tr(($) => $.presets.name)} error={e[`presets.${presetIndex}.name`]}>
                    {(id) => (
                      <Input
                        id={id}
                        value={preset.name}
                        maxLength={200}
                        onChange={(ev) => updatePreset((p) => ({ ...p, name: ev.target.value }))}
                      />
                    )}
                  </Field>
                  <Field label={tr(($) => $.presets.class)}>
                    {(id) => (
                      <Select
                        id={id}
                        value={preset.class ?? ''}
                        onChange={(ev) =>
                          updatePreset((p) => ({
                            ...p,
                            class: ev.target.value || null,
                          }))
                        }
                      >
                        <option value="">{tr(($) => $.presets.anyClass)}</option>
                        {CLASSES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field
                    label={tr(($) => $.presets.hotkey)}
                    hint={tr(($) => $.presets.hotkeyHint)}
                    error={e[`presets.${presetIndex}.keybind`]}
                  >
                    {(id) => (
                      <HotkeyInput
                        id={id}
                        value={preset.keybind ?? ''}
                        onChange={(v) => updatePreset((p) => ({ ...p, keybind: v || null }))}
                      />
                    )}
                  </Field>
                  <FieldGroup label={tr(($) => $.presets.inGame)}>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        aria-pressed={s.active_preset === preset.id}
                        icon={
                          s.active_preset === preset.id ? <Icon name="check" size={13} /> : null
                        }
                        onClick={() =>
                          draft.update((c) => ({
                            ...c,
                            active_preset: c.active_preset === preset.id ? null : preset.id,
                          }))
                        }
                      >
                        {s.active_preset === preset.id
                          ? tr(($) => $.presets.isActive)
                          : tr(($) => $.presets.makeActive)}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          draft.update((c) => ({
                            ...c,
                            presets: c.presets.filter((p) => p.id !== preset.id),
                            active_preset: c.active_preset === preset.id ? null : c.active_preset,
                          }));
                          setEditing(null);
                        }}
                      >
                        {tr(($) => $.presets.remove)}
                      </Button>
                    </span>
                  </FieldGroup>
                </SettingsGrid>
                {e[`presets.${presetIndex}.bars`] && (
                  <Notice tone="error">{e[`presets.${presetIndex}.bars`]}</Notice>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-4">
                  <h3 className="m-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
                    {tr(($) => $.bars.title)}
                  </h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon name="plus" size={13} />}
                    onClick={addBar}
                    disabled={preset.bars.length >= 32}
                  >
                    {tr(($) => $.bars.add)}
                  </Button>
                </div>
                {preset.bars.length ? (
                  <>
                    <LayoutBoard
                      preset={preset}
                      selected={bar}
                      onSelect={setBar}
                      onMove={(id, x, y) => updateBar(id, (b) => ({ ...b, x, y }))}
                    />
                    <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
                      <legend className="sr-only">{tr(($) => $.bars.edit)}</legend>
                      {preset.bars.map((b) => (
                        <Chip
                          key={b.id}
                          pressed={b.id === bar}
                          count={b.skills.length}
                          onClick={() => setBar(b.id)}
                        >
                          {b.name || tr(($) => $.bar.fallbackName)}
                        </Chip>
                      ))}
                    </fieldset>
                    {selectedBar ? (
                      <BarEditor
                        bar={selectedBar}
                        at={`presets.${presetIndex}.bars.${preset.bars.indexOf(selectedBar)}`}
                        draft={draft}
                        names={names}
                        suggestions={suggestions}
                        onChange={(next) => updateBar(selectedBar.id, () => next)}
                        onRemove={() => {
                          updatePreset((p) => ({
                            ...p,
                            bars: p.bars.filter((b) => b.id !== selectedBar.id),
                          }));
                          setBar(null);
                        }}
                      />
                    ) : (
                      <p className="m-0 text-sm text-ink-3">{tr(($) => $.bars.select)}</p>
                    )}
                  </>
                ) : (
                  <EmptyState
                    compact
                    title={tr(($) => $.bars.emptyTitle)}
                    icon={<Icon name="sprout" size={18} />}
                  >
                    {tr(($) => $.bars.emptyBody)}
                  </EmptyState>
                )}
              </div>
            ) : (
              <EmptyState
                title={tr(($) => $.presets.emptyTitle)}
                icon={<Icon name="sprout" size={20} />}
              >
                {tr(($) => $.presets.emptyBody)}
              </EmptyState>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          label={tr(($) => $.alerts.label)}
          title={
            <>
              <Icon name="bell" size={16} className="text-ink-3" /> {tr(($) => $.alerts.title)}
            </>
          }
          description={tr(($) => $.alerts.description)}
        >
          <Button size="sm" icon={<Icon name="bell" size={14} />} onClick={onOpenAlerts}>
            {tr(($) => $.alerts.open)}
          </Button>
        </SettingsSection>
      </SettingsGroup>
    </div>
  );
}
