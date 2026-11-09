import { describe, expect, it } from 'vitest';
import { formattersFor } from '../../i18n/formatters';
import { createTestI18n } from '../../i18n/testing';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { GroupRun, LiveStatus, OverlayStatus } from '../../types/companion';
import type { CombatReport, OfflineSettings } from '../../types/offline';
import type { GroupStatusData } from '../group/model';
import type { DeathShortcut } from './lastDeath';
import { aria, bryn, meterReport } from './meterFixtures';
import {
  meterShows,
  meterStart,
  meterStep,
  type MeterAction,
  type MeterInput,
  type MeterShown,
  type MeterState,
} from './meterState';

const i18n = createTestI18n('en');
const words = {
  t: i18n.getFixedT('en', 'live'),
  tc: i18n.getFixedT('en', 'common'),
  fmt: formattersFor('en'),
};

const capturing: LiveStatus = {
  running: true,
  phase: 'capturing',
  message: '',
  duration_ms: 10_000,
  events: 6,
  stats: {},
  players: [],
};
const overlay: OverlayStatus = {
  locked: true,
  ready: true,
  visible: true,
  can_lock: true,
  saved_path: '',
  errors: [],
};

interface Patch extends Partial<Omit<MeterInput, 'offline' | 'group'>> {
  /** The live report; a fight with Aria alone on a training golem unless given. */
  report?: CombatReport | null;
  settings?: Partial<OfflineSettings>;
  /** Native's group status; absent, the meter is given none. */
  room?: GroupStatusData | null;
}

/** What native reports: a capturing meter on the live fight, changed by `patch`. */
function input({ report, settings, room, ...patch }: Patch = {}): MeterInput {
  return {
    status: capturing,
    overlay,
    error: '',
    busy: false,
    offline: {
      settings: { ...SETTINGS_FALLBACK, ...settings },
      report: report === undefined ? meterReport() : report,
      library_count: 0,
      trackers: [],
      alerts: [],
      catalogue: null,
      capabilities: {},
      error: null,
    },
    ...(room === undefined ? {} : { group: { status: room, native: true } }),
    saved: { report: null, loading: false, error: '' },
    death: null,
    now: 0,
    ...patch,
  };
}

/**
 * Runs the meter through `steps`, native inputs and the reader's actions in order (an
 * action acts on the last input), and says what it shows after the last one.
 */
function run(...steps: (MeterInput | MeterAction)[]): MeterShown & { state: MeterState } {
  let state: MeterState | null = null;
  let last: MeterInput | null = null;
  for (const step of steps) {
    if ('type' in step) state = meterStep(state!, last!, step);
    else {
      state = state ? meterStep(state, step) : meterStart(step);
      last = step;
    }
  }
  return { ...meterShows(state!, last!, words), state: state! };
}

const view = (to: 'group' | 'dps'): MeterAction => ({ type: 'view', view: to });
const pin = (id: string | null): MeterAction => ({ type: 'pin', id });
const focus = (id: string | null): MeterAction => ({
  type: 'focus',
  focus: id === null ? { kind: 'ranking' } : { kind: 'player', id },
});
const history = (open: boolean): MeterAction => ({ type: 'history', open });

const outside: GroupRun = { phase: 'outside', dungeon_id: null, run_id: null, zone_id: 1110 };
const unknownRun: GroupRun = { phase: 'unknown', dungeon_id: null, run_id: null, zone_id: null };
const running = (run_id = 'run-1'): GroupRun => ({
  phase: 'running',
  dungeon_id: 600092,
  run_id,
  zone_id: 600092,
});
/**
 * A party room as native reports it. `preparing` follows native's rule (a dungeon group with
 * no run observed to start); the meter only reads it.
 */
function room(run: GroupRun, patch: Partial<GroupStatusData> = {}): GroupStatusData {
  const inRoom = patch.room ?? true;
  const dungeon = patch.dungeon_id === undefined ? 600092 : patch.dungeon_id;
  return {
    capture_id: 1,
    running: true,
    phase: 'capturing',
    message: '',
    roster_seen: true,
    roster_age_ms: 1000,
    lobby_name: 'Deus Research Base',
    capacity: 5,
    party_id: 41,
    members: [{ name: 'Aria', server_id: 1001, class: 'Gladiator', level: 45, leader: true }],
    inspections: [],
    room: inRoom,
    dungeon_id: dungeon,
    run,
    preparing: inRoom && dungeon !== null && (run.phase === 'outside' || run.phase === 'unknown'),
    ...patch,
  };
}
const preparing = (patch: Partial<GroupStatusData> = {}, extra: Patch = {}) =>
  input({ room: room(outside, patch), ...extra });
