# Character profiles

The profile mark beside a character's name (DPS meter ranking and latest-death strip,
workspace Live table and latest-death line, a report's Deaths tab, damage details) opens
the **character profile**: an in-game window with that character's public profile from
NCSOFT's official AION 2 character service. It shows Equipment, Arcana, Skills, Daevanion,
Stats and Cosmetics. Arcana have their own tab, laid out as cards the way the game shows
them ([Arcana](#arcana)); Equipment lists every other slot with the pet and wings. The sheet keeps every slot, and each tab only filters it. Its header can save the character (a labelled star toggle) and its caption reopens saved characters,
copy the character's Shugo.gg profile link or a one-line summary, and open the profile on
Shugo.gg through the existing allowlisted opener ([Shugo.gg profile links](SHUGO_PROFILES.md)).

## Sources

Every fact the window shows (identity, sheet, equipment, item details, boards, skill list and
levels) is read by native over the user's own connection from NCSOFT's public services,
with no proxy, scraping or embedded web page, and from no other data source. Browsers
cannot read these endpoints (no CORS headers), which is why the request is native.
Verified without credentials on 2026-11-04; the recorded answers are in `fixtures/profile`.
The only other address the window knows is the optional Shugo.gg profile link, which is
opened in the browser or copied only when the user clicks it; nothing is read from it.

| Purpose   | Request                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity  | `https://api-search.plaync.com/aion2global/search/v2/character?keyword=<name>&page=<n>&size=20&localeInfo=<lang>&region=<region>&serverId=<id>`               |
| Sheet     | `https://aion2.plaync.com/api/character/info?lang=<lang>&characterId=<id>&serverId=<id>&region=<region>`                                                      |
| Equipment | `…/api/character/equipment?` (same parameters): equipment, appearance, pet, wings, wing appearance, skills                                                    |
| Item      | `…/api/character/equipment/item?` (same) `&id=<item>&enchantLevel=<enchant + breakthrough>&slotPos=<slot>`                                                    |
| Daevanion | `…/api/character/daevanion/detail?` (same) `&boardId=<board>`                                                                                                 |
| Artwork   | `https://assets.playnccdn.com/static-aion2-gamedata/resources/<file>.png`; portraits `https://profileimg.plaync.com/game_profile_images/aion2global/images?…` |

- `region` is the Global sub-region of the server id (`nae`, `naw`, `eu`, `la`, `as`), the
  codes of the official site's own region list (the official search answers `la` for server
  2403). `src-tauri/src/profile_identity.rs` owns this mapping and the name and encoding
  rules; the profile client depends on no external-link module. Korean and Taiwanese ids get
  no profile.
- The search returns similar names (`foxyyyynm`, `foxyyyynmT`, `foxyyyynmG`) with the match
  wrapped in `<strong>`. Native strips tags, decodes the few HTML entities text can carry,
  and accepts only the entry whose name and server id are **exactly** the observed ones,
  reading up to three pages. A name listed twice on one server is refused, never guessed.
- The search's `characterId` is percent-encoded (`…tv4k%3D`). Native decodes it once,
  validates it as URL-safe Base64 and encodes it once for the next query (`…tv4k%3D`, never
  `%253D`).
- An item request needs the slot (two copies of one ring are two slots, each with its own
  rolls) and the **total** enchant level: enchant 15 with breakthrough 2 is `enchantLevel=17`,
  which is what returns the breakthrough bonus lines. Without `slotPos` the service answers 404.
- `lang` follows the app language: `en-US`, or `pt-BR` in Portuguese. The item-level row of
  the sheet is named in Korean in every language, so the window uses its own label.

`src-tauri/src/profile_api.rs` builds every address from validated parts. No command takes a
URL, and its one data reader (`get_json`) refuses any address that is not HTTPS on
`api-search.plaync.com` or `aion2.plaync.com` (no port, no login) before it reaches the
network (Rust `every_profile_read_goes_only_to_the_official_hosts`,
`any_other_address_is_refused_before_the_network`). The page reaches native only through
the nine `profile_*` commands below (`services/profile.test.ts` checks the service and the
preview mock against that list). Its bounds: four requests in flight, 6 s connect and 15 s total timeouts, 2 MB per
answer, no redirects for data, and a cache keyed by the full request (identity 30 min,
sheet 5 min, item and board 10 min, at most 96 answers; Refresh bypasses it). A 429 with
`Retry-After` of 2 s or less is waited out once; a longer one blocks every profile request
until it has passed and is reported with its wait. 404 is _not found_, 451 _private_, other
answers _unavailable_, transport failures _network_. No capture or window lock is held while
a request runs; requests run on blocking workers.

Artwork is served to the pages through the `profile-art` scheme: `r.<file>.png` for a
game-data resource and `p.<server key>.<character key>` for a portrait. Native maps the key
back to the official address, follows a portrait's redirect only to NCSOFT's download host,
accepts only PNG, JPEG or WebP bytes up to 2 MB and keeps at most 160 images (32 MB) in
memory. The content policy adds only `profile-art:` to `img-src`, so the pages never load a
remote image or script directly. The browser preview loads the originals itself.

## Skills

The equipment answer's `skill.skillList` gives, per skill, exactly: `id`, `name` (in the
request language), `icon` (an official resource), `category` (`Active`, `Passive`, `Dp` for
stigma), `skillLevel`, `needLevel`, `acquired` and `equip`. The Skills tab shows those, and
the level bonuses the official documents name for the skill: a read board's
`openSkillEffectList` lines (`Onslaught +1`) and an item detail's sub-skills. While a skill's
detail is open, the window reads the boards with open nodes (each once, through the same
cache and bounds as the Daevanion tab) so their bonuses are complete, and says they are
being read until each has answered; items are read only when opened.

