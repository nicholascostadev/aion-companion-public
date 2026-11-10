import type { ReactNode } from 'react';
import { Fig } from '@/components/fig';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { DOWNLOAD_URL, REPO_URL } from '@/lib/site';

/*
 * Every word on the English page. Claims are checked against the app (README, docs/*.md and
 * the bundled data); keep them that way, in both languages. Window labels follow the app's own
 * strings (frontend/src/i18n/locales/en).
 */

export type FeatureId = 'live' | 'reports' | 'group' | 'alerts' | 'pets' | 'explore' | 'windows';

export type Feature = {
  id: FeatureId;
  name: string;
  title: string;
  points: ReactNode[];
  note?: string;
};

const copyKeys = (
  <KbdGroup>
    <Kbd>Ctrl</Kbd>
    <Kbd>Shift</Kbd>
    <Kbd>F5</Kbd>
  </KbdGroup>
);

export const en = {
  meta: {
    title: 'Aion Companion: a combat companion for AION 2',
    description:
      'A free, open-source Windows companion for AION 2: live DPS over the game, group inspection, boss alerts and pet farming. Everything stays on your PC.',
  },
  skip: 'Skip to content',
  header: {
    sections: 'Sections',
    nav: { features: 'Features', privacy: 'Privacy', faq: 'FAQ' },
    download: 'Download',
    language: 'Language',
  },
  hero: {
    kicker: 'The companion app for AION 2',
    headline: 'Everything AION 2',
    headlineEm: 'doesn’t show you.',
    lede: 'Live DPS over the game, fight reports down to every cast, your party’s gear and Combat Power, 73 field-boss alerts, all 207 pets and every hidden cube in Verteron and Altgard.',
    download: 'Download for Windows',
    seeFeatures: 'See the features',
    fine: 'Windows 10 and 11, x64 · Open source, MIT · No account',
    fineShort: 'Windows 10 and 11 · Free · No account',
  },
  features: {
    title: 'What it does.',
    subtitle: 'Live DPS, fight logs, party inspection, boss timers, pet farming and map locations.',
    label: 'Features',
    list: [
      {
        id: 'live',
        name: 'Live DPS',
        title: 'Every hit, the moment it lands.',
        points: [
          'Encounter or active DPS, damage, share, Combat Power and deaths for the whole party.',
          'Boss HP with a kill-time projection and the rage countdown.',
          'Click any player for every skill, target and hit they dealt.',
          <>Paste the top five into chat with {copyKeys}.</>,
        ],
        note: 'This is a real Atiel clear from Deus Research Base, replayed second by second; only the other players’ names are changed. Damage comes straight from the game’s own numbers.',
      },
      {
        id: 'reports',
        name: 'Logs and reports',
        title: 'Nine ways to read a fight.',
        points: [
          'Rotation and opener: every cast in order, with target HP and the buffs that were up.',
          'Buffs per skill, death recaps with the last 10 seconds, HP and DPS over time.',
          'Compare two fights, or two players from the same fight, skill by skill.',
          <>
            Training-dummy runs of <Fig>10</Fig> seconds to <Fig>5</Fig> minutes, timed for you.
          </>,
        ],
        note: 'Every fight saves itself. Search, label and group them by run.',
      },
      {
        id: 'group',
        name: 'Group',
        title: 'Know the room before the pull.',
        points: [
          'Class, level, gear score, Combat Power and ready state for everyone in the party room.',
          'Set a minimum gear score or Combat Power and see who falls short.',
          'Open a full profile: equipment, Arcana, skills, Daevanion boards, stats and cosmetics.',
          <>
            Keep up to <Fig>50</Fig> favourite characters one click away.
          </>,
        ],
      },
      {
        id: 'alerts',
        name: 'Alerts and timers',
        title: 'Be there when it opens.',
        points: [
          <>
            <Fig>73</Fig> field bosses across Verteron, Altgard, Eltnen, Morheim and Lower Reshanta.
          </>,
          'Shugo Festival, Dimensional Invasion, Spacetime Rift and the world bosses on your server’s clock.',
          <>
            Up to <Fig>8</Fig> reminders per alert, <Fig>6</Fig> sounds, snooze and quiet hours.
          </>,
          'Pauses during announced maintenance and tells you when it ends.',
        ],
        note: 'These countdowns run on your computer’s clock.',
      },
      {
        id: 'pets',
        name: 'Pets',
        title: 'All 207 pets. And where they are.',
        points: [
          'Your collection across all five families, with the game’s own portraits.',
          'The radar lists soul monsters around you, with distance and direction.',
          'Pin a farming goal and watch souls, level-ups and new pets add up.',
          <>
            <Fig>20,561</Fig> spawn entries on the original terrain of Verteron, Altgard and Lower
            Reshanta.
          </>,
        ],
      },
      {
        id: 'explore',
        name: 'Explore',
        title: 'Every hidden cube. Every herb.',
        points: [
          <>
            <Fig>2,811</Fig> hidden cube spots in Verteron and Altgard.
          </>,
          <>
            <Fig>5,401</Fig> gathering points for ore, herbs, gemstones, wood, food and aether.
          </>,
          'Distance from you to each spot, on a window that follows your map.',
        ],
        note: 'This is Verteron, drawn from the app’s own data. Spots are known locations, not a live feed.',
      },
      {
        id: 'windows',
        name: 'In-game windows',
        title: 'Nine windows. Zero alt-tabs.',
        points: [
          'Lock any window and your clicks go straight through to the game.',
          'They never steal focus, and they remember where you put them.',
          <>
            Cooldown and buff trackers: up to <Fig>32</Fig> bars per build.
          </>,
          'Five shortcuts, all of them yours to rebind.',
        ],
      },
    ] satisfies Feature[] as Feature[],
  },
  toolkit: {
    title: 'The rest of the toolkit.',
    statsWindow: 'Companion stats',
    stats: [
      'Skills recognised',
      'Pets tracked',
      'Field bosses',
      'Hidden cube spots',
      'Gathering points',
      'Global servers',
    ],
    tools: [
      {
        title: 'Compare',
        body: 'Your live fight against a saved one, or two players head to head.',
      },
      {
        title: 'Replay',
        body: 'Scrub a recording: damage at any second and where everyone stood.',
      },
      {
        title: 'Copy summary',
        body: 'One line or one per player, ready to paste into party chat.',
      },
      {
        title: 'Hide names',
        body: 'Class and rank instead of names when you stream or share a screenshot.',
      },
      {
        title: 'Backups',
        body: 'Settings, pet progress and logs in one file, previewed before restore.',
      },
      {
        title: 'Updates',
        body: 'Downloaded and verified in the background; switches only when you say.',
      },
      {
        title: 'Bug reports',
        body: 'One file you can read before you send it. Nothing leaves on its own.',
      },
      {
        title: 'English and Português',
        body: 'The whole app, tray and copied summaries, in both languages.',
      },
    ],
  },
  privacy: {
    kicker: 'Privacy',
    line1: 'Your fights.',
    line2: 'Your PC.',
    lede: 'Aion Companion has no servers of its own. Everything it records stays with you.',
    facts: [
      {
        title: 'Stays on your PC',
        body: 'Fights, logs, settings, alerts and pet progress never leave your computer.',
      },
      {
        title: 'No account',
        body: 'Nothing to sign up for. No telemetry, no uploads of your gameplay.',
      },
      {
        title: 'Listens, never touches',
        body: 'It reads the game’s traffic. It never sends or changes a packet and never edits game files.',
      },
      {
        title: 'Open and checkable',
        body: 'MIT-licensed source on GitHub, and a SHA‑256 checksum for every download.',
      },
    ],
  },
  faq: {
    kicker: 'Questions',
    title: 'Straight answers.',
    ask: 'Something not covered here? Open an issue and ask.',
    askButton: 'Ask on GitHub',
    items: [
      {
        q: 'Is it free?',
        a: (
          <>
            Yes. No account, no subscription, no ads. The source is on <a href={REPO_URL}>GitHub</a>{' '}
            under the MIT licence.
          </>
        ),
      },
      {
        q: 'Can I get banned for using it?',
        a: 'The app only reads network traffic. It never sends or changes packets and never touches game files. That is not a promise about NCSOFT’s rules or anti-cheat decisions, and nobody outside NCSOFT can make one. Use it knowing that.',
      },
      {
        q: 'How accurate is the meter?',
        a: 'Damage comes straight from the game’s own numbers and is never estimated. Anything that happened before capture started stays unknown until the game sends it again. PvP and the Taiwan and Korea clients are not verified yet.',
      },
      {
        q: 'Why does it need Npcap?',
        a: 'Npcap lets the app read the game’s traffic: live DPS, the party room, trackers and the pet radar need it. Logs, reports, alerts, maps and pet planning work without it. Install it only from its official site.',
      },
      {
        q: 'Why does Windows warn me about it?',
        a: (
          <>
            Releases are not code-signed yet. Download only from the{' '}
            <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
              project’s releases
            </a>{' '}
            and compare the file with its published SHA‑256. Never turn off Windows protection to
            run it.
          </>
        ),
      },
      {
        q: 'Which regions does it support?',
        a: 'Global servers are the tested target, with all 106 Global servers on the alert clock. Taiwan and Korea can be selected but are not verified. Character profiles are Global only.',
      },
      {
        q: 'Is it in my language?',
        a: 'The app and this site come in English and Português (Brasil). Switch at any time.',
      },
      {
        q: 'Is this made by NCSOFT?',
        a: 'No. It is an independent fan project, not affiliated with or endorsed by NCSOFT.',
      },
    ] as { q: string; a: ReactNode }[],
  },
  final: {
    title: 'See the',
    titleEm: 'whole fight.',
    lede: 'Free for Windows 10 and 11. Install it before your next run.',
    download: 'Download for Windows',
  },
  footer: {
    disclaimer:
      'An unofficial fan project, not affiliated with or endorsed by NCSOFT. AION 2 class, pet and map artwork and game data belong to NCSOFT / NC Corporation and are not covered by the MIT licence. Demos on this page use the app’s fictional demo data.',
    links: 'Project links',
    releases: 'Releases',
    source: 'Source',
    issues: 'Issues',
    licence: 'MIT licence',
  },
  /** Labels inside the copies of the app's windows, as the app writes them. */
  app: {
    companion: 'Companion',
    damageDealt: 'Damage dealt',
    lastHit: 'Last hit',
    boss: 'Boss',
    kill: 'Kill',
    rage: 'Rage',
    defeated: 'Defeated',
    done: 'Done',
    cp: 'CP',
    me: 'ME',
    liveSince: (time: string) => `Live · since ${time}`,
    savedToLogs: 'Saved to Logs',
    timers: 'Timers',
    yourClock: 'Your clock',
    alive: 'Alive',
    unknown: 'Unknown',
    dailyReset: 'Daily reset',
    weeklyReset: 'Weekly reset',
    radarLive: 'Live',
    notNearby: 'Not nearby',
    toLevel: (souls: number, level: number) => `${souls} to Lv ${level}`,
    toObtain: (souls: number) => `${souls} to obtain`,
    pointsOnMap: (n: string) => `${n} points on this map`,
    mapKey: { goal: 'Goal', pinned: 'Pinned', spawns: 'Spawns', live: 'Live' },
    group: 'Group',
    dps: 'DPS',
    preparing: 'Preparing',
    ready: (n: number) => `${n} ready`,
    dungeon: 'Deus Research Base (Transcendence)',
    readiness: 'Readiness observed 6s ago · oldest 10s ago',
    gsLevel: (gs: string, level: number) => `GS ${gs} · Lv ${level}`,
    inspected: 'Inspected profiles',
    findCompare: 'Find & compare',
    live: 'Live',
    average: 'Average',
    detailsTitle: 'Damage details',
    pause: 'Pause',
    encounter: 'Combat encounter',
    encounterMeta: (time: string) => `${time} · In progress · All targets · run-atiel`,
    tabs: [
      'Damage',
      'Healing',
      'Taken',
      'Deaths',
      'Highlights',
      'Skills',
      'Rotation',
      'Buffs',
      'Timeline',
    ],
    rotationTab: 'Rotation',
    opener: 'Opener',
    first30: 'first 30 s',
    targetHp: 'Target HP',
    buffsSelf: 'Buffs on self',
    partyBuffs: 'Party buffs',
    castAt: (at: string, hp: string) => `at ${at} s · target HP ${hp}`,
    hits: 'Hits',
    crits: 'Crits',
    event: 'Event',
    startingNow: 'Starting now',
    minBefore: (n: number) => `${n} min before`,
    borderless: 'AION 2 · borderless',
    gameInView: 'Your game stays in view',
    layers: 'Map layers',
    mapLabel:
      'Map of Verteron with every hidden cube and gathering placement drawn as points of light.',
    north: 'N',
    layer: {
      cube: 'Hidden cubes',
      ore: 'Ore',
      herb: 'Herbs',
      gemstone: 'Gemstones',
      aether: 'Aether',
      food: 'Food',
      wood: 'Wood',
    },
  },
};

export type Messages = typeof en;