const inRun = (run_id = 'run-1', extra: Patch = {}) =>
  input({ room: room(running(run_id)), ...extra });
const { run: _run, preparing: _preparing, room: _room, ...olderNative } = room(outside);
const strip = { compact_strip: true };

/** A saved fight as the library returns it. */
const savedFight = (patch: Record<string, unknown> = {}) => ({
  saved: {
    report: meterReport({ id: 'fight-old', end_reason: 'idle', players: [aria, bryn], ...patch }),
    loading: false,
    error: '',
  },
});
const golem = { id: 50, name: 'Training Golem', boss: false, dummy: false, damage: 74_600 };
const boss = (name: string, damage: number, id = 60) => ({
  id,
  name,
  boss: true,
  dummy: false,
  damage,
});

describe('which sheet the meter draws', () => {
  it.each<[string, (MeterInput | MeterAction)[], MeterShown['sheet'], boolean]>([
    ['the fight, without any group status', [input()], 'fight', false],
    [
      'the fight outside a party room',
      [input({ room: room(outside, { room: false }) })],
      'fight',
      false,
    ],
    ['the room of a dungeon group before its run', [preparing()], 'room', true],
    [
      'the room when the run state is unknown, as when the app started after joining',
      [input({ room: room(unknownRun) })],
      'room',
      true,
    ],
    [
      'the room, whatever damage the lobby already counted',
      [preparing({}, { status: { ...capturing, events: 40 } })],
      'room',
      true,
    ],
    [
      'the fight for a party formed for no dungeon',
      [preparing({ dungeon_id: null })],
      'fight',
      false,
    ],
    [
      'the fight without native run state, as with an older native',
      [input({ room: olderNative })],
      'fight',
      false,
    ],
    ['the fight once native observes the run start', [preparing(), inRun()], 'fight', false],
    [
      'the fight through a reset during the run',
      [preparing(), inRun(), inRun('run-1', { report: null })],
      'fight',
      false,
    ],
    [
      'the fight after the clear, until the dungeon is left',
      [preparing(), inRun(), input({ room: room({ ...running(), phase: 'cleared' }) })],
      'fight',
      false,
    ],
    [
      'the room again when the group prepares for its next run',
      [preparing(), inRun(), preparing()],
      'room',
      true,
    ],
    ['the compact strip on the fight', [input({ settings: strip })], 'strip', false],
    [
      'the room, not the strip, while a group prepares',
      [preparing({}, { settings: strip })],
      'room',
      true,
    ],
    [
      'the full meter, not the strip, on DPS while a group prepares',
      [preparing({}, { settings: strip }), view('dps')],
      'fight',
      true,
    ],
    [
      'the strip again once the run starts',
      [preparing({}, { settings: strip }), view('dps'), inRun('run-1', { settings: strip })],
      'strip',
      false,
    ],
  ])('%s', (_, steps, sheet, prepares) => {
    const shown = run(...steps);
    expect(shown.sheet).toBe(sheet);
    expect(shown.preparing).toBe(prepares);
  });
});

describe("the reader's Group or DPS choice", () => {
  it.each<[string, (MeterInput | MeterAction)[], MeterShown['sheet']]>([
    ['DPS shows the live fight while the group prepares', [preparing(), view('dps')], 'fight'],
    ['Group shows the room again', [preparing(), view('dps'), view('group')], 'room'],
    [
      'DPS holds through roster, readiness, title and damage polls of the same group',
      [
        preparing(),
        view('dps'),
        preparing(
          { roster_age_ms: 4000, lobby_name: 'Deus Research Base · fast run', capacity: 6 },
          { status: { ...capturing, events: 80 }, report: meterReport({ duration_ms: 90_000 }) },
        ),
        input({ room: room(unknownRun) }),
      ],
      'fight',
    ],
    [
      'joining another group chooses its room',
      [preparing(), view('dps'), preparing({ party_id: 77 })],
      'room',
    ],
    [
      'the same group forming for another dungeon chooses its room',
      [preparing({ party_id: 77 }), view('dps'), preparing({ party_id: 77, dungeon_id: 600120 })],
      'room',
    ],
    [
      'the next preparation opens on the room after DPS',
      [preparing(), view('dps'), inRun(), preparing()],
      'room',
    ],
    ['leaving shows the fight', [preparing(), view('dps'), preparing({ room: false })], 'fight'],
    [
      'rejoining the same group chooses its room',
      [preparing(), view('dps'), preparing({ room: false }), preparing()],
      'room',
    ],
    ['losing group status shows the fight', [preparing(), input({ room: null })], 'fight'],
  ])('%s', (_, steps, sheet) => {
    expect(run(...steps).sheet).toBe(sheet);
  });
});

