//! Bundled factual game calendar and boss identifiers, independent of any running application.
use crate::alerts::{Rule, Schedule};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Deserialize)]
pub struct Data {
    pub calendars: BTreeMap<String, Vec<Calendar>>,
    pub bosses: Vec<Boss>,
}
#[derive(Deserialize)]
pub struct Calendar {
    pub id: String,
    pub minutes: Vec<u16>,
    pub weekdays: Vec<u8>,
    pub duration_seconds: u64,
    pub npc_ids: Vec<u32>,
    pub event_ids: Vec<u32>,
    pub recharge_minute: Option<u16>,
}
#[derive(Clone, Deserialize)]
pub struct Boss {
    pub event_id: u32,
    pub npc_id: u32,
    pub name: String,
    pub map_id: u32,
    pub map: String,
    pub faction: String,
    pub scheduled: bool,
}
#[derive(Serialize)]
pub struct Member {
    pub id: u32,
    pub name: String,
}
#[derive(Serialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub category: String,
    pub map_id: Option<u32>,
    pub map: Option<String>,
    pub faction: String,
    pub members: Vec<Member>,
    pub rule: Rule,
    pub source: String,
    pub note: String,
    pub recharge_minute: Option<u16>,
}
pub fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../data/alert-catalogue.json"))
            .expect("Valid bundled alert catalogue")
    })
}
pub fn known_boss(id: u32) -> bool {
    data().bosses.iter().any(|b| b.npc_id == id)
}
pub fn entries(region: &str, timezone: &str) -> Vec<Entry> {
    let family = if ["kr", "tw"].contains(&region) {
        "twkr"
    } else {
        "global"
    };
    let data = data();
    let mut out = Vec::new();
    for calendar in &data.calendars[family] {
        let (name, category) = match calendar.id.as_str() {
            "festival" => ("Shugo Festival", "event"),
            "invasion" => ("Invasion", "event"),
            "rift" => ("Spacetime Rift", "event"),
            "watcher-kaira" => ("Watcher Kaira", "world_boss"),
            "siege-bosses" => ("Siege Bosses", "world_boss"),
            "guardian-nahma" => ("Guardian Lord Nahma", "world_boss"),
            _ => continue,
        };
        let members = calendar
            .npc_ids
            .iter()
            .filter_map(|id| data.bosses.iter().find(|b| b.npc_id == *id))
            .map(|b| Member {
                id: b.npc_id,
                name: b.name.clone(),
            })
            .collect();
        let mut rule = default_rule(&calendar.id, name, category);
        rule.schedule = Some(Schedule::Calendar {
            times: calendar
                .minutes
                .iter()
                .map(|m| format!("{:02}:{:02}", m / 60, m % 60))
                .collect(),
            weekdays: if calendar.weekdays.len() == 7 {
                vec![]
            } else {
                calendar.weekdays.clone()
            },
        });
        rule.timezone = Some(timezone.into());
        rule.npc_ids = calendar.npc_ids.clone();
        rule.event_ids = calendar.event_ids.clone();
        rule.duration_seconds = calendar.duration_seconds;
        out.push(Entry {
            id: calendar.id.clone(),
            name: name.into(),
            category: category.into(),
            map_id: None,
            map: None,
            faction: "all".into(),
            members,
            rule,
            source: "Bundled regional game calendar".into(),
            note: if family == "twkr" {
                "Korea/Taiwan calendar"
            } else {
                "Global calendar"
            }
            .into(),
            recharge_minute: calendar.recharge_minute,
        });
    }
    for boss in data.bosses.iter().filter(|b| !b.scheduled) {
        let id = format!("field-{}", boss.npc_id);
        let mut rule = default_rule(&id, &boss.name, "field_boss");
        rule.schedule = Some(Schedule::Observed);
        rule.npc_id = Some(boss.npc_id);
        rule.event_id = Some(boss.event_id);
        out.push(Entry { id, name:boss.name.clone(), category:"field_boss".into(),map_id:Some(boss.map_id),map:Some(boss.map.clone()),faction:boss.faction.clone(),members:vec![Member {id:boss.npc_id,name:boss.name.clone()}],rule,source:"Bundled game boss roster; local game observations".into(),note:"Spawn times update from your own game traffic. No local observation yet means the time is unknown.".into(),recharge_minute:None });
    }
    out
}
fn default_rule(id: &str, name: &str, category: &str) -> Rule {
    Rule {
        id: format!("preset-{id}"),
        name: name.into(),
        category: category.into(),
        enabled: false,
        favorite: false,
        schedule: None,
        timezone: None,
        lead_seconds: vec![300],
        sound: "chime".into(),
        volume: 0.6,
        popup: true,
        duration_seconds: 0,
        npc_id: None,
        event_id: None,
        notes: String::new(),
        respawn_seconds: None,
        preset_id: Some(id.into()),
        npc_ids: vec![],
        event_ids: vec![],
        schedule_override: false,
    }
}
