import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import type { OverlayStatus } from '../types/companion';
import type { OfflineSettings } from '../types/offline';
import * as alerts from './mockAlerts';
import { backupCommands } from './mockBackups';
import * as combat from './mockCombat';
import * as pets from './mockPets';
import { ACCESS_STABLE, accessCommands, accessLinkOpened, accessReady } from './mockUpdateAccess';
import { timersStatus } from './mockTimers';
import { clearCubes, cubesStatus } from './mockCubes';
import { mapArtCommands, mockMapArtSrc } from './mockMapArt';
import {
  finderPreferences,
  followFinderPreferences,
  updateFinderPreferences,
} from './mockFinderPreferences';
import {
  ACTIVITY_NATIVE_LABELS,
  INITIAL_ACTIVITY_WINDOW,
  type ActivityWindowKind,
  type ActivityWindowStatus,
} from '../types/activityWindows';
import { ACCESS, FAILING, FRESH, LONG, NPCAP, PORTABLE, UPDATE } from './mockScenario';

/*
 * DEV ONLY visual-testing harness. `main.tsx` installs it before React renders when the
 * page URL has a `mock` query parameter (e.g. `/?mock` or `/?view=overlay&mock`) in a
 * Vite dev build; production builds never include it.
 *
 * It fakes just enough of the Tauri runtime (`isTauri`, `__TAURI_INTERNALS__`, the event
 * and window plugins) for `@tauri-apps/api` to work in a plain browser, and answers this
 * app's native commands with representative in-memory data. Mutating commands succeed
 * and update that state so toggles visibly flip; nothing is persisted.
 */

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

/* ---------- Offline settings, trackers and status ---------- */

let settings: OfflineSettings = {
  ...SETTINGS_FALLBACK,
  boss_alerts: true,
  presets: [
    {
      id: 'preset-ranger',
      name: 'Ranger burst',
      class: 'Ranger',
      keybind: 'Ctrl+Shift+1',
      bars: [
        {
          id: 'bar-burst',
          name: 'Burst',
          mode: 'cooldowns',
          skills: [14010000, 14020000, 14080000, 14100000, 14060000],
          x: 760,
          y: 520,
          icon_size: 40,
          appearance: 'icons',
          hidden: false,
        },
        {
          id: 'bar-party',
          name: 'Party buffs',
          mode: 'buffs',
          skills: [12110000, 17090000],
          x: 760,
          y: 584,
          icon_size: 32,
          appearance: 'bars',
          hidden: false,
        },
      ],
    },
    {
      id: 'preset-templar',
      name: 'Templar defensives',
      class: 'Templar',
      keybind: 'Ctrl+Shift+2',
      bars: [
        {
          id: 'bar-defensive',
          name: 'Defensives',
          mode: 'both',
          skills: [12070000, 12110000, 12120000],
          x: 640,
          y: 460,
          icon_size: 44,
          appearance: 'icons',
          hidden: false,
        },
      ],
    },
  ],
  active_preset: 'preset-ranger',
};

const SKILL_NAMES: Record<number, string> = {
  14010000: 'Deadshot',
  14020000: 'Snipe',
  14080000: 'Burst Arrow',
  14100000: 'Tempest Arrow',
  14060000: 'Griffon Arrow',
  12110000: 'Shield of Protection',
  17090000: 'Light of Regeneration',
  12070000: 'Doom Shield',
  12120000: 'Taunt',
};

/** Running timers cycle with the wall clock so bars visibly count down. */
function trackers() {
  const now = Date.now();
  const preset = settings.presets.find((p) => p.id === settings.active_preset);
  return (preset?.bars ?? []).flatMap((bar) =>
    bar.skills.map((skill, i) => {
      const buff = bar.mode === 'buffs' || (bar.mode === 'both' && i % 2 === 1);
      const period = (buff ? 18_000 : 12_000) + i * 7_000;
      const left = period - ((now + i * 3_100) % period) - (buff ? 0 : 2_500);
      return {
        bar_id: bar.id,
        skill,
        name: SKILL_NAMES[skill] ?? null,
        remaining_ms: Math.max(0, left),
        kind: buff ? 'buff' : 'cooldown',
        source: 1,
        target: buff ? 1 : 9001,
        estimated: i % 3 === 2,
        basis: i % 3 === 2 ? 'observed wall-clock calibration' : 'cooldown packet',
      };
    }),
  );
}