describe('a saved fight', () => {
  it('drives the meter while pinned: its report, focus key and details, with no live lines', () => {
    const shown = run(input(), pin('fight-old'), input(savedFight()));
    expect(shown.pinned).toBe('fight-old');
    expect(shown.fight).toBe('saved:fight-old');
    expect(shown.report?.id).toBe('fight-old');
    expect(shown.model?.players.map((p) => p.name)).toEqual(['Aria', 'Bryn']);
    expect(shown.detailsId).toBe('fight-old');
    expect([shown.live, shown.canReset, shown.boss, shown.dummy, shown.context]).toEqual([
      false,
      false,
      null,
      null,
      '',
    ]);
    expect([shown.stateLabel, shown.durationTitle]).toEqual([
      'Saved fight',
      'Saved fight duration',
    ]);
    // Back to live.
    const back = run(input(), pin('fight-old'), input(savedFight()), pin(null));
    expect([back.pinned, back.fight, back.live, back.canReset]).toEqual([
      null,
      'live:fight-a',
      true,
      true,
    ]);
  });

  it.each<[string, (MeterInput | MeterAction)[], string | null]>([
    [
      'stays pinned on the live meter',
      [input(), pin('fight-old'), input(savedFight())],
      'fight-old',
    ],
    [
      'stays pinned through polls of the same preparing group',
      [preparing(), view('dps'), pin('fight-old'), preparing({ capacity: 6 }, savedFight())],
      'fight-old',
    ],
    [
      'stays pinned while the reader looks at the room and back',
      [
        preparing(),
        view('dps'),
        pin('fight-old'),
        preparing({}, savedFight()),
        view('group'),
        view('dps'),
      ],
      'fight-old',
    ],
    [
      'stays pinned through polls of the same run',
      [inRun(), pin('fight-old'), inRun('run-1', savedFight())],
      'fight-old',
    ],
    [
      'never outlasts the group preparing for its next run',
      [inRun(), pin('fight-old'), preparing({}, savedFight())],
      null,
    ],
    [
      'never outlasts the start of the run',
      [preparing(), view('dps'), pin('fight-old'), inRun('run-2', savedFight())],
      null,
    ],
    [
      'never outlasts leaving the group',
      [preparing(), view('dps'), pin('fight-old'), preparing({ room: false }, savedFight())],
      null,
    ],
  ])('%s', (_, steps, pinned) => {
    expect(run(...steps).pinned).toBe(pinned);
  });

  it.each<[string, (MeterInput | MeterAction)[], boolean]>([
    ['History opens on the fight', [input(), history(true)], true],
    ['picking a fight closes History', [input(), history(true), pin('fight-old')], false],
    ['going back to live closes History', [input(), history(true), pin(null)], false],
    [
      'the room closes History, which hangs from the fight caption',
      [preparing(), view('dps'), history(true), view('group')],
      false,
    ],
    ['a group starting to prepare closes History', [input(), history(true), preparing()], false],
    [
      'History stays open on the DPS view of a preparing group',
      [preparing(), view('dps'), history(true), preparing()],
      true,
    ],
  ])('%s', (_, steps, open) => {
    expect(run(...steps).historyOpen).toBe(open);
  });
});

