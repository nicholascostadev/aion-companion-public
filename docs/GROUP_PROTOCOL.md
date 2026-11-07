# Group protocol evidence

The party room shown in the DPS meter reads the server's own party roster (`02 97`) independently of combat and character inspections, using the app's own collector.

An app-owned four-member Global roster showed that the repeated server pair before
CP can differ from the home server encoded in a member's database ID. When they
differ, both copies of the pair must agree and pass server validation; the database
ID still supplies the member's profile server. Requiring the pair to equal the home
server rejected the entire roster and left an older three-member snapshot visible.
The anonymized `group-roster-cross-server-anchor.hex` fixture covers that packet,
restoring a fourth member, their readiness update, and rejection of a damaged pair.

A later app-owned five-member dungeon party sent that other server's ID only once,
followed by bytes that are no server ID, as home anchors often are. Rejecting it left
the whole roster unknown, so Party only kept just the local player while the other four
fought beside them. A single other-server copy is now accepted, but only for a member
with no home or repeated anchor: CP bytes can alias one, and two disagreeing server IDs
still reject the member. Weak anchors inside the rejected server, marker and CP
field are excluded, so those bytes cannot be reinterpreted as a single anchor.
The cross-server test derives these layouts from the fixture.

The roster header contains a party key, a UTF-8 party title, capacity, dungeon ID, leader's database ID, and slot count. Occupied slots carry the database ID (including server ID), UTF-8 nickname, class code, level, gear score, and Combat Power. Variable flags precede a repeated server ID; CP is a little-endian u64 five bytes after that anchor. Observed marker values immediately before CP are `01` through `04`; their precise meaning is not assumed. Ambiguous occupied-member boundaries and incomplete slot boundaries are rejected; equivalent empty-slot padding is accepted. A partial structured roster does not replace the previous complete roster. Zero CP/GS remains unknown.

The party title is displayed as the lobby title. It is not a verified dungeon name. Capacity and leader status come from the header rather than an assumed five-person group. Readiness is tri-state: true (ready), false (not ready), or null (not observed). Joined party members are distinct from pending applicants; opening a profile records an inspection, but automatic pending-applicant tracking is not implemented.

### Leader readiness is a game rule, not an observation

The current party leader starts the group rather than accepting readiness, so the meter shows
them as ready whatever their own ready bit says. This is derived in the UI only
(`frontend/src/features/group/model.ts`): native `group_status` still reports the leader's
observed `ready` and `ready_observed_ms` unchanged, and the meter never invents an observation
time for them.

- The member flagged `leader` gets the solid ready tick, worded as ready because they lead,
  even when their bit is `false`, `null` or old. It never fades as old or untimed.
- The caption counts the leader as ready. It shows a count only once another member's
  readiness is observed; a roster where only the leader is known still shows the roster's
  freshness.
- The newest and oldest readiness ages (the "Readiness observed" note and the caption's
  "oldest observation") come from the other members' `ready_observed_ms`, not from
  `ready_check.observed_ms` or `oldest_observed_ms`, which native computes over every member,
  leader included. Other members keep the observed semantics: `null` is unknown, and old or
  untimed states fade and keep the caption from reading as a fresh all-ready group.
- On a leader transfer the rule follows the `leader` flag of the latest roster: the former
  leader shows their own observed bit and age again, and the new leader is ready.

The exact four-byte party-left records `13 92 00 00` and `1d 97 00 00` clear the roster, title, and capacity, while retaining inspection history. Other payloads of those opcodes do not clear it.

Evidence:

