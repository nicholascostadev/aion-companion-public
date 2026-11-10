import { useMemo, useState, type ReactNode } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { DpsToggle } from '../../components/ui/DpsToggle';
import { Notice } from '../../components/ui/Feedback';
import { Field, SearchInput, Select, Switch } from '../../components/ui/Field';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { WindowSwitch, windowState } from '../../components/ui/WindowSwitch';
import { Trans, useTranslation } from '../../i18n/provider';
import { DEFAULT_HOTKEYS } from '../../lib/offlineNormalize';
import { cn } from '../../lib/cn';
import { hiddenResourceKeys, type FinderPreferencesControl } from '../../lib/finderPreferences';
import type { AlertConfig, AlertOccurrence, AlertSound } from '../../types/alerts';
import type { HotkeyAction, OfflineSettings } from '../../types/offline';
import { AlertCatalogue } from '../alerts/AlertCatalogue';
import { ClockChapter, DeliveryChapter, MasterVolume, MuteControl } from '../alerts/AlertsPanel';
import { useClock } from '../alerts/useClock';
import { FINDER_MAPS } from '../finder/layers';
import { shownSpots, type Hidden } from '../gathering/map';
import { ResourceFilter } from '../gathering/ResourceFilter';
import { gatheringSpots } from '../gathering/spawns';
import { atlasMap, type AtlasMap } from '../maps/atlas';
import { HotkeyInput } from '../offline/HotkeyInput';
import { HOTKEY_ACTIONS, hotkeyLabel } from '../offline/settingsModel';
import { bestFarmMap, farmPlan, fold, petSearchText } from '../pets/farming';
import { mapName } from '../pets/model';
import { LinkFailure, useLinkOpener } from '../setup/links';
import { captureIssue } from '../setup/model';
import { NpcapExplainer } from '../setup/NpcapExplainer';
import { DemoMeter } from './DemoMeter';
import type { DemoFight } from './demo';
import type { GuideFacts } from './GuideDialog';
import { shortcutError, type ShortcutDrafts } from './shortcuts';

/** Saves one settings change through the guide, which tracks it for Finish. */
export type SaveSettings = (
  change: (settings: OfflineSettings) => OfflineSettings | null,
) => Promise<boolean>;

/**
 * Runs a change as one made on the current step, so Finish waits for it and a failure stays
 * on that step; resolves false when it was not made (the action resolved false or threw).
 */
export type Track = (action: () => Promise<unknown>) => Promise<boolean>;

/** The meter step's shortcuts set and not saved yet, and how to change them. */
export interface MeterShortcuts {
  /** Held for as long as the guide is, so leaving the step keeps them. */
  drafts: ShortcutDrafts;
  /** A change made on the meter step is being saved. */
  saving: boolean;
  /** A key just recorded: kept as a draft, checked, and saved when the settings can take it. */
  set: (action: HotkeyAction, value: string) => void;
  /** Puts every unsaved shortcut back to the saved one. */
  discard: () => void;
}

/* ---------- Building blocks ---------- */

/**
 * The facts of a step: a glyph and a sentence each, divided by hairlines. The glyph is as
 * tall as one line of text, so it sits centred on the first line whether the sentence takes
 * one line or several, and every row has the same space above and below.
 */
export function Facts({ items }: { items: { icon: IconName; text: ReactNode }[] }) {
  return (
    <ul className="m-0 flex max-w-2xl list-none flex-col p-0" data-onboarding="facts">
      {items.map((item, i) => (
        <li
          key={i}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border-t border-line-soft py-3 text-sm leading-5 text-ink-2 first:border-t-0 first:pt-0 last:pb-0"
        >
          <span
            className="grid size-5 place-items-center rounded-full bg-surface-3 text-ink-2"
            aria-hidden="true"
          >
            <Icon name={item.icon} size={12} />
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The reader's own state for this step: a light and a few words, never a guess. */
export function StateLine({
  tone,
  label,
  detail,
  live = false,
}: {
  tone: 'accent' | 'success' | 'warn' | 'danger' | 'neutral';
  label: ReactNode;
  detail?: ReactNode;
  live?: boolean;
}) {
  return (
    <p
      className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2"
      data-onboarding="state"
    >
      <StatusDot tone={tone} live={live} />
      <b className="font-semibold text-ink">{label}</b>
      {detail && <span className="text-ink-3">{detail}</span>}
    </p>
  );
}

/** The step's live state, in one quiet panel above its controls. */
function StatePanel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex max-w-2xl flex-col gap-1.5 rounded-lg border border-line-soft bg-surface-2 px-4 py-3">
      {children}
    </div>
  );
}

/** A small caps heading over a group of controls. */
function GroupTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        'm-0 mb-3 text-2xs font-semibold tracking-caps text-ink-3 uppercase',
        className,
      )}
    >
      {children}
    </h3>
  );
}

