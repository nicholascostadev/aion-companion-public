# Live map position and motion

This document describes the standalone implementation in this repository.
Rendering estimates remain separate from authoritative game observations.

## Position observations

The packet reader accepts validated effect-caster coordinates from buff-add and
renew messages. The native pet collector adopts them as the player's position
only when the caster is the known local player. Finite coordinate checks,
identity, zone, freshness and disconnected-state rules remain authoritative.

The factual buff-caster layout reference is MIT-licensed source:
[Aion2FrameDecoder.cs at e16d35d4f19e19b03b0cb05ab4a1658bb51102a6](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/e16d35d4f19e19b03b0cb05ab4a1658bb51102a6/Client/Aion2/Protocol/Aion2FrameDecoder.cs#L1716).
Its [license](https://github.com/SkeeveAN/Aion-DPS-Meter/blob/e16d35d4f19e19b03b0cb05ab4a1658bb51102a6/LICENSE)
is preserved in [third-party notices](../THIRD_PARTY_NOTICES.txt). The Rust reader
is independently implemented; the reference is not a runtime dependency.

An aim coordinate alone does not establish the player's exact position in every
packet variant. Unsupported ownership and walking-only estimates remain unknown.

## Source boundary

Position collection remains limited to the existing incoming game-owned traffic.
Process-memory scanning, session-key extraction, outgoing packet decryption and
standalone probes are excluded. They must not be added as an automatic fallback.
Read-only access does not establish publisher approval.

The local incoming sample measured 31 validated local fixes over 30 seconds, with
a 999 ms median gap and 1007 ms maximum. This is session evidence, not a guaranteed
protocol rate. The retained implementation does not measure a new position every
game frame. Faster delivery and display smoothing cannot supply missing fixes.

NCSOFT's [AION 2 operation policy](https://www.plaync.com/policy/operation/aion2global/en)
provides sanctions for unauthorized programs. Incoming packet capture also has no
verified publisher approval; excluding process-memory access does not establish ban safety.

## Delivery and presentation

The visible Explore overlay subscribes to native `world-motion-updated` events.
Incoming own-position and context changes wake a bounded publisher, which sends
the latest snapshot outside the capture lock. The listener reads an initial
`world_motion_status` snapshot after registration and resynchronizes periodically.
The existing 250 ms cube-status poll remains the fallback and supplies map context,
cube rows and confirmed distances. Pushes update the marker and following camera
only in the same session, zone and map as the poll. A newer context hides the
marker until the full snapshot catches up; late snapshots cannot rewind it.

Visible maps read `pets_motion` every 150 ms, separately from the slower full pet
collection and preferences read. Presentation reconciles confirmed fixes over a
short interval. Velocity projection uses two confirmed fixes, with a 1.2-second
or 15-metre bound. Stale fixes, map changes, teleports and implausible velocity
reset prediction. Estimates carry a dashed displacement ring and a radar label.

The display marker and follow camera use the same displayed coordinate. Neither
interpolation nor prediction changes native coordinates, timestamps, measured
distances or persisted state. Walking without fresh observations stops at the
prediction bound.

## Map framing

Follow mode starts near 300 metres across. The radar has independent zoom
controls; distant sightings do not force its camera outward. Original map pixels
can be magnified up to four times. Browsing the large map keeps its camera and
selected pet context while new observations arrive.

Original artwork, resource keys and checksums are documented in
[game artwork](GAME_ARTWORK.md) and the manifests under `frontend/src/data`.
Closer zoom changes presentation rather than coordinate accuracy.