A skill is learned exactly when the service says `acquired`, whatever its level: a learned
stigma can be at `skillLevel` 0 (the official sample has one slotted and several unslotted).
The level is shown as sent, 0 included; a missing `skillLevel` is shown as not published,
never as 0.

**Public-API gap.** NCSOFT publishes no skill description, cost, cooldown, cast time, range,
weapon, trait, per-level value or specialty list, and not which specialties a character
chose. Checked on 2026-11-04 against the official characters bundle
(`assets.playnccdn.com/static-aion2/characters/js/index.js`), which calls only
`/api/character/{info,equipment,equipment/item,daevanion/detail}`,
`/{locale}/api/gameinfo/{classes,pcdata,servers}` (class, race and server names) and
`/api/gameconst/item` (items); probes of `…/api/character/skill`, `…/skill/detail`,
`…/gameinfo/skill(s)` and `…/gameconst/skill` answer 404 or redirect to the error page. The
app's own bundled `catalogue.json` holds skill names only. So the skill detail says these
fields are not published instead of showing them, and says that chosen specialties are
unknown. No third-party catalogue or translation is read, bundled or copied; a field will
appear here only when an official source publishes it.

## Saved characters

`src-tauri/src/profile_favorites.rs` keeps up to **50** saved characters, each an exact
name on one Global server (the same validation as opening a profile), newest first, in
`profile-favorites.json` (`{version:1, favorites:[{server_id, server_name, name, saved_ms}]}`),
written atomically. `server_name` is the server's name as an official character sheet gave it
(`ProfileApi::server_name`: kept only from a sheet whose `serverId` and `characterName` are
exactly the looked-up ones), saved with the character, or null when none had answered; the
list shows a server with no official name by its number. Older files without the field load
unchanged. A full list refuses another save; the window disables the star and says to
remove one. A corrupt, oversized or future file loads as empty and is left untouched; a
tampered entry is skipped. The list is read with the window status and changed only by
`profile_favorite_set`; the page shows native's answer and drops reads that began before it.
While names are hidden the status carries no list and saving is refused (the file is kept).
There is no account, sign-in or import: the list belongs to this app on this computer.

## Native window and commands

