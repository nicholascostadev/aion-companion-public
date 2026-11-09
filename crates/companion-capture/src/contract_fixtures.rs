//! Golden fixtures for the `live_status` and `group_status` IPC payloads.
//!
//! Each fixture is one synthetic scenario, built from hand-assembled frames and invented
//! characters and driven through capture state the way the other tests do. Nothing here
//! comes from a capture, a recording or a profile.
//!
//! The fixtures are `fixtures/contracts/live_status.json` and `group_status.json`, in
//! the repository root so the frontend's normalizer tests and dev mock read the same
//! files. A payload that stops matching its fixture fails here. To change a payload on
//! purpose, run these tests once with `UPDATE_CONTRACT_FIXTURES=1`: the run rewrites
//! the fixture and fails, naming the file, and the next run without the variable passes.
use crate::group_status::GroupStatus;
use crate::{publish, LiveCapture};
use companion_core::combat::CombatEvent;
use companion_core::wire::{Decoder, Hit, Pipeline};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// When the scenario's capture began (epoch milliseconds).
const CAPTURE_STARTED_MS: u64 = 1_762_000_000_000;
/// The capture clock at which `live_status` is read.
const LIVE_NOW_MS: u64 = 24_600;
/// The one instant every wall-clock observation in `group_status` is pinned to.
const OBSERVED_MS: u64 = CAPTURE_STARTED_MS + 60_000;
/// The wall clock at which `group_status` is read.
const GROUP_NOW_MS: u64 = OBSERVED_MS + 1_500;

const CAPTURING: &str =
    "Collecting independent player-skill damage. Session totals include idle time.";

/// One occupied party slot in a hand-assembled roster.
struct Seat {
    name: &'static str,
    server: u16,
    /// Roster class code: 6 Gladiator, 14 Ranger, 30 Cleric, 34 Chanter.
    class: u32,
    level: u32,
    /// Zero is how the wire says "not shown".
    gear_score: u32,
    combat_power: u64,
}

const MOSSGLOW: Seat = Seat {
    name: "Mossglow",
    server: 1304,
    class: 6,
    level: 45,
    gear_score: 2710,
    combat_power: 99_800,
};
const TIDEWHISK: Seat = Seat {
    name: "Tidewhisk",
    server: 1304,
    class: 30,
    level: 45,
    gear_score: 2655,
    combat_power: 97_400,
};
const CINDERVALE: Seat = Seat {
    name: "Cindervale",
    server: 2301,
    class: 14,
    level: 44,
    gear_score: 2590,
    combat_power: 0,
};
const DAWNHARROW: Seat = Seat {
    name: "Dawnharrow",
    server: 1304,
    class: 34,
    level: 43,
    gear_score: 0,
    combat_power: 0,
};

/// The character id the roster carries for a slot.
fn character_id(slot: u8, server: u16) -> u64 {
    (u64::from(server) << 48) | u64::from(slot)
}

/// A complete party roster record. The first seat leads; `None` is a vacant slot.
fn roster(party_id: u32, title: &str, dungeon: u32, seats: &[Option<&Seat>]) -> Vec<u8> {
    let mut frame = vec![2, 0x97];
    frame.extend_from_slice(&party_id.to_le_bytes());
    frame.push(title.len() as u8);
    frame.extend_from_slice(title.as_bytes());
    frame.push(5); // capacity
    frame.extend_from_slice(&dungeon.to_le_bytes());
    frame.extend_from_slice(&[0; 2]);
    let leader = seats[0].expect("the first seat leads the party");
    frame.extend_from_slice(&character_id(1, leader.server).to_le_bytes());
    frame.extend_from_slice(&[0, 0, 0, seats.len() as u8]);
    for (index, seat) in seats.iter().enumerate() {
        let slot = index as u8 + 1;
        let Some(seat) = seat else {
            frame.extend_from_slice(&[0, slot]);
            frame.extend_from_slice(&[0; 12]);
            continue;
        };
        frame.extend_from_slice(&[0x1e, slot]);
        frame.extend_from_slice(&character_id(slot, seat.server).to_le_bytes());
        frame.push(seat.name.len() as u8);
        frame.extend_from_slice(seat.name.as_bytes());
        for value in [seat.class, seat.level, seat.gear_score] {
            frame.extend_from_slice(&value.to_le_bytes());
        }
        frame.extend_from_slice(&seat.server.to_le_bytes());
        frame.extend_from_slice(&seat.server.to_le_bytes());
        frame.push(4);
        frame.extend_from_slice(&seat.combat_power.to_le_bytes());
        frame.extend_from_slice(&[0; 3]);
    }
    frame
}