/** `offline_status`, or with `summary` the compact `offline_live_status`. */
const offlineStatus = (summary = false) => ({
  settings,
  report: FRESH ? null : summary ? combat.liveReportSummary() : combat.liveReport(),
  library_count: combat.libraryCount(),
  trackers: trackers(),
  alerts: [],
  catalogue: { skills: 16_899, npcs: 12_589 },
  capabilities: {
    damage: true,
    healing: true,
    casts: true,
    buffs: true,
    hp: true,
    deaths: true,
    hit_flags: true,
    positions: false,
    note: 'Mock data: no game traffic is read.',
  },
  error: null,
});

/* ---------- Windows ---------- */

// The busy fixtures are in a raid room; a fresh run has not entered one yet.
const groupInRoom = !FRESH;
const overlay: OverlayStatus = {
  requested_visible: true,
  group_enabled: true,
  group_requested: true,
  menu_requested: true,
  game_focused: true,
  focus_suppressed: false,
  locked: false,
  ready: true,
  visible: true,
  can_lock: true,
  saved_path: '',
  errors: [],
  menu_ready: true,
  menu_visible: true,
  group_ready: true,
  group_visible: true,
  tray_ready: true,
  tray_registered: true,
  trackers_requested: true,
  trackers_editing: false,
  trackers_ready: true,
  trackers_visible: true,
  details_requested: true,
  details_ready: true,
  details_visible: true,
  details_selection: { revision: 1, report_id: combat.LIVE_ID, player: '1' },
  row_regions: 0,
};
const setOverlay = (patch: Partial<OverlayStatus>) => Object.assign(overlay, patch);
// Every lockable window starts unlocked and keeps the user's lock across hide and show.
// The busy evening has already pressed Done on the tracker layer; a fresh run has not.
let trackersDone = !FRESH;
const activityWindows: Record<ActivityWindowKind, ActivityWindowStatus> = {
  timers: {
    ...INITIAL_ACTIVITY_WINDOW,
    requested: !FRESH,
    visible: !FRESH && !LONG,
    ready: true,
    game_active: !FRESH && !LONG,
    errors: [],
  },
  explore: {
    ...INITIAL_ACTIVITY_WINDOW,
    requested: !FRESH,
    visible: !FRESH && !LONG,
    ready: true,
    game_active: !FRESH && !LONG,
    errors: [],
  },
};
/** Earlier names of the Explore window, which native still accepts. */
const EXPLORE_ALIASES: readonly unknown[] = ['maps', 'finder', 'cubes', 'gathering'];
const activityWindow = (kind: unknown) => {
  if (EXPLORE_ALIASES.includes(kind)) return activityWindows.explore;
  if (kind !== 'timers' && kind !== 'explore') throw new Error('Unknown activity window');
  return activityWindows[kind];
};
// A first run: no in-game window has been shown yet.
if (FRESH)
  setOverlay({
    requested_visible: false,
    visible: false,
    group_enabled: false,
    group_requested: false,
    group_visible: false,
    trackers_requested: false,
    trackers_visible: false,
    details_requested: false,
    details_visible: false,
    details_selection: null,
  });
// Long strings (`?mock=long`): every window is asked for, but AION is not focused, so the
// native side holds them all back, and one hotkey could not be registered.
if (LONG)
  setOverlay({
    game_focused: false,
    focus_suppressed: true,
    visible: false,
    menu_visible: false,
    group_visible: false,
    trackers_visible: false,
    details_visible: false,
    can_lock: false,
    errors: ['Ctrl+Shift+F8 could not be registered: another program already uses this hotkey'],
  });

/* ---------- Setup ---------- */

const npcapProblems = {
  missing:
    'Npcap could not load: The specified module could not be found. (os error 126). Install Npcap from npcap.com.',
  unavailable:
    'Npcap could not open a supported adapter. Check the Npcap service and driver permissions.',
  unsupported: 'Independent live capture currently requires Windows and Npcap.',
} as const;
type NpcapProblem = keyof typeof npcapProblems;
let npcap: NpcapProblem | null =
  NPCAP && Object.hasOwn(npcapProblems, NPCAP) ? (NPCAP as NpcapProblem) : null;