describe('the focus', () => {
  const duo = (patch: Record<string, unknown> = {}) =>
    input({ report: meterReport({ players: [aria, bryn], ...patch }) });
  const solo = (patch: Record<string, unknown> = {}) => input({ report: meterReport(patch) });

  it.each<[string, (MeterInput | MeterAction)[], string | null]>([
    ['starts on the ranking, even for a sole damager', [solo()], null],
    ['follows a chosen player', [duo(), focus('2')], '2'],
    ['goes back to the ranking', [duo(), focus('2'), focus(null)], null],
    ['holds as players join and leave the same fight', [solo(), focus('1'), duo(), solo()], '1'],
    ['starts a new fight on the ranking', [solo(), focus('1'), solo({ id: 'fight-b' })], null],
    [
      'starts a saved fight on the ranking',
      [duo(), focus('2'), pin('fight-old'), input(savedFight())],
      null,
    ],
    [
      'is kept per fight: the live fight keeps its choice after a saved one',
      [duo(), focus('2'), pin('fight-old'), pin(null)],
      '2',
    ],
  ])('%s', (_, steps, player) => {
    const shown = run(...steps);
    expect(shown.focus.kind === 'player' ? shown.focus.id : null).toBe(player);
    expect(shown.player?.id ?? null).toBe(player);
  });

  it.each<[string, string | null, { mine: boolean; viewingOther: boolean }]>([
    ['the ranking', null, { mine: false, viewingOther: false }],
    ['your own skills', '1', { mine: true, viewingOther: false }],
    ["someone else's skills", '2', { mine: false, viewingOther: true }],
  ])('tells %s apart', (_, id, expected) => {
    const shown = run(duo(), focus(id));
    expect({ mine: shown.mine, viewingOther: shown.viewingOther }).toEqual(expected);
    expect(shown.me?.name).toBe('Aria');
  });
});

describe('fading', () => {
  const at = (now: number, patch: Patch = {}) => input({ now, ...patch });
  const fight = (now: number, patch: Record<string, unknown> = {}, extra: Patch = {}) =>
    at(now, { report: meterReport(patch), ...extra });
  const killed = { end_reason: 'kill', targets: [boss('Tahabata', 74_600)] };
  const bossesOnly = (adds: number) => ({
    targets: [boss('Warden', 74_600), { ...golem, id: 61, name: 'Warden Guard', damage: adds }],
  });

  it.each<[string, MeterInput[], boolean]>([
    ['lit just before the idle time', [at(0), at(29_000)], false],
    ['faded once the idle time passes', [at(0), at(30_000)], true],
    [
      'lit again on a new event',
      [at(0), at(31_000), at(31_000, { status: { ...capturing, events: 7 } })],
      false,
    ],
    [
      'lit while the live report keeps counting damage, though the status count stands still',
      [
        fight(0, { players: [{ ...aria, damage: 74_600 }] }),
        fight(20_000, { players: [{ ...aria, damage: 80_000 }] }),
        fight(40_000, { players: [{ ...aria, damage: 90_000 }] }),
        fight(60_000, { players: [{ ...aria, damage: 100_000 }] }),
      ],
      false,
    ],
    [
      'faded once that damage stops',
      [
        fight(0, { players: [{ ...aria, damage: 74_600 }] }),
        fight(20_000, { players: [{ ...aria, damage: 80_000 }] }),
        fight(51_000, { players: [{ ...aria, damage: 80_000 }] }),
      ],
      true,
    ],
    [
      'lit while a bosses-only meter hits adds, which only the targets count',
      [
        fight(0, bossesOnly(1_000), { settings: { target_mode: 'boss' } }),
        fight(20_000, bossesOnly(5_000), { settings: { target_mode: 'boss' } }),
        fight(40_000, bossesOnly(9_000), { settings: { target_mode: 'boss' } }),
      ],
      false,
    ],
    ['lit on a killed boss, however long', [fight(0, killed), fight(120_000, killed)], false],
    [
      'lit on a cleared boss',
      [
        fight(0, { ...killed, end_reason: 'clear' }),
        fight(60_000, { ...killed, end_reason: 'clear' }),
      ],
      false,
    ],
    [
      'faded on a running boss fight left idle',
      [
        fight(0, { targets: [boss('Tahabata', 74_600)] }),
        fight(31_000, { targets: [boss('Tahabata', 74_600)] }),
      ],
      true,
    ],
    [
      'faded on an ended trash fight',
      [fight(0, { end_reason: 'idle' }), fight(31_000, { end_reason: 'idle' })],
      true,
    ],
    [
      'lit for the full idle time of the next fight after a long-held boss',
      [
        fight(0, killed),
        fight(300_000, killed),
        fight(300_000, { id: 'fight-b', targets: killed.targets }),
        fight(329_000, { id: 'fight-b', targets: killed.targets }),
      ],
      false,
    ],
    [
      'faded once that next fight idles its full time',
      [
        fight(0, killed),
        fight(300_000, killed),
        fight(300_000, { id: 'fight-b', targets: killed.targets }),
        fight(330_000, { id: 'fight-b', targets: killed.targets }),
      ],
      true,
    ],
    [
      'lit on the room while the group prepares',
      [preparing({}, { now: 0 }), preparing({}, { now: 120_000 })],
      false,
    ],
    [
      'never faded with fading off',
      [
        at(0, { settings: { fade_after_seconds: 0 } }),
        at(600_000, { settings: { fade_after_seconds: 0 } }),
      ],
      false,
    ],
  ])('%s', (_, steps, faded) => {
    expect(run(...steps).faded).toBe(faded);
  });

  it('fades from the room once DPS is chosen and stays idle', () => {
    expect(
      run(
        preparing({}, { now: 0 }),
        preparing({}, { now: 60_000 }),
        view('dps'),
        preparing({}, { now: 89_000 }),
      ).faded,
    ).toBe(false);
    expect(
      run(
        preparing({}, { now: 0 }),
        preparing({}, { now: 60_000 }),
        view('dps'),
        preparing({}, { now: 90_000 }),
      ).faded,
    ).toBe(true);
  });

  it('keeps a picked saved boss fight lit, while a picked trash fight still fades', () => {
    const boss_ = savedFight({ end_reason: 'kill', targets: [boss('Tahabata', 100_000)] });
    expect(run(at(0), pin('fight-old'), at(0, boss_), at(120_000, boss_)).faded).toBe(false);
    expect(run(at(0), pin('fight-old'), at(0, savedFight()), at(31_000, savedFight())).faded).toBe(
      true,
    );
  });

  it('uses the fade opacity while faded and the meter opacity while lit', () => {
    const settings = { opacity: 0.8, fade_opacity: 0.3, scale: 1.25 };
    const lit = run(at(0, { settings }));
    expect([lit.opacity, lit.baseOpacity, lit.scale]).toEqual([0.8, 0.8, 1.25]);
    const faded = run(at(0, { settings }), at(31_000, { settings }));
    expect([faded.opacity, faded.baseOpacity]).toEqual([0.3, 0.8]);
  });
});