/// The local character's own identity record: entity, name, server, class and level.
fn own_identity(entity: u8, seat: &Seat) -> Vec<u8> {
    let mut frame = vec![0x33, 0x36, entity, 0, 0, 0, 0, 1, seat.name.len() as u8];
    frame.extend_from_slice(seat.name.as_bytes());
    frame.extend_from_slice(&seat.server.to_le_bytes());
    frame.extend_from_slice(&seat.class.to_le_bytes());
    frame.push(1);
    frame.extend_from_slice(&seat.level.to_le_bytes());
    frame
}

/// Another player's name together with their server.
fn named(entity: u8, server: u16, name: &str) -> Vec<u8> {
    let mut frame = vec![0x04, 0x8d, 0, 0, 0, 0, 0, entity];
    frame.extend_from_slice(&server.to_le_bytes());
    frame.push(name.len() as u8);
    frame.extend_from_slice(name.as_bytes());
    frame
}

/// Another player's name alone; the record carries no server.
fn name_only(entity: u8, name: &str) -> Vec<u8> {
    let mut frame = vec![0x45, 0x36, entity, 0, 0, 0, 0, 1, name.len() as u8];
    frame.extend_from_slice(name.as_bytes());
    frame
}

/// The local character's own combat power update.
fn own_power(value: u64) -> Vec<u8> {
    let mut frame = vec![0x56, 0x36];
    frame.extend_from_slice(&value.to_le_bytes());
    frame.extend_from_slice(&value.to_le_bytes());
    frame
}

/// One member's readiness update.
fn readiness(slot: u8, seat: &Seat, ready: bool) -> Vec<u8> {
    let mut frame = vec![0x16, 0x97];
    frame.extend_from_slice(&character_id(slot, seat.server).to_le_bytes());
    frame.push(u8::from(ready));
    frame
}

/// An inspected Sorcerer who is not in the party.
fn inspection(name: &str, level: u32, gear_score: u32) -> Vec<u8> {
    let mut frame = vec![0x50, 0x36, 0, 0, 7, name.len() as u8];
    frame.extend_from_slice(name.as_bytes());
    frame.extend_from_slice(&25u32.to_le_bytes());
    frame.extend_from_slice(&[1, 2]);
    frame.extend_from_slice(&level.to_le_bytes());
    frame.extend_from_slice(&[0; 4]);
    frame.extend_from_slice(&gear_score.to_le_bytes());
    frame.resize(40, 0);
    frame
}

fn observe(capture: &LiveCapture, frames: &[Vec<u8>]) {
    let mut state = capture.shared.lock().unwrap();
    for frame in frames {
        state.entities.observe(frame).unwrap();
    }
}

fn capturing(capture: &LiveCapture) {
    let mut state = capture.shared.lock().unwrap();
    state.running = true;
    state.phase = "capturing".into();
    state.message = CAPTURING.into();
    state.epoch_ms = CAPTURE_STARTED_MS;
}