// `npcap-missing`: opening the Npcap page "installs" it, so Check again finds it ready.
let npcapInstalled = false;
const setupStatus = async () => {
  // Probing the driver and an adapter takes a moment natively.
  await new Promise((done) => setTimeout(done, 400));
  if (npcapInstalled) npcap = null;
  return {
    platform_supported: npcap !== 'unsupported',
    webview2_ready: true,
    npcap: { state: npcap ?? 'ready', detail: npcap ? npcapProblems[npcap] : null },
    installed: !PORTABLE && ACCESS_STABLE,
    distribution: 'private',
  };
};
/** Live status while the driver cannot capture: the native retry error, nothing observed. */
const captureBlocked = () => ({
  running: true,
  phase: 'error',
  message: npcap ? npcapProblems[npcap] : '',
  duration_ms: 0,
  events: 0,
  players: [],
  stats: {},
});

/* ---------- Updates ---------- */

const stable = ACCESS_STABLE;
// `?mock=access-…`: private releases cannot be read until the GitHub access path is done.
const guided = !!ACCESS && UPDATE === null && !PORTABLE;
const noAccess =
  'GitHub CLI could not read the private releases. Follow GitHub access below, then check again.';

const PULL = 'https://github.com/nicholascostadev/aion-companion-public/pull';
/*
 * Fake GitHub-generated notes. `?mock=update` lists every kind of change, a breaking one,
 * extra Markdown and an entry that is not a Conventional Commit; `?mock=update-ready` is the
 * single-entry shape of a small patch release.
 */
const UPDATE_NOTES =
  UPDATE === 'ready'
    ? `## What's Changed
* style(ui): nest border radii concentrically by @nicholascostadev in ${PULL}/30

**Full Changelog**: https://github.com/nicholascostadev/aion-companion-public/compare/v0.6.5...v0.7.0`
    : `## Highlights
Pet farming goals now follow you into **every** window, and alert sounds can rest during _quiet hours_.

## What's Changed
* feat(pets): follow farming goals across every window by @nicholascostadev in ${PULL}/41
* feat(alerts,settings): add quiet hours for alert sounds by @nicholascostadev in ${PULL}/43
* fix(meter): keep the \`Total\` row pinned while sorting by @nicholascostadev in ${PULL}/44
* fix(group): show readiness for members who join mid-fight by @nicholascostadev in ${PULL}/45
* perf(logs): search the log library without reading every file by @nicholascostadev in ${PULL}/46
* feat(recordings)!: store recordings in the new compact format by @nicholascostadev in ${PULL}/47
  * Recordings saved by v0.6 are converted the first time they are opened.
* refactor(capture): split packet decoding from persistence by @nicholascostadev in ${PULL}/48
* docs: explain backup restore and rollback by @nicholascostadev in ${PULL}/49
* chore(deps): update tauri to 2.12 by @dependabot[bot] in ${PULL}/50
* Tidy the release workflow by @nicholascostadev in ${PULL}/51

## New Contributors
* @dependabot[bot] made their first contribution in ${PULL}/50

**Full Changelog**: https://github.com/nicholascostadev/aion-companion-public/compare/v0.6.5...v0.7.0`;

const updates = {
  channel: stable ? 'stable' : 'development',
  current_version: '0.6.5',
  latest_version: stable && !guided ? '0.7.0' : null,
  phase: UPDATE ?? (PORTABLE ? 'available' : guided ? 'error' : 'development'),
  error: guided ? noAccess : (null as string | null),
  checked_ms: Date.now() - 8 * 60_000,
  release_url: 'https://github.com/nicholascostadev/aion-companion-public/releases/tag/v0.7.0',
  notes: UPDATE_NOTES,
  restart_supported: (UPDATE !== null || guided) && !PORTABLE,
  repository: 'nicholascostadev/aion-companion-public',
  // Stable builds learn from the releases themselves whether they are public or private.
  ...(stable ? { distribution: 'private' } : {}),
};
let downloadedAt = 0;
function updateStatus() {
  if (updates.phase === 'downloading' && Date.now() >= downloadedAt) updates.phase = 'ready';
  return updates;
}

