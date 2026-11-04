# Combat power updates

The meter reads party CP from the roster and local CP from incoming `56 36`
records. Damage packets do not carry CP. Item level is a separate rating.

An app-owned Global equipment test on 2026-11-03 observed complete 18-byte
records: the two-byte opcode followed by two little-endian u64 values. Removing
one item produced 145988 in the first field; equipping it again produced 164343.
The user confirmed 164343 as the equipped CP. The second field stayed 164343;
its meaning remains unknown and it is not used. The separately reported
2752 → 2647 → 2752 values were confirmed as item level.

The reader requires the exact observed record length, a positive CP within the
same broad sanity bound used by the roster reader, and an identified local
entity. The packet has no entity ID. It never supplies another player's CP.
Updates observed before local identity is known are ignored. Unknown layouts
leave the last supported observation unchanged.

A local update overrides roster/cache values, including decreases, and updates
the remembered profile for the verified server and name. It refreshes the live
report through the existing receive path without requiring another hit. The
connection owns this observation; a character change or connection reset must
not carry it to another character. Saved fights keep their recorded metadata.

The native regression exercises equipment changes without additional damage or
rosters, verifies that the profile follows both increases and decreases, and
checks unchanged damage. Decoder tests cover malformed records, unknown local
identity, other players, reused identities and captured startup context.
