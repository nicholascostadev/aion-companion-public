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

/// One timer row for a bundled catalogue entry: its calendar or observed due time, an
/// opening's end, or a fresh local sighting. `map_id` names the map of a field boss.
fn catalogue_row(alerts: &Value, row: &Value, now: u64) -> Value {
    let id = text(row, "entry_id");
    let entry = list(alerts, "catalogue")
        .iter()
        .find(|entry| text(entry, "id") == id);
    let rule = list(&alerts["config"], "rules")
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
    json!({"id":id,"name":if id=="invasion" {"Dimensional Invasion"} else {text(row,"name")},
        "category":row["category"],"due_ms":due,"ends_ms":alive_until.or(ends),"state":state,
        "estimated":row["estimated"],"basis":if alive_until.is_some(){"Spawn observed locally within the last two minutes"}else{text(row,"basis")},"timezone":row["timezone"],
        "map_id":entry.and_then(|e| e["map_id"].as_u64())})
}

/// The name of a game map that has bundled bosses; None for any other area.
fn map_name(id: u64) -> Option<&'static str> {
    crate::alert_catalogue::data()
        .bosses
        .iter()
        .find(|boss| u64::from(boss.map_id) == id)
        .map(|boss| boss.map.as_str())
}

/// Field bosses grouped by map, so any map's timers can be read from anywhere. Bosses of
/// the other faction are left out once the faction is known, except on the current map.
fn boss_maps(alerts: &Value, now: u64, current: Option<u64>) -> Vec<Value> {
    let faction = text(alerts, "effective_faction");
    let sides = ["elyos", "asmodian"];
    let mut maps: Vec<(u64, Value)> = Vec::new();
    for row in list(alerts, "catalogue_upcoming") {
        let Some(entry) = list(alerts, "catalogue")
            .iter()
            .find(|entry| text(entry, "id") == text(row, "entry_id"))
        else {
            continue;
        };
        let Some(map) = entry["map_id"].as_u64() else {
            continue;
        };
        let side = text(entry, "faction");
        if sides.contains(&faction)
            && sides.contains(&side)
            && side != faction
            && current != Some(map)
        {
            continue;
        }
        let at = match maps.iter().position(|(id, _)| *id == map) {
            Some(at) => at,
            None => {
                let name = entry["map"]
                    .as_str()
                    .or_else(|| map_name(map))
                    .unwrap_or("");
                maps.push((map, json!({"id":map,"name":name,"rows":[]})));
                maps.len() - 1
            }
        };
        if let Some(rows) = maps[at].1["rows"].as_array_mut() {
            rows.push(catalogue_row(alerts, row, now));
        }
    }
    // The normal world first, then the Abyss.
    maps.sort_by_key(|(id, _)| (*id < 1000, *id));
    maps.into_iter().map(|(_, map)| map).collect()
}

pub fn timers_status(alerts: &Value, now: u64) -> Value {
    let mut rows = Vec::new();
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
        rows.push(catalogue_row(alerts, row, now));
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
                "ends_ms":ends,"state":state,"estimated":row["estimated"],"basis":"Your own schedule","timezone":rule["timezone"],"map_id":null}));
        }
    }
    if !rows
        .iter()
        .any(|r| text(r, "name").eq_ignore_ascii_case("Artifact Siege"))
    {
        rows.push(json!({"id":"artifact-siege","name":"Artifact Siege","category":"event","due_ms":null,"ends_ms":null,"state":"unknown","estimated":false,"basis":"Set an Artifact Siege schedule in Alerts for your service","timezone":null,"map_id":null}));
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
    // `current_zone` is the zone native reports while capturing; nothing else is assumed.
    let current = alerts["current_zone"].as_u64();
    let current_map = current.map(|id| json!({"id":id,"name":map_name(id)}));
    json!({"now_ms":now,"region":alerts["effective_region"],"region_name":name,"timezone":alerts["effective_timezone"],"clock_ready":alerts["clock_ready"],"clock_estimated":alerts["clock_estimated"],"rows":rows,
        "current_map":current_map,"maps":boss_maps(alerts,now,current),"resets":resets(alerts,now),"error":alerts["error"]})
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
    fn field_bosses_are_grouped_by_map_and_follow_the_current_zone() {
        let now = at("2026-10-19T12:14:00Z");
        let mut dashboard = crate::alerts::Alerts::default().status(now);
        let ids = |timers: &Value| -> Vec<u64> {
            list(timers, "maps")
                .iter()
                .filter_map(|m| m["id"].as_u64())
                .collect()
        };
        // No zone while not capturing: every map is offered, normal world before the Abyss.
        let timers = timers_status(&dashboard, now);
        assert!(timers["current_map"].is_null());
        assert_eq!(ids(&timers), vec![1010, 1011, 1110, 1111, 20]);
        let verteron = &list(&timers, "maps")[0];
        assert_eq!(verteron["name"], "Verteron");
        let rows = list(verteron, "rows");
        assert_eq!(rows.len(), 24);
        assert!(rows.iter().all(|r| r["map_id"] == 1010));
        let gartua = rows
            .iter()
            .find(|r| text(r, "id") == "field-2101074")
            .unwrap();
        assert_eq!(gartua["state"], "unknown");
        // Rows outside the map list carry no map, while listed field bosses keep theirs.
        let main = list(&timers, "rows");
        assert!(main
            .iter()
            .any(|r| text(r, "id") == "festival" && r["map_id"].is_null()));
        assert!(main
            .iter()
            .any(|r| text(r, "id") == "field-2101074" && r["map_id"] == 1010));

        // In the Abyss as an Asmodian: the current map is named, Elyos maps are left out.
        dashboard["effective_faction"] = "asmodian".into();
        dashboard["current_zone"] = 20.into();
        let timers = timers_status(&dashboard, now);
        assert_eq!(timers["current_map"]["id"], 20);
        assert_eq!(timers["current_map"]["name"], "Chaotic Lower Reshanta");
        assert_eq!(ids(&timers), vec![1110, 1111, 20]);

        // An Elyos map you are actually on is still shown, and a zone without bosses
        // is reported without inventing a name.
        dashboard["current_zone"] = 1010.into();
        assert_eq!(
            ids(&timers_status(&dashboard, now)),
            vec![1010, 1110, 1111, 20]
        );
        dashboard["current_zone"] = 22.into();
        let middle = timers_status(&dashboard, now);
        assert_eq!(middle["current_map"]["name"], "Chaotic Middle Reshanta");
        dashboard["current_zone"] = 210001.into();
        let cave = timers_status(&dashboard, now);
        assert_eq!(cave["current_map"]["id"], 210001);
        assert!(cave["current_map"]["name"].is_null());
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
