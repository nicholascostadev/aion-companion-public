# Group overlay protocol evidence

The Group view reads the server's own party roster (`02 97`) independently of combat and character inspections, using the app's own collector.

The roster header contains a party key, a UTF-8 party title, capacity, dungeon ID, leader's database ID, and slot count. Occupied slots carry the database ID (including server ID), UTF-8 nickname, class code, level, gear score, and Combat Power. Variable flags precede a repeated server ID; CP is a little-endian u64 five bytes after that anchor. Observed marker values immediately before CP are `01` through `04`; their precise meaning is not assumed. Ambiguous occupied-member boundaries and incomplete slot boundaries are rejected; equivalent empty-slot padding is accepted. A partial structured roster does not replace the previous complete roster. Zero CP/GS remains unknown.

The party title is displayed as the lobby title. It is not a verified dungeon name. Capacity and leader status come from the header rather than an assumed five-person group. Readiness is tri-state: true (ready), false (not ready), or null (not observed). Joined party members are distinct from pending applicants; opening a profile records an inspection, but automatic pending-applicant tracking is not implemented.

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