/// A fight in progress after an earlier one ended. Five players are on the meter:
///
/// - Mossglow, the local character, whose own update supplies combat power;
/// - Tidewhisk, a party member named together with a server;
/// - Cindervale, a party member known by name only, whose server the roster vouches
///   for and whose combat power the roster does not show;
/// - Quillfrost, a named player outside the party;
/// - entity 55, a player whose name was never observed.
fn live_scenario() -> LiveCapture {
    let capture = LiveCapture::default();
    capturing(&capture);
    capture
        .set_skill_names(BTreeMap::from([
            (11_010_000, "Keen Strike".to_owned()),
            (17_150_002, "Radiant Verdict".to_owned()),
            (18_020_000, "Warding Chant".to_owned()),
        ]))
        .unwrap();
    observe(
        &capture,
        &[
            own_identity(11, &MOSSGLOW),
            named(22, TIDEWHISK.server, TIDEWHISK.name),
            name_only(33, CINDERVALE.name),
            named(44, 2406, "Quillfrost"),
            roster(
                48_213,
                "Evening rounds",
                0,
                &[
                    Some(&MOSSGLOW),
                    Some(&TIDEWHISK),
                    Some(&CINDERVALE),
                    Some(&DAWNHARROW),
                ],
            ),
            own_power(101_250),
        ],
    );
    let mut decoder = Decoder::default();
    // Odyle: 142 in the base pool and 60 in the bonus pool.
    decoder.decode(&[0x0b, 0x61, 0x0c, 1, 0x87, 0x93, 3, 0x8e, 0x01, 0x3c]);
    let hit = |actor, target, skill, amount| Hit {
        actor,
        target,
        skill,
        amount,
        critical: false,
        tick: false,
    };
    {
        let mut state = capture.shared.lock().unwrap();
        state.receive_odyle(&decoder.odyle, 1_500);
        // The first fight ends by inactivity and moves to history with the next hit.
        state
            .add_hits(1_000, vec![hit(11, 800, 11_010_000, 1_200)])
            .unwrap();
        state
            .add_hits(2_500, vec![hit(11, 800, 11_010_000, 800)])
            .unwrap();
        let critical = Hit {
            critical: true,
            ..hit(11, 900, 11_010_000, 1_500)
        };
        state.add_hits(20_000, vec![critical]).unwrap();
        state
            .add_hits(20_500, vec![hit(22, 900, 17_150_002, 1_200)])
            .unwrap();
        let tick = |actor, skill, amount| Hit {
            tick: true,
            ..hit(actor, 900, skill, amount)
        };
        state
            .add_hits(21_000, vec![tick(33, 14_000_100, 900)])
            .unwrap();
        state
            .add_hits(21_500, vec![hit(44, 900, 15_210_000, 700)])
            .unwrap();
        state
            .add_hits(22_000, vec![hit(55, 900, 13_050_000, 450)])
            .unwrap();
        state
            .add_hits(
                23_000,
                vec![
                    hit(11, 900, 11_020_000, 1_000),
                    hit(11, 900, 11_010_000, 1_500),
                ],
            )
            .unwrap();
        state
            .add_hits(24_000, vec![tick(22, 17_150_002, 750)])
            .unwrap();
    }
    let mut pipeline = Pipeline::default();
    pipeline.packets = 4_210;
    pipeline.decoder.frames = 3_870;
    pipeline.decoder.bundles = 96;
    pipeline.decoder.rejected = 2;
    pipeline.gaps = 1;
    pipeline.retransmissions = 3;
    publish(&capture.shared, &pipeline, 2, 0).unwrap();
    capture
}

/// A party room preparing for a dungeon, with a ready check under way. Slot three is
/// vacant. Mossglow leads and is the local character, so the own update replaces the
/// roster's combat power. Tidewhisk is ready, Cindervale is not and shows no combat
/// power, and Dawnharrow shows neither value and has not answered. Quillfrost was
/// inspected and is not in the party.
fn group_scenario() -> LiveCapture {
    let capture = LiveCapture::default();
    capturing(&capture);
    observe(
        &capture,
        &[
            own_identity(11, &MOSSGLOW),
            roster(
                48_213,
                "Crimson Vault, two more",
                600_011,
                &[
                    Some(&MOSSGLOW),
                    Some(&TIDEWHISK),
                    None,
                    Some(&CINDERVALE),
                    Some(&DAWNHARROW),
                ],
            ),
            own_power(101_250),
            readiness(2, &TIDEWHISK, true),
            readiness(4, &CINDERVALE, false),
            inspection("Quillfrost", 45, 2_480),
        ],
    );
    {
        let mut state = capture.shared.lock().unwrap();
        let state = &mut *state;
        // The player stands in a town zone: a zone is known and no run has begun.
        let zone = CombatEvent {
            zone_id: Some(1_110),
            ..CombatEvent::new("zone")
        };
        state
            .offline
            .receive(vec![zone], &state.entities, 1_000, CAPTURE_STARTED_MS);
        // The decoder stamps observations with the wall clock. These two stamps are
        // public; the fixture test pins the per-member and inspection ones.
        state.entities.roster_observed_ms = Some(OBSERVED_MS);
        state.entities.ready_observed_ms = Some(OBSERVED_MS);
    }
    capture
}

