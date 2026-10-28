# Native combat report diagnostics

Render a saved native combat log or active checkpoint through the production
meter aggregation without starting capture or opening a window:

```bash
bash dev.sh exec -- cargo run --locked -p companion-core --example combat_report -- /path/to/native-log.json
```

Append `--party-only` to include only actors marked local or party. The helper
counts all targets by default. Append `--boss-only` to select boss/training-dummy
targets when present, falling back to all targets otherwise. Output includes the selected filters, encounter duration,
player totals, encounter DPS, active DPS, skill totals and coverage. It requires
a version 1 native combat envelope and rejects input larger than 128 MiB.

This renders the log as captured; it does not extend an active checkpoint's
duration to the current wall clock. A checkpoint is written about every five
seconds, so it is not a synchronized observation of the live overlay. A source
build also does not establish which revision a separate installed binary uses.
Skill names may be numeric because this helper uses the empty local catalogue;
damage aggregation uses the log's recorded actor and target classifications.

Live packet observations use Npcap timestamps mapped once onto the capture
session's clock. Subsequent packet intervals retain the driver's millisecond
differences rather than being clipped to the separately rounded processing
clock. Wall-clock processing jitter must not change the DPS denominator.
