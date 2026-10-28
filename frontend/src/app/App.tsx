import { useCallback, useEffect, useRef, useState } from 'react';
import { AppFooter } from '../components/layout/AppFooter';
import { AppHeader } from '../components/layout/AppHeader';
import { ComparePanel } from '../features/offline/ComparePanel';
import { LiveAnalysis } from '../features/offline/LiveAnalysis';
import { LogLibrary } from '../features/offline/LogLibrary';
import { SaveBar, SettingsPanel } from '../features/offline/SettingsPanel';
import { useSettingsDraft } from '../features/offline/settingsModel';
import { TrackersPanel } from '../features/offline/TrackersPanel';
import { UpdateIndicator } from '../features/updates/UpdateIndicator';
import { UPDATES_SECTION_ID, UpdatesPanel } from '../features/updates/UpdatesPanel';
import { DiagnosticsPanel } from '../features/diagnostics/DiagnosticsPanel';
import { BackupsPanel } from '../features/backups/BackupsPanel';
import { SETUP_SECTION_ID } from '../features/setup/model';
import { SetupPanel } from '../features/setup/SetupPanel';
import { Notice } from '../components/ui/Feedback';
import { Section } from '../components/ui/Panel';
import { TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import { RecordingToolbar } from '../features/recordings/RecordingToolbar';
import { DamageSummary } from '../features/replay/DamageSummary';
import { PositionReplay } from '../features/replay/PositionReplay';
import { ReplayControls } from '../features/replay/ReplayControls';
import { ReplayProgress } from '../features/replay/ReplayProgress';
import { AlertsPanel } from '../features/alerts/AlertsPanel';
import { HomeTab } from './HomeTab';
import { ExploreTab } from './ExploreTab';
import { PetsTab } from './PetsTab';
import { useAlerts } from '../hooks/useAlerts';
import { useActivityWindow } from '../hooks/useActivityWindow';
import { useAppBuildInfo } from '../hooks/useAppBuildInfo';
import { useFinderPreferences } from '../hooks/useFinderPreferences';
import { useBackups } from '../hooks/useBackups';
import { useDiagnosticsReport } from '../hooks/useDiagnosticsReport';
import { useCompanion } from '../hooks/useCompanion';
import { useLiveCapture } from '../hooks/useLiveCapture';
import { useLogLibrary } from '../hooks/useLogLibrary';
import { useNativeEvent } from '../hooks/useNativeEvent';
import { useOffline } from '../hooks/useOffline';
import { useOverlayControls } from '../hooks/useOverlay';
import { usePageVisible } from '../hooks/usePageVisible';
import { useSetup } from '../hooks/useSetup';
import { useUpdateAccess } from '../hooks/useUpdateAccess';
import { useUpdates } from '../hooks/useUpdates';
import { LiveMeter } from '../features/live/LiveMeter';
import { captureState } from '../lib/capture';
import { copyText } from '../lib/clipboard';
import { DEFAULT_HOTKEYS } from '../lib/offlineNormalize';
import { dpsRequested, groupEnabled, groupRequested } from '../lib/overlayState';
import { importCatalogue, readLog, readSummary } from '../services/offline';
import type { LogId } from '../types/offline';
import { onWorkspaceTab } from '../services/alerts';
import { useTranslation } from '../i18n/provider';
import { isFinderLayer, type FinderFocus, type FinderLayer } from '../features/finder/layers';

/** Copies a native summary of a saved log, or of the live fight when `id` is null. */
const copySummary = (id: string | null) => async (multiline: boolean) =>
  copyText(await readSummary(id, multiline));

const WORKSPACE_TABS = [
  'home',
  'live',
  'logs',
  'compare',
  'trackers',
  'alerts',
  'pets',
  'explore',
  'settings',
  'replay',
] as const;
type WorkspaceTab = (typeof WORKSPACE_TABS)[number];
const isWorkspaceTab = (value: string): value is WorkspaceTab =>
  (WORKSPACE_TABS as readonly string[]).includes(value);
/**
 * Explore was named Maps, and the finders that were tabs of their own (`cubes`,
 * `gathering`) are its layers now: their old names, in links and from other windows, open
 * Explore (with that layer shown).
 */
const finderOfTab = (value: string): FinderLayer | null => (isFinderLayer(value) ? value : null);
const EXPLORE_ALIASES: readonly string[] = ['maps', 'finder'];
const askedTab = () => new URLSearchParams(window.location.search).get('tab') ?? '';
/** `?tab=` opens the workspace on that tab (previews and links); Home otherwise. */
const initialTab = (): WorkspaceTab => {
  const asked = askedTab();
  if (isWorkspaceTab(asked)) return asked;
  return finderOfTab(asked) || EXPLORE_ALIASES.includes(asked) ? 'explore' : 'home';
};
const initialFocus = (): FinderFocus | null => {
  const layer = finderOfTab(askedTab());
  return layer ? { layer, request: 0 } : null;
};

export default function App() {
  const { t } = useTranslation('workspace');
  const companion = useCompanion();
  const buildInfo = useAppBuildInfo(companion.native);
  // Everything polled here only feeds the screen: a minimised workspace reads nothing, and
  // reads again at once when it shows. Native keeps capturing, alerting and updating.
  const visible = usePageVisible();
  const paused = !visible;
  const capture = useLiveCapture(companion.native, { paused });
  const dps = useOverlayControls({ onError: companion.setStatus, paused });
  const timers = useActivityWindow('timers', { intervalMs: 2000, paused });
  const exploreWindow = useActivityWindow('explore', { intervalMs: 2000, paused });
  // Held here, so the saved Explore choices outlive the tab and follow the in-game window.
  const explorePrefs = useFinderPreferences(companion.native);
  const shownFocus = useRef<number | null>(null);
  const activityToggle = (win: typeof timers) => ({
    requested: win.status.requested,
    visible: win.status.visible,
    known: win.known,
    busy: win.busy,
    onToggle: () => void win.toggle(),
  });
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [exploreFocus, setExploreFocus] = useState<FinderFocus | null>(initialFocus);
  /** A workspace tab by name, or Explore by an earlier name (with a finder's layer shown). */
  const navigate = (next: string) => {
    if (isWorkspaceTab(next)) return setTab(next);
    const layer = finderOfTab(next);
    if (!layer && !EXPLORE_ALIASES.includes(next)) return;
    if (layer) setExploreFocus((last) => ({ layer, request: (last?.request ?? 0) + 1 }));
    setTab('explore');
  };
  // A finder asked for by an earlier name is shown, once, as soon as the saved choices are
  // known; the tab mounting again later does not ask again.
  const focusLayer = exploreFocus?.layer;
  const focusRequest = exploreFocus?.request;
  const focusShown = focusLayer ? explorePrefs.prefs?.visibility[focusLayer] : undefined;
  const { update: updateExplore } = explorePrefs;
  useEffect(() => {
    if (!focusLayer || focusShown === undefined || shownFocus.current === focusRequest) return;
    shownFocus.current = focusRequest ?? null;
    if (!focusShown) updateExplore({ visibility: { [focusLayer]: true } });
  }, [focusLayer, focusRequest, focusShown, updateExplore]);
  // Only the Live tab draws the live report's events, buffs and HP; every other tab (and a
  // hidden window, which reads nothing) keeps to the compact summary.
  const offline = useOffline(companion.native, { paused, detail: tab === 'live' });
  const settings = offline.status?.settings ?? null;
  // Saved fights are read in the same target scope as the live report.
  const bossOnly = settings?.target_mode === 'boss';
  // Logs is unmounted on other tabs, so its report view starts afresh there anyway; a
  // minimised window keeps it drawn as it was.
  const library = useLogLibrary(companion.native, offline.status?.library_count ?? null, {
    shown: tab === 'logs',
    bossOnly,
  });
  const loadLog = useCallback((id: string) => readLog(id, bossOnly), [bossOnly]);
  const draft = useSettingsDraft(settings, offline.configure);
  // Native delivers alert sounds and popups; this window only shows and edits them.
  // Home shows what is ringing, so it reads a little more often than the other tabs.
  const alerts = useAlerts(companion.native, {
    intervalMs: tab === 'alerts' ? 1000 : tab === 'home' ? 2000 : 5000,
    paused,
  });
  // Native checks GitHub once at startup and owns every update step; this only reads its
  // status while the workspace is visible, for the header's update pill on every tab, and
  // more often on Settings, where the steps are taken.
  const updates = useUpdates(companion.native, {
    active: visible,
    idleMs: tab === 'settings' ? 5000 : 30_000,
  });
  // What this PC has for live capture: probed when the workspace shows and on Check again,
  // never on a timer. Capture retries by itself; once it waits for the game or connects, the
  // driver evidently works, so a stale problem is probed again rather than left on screen.
  const setup = useSetup(companion.native, { active: visible });
  // How releases are read: the updater's own answer outranks the setup probe, which may have
  // run before the first update check found the releases public.
  const distribution = updates.status?.distribution ?? setup.status?.distribution;
  // GitHub access for private release updates: only a stable build known to read the private
  // repository has it, and only App updates on screen reads it. Development never probes.
  const privateUpdates = distribution === 'private' && updates.status?.channel === 'stable';
  const updateAccess = useUpdateAccess(companion.native, {
    active: visible && tab === 'settings' && privateUpdates,
  });
  const captureNow = captureState(capture.live);
  const driverWorks = captureNow === 'capturing' || captureNow === 'waiting';
  const npcapReady = setup.status?.npcap.state === 'ready';
  const { recheck: recheckSetup } = setup;
  useEffect(() => {
    if (driverWorks && !npcapReady) void recheckSetup();
  }, [driverWorks, npcapReady, recheckSetup]);
  // Home names a known problem in place of capture's error. Each retry repeats the same error;
  // a different one means something changed since the probe, so it is probed again, not masked.
  const failure = captureNow === 'error' ? (capture.live?.message ?? '') : '';
  const lastFailure = useRef('');
  useEffect(() => {
    if (!failure) return;
    const changed = lastFailure.current !== '' && lastFailure.current !== failure;
    lastFailure.current = failure;
    if (changed && !npcapReady) void recheckSetup();
  }, [failure, npcapReady, recheckSetup]);
  // The header's update pill opens Settings at App updates, and Home's setup band at Setup;
  // each click asks again.
  const [section, setSection] = useState<{ id: string; asked: number } | null>(null);
  const openSection = useCallback((id: string) => {
    setTab('settings');
    setSection((last) => ({ id, asked: (last?.asked ?? 0) + 1 }));
  }, []);
  const openUpdates = useCallback(() => openSection(UPDATES_SECTION_ID), [openSection]);
  useEffect(() => {
    if (!section) return;
    const target = document.getElementById(section.id);
    target?.scrollIntoView?.({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [section]);
  // Held here so an export keeps its result while another tab is shown.
  const diagnostics = useDiagnosticsReport();
  // Held here too, so a backup result or a checked restore file survives a tab change.
  const backups = useBackups(companion.native, { active: visible && tab === 'settings' });
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const { recording, snapshot } = companion;
  const disabled = !companion.native || companion.loading;
  const { open: openLog } = library;
  /** A fight from Home opens its report in Logs. */
  const onOpenLog = useCallback(
    (id: LogId) => {
      setTab('logs');
      void openLog(id);
    },
    [openLog],
  );
  const update = updates.status;

  // Other windows (the top menu bell) can open a workspace section.
  useNativeEvent(onWorkspaceTab, navigate, { enabled: companion.native });

  const tabs = [
    { id: 'home' as const, label: t(($) => $.tabs.home) },
    { id: 'live' as const, label: t(($) => $.tabs.live) },
    {
      id: 'logs' as const,
      label: t(($) => $.tabs.logs),
      badge: library.fresh.length ? library.fresh.length : undefined,
    },
    { id: 'compare' as const, label: t(($) => $.tabs.compare) },
    { id: 'trackers' as const, label: t(($) => $.tabs.trackers) },
    {
      id: 'alerts' as const,
      label: t(($) => $.tabs.alerts),
      badge: alerts.dashboard?.active.length ? alerts.dashboard.active.length : undefined,
    },
    { id: 'pets' as const, label: t(($) => $.tabs.pets) },
    { id: 'explore' as const, label: t(($) => $.tabs.explore) },
    {
      id: 'settings' as const,
      label: t(($) => $.tabs.settings),
      badge: draft.dirty ? '•' : undefined,
    },
    { id: 'replay' as const, label: t(($) => $.tabs.replay) },
  ];

  return (
    <>
      <AppHeader
        native={companion.native}
        buildInfo={buildInfo}
        dps={{
          visible: dpsRequested(dps.overlay),
          known: dps.known,
          locked: dps.overlay.locked,
        }}
        onQuit={() => void dps.quit()}
        {...(settings ? { hotkeys: settings.hotkeys } : {})}
        update={<UpdateIndicator status={updates.status} onOpen={openUpdates} />}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <nav
          className="sticky top-header z-10 border-b border-line-soft bg-veil backdrop-blur-md"
          aria-label={t(($) => $.nav.label)}
        >
          <div className="mx-auto max-w-workspace px-4 max-[720px]:px-1">
            <TabList label={t(($) => $.nav.sections)} items={tabs} />
          </div>
        </nav>
        <main className="mx-auto max-w-workspace px-7 pt-6 pb-2 max-[720px]:px-4">
          {dps.error && tab !== 'replay' && <Notice tone="error">{dps.error}</Notice>}
          {(timers.error || exploreWindow.error) && (
            <Notice tone="error">{timers.error || exploreWindow.error}</Notice>
          )}
          <TabPanel value="home">
            <HomeTab
              native={companion.native}
              live={capture.live}
              captureError={capture.error}
              liveTarget={
                offline.status?.report?.targets.find((t) => t.boss) ??
                offline.status?.report?.targets[0] ??
                null
              }
              windows={{
                known: dps.known,
                busy: dps.busy,
                dps: dpsRequested(dps.overlay),
                suspended: dps.overlay.focus_suppressed ?? false,
                locked: dps.overlay.locked,
                group: groupEnabled(dps.overlay),
                groupRequested: groupRequested(dps.overlay),
                trackers: dps.overlay.trackers_requested ?? false,
                timers: activityToggle(timers),
                explore: activityToggle(exploreWindow),
                onToggleDps: () => void dps.toggle(),
                onLock: (locked) => void dps.lock(locked),
                onToggleGroup: () => void dps.toggleGroup(),
                onToggleTrackers: () => void dps.toggleTrackers(),
              }}
              hotkeys={settings?.hotkeys ?? DEFAULT_HOTKEYS}
              autoSave={settings?.auto_save ?? null}
              libraryCount={offline.status?.library_count ?? null}
              alerts={alerts}
              setup={setup}
              update={
                update && (update.phase === 'available' || update.phase === 'ready')
                  ? {
                      version: update.latest_version,
                      ready: update.phase === 'ready',
                    }
                  : null
              }
              onNavigate={(to) => (to === 'setup' ? openSection(SETUP_SECTION_ID) : setTab(to))}
              onOpenLog={onOpenLog}
            />
          </TabPanel>
          <TabPanel value="live" keepMounted>
            <LiveMeter
              status={capture.live}
              native={companion.native}
              busy={capture.busy || companion.loading}
              error={capture.error}
              onReset={() => void capture.reset()}
              onReplay={(id) =>
                void companion.load(id === undefined ? { kind: 'live' } : { kind: 'live', id })
              }
              onConfigure={(autoEnd, partyOnly) => void capture.configure(autoEnd, partyOnly)}
              onComparison={() => void capture.saveComparison()}
              comparisonPath={capture.comparisonPath}
            />
            <LiveAnalysis
              status={offline.status}
              error={offline.error}
              native={companion.native}
              active={tab === 'live'}
              onCopySummary={copySummary(null)}
            />
          </TabPanel>
          <TabPanel value="logs">
            <LogLibrary
              library={library}
              settings={settings}
              native={companion.native}
              libraryCount={offline.status?.library_count ?? null}
              onCopySummary={copySummary}
              onCompare={(ids) => {
                setCompareIds(ids);
                setTab('compare');
              }}
            />
          </TabPanel>
          <TabPanel value="compare">
            <ComparePanel
              key={compareIds.join('|')}
              loadLog={loadLog}
              live={offline.status?.report ?? null}
              logs={library.logs}
              settings={settings}
              native={companion.native}
              initial={compareIds}
            />
          </TabPanel>
          <TabPanel value="trackers">
            <TrackersPanel
              status={offline.status}
              draft={draft}
              native={companion.native}
              onOpenAlerts={() => setTab('alerts')}
              surface={{
                known: dps.known,
                requested: dps.overlay.trackers_requested ?? false,
                held: dps.overlay.focus_suppressed ?? false,
                editing: dps.overlay.trackers_editing ?? false,
                busy: dps.busy,
                onToggle: () => void dps.toggleTrackers(),
                onArrange: (editing) => void dps.arrangeTrackers(editing),
              }}
            />
          </TabPanel>
          <TabPanel value="alerts">
            <AlertsPanel
              alerts={alerts}
              active={tab === 'alerts'}
              development={companion.native && buildInfo?.channel === 'development'}
            />
          </TabPanel>
          <TabPanel value="pets" keepMounted>
            <PetsTab native={companion.native} active={tab === 'pets'} />
          </TabPanel>
          <TabPanel value="explore">
            <ExploreTab
              native={companion.native}
              prefs={explorePrefs}
              overlay={activityToggle(exploreWindow)}
              focus={exploreFocus}
            />
          </TabPanel>
          <TabPanel value="settings">
            <SettingsPanel
              status={offline.status}
              draft={draft}
              native={companion.native}
              busy={offline.busy}
              onAction={offline.action}
              onImportCatalogue={importCatalogue}
              onCopySummary={copySummary(null)}
            />
            <SetupPanel
              native={companion.native}
              setup={setup}
              distribution={distribution}
              className="mt-4"
            />
            <BackupsPanel
              native={companion.native}
              backups={backups}
              restartBlocked={draft.dirty || draft.saving}
              className="mt-4"
            />
            <UpdatesPanel
              native={companion.native}
              updates={updates}
              restartBlocked={draft.dirty || draft.saving}
              distribution={distribution ?? 'private'}
              onOpenLink={setup.open}
              access={privateUpdates ? updateAccess : undefined}
            />
            <DiagnosticsPanel
              native={companion.native}
              report={diagnostics}
              className="mt-4 mb-16"
            />
          </TabPanel>
          <TabPanel value="replay" keepMounted>
            <Section
              title={t(($) => $.replay.title)}
              className="mb-16"
              actions={
                <RecordingToolbar
                  disabled={disabled}
                  canSave={recording !== null}
                  onDemo={() => void companion.load({ kind: 'demo' })}
                  onImport={(file) => void companion.importFile(file)}
                  onSave={() => void companion.save()}
                />
              }
            >
              <output
                className="mb-4 block min-h-5 text-left text-sm text-ink-2"
                aria-label={t(($) => $.replay.status)}
              >
                {companion.status}
              </output>
              <ReplayControls
                source={recording?.source ?? t(($) => $.replay.none)}
                durationMs={recording?.duration_ms ?? 0}
                atMs={companion.atMs}
                snapshotMs={snapshot.at_ms}
                disabled={disabled || !recording}
                playing={companion.playing}
                onToggle={companion.togglePlayback}
                onSeek={companion.scrub}
              />
              <div className="grid items-start gap-4 min-[860px]:grid-cols-2">
                <DamageSummary players={snapshot.players} />
                <PositionReplay recording={recording} positions={snapshot.positions} />
              </div>
              <ReplayProgress
                counters={snapshot.counters}
                pets={snapshot.pets}
                gaps={snapshot.gaps}
              />
            </Section>
          </TabPanel>
        </main>
      </Tabs>
      <SaveBar
        draft={draft}
        error={tab === 'settings' || tab === 'trackers' ? offline.error : ''}
      />
      <AppFooter />
    </>
  );
}
