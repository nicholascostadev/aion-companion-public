import { useState, type ReactNode } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Button, buttonClasses } from '../../components/ui/Button';
import { KeyValueList } from '../../components/ui/Data';
import { Disclosure } from '../../components/ui/Disclosure';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Field, Input, Select, Switch } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import {
  isUiLocale,
  resolveUiLocale,
  UI_LOCALE_NAMES,
  UI_LOCALES,
  type UiLocale,
} from '../../i18n/locale';
import { Trans, useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  CatalogueSummary,
  HotkeyAction,
  Locale,
  OfflineActionName,
  OfflineSettings,
  PolledOfflineStatus,
} from '../../types/offline';
import { HotkeyInput } from './HotkeyInput';
import { CopySummary } from './report/ReportView';
import { HOTKEY_ACTIONS, hotkeyLabel, type SettingsDraft } from './settingsModel';
import {
  FieldGroup,
  RangeField,
  SettingsGrid,
  SettingsGroup,
  SettingsSection,
} from './SettingsLayout';

/**
 * Stored preferences from before only English and Portuguese (Brazil) were offered, named
 * in their own language. They stay selected (and saved) until the user picks a language.
 */
const LEGACY_LOCALE_NAMES: Partial<Record<Locale, string>> = {
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ru: 'Русский',
};
const MAX_CATALOGUE = 16 * 1024 * 1024;
const CATALOGUE_SCHEMA =
  '{ skills: [{ id, name, class?, cooldown_ms?, specialties? }], npcs: [{ id, name, boss?, dummy?, berserk_seconds? }] }';

/** Settings chapter whose controls sit in a responsive field grid. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} description={description}>
      <SettingsGrid>{children}</SettingsGrid>
    </SettingsSection>
  );
}

const asNumber = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

/** Floating bar that appears while settings have unsaved changes. */
export function SaveBar({ draft, error }: { draft: SettingsDraft; error: string }) {
  const { t } = useTranslation('settings');
  if (!draft.dirty && !draft.saved && !error) return null;
  const problems = Object.keys(draft.errors).length;
  return (
    <section
      aria-label={t(($) => $.saveBar.label)}
      data-dirty={draft.dirty || undefined}
      className={cn(
        'sticky bottom-3 z-[8] mx-auto mb-3 flex w-[min(820px,calc(100%-3.5rem))] animate-sprout items-center justify-between gap-3',
        'rounded-full border border-line-strong bg-veil py-1.5 pr-1.5 pl-5 text-sm text-ink-2 shadow-3 backdrop-blur-md',
        'data-dirty:border-warn-line',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {error ? (
          <>
            <Icon name="warning" size={14} className="shrink-0 text-danger" />
            <span className="text-danger">{error}</span>
          </>
        ) : draft.dirty ? (
          <>
            <StatusDot tone="warn" live />
            {problems
              ? t(($) => $.saveBar.problems, { count: problems })
              : t(($) => $.saveBar.unsaved)}
          </>
        ) : (
          <>
            <Icon name="check" size={14} className="shrink-0 text-success" />
            {draft.saved}
          </>
        )}
      </span>
      {draft.dirty && (
        <span className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={draft.discard} disabled={draft.saving}>
            {t(($) => $.saveBar.discard)}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!draft.valid || draft.saving}
            loading={draft.saving}
            onClick={() => void draft.save()}
          >
            {draft.saving ? t(($) => $.saveBar.saving) : t(($) => $.saveBar.save)}
          </Button>
        </span>
      )}
    </section>
  );
}

/**
 * The interface language. English and Portuguese (Brazil) are the choices; a preference
 * the interface cannot show (saved before, in another language) stays listed and selected,
 * so saving other settings never silently replaces it. The choice applies on Save.
 */
function LanguageSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Locale;
  onChange: (locale: UiLocale) => void;
}) {
  const { t } = useTranslation('settings');
  // `pt` is the earlier value for Portuguese (Brazil): shown as it, kept until changed.
  const shown = value === 'pt' ? resolveUiLocale(value) : value;
  const untranslated = !isUiLocale(shown);
  return (
    <Select
      id={id}
      value={shown}
      onChange={(ev) => {
        if (isUiLocale(ev.target.value)) onChange(ev.target.value);
      }}
    >
      {untranslated && (
        <option value={shown} disabled>
          {t(($) => $.language.unsupported, { code: LEGACY_LOCALE_NAMES[shown] ?? shown })}
        </option>
      )}
      {UI_LOCALES.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {UI_LOCALE_NAMES[locale]}
        </option>
      ))}
    </Select>
  );
}

