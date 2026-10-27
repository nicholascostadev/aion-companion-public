# Odyle energy protocol research

Inspected on 2026-10-21; a Global login/zone-entry reading was subsequently
validated through this app's own receive-only capture. No downloaded reference
application was executed and no application integration, bridge or importer was
added.

## Conclusion

Published AION 2 source contains a concrete route to automatic Odyle readings:
decode resource-status packets from the game's existing capture stream, including
the initial balance and subsequent changes. Manual entry is not inherently needed.
The first meter implementation used a manual Checklist balance. That was a
limitation of our app, not evidence that the game omits this information.

## Concrete resource record

The clearest inspected implementation is pinned to Waffle Meter commit
`9246bf889ad62609d51a6c1efd631102ec1edcce`.

Its dispatcher registers little-endian opcode numbers `0x610B` and `0x610C`, whose
wire opcode bytes are respectively `0B 61` and `0C 61`. Both invoke the same
resource parser; `0x610B` is marked as a snapshot. The resulting base and bonus
values are passed directly to the state owner. Source:
[dispatcher registrations and resource handler](https://github.com/Waffle-ens/waffle_meter/blob/9246bf889ad62609d51a6c1efd631102ec1edcce/dotnet/src/WaffleMeter.Capture/StreamProcessor.cs#L154).

Inside those packet bodies, the parser recognizes:

```text
<mask> 01 87 93 03 <base varint, when present> <bonus varint, when present>
```

`01` is the resource key; `87 93 03` is its fixed resource group marker. Although
those bytes decode as varint 51591, this source treats them as a resource group,
not the player's actor ID. The mask selects these absolute pool values:

| Mask | Base pool    | Bonus pool    |
| ---- | ------------ | ------------- |
| `00` | 0            | 0             |
| `04` | Next varint  | 0             |
| `08` | 0            | Next varint   |
| `0C` | First varint | Second varint |

An omitted pool is zero, not unchanged. An empty mask is an observed zero
balance, distinct from an unrecognized record. The implementation restricts each
pool to 0–10,000 as a sanity check, not a game cap. Source:
[resource parser](https://github.com/Waffle-ens/waffle_meter/blob/9246bf889ad62609d51a6c1efd631102ec1edcce/dotnet/src/WaffleMeter.Capture/AetherStatusParser.cs#L14).

## Published byte-level evidence

Its tests describe these as real captured records. Examples below omit framing,
opcode and unrelated trailing records:

| Record bytes              | Decoded base | Decoded bonus |
| ------------------------- | ------------ | ------------- |
| `0C 01 87 93 03 5F 98 02` | 95           | 280           |
| `08 01 87 93 03 EB 01`    | 0            | 235           |
| `04 01 87 93 03 78`       | 120          | 0             |
| `00 01 87 93 03`          | 0            | 0             |

A consumable example has bonus 1970 with a trailing +40 change amount; that tail
is not a third pool. Tests also reject another resource key and implausible
values. These are upstream fixtures and assertions, not captures independently
verified here. Source:
[resource parser tests](https://github.com/Waffle-ens/waffle_meter/blob/9246bf889ad62609d51a6c1efd631102ec1edcce/dotnet/tests/WaffleMeter.Capture.Tests/AetherStatusParserTests.cs#L14).

## Initial readings, projections and conflicting evidence

The same project's refill code documents broadcasts at login/zone-in (`610B`)
and when balances change (`610C`). Its timer calculation is for carrying forward
a previously observed balance between sessions; the next live broadcast replaces
the projection. It describes fixed server refill boundaries, rather than a timer
started by manual entry. Its reported timing/caps come from Korean-region
observations and must not be assumed correct for Global. Source:
[refill projection and its limits](https://github.com/Waffle-ens/waffle_meter/blob/9246bf889ad62609d51a6c1efd631102ec1edcce/dotnet/src/WaffleMeter.App.Core/AetherRegen.cs#L1).

A second public Python implementation independently identifies wire opcodes
`0B 61` / `0C 61` and resource key 1, but its older comments/code retain a
different interpretation: a one-value update preserves a previously known base.
It also uses heuristic snapshot searches and a missing-record-to-zero fallback.
That conflicts with the later mask semantics and regression examples above.
Do not combine the two state models or adopt the missing-record fallback.
No license/notice file was found in that repository's recursive tree at inspected
commit `b9ef9b3892f5725b48c783b697e700c6cdbf3017`; source visibility alone does not
establish permission to copy it. Source:
[Python parser and its correction history](https://github.com/gyu98-mun/Aion2_Aether_Monitoring/blob/b9ef9b3892f5725b48c783b697e700c6cdbf3017/aion2_core.py#L100).

Waffle Meter's repository has an MIT license, copyright 2026 TK-open-public.
Copying substantial code requires retaining its notice. This note records
protocol findings; it does not copy an implementation. Source:
[pinned license](https://github.com/Waffle-ens/waffle_meter/blob/9246bf889ad62609d51a6c1efd631102ec1edcce/LICENSE).

## Application follow-up

The independent native reader now lives in `wire/odyle.rs` and is called by the
existing decoder. `live_status.odyle` exposes observed `base`, `bonus` and
`observed_ms`; the meter's existing live poll displays it. Character changes,
disconnects and capture failures invalidate the ephemeral balance, while combat
resets preserve it. Unsupported records remain unknown and supported empty masks
produce zero. The footer no longer reads the manual Checklist estimate.

Regression checks cover the published byte examples, canonical/overflowing
varints, truncated records and bundles, stream synchronization without combat,
absolute pool replacement, character reuse, capture failures and combat reset.
The app-owned Global capture received a 494-byte `0B 61` snapshot at
2026-10-21 23:06:19 UTC. Its Odyle record was `0C 01 87 93 03 0F 93 02`, decoding
as base 15 and bonus 275, exactly matching the user's independently reported
game balance of 15 (+275). Native `live_status.odyle` returned the same pools
with `observed_ms: 1792623979421`. Character identity also became known in that
capture. Only this non-identifying reduced resource record is documented; the
full local diagnostic packet remains outside version control, and temporary
packet sampling was stopped after confirmation.

Consumption, consumables, zero pools and character switching have automated
regression coverage but still need live Global verification. These checks do not validate every regional resource-record variant.