/// Set to `1` to rewrite a fixture that no longer matches its scenario.
const UPDATE: &str = "UPDATE_CONTRACT_FIXTURES";
const HOW_TO_UPDATE: &str = "If the payload changed on purpose, rewrite the fixtures with\n\n    \
    UPDATE_CONTRACT_FIXTURES=1 bash dev.sh exec -- cargo test --locked -p companion-capture contract_fixtures\n\n\
    review the change with git diff, run the test again without the variable, and update the\n\
    frontend normalizer that reads the same file.";

fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/contracts")
        .join(name)
}

/// Every path where the payload and the fixture disagree, one entry per path.
fn differences(path: &str, expected: &Value, actual: &Value, found: &mut Vec<String>) {
    let mut entry =
        |at: String, expected: Option<&Value>, actual: Option<&Value>| match (expected, actual) {
            (Some(expected), Some(actual)) => differences(&at, expected, actual, found),
            (Some(expected), None) => found.push(format!(
                "{at}\n    - fixture: {expected}\n    + payload: (absent)"
            )),
            (None, Some(actual)) => found.push(format!(
                "{at}\n    - fixture: (absent)\n    + payload: {actual}"
            )),
            (None, None) => {}
        };
    match (expected, actual) {
        (Value::Object(expected), Value::Object(actual)) => {
            let keys: BTreeSet<_> = expected.keys().chain(actual.keys()).collect();
            for key in keys {
                entry(format!("{path}.{key}"), expected.get(key), actual.get(key));
            }
        }
        (Value::Array(expected), Value::Array(actual)) => {
            for index in 0..expected.len().max(actual.len()) {
                entry(
                    format!("{path}[{index}]"),
                    expected.get(index),
                    actual.get(index),
                );
            }
        }
        _ if expected == actual => {}
        _ => found.push(format!(
            "{path}\n    - fixture: {expected}\n    + payload: {actual}"
        )),
    }
}

/// The payload must serialise to exactly the checked-in fixture: the same keys, the
/// same nulls, integers as integers and floats as floats.
fn assert_fixture(name: &str, payload: &impl Serialize) {
    let exact = serde_json::to_value(payload).unwrap();
    // A fixture is compared as the JSON text a reader receives. Without its
    // `float_roundtrip` feature serde_json may read a float one unit in the last place
    // off, so the payload goes through the same text and parser as the file. The file
    // itself is always written from the exact values.
    let actual: Value = serde_json::from_str(&exact.to_string()).unwrap();
    let path = fixture_path(name);
    let expected = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    if expected.as_ref() == Some(&actual) {
        return;
    }
    // Rewriting is never silent: a run that changed a fixture fails and says so.
    if std::env::var(UPDATE).is_ok_and(|value| value == "1") {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serde_json::to_string_pretty(&exact).unwrap() + "\n").unwrap();
        panic!(
            "Rewrote {} from its scenario because {UPDATE}=1. Review the change with git diff, \
             then run this test again without the variable.",
            path.display()
        );
    }
    let Some(expected) = expected else {
        panic!(
            "{} is missing or is not JSON.\n\n{HOW_TO_UPDATE}",
            path.display()
        );
    };
    let mut found = Vec::new();
    differences("$", &expected, &actual, &mut found);
    panic!(
        "The {name} payload no longer matches fixtures/contracts/{name} at {} path(s):\n\n  {}\n\n{HOW_TO_UPDATE}",
        found.len(),
        found.join("\n  ")
    );
}

#[test]
fn live_status_serialises_to_its_contract_fixture() {
    let capture = live_scenario();
    let status = capture.shared.lock().unwrap().live_status_at(LIVE_NOW_MS);
    assert_fixture("live_status.json", &status);
}