describe('the problem line', () => {
  const failed: LiveStatus = {
    ...capturing,
    running: false,
    phase: 'error',
    message: 'Npcap is not installed.',
  };
  it.each<[string, (MeterInput | MeterAction)[], string]>([
    ['says nothing without a problem', [input()], ''],
    [
      'leads with the window error',
      [
        input({
          error: 'Read failed',
          overlay: { ...overlay, errors: ['Hotkey taken'] },
          status: failed,
        }),
      ],
      'Read failed',
    ],
    [
      'then every overlay error',
      [input({ overlay: { ...overlay, errors: ['Hotkey taken', 'Lock failed'] }, status: failed })],
      'Hotkey taken · Lock failed',
    ],
    ['then the capture error', [input({ status: failed })], 'Npcap is not installed.'],
    [
      'names a capture error that came without a message',
      [input({ status: { ...failed, message: '' } })],
      'Capture error',
    ],
    [
      'then a failed copy',
      [input(), { type: 'copied', result: { ok: false, detail: 'Clipboard denied' } }],
      'Clipboard denied',
    ],
    ['never a copy that worked', [input(), { type: 'copied', result: { ok: true } }], ''],
    [
      'then the pinned fight that could not be read',
      [
        input(),
        pin('fight-old'),
        input({ saved: { report: null, loading: false, error: 'Native returned another fight' } }),
      ],
      'Native returned another fight',
    ],
    [
      'never a saved fight that is not pinned',
      [input({ saved: { report: null, loading: false, error: 'Old failure' } })],
      '',
    ],
  ])('%s', (_, steps, problem) => {
    expect(run(...steps).problem).toBe(problem);
  });

  it('confirms a copy that worked until it lapses', () => {
    expect(run(input(), { type: 'copied', result: { ok: true } }).copied).toBe(true);
    expect(
      run(input(), { type: 'copied', result: { ok: true } }, { type: 'copied', result: null })
        .copied,
    ).toBe(false);
    expect(run(input(), { type: 'copied', result: { ok: false, detail: 'x' } }).copied).toBe(false);
  });
});

