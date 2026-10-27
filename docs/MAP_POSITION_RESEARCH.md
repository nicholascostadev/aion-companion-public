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

## Delivery and presentation

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