#[test]
fn group_status_serialises_to_its_contract_fixture() {
    let capture = group_scenario();
    let mut observed = capture.group_observed().unwrap();
    // The decoder stamps readiness and inspections with the wall clock and keeps them
    // private. Pin them on the way in, so the payload still derives everything itself.
    for stamp in observed
        .members
        .iter_mut()
        .filter_map(|member| member.ready_observed_ms.as_mut())
    {
        *stamp = OBSERVED_MS;
    }
    for inspection in &mut observed.inspections {
        inspection.observed_ms = OBSERVED_MS;
    }
    let status = GroupStatus::new(observed, GROUP_NOW_MS).unwrap();
    assert_fixture("group_status.json", &status);
}

#[test]
fn the_ipc_json_is_the_typed_payload() {
    let live = live_scenario();
    {
        // A stopped capture reads a fixed clock, so two reads agree.
        let mut state = live.shared.lock().unwrap();
        state.running = false;
        state.stopped_ms = LIVE_NOW_MS;
    }
    assert_eq!(
        live.snapshot().unwrap(),
        serde_json::to_value(live.live_status().unwrap()).unwrap()
    );
    let group = group_scenario();
    let (ipc, typed) = (
        group.group_snapshot().unwrap(),
        group.group_status().unwrap(),
    );
    let mut typed = serde_json::to_value(typed).unwrap();
    // Only the roster's age depends on when each call read the wall clock.
    typed["roster_age_ms"] = ipc["roster_age_ms"].clone();
    assert_eq!(ipc, typed);
}

/// The fixtures show a busy capture. Before anything is observed the same keys are
/// present, counters are an empty object and every unknown is `null`.
#[test]
fn an_idle_capture_keeps_every_key_and_reports_unknowns_as_null() {
    let keys =
        |value: &Value| -> Vec<String> { value.as_object().unwrap().keys().cloned().collect() };
    let fixture = |name: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(fixture_path(name)).unwrap()).unwrap()
    };
    let capture = LiveCapture::default();

    let live = capture.snapshot().unwrap();
    assert_eq!(keys(&live), keys(&fixture("live_status.json")));
    assert_eq!(live["stats"], json!({}));
    assert_eq!(live["odyle"], Value::Null);
    assert_eq!(live["players"], json!([]));
    assert_eq!(live["history"], json!([]));

    let group = capture.group_snapshot().unwrap();
    assert_eq!(keys(&group), keys(&fixture("group_status.json")));
    for unknown in [
        "roster_age_ms",
        "lobby_name",
        "capacity",
        "party_id",
        "dungeon_id",
    ] {
        assert_eq!(group[unknown], Value::Null, "{unknown}");
    }
    assert_eq!(group["members"], json!([]));
    assert_eq!(group["inspections"], json!([]));
    assert_eq!(
        group["run"],
        json!({"phase": "unknown", "dungeon_id": null, "run_id": null, "zone_id": null})
    );
    assert_eq!(
        group["ready_check"],
        json!({
            "active": null, "started_ms": null, "expires_ms": null,
            "observed_ms": null, "oldest_observed_ms": null,
            "source": "observed lobby member readiness", "supported": true,
        })
    );
}

#[test]
fn a_fixture_mismatch_names_every_changed_path() {
    let fixture = json!({"damage": 600, "dps": 600.0, "name": null, "players": [{"entity": 1}, {"entity": 2}]});
    let payload = json!({"damage": 600.0, "dps": 600.0, "players": [{"id": 1}], "extra": true});
    let mut found = Vec::new();
    differences("$", &fixture, &payload, &mut found);
    assert_eq!(
        found,
        [
            "$.damage\n    - fixture: 600\n    + payload: 600.0",
            "$.extra\n    - fixture: (absent)\n    + payload: true",
            "$.name\n    - fixture: null\n    + payload: (absent)",
            "$.players[0].entity\n    - fixture: 1\n    + payload: (absent)",
            "$.players[0].id\n    - fixture: (absent)\n    + payload: 1",
            "$.players[1]\n    - fixture: {\"entity\":2}\n    + payload: (absent)",
        ]
    );
    let mut same = Vec::new();
    differences("$", &fixture, &fixture, &mut same);
    assert!(same.is_empty());
}