/* ---------- Command router ---------- */

const ok = () => null;
const path = (name: string) => `C:/Users/Player/AppData/Local/AionCompanion/${name}`;

const commands: Record<string, Handler> = {
  app_build_info: () => ({
    channel: stable ? 'stable' : 'development',
    version: '0.7.0',
    branch: 'browser-preview',
    revision: '',
    live_reload: true,
  }),
  // Bug reports
  diagnostics_record: ok,
  diagnostics_export: async ({ frontend }) => {
    await new Promise((done) => setTimeout(done, 700));
    if (FAILING) throw new Error('Diagnostics log is unavailable (mock)');
    return JSON.stringify(
      {
        kind: 'aion-companion-diagnostics',
        schema_version: 1,
        exported_at_ms: Date.now(),
        frontend,
      },
      null,
      2,
    );
  },
  // Recordings and replay
  demo: () => combat.openRecording(combat.demoRecording()),
  import_recording: ({ json }) => combat.openRecording(JSON.parse(String(json))),
  load_live_recording: ({ id }) =>
    combat.openRecording(
      combat.demoRecording(`Live encounter #${typeof id === 'number' ? id : 12}`),
    ),
  snapshot: ({ atMs }) => combat.snapshot(typeof atMs === 'number' ? atMs : 0),
  save_recording: () => path('recordings/mock-recording.json'),

  // Live capture
  live_status: () => (npcap ? captureBlocked() : combat.liveStatus()),
  live_reset: () => combat.resetLive(),
  live_configure: (args) => combat.configureLive(args),
  save_live_comparison: () => path('comparisons/live-comparison.json'),

  // Windows
  overlay_status: () => overlay,
  overlay_ready: ok,
  menu_ready: ok,
  group_ready: ok,
  group_fit: ok,
  trackers_ready: ok,
  details_ready: ok,
  overlay_show: () => setOverlay({ requested_visible: true, visible: !overlay.focus_suppressed }),
  overlay_hide: () => void setOverlay({ requested_visible: false, visible: false }),
  overlay_lock: ({ locked }) => setOverlay({ locked: locked === true }),
  overlay_workspace: ok,
  overlay_take_keyboard: () => true,
  overlay_quit: ok,
  overlay_hit_regions: ({ regions }) => {
    overlay.row_regions = Array.isArray(regions) ? regions.length : 0;
    return overlay.row_regions;
  },
  group_status: () => combat.groupStatus(),
  group_show: () =>
    setOverlay({
      group_enabled: true,
      group_requested: groupInRoom,
      group_visible: groupInRoom && !overlay.focus_suppressed,
    }),
  group_hide: () =>
    void setOverlay({ group_enabled: false, group_requested: false, group_visible: false }),
  // Arranging is the tracker surface's unlocked state: shown, it arranges until Done.
  trackers_show: () =>
    setOverlay({
      trackers_requested: true,
      trackers_visible: !overlay.focus_suppressed,
      trackers_editing: overlay.trackers_editing === true || !trackersDone,
    }),
  // Hiding ends arranging for now but keeps the choice.
  trackers_hide: () =>
    setOverlay({
      trackers_requested: false,
      trackers_visible: false,
      trackers_editing: false,
    }),
  trackers_arrange: ({ editing }) => {
    trackersDone = editing !== true;
    return setOverlay({ trackers_editing: editing === true });
  },
  details_open: ({ reportId, player }) =>
    setOverlay({
      details_requested: true,
      details_visible: true,
      details_selection: {
        revision: (overlay.details_selection?.revision ?? 0) + 1,
        report_id: typeof reportId === 'string' ? reportId : null,
        player: String(player),
      },
    }),
  details_hide: () => void setOverlay({ details_requested: false, details_visible: false }),

  // Offline reports, library and settings
  offline_status: () => offlineStatus(),
  offline_live_status: () => offlineStatus(true),
  offline_configure: ({ settings: next }) => {
    settings = next as OfflineSettings;
    // Native invalidates every window's language after a committed save.
    emit('ui-preferences-changed', null);
    return settings;
  },
  ui_preferences: () => ({ locale: settings.locale }),
  offline_logs: ({ query }) => combat.listLogs((query ?? {}) as Args),
  offline_log: ({ id }) => combat.readLog(id),
  offline_inspect: ({ id }) => combat.readLog(id),
  offline_log_rename: ({ id, label }) => combat.renameLog(id, label),
  offline_log_delete: ({ ids }) => combat.deleteLogs(ids),
  offline_export: ({ id }) => path(`exports/${String(id)}.json`),
  offline_catalogue_import: () => ({ skills: 16_899, npcs: 12_589 }),
  offline_copy_text: ({ text }) =>
    navigator.clipboard?.writeText(String(text)).then(ok, ok) ?? null,
  offline_summary: ({ id, multiline }) => combat.summary(id ?? null, multiline === true),
  offline_action: ({ summary }) => offlineStatus(summary === true),
  offline_positions: ({ presetId, positions }) => {
    const moved = new Map(
      (Array.isArray(positions) ? positions : []).map(
        (p: { bar_id: string; x: number; y: number }) => [p.bar_id, p],
      ),
    );
    settings = {
      ...settings,
      presets: settings.presets.map((preset) =>
        preset.id !== presetId
          ? preset
          : {
              ...preset,
              bars: preset.bars.map((bar) => {
                const to = moved.get(bar.id);
                return to ? { ...bar, x: to.x, y: to.y } : bar;
              }),
            },
      ),
    };
    return settings;
  },

  // Alerts
  alerts_status: () => alerts.dashboard(),
  alerts_configure: ({ config }) => alerts.configure(config),
  alerts_action: (args) => alerts.action(args),
  alerts_test: ok,
  alerts_popup_ready: () => alerts.popupDeliveries(),
  alerts_popup_dismiss: ok,

  // Pets
  timers_status: timersStatus,
  cubes_status: cubesStatus,
  cubes_clear: clearCubes,
  finder_preferences: finderPreferences,
  finder_preferences_update: ({ patch }) => updateFinderPreferences(patch, emit),
  activity_window_status: ({ kind }) => activityWindow(kind),
  activity_window_ready: ({ kind }) => {
    activityWindow(kind).ready = true;
  },
  activity_window_show: ({ kind }) =>
    Object.assign(activityWindow(kind), {
      requested: true,
      visible: !FRESH && !overlay.focus_suppressed,
    }),
  activity_window_hide: ({ kind }) =>
    Object.assign(activityWindow(kind), { requested: false, visible: false }),
  activity_window_lock: ({ kind, locked }) =>
    Object.assign(activityWindow(kind), { locked: locked === true }),
  activity_window_hit_regions: ({ kind, regions }) => {
    activityWindow(kind);
    return Array.isArray(regions) ? regions.length : 0;
  },

  // Pet radar
  pets_catalogue: () => pets.catalogue(),
  pets_status: ({ profileId }) => pets.status(profileId),
  pets_motion: ({ profileId }) => pets.status(profileId),
  pets_configure: ({ config }) => pets.configure(config),
  pets_overlay_status: () => pets.windowStatus(),
  pets_overlay_ready: ok,
  pets_overlay_show: () => pets.setWindow({ requested: true, visible: !overlay.focus_suppressed }),
  pets_overlay_hide: () => pets.setWindow({ requested: false, visible: false }),
  pets_overlay_lock: ({ locked }) => pets.setWindow({ locked: locked === true }),
  pets_overlay_hit_regions: ({ regions }) => (Array.isArray(regions) ? regions.length : 0),

  // Map art downloads
  ...mapArtCommands,

  // Backup and restore
  ...backupCommands,

  // Setup
  setup_status: setupStatus,
  setup_open_link: ({ link }) => {
    if (FAILING) throw new Error('No browser is registered to open links (mock)');
    if (link === 'npcap' && npcap === 'missing') npcapInstalled = true;
    accessLinkOpened(link);
    console.info(`[mock] Would open the official "${String(link)}" page in the browser.`);
    return null;
  },

  // Updates
  ...accessCommands,
  updates_status: updateStatus,
  updates_check: () => {
    updates.checked_ms = Date.now();
    if (guided && updates.phase !== 'ready' && updates.phase !== 'downloading') {
      const readable = accessReady();
      updates.phase = readable ? 'available' : 'error';
      updates.latest_version = readable ? '0.7.0' : null;
      updates.error = readable ? null : noAccess;
    }
    return updateStatus();
  },
  updates_download: () => {
    if (!updates.restart_supported) throw new Error('This copy cannot update itself (mock)');
    updates.phase = 'downloading';
    downloadedAt = Date.now() + 3_000;
    return updateStatus();
  },
  updates_install: () => {
    updates.phase = 'restarting';
    return updateStatus();
  },
};