describe('the context line', () => {
  const started = meterReport().started_ms!;
  it.each<[string, (MeterInput | MeterAction)[], string]>([
    ['says when the live fight began', [input()], `Live · since ${words.fmt.hourMinute(started)}`],
    [
      'says nothing about an ended fight',
      [input({ report: meterReport({ end_reason: 'idle' }) })],
      '',
    ],
    [
      'says nothing about a fight whose capture stopped',
      [input({ status: { ...capturing, running: false, phase: 'stopped' } })],
      '',
    ],
    ['waits for combat before a report', [input({ report: null })], 'Waiting for combat'],
    [
      'names capture waiting for the game',
      [input({ report: null, status: { ...capturing, phase: 'waiting_for_game' } })],
      'Waiting for game',
    ],
    [
      'names capture connecting',
      [input({ report: null, status: { ...capturing, running: false, phase: 'starting' } })],
      'Connecting',
    ],
    [
      'names a capture error',
      [input({ report: null, status: { ...capturing, running: false, phase: 'error' } })],
      'Capture error',
    ],
    [
      'says nothing on a saved fight',
      [input(), pin('fight-old'), input(savedFight({ end_reason: null }))],
      '',
    ],
  ])('%s', (_, steps, context) => {
    expect(run(...steps).context).toBe(context);
  });
});

describe('the empty list', () => {
  const noPlayers = (targets: unknown[] = [golem]) => meterReport({ players: [], targets });
  it.each<[string, (MeterInput | MeterAction)[], [string, string]]>([
    [
      'waits for combat while capturing',
      [input({ report: null })],
      ['Waiting for combat…', 'Hit a target to see live damage.'],
    ],
    [
      'waits for the game',
      [input({ report: null, status: { ...capturing, phase: 'waiting_for_game' } })],
      ['Waiting for game…', 'Capture connects automatically once AION 2 is running.'],
    ],
    [
      'connects',
      [input({ report: null, status: { ...capturing, running: false, phase: 'starting' } })],
      ['Connecting…', 'Live capture starts automatically.'],
    ],
    [
      'says capture is unavailable',
      [input({ report: null, status: { ...capturing, running: false, phase: 'error' } })],
      ['Capture unavailable', 'Capture retries automatically.'],
    ],
    [
      'says a met boss has no damage yet, never idle',
      [input({ report: noPlayers([boss('Tahabata', 0)]) })],
      ['No boss damage yet', ''],
    ],
    [
      'reads the Bosses scope as every target without a boss',
      [input({ report: noPlayers(), settings: { target_mode: 'boss' } })],
      ['Waiting for combat…', 'Hit a target to see live damage.'],
    ],
    [
      'says a focused player dealt nothing here',
      [input(), focus('9')],
      ['No damage dealt in this view', ''],
    ],
    [
      'loads a pinned fight',
      [input(), pin('fight-old'), input({ saved: { report: null, loading: true, error: '' } })],
      ['Loading saved fight…', ''],
    ],
    [
      'says a pinned fight is unavailable',
      [
        input(),
        pin('fight-old'),
        input({ saved: { report: null, loading: false, error: 'gone' } }),
      ],
      ['Saved fight unavailable', ''],
    ],
    [
      'waits on a saved fight without damage, with no capture hint',
      [input(), pin('fight-old'), input(savedFight({ players: [] }))],
      ['Waiting for combat…', ''],
    ],
  ])('%s', (_, steps, [empty, hint]) => {
    const shown = run(...steps);
    expect([shown.empty, shown.emptyHint]).toEqual([empty, hint]);
  });

  it('gives no hint while players are ranked', () => {
    expect(run(input()).emptyHint).toBe('');
  });

  it('waits for the native report rather than rank unfiltered live totals', () => {
    const live: LiveStatus = {
      ...capturing,
      players: [
        {
          entity: 7,
          label: 'Aria',
          name: 'Aria',
          class: 'Chanter',
          is_local: true,
          damage: 900,
          dps: 90,
          current_dps: 10,
          share: 1,
          direct_hits: 3,
          critical_hits: 1,
          ticks: 0,
          skills: { 'Spinning Strike': 900 },
        },
      ],
    };
    const shown = run(input({ status: live, report: null }));
    expect(shown.model).toBeNull();
    expect(shown.empty).toBe('Waiting for combat…');
  });
});