- Recorded roster vectors from [SkeeveTV's MIT-licensed SelfCheckAion2](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/648d47bf1f3d68d43e788769acf9464025d440b5/Client/Combat/SelfCheckAion2.cs), retained under `crates/companion-core/tests/fixtures/group-roster-*.hex`. See `THIRD_PARTY_NOTICES` for the license. These include accented names, cross-server members, full groups, and vacant slots.
- Field-layout corroboration: [AION2 DPS Meter protocol parser](https://github.com/cyberbadger6969/aion2-dps-meter/blob/main/src/AionMeter.Core/Protocol/PacketParser.cs) and [A2Tools protocol documentation in its parser](https://github.com/taengu/A2Tools-DPS-Meter/blob/main/src-tauri/src/capture/stream_processor.rs). These projects are GPL-3.0; their implementations have not been copied or linked. The independent Rust decoder uses the wire-field facts and the attributed MIT packet vectors above.

App-owned live evidence captured on 2026-10-19 revealed two incorrect assumptions:

- Requiring marker `04` rejected a complete roster when members with markers `01`
  or `03` joined, leaving the last accepted three-member roster visible.
- The byte immediately after gear score can be the low byte of the repeated server
  ID. Its low bit must not be used as readiness, regardless of member mask `02`.
  Full-roster readiness now remains unknown pending a controlled live toggle.

The anonymized native recording vector `group-roster-live-variants.hex` preserves
all five member layouts and values. Only the room title, names, party key, and
character database IDs were replaced; server IDs and wire layouts are unchanged.
Regression coverage reproduces three-to-four-to-five-member room refreshes.

A later app-owned five-member room also contained marker `02`, plus an occupied
member without the optional long trailer. The anonymized vector
`group-roster-live-marker-two.hex` preserves those layouts; all five members and
their exact CP values must parse. The decoder accepts the four observed markers
without assigning meaning to the marker itself.

## Run state for the meter

The DPS meter opens on the party room, with a Group and DPS switch to its live damage, while
`group_status.preparing` is true: a room roster is observed (see `room` in
[offline API](OFFLINE_API.md)), its header names a dungeon (`dungeon_id`), and no run is
observed (`run.phase` is `unknown` or `outside`). The roster's dungeon field is the
u32 after capacity; every recorded lobby carries one (600011, 600012, 600031, 600092), and
600092 is the same ID the dungeon state record sends for that content. A roster whose
field is zero is not a dungeon group and keeps the fight. Whether ordinary invited
parties always send zero is not yet verified live. The phase is owned by
`offline/run_phase.rs` and comes only from decoded observations:

- **Start.** The dungeon state record (`0x0061`: dungeon ID, then a state byte of at most 16) with any state other than `3` starts a run, or begins a new one for another dungeon
  ID. Repeated states of the same uncleared dungeon (phases, wipes) continue it. Damage,
  DPS, readiness, the party title and the roster's dungeon ID never start a run, so hits
  in the lobby keep the room on screen.
- **Clear.** State `3` for the run's dungeon marks it `cleared`. The meter keeps the
  fight, with its final result, until the player leaves the dungeon.
- **End.** A zone record (`0x2136`) for a zone other than the run's ends it. The run
  belongs to the zone current at its dungeon state; if the instance's zone loads just
  after the state, the first zone change before our group fights is taken as that load
  (once). Our group's damage confirms the zone.
- **Unknown.** After capture starts or reconnects, nothing is known until a zone or
  dungeon state is observed. Unknown is not evidence of a run, so a dungeon group joined
  before the app started prepares. A player who starts the app inside an already running
  dungeon therefore sees the room until the next dungeon state record (a phase or wipe),
  or until leaving. User resets, encounter ends, idle gaps and boss pulls do not change
  the phase.

App-owned saved logs from 2026-11-03/04 support these rules without proving them: within
one visit to dungeon 600092 or 610062, every fight kept one zone and one `run_id`, the
run ID was assigned about a minute before the first fight (so the dungeon state arrives
on entry, before combat), and each re-entry after a clear began a new run in the same
zone. Not yet verified live: the order of the zone and dungeon state records on entry,
the meaning of state values other than `3`, whether a multi-zone dungeon resends its
state in each zone, and what happens on leaving without a clear. If the zone loads first
and the player leaves before anyone fights, the run is kept until the next zone, dungeon
state or reconnect, and the meter keeps the fight. The optional
`--diagnostics-file` records `room`, `dungeon_id`, `run` and `preparing` beside the roster, so a live
session can confirm these transitions.

### Behaviour inventory: from a separate Group window to the room in the meter

Historical baseline: `bfae74a`, before the DPS layout and group integration.

| Behaviour                                                    | Before                                                                                                 | Now                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Where the roster shows                                       | Own `group-overlay` window (`overlay.rs`, `GroupApp`)                                                  | The DPS meter window (`PreparationView`)                              |
| When it shows                                                | Toolbar, Home or tray toggle enabled and a room observed (`group_auto.rs`)                             | Dungeon group with no run observed (native `preparing`), chosen first |
| Run started, during the run                                  | No change                                                                                              | The fight, through pulls, resets, wipes, idle gaps and the clear      |
| Party left, capture stopped or reconnecting                  | Window hidden, toggle kept                                                                             | The fight                                                             |
| Manual control                                               | Toggle, close button, collapse                                                                         | Group and DPS switch in the caption until the run starts (see below)  |
| Roster content                                               | Title, size, leader, class, GS, CP, readiness, notes, find and compare, inspected profiles, average CP | Same                                                                  |
| Size                                                         | Window fitted to the roster (`group_fit`), a raid in two columns                                       | Fits five lines (`overlay_fit`), then scrolls; two columns at 34rem   |
| Lock, hit regions, drag, focus gate, saved position          | The Group window's own                                                                                 | The meter's                                                           |
| Compact strip                                                | Not applicable                                                                                         | Room and DPS show in full; the strip returns with the fight           |
| Saved fight opened from History                              | Not applicable                                                                                         | Closed on any group or run change; the run starts on the live meter   |
| `--group`, tray Group row, `group_show`/`hide`/`ready`/`fit` | Present                                                                                                | Removed; an older native opening `?view=group` draws nothing          |

Acceptance examples, covered by `DpsOverlay.room.test.tsx`, `OverlayApp.room.test.tsx`
(native `group_status` JSON through the Tauri bridge to the rendered meter), the roster
tests and the capture `lib.rs` and `run_phase.rs` tests: a dungeon group joined before
the app started (unknown phase) opens on the room, without a click and despite lobby
hits; DPS shows the live meter with its controls and stays chosen through roster,
readiness and damage polls of the same group; joining another group, or the group forming
for another dungeon, chooses Group again; a dungeon state shows the fight without the
switch; resets, idle and repeated states keep the fight; a clear keeps the fight until a
zone change, then the room returns on Group; leaving the party shows the fight and
rejoining shows the room; a reconnect prepares again; a roster without a dungeon keeps
the fight; an older native without `run` shows the fight.

The switch is the meter's own state, keyed by the preparing group's party and dungeon
(`preparingRoom`): Group is chosen whenever that key appears or changes, and a DPS choice
lasts only while it stays the same.

Existing incremental decoding remains:

- `16 97 | character database ID u64 LE | packed flags u8` updates readiness from
  bit zero. Match the full database ID, including server, rather than the slot or name.
- `0b 97` adds/replaces a member and `1e 97` removes the specified database ID.
- A different party key clears old ready observations. Updates with unknown IDs,
  truncated payloads, and unrelated flag bytes never change another member.

Regression checks assert exact CP/GS values, capacity, leader, server identity,
Unicode names, unknown full-roster readiness, separate incremental ready/not-ready
updates, and rejection of truncated records. The current live observation contained
24 full roster records and no `16 97` updates. A controlled live ready toggle is
still required to identify current full-roster readiness; these tests do not prove
that live readiness or applicant handling is complete.

When explicitly launched with `--diagnostics-file`, local diagnostic output includes the decoded roster and, if its layout is unsupported, at most one roster frame of 8 KiB or less as hex. This evidence helps update the decoder without asking the player to transcribe character fields. It is not exposed by the Group polling API or uploaded anywhere.

Development builds additionally attach `protocol_diagnostic` to `group_status`.
It counts full roster and readiness records since the current capture connection
began, retaining the latest full roster of at most 8 KiB, including accepted
rosters so a later controlled toggle can be compared. It also retains the latest readiness record's timestamp, length, result
(`applied`, `unknown_member`, or `unsupported_length`) and at most 64 bytes as hex.
The optional diagnostics file includes the same evidence. Stable Group polling
does not expose these records. Unknown IDs and unsupported lengths remain
uninterpreted; a diagnostic never changes a member's readiness.

Accessing the development/opt-in diagnostic API also enables a volatile incoming
message trace for the capture lifetime. It retains at most 256 records, at most
four distinct payloads per opcode, and only records of 2–128 bytes. This permits
identifying a different readiness opcode when a controlled toggle produces no
roster refresh or `16 97` record. Capture reconnects clear the records. Normal
stable polling neither enables nor exposes this trace; nothing is uploaded or
written to disk automatically.

Explicit identity diagnostics can widen this same opt-in sample to 8 KiB per
record, with a 1 MiB hex budget. See [local identity research](IDENTITY_PROTOCOL.md)
for the limits, capture/replay commands and attribute fallback evidence.