/* ---------- Tauri runtime ---------- */

type Callback = (payload: unknown) => void;
const callbacks = new Map<number, Callback>();
/** Event name → handler callback ids, for events emitted inside this page. */
const listeners = new Map<string, Set<number>>();
let nextId = 1;
const warned = new Set<string>();

/** Delivers an event to this page's listeners, as native would. */
function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? [])
    setTimeout(() => callbacks.get(id)?.({ event, id, payload }), 0);
}

function plugin(cmd: string, args: Args): unknown {
  const [name, action = ''] = cmd.slice('plugin:'.length).split('|');
  if (name === 'event') {
    if (action === 'listen') {
      const event = String(args.event);
      const handler = Number(args.handler);
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(handler);
      return handler;
    }
    if (action === 'emit' || action === 'emit_to') emit(String(args.event), args.payload);
    return null;
  }
  if (name === 'window' || name === 'webview') {
    if (action === 'scale_factor') return 1;
    if (action.endsWith('_size')) return { width: window.innerWidth, height: window.innerHeight };
    if (action.endsWith('_position')) return { x: 0, y: 0 };
    if (['is_visible', 'is_focused', 'is_enabled', 'is_resizable'].includes(action)) return true;
    if (action.startsWith('is_')) return false;
    if (action === 'title') return 'AION Companion';
    if (action === 'theme') return 'dark';
    return null;
  }
  return unknown(cmd);
}