describe('the caption', () => {
  const targets = [
    { ...golem, id: 51, name: 'Elyos Scout', damage: 90_000 },
    boss('Tahabata', 70_000),
    boss('Ice Golem', 4_600, 61),
    { ...golem, id: 62, name: 'Asmodian Ranger', damage: 0 },
  ];
  it.each<[string, Patch, { text: string; title: string }, boolean]>([
    ['names the only target hit', {}, { text: 'Training Golem', title: 'Training Golem' }, true],
    [
      'counts every target hit in the All scope, never claiming a boss',
      { report: meterReport({ targets }) },
      { text: 'All targets', title: 'Elyos Scout, Tahabata, Ice Golem' },
      true,
    ],
    [
      'names only the bosses met in the Bosses scope',
      { report: meterReport({ targets }), settings: { target_mode: 'boss' } },
      { text: 'Tahabata +1', title: 'Tahabata, Ice Golem' },
      true,
    ],
    [
      'reads the Bosses scope as every target without a boss',
      {
        report: meterReport({
          targets: [
            { ...golem, id: 51, name: 'Elyos Scout' },
            { ...golem, id: 52, name: 'Elyos Archer' },
          ],
        }),
        settings: { target_mode: 'boss' },
      },
      { text: 'All targets', title: 'Elyos Scout, Elyos Archer' },
      true,
    ],
    [
      'names an unnamed target as unknown',
      { report: meterReport({ targets: [{ ...golem, name: null }] }) },
      { text: 'Unknown target', title: 'Unknown target' },
      true,
    ],
    [
      'leaves the only boss hit to its boss bar',
      { report: meterReport({ targets: [boss('Tahabata', 74_600)] }) },
      { text: 'Tahabata', title: 'Tahabata' },
      false,
    ],
    [
      'counts what it shows while the boss bar names a boss met but not hit',
      { report: meterReport({ players: [], targets: [boss('Tahabata', 0)] }) },
      { text: 'All targets', title: '' },
      true,
    ],
    ['says nothing before a report', { report: null }, { text: 'All targets', title: '' }, true],
  ])('%s', (_, patch, caption, headline) => {
    const shown = run(input(patch));
    expect(shown.caption).toEqual(caption);
    expect(shown.headline).toBe(headline);
  });
});

describe('privacy and controls', () => {
  const death: DeathShortcut = { at: 0, name: 'Kaelith', class: 'Assassin', profile: null };
  const hidden = { settings: { hide_names: true } };
  it.each<[string, (MeterInput | MeterAction)[], DeathShortcut | null, boolean]>([
    ['offers your recent death and profile links', [input({ death })], death, true],
    ['hides both while names are hidden', [input({ death, ...hidden })], null, false],
    [
      'hides the death on a saved fight',
      [input({ death }), pin('fight-old'), input({ death, ...savedFight() })],
      null,
      true,
    ],
  ])('%s', (_, steps, shown, links) => {
    const result = run(...steps);
    expect(result.death).toEqual(shown);
    expect(result.profileLinks).toBe(links);
  });

  it('keeps your own class private while names are hidden, and no one else’s', () => {
    const shown = run(input(hidden));
    expect(shown.classOf({ class: 'Gladiator', local: true })).toBeNull();
    expect(shown.classOf({ class: 'Cleric', local: false })).toBe('Cleric');
    expect(run(input()).classOf({ class: 'Gladiator', local: true })).toBe('Gladiator');
  });

  it.each<[string, Patch, boolean]>([
    ['starts a new fight when idle', {}, true],
    ['waits for work in flight', { busy: true }, false],
  ])('%s', (_, patch, canReset) => {
    expect(run(input(patch)).canReset).toBe(canReset);
  });

  it('shows tracker chips only when the in-game tracker surface is not in use', () => {
    const tracker = {
      bar_id: 'b',
      skill: 1,
      name: 'Burst',
      remaining_ms: 4000,
      kind: 'cooldown' as const,
      source: 1,
      target: null,
      estimated: true,
      basis: null,
    };
    const base = input();
    const withTracker = { ...base, offline: { ...base.offline!, trackers: [tracker] } };
    expect(run(withTracker).trackers).toEqual([tracker]);
    expect(
      run({ ...withTracker, overlay: { ...overlay, trackers_requested: true } }).trackers,
    ).toEqual([]);
  });
});

describe('the state transitions', () => {
  it('return the same state when nothing changed, so a render can apply them freely', () => {
    const first = meterStart(preparing());
    expect(meterStep(first, preparing())).toBe(first);
    const chosen = meterStep(first, preparing(), view('dps'));
    expect(meterStep(chosen, preparing({ capacity: 6 }))).toBe(chosen);
  });
});
