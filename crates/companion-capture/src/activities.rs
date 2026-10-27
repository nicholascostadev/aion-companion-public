//! Local activity clocks based on the alert calendar and observed bosses.
use chrono::{Datelike, Duration, TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::{json, Value};

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}

/// Global resets are service instants (07:00 UTC), not 04:00 in every display zone.
/// Korea/Taiwan use their own 05:00 operating day. Wednesday starts a weekly cycle.
pub fn cycle_bounds(region: &str, now: u64, weekly: bool) -> (u64, u64) {
    let (zone, hour): (Tz, u32) = match region {
        "kr" => (chrono_tz::Asia::Seoul, 5),
        "tw" => (chrono_tz::Asia::Taipei, 5),
        _ => (chrono_tz::UTC, 7),
    };
    let time = Utc
        .timestamp_millis_opt(now.min(i64::MAX as u64) as i64)
        .single()
        .unwrap_or_else(|| Utc.timestamp_millis_opt(0).single().unwrap())
        .with_timezone(&zone);
    let mut date = time.date_naive();
    if weekly {
        date -= Duration::days(i64::from((date.weekday().num_days_from_monday() + 5) % 7));
    }
    let boundary = |date: chrono::NaiveDate| {
        zone.from_local_datetime(&date.and_hms_opt(hour, 0, 0).unwrap())
            .earliest()
            .unwrap()
    };
    if boundary(date) > time {
        date -= Duration::days(if weekly { 7 } else { 1 });
    }
    let next = date + Duration::days(if weekly { 7 } else { 1 });
    (
        boundary(date).timestamp_millis().max(0) as u64,
        boundary(next).timestamp_millis().max(0) as u64,
    )
}
pub fn resets(alerts: &Value, now: u64) -> Value {
    let region = text(alerts, "effective_region");
    json!({"daily_ms":cycle_bounds(region,now,false).1,"weekly_ms":cycle_bounds(region,now,true).1,
        "timezone":text(alerts,"effective_timezone"),"basis":if ["kr","tw"].contains(&region) {"Service reset: 05:00 local, Wednesday weekly"} else {"Global reset: 07:00 UTC, Wednesday weekly"}})
}

