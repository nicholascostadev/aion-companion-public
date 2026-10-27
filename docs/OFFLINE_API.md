# Offline combat expansion contract

Combat storage and features are local. This API has no accounts, uploads,
community leaderboards, external timer integrations or telemetry. The desktop
launcher and updater have separate lifecycle responsibilities.

## Native commands

- `offline_status()` -> `{ settings, report, library_count, trackers, alerts, catalogue, capabilities, error }` with bounded full live detail
- `offline_live_status()` -> the same envelope with compact live aggregates, omitting timeline detail
- `offline_configure({settings})` -> validated merged settings object, saved atomically
- `offline_positions({presetId,positions:[{bar_id,x,y}]})` -> atomically merges tracker coordinates into current settings without overwriting another window's edits
- `offline_logs({query})` -> array of log metadata. Query supports `search`, `boss`, `zone_id`, `run_id`, `from_ms`, `to_ms`, `sort` (`newest`, `damage`, `dps`), `limit`, `offset`.
- `offline_log({id,bossOnly?})` -> full combat report; `bossOnly:true` selects the party-only meter view and automatically counts boss/training-dummy damage when those targets exist, otherwise ordinary encounter damage. Omitted/false preserves all-target, all-actor analysis.
- `offline_inspect({id})` -> complete current/saved report for exactly that encounter, without live detail clipping
- `offline_log_rename({id,label})` -> metadata
- `offline_log_delete({ids})` -> deleted count; only selected local IDs, no arbitrary paths
- `offline_export({id})` -> path of an original-format local JSON export
- `offline_catalogue_import({json})` -> catalogue summary. JSON `{skills:[{id,name,class?,cooldown_ms?,specialties?:[{slot,name,description}]}],npcs:[{id,name,boss?,dummy?,berserk_seconds?}]}`
- `offline_summary({id,multiline})` -> clipboard-ready text; null id means live report
- `offline_copy_text({text})` -> copies up to 1 MiB through the native Windows clipboard without moving keyboard focus
- `offline_action({action,summary?})` -> status; actions `save`, `reset`, `clear`, `open_data_folder`; `summary:true` requests compact aggregates, default full for existing callers

## Report

`{id,label,started_ms,duration_ms,end_reason,zone_id,run_id,party_id,players,targets,events,buffs,hp,highlights,warnings,coverage}`.
Optional/unknown facts are null, never invented. Full reports add
`detail_level:"full"`, `event_count`, `events_truncated` and
`event_window_start_ms`. Live status limits event detail to the latest 25,000
observations; its player totals and buff/HP spans still use the full encounter.
Saved/inspected reports preserve every recorded event.

Live meter reports automatically count only boss/training-dummy damage when the
encounter contains those targets; otherwise they count ordinary encounter damage.
The saved meter requests `bossOnly:true` for the same policy. Player totals, DPS
and skills share that native filter. Raw events and target observations stay intact
for complete inspection.

Both live and saved meters rank only the observed local player and party members.
The local player remains eligible when solo. Outsiders' hits on the same target
stay in raw logs but are excluded from ranked player damage, skills and damage shares.
The legacy `party_only` setting remains accepted for compatibility; meter party
filtering is always enabled.

An identified boss's first positive hit from the local player or group starts a
new encounter even when path combat is still active. The preceding ordinary
encounter ends with `end_reason:"boss_pull"` and follows the normal auto-save
preference. The boss's `started_ms`, elapsed duration, DPS denominator and timer
observations therefore begin at that boss engagement; earlier path damage and
time are kept out. Existing boss phases retain their original encounter clock.

Compact reports add `detail_level:"summary"` and the total `event_count`, and
retain players, skills, targets, highlights, coverage and warnings. Their `events`
and `buffs` arrays are deliberately empty. `hp` contains at most two current-HP
observations per target: first/last in the 20 seconds ending at that target's latest
HP observation, sorted by time. These endpoints preserve the meter's HP-slope
estimate without transmitting the full HP timeline. Timeline views must request
full detail. `events_truncated:false` in a summary does not mean that its detail
arrays describe the complete encounter.

Player: `{id,name,class,local,party,server_id,level,gear_score,combat_power,damage,healing,received,deaths,casts,hits,crits,back,front,perfect,double,parry,multi,edps,adps,current_dps,active_pct,skills,targets}`.
Skill: `{id,name,damage,healing,received,casts,hits,crits,back,front,perfect,double,parry,multi,min,max,avg,cast_gap_ms,charge,specialties}`.
Player target: `{id,name,damage,healing,received}`.
Target: `{id,npc_id,name,boss,dummy,current_hp,max_hp,dead,damage,berserk_seconds}`.
Event: `{at_ms,kind,source?,target?,skill?,amount?,hit_count?,critical?,back?,front?,perfect?,double?,parry?,instance?,duration_ms?,current_hp?,max_hp?,zone_id?,charge?}`; kinds damage, heal, cast, buff, buff_end, hp, death, revive, zone, reset, spawn, position. Position may add x/y.
Buff span: `{source,target,skill,instance,start_ms,end_ms}`; still active has null end_ms.
HP sample: `{entity,at_ms,current,max}`.
Highlight: `{kind,player,value,at_ms?}` (biggest_hit,first_hit,healing,healing_received,damage_taken).
Coverage is a set of booleans for observed packet families; UI must explain unavailable data rather than render fabricated rates/readiness.