/** Says a change on this step was not saved, with native's reason when it gave one. */
export function SaveFailed({
  reason,
  busy = false,
  onRetry,
}: {
  reason: string;
  /** The retry is running. */
  busy?: boolean;
  /** Makes the same change again, on this step. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <Notice tone="error" className="mt-0 mb-5 max-w-2xl">
      <span data-onboarding="step-failed">
        {reason ? t(($) => $.saveFailed, { reason }) : t(($) => $.saveFailedPlain)}
        {onRetry && (
          <>
            {' '}
            <Button variant="link" disabled={busy} onClick={onRetry}>
              {busy ? t(($) => $.saving) : t(($) => $.retry)}
            </Button>
          </>
        )}
      </span>
    </Notice>
  );
}

function DesktopOnly({ native }: { native: boolean }) {
  const { t } = useTranslation('onboarding');
  if (native) return null;
  return <p className="mt-2 mb-0 text-xs text-ink-3">{t(($) => $.needsDesktop)}</p>;
}

/* ---------- Capture ---------- */

/** Npcap works and capture has opened: connected, or waiting for the game. */
export function captureReady(facts: GuideFacts) {
  const { setup, capture } = facts;
  return (
    !setup.error &&
    setup.status !== null &&
    captureIssue(setup.status) === null &&
    (capture === 'capturing' || capture === 'waiting')
  );
}

export function CaptureStep({ facts }: { facts: GuideFacts }) {
  const { t } = useTranslation(['onboarding', 'common', 'setup']);
  const { setup, capture } = facts;
  const links = useLinkOpener(facts.native ? setup.open : undefined);
  const issue = setup.error ? null : captureIssue(setup.status);
  const ready = captureReady(facts);
  const npcap = setup.status
    ? issue
      ? t(($) => $.badge[issue], { ns: 'setup' })
      : t(($) => $.badge.ready, { ns: 'setup' })
    : setup.checking
      ? t(($) => $.checking, { ns: 'setup' })
      : t(($) => $.chapters.capture.npcapUnknown);
  const captureDetail =
    capture === 'error'
      ? facts.captureError || t(($) => $.capture.hint.error, { ns: 'common' })
      : t(($) => $.capture.hint[capture], { ns: 'common' });
  return (
    <>
      <StatePanel>
        <StateLine
          tone={
            capture === 'capturing'
              ? 'accent'
              : capture === 'error'
                ? 'danger'
                : capture === 'waiting'
                  ? 'warn'
                  : 'neutral'
          }
          live={capture === 'capturing'}
          label={t(($) => $.capture.label[capture], { ns: 'common' })}
          detail={captureDetail}
        />
        <StateLine
          tone={
            issue
              ? issue === 'unsupported'
                ? 'neutral'
                : 'warn'
              : setup.status
                ? 'success'
                : 'neutral'
          }
          label={t(($) => $.chapters.capture.npcap, { state: npcap })}
          detail={
            facts.adapters !== null && facts.adapters > 0
              ? t(($) => $.chapters.capture.adapters, { count: facts.adapters })
              : undefined
          }
        />
      </StatePanel>
      <Notice tone={ready ? 'good' : 'info'} className="mt-0 mb-5 max-w-2xl">
        {ready ? t(($) => $.chapters.capture.ready) : t(($) => $.chapters.capture.notReady)}
      </Notice>
      <Facts
        items={[
          { icon: 'installer', text: t(($) => $.chapters.capture.install) },
          { icon: 'network', text: t(($) => $.chapters.capture.adapter) },
          { icon: 'play', text: t(($) => $.chapters.capture.early) },
        ]}
      />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {issue === 'missing' && (
          <Button
            size="sm"
            variant="primary"
            icon={<Icon name="download" size={14} />}
            loading={links.opening === 'npcap'}
            onClick={() => void links.open('npcap')}
          >
            {t(($) => $.npcap.install, { ns: 'setup' })}
          </Button>
        )}
        {issue === 'unavailable' && (
          <Button
            size="sm"
            variant="primary"
            icon={<Icon name="lifeBuoy" size={14} />}
            loading={links.opening === 'npcap_help'}
            onClick={() => void links.open('npcap_help')}
          >
            {t(($) => $.npcap.troubleshoot, { ns: 'setup' })}
          </Button>
        )}
        <Button
          size="sm"
          icon={<Icon name="refresh" size={14} />}
          loading={setup.checking}
          disabled={!facts.native}
          onClick={() => void setup.recheck()}
        >
          {setup.checking
            ? t(($) => $.checking, { ns: 'setup' })
            : t(($) => $.checkAgain, { ns: 'setup' })}
        </Button>
      </div>
      <LinkFailure error={links.error} />
      {!ready && (
        <p className="mt-3 mb-0 max-w-2xl text-xs leading-snug text-ink-3">
          {t(($) => $.chapters.capture.laterNote)}
        </p>
      )}
      {issue !== 'unsupported' && (
        <NpcapExplainer open={facts.native ? setup.open : undefined} className="mt-4" />
      )}
    </>
  );
}

/* ---------- DPS meter ---------- */

export function MeterStep({
  facts,
  demo,
  reducedMotion,
  active,
  shortcuts,
  track,
}: {
  facts: GuideFacts;
  demo: DemoFight | null | undefined;
  reducedMotion: boolean;
  active: boolean;
  shortcuts: MeterShortcuts;
  track: Track;
}) {
  const { t } = useTranslation('onboarding');
  const { t: ts } = useTranslation('settings');
  const { meter, settings } = facts;
  const hotkeys = settings?.hotkeys ?? DEFAULT_HOTKEYS;
  // A key just recorded shows at once and stays in its box until it is saved or put back.
  const { drafts, saving } = shortcuts;
  const unsaved = HOTKEY_ACTIONS.filter((action) => drafts[action]).length;
  // Coming back to unsaved shortcuts opens them; the reader folds them as they like after.
  const [openShortcuts] = useState(unsaved > 0);
  const problem = (action: HotkeyAction) => {
    const draft = drafts[action];
    if (!draft) return '';
    return (settings ? shortcutError(settings, action, draft.value, ts) : '') || draft.refused;
  };
  return (
    <div className="grid items-start gap-x-8 gap-y-6 min-[1100px]:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <DemoMeter demo={demo} active={active} reducedMotion={reducedMotion} hotkeys={hotkeys} />
        {demo && (
          <p className="mt-3 mb-0 text-xs leading-snug text-ink-3">
            {t(($) => $.chapters.meter.sample, {
              boss: demo.boss,
              instance: demo.instance,
              players: demo.players.length,
            })}
          </p>
        )}
      </div>
      <div className="min-w-0">
        <GroupTitle>{t(($) => $.chapters.meter.yoursTitle)}</GroupTitle>
        {/* Only showing it here: the meter is placed first, then locked in game. */}
        <div className="max-w-xs">
          <DpsToggle
            visible={meter.visible}
            suspended={meter.suspended}
            known={meter.known}
            busy={meter.busy}
            disabled={!facts.native}
            {...(hotkeys.toggle_overlay ? { shortcut: hotkeys.toggle_overlay } : {})}
            stacked
            onToggle={() => {
              // The state wanted is fixed at the click, so a retry repeats it, never inverts it.
              const visible = !meter.visible;
              void track(() => meter.setVisible(visible));
            }}
          />
        </div>
        <DesktopOnly native={facts.native} />
        <GroupTitle className="mt-6">{t(($) => $.chapters.meter.tryTitle)}</GroupTitle>
        <Facts
          items={[
            { icon: 'inspect', text: t(($) => $.chapters.meter.rows) },
            { icon: 'activity', text: t(($) => $.chapters.meter.mine) },
            {
              icon: 'compact',
              text: (
                <Trans
                  t={t}
                  i18nKey={($) => $.chapters.meter.strip}
                  values={{ key: hotkeys.compact_strip }}
                  components={[<kbd key="key" />]}
                />
              ),
            },
            {
              icon: 'lock',
              text: (
                <Trans
                  t={t}
                  i18nKey={($) => $.chapters.meter.lock}
                  values={{ key: hotkeys.toggle_lock }}
                  components={[<kbd key="key" />]}
                />
              ),
            },
            {
              icon: 'keyboard',
              text: (
                <Trans
                  t={t}
                  i18nKey={($) => $.chapters.meter.toggle}
                  values={{ key: hotkeys.toggle_overlay }}
                  components={[<kbd key="key" />]}
                />
              ),
            },
          ]}
        />
        <Disclosure
          className="mt-5 max-w-xl"
          summary={t(($) => $.chapters.meter.shortcutsTitle)}
          open={openShortcuts}
          bodyClassName="pb-2"
        >
          <p className="mt-0 mb-3 text-xs text-ink-3">{t(($) => $.chapters.meter.shortcutsHint)}</p>
          {unsaved > 0 && !saving && (
            <Notice tone="warn" className="mt-0 mb-3">
              <span data-onboarding="shortcuts-unsaved">
                {t(($) => $.chapters.meter.unsaved, { count: unsaved })}{' '}
                <Button variant="link" onClick={shortcuts.discard}>
                  {t(($) => $.chapters.meter.putBack)}
                </Button>
              </span>
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
            {HOTKEY_ACTIONS.map((action) => {
              const draft = drafts[action];
              const error = problem(action);
              return (
                <Field
                  key={action}
                  label={hotkeyLabel(ts, action)}
                  error={error || undefined}
                  hint={
                    draft && !saving
                      ? t(($) => $.chapters.meter.notSaved)
                      : action === 'toggle_lock'
                        ? ts(($) => $.hotkeysSection.required)
                        : undefined
                  }
                >
                  {(id) => (
                    <HotkeyInput
                      id={id}
                      value={draft?.value ?? hotkeys[action]}
                      required={action === 'toggle_lock'}
                      onChange={(v) => shortcuts.set(action, v)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

/* ---------- Saved fights ---------- */

export function InspectStep({ facts, save }: { facts: GuideFacts; save: SaveSettings }) {
  const { t } = useTranslation('onboarding');
  const { t: ts } = useTranslation('settings');
  const autoSave = facts.settings?.auto_save ?? null;
  const { savedFights } = facts;
  return (
    <>
      <StatePanel>
        {autoSave === null ? (
          <StateLine tone="neutral" label={t(($) => $.chapters.inspect.autoSaveUnknown)} />
        ) : (
          <StateLine
            tone={autoSave ? 'success' : 'warn'}
            label={
              autoSave
                ? t(($) => $.chapters.inspect.autoSaveOn)
                : t(($) => $.chapters.inspect.autoSaveOff)
            }
            detail={
              savedFights !== null
                ? t(($) => $.chapters.inspect.saved, { count: savedFights })
                : undefined
            }
          />
        )}
      </StatePanel>
      <div className="mb-5">
        <Switch
          checked={autoSave ?? false}
          disabled={autoSave === null}
          onCheckedChange={(on) => void save((s) => ({ ...s, auto_save: on }))}
          label={ts(($) => $.library.autoSave)}
        />
        <DesktopOnly native={facts.native} />
      </div>
      <Facts
        items={[
          { icon: 'book', text: t(($) => $.chapters.inspect.logs) },
          { icon: 'inspect', text: t(($) => $.chapters.inspect.details) },
          { icon: 'compare', text: t(($) => $.chapters.inspect.compare) },
          { icon: 'save', text: t(($) => $.chapters.inspect.files) },
        ]}
      />
    </>
  );
}

/* ---------- Profiles & privacy ---------- */

export function ProfilesStep({ facts, save }: { facts: GuideFacts; save: SaveSettings }) {
  const { t } = useTranslation('onboarding');
  const { t: ts } = useTranslation('settings');
  const hidden = facts.settings?.hide_names ?? null;
  return (
    <>
      <div className="mb-5">
        <Switch
          checked={hidden ?? false}
          disabled={hidden === null}
          onCheckedChange={(on) => void save((s) => ({ ...s, hide_names: on }))}
          label={ts(($) => $.privacy.hideNames)}
          hint={ts(($) => $.privacy.hideNamesHint)}
        />
        <DesktopOnly native={facts.native} />
      </div>
      {hidden && (
        <Notice tone="info" className="mt-0 mb-5 max-w-2xl">
          {t(($) => $.chapters.profiles.hidden)}
        </Notice>
      )}
      <Facts
        items={[
          { icon: 'inspect', text: t(($) => $.chapters.profiles.where) },
          { icon: 'profile', text: t(($) => $.chapters.profiles.source) },
          { icon: 'info', text: t(($) => $.chapters.profiles.limits) },
          { icon: 'star', text: t(($) => $.chapters.profiles.saved) },
        ]}
      />
    </>
  );
}

/* ---------- Alerts ---------- */

/** Reminders are on with at least one alert enabled; null until the alerts are read. */
export function alertsOn(facts: GuideFacts) {
  const config = facts.alerts.dashboard?.config;
  return config ? config.enabled && config.rules.some((r) => r.enabled) : null;
}

/**
 * Reminders in place: on or off, mute, volume and a test; the server clock (region, server,
 * fallback zone) so countdowns and built-in reminders are exact; delivery (background
 * sound, while the game is closed, quiet hours); and the ready-made catalogue. Every control
 * is the Alerts tab's own, saving through the alerts' path.
 */
export function AlertsStep({
  facts,
  active,
  track,
}: {
  facts: GuideFacts;
  active: boolean;
  track: Track;
}) {
  const { t } = useTranslation('onboarding');
  const { t: ta } = useTranslation('alerts');
  const { alerts } = facts;
  const { dashboard } = alerts;
  const clock = useClock(1000, active);
  const [options, setOptions] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const configure = (change: (config: AlertConfig) => AlertConfig) =>
    track(() => alerts.configure(change));
  const test = (sound: AlertSound, volume: number, popup: boolean) =>
    void alerts.test(sound, volume, popup).then((ok) => setTested(ok));
  if (!dashboard)
    return (
      <>
        <StatePanel>
          <StateLine tone="neutral" label={t(($) => $.chapters.alerts.loading)} />
        </StatePanel>
        <DesktopOnly native={facts.native} />
        {alerts.error && <Notice tone="error">{alerts.error}</Notice>}
      </>
    );
  const { config } = dashboard;
  const nowMs = clock + alerts.offsetMs;
  const on = config.rules.filter((r) => r.enabled).length;
  const nextByRule = new Map<string, AlertOccurrence>();
  for (const o of dashboard.upcoming) {
    const seen = nextByRule.get(o.rule_id);
    if (!seen || (o.due_ms ?? Infinity) < (seen.due_ms ?? Infinity)) nextByRule.set(o.rule_id, o);
  }
  return (
    <>
      <StatePanel>
        <StateLine
          tone={config.enabled && on > 0 ? 'success' : 'neutral'}
          label={
            !config.enabled
              ? t(($) => $.chapters.alerts.off)
              : on > 0
                ? t(($) => $.chapters.alerts.on, { count: on })
                : t(($) => $.chapters.alerts.none)
          }
        />
        <StateLine
          tone={dashboard.clock_estimated ? 'warn' : 'success'}
          label={
            dashboard.clock_estimated
              ? t(($) => $.chapters.alerts.clockUnknown)
              : t(($) => $.chapters.alerts.clockKnown)
          }
          detail={
            dashboard.clock_estimated ? t(($) => $.chapters.alerts.clockUnknownHint) : undefined
          }
        />
      </StatePanel>
      <div className="mb-6 flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-3">
        <Switch
          checked={config.enabled}
          disabled={alerts.busy}
          onCheckedChange={(enabled) => void configure((c) => ({ ...c, enabled }))}
          label={ta(($) => $.panel.notifications)}
        />
        <MuteControl
          config={config}
          nowMs={nowMs}
          busy={alerts.busy}
          onMute={(seconds) => void track(() => alerts.action('mute', null, seconds))}
          onUnmute={() => void track(() => alerts.action('unmute'))}
        />
        <MasterVolume
          volume={config.volume}
          onCommit={(volume) => configure((c) => ({ ...c, volume }))}
        />
        <Button
          size="sm"
          icon={<Icon name="volume" size={14} />}
          onClick={() => test('chime', 1, false)}
        >
          {t(($) => $.chapters.alerts.testSound)}
        </Button>
      </div>
      {tested && (
        <Notice tone="good" className="max-w-2xl" onDismiss={() => setTested(false)}>
          {t(($) => $.chapters.alerts.testSent)}
        </Notice>
      )}
      {(alerts.error || dashboard.error) && (
        <Notice tone="error" className="max-w-2xl">
          {alerts.error || dashboard.error}
        </Notice>
      )}
      <div
        className="mb-6 grid max-w-4xl items-start gap-x-8 gap-y-6 min-[1100px]:grid-cols-2"
        data-onboarding="alert-settings"
      >
        <div className="min-w-0">
          <ClockChapter
            dashboard={dashboard}
            nowMs={nowMs}
            busy={alerts.busy}
            onConfigure={configure}
          />
        </div>
        <div className="min-w-0">
          <DeliveryChapter
            key={`${config.quiet_hours?.start ?? ''}-${config.quiet_hours?.end ?? ''}`}
            config={config}
            gameRunning={dashboard.game_running}
            clock={dashboard.effective_timezone}
            nowMs={nowMs}
            busy={alerts.busy}
            onConfigure={configure}
          />
        </div>
      </div>
      <div data-onboarding="alert-catalogue">
        <AlertCatalogue
          dashboard={dashboard}
          nowMs={nowMs}
          busy={alerts.busy}
          configure={configure}
          onTest={test}
          now={alerts.now}
          nextByRule={nextByRule}
          options={options}
          setOptions={setOptions}
        />
      </div>
      <Disclosure className="mt-4 max-w-2xl" summary={t(($) => $.chapters.alerts.howTitle)}>
        <Facts
          items={[
            { icon: 'appWindow', text: t(($) => $.chapters.alerts.delivery) },
            { icon: 'observed', text: t(($) => $.chapters.alerts.sightings) },
            { icon: 'quiet', text: t(($) => $.chapters.alerts.paused) },
          ]}
        />
      </Disclosure>
    </>
  );
}

/* ---------- Pets ---------- */

const PET_RESULTS = 6;

/**
 * Pet farming is in use with a saved farming goal or a pinned pet (pins lead the radar and
 * every pet list); null until the pets are read. The radar window alone is not counted.
 */
export function petsOn(facts: GuideFacts) {
  const config = facts.pets.status?.config;
  return config ? config.farming_goal !== null || config.pinned_ids.length > 0 : null;
}

export function PetsStep({ facts, track }: { facts: GuideFacts; track: Track }) {
  const { t } = useTranslation('onboarding');
  const { pets } = facts;
  const { index, status, farming, radar } = pets;
  const goal = status?.config.farming_goal ?? null;
  const pinned = status?.config.pinned_ids ?? [];
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const matches = useMemo(() => {
    if (!index) return [];
    const needle = fold(query.trim());
    if (!needle) return [];
    return index.catalogue.pets.filter((p) => petSearchText(index, p).includes(needle));
  }, [index, query]);
  const pet = index && chosen !== null ? (index.pets.get(chosen) ?? null) : null;
  const plan = index && pet ? farmPlan(index, pet, null) : null;
  const best = plan ? bestFarmMap(plan, status?.config.last_map_id ?? null) : null;
  const map = plan?.rows.find((r) => r.map.id === mapId)?.map ?? best;
  const goalPet = goal && index ? index.pets.get(goal.pet_id) : undefined;
  const petName = (id: number) => (index ? index.pets.get(id)?.name : undefined) ?? `#${id}`;
  const isPinned = pet !== null && pinned.includes(pet.id);
  return (
    <>
      <StatePanel>
        {status === null ? (
          <StateLine tone="neutral" label={t(($) => $.chapters.pets.loading)} />
        ) : (
          <>
            {goal ? (
              <StateLine
                tone="success"
                label={t(($) => $.chapters.pets.goal, {
                  pet: goalPet?.name ?? `#${goal.pet_id}`,
                  map: index ? mapName(index, goal.map_id) : goal.map_id,
                })}
              />
            ) : (
              <StateLine tone="neutral" label={t(($) => $.chapters.pets.goalNone)} />
            )}
            {pinned.length > 0 && (
              <StateLine
                tone="success"
                label={t(($) => $.chapters.pets.pinnedCount, { count: pinned.length })}
                detail={pinned.slice(0, 3).map(petName).join(', ')}
              />
            )}
          </>
        )}
      </StatePanel>
      <div className="grid max-w-3xl items-start gap-x-8 gap-y-5 min-[900px]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {!index ? (
            pets.catalogueError ? (
              <Notice tone="error">{t(($) => $.chapters.pets.catalogueFailed)}</Notice>
            ) : (
              <StateLine tone="neutral" label={t(($) => $.chapters.pets.catalogueLoading)} />
            )
          ) : (
            <Field label={t(($) => $.chapters.pets.find)}>
              {(id) => (
                <SearchInput
                  id={id}
                  value={query}
                  placeholder={t(($) => $.chapters.pets.findPlaceholder)}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </Field>
          )}
          {index && query.trim() !== '' && (
            <ul
              className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0"
              aria-label={t(($) => $.chapters.pets.find)}
            >
              {matches.length === 0 && (
                <li className="px-2.5 py-2 text-sm text-ink-3">
                  {t(($) => $.chapters.pets.noMatch)}
                </li>
              )}
              {matches.slice(0, PET_RESULTS).map((p) => (
                <li key={p.id}>
                  <Pressable
                    aria-pressed={p.id === chosen}
                    className={cn(
                      selectableRow(p.id === chosen),
                      'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-ink',
                    )}
                    onClick={() => {
                      setChosen(p.id);
                      setMapId(null);
                    }}
                  >
                    <Icon name="paw" size={13} className="text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {pinned.includes(p.id) && <Icon name="pin" size={12} className="text-accent" />}
                    <span className="text-xs text-ink-3">{p.family}</span>
                  </Pressable>
                </li>
              ))}
              {matches.length > PET_RESULTS && (
                <li className="px-2.5 pt-1 text-xs text-ink-3">{t(($) => $.chapters.pets.more)}</li>
              )}
            </ul>
          )}
          {pet && plan && (
            <div className="mt-4 flex flex-col gap-2" data-onboarding="pet-choice">
              <div className="flex flex-wrap items-end gap-2">
                {plan.rows.length === 0 ? (
                  <p className="m-0 flex-1 text-sm text-ink-3">
                    {t(($) => $.chapters.pets.noMaps)}
                  </p>
                ) : (
                  <>
                    <Field label={t(($) => $.chapters.pets.map)} className="min-w-48 flex-1">
                      {(id) => (
                        <Select
                          id={id}
                          value={map?.id ?? ''}
                          onChange={(e) => setMapId(e.target.value)}
                        >
                          {plan.rows.map((r) => (
                            <option key={r.map.id} value={r.map.id}>
                              {r.label?.label ?? r.map.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Icon name="target" size={14} />}
                      loading={farming.busy}
                      disabled={!map || !facts.native}
                      onClick={() =>
                        map && void track(() => farming.start({ pet_id: pet.id, map_id: map.id }))
                      }
                    >
                      {t(($) => $.chapters.pets.farm)}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  aria-pressed={isPinned}
                  icon={<Icon name={isPinned ? 'unpin' : 'pin'} size={14} />}
                  disabled={!facts.native || status === null}
                  onClick={() => void track(() => pets.setPinned(pet.id, !isPinned))}
                >
                  {isPinned ? t(($) => $.chapters.pets.unpin) : t(($) => $.chapters.pets.pin)}
                </Button>
              </div>
              <p className="m-0 text-xs leading-snug text-ink-3">
                {radar.status.requested
                  ? t(($) => $.chapters.pets.choiceHint)
                  : t(($) => $.chapters.pets.choiceHintRadar)}
              </p>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <WindowSwitch
            on={radar.known && radar.status.requested}
            icon="radar"
            label={t(($) => $.chapters.pets.radar)}
            state={windowState({
              known: radar.known,
              requested: radar.status.requested,
              held: !radar.status.visible,
            })}
            busy={radar.busy}
            disabled={!facts.native || !radar.known}
            stacked
            onClick={() => {
              const requested = !radar.status.requested;
              void track(() => radar.setRequested(requested));
            }}
          />
          {goal && (
            <Button
              size="sm"
              icon={<Icon name="stop" size={14} />}
              disabled={farming.busy}
              onClick={() => void track(farming.stop)}
            >
              {t(($) => $.chapters.pets.stop)}
            </Button>
          )}
        </div>
      </div>
      <DesktopOnly native={facts.native} />
      {(farming.notice || pets.error || radar.error) && (
        <Notice tone="error" className="max-w-2xl">
          {farming.notice || pets.error || radar.error}
        </Notice>
      )}
      <div className="mt-5">
        <Facts items={[{ icon: 'info', text: t(($) => $.chapters.pets.honest) }]} />
      </div>
    </>
  );
}

/* ---------- Explore ---------- */

/** Explore shows a finder, or its window is asked for; null until the choices are read. */
export function exploreOn(facts: GuideFacts) {
  const prefs = facts.explore.prefs.prefs;
  if (!prefs) return null;
  const win = facts.explore.window;
  return prefs.visibility.cubes || prefs.visibility.gathering || !!(win?.known && win.requested);
}

export function ExploreStep({ facts, track }: { facts: GuideFacts; track: Track }) {
  const { t } = useTranslation('onboarding');
  const { prefs: control, window: win } = facts.explore;
  const prefs = control.prefs;
  return (
    <>
      {!prefs ? (
        <StatePanel>
          <StateLine tone="neutral" label={t(($) => $.chapters.explore.loading)} />
        </StatePanel>
      ) : (
        <div className="grid max-w-3xl items-start gap-x-8 gap-y-5 min-[900px]:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Switch
              checked={prefs.visibility.cubes}
              onCheckedChange={(cubes) => control.update({ visibility: { cubes } })}
              label={t(($) => $.chapters.explore.cubes)}
              hint={t(($) => $.chapters.explore.cubesHint)}
            />
            <Switch
              checked={prefs.visibility.gathering}
              onCheckedChange={(gathering) => control.update({ visibility: { gathering } })}
              label={t(($) => $.chapters.explore.gathering)}
              hint={t(($) => $.chapters.explore.gatheringHint)}
            />
            <Disclosure summary={t(($) => $.chapters.explore.cubeLayers)}>
              <div className="flex flex-col gap-3 pb-2">
                {(['nearby', 'earlier', 'possible'] as const).map((layer) => (
                  <Switch
                    key={layer}
                    checked={prefs.cube_layers[layer]}
                    disabled={!prefs.visibility.cubes}
                    onCheckedChange={(on) => control.update({ cube_layers: { [layer]: on } })}
                    label={t(($) => $.chapters.explore[layer])}
                  />
                ))}
              </div>
            </Disclosure>
            {prefs.visibility.gathering && <GatheringChoice control={control} />}
          </div>
          {win && (
            <div className="min-w-0">
              <WindowSwitch
                on={win.known && win.requested}
                icon="compass"
                label={t(($) => $.chapters.explore.window)}
                state={windowState({
                  known: win.known,
                  requested: win.requested,
                  held: !win.visible,
                })}
                busy={win.busy}
                disabled={!facts.native || !win.known}
                stacked
                onClick={() => {
                  const requested = !win.requested;
                  void track(() => win.setRequested(requested));
                }}
              />
              <p className="mt-2 mb-0 text-xs text-ink-3">
                {t(($) => $.chapters.explore.windowHint)}
              </p>
            </div>
          )}
        </div>
      )}
      {(control.error || win?.error) && (
        <Notice tone="error" className="max-w-2xl">
          {control.error || win?.error}
        </Notice>
      )}
      <DesktopOnly native={facts.native} />
    </>
  );
}

/** Finder maps with possible gathering locations, in the Explore tab's order. */
const gatheringMaps = (): AtlasMap[] =>
  FINDER_MAPS.flatMap((id) => {
    const map = atlasMap(id);
    return map && gatheringSpots(id) ? [map] : [];
  });

/**
 * Which gathering resources Explore marks: the Explore tab's own resource filter, saved to
 * the shared Explore choices, so the tab and the in-game window follow at once. The map
 * only chooses which resources are listed here (and counted); a choice holds on every map,
 * and the map Explore shows is left as it is.
 */
function GatheringChoice({ control }: { control: FinderPreferencesControl }) {
  const { t } = useTranslation('onboarding');
  const { t: tm } = useTranslation('maps');
  const { t: tg } = useTranslation('gathering');
  const maps = useMemo(() => gatheringMaps(), []);
  const chosen = control.prefs?.chosen_map ?? null;
  const [mapId, setMapId] = useState<string | null>(
    () => maps.find((m) => m.id === chosen)?.id ?? maps[0]?.id ?? null,
  );
  const spots = mapId ? gatheringSpots(mapId) : null;
  const key = control.prefs?.hidden_resources.join(' ') ?? '';
  const hidden = useMemo<Hidden>(() => new Set(key ? key.split(' ') : []), [key]);
  const shown = shownSpots(spots, hidden).resources.length;
  if (maps.length === 0) return null;
  return (
    <Disclosure summary={t(($) => $.chapters.explore.resources)} bodyClassName="pb-2">
      <div className="flex flex-col gap-3" data-onboarding="gathering-filter">
        <Field label={tm(($) => $.map.chooser)} hint={t(($) => $.chapters.explore.resourcesHint)}>
          {(id) => (
            <Select id={id} value={mapId ?? ''} onChange={(e) => setMapId(e.target.value)}>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ResourceFilter
          spots={spots}
          hidden={hidden}
          setHidden={(next) => control.update({ hidden_resources: hiddenResourceKeys(next) })}
          shown={shown}
        />
        <p className="m-0 text-2xs text-ink-3">{tg(($) => $.source)}</p>
      </div>
    </Disclosure>
  );
}

/* ---------- Updates ---------- */

export function UpdatesStep({ facts }: { facts: GuideFacts }) {
  const { t } = useTranslation('onboarding');
  const { status, error, busy, check } = facts.updates;
  const waiting = status && (status.phase === 'available' || status.phase === 'ready');
  return (
    <>
      <StatePanel>
        {status ? (
          <StateLine
            tone={
              waiting
                ? 'accent'
                : status.phase === 'error'
                  ? 'warn'
                  : status.phase === 'current'
                    ? 'success'
                    : 'neutral'
            }
            label={
              waiting
                ? t(($) => $.chapters.updates.waiting, { version: status.latest_version ?? '' })
                : status.phase === 'current'
                  ? t(($) => $.chapters.updates.current)
                  : status.phase === 'checking'
                    ? t(($) => $.chapters.updates.checking)
                    : t(($) => $.chapters.updates.other)
            }
            detail={t(($) => $.chapters.updates.version, { version: status.current_version })}
          />
        ) : (
          <StateLine tone="neutral" label={t(($) => $.chapters.updates.unknown)} />
        )}
        {waiting && (
          <p className="m-0 text-xs text-ink-3">{t(($) => $.chapters.updates.waitingHint)}</p>
        )}
      </StatePanel>
      <div className="mb-5">
        <Button
          size="sm"
          icon={<Icon name="refresh" size={14} />}
          loading={busy}
          disabled={!facts.native || busy}
          onClick={() => void check()}
        >
          {t(($) => $.chapters.updates.check)}
        </Button>
        <DesktopOnly native={facts.native} />
      </div>
      {(error || status?.error) && (
        <Notice tone="warn" className="max-w-2xl">
          {t(($) => $.chapters.updates.failed, { reason: error || status?.error || '' })}
        </Notice>
      )}
      <Facts items={[{ icon: 'database', text: t(($) => $.chapters.updates.keeps) }]} />
    </>
  );
}