pub fn timers_status(alerts: &Value, now: u64) -> Value {
    let mut rows = Vec::new();
    let entries = list(alerts, "catalogue");
    let rules = list(&alerts["config"], "rules");
    for row in list(alerts, "catalogue_upcoming") {
        let id = text(row, "entry_id");
        let selected = [
            "festival",
            "invasion",
            "rift",
            "watcher-kaira",
            "siege-bosses",
            "guardian-nahma",
            "field-2101074",
            "field-2400800",
            "field-2101131",
            "field-2400853",
            "field-2101120",
            "field-2400855",
            "field-2101122",
            "field-2400854",
        ]
        .contains(&id)
            || rules
                .iter()
                .any(|rule| text(rule, "preset_id") == id && rule["favorite"] == true);
        if !selected {
            continue;
        }
        // Avoid indistinguishable faction variants when the character's faction is known.
        let faction = text(alerts, "effective_faction");
        if ["field-2101131", "field-2101120", "field-2101122"].contains(&id)
            && faction == "asmodian"
            || ["field-2400853", "field-2400855", "field-2400854"].contains(&id)
                && faction == "elyos"
        {
            continue;
        }
        let entry = entries.iter().find(|entry| text(entry, "id") == id);
        let rule = rules
            .iter()
            .find(|rule| text(rule, "preset_id") == id)
            .or_else(|| entry.map(|e| &e["rule"]));
        let duration = rule
            .and_then(|r| r["duration_seconds"].as_u64())
            .unwrap_or(0)
            .saturating_mul(1000);
        let due = row["due_ms"].as_u64();
        let ends = due
            .filter(|_| duration > 0)
            .map(|due| due.saturating_add(duration));
        let observation = list(alerts, "observed")
            .iter()
            .filter(|o| {
                entry.is_some_and(|e| list(e, "members").iter().any(|m| m["id"] == o["npc_id"]))
            })
            .max_by_key(|o| o["observed_ms"].as_u64().unwrap_or(0));
        // A spawn is a local sighting, not a permanent promise that a boss is alive.
        let alive_until = observation
            .filter(|_| alerts["live_observations"] == true)
            .filter(|o| text(o, "state") == "Spawned")
            .and_then(|o| o["observed_ms"].as_u64())
            .filter(|at| *at <= now)
            .map(|at| at.saturating_add(120_000))
            .filter(|until| *until > now);
        let state = if alive_until.is_some() {
            "alive"
        } else {
            text(row, "state")
        };
        rows.push(json!({"id":id,"name":if id=="invasion" {"Dimensional Invasion"} else {text(row,"name")},
            "category":row["category"],"due_ms":due,"ends_ms":alive_until.or(ends),"state":state,
            "estimated":row["estimated"],"basis":if alive_until.is_some(){"Spawn observed locally within the last two minutes"}else{text(row,"basis")},"timezone":row["timezone"]}));
    }
    // User-created schedules are useful activity timers too. They do not require reminders.
    for rule in rules
        .iter()
        .filter(|r| r["preset_id"].is_null() && (r["enabled"] == true || r["favorite"] == true))
    {
        if let Some(row) = list(alerts, "upcoming")
            .iter()
            .find(|r| r["rule_id"] == rule["id"])
        {
            let duration = rule["duration_seconds"]
                .as_u64()
                .unwrap_or(0)
                .saturating_mul(1000);
            let due = row["due_ms"].as_u64();
            let ends = due
                .filter(|_| duration > 0)
                .map(|at| at.saturating_add(duration));
            let state = if due.is_some_and(|at| at <= now) && ends.is_some_and(|at| at > now) {
                "open"
            } else if due.is_some_and(|at| at >= now) {
                "scheduled"
            } else {
                "unknown"
            };
            rows.push(json!({"id":rule["id"],"name":rule["name"],"category":"event","due_ms":row["due_ms"],
                "ends_ms":ends,"state":state,"estimated":row["estimated"],"basis":"Your own schedule","timezone":rule["timezone"]}));
        }
    }
    if !rows
        .iter()
        .any(|r| text(r, "name").eq_ignore_ascii_case("Artifact Siege"))
    {
        rows.push(json!({"id":"artifact-siege","name":"Artifact Siege","category":"event","due_ms":null,"ends_ms":null,"state":"unknown","estimated":false,"basis":"Set an Artifact Siege schedule in Alerts for your service","timezone":null}));
    }
    rows.sort_by_key(|r| {
        (
            if ["alive", "open"].contains(&text(r, "state")) {
                0
            } else {
                1
            },
            r["due_ms"].as_u64().unwrap_or(u64::MAX),
            text(r, "name").to_owned(),
        )
    });
    let region = text(alerts, "effective_region");
    let name = list(alerts, "regions")
        .iter()
        .find(|r| text(r, "id") == region)
        .map(|r| text(r, "name"))
        .unwrap_or("Server clock");
    json!({"now_ms":now,"region":alerts["effective_region"],"region_name":name,"timezone":alerts["effective_timezone"],"clock_ready":alerts["clock_ready"],"clock_estimated":alerts["clock_estimated"],"rows":rows,"resets":resets(alerts,now),"error":alerts["error"]})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(time: &str) -> u64 {
        chrono::DateTime::parse_from_rfc3339(time)
            .unwrap()
            .timestamp_millis() as u64
    }
    #[test]
    fn global_reset_is_one_instant_and_rolls_at_exact_boundary() {
        let before = at("2026-10-21T06:59:59Z");
        let boundary = at("2026-10-21T07:00:00Z");
        for region in ["latam", "na-west", "na-east", "eu", "asia", "global"] {
            assert_eq!(cycle_bounds(region, before, false).1, boundary);
            assert_eq!(cycle_bounds(region, before, true).1, boundary);
            assert_eq!(
                cycle_bounds(region, boundary, true),
                (boundary, at("2026-10-28T07:00:00Z"))
            );
        }
        // The display-zone DST transitions do not move the Global service reset.
        assert_eq!(
            cycle_bounds("eu", at("2026-10-25T06:59:00Z"), false).1,
            at("2026-10-25T07:00:00Z")
        );
        assert_eq!(
            cycle_bounds("na-east", at("2026-11-01T06:59:00Z"), false).1,
            at("2026-11-01T07:00:00Z")
        );
    }
    #[test]
    fn regional_operating_day_does_not_use_global_clock() {
        assert_eq!(
            cycle_bounds("kr", at("2026-10-20T19:59:00Z"), true).1,
            at("2026-10-20T20:00:00Z")
        );
        assert_eq!(
            cycle_bounds("tw", at("2026-10-20T20:59:00Z"), true).1,
            at("2026-10-20T21:00:00Z")
        );
    }
    #[test]
    fn timers_use_existing_calendar_even_when_reminders_are_disabled() {
        let now = at("2026-10-19T12:14:00Z");
        let dashboard = crate::alerts::Alerts::default().status(now);
        let timers = timers_status(&dashboard, now);
        assert!(list(&timers, "rows")
            .iter()
            .any(|r| text(r, "id") == "festival" && r["due_ms"].is_number()));
        let unknown = list(&timers, "rows")
            .iter()
            .find(|r| text(r, "id") == "artifact-siege")
            .unwrap();
        assert_eq!(unknown["state"], "unknown");
        assert!(unknown["due_ms"].is_null());
    }
    #[test]
    fn timers_include_dartan_and_kashapa_without_favorites_for_each_faction() {
        let now = at("2026-10-19T12:14:00Z");
        for (faction, included, excluded) in [
            ("elyos", [2101120, 2101122], [2400855, 2400854]),
            ("asmodian", [2400855, 2400854], [2101120, 2101122]),
        ] {
            let mut dashboard = crate::alerts::Alerts::default().status(now);
            dashboard["effective_faction"] = faction.into();
            let timers = timers_status(&dashboard, now);
            for npc in included {
                let id = format!("field-{npc}");
                let boss = list(&timers, "rows")
                    .iter()
                    .find(|row| text(row, "id") == id)
                    .unwrap();
                assert_eq!(boss["state"], "unknown");
                assert!(boss["due_ms"].is_null());
            }
            for npc in excluded {
                assert!(!list(&timers, "rows")
                    .iter()
                    .any(|row| text(row, "id") == format!("field-{npc}")));
            }
        }
    }
    #[test]
    fn favorite_custom_windows_stay_open_with_notifications_disabled() {
        let now = at("2026-10-19T12:14:00Z");
        let dashboard = json!({"config":{"rules":[{"id":"siege","name":"Artifact Siege","enabled":false,"favorite":true,"preset_id":null,"duration_seconds":1200}]},
            "upcoming":[{"rule_id":"siege","due_ms":now-60000,"state":"disabled","estimated":false}]});
        let timers = timers_status(&dashboard, now);
        assert_eq!(list(&timers, "rows").len(), 1);
        assert_eq!(timers["rows"][0]["state"], "open");
        assert_eq!(timers["rows"][0]["ends_ms"], now + 1140000);
        assert_eq!(
            timers_status(&dashboard, now + 1140000)["rows"][0]["state"],
            "unknown"
        );
    }
    #[test]
    fn alive_requires_a_fresh_local_spawn_and_expires_without_a_defeat() {
        let now = at("2026-10-19T12:00:00Z");
        let mut dashboard = json!({"live_observations":true,"effective_region":"latam","catalogue":[{"id":"field-2101074","members":[{"id":2101074}],"rule":{}}],
            "catalogue_upcoming":[{"entry_id":"field-2101074","name":"Eternal Gartua","category":"field_boss","state":"unknown","due_ms":null,"estimated":false,"basis":"Waiting"}],
            "observed":[{"npc_id":2101074,"state":"Spawned","observed_ms":now}]});
        assert_eq!(timers_status(&dashboard, now)["rows"][0]["state"], "alive");
        assert_eq!(
            timers_status(&dashboard, now + 120000)["rows"][0]["state"],
            "unknown"
        );
        dashboard["live_observations"] = false.into();
        assert_eq!(
            timers_status(&dashboard, now)["rows"][0]["state"],
            "unknown"
        );
    }
}