## Settings

`dps_mode`: encounter/active; `target_mode`: all/boss; `party_only`: boolean;
`idle_timeout_seconds`: 1..600; `dummy_length_seconds`: 0 or 10..300;
`dummy_cooldown_seconds`: 0..300; `auto_save`: boolean; `refresh_ms`: 50..1000;
`opacity`: .15..1; `scale`: .75..2; `fade_after_seconds`: 0..600 (default 30; 0 never fades);
`fade_opacity`: .05..1; `hide_names`, `compact_strip`, `boss_alerts`, `event_alerts`: boolean;
`region`: global/twkr; `locale`: en/pt-BR/pt/de/es/fr/ja/ko/zh/ru;
`hotkeys`: {toggle_overlay,toggle_lock,reset,copy_summary,compact_strip};
`presets`: [{id,name,class,keybind,bars:[{id,name,mode:cooldowns/buffs/both,skills:number[],x,y,icon_size,appearance:icons/bars,hidden}]}];
`active_preset`: string or null;
`alerts`: [{id,name,enabled,at_ms?,repeat_seconds?,lead_seconds,volume,sound}].
Alert times are user-defined local schedules; game observations may supplement them.
Global setting behavior is applied by native backend/overlay host. Frontend may use CSS for scale/opacity/compact and sound playback for due local alerts.

`target_mode` remains accepted for compatibility with saved settings; the meter
ignores it and selects boss or ordinary encounter damage automatically.

The translated interface supports `en` and `pt-BR`. Legacy `pt` resolves to
Brazilian Portuguese; other saved language values remain valid and render with
English fallback. Only an explicit language selection changes that preference.
Language does not change the game region or schedule time zone.

`ui_preferences()` returns `{locale}` from saved settings without building a
combat report. Every successful `offline_configure` emits the app-wide
`ui-preferences-changed` invalidation event after persistence. Consumers reread
preferences rather than treating event payloads as snapshots. Failed saves emit
no event. The native tray, window titles and copied combat summaries use the
same saved preference; recording and log serialization remain language-neutral.

Trackers status: array `{bar_id,skill,name,remaining_ms,kind:cooldown/buff,source,target,estimated,basis}`. Cooldown values need three consistent observed wall-clock slopes or an imported catalogue duration; raw wire units are never silently called milliseconds. Buff durations come from the actual observed effect record, including outside combat.
Alerts status: array `{id,name,due_ms,remaining_ms,sound,volume}`.
Catalogue summary: `{skills,npcs}` counts. Library metadata: `{id,label,started_ms,duration_ms,damage,dps,players,boss,zone_id,run_id,end_reason}`.

Players and skills additionally expose `direct_hits`, `critical_hits_observed`,
`flags_observed`, and `inferred_casts`. Crit-rate denominator is
`critical_hits_observed`; positional-rate denominator is `flags_observed`.
Unavailable flag counters are null. Native cast totals use observed skill-start
notices only and remain null when none were recorded for a skill. `inferred_casts`
is retained for compatibility and is zero for new native reports. `active_pct` uses one-second
bins containing outgoing damage/healing; `activity_method` describes this approximation.
Skill variants remain separate and known charged skills expose their actual release
stage. Numeric variant choices are observed; descriptions need local catalogue data.

For damage-only tables, players and skills expose `damage_hits`, `damage_crits`
and `damage_critical_hits_observed`. Hits count outgoing damage observations,
including periodic ticks; crit numerator/denominator count only direct damage
with an observed crit flag. Healing and incoming damage never contribute to these
fields. `damage_crits` is null when no direct damage crit flags were observed.

## Group additions

`overlay_status.group_enabled` is the user's room automation toggle, independent
of `group_requested` (room eligible and requested) and `group_visible` (actually
shown after focus gating). `group_show` enables automation and checks the latest
room; it cannot force a panel outside a room. `group_hide` disables and hides it.
`group_auto` reports `enabled`, `roster` (`unknown`, `outside`, `room`), `in_room`
and `room_id`. A room requires an active capture and a structured roster with
party ID, lobby title, capacity and at least one member. Unclassified party
members alone are insufficient. Unknown membership hides until fresh evidence
arrives; it does not turn the feature off.

Existing group_status remains authoritative. Members gain `character_id` (string),
`slot`, `group_index`, `ready_observed_ms`; Group status gains `ready_check` with
`active`, `started_ms`, `observed_ms`, `oldest_observed_ms`, `expires_ms`, `source`, `supported`.
The member-ready packet does not prove a timed round's active/start/expiry state;
those fields remain null. `observed_ms` is the last observed member readiness update;
`oldest_observed_ms` gives the age of the oldest state contributing to the summary.
Readiness is tri-state: null = not observed, false = observed not ready, true =
observed ready. Membership/GS/CP flags must never be treated as readiness.
Inspections may expose verified CP/server when present. No applicant automation is
claimed without an observed layout.

## UI ownership

All UI design/layout/interaction implementation is by Opus 5.5 High. Primary agent
owns Rust collection/aggregation/storage/native command implementation and this API.
Existing app, replay, Group automation, borderless windows, focus gating and tray
must continue working. No computer use or game interaction while user plays.
