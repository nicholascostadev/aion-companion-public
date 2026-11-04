# Shugo.gg profile links

The profile mark beside a character (DPS meter, workspace Live meter, a report's Deaths
tab, damage details) opens the in-game [character profile](CHARACTER_PROFILES.md), read
from NCSOFT's official service. Inside it, **Open in Shugo.gg** opens the character's public
profile on [Shugo.gg](https://shugo.gg/). The app sends nothing to the site: native opens one
page in the default browser when the user clicks the button.

## Native command

`shugo_open_profile({serverId, name})` builds and opens the address in
`src-tauri/src/shugo.rs`. It never takes a URL. It refuses:

- a server id outside the Global range (below);
- a name that is empty, longer than 32 characters, or contains whitespace, control
  characters or `/ \ ? # % & +`, so a placeholder such as `Player #12` is never looked up.

`shugo_copy_profile_link({serverId, name})` builds the same address, copies it with the
native clipboard and returns it, for the profile window's **Copy profile link**; it also
refuses while character names are hidden.

The name is percent-encoded as a single path segment. Failures come back as the command's
error string (`Windows could not open your browser.`). `frontend/src/lib/shugo.ts` applies
the same rules to decide whether to offer a link; `frontend/src/services/shugo.ts` calls the
command.

## Address contract

Verified on 2026-11-04 against Shugo's [changelog](https://shugo.gg/changelog), which
documents shareable Global profile URLs such as `/character/global/eu-kaisinel/<name>`
"with the sub-region in the server name", and against the site's production bundle
(`/assets/main-*.js`):

- The route is `/character/<region>/<server>/<encodeURIComponent(name)>`, with region
  `global`, `kr` or `tw`.
- A Global server id is `[faction][sub-region][index]`. Shugo maps the second digit to
  `1 nae`, `2 naw`, `3 eu`, `4 la`, `5 as`, and only ids matching `^[12]\d{3}$` with such a
  digit are Global.
- The server segment is `<sub-region>-<lowercased server name>` (spaces become `-`), from
  Shugo's own id-to-name table. Its 124 Global entries name servers 1-10 in NA East, 1-5 in
  NA West, 1-23 in EU, 1-6 in South America and 1-18 in Asia, each faction from one list:
  Elyos Siel, Nezekan, Vaizel, Kaisinel, Yustiel, Ariel, Fregion, Meslamtaeda, Hithanya,
  Nania, Tahavatha, Luteros, Phernos, Daminu, Kasaka, Bakarma, Tsenka, Kochi, Ishtar, Tiamat,
  Gauss, Lamuatan, Nathara; Asmodian Israphel, Zikel, Triniel, Lumiel, Marchutan, Azphel,
  Ereshkigal, Beritra, Nemon, Hadala, Ludra, Ulgorn, Munin, Odar, Zemurru, Kromede, Quai,
  Baba, Fafnir, Indnath, Agnita, Atiel, Tassin.
- Shugo's router also resolves a bare four-digit Global id as the server segment. The app
  uses it only for a Global id outside that table, such as a server opened later.

Examples: `1304` → `/character/global/eu-kaisinel/<name>`, `2101` → `nae-israphel`,
`1501` → `as-siel`. Korean and Taiwanese characters use `10xx` and `20xx` ids under both
`kr` and `tw`, so an id alone cannot choose the region and those characters get no link.
Re-check the bundle's `Hw` region map, `bc` server table and character route before
changing this module. The table only builds these link addresses: the region code comes from
the app's own official identity rules (`src-tauri/src/profile_identity.rs`), and nothing the
app shows, saves or requests from NCSOFT uses Shugo's server names.

## Which characters get a profile

A profile mark needs a character name and a server id. Native keeps a direct server binding
with the name it arrived with (`0x048d`) and clears it when the entity's name changes.
For name-only player records, the current party roster supplies the server only when exactly
one observed entity and exactly one roster member have that name. Duplicate names, NPCs and
conflicting explicit servers do not use this fallback. The match is derived from the current
roster, so leaving the party or observing a collision revokes it. The same match attaches
roster CP and gear score to the combat row. Live rows carry the resolved server as
`live_status.players[].server_id`, and report players as `server_id`. Monsters, pending
identities (`name_known: false`) and players without an observed server have no link.
Hiding character names hides every profile mark and the death shortcut, as each names a
character, and closes the profile window.

## Latest death

The offline status envelope carries `last_death` (see [offline API](OFFLINE_API.md)): the
local character's latest death this session and the last hit taken in the ten seconds
before it. The game's death record names no killer, so the meter says "Last hit", never
"killed by". The overlay shows it as a strip for ten minutes after the death, until it is
dismissed or a newer death replaces it; the workspace Live meter shows it as one line. It
uses the compact live status the meter already polls, never a full report.
Changing characters or reconnecting clears the shortcut and pending last-hit evidence;
resetting combat preserves it for the current session.