function unknown(cmd: string) {
  if (!warned.has(cmd)) {
    warned.add(cmd);
    console.warn(`[mock] Unhandled native command "${cmd}"; resolving null.`);
  }
  return null;
}

async function invoke(cmd: string, args: Args = {}): Promise<unknown> {
  const handler = commands[cmd];
  const value = cmd.startsWith('plugin:')
    ? plugin(cmd, args)
    : handler
      ? handler(args)
      : unknown(cmd);
  const result = await value;
  // Callers get a copy, like a real IPC round trip.
  return result === undefined ? null : structuredClone(result);
}

export function install() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  // `&locale=pt-BR` previews a window as if that language were saved.
  const locale = params.get('locale');
  if (locale) settings = { ...settings, locale: locale as OfflineSettings['locale'] };
  const label =
    view === 'timers'
      ? ACTIVITY_NATIVE_LABELS.timers
      : view === 'explore' || EXPLORE_ALIASES.includes(view)
        ? ACTIVITY_NATIVE_LABELS.explore
        : 'main';
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      metadata: {
        currentWindow: { label },
        currentWebview: { windowLabel: label, label },
      },
      invoke,
      transformCallback(callback?: Callback, once = false) {
        const id = nextId++;
        callbacks.set(id, (payload) => {
          if (once) callbacks.delete(id);
          callback?.(payload);
        });
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      convertFileSrc(filePath: string, protocol = 'asset') {
        if (protocol === 'map-art') return mockMapArtSrc(filePath);
        return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener(event: string, id: number) {
        listeners.get(event)?.delete(id);
      },
    },
  });
  (globalThis as { isTauri?: boolean }).isTauri = true;
  followFinderPreferences(emit);
  // Native pushes popup deliveries while they are open; cards expire on screen otherwise.
  setInterval(() => emit('alerts-popup', alerts.popupDeliveries()), 5_000);
  console.info('[mock] Fake native runtime installed: every window shows mock data.');
}