`src-tauri/src/profile_window.rs` owns one focus-gated, resizable window
(`character-profile`, `?view=profile`), built hidden the first time it is opened and placed
near the game's top-left, then where the user last dropped it (`profile-window.json`). It
shows only while requested, names are shown and AION or one of our overlays is focused; an
open lends it the foreground once (see [Foreground and the game's mouse](#foreground-and-the-games-mouse)). Native reads the hide-names setting at
startup and applies every saved change at once (`offline_configure` calls
`profile_window::settings_applied` with the settings it saved), so hiding names closes the
window and forgets the character before any page poll or focus change; a status poll that
read the setting before such a change cannot undo it.

| Command                                                                 | Does                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile_window_open(serverId, name)`                                   | Validates a Global server and an observed name, refuses while names are hidden, replaces the selection with a new revision, creates and requests the window.                                    |
| `profile_window_status`                                                 | `{requested, visible, ready, game_active, hide_names, selection, favorites, favorites_max, errors}`. While names are hidden it closes the window, forgets the character and lists no saved one. |
| `profile_window_ready` / `_hide`                                        | The page reports its first render / Close, Escape, Alt+F4 hide it and give AION back the foreground the open took.                                                                              |
| `profile_window_focus`                                                  | The refused-foreground notice's button: asks Windows again, from that click, to put the window in front.                                                                                        |
| `profile_character(serverId, name, lang, refresh?)`                     | Identity, sheet and equipment: `{identity, info, info_error, equipment, equipment_error, cached, fetched_ms}`. Either half may fail alone.                                                      |
| `profile_item(…, characterId, itemId, slotPos, enchantLevel, refresh?)` | One equipped item as the character has it.                                                                                                                                                      |
| `profile_board(…, characterId, boardId, refresh?)`                      | One Daevanion board.                                                                                                                                                                            |
| `profile_favorite_set(serverId, name, saved)`                           | Saves or forgets one exact character; answers with the window status.                                                                                                                           |
| `shugo_copy_profile_link(serverId, name)`                               | Builds the Shugo.gg profile address with the same builder as `shugo_open_profile`, copies it with the native clipboard and returns it. Refused while names are hidden.                          |

Profile commands reject with `{kind, message, retry_after_s}` objects. The page keeps the
selection it was given until a new revision arrives, so status polls never start a lookup;
answers for an earlier character or language are dropped
(`hooks/useCharacterProfile.ts`). Requests run when the window opens a character, on
Refresh, when an item or board is shown, and for the open boards while a skill's detail is
shown; nothing polls the service. Each sheet answer starts a new set of detail requests:
after a Refresh, the open item (followed by its slot), the shown board and an open skill's
boards are read again with `refresh` (past native's cache) without another click, while the
previous details stay until the refreshed sheet arrives. An answer from before the Refresh
can neither land nor end a newer request.

### Foreground and the game's mouse

AION keeps the mouse in the middle of the screen while it is the foreground window, so an
in-game window that never activates (`no_activate`, every other overlay) cannot be used with
the mouse while the game holds it. The profile is the one window that takes the foreground.
It is built focusable and its guard uses `no_activate::Activation::OnClick`: the guard still
runs its moves and resizes with `SWP_NOACTIVATE`, but answers `WM_MOUSEACTIVATE` as any
window does and keeps `WS_EX_NOACTIVATE` off. A click on it activates it like an ordinary
dialog; a show by the focus gate never does. The lease follows these steps
(`src-tauri/src/profile_focus.rs`, run by `profile_window::sync` on the main thread with no
lock held across a Win32 call):

- **One request per open.** Each `profile_window_open` (the user's click on a profile mark,
  or a saved character opened from the window) owes its revision one
  [`SetForegroundWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow),
  made the first time the window is shown for it, within 2 s of the open. The documentation
  names `SetForegroundWindow` as the way to activate a `WS_EX_NOACTIVATE` window and lets a
  process take the foreground only when, among other cases, it received the last input, so
  it is asked for at once and once only. A show by the focus gate (returning to the game
  later) or a status poll never asks.
- **Refused.** When Windows keeps the game in front, the status reports
  `focus.state: "denied"` for that revision and the window shows a notice with **Use this
  window**; that button's click lets `profile_window_focus` ask once more, and any other
  click on the window activates it. Nothing retries by itself.
- **Clicks.** When a click makes the shown profile the foreground window outside a grant
  (after a refusal, Alt+Tab or a click on the game), the next focus tick holds the lease
  as a grant would (`granted`), with the same one cursor check. Its window to return to is
  the AION window last seen in the foreground while the profile was shown; hiding the
  window forgets it.
- **Cursor.** A game releases its cursor confinement when it loses the foreground. If one
  is still in place a focus tick after the grant, while the profile still holds the
  foreground, it is released once with
  [`ClipCursor(NULL)`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-clipcursor).
  The app never moves the cursor, repeats the release, restores an old rectangle, sends
  input, or reads or writes the game.
- **Leaving.** Once the foreground goes anywhere else (Alt+Tab, a click on the game or
  another app) the lease is over (`left`) and the profile never takes it back by itself;
  only the user's next click on it does.
- **Restore.** Close, Escape and Alt+F4 give the foreground back to the AION window it was
  taken from (or, after a click, the one last seen), before the window hides, only while the profile still holds it and that
  window is a live, unminimized window of a running AION. Hiding names drops the lease
  without restoring.

Grants, refusals, cursor releases and restores are written to the diagnostics log
(source `profile-window`). While the profile is in front, AION is a background window for
its own audio rule. Whether AION stops recentring the mouse once it loses the foreground can
only be checked in the real game (see [Verification limits](#verification-limits)).

## Item details

Hovering a slot (weapons, armor, accessories, runes, pet and wings on Equipment, arcana on
Arcana, wing appearance and appearance items on Cosmetics) for 250 ms, or focusing it, opens a `HoverPopover` with its full
detail: the same `ItemDetailView` a pinned slot shows. An equipped item is read when its
popover opens, through the same detail run and native cache as a pinned one (each slot
once; two copies of one ring are two slots), and again with `refresh` after a Refresh; a
slot whose read failed waits for its **Try again** instead of being read again on hover.
Moving to another slot swaps the popover after 150 ms, so a sweep across the list reads
nothing. Pets, wings and appearances show what the equipment answer says and a note that the
service publishes nothing more; nothing is requested for them. The pointer can cross into
the popover, scroll it and use its buttons; it closes when the pointer leaves both, when
focus leaves both, on Escape (before Escape closes a pinned detail or the window), when the
list scrolls and when the slot leaves the page. Clicking or tapping a slot still pins the
detail beside the list, which is optional; touch never opens the popover.

## Arcana

The Arcana tab (Lucide card glyph) draws the five arcana slots as portrait cards in the
game's arrangement: Arcana 1, 3 and 4 on top, 2 and 5 below between them, each slightly
tilted, never overlapping. A card is the slot's original art in a frame edged by its grade,
the enchant level as a coin on its lower edge (`+0` included), and its name and slot (with
the category once its detail is read). NCSOFT publishes the card art only as a square
512 × 512 image (`Icon_Arcana_Card_*`), so the card shows it whole above the name plate;
it is never cropped or stretched into a taller picture, and nothing is drawn in its place.
A slot without a card stays as a dashed outline named `Empty slot`; a slot outside the
five shows after them. Hovering, focusing, pinning, retrying and Refresh work as in
[Item details](#item-details): every card opens the same `ItemDetailView`.

Opening the tab reads the details of the equipped cards (at most five) through the same
detail run and native cache, each once per sheet and again with `refresh` after a
Refresh; nothing else is read or polled. Beside the cards (below them in a narrow body, or
when a detail is pinned) **Equipped effects** totals what those official details say. The
panel scrolls on its own within the tab's height, so a long list never moves or scrolls
the cards; stacked below them it keeps the rest of the tab, at least a short list's
height, and the tab scrolls only when the window is shorter than that:

- Main stats by stat id and unit: a plain line adds its value plus its enchant bonus
  (`Time [Siel]` `20` and `3` → 23, the game's own total); a breakthrough line adds its
  bonus. A rolled range, a worded value or a value and bonus in different units is not
  summed, and a percentage never adds to a flat amount.
- Skill options by skill id, their levels summed (`Lv. +7`); a skill sent without a level
  has none shown. Which specialty a level goes to is not inferred.
- **Set effects** once per official set id, however many cards belong to it. The worn count
  is the service's `equippedCount`; only when it sends none does the count of read cards
  stand in, worded `At least N pieces worn`. A bonus is active when the count reaches its
  piece count.

Only answered details count. While any card is unread or failed the panel says
`Partial: N of 5 cards read`; a failed card is marked on the card and in its label, and the
panel's **Try again** reads the failed cards again past the cache. A card not read adds
nothing, never a zero. `model.arcanaEffects` holds these rules.

## Compatibility inventory

Reference: the public profile at `shugo.gg/character/global/la-triniel/foxyyyynm`, inspected
2026-11-04 (production bundle `main-DtWCgprn.js`), and the official character page
(`aion2.plaync.com/en-us/characters`, bundle `characters/js/index.js`, whose item schema
lists every detail field). This inventory maps behaviour; no website code or design was
copied.

| Requirement                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                     | Implementation                                                                                                                                                                                | Tests                                                                                                                                                                              | Status                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Open from every existing profile action, keeping placement and the locked meter's hit regions                                                                                                                                                                                                                                                                                         | Existing link integration                                                                                                    | `OverlayApp`, `App`, `DetailsApp` call `openProfileWindow`; `ProfileLink` shows the Lucide person-search glyph labelled `View <name>'s character profile`                                     | `OverlayApp.test` (crowded locked meter, opens the window not the browser), `DpsOverlay.profiles`, `LiveMeter`, `ReportView`                                                       | Done                                                                    |
| Exact identity, id encoding, region                                                                                                                                                                                                                                                                                                                                                   | Official search fixture                                                                                                      | `profile_api.rs` `exact_match`, `percent_decode`, `character_query`                                                                                                                           | Rust `the_exact_name_and_server_win…`, `…decoded_once_and_query_encoded_once`                                                                                                      | Done                                                                    |
| Header: portrait, name, server, level, class, race, title, Combat Power, item level, freshness                                                                                                                                                                                                                                                                                        | Official sheet                                                                                                               | `CharacterProfile` header and caption state                                                                                                                                                   | `CharacterProfile.test`                                                                                                                                                            | Done                                                                    |
| Equipped titles with effects                                                                                                                                                                                                                                                                                                                                                          | `title.titleList`                                                                                                            | Header chips with a hover/focus card; Stats tab cards                                                                                                                                         | `profileNormalize.test`, `CharacterProfile.test`                                                                                                                                   | Done                                                                    |
| Rankings                                                                                                                                                                                                                                                                                                                                                                              | `ranking.rankingList` (null for the sample)                                                                                  | Shown as labelled facts when present                                                                                                                                                          | `profileNormalize.test` (null stays null)                                                                                                                                          | Done; no non-null sample to verify layout                               |
| Refresh, close, Open in Shugo.gg                                                                                                                                                                                                                                                                                                                                                      | Website header actions                                                                                                       | Caption buttons                                                                                                                                                                               | `CharacterProfile.test`, `ProfileApp.test`                                                                                                                                         | Done                                                                    |
| Share: copy the character's profile link                                                                                                                                                                                                                                                                                                                                              | Website Share copies the character URL                                                                                       | Share menu in the header, Copy profile link: native `shugo_copy_profile_link` (the existing URL builder, native clipboard); Copy summary kept as a second item; localized feedback and errors | Rust `shugo` tests, `CharacterProfile.test`, `ProfileApp.test` (success and failure)                                                                                               | Done                                                                    |
| Favourites (the website keeps up to 50 in the browser, no account needed)                                                                                                                                                                                                                                                                                                             | Website header star and saved list (FAQ: browser-local, up to 50)                                                            | Save star toggle in the header, Saved characters menu in the caption, saved list in the empty window; native store of 50 exact name/server pairs                                              | Rust `profile_favorites` (reload, bound, failed write, tampered file), `CharacterProfile.test`, `ProfileApp.test` (native answer over a stale poll, refusal, reopen, hidden names) | Done; kept by this app, not shared with the website's browser storage   |
| Equipment groups, every slot, pet, wings, wing appearance; arcana on their own tab                                                                                                                                                                                                                                                                                                    | Official equipment fixture                                                                                                   | `EquipmentTab`, `ArcanaTab` (five-card layout, equipped and set effects), `model.equipmentGroups`, `model.arcanaEffects`                                                                      | `model.test`, `CharacterProfile.test`, `ProfileItemHover.test`                                                                                                                     | Done                                                                    |
| Item detail: level and bonus, enchant and breakthrough, race, classes, equip level, main stats with range and enchant bonus, breakthrough bonuses, soul binding, additional stats (count, random), skill options, manastones or soul stones with empty slots, godstones, set pieces and bonuses, description, duration, cooldown, appearance, sources, handling flags, unknown fields | Official item fixtures and the official item schema                                                                          | `ItemDetailView`, `normalizeItem` (unknown fields listed under "More from the service")                                                                                                       | `profileNormalize.test`, `CharacterProfile.test`                                                                                                                                   | Done; godstone contents not present in any sample (slot count verified) |
| Rich hover and pinned, closable detail inside the window, keyboard reachable                                                                                                                                                                                                                                                                                                          | Website tooltips                                                                                                             | `HoverPopover` with the full detail on hover/focus, read lazily; choosing pins it beside the list or as a sheet in narrow windows; Escape closes the popover, then the detail                 | `CharacterProfile.test`, `ProfileItemHover.test`, `HoverPopover.test`                                                                                                              | Done                                                                    |
| Pet, wing and appearance details                                                                                                                                                                                                                                                                                                                                                      | Official item endpoint answers 404 for them; the item dictionary needs a signed-in session                                   | Official list facts and a written note                                                                                                                                                        | `CharacterProfile.test`                                                                                                                                                            | Limited by source                                                       |
| Skills: active, passive, stigma (slotted, learned, not learned), level, unlock level                                                                                                                                                                                                                                                                                                  | Official `skillList` (`Dp` = stigma)                                                                                         | `SkillsTab`, `model.skillGroups`                                                                                                                                                              | `model.test`, `CharacterProfile.test`                                                                                                                                              | Done                                                                    |
| Skill level bonuses from Daevanion boards and item options                                                                                                                                                                                                                                                                                                                            | Official `openSkillEffectList` and item sub-skills                                                                           | `model.skillBonuses`; open boards read while a skill's detail is open and again after Refresh, with a reading state                                                                           | `model.test`, `CharacterProfile.test`                                                                                                                                              | Done                                                                    |
| Skill descriptions, cost, cooldown, cast time, range, weapon, traits, possible specialties                                                                                                                                                                                                                                                                                            | Not published by any official endpoint (see [Skills](#skills)); the bundled `catalogue.json` has names only                  | The skill detail names the missing fields and their reason; nothing is filled in                                                                                                              | `CharacterProfile.test`                                                                                                                                                            | Not available from the official source                                  |
| Equipped specialization                                                                                                                                                                                                                                                                                                                                                               | Not exposed by the official service                                                                                          | The detail states the choice is not published                                                                                                                                                 | `CharacterProfile.test`                                                                                                                                                            | Not available; never inferred                                           |
| Profile data only from NCSOFT                                                                                                                                                                                                                                                                                                                                                         | User requirement                                                                                                             | `profile_api.rs` `DATA_HOSTS` checked in `get_json`; nine `profile_*` commands                                                                                                                | Rust `every_profile_read_goes_only_to_the_official_hosts`, `any_other_address_is_refused_before_the_network`; `profile.test` (commands of the service and the mock)                | Done                                                                    |
| Daevanion: six boards, counts, locked board, nodes at row/column, open state, node effects, opens at a readable 36 px cell centred on the start node (fitted when the whole board is that large), pan, zoom, fit, full size, keyboard, active effects grouped (active/passive skill upgrades, stat bonuses)                                                                           | Official board fixtures                                                                                                      | `DaevanionTab`, `model.boardSkillEffects`, `model.nearestNode`                                                                                                                                | `profileNormalize.test`, `model.test`, `CharacterProfile.test`                                                                                                                     | Done                                                                    |
| Original node symbols                                                                                                                                                                                                                                                                                                                                                                 | Official character page's `board_icon_<grade>[_open]` and `board_icon_start_<class>`; the service's node icons answer 404    | Bundled originals (see Game artwork): grade art closed or open, closed at half opacity, the class start node; written initial if art is missing; key of the grades shown                      | `daevanionArt.test`, `CharacterProfile.test`, `check:art`                                                                                                                          | Done                                                                    |
| Stats: base and divine with effects, the game's wheel (original emblems, its places) and text                                                                                                                                                                                                                                                                                         | Official `statList`; emblems from NCSOFT's character page ([artwork](GAME_ARTWORK.md#character-profile-artwork))             | `StatsTab` wheel (default) and text; a stat left out is marked, never 0                                                                                                                       | `profileNormalize.test`, `CharacterProfile.test`, `statArt.test`                                                                                                                   | Done                                                                    |
| Stat sources                                                                                                                                                                                                                                                                                                                                                                          | Titles and board stat effects are explicit in official answers                                                               | Titles (equipped and owned effects), Daevanion stat bonuses per read board, "Read them" for unread boards                                                                                     | `CharacterProfile.test`                                                                                                                                                            | Done                                                                    |
| Shugo "Additional Stats (BETA)" combined combat sheet                                                                                                                                                                                                                                                                                                                                 | Requires Discord sign-in on Shugo; its output was not available to inspect; the official service publishes no combined sheet | A written note; no totals computed                                                                                                                                                            | `CharacterProfile.test`                                                                                                                                                            | Inaccessible authenticated feature; not reproduced                      |
| Combat sheet under the game's wheel (attack, defense, accuracy, evasion, critical hit and resist, HP, MP, combat and move speed)                                                                                                                                                                                                                                                      | Not in any official answer; equipment, titles and boards are partial sources                                                 | The written note under the tab; no total computed, summed or borrowed from the meter                                                                                                          | `CharacterProfile.test`                                                                                                                                                            | Not available; never inferred                                           |
| Cosmetics: every appearance slot, the same earrings twice, wing appearance                                                                                                                                                                                                                                                                                                            | Official `skinList`, `wingSkin`                                                                                              | `CosmeticsTab`                                                                                                                                                                                | `profileNormalize.test`, `CharacterProfile.test`                                                                                                                                   | Done                                                                    |
| Loading, not found, private, 429 with wait, failures, partial failure, retry                                                                                                                                                                                                                                                                                                          | Status codes; scripted transport                                                                                             | `ProfileError` kinds; `SheetError`, `ErrorLine`, countdown                                                                                                                                    | Rust error tests, `CharacterProfile.test`                                                                                                                                          | Done; 451 and 429 bodies not observed live                              |
| Stale answers after another open                                                                                                                                                                                                                                                                                                                                                      | Native revision                                                                                                              | `ProfileApp` selection by revision; `useCharacterProfile` generations and per-sheet detail runs (open details read again after Refresh)                                                       | `useCharacterProfile.test`, `ProfileApp.test`                                                                                                                                      | Done                                                                    |
| Hidden names                                                                                                                                                                                                                                                                                                                                                                          | Settings `hide_names`                                                                                                        | Entry points hidden (existing); native applies the saved setting at once, refuses opens and forgets the selection; window shows a privacy state                                               | Rust `hidden_names_close…`, `hiding_names_takes_effect_before_any_poll…`, `ProfileApp.test`, `CharacterProfile.test`                                                               | Done                                                                    |
| Original artwork only, bounded                                                                                                                                                                                                                                                                                                                                                        | CSP blocks remote images                                                                                                     | `profile-art` scheme                                                                                                                                                                          | Rust `artwork_keys_map_only_to_official_files`, `profile.test`                                                                                                                     | Done                                                                    |
| English and Portuguese                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                                            | `profile` namespace in both languages; `lang` follows the app                                                                                                                                 | `catalogs.test`, `check:i18n`                                                                                                                                                      | Done                                                                    |
| Website navigation, ads, Discord sign-in, class build planner                                                                                                                                                                                                                                                                                                                         | Outside the profile                                                                                                          | Not reproduced                                                                                                                                                                                | —                                                                                                                                                                                  | Out of scope                                                            |

## Verification limits

- Skill text, numbers and specialties are not shown because no official endpoint publishes
  them (see [Skills](#skills)); the search of the official site's endpoints was bounded to
  its characters bundle and a handful of probes.
- The new native window cannot be exercised in the running Dev session: Rust changes load
  only after the user quits and restarts Dev. The page was verified in the browser preview
  with the recorded official answers (`?view=profile&mock`; `?mock=profile-private`,
  `profile-busy`, `profile-missing`, `profile-partial` preview the failures).
- `cargo test -p aion-companion -- --ignored the_public_official_profile` reads the real
  service through the native client.
- The foreground lease, including click reacquisition and its window to return to, is
  covered by `profile_focus` state tests and a hidden-window harness that never activates
  anything; `no_activate` tests check on real hidden windows that the profile's guard
  lets a click activate it, keeps `WS_EX_NOACTIVATE` off and still runs moves, while every
  other overlay's guard keeps refusing; the real request, refusal, cursor release and
  restore run only in the native app. Whether AION stops recentring the mouse once the
  profile is in front must be confirmed in the game after the user quits and restarts Dev.
- Keyboard input reaches the profile while it holds the foreground (after an open, a click
  on it, or **Use this window**). Whether a click on the profile frees the mouse while the
  game is in front must also be confirmed in the game after a Dev restart.
