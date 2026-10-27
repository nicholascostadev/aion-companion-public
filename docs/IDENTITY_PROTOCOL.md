# Local character identity research

The decoder accepts a validated `33 36` self-identity record, either directly or
embedded in a supported non-combat notice. A guarded fallback uses repeated
`4a 36` private attribute updates plus an observed name/server binding. A party
roster or another player's cast is not proof of local identity.

Starting capture after the identity record was sent leaves local identity
unknown until a self record or the fallback evidence arrives. Capture restarts
and game connection changes clear both bindings and fallback evidence.

## Attribute fallback evidence and limits

An app-owned Global session on 2026-10-20 reproduced unknown local identity with
active traffic, no drops or gaps, and zero self records. The player confirmed
their character name as experimental ground truth. A two-minute sample retained
8,414 messages, including casts from other entities and a 3,194-byte inspection
response for another player. All 153 observed `4a 36` records named the confirmed
local entity, including during that inspection. The alternative is inferred from
this controlled session; validation across other classes/regions remains needed.

A subsequent fresh live collector verified the implementation: it initially
remained unresolved while idle, then identified the player's correct entity,
name and server from ordinary gameplay through `private_attributes`, with zero
self-identity records, no packet drops/gaps and no teleport. This validates the
fallback live for this Global character as well as through recorded replay.

The observed layout is `4a 36 | entity varint | count u8 | count * (field u16 LE,
value u32 LE) | eight zero bytes`. Counts 0, 2, 3 and 8 occurred. The parser bounds
the count to 64 and rejects duplicate/zero fields, invalid IDs, truncation,
extra bytes and unfamiliar trailers. Empty updates alone never establish identity.

Two valid records for the same entity, including one nonempty update, are
required. The entity must also have an observed name and server, in either arrival
order. The existing `04 8d` name-binding record carries the server u16 immediately
before the name; it now retains that field. An unknown server leaves the fallback
unresolved. Neither a remembered nickname nor class/skill matching selects an ID.
An idle client can send only empty updates and no name binding, so a new capture
may still wait for ordinary gameplay traffic. The fallback removes the need to
change zones; it does not guarantee immediate identification while idle.

Two different attribute entity IDs disable the fallback for the connection and
revoke a binding established through it. A complete self record remains
authoritative and can resolve such a conflict. Diagnostics report
`local_identity_source` as `self_record` or `private_attributes`.

`local-attribute-identity.hex` is an anonymized minimal three-record regression
vector from this app's sample. It contains the attribute update, an empty update,
and the name/server binding. It requires no login, teleport, or inspection record.

## Local diagnostics

`LiveCapture::identity_diagnostic()` explicitly enables a volatile incoming
message sample on the existing collector. Normal stable polling does not enable
it. It retains complete decoded records of 2–8192 bytes, at most four distinct
payloads per opcode and 256 records overall, with at most 1 MiB of hex text.
The group diagnostic alone retains its existing 128-byte record limit.
Compressed bundles are sampled after normal decompression. No outgoing traffic,
game memory, or additional game requests are involved.

This is a sample, not a complete packet recording. Repeated identical payloads
are replaced with their latest timestamp; busy opcodes and messages larger than
8 KiB can be absent. A missing record in the sample does not prove that the
server never sent it. Capture counters and the dedicated self-record count must
be considered separately.

For the desktop app's `--diagnostics-file` mode, creating an adjacent file with
the `.stop` extension ends diagnostic output and clears the widened sample.
Capture, the detected character and combat state continue. Remove that marker
before explicitly starting another diagnostic session with the same path.

Identity output includes `self_records`, `last_self_header` (at most 160 bytes),
and `last_self_outcome`. An absent outcome means no supported self record was
observed. Otherwise it reports acceptance or rejection at the entity ID, masks,
name, server, class, profile tag, or level check. These diagnostics do not relax
the self-record validation rules.

## Capture and replay

Save and quit the running Companion through its normal lifecycle before using
the capture-only probe; do not run two collectors. Keep the game open in the
same area. Put output under ignored `.tools/` and use a fresh destination:

```bash
bash dev.sh exec -- cargo run --locked -p companion-capture --example identity_probe -- .tools/identity-session.json 120
```

The probe writes the latest status to the supplied JSON path and appends fresh
sampled records to the adjacent `.identity.jsonl` file. Journal creation fails
if that file already exists. Duration is bounded to 300 seconds and the journal
to 16 MiB. Capture is stopped when sampling finishes, including on write errors.
Resume Companion after the probe exits.

Open/close the character panel and use distinguishable skills with recorded
timestamps. Compare idle periods and nearby players, including players of the
same class. Confirm the character name directly with the player as experimental
ground truth; do not turn that name into an automatic detection rule.

Replay the app's own sample through the normal decoder, optionally asserting
the expected local character name:

```bash
bash dev.sh exec -- cargo run --locked -p companion-core --example replay_identity -- .tools/identity-session.identity.jsonl ExpectedName
```

The replay validates the versioned native diagnostic format and frame metadata.
It exits unsuccessfully if the expected local name is unresolved or differs.
The summary omits raw message bodies. Keep raw captures and character data local
and out of commits; retain only anonymized minimal regression vectors for any
verified protocol addition.