export function SettingsPanel({
  status,
  draft,
  native,
  busy,
  onAction,
  onImportCatalogue,
  onCopySummary,
}: {
  status: PolledOfflineStatus | null;
  draft: SettingsDraft;
  native: boolean;
  busy: boolean;
  onAction: (action: OfflineActionName) => Promise<boolean>;
  onImportCatalogue: (json: string) => Promise<CatalogueSummary>;
  onCopySummary: (multiline: boolean) => Promise<void>;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const fmt = useFormat();
  const [confirmClear, setConfirmClear] = useState(false);
  // The last import's outcome; worded at render so it follows the interface language.
  const [catalogue, setCatalogue] = useState<
    { ok: true; summary: CatalogueSummary } | { ok: false; detail: string } | null
  >(null);
  const s = draft.draft;
  if (!s)
    return (
      <EmptyState
        live={native}
        title={native ? t(($) => $.unavailable.title) : t(($) => $.unavailable.titleBrowser)}
        icon={<Icon name="workspace" size={20} />}
      >
        {native ? t(($) => $.unavailable.body) : t(($) => $.unavailable.bodyBrowser)}
      </EmptyState>
    );
  const e = draft.errors;
  const seconds = t(($) => $.units.seconds);
  const set = <K extends keyof OfflineSettings>(key: K, value: OfflineSettings[K]) =>
    draft.update((current) => ({ ...current, [key]: value }));
  const setHotkey = (action: HotkeyAction, value: string) =>
    draft.update((current) => ({ ...current, hotkeys: { ...current.hotkeys, [action]: value } }));
  const percent = (fraction: number) => fmt.pct(Math.round(fraction * 100) / 100, 0);
  const numberField = (
    key: keyof OfflineSettings,
    label: string,
    unit: string,
    hint?: ReactNode,
    step = 1,
  ) => (
    <Field label={label} hint={hint} error={e[key]}>
      {(id) => (
        <span className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            className="w-28"
            step={step}
            value={Number.isNaN(s[key] as number) ? '' : (s[key] as number)}
            aria-invalid={e[key] ? true : undefined}
            onChange={(ev) => set(key, asNumber(ev.target.value) as never)}
          />
          <span className="text-xs text-ink-3">{unit}</span>
        </span>
      )}
    </Field>
  );
  const percentField = (
    key: 'opacity' | 'fade_opacity',
    label: string,
    min: number,
    hint?: ReactNode,
  ) => (
    <Field label={label} hint={hint} error={e[key]}>
      {(id) => (
        <RangeField
          id={id}
          min={min}
          max={100}
          step={5}
          value={Math.round(s[key] * 100)}
          display={percent(s[key])}
          onChange={(value) => set(key, value / 100)}
        />
      )}
    </Field>
  );

  const loadCatalogue = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_CATALOGUE) throw new Error(t(($) => $.catalogue.tooLarge));
      setCatalogue({ ok: true, summary: await onImportCatalogue(await file.text()) });
    } catch (cause) {
      setCatalogue({ ok: false, detail: String(cause) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup>
        <Section title={t(($) => $.meter.title)} description={t(($) => $.meter.description)}>
          <Field label={t(($) => $.meter.dpsShown)} hint={t(($) => $.meter.dpsShownHint)}>
            {() => (
              <SegmentedControl
                label={t(($) => $.meter.dpsMode)}
                value={s.dps_mode}
                onChange={(v) => set('dps_mode', v)}
                options={[
                  { value: 'encounter', label: t(($) => $.meter.encounter) },
                  { value: 'active', label: t(($) => $.meter.active) },
                ]}
              />
            )}
          </Field>
          <Switch
            checked={s.party_only}
            onCheckedChange={(v) => set('party_only', v)}
            label={t(($) => $.meter.partyOnly)}
            hint={t(($) => $.meter.partyOnlyHint)}
          />
          {numberField(
            'idle_timeout_seconds',
            t(($) => $.meter.idleTimeout),
            seconds,
            t(($) => $.meter.idleTimeoutHint),
          )}
          {numberField(
            'refresh_ms',
            t(($) => $.meter.refresh),
            t(($) => $.units.milliseconds),
            t(($) => $.meter.refreshHint),
          )}
        </Section>

        <Section title={t(($) => $.dummy.title)} description={t(($) => $.dummy.description)}>
          {numberField(
            'dummy_length_seconds',
            t(($) => $.dummy.length),
            seconds,
            t(($) => $.dummy.lengthHint),
          )}
          {numberField(
            'dummy_cooldown_seconds',
            t(($) => $.dummy.cooldown),
            seconds,
            t(($) => $.dummy.cooldownHint),
          )}
        </Section>

        <Section
          title={t(($) => $.appearance.title)}
          description={t(($) => $.appearance.description)}
        >
          {percentField(
            'opacity',
            t(($) => $.appearance.opacity),
            15,
          )}
          <Field label={t(($) => $.appearance.scale)} error={e.scale}>
            {(id) => (
              <RangeField
                id={id}
                min={75}
                max={200}
                step={5}
                value={Math.round(s.scale * 100)}
                display={percent(s.scale)}
                onChange={(value) => set('scale', value / 100)}
              />
            )}
          </Field>
          {numberField(
            'fade_after_seconds',
            t(($) => $.appearance.fadeAfter),
            seconds,
            t(($) => $.appearance.fadeAfterHint),
          )}
          {percentField(
            'fade_opacity',
            t(($) => $.appearance.fadeOpacity),
            5,
          )}
          <Switch
            checked={s.compact_strip}
            onCheckedChange={(v) => set('compact_strip', v)}
            label={t(($) => $.appearance.compactStrip)}
            hint={
              s.hotkeys.compact_strip
                ? t(($) => $.appearance.compactStripHintKey, {
                    shortcut: s.hotkeys.compact_strip,
                  })
                : t(($) => $.appearance.compactStripHint)
            }
          />
        </Section>

        <Section title={t(($) => $.privacy.title)} description={t(($) => $.privacy.description)}>
          <Switch
            checked={s.hide_names}
            onCheckedChange={(v) => set('hide_names', v)}
            label={t(($) => $.privacy.hideNames)}
            hint={t(($) => $.privacy.hideNamesHint)}
          />
          <FieldGroup label={t(($) => $.privacy.copyLive)} wide>
            <CopySummary onCopy={onCopySummary} native={native} />
          </FieldGroup>
        </Section>

        <Section
          title={t(($) => $.hotkeysSection.title)}
          description={t(($) => $.hotkeysSection.description)}
        >
          {HOTKEY_ACTIONS.map((action) => (
            <Field
              key={action}
              label={hotkeyLabel(t, action)}
              error={e[`hotkeys.${action}`]}
              hint={
                action === 'toggle_lock'
                  ? t(($) => $.hotkeysSection.required)
                  : t(($) => $.hotkeysSection.optional)
              }
            >
              {(id) => (
                <HotkeyInput
                  id={id}
                  value={s.hotkeys[action]}
                  required={action === 'toggle_lock'}
                  onChange={(v) => setHotkey(action, v)}
                />
              )}
            </Field>
          ))}
        </Section>

        <Section
          title={t(($) => $.library.title)}
          description={
            status?.library_count === null || status?.library_count === undefined
              ? t(($) => $.library.sizeUnknown)
              : t(($) => $.library.size, {
                  count: status.library_count,
                  formattedCount: fmt.number.format(status.library_count),
                })
          }
        >
          <Switch
            checked={s.auto_save}
            onCheckedChange={(v) => set('auto_save', v)}
            label={t(($) => $.library.autoSave)}
          />
          {status?.error && (
            <Notice tone="error" className="col-span-full my-0">
              {t(($) => $.library.lastError, { error: status.error })}
            </Notice>
          )}
          <FieldGroup
            label={t(($) => $.library.actions)}
            wide
            hint={t(($) => $.library.actionsHint)}
          >
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<Icon name="save" size={13} />}
                disabled={!native || busy}
                onClick={() => void onAction('save')}
              >
                {t(($) => $.library.save)}
              </Button>
              <Button
                size="sm"
                icon={<Icon name="reset" size={13} />}
                disabled={!native || busy}
                onClick={() => void onAction('reset')}
              >
                {t(($) => $.library.reset)}
              </Button>
              <Button
                size="sm"
                icon={<Icon name="folder" size={13} />}
                disabled={!native || busy}
                onClick={() => void onAction('open_data_folder')}
              >
                {t(($) => $.library.openFolder)}
              </Button>
              {confirmClear ? (
                <>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!native || busy}
                    onClick={() => {
                      setConfirmClear(false);
                      void onAction('clear');
                    }}
                  >
                    {t(($) => $.library.discard)}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                    {t(($) => $.library.keep)}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Icon name="trash" size={13} />}
                  disabled={!native || busy}
                  onClick={() => setConfirmClear(true)}
                >
                  {t(($) => $.library.clear)}
                </Button>
              )}
            </span>
          </FieldGroup>
        </Section>

        <Section
          title={t(($) => $.catalogue.title)}
          description={
            status?.catalogue
              ? t(($) => $.catalogue.known, {
                  skills: fmt.number.format(status.catalogue.skills),
                  npcs: fmt.number.format(status.catalogue.npcs),
                })
              : t(($) => $.catalogue.unknown)
          }
        >
          <FieldGroup
            label={t(($) => $.catalogue.import)}
            wide
            hint={
              <Trans
                t={t}
                i18nKey={($) => $.catalogue.importHint}
                components={[
                  <code
                    key="schema"
                    className="rounded-xs bg-surface-3 px-1 py-px text-2xs text-ink-2"
                  >
                    {CATALOGUE_SCHEMA}
                  </code>,
                ]}
              />
            }
          >
            <label
              className={buttonClasses({ size: 'sm', className: 'w-fit' })}
              aria-disabled={!native}
            >
              <Icon name="fileUp" size={13} />
              {t(($) => $.catalogue.choose)}
              <input
                type="file"
                accept=".json,application/json"
                hidden
                disabled={!native}
                onChange={(ev) => {
                  void loadCatalogue(ev.target.files?.[0]);
                  ev.target.value = '';
                }}
              />
            </label>
            {catalogue && (
              <Notice tone={catalogue.ok ? 'good' : 'error'} onDismiss={() => setCatalogue(null)}>
                {catalogue.ok
                  ? t(($) => $.catalogue.imported, {
                      skills: fmt.number.format(catalogue.summary.skills),
                      npcs: fmt.number.format(catalogue.summary.npcs),
                    })
                  : t(($) => $.catalogue.failed, { detail: catalogue.detail })}
              </Notice>
            )}
          </FieldGroup>
        </Section>

        <Section title={t(($) => $.region.title)}>
          <Field
            label={t(($) => $.region.gameRegion)}
            hint={s.region === 'twkr' ? t(($) => $.region.twkrHint) : undefined}
          >
            {() => (
              <SegmentedControl
                label={t(($) => $.region.region)}
                value={s.region}
                onChange={(v) => set('region', v)}
                options={[
                  { value: 'global', label: t(($) => $.region.global) },
                  { value: 'twkr', label: t(($) => $.region.twkr) },
                ]}
              />
            )}
          </Field>
          <Field
            label={t(($) => $.language.label)}
            hint={
              isUiLocale(s.locale) || s.locale === 'pt'
                ? t(($) => $.language.hint)
                : t(($) => $.language.unsupportedHint)
            }
          >
            {(id) => <LanguageSelect id={id} value={s.locale} onChange={(v) => set('locale', v)} />}
          </Field>
        </Section>
      </SettingsGroup>

      {status && Object.keys(status.capabilities).length > 0 && (
        <Disclosure variant="plain" summary={t(($) => $.capabilities.title)} className="px-1">
          <KeyValueList
            className="[&_dt]:capitalize"
            items={Object.entries(status.capabilities).map(([k, v]) => ({
              label: k.replace(/_/g, ' '),
              value:
                typeof v === 'boolean'
                  ? v
                    ? t(($) => $.state.yes, { ns: 'common' })
                    : t(($) => $.state.no, { ns: 'common' })
                  : v,
            }))}
          />
        </Disclosure>
      )}
    </div>
  );
}
