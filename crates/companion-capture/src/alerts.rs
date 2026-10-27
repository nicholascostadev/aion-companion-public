//! Local, durable event scheduling. No network client, webview timer or report dependency.
use chrono::{Datelike, Duration, LocalResult, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use companion_core::combat::{Catalogue, CombatEvent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    path::PathBuf,
};

const GRACE: u64 = 30_000;
const DAY: u64 = 86_400_000;
const SOUNDS: [&str; 7] = ["none", "chime", "ping", "bell", "beep", "pulse", "alarm"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Schedule {
    Once {
        at_ms: u64,
    },
    Interval {
        anchor_ms: u64,
        every_seconds: u64,
    },
    Calendar {
        times: Vec<String>,
        weekdays: Vec<u8>,
    },
    Observed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub category: String,
    pub enabled: bool,
    pub favorite: bool,
    pub schedule: Option<Schedule>,
    pub timezone: Option<String>,
    pub lead_seconds: Vec<u64>,
    pub sound: String,
    pub volume: f64,
    pub popup: bool,
    pub duration_seconds: u64,
    pub npc_id: Option<u32>,
    pub event_id: Option<u32>,
    pub notes: String,
    #[serde(default)]
    pub respawn_seconds: Option<u64>,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub npc_ids: Vec<u32>,
    #[serde(default)]
    pub event_ids: Vec<u32>,
    #[serde(default)]
    pub schedule_override: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quiet {
    pub start: String,
    pub end: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub version: u8,
    pub revision: u64,
    pub enabled: bool,
    pub region: String,
    pub server: String,
    pub timezone: String,
    pub background_sound: bool,
    #[serde(default)]
    pub alert_when_game_closed: bool,
    #[serde(default)]
    pub notify_server_back: bool,
    pub muted_until_ms: Option<u64>,
    pub quiet_hours: Option<Quiet>,
    pub rules: Vec<Rule>,
    #[serde(default = "full_volume")]
    pub volume: f64,
    #[serde(default = "auto_faction")]
    pub faction: String,
}
fn full_volume() -> f64 {
    1.0
}
fn auto_faction() -> String {
    "auto".into()
}
fn effective_region<'a>(config: &'a Config, detected: Option<&'a Value>) -> &'a str {
    if config.region != "global" {
        return &config.region;
    }
    if !config.server.is_empty() {
        return match config.server.parse::<u16>().unwrap_or(0) / 100 % 10 {
            1 => "na-east",
            2 => "na-west",
            3 => "eu",
            4 => "latam",
            5 => "asia",
            _ => "global",
        };
    }
    detected
        .and_then(|s| s["region"].as_str())
        .filter(|r| *r != "unknown")
        .unwrap_or("global")
}
fn effective_timezone(config: &Config, detected: Option<&Value>) -> String {
    let region = effective_region(config, detected);
    if config.region != "global" || region == "global" {
        return config.timezone.clone();
    }
    regions()
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["id"] == region))
        .and_then(|r| r["timezone"].as_str())
        .unwrap_or("UTC")
        .into()
}
fn effective_faction(config: &Config, detected: Option<&Value>) -> String {
    if config.faction != "auto" {
        return config.faction.clone();
    }
    let id = if config.server.is_empty() {
        detected.and_then(|s| s["id"].as_str()).unwrap_or("")
    } else {
        &config.server
    };
    match id.parse::<u16>().unwrap_or(0) / 1000 {
        1 => "elyos",
        2 => "asmodian",
        _ => "all",
    }
    .into()
}
fn refresh_rules(config: &mut Config, detected: Option<&Value>) -> Result<(), String> {
    let region = effective_region(config, detected).to_string();
    let tz = effective_timezone(config, detected);
    let entries = crate::alert_catalogue::entries(&region, &tz);
    for rule in &mut config.rules {
        let Some(id) = &rule.preset_id else { continue };
        let canonical = &entries
            .iter()
            .find(|e| &e.id == id)
            .ok_or("Unknown built-in alert")?
            .rule;
        rule.name = canonical.name.clone();
        rule.category = canonical.category.clone();
        rule.npc_id = canonical.npc_id;
        rule.event_id = canonical.event_id;
        rule.npc_ids = canonical.npc_ids.clone();
        rule.event_ids = canonical.event_ids.clone();
        if !rule.schedule_override {
            rule.schedule = canonical.schedule.clone();
            rule.timezone = canonical.timezone.clone();
            rule.duration_seconds = canonical.duration_seconds;
        }
    }
    Ok(())
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            enabled: false,
            region: "global".into(),
            server: String::new(),
            timezone: "UTC".into(),
            background_sound: true,
            alert_when_game_closed: false,
            notify_server_back: false,
            muted_until_ms: None,
            quiet_hours: None,
            rules: Vec::new(),
            volume: 1.0,
            faction: "auto".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Delivery {
    pub id: String,
    pub rule_id: String,
    pub name: String,
    pub category: String,
    pub due_ms: u64,
    pub fired_ms: u64,
    pub lead_seconds: u64,
    pub phase: String,
    pub sound: String,
    pub volume: f64,
    pub popup: bool,
    pub status: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Observed {
    pub id: String,
    pub name: String,
    pub category: String,
    pub npc_id: Option<u32>,
    pub event_id: Option<u32>,
    pub due_ms: Option<u64>,
    pub observed_ms: u64,
    pub server: String,
    pub state: String,
    pub basis: String,
    pub estimated: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    config: Config,
    history: VecDeque<Delivery>,
    claims: BTreeMap<String, u64>,
    observed: BTreeMap<String, Observed>,
    snoozes: Vec<Delivery>,
    skipped: BTreeMap<String, u64>,
    last_tick_ms: u64,
    maintenance_watch: Option<u64>,
}
/// Migrate built-in labels without touching the user's clock, schedule or delivery claims.
/// A status response alone is insufficient: the native delivery clock reads saved rules.
fn refresh_saved_names(saved: &mut Saved) -> bool {
    let catalogue = crate::alert_catalogue::entries("global", "UTC");
    let mut names = BTreeMap::new();
    let mut changed = false;
    for rule in &mut saved.config.rules {
        let Some(entry) = rule
            .preset_id
            .as_ref()
            .and_then(|id| catalogue.iter().find(|entry| &entry.id == id))
        else {
            continue;
        };
        names.insert(rule.id.clone(), entry.name.clone());
        if rule.name != entry.name {
            rule.name = entry.name.clone();
            changed = true;
        }
    }
    for delivery in saved.history.iter_mut().chain(saved.snoozes.iter_mut()) {
        if let Some(name) = names.get(&delivery.rule_id) {
            if &delivery.name != name {
                delivery.name = name.clone();
                changed = true;
            }
        }
    }
    changed
}
#[derive(Default)]
pub(crate) struct Alerts {
    pub storage: Option<std::sync::Arc<crate::storage::Storage>>,
    saved: Saved,
    root: Option<PathBuf>,
    detected: Option<Value>,
    entities: BTreeMap<u32, u32>,
    pub error: Option<String>,
    session: u64,
    load_failed: bool,
    game_running: Option<bool>,
    server_status: crate::server_status::Snapshot,
}
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn time(value: &str) -> Option<NaiveTime> {
    if value.len() != 5 {
        return None;
    }
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}
fn category(value: &str) -> bool {
    ["event", "world_boss", "field_boss", "custom"].contains(&value)
}
fn zone(value: &str) -> Result<Tz, String> {
    value.parse().map_err(|_| "Unknown IANA time zone".into())
}
fn validate(config: &Config) -> Result<(), String> {
    if config.version != 1
        || config.rules.len() > 512
        || config.region.len() > 40
        || config.server.len() > 100
        || !config.volume.is_finite()
        || !(0.0..=1.0).contains(&config.volume)
        || !["auto", "all", "elyos", "asmodian"].contains(&config.faction.as_str())
    {
        return Err("Invalid alert configuration".into());
    }
    zone(&config.timezone)?;
    if let Some(q) = &config.quiet_hours {
        if time(&q.start).is_none() || time(&q.end).is_none() || q.start == q.end {
            return Err("Quiet hours need distinct HH:mm times".into());
        }
    }
    let mut ids = BTreeSet::new();
    for rule in &config.rules {
        if !valid_id(&rule.id)
            || !ids.insert(&rule.id)
            || rule.name.trim().is_empty()
            || rule.name.len() > 200
            || !category(&rule.category)
            || rule.notes.len() > 2000
            || rule.npc_ids.len() > 100
            || rule.event_ids.len() > 256
            || rule.preset_id.as_ref().is_some_and(|id| !valid_id(id))
        {
            return Err("Invalid or duplicate alert rule".into());
        }
        if !SOUNDS.contains(&rule.sound.as_str())
            || !rule.volume.is_finite()
            || !(0.0..=1.0).contains(&rule.volume)
            || rule.duration_seconds > 86400
            || rule.lead_seconds.is_empty()
            || rule.lead_seconds.len() > 8
            || rule.lead_seconds.iter().any(|n| *n > 86400)
            || rule.lead_seconds.iter().collect::<BTreeSet<_>>().len() != rule.lead_seconds.len()
        {
            return Err("Invalid reminder, sound or duration".into());
        }
        if let Some(tz) = &rule.timezone {
            zone(tz)?;
        }
        if rule
            .respawn_seconds
            .is_some_and(|n| !(60..=2_678_400).contains(&n))
        {
            return Err("Respawn interval must be 1 minute to 31 days".into());
        }
        match &rule.schedule {
            Some(Schedule::Once { at_ms }) if *at_ms > 32_503_680_000_000 => {
                return Err("Alert date is out of range".into())
            }
            Some(Schedule::Interval {
                anchor_ms,
                every_seconds,
            }) if *anchor_ms > 32_503_680_000_000 || !(1..=31_536_000).contains(every_seconds) => {
                return Err("Invalid interval schedule".into())
            }
            Some(Schedule::Calendar { times, weekdays }) => {
                if times.is_empty()
                    || times.len() > 48
                    || times.iter().any(|t| time(t).is_none())
                    || times.iter().collect::<BTreeSet<_>>().len() != times.len()
                    || weekdays.len() > 7
                    || weekdays.iter().any(|d| *d > 6)
                    || weekdays.iter().collect::<BTreeSet<_>>().len() != weekdays.len()
                {
                    return Err("Invalid calendar schedule".into());
                }
            }
            _ => {}
        }
    }
    Ok(())
}
fn candidates(schedule: &Schedule, tz: Tz, center: u64) -> Vec<u64> {
    match schedule {
        Schedule::Once { at_ms } => vec![*at_ms],
        Schedule::Interval {
            anchor_ms,
            every_seconds,
        } => {
            let step = every_seconds.saturating_mul(1000);
            if step == 0 {
                return vec![];
            }
            let k = center.saturating_sub(*anchor_ms) / step;
            let mut out = Vec::new();
            for n in k.saturating_sub(1)..=k.saturating_add(1) {
                if let Some(at) = n.checked_mul(step).and_then(|n| anchor_ms.checked_add(n)) {
                    out.push(at);
                }
            }
            out.sort_unstable();
            out.dedup();
            out
        }
        Schedule::Calendar { times, weekdays } => {
            let Some(dt) = Utc
                .timestamp_millis_opt(center.min(i64::MAX as u64) as i64)
                .single()
            else {
                return vec![];
            };
            let date = dt.with_timezone(&tz).date_naive();
            let mut out = Vec::new();
            for offset in -2..=8 {
                let Some(day) = date.checked_add_signed(Duration::days(offset)) else {
                    continue;
                };
                if !weekdays.is_empty()
                    && !weekdays.contains(&(day.weekday().num_days_from_monday() as u8))
                {
                    continue;
                }
                for clock in times {
                    let Some(clock) = time(clock) else {
                        continue;
                    };
                    let at = match tz.from_local_datetime(&day.and_time(clock)) {
                        LocalResult::Single(at) => Some(at),
                        LocalResult::Ambiguous(a, b) => Some(a.min(b)),
                        LocalResult::None => None,
                    };
                    if let Some(at) = at {
                        if at.timestamp_millis() >= 0 {
                            out.push(at.timestamp_millis() as u64);
                        }
                    }
                }
            }
            out.sort_unstable();
            out.dedup();
            out
        }
        Schedule::Observed => vec![],
    }
}
fn quiet(config: &Config, now: u64) -> bool {
    let Some(q) = &config.quiet_hours else {
        return false;
    };
    let (Ok(tz), Some(start), Some(end), Some(at)) = (
        zone(&config.timezone),
        time(&q.start),
        time(&q.end),
        Utc.timestamp_millis_opt(now as i64).single(),
    ) else {
        return false;
    };
    let current = at.with_timezone(&tz).time();
    if start < end {
        current >= start && current < end
    } else {
        current >= start || current < end
    }
}
fn servers() -> Vec<Value> {
    serde_json::from_str(include_str!("../data/alert-servers.json")).unwrap_or_default()
}
pub fn regions() -> Value {
    json!([
        {"id":"global","name":"Custom server clock","timezone":"UTC"},
        {"id":"na-west","name":"North America West","timezone":"America/Los_Angeles"},
        {"id":"na-east","name":"North America East","timezone":"America/New_York"},
        {"id":"eu","name":"Europe","timezone":"Europe/Berlin"},
        {"id":"latam","name":"South America","timezone":"America/Sao_Paulo"},
        {"id":"asia","name":"Asia","timezone":"Asia/Tokyo"},
        {"id":"kr","name":"Korea","timezone":"Asia/Seoul"},
        {"id":"tw","name":"Taiwan","timezone":"Asia/Taipei"}
    ])
}
pub fn templates() -> Value {
    json!(crate::alert_catalogue::entries("global","UTC").into_iter().filter(|e|e.category!="field_boss").map(|e|json!({"id":e.id,"name":e.name,"category":e.category,"schedule":e.rule.schedule,"duration_seconds":e.rule.duration_seconds,"regions":[],"source":e.source,"notes":e.note,"verified":false,"npc_id":e.rule.npc_ids.first()})).collect::<Vec<_>>())
}
impl Alerts {
    pub fn set_game_running(&mut self, running: bool) {
        self.game_running = Some(running);
    }
    #[cfg(test)]
    fn update_server_status(
        &mut self,
        result: Result<Vec<crate::server_status::Server>, String>,
        source: &str,
        now: u64,
    ) {
        self.server_status.update(result, source, now);
    }
    pub fn update_maintenance(
        &mut self,
        result: Result<Option<crate::server_status::Maintenance>, String>,
        now: u64,
    ) {
        self.server_status.update_maintenance(result, now);
    }
    fn delivery_paused(&self, now: u64) -> Option<&'static str> {
        let config = &self.saved.config;
        let server = if config.server.is_empty() {
            self.detected
                .as_ref()
                .and_then(|s| s["id"].as_str())
                .unwrap_or("")
        } else {
            &config.server
        };
        if self.server_status.down(
            server,
            effective_region(config, self.detected.as_ref()),
            now,
        ) {
            Some("server_down")
        } else if self.game_running == Some(false) && !config.alert_when_game_closed {
            Some("game_closed")
        } else {
            None
        }
    }
    pub fn initialize(&mut self, root: PathBuf, legacy: &Value, now: u64) -> Result<(), String> {
        self.load_failed = true;
        self.root = Some(root);
        self.session = now;
        let path = self.root.as_ref().unwrap().join("alerts.json");
        if path.exists() {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            let saved: Saved = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Saved alerts could not be read: {e}"))?;
            validate(&saved.config)?;
            if saved.history.len() > 500
                || saved.observed.len() > 1024
                || saved.claims.len() > 20_000
                || saved.snoozes.len() > 100
            {
                return Err("Saved alerts exceed limits".into());
            }
            self.saved = saved;
            if refresh_saved_names(&mut self.saved) {
                self.persist()?;
            }
        } else {
            if let Some(rows) = legacy["alerts"].as_array() {
                for a in rows {
                    let Some(id) = a["id"].as_str() else {
                        continue;
                    };
                    let Some(first) = a["at_ms"].as_u64() else {
                        continue;
                    };
                    let repeat = a["repeat_seconds"].as_u64().unwrap_or(0);
                    self.saved.config.rules.push(Rule {
                        id: id.into(),
                        name: a["name"]
                            .as_str()
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or("Reminder")
                            .into(),
                        category: "custom".into(),
                        enabled: a["enabled"] == true,
                        favorite: false,
                        schedule: Some(if repeat > 0 {
                            Schedule::Interval {
                                anchor_ms: first,
                                every_seconds: repeat,
                            }
                        } else {
                            Schedule::Once { at_ms: first }
                        }),
                        timezone: None,
                        lead_seconds: vec![a["lead_seconds"].as_u64().unwrap_or(0)],
                        sound: a["sound"]
                            .as_str()
                            .filter(|s| SOUNDS.contains(s))
                            .unwrap_or("chime")
                            .into(),
                        volume: a["volume"].as_f64().unwrap_or(0.5),
                        popup: true,
                        duration_seconds: 0,
                        npc_id: None,
                        event_id: None,
                        notes: "Migrated local reminder".into(),
                        respawn_seconds: None,
                        preset_id: None,
                        npc_ids: vec![],
                        event_ids: vec![],
                        schedule_override: false,
                    });
                }
            }
            self.saved.config.enabled = self.saved.config.rules.iter().any(|r| r.enabled);
            validate(&self.saved.config)?;
            self.persist()?;
        }
        self.load_failed = false;
        Ok(())
    }
    fn persist(&mut self) -> Result<(), String> {
        let Some(root) = &self.root else {
            return Ok(());
        };
        if let Some(storage) = &self.storage {
            return storage.write(vec![crate::storage::Write::json(
                root.join("alerts.json"),
                self.saved.clone(),
            )]);
        }
        crate::storage::atomic(&root.join("alerts.json"), &self.saved)?;
        Ok(())
    }
    pub fn configure(&mut self, value: Value) -> Result<(), String> {
        let mut config: Config = serde_json::from_value(value).map_err(|e| e.to_string())?;
        refresh_rules(&mut config, self.detected.as_ref())?;
        validate(&config)?;
        let mut presets = BTreeSet::new();
        if config
            .rules
            .iter()
            .filter_map(|r| r.preset_id.as_ref())
            .any(|id| !presets.insert(id))
        {
            return Err("Duplicate built-in alert".into());
        }
        if config.revision != self.saved.config.revision {
            return Err("Alert settings changed in another window. Refresh and try again.".into());
        }
        config.revision = config
            .revision
            .checked_add(1)
            .ok_or("Alert revision overflow")?;
        let old = self.saved.config.clone();
        self.saved.config = config;
        if let Err(e) = self.persist() {
            self.saved.config = old;
            return Err(e);
        }
        self.load_failed = false;
        self.error = None;
        Ok(())
    }
    pub fn set_server(&mut self, id: Option<u16>) {
        if let Some(id) = id {
            if self
                .detected
                .as_ref()
                .is_some_and(|s| s["id"] == id.to_string())
            {
                return;
            }
            self.detected=Some(servers().into_iter().find(|s|s["id"]==id.to_string()).unwrap_or_else(||json!({"id":id.to_string(),"name":format!("Server {id}"),"region":"unknown"})));
        }
    }
    pub fn reset_session(&mut self, now: u64) {
        self.detected = None;
        self.entities.clear();
        self.session = now;
    }
    fn scope(&self) -> String {
        let server = if !self.saved.config.server.is_empty() {
            self.saved.config.server.clone()
        } else {
            self.detected
                .as_ref()
                .and_then(|s| s["id"].as_str())
                .map(String::from)
                .unwrap_or_else(|| format!("session-{}", self.session))
        };
        format!(
            "{}/{server}",
            effective_region(&self.saved.config, self.detected.as_ref())
        )
    }
    fn observed_for(&self, rule: &Rule) -> Option<&Observed> {
        let scope = self.scope();
        self.saved
            .observed
            .values()
            .filter(|o| {
                o.server == scope
                    && (rule.npc_id.is_some() && rule.npc_id == o.npc_id
                        || rule.event_id.is_some() && rule.event_id == o.event_id
                        || o.npc_id.is_some_and(|id| rule.npc_ids.contains(&id))
                        || o.event_id.is_some_and(|id| rule.event_ids.contains(&id)))
            })
            .max_by_key(|o| o.observed_ms)
    }
    /// The bundled calendar a built-in rule follows, unless the user took its schedule over.
    fn builtin_calendar(&self, rule: &Rule) -> Option<&'static crate::alert_catalogue::Calendar> {
        let id = rule
            .preset_id
            .as_ref()
            .filter(|_| !rule.schedule_override)?;
        let region = effective_region(&self.saved.config, self.detected.as_ref());
        let family = if ["kr", "tw"].contains(&region) {
            "twkr"
        } else {
            "global"
        };
        crate::alert_catalogue::data().calendars[family]
            .iter()
            .find(|c| &c.id == id)
    }
    /// Occurrences that may ring. Built-in calendars wait for a known server region.
    fn times(&self, rule: &Rule, center: u64) -> Vec<u64> {
        self.times_on(rule, center, false)
    }
    /// With `fallback`, built-in calendars also run on the custom clock before the server
    /// region is known. Countdown display only; delivery never uses the fallback.
    fn times_on(&self, rule: &Rule, center: u64, fallback: bool) -> Vec<u64> {
        if rule.preset_id.is_some() && !rule.schedule_override {
            let region = effective_region(&self.saved.config, self.detected.as_ref());
            if let Some(cal) = self.builtin_calendar(rule) {
                if region == "global" && !fallback {
                    return vec![];
                }
                return candidates(
                    &Schedule::Calendar {
                        times: cal
                            .minutes
                            .iter()
                            .map(|m| format!("{:02}:{:02}", m / 60, m % 60))
                            .collect(),
                        weekdays: if cal.weekdays.len() == 7 {
                            vec![]
                        } else {
                            cal.weekdays.clone()
                        },
                    },
                    zone(&effective_timezone(
                        &self.saved.config,
                        self.detected.as_ref(),
                    ))
                    .unwrap_or(chrono_tz::UTC),
                    center,
                );
            }
        }
        match &rule.schedule {
            Some(Schedule::Observed) => self
                .observed_for(rule)
                .and_then(|o| o.due_ms)
                .into_iter()
                .collect(),
            Some(s) => candidates(
                s,
                zone(
                    rule.timezone
                        .as_deref()
                        .unwrap_or(&self.saved.config.timezone),
                )
                .unwrap_or(chrono_tz::UTC),
                center,
            ),
            None => vec![],
        }
    }
    /// The next occurrence still ahead or open, leaving out user-skipped ones.
    fn next_due(&self, rule: &Rule, times: Vec<u64>, now: u64) -> Option<u64> {
        let length = rule.duration_seconds.saturating_mul(1000);
        times
            .into_iter()
            .filter(|at| {
                (*at >= now || at.saturating_add(length) > now)
                    && !self
                        .saved
                        .skipped
                        .contains_key(&format!("{}@{at}", rule.id))
            })
            .min()
    }
    fn upcoming(&self, rule: &Rule, now: u64) -> Value {
        let length = rule.duration_seconds.saturating_mul(1000);
        let due = self.next_due(rule, self.times(rule, now), now);
        let observation = matches!(rule.schedule, Some(Schedule::Observed))
            .then(|| self.observed_for(rule))
            .flatten();
        let state = if !rule.enabled {
            "disabled"
        } else if due.is_some_and(|at| at <= now && length > 0) {
            "open"
        } else if due.is_some() {
            "scheduled"
        } else {
            "unknown"
        };
        json!({"rule_id":rule.id,"name":rule.name,"category":rule.category,"due_ms":due,"remaining_ms":due.map(|d|d as i128-now as i128),"state":state,"basis":observation.map_or(if matches!(rule.schedule,Some(Schedule::Observed)){"Waiting for a game observation"}else{"Configured server schedule"},|o|o.basis.as_str()),"estimated":observation.is_some_and(|o|o.estimated),"source":Value::Null,"server":observation.map(|o|o.server.clone())})
    }
    /// Countdown for every catalogue entry, independent of notification settings. Uses the
    /// saved (customised) rule where one exists, else the entry's default. Built-in calendars
    /// run on the fallback clock until a server region is known, flagged as estimated.
    /// Observed bosses stay unknown until this app sees them in game.
    fn catalogue_upcoming(
        &self,
        config: &Config,
        entries: &[crate::alert_catalogue::Entry],
        now: u64,
    ) -> Vec<Value> {
        let region = effective_region(&self.saved.config, self.detected.as_ref());
        let timezone = effective_timezone(&self.saved.config, self.detected.as_ref());
        let fallback = region == "global";
        let mut rows: Vec<Value> = entries
            .iter()
            .map(|entry| {
                let rule = config
                    .rules
                    .iter()
                    .find(|r| r.preset_id.as_deref() == Some(entry.id.as_str()))
                    .unwrap_or(&entry.rule);
                let builtin = self.builtin_calendar(rule).is_some();
                let observed = !builtin && matches!(rule.schedule, Some(Schedule::Observed));
                let observation = observed.then(|| self.observed_for(rule)).flatten();
                let due = self.next_due(rule, self.times_on(rule, now, true), now);
                let length = rule.duration_seconds.saturating_mul(1000);
                let state = if due.is_some_and(|at| at <= now && length > 0) {
                    "open"
                } else if due.is_some() {
                    "scheduled"
                } else {
                    "unknown"
                };
                let (clock, zone, basis, estimated) = if builtin && fallback {
                    (
                        "fallback",
                        Some(timezone.clone()),
                        format!("Bundled calendar on the fallback clock ({timezone}); server not detected"),
                        true,
                    )
                } else if builtin {
                    (
                        "server",
                        Some(timezone.clone()),
                        "Bundled regional calendar on the server clock".into(),
                        false,
                    )
                } else if observed {
                    (
                        "observed",
                        None,
                        observation.map_or_else(
                            || "Waiting for a game observation".into(),
                            |o| o.basis.clone(),
                        ),
                        observation.is_some_and(|o| o.estimated),
                    )
                } else if rule.schedule.is_some() {
                    (
                        "own",
                        Some(rule.timezone.clone().unwrap_or_else(|| config.timezone.clone())),
                        "Your own schedule".into(),
                        false,
                    )
                } else {
                    ("none", None, "Time unknown".into(), false)
                };
                let notify = if !config.enabled || !rule.enabled {
                    "off"
                } else if builtin && fallback {
                    "waiting_for_clock"
                } else {
                    "on"
                };
                json!({"entry_id":entry.id,"rule_id":rule.id,"name":entry.name,"category":entry.category,"due_ms":due,"remaining_ms":due.map(|d|d as i128-now as i128),"state":state,"clock":clock,"timezone":zone,"basis":basis,"estimated":estimated,"notify":notify,"server":observation.map(|o|o.server.clone())})
            })
            .collect();
        rows.sort_by_key(|r| r["due_ms"].as_u64().unwrap_or(u64::MAX));
        rows
    }
    /// Where the calendar clock comes from: an explicit region, an explicit server, the
    /// server detected in game, or the custom fallback clock.
    fn clock_source(&self) -> &'static str {
        let config = &self.saved.config;
        if effective_region(config, self.detected.as_ref()) == "global" {
            "fallback"
        } else if config.region != "global" {
            "region"
        } else if !config.server.is_empty() {
            "server"
        } else {
            "detected"
        }
    }
    pub fn status(&self, now: u64) -> Value {
        let region = effective_region(&self.saved.config, self.detected.as_ref());
        let timezone = effective_timezone(&self.saved.config, self.detected.as_ref());
        let faction = effective_faction(&self.saved.config, self.detected.as_ref());
        let mut config = self.saved.config.clone();
        let _ = refresh_rules(&mut config, self.detected.as_ref());
        let mut upcoming: Vec<Value> = self
            .saved
            .config
            .rules
            .iter()
            .map(|r| self.upcoming(r, now))
            .collect();
        upcoming.extend(self.saved.snoozes.iter().filter(|d|d.due_ms>=now&&!self.saved.claims.contains_key(&d.id)).map(|d|json!({"rule_id":d.id,"name":d.name,"category":d.category,"due_ms":d.due_ms,"remaining_ms":d.due_ms-now,"state":"scheduled","basis":"Snoozed reminder","estimated":false,"source":null,"server":null})));
        upcoming.sort_by_key(|r| r["due_ms"].as_u64().unwrap_or(u64::MAX));
        let scope = self.scope();
        let observed: Vec<_> = self
            .saved
            .observed
            .values()
            .filter(|o| o.server == scope && o.observed_ms.saturating_add(31 * DAY) > now)
            .collect();
        let catalogue = crate::alert_catalogue::entries(region, &timezone);
        let catalogue_upcoming = self.catalogue_upcoming(&config, &catalogue, now);
        let mut dashboard = json!({"now_ms":now,"config":config,"upcoming":upcoming,"catalogue_upcoming":catalogue_upcoming,"active":self.active(now),"history":self.saved.history.iter().rev().collect::<Vec<_>>(),"observed":observed,"regions":regions(),"servers":servers(),"detected_server":self.detected,"templates":templates(),"catalogue":catalogue,"effective_region":region,"effective_timezone":timezone,"effective_faction":faction,"clock_ready":region!="global","clock_estimated":region=="global","clock_source":self.clock_source(),"error":self.root.as_ref().and_then(|root|self.storage.as_ref().and_then(|storage|storage.error_for(&root.join("alerts.json")))).or_else(||self.error.clone())});
        dashboard["game_running"] = json!(self.game_running);
        dashboard["delivery_paused"] = json!(self.delivery_paused(now));
        dashboard["server_status"] = json!(self.server_status.at(now));
        dashboard
    }
    pub fn active(&self, now: u64) -> Vec<Value> {
        self.saved
            .history
            .iter()
            .rev()
            .filter(|d| {
                d.status == "delivered"
                    && d.popup
                    && d.fired_ms.saturating_add(15000) > now
                    && (matches!(d.phase.as_str(), "test" | "recovery")
                        || self.delivery_paused(now).is_none())
            })
            .take(5)
            .map(|d| serde_json::to_value(d).unwrap_or(Value::Null))
            .collect()
    }
    pub fn background_sound(&self) -> bool {
        self.saved.config.background_sound
            || (self.game_running == Some(false) && self.saved.config.alert_when_game_closed)
    }
    fn push(&mut self, d: Delivery) {
        self.saved.history.push_back(d);
        while self.saved.history.len() > 500 {
            self.saved.history.pop_front();
        }
    }
    pub fn tick(&mut self, now: u64) -> Vec<Delivery> {
        if self.load_failed {
            return vec![];
        }
        let old = self.saved.clone();
        let mut pending = BTreeMap::<String, Delivery>::new();
        let previous = self.saved.last_tick_ms.min(now);
        // Watch an actual scheduled notice first. Seeing an old completed notice
        // on startup or enabling this option afterwards must never ring.
        if !self.saved.config.notify_server_back {
            self.saved.maintenance_watch = None;
        } else if self.server_status.fresh(now)
            && matches!(
                effective_region(&self.saved.config, self.detected.as_ref()),
                "global" | "latam" | "eu" | "na-east" | "na-west" | "asia"
            )
        {
            if let Some(m) = &self.server_status.maintenance {
                if !m.completed
                    && now < m.ends_ms.saturating_add(DAY)
                    && m.starts_ms <= now.saturating_add(14 * DAY)
                {
                    self.saved.maintenance_watch = Some(m.starts_ms);
                } else if m.completed && self.saved.maintenance_watch == Some(m.starts_ms) {
                    let id = format!("maintenance-complete@{}", m.starts_ms);
                    if now < m.ends_ms.saturating_add(DAY) && !self.saved.claims.contains_key(&id) {
                        pending.insert(
                            id.clone(),
                            Delivery {
                                id,
                                rule_id: "maintenance-complete".into(),
                                name: "Official maintenance complete".into(),
                                category: "custom".into(),
                                due_ms: now,
                                fired_ms: now,
                                lead_seconds: 0,
                                phase: "recovery".into(),
                                sound: "chime".into(),
                                volume: 1.,
                                popup: true,
                                status: "delivered".into(),
                            },
                        );
                    }
                    self.saved.maintenance_watch = None;
                }
            }
        }
        if self.saved.config.enabled {
            for rule in &self.saved.config.rules {
                if !rule.enabled {
                    continue;
                }
                for lead in &rule.lead_seconds {
                    for due in self.times(rule, now.saturating_add(lead * 1000)) {
                        let fire = due.saturating_sub(lead * 1000);
                        let occurrence = format!("{}@{due}", rule.id);
                        let id = format!("{occurrence}:{lead}");
                        // A newly opened in-game list can reveal an upcoming boss
                        // after its lead time has passed. Ring once on that fresh
                        // observation, without replaying old data after sleep/startup.
                        let learned_in_window = matches!(rule.schedule, Some(Schedule::Observed))
                            && due > now
                            && self.observed_for(rule).is_some_and(|o| {
                                o.due_ms == Some(due)
                                    && o.observed_ms > previous
                                    && o.observed_ms >= fire
                                    && o.observed_ms <= now
                                    && now - o.observed_ms <= GRACE
                            });
                        if fire > now
                            || (!learned_in_window && (now - fire > GRACE || fire <= previous))
                            || self.saved.claims.contains_key(&id)
                            || self.saved.skipped.contains_key(&occurrence)
                        {
                            continue;
                        }
                        let d = Delivery {
                            id,
                            rule_id: rule.id.clone(),
                            name: rule.name.clone(),
                            category: rule.category.clone(),
                            due_ms: due,
                            fired_ms: now,
                            lead_seconds: *lead,
                            phase: if *lead == 0 { "start" } else { "before" }.into(),
                            sound: rule.sound.clone(),
                            volume: rule.volume,
                            popup: rule.popup,
                            status: "delivered".into(),
                        };
                        // After a delayed tick, only the latest eligible phase of one occurrence is delivered.
                        if pending
                            .get(&occurrence)
                            .is_none_or(|old| old.lead_seconds > *lead)
                        {
                            pending.insert(occurrence, d);
                        }
                    }
                }
            }
            for d in &self.saved.snoozes {
                if d.due_ms <= now
                    && now - d.due_ms <= GRACE
                    && !self.saved.claims.contains_key(&d.id)
                {
                    let mut d = d.clone();
                    d.fired_ms = now;
                    pending.insert(d.id.clone(), d);
                }
            }
        }
        self.saved.last_tick_ms = now;
        let mut quiet_config = self.saved.config.clone();
        quiet_config.timezone = effective_timezone(&self.saved.config, self.detected.as_ref());
        let is_quiet = quiet(&quiet_config, now);
        let muted = self
            .saved
            .config
            .muted_until_ms
            .is_some_and(|until| until > now);
        let mut deliveries = Vec::new();
        let paused = self.delivery_paused(now);
        for mut d in pending.into_values().take(32) {
            self.saved.claims.insert(d.id.clone(), now);
            if let Some(reason) = paused.filter(|_| d.phase != "recovery") {
                d.status = reason.into();
            } else if muted {
                d.status = "muted".into();
            } else if is_quiet {
                d.status = "quiet".into();
            } else {
                let mut sounding = d.clone();
                sounding.volume *= self.saved.config.volume;
                deliveries.push(sounding);
            }
            self.push(d);
        }
        self.saved
            .snoozes
            .retain(|d| d.due_ms.saturating_add(GRACE) >= now);
        self.saved
            .claims
            .retain(|_, at| at.saturating_add(31 * DAY) > now);
        self.saved
            .skipped
            .retain(|_, at| at.saturating_add(DAY) > now);
        while self.saved.claims.len() > 20_000 {
            if let Some(key) = self.saved.claims.keys().next().cloned() {
                self.saved.claims.remove(&key);
            }
        }
        if self.saved.history.len() != old.history.len()
            || self.saved.claims != old.claims
            || self.saved.snoozes.len() != old.snoozes.len()
            || self.saved.maintenance_watch != old.maintenance_watch
        {
            if let Err(e) = self.persist() {
                self.saved = old;
                self.saved.last_tick_ms = previous;
                self.error = Some(e);
                return vec![];
            }
        }
        deliveries
    }
    pub fn action(
        &mut self,
        action: &str,
        id: Option<&str>,
        seconds: Option<u64>,
        now: u64,
    ) -> Result<(), String> {
        if self.load_failed {
            return Err(
                "Saved alerts could not be loaded. Save valid settings before changing alerts."
                    .into(),
            );
        }
        let old = self.saved.clone();
        match action {
            "dismiss" | "snooze" => {
                let id = id.ok_or("Choose an alert")?;
                let original = self
                    .saved
                    .history
                    .iter()
                    .find(|d| d.id == id)
                    .cloned()
                    .ok_or("Alert no longer available")?;
                if action == "snooze" {
                    if original.status == "snoozed" {
                        return Err("This reminder is already snoozed".into());
                    }
                    let delay = seconds
                        .filter(|n| (60..=86400).contains(n))
                        .ok_or("Snooze must be 1 minute to 24 hours")?;
                    if self.saved.snoozes.len() >= 100 {
                        return Err("Too many snoozed alerts".into());
                    }
                    let mut next = original;
                    next.due_ms = now.saturating_add(delay * 1000);
                    next.id = format!("{}:snooze:{}", next.rule_id, next.due_ms);
                    next.phase = "snooze".into();
                    next.lead_seconds = 0;
                    next.status = "delivered".into();
                    self.saved.snoozes.push(next);
                }
                if let Some(d) = self.saved.history.iter_mut().find(|d| d.id == id) {
                    d.status = if action == "snooze" {
                        "snoozed"
                    } else {
                        "dismissed"
                    }
                    .into();
                }
            }
            "dismiss_all" => {
                for d in &mut self.saved.history {
                    if d.status == "delivered" {
                        d.status = "dismissed".into();
                    }
                }
            }
            "clear_history" => self.saved.history.clear(),
            "mute" => {
                let seconds = seconds
                    .filter(|n| (60..=86400).contains(n))
                    .ok_or("Mute must be 1 minute to 24 hours")?;
                self.saved.config.muted_until_ms = Some(now.saturating_add(seconds * 1000));
                self.saved.config.revision += 1;
            }
            "unmute" => {
                self.saved.config.muted_until_ms = None;
                self.saved.config.revision += 1;
            }
            "skip" => {
                let rule = self
                    .saved
                    .config
                    .rules
                    .iter()
                    .find(|r| Some(r.id.as_str()) == id)
                    .ok_or("Unknown alert rule")?;
                let due = self
                    .times(rule, now)
                    .into_iter()
                    .filter(|at| *at >= now)
                    .min()
                    .ok_or("No known occurrence to skip")?;
                self.saved.skipped.insert(format!("{}@{due}", rule.id), due);
            }
            _ => return Err("Unknown alert action".into()),
        }
        if let Err(e) = self.persist() {
            self.saved = old;
            return Err(e);
        }
        Ok(())
    }
    pub fn observe(&mut self, events: &[CombatEvent], catalogue: &Catalogue, now: u64) {
        let scope = self.scope();
        let mut dirty = false;
        for e in events {
            if e.kind == "zone" {
                self.entities.clear();
            }
            let mut observation = None;
            if e.kind == "field_boss_state" {
                if let Some(boss) = crate::alert_catalogue::data()
                    .bosses
                    .iter()
                    .find(|b| b.event_id == e.skill && Some(b.map_id) == e.zone_id)
                {
                    let alive = e.instance == 1;
                    let (due, _) = clock(e.amount, now);
                    observation = Some(Observed {
                        id: format!("field-{}", e.skill),
                        name: boss.name.clone(),
                        category: if boss.scheduled {
                            "world_boss"
                        } else {
                            "field_boss"
                        }
                        .into(),
                        npc_id: Some(boss.npc_id),
                        event_id: Some(e.skill),
                        due_ms: if alive {
                            None
                        } else {
                            due.filter(|due| *due > now)
                        },
                        observed_ms: now,
                        server: scope.clone(),
                        state: if alive { "Spawned" } else { "Respawning" }.into(),
                        basis: if alive {
                            "In-game Field Boss list: alive when checked"
                        } else {
                            "In-game Field Boss list: next spawn time"
                        }
                        .into(),
                        estimated: false,
                    });
                }
            }
            if matches!(e.kind.as_str(), "field_event" | "field_event_snapshot") {
                let (due, basis) = clock(e.amount, now);
                let boss = crate::alert_catalogue::data()
                    .bosses
                    .iter()
                    .find(|b| b.event_id == e.skill);
                let family = if ["kr", "tw"].contains(&effective_region(
                    &self.saved.config,
                    self.detected.as_ref(),
                )) {
                    "twkr"
                } else {
                    "global"
                };
                let event_name = crate::alert_catalogue::data().calendars[family]
                    .iter()
                    .find(|c| c.event_ids.contains(&e.skill))
                    .map(|c| match c.id.as_str() {
                        "festival" => "Shugo Festival",
                        "invasion" => "Invasion",
                        _ => "Event",
                    });
                let npc_id = boss.map_or(e.skill, |b| b.npc_id);
                let npc = catalogue
                    .npcs
                    .binary_search_by_key(&npc_id, |n| n.id)
                    .ok()
                    .map(|at| &catalogue.npcs[at])
                    .filter(|n| n.boss || boss.is_some());
                observation = Some(Observed {
                    id: format!("field-{}", e.skill),
                    name: npc.map_or_else(
                        || {
                            event_name
                                .map(String::from)
                                .unwrap_or_else(|| format!("Field timer #{}", e.skill))
                        },
                        |n| n.name.clone(),
                    ),
                    category: if boss.is_some_and(|b| b.scheduled) {
                        "world_boss"
                    } else if npc.is_some() {
                        "field_boss"
                    } else {
                        "event"
                    }
                    .into(),
                    npc_id: npc.map(|n| n.id),
                    event_id: Some(e.skill),
                    due_ms: due,
                    observed_ms: now,
                    server: scope.clone(),
                    state: format!("Game state {}", e.instance),
                    basis: basis.into(),
                    estimated: true,
                });
            }
            if e.kind == "spawn" {
                self.entities.remove(&e.target);
                if let Ok(at) = catalogue.npcs.binary_search_by_key(&e.skill, |n| n.id) {
                    let npc = &catalogue.npcs[at];
                    if npc.boss
                        || crate::alert_catalogue::data()
                            .bosses
                            .iter()
                            .any(|b| b.npc_id == npc.id)
                    {
                        self.entities.insert(e.target, e.skill);
                        observation = Some(Observed {
                            id: format!("npc-{}", npc.id),
                            name: npc.name.clone(),
                            category: if crate::alert_catalogue::data()
                                .bosses
                                .iter()
                                .any(|b| b.npc_id == npc.id && b.scheduled)
                            {
                                "world_boss"
                            } else {
                                "field_boss"
                            }
                            .into(),
                            npc_id: Some(npc.id),
                            event_id: None,
                            due_ms: Some(now),
                            observed_ms: now,
                            server: scope.clone(),
                            state: "Spawned".into(),
                            basis: "Observed boss spawn".into(),
                            estimated: false,
                        });
                    }
                }
            }
            if e.kind == "death" || e.kind == "hp" && e.current_hp == Some(0) {
                if let Some(npc_id) = self.entities.get(&e.target) {
                    let key = format!("{scope}:npc-{npc_id}");
                    if let Some(old) = self.saved.observed.get(&key) {
                        if old.state != "Defeated" {
                            let mut next = old.clone();
                            next.state = "Defeated".into();
                            next.observed_ms = now;
                            let interval = self
                                .saved
                                .config
                                .rules
                                .iter()
                                .find(|r| r.npc_id == Some(*npc_id) && r.respawn_seconds.is_some())
                                .and_then(|r| r.respawn_seconds);
                            next.due_ms =
                                interval.map(|seconds| now.saturating_add(seconds * 1000));
                            next.estimated = interval.is_some();
                            next.basis = if interval.is_some() {
                                "User respawn interval after observed defeat"
                            } else {
                                "Observed defeat; respawn time unknown"
                            }
                            .into();
                            observation = Some(next);
                        }
                    }
                }
            }
            if let Some(o) = observation {
                self.saved
                    .observed
                    .insert(format!("{}:{}", o.server, o.id), o);
                dirty = true;
            }
        }
        while self.entities.len() > 8192 {
            if let Some(key) = self.entities.keys().next().copied() {
                self.entities.remove(&key);
            }
        }
        while self.saved.observed.len() > 1024 {
            if let Some(key) = self
                .saved
                .observed
                .iter()
                .min_by_key(|(_, o)| o.observed_ms)
                .map(|(k, _)| k.clone())
            {
                self.saved.observed.remove(&key);
            }
        }
        if dirty && !self.load_failed {
            let result = if let (Some(storage), Some(root)) = (&self.storage, &self.root) {
                storage.checkpoint(crate::storage::Write::json(
                    root.join("alerts.json"),
                    self.saved.clone(),
                ))
            } else {
                self.persist()
            };
            if let Err(e) = result {
                self.error = Some(e);
            }
        }
    }
    pub fn test_delivery(
        &mut self,
        sound: &str,
        volume: f64,
        popup: bool,
        now: u64,
    ) -> Result<Delivery, String> {
        if self.load_failed {
            return Err(
                "Saved alerts could not be loaded. Save valid settings before testing alerts."
                    .into(),
            );
        }
        if !SOUNDS.contains(&sound) || !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err("Invalid sound preview".into());
        }
        let d = Delivery {
            id: format!("test-{now}"),
            rule_id: "test".into(),
            name: "Test notification".into(),
            category: "custom".into(),
            due_ms: now,
            fired_ms: now,
            lead_seconds: 0,
            phase: "test".into(),
            sound: sound.into(),
            volume,
            popup,
            status: "delivered".into(),
        };
        let old = self.saved.clone();
        self.push(d.clone());
        if let Err(e) = self.persist() {
            self.saved = old;
            return Err(e);
        }
        let mut sounding = d;
        sounding.volume *= self.saved.config.volume;
        Ok(sounding)
    }
}
/// Accept only a unique supported absolute clock within a plausible observation horizon.
/// Unrecognized values stay raw/unknown; no countdown is invented from a packet state.
fn clock(raw: u64, now: u64) -> (Option<u64>, &'static str) {
    let formats = [
        (Some(raw), "Game clock interpreted as Unix milliseconds"),
        (
            raw.checked_mul(1000),
            "Game clock interpreted as Unix seconds",
        ),
        (
            raw.checked_div(10000)
                .and_then(|n| n.checked_sub(11_644_473_600_000)),
            "Game clock interpreted as FILETIME",
        ),
        (
            raw.checked_div(10000)
                .and_then(|n| n.checked_sub(62_135_596_800_000)),
            "Game clock interpreted as UTC ticks",
        ),
    ];
    let mut found: Vec<_> = formats
        .into_iter()
        .filter_map(|(at, basis)| {
            at.filter(|at| at.abs_diff(now) <= 31 * DAY)
                .map(|at| (at, basis))
        })
        .collect();
    found.dedup_by_key(|(at, _)| *at);
    if found.len() == 1 {
        (Some(found[0].0), found[0].1)
    } else {
        (None, "Observed game state; absolute time not recognized")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rule(schedule: Schedule) -> Rule {
        Rule {
            id: "reminder".into(),
            name: "Test event".into(),
            category: "event".into(),
            enabled: true,
            favorite: false,
            schedule: Some(schedule),
            timezone: None,
            lead_seconds: vec![60, 0],
            sound: "chime".into(),
            volume: 0.5,
            popup: true,
            duration_seconds: 600,
            npc_id: None,
            event_id: None,
            notes: String::new(),
            respawn_seconds: None,
            preset_id: None,
            npc_ids: vec![],
            event_ids: vec![],
            schedule_override: false,
        }
    }
    fn engine(schedule: Schedule) -> Alerts {
        let mut a = Alerts::default();
        a.saved.config.enabled = true;
        a.saved.config.rules.push(rule(schedule));
        a
    }
    fn stamp(date: &str) -> u64 {
        chrono::DateTime::parse_from_rfc3339(date)
            .unwrap()
            .timestamp_millis() as u64
    }
    #[test]
    fn closed_game_is_opt_in_and_suppressed_occurrences_do_not_replay() {
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        a.set_game_running(false);
        assert_eq!(a.status(100000)["delivery_paused"], "game_closed");
        assert!(a.tick(100000).is_empty());
        assert_eq!(a.saved.history.back().unwrap().status, "game_closed");
        a.set_game_running(true);
        assert!(a.tick(100001).is_empty());
        let mut b = engine(Schedule::Once { at_ms: 100000 });
        b.set_game_running(false);
        b.saved.config.alert_when_game_closed = true;
        b.saved.config.background_sound = false;
        assert!(b.background_sound());
        assert_eq!(b.tick(100000).len(), 1);
    }
    #[test]
    fn maintenance_overrides_closed_game_opt_in_and_claims_snoozes() {
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        a.saved.config.server = "1401".into();
        a.saved.config.alert_when_game_closed = true;
        a.set_game_running(false);
        let d = a.tick(100000).remove(0);
        a.action("snooze", Some(&d.id), Some(60), 100000).unwrap();
        let server = crate::server_status::Server {
            id: "1401".into(),
            name: "Siel".into(),
            region: "latam".into(),
            status: "maintenance".into(),
            population: None,
            character_creation_open: None,
        };
        a.update_server_status(Ok(vec![server.clone()]), "public", 159000);
        assert_eq!(a.status(160000)["delivery_paused"], "server_down");
        assert!(a.tick(160000).is_empty());
        assert_eq!(a.saved.history.back().unwrap().status, "server_down");
        assert!(a.active(160000).is_empty());
        let mut online = server;
        online.status = "online".into();
        a.update_server_status(Ok(vec![online]), "public", 160001);
        assert!(a.tick(160001).is_empty());
        // Explicit previews continue to work with the game closed or server down.
        a.test_delivery("chime", 0.5, true, 160002).unwrap();
        assert_eq!(a.active(160002).len(), 1);
    }
    #[test]
    fn closed_game_preference_migrates_and_suppressed_claim_survives_restart() {
        let root = std::env::temp_dir().join(format!(
            "aion-alert-game-{}-{}",
            std::process::id(),
            crate::wall_clock()
        ));
        fs::create_dir_all(&root).unwrap();
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        let mut old = serde_json::to_value(&a.saved).unwrap();
        old["config"]
            .as_object_mut()
            .unwrap()
            .remove("alert_when_game_closed");
        fs::write(root.join("alerts.json"), serde_json::to_vec(&old).unwrap()).unwrap();
        a.initialize(root.clone(), &json!({}), 99000).unwrap();
        assert!(!a.saved.config.alert_when_game_closed);
        a.set_game_running(false);
        assert!(a.tick(100000).is_empty());
        let mut b = Alerts::default();
        b.initialize(root.clone(), &json!({}), 100001).unwrap();
        b.set_game_running(true);
        assert!(b.tick(100001).is_empty());
        assert_eq!(b.saved.history.back().unwrap().status, "game_closed");
        fs::remove_file(root.join("alerts.json")).unwrap();
        fs::remove_dir(root).unwrap();
    }
    fn maintenance(completed: bool) -> crate::server_status::Maintenance {
        crate::server_status::Maintenance {
            title: "Maintenance".into(),
            url: "https://aion2.plaync.com/notice".into(),
            starts_ms: 100000,
            ends_ms: 200000,
            completed,
        }
    }
    #[test]
    fn recovery_requires_watched_notice_and_official_completion_not_expected_end() {
        let mut a = Alerts::default();
        a.saved.config.notify_server_back = true;
        a.set_game_running(false);
        a.update_maintenance(Ok(Some(maintenance(false))), 100000);
        assert!(a.tick(100000).is_empty());
        assert_eq!(a.saved.maintenance_watch, Some(100000));
        assert!(a.tick(200001).is_empty());
        assert_eq!(a.server_status.at(200001).servers[0].status, "unknown");
        a.update_maintenance(Ok(Some(maintenance(true))), 210000);
        let d = a.tick(210000).remove(0);
        assert_eq!(d.phase, "recovery");
        assert_eq!(d.status, "delivered");
        assert!(!a.saved.config.enabled);
        assert_eq!(a.active(210000).len(), 1);
        assert!(a.tick(210001).is_empty());
        let mut b = Alerts::default();
        b.saved.config.notify_server_back = true;
        b.update_maintenance(Ok(Some(maintenance(true))), 210000);
        assert!(b.tick(210000).is_empty());
    }
    #[test]
    fn recovery_claim_and_watch_persist_and_failed_writes_cannot_deliver() {
        let root = std::env::temp_dir().join(format!(
            "aion-recovery-{}-{}",
            std::process::id(),
            crate::wall_clock()
        ));
        fs::create_dir_all(&root).unwrap();
        let mut a = Alerts::default();
        a.initialize(root.clone(), &json!({}), 90000).unwrap();
        a.saved.config.notify_server_back = true;
        a.update_maintenance(Ok(Some(maintenance(false))), 100000);
        a.tick(100000);
        let mut b = Alerts::default();
        b.initialize(root.clone(), &json!({}), 150000).unwrap();
        assert_eq!(b.saved.maintenance_watch, Some(100000));
        b.set_game_running(false);
        b.update_maintenance(Ok(Some(maintenance(true))), 210000);
        fs::remove_file(root.join("alerts.json")).unwrap();
        fs::create_dir(root.join("alerts.json")).unwrap();
        assert!(b.tick(210000).is_empty());
        assert_eq!(b.saved.maintenance_watch, Some(100000));
        fs::remove_dir(root.join("alerts.json")).unwrap();
        assert_eq!(b.tick(210001).len(), 1);
        let mut c = Alerts::default();
        c.initialize(root.clone(), &json!({}), 210002).unwrap();
        c.update_maintenance(Ok(Some(maintenance(true))), 210002);
        assert!(c.tick(210002).is_empty());
        assert_eq!(c.saved.history.back().unwrap().phase, "recovery");
        fs::remove_file(root.join("alerts.json")).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn recovery_respects_mute_and_cannot_replay_after_unmuting() {
        let mut a = Alerts::default();
        a.saved.config.notify_server_back = true;
        a.update_maintenance(Ok(Some(maintenance(false))), 100000);
        a.tick(100000);
        a.saved.config.muted_until_ms = Some(300000);
        a.update_maintenance(Ok(Some(maintenance(true))), 210000);
        assert!(a.tick(210000).is_empty());
        assert_eq!(a.saved.history.back().unwrap().status, "muted");
        a.saved.config.muted_until_ms = None;
        assert!(a.tick(210001).is_empty());
    }
    #[test]
    fn field_boss_list_drives_dartan_and_kashapa_reminders_without_stale_alive_state() {
        let now = stamp("2026-10-20T19:13:00Z");
        let mut a = Alerts::default();
        a.saved.config.enabled = true;
        a.saved.config.region = "latam".into();
        a.saved.config.server = "2403".into();
        for npc in [2400854, 2400855] {
            let entry = crate::alert_catalogue::entries("latam", "America/Sao_Paulo")
                .into_iter()
                .find(|e| e.rule.npc_id == Some(npc))
                .unwrap();
            let mut rule = entry.rule;
            rule.enabled = true;
            rule.lead_seconds = vec![300];
            a.saved.config.rules.push(rule);
        }
        assert!(a.tick(now - 1000).is_empty());
        let mut frame = vec![0x01, 0x91, 0, 0];
        frame.extend_from_slice(&1110u32.to_le_bytes());
        frame.push(2);
        for (place, due) in [(111023u32, now + 600_000), (111024, now + 240_000)] {
            frame.push(0); // Not alive; the time is the game's next spawn.
            let mut value = place;
            while value >= 128 {
                frame.push(value as u8 | 128);
                value >>= 7;
            }
            frame.push(value as u8);
            frame.extend_from_slice(&due.to_le_bytes());
        }
        let mut decoder = companion_core::wire::Decoder::default();
        assert!(decoder.decode(&frame).is_empty());
        assert_eq!(decoder.observations.len(), 2);
        a.observe(&decoder.observations, &Catalogue::default(), now);
        let status = a.status(now);
        assert_eq!(countdown(&status, "field-2400855")["due_ms"], now + 240_000);
        assert_eq!(countdown(&status, "field-2400854")["due_ms"], now + 600_000);
        assert!(status["observed"]
            .as_array()
            .unwrap()
            .iter()
            .all(|o| o["state"] != "Spawned"));
        // Learning the countdown inside its five-minute lead still alerts once.
        let deliveries = a.tick(now);
        assert_eq!(deliveries.len(), 1);
        assert_eq!(deliveries[0].name, "Silent Dartan");
        a.observe(&decoder.observations, &Catalogue::default(), now + 500);
        assert!(a.tick(now + 500).is_empty());
        let deliveries = a.tick(now + 300_000);
        assert_eq!(deliveries.len(), 1);
        assert_eq!(deliveries[0].name, "Soul Ruler Kashapa");
    }
    #[test]
    fn old_observed_countdowns_do_not_backfill_advance_reminders() {
        let now = stamp("2026-10-20T19:13:00Z");
        let mut a = engine(Schedule::Observed);
        a.saved.config.rules[0].event_id = Some(111024);
        a.saved.config.rules[0].lead_seconds = vec![300];
        a.saved.config.rules[0].duration_seconds = 0;
        a.saved.last_tick_ms = now - 1000;
        let mut timer = CombatEvent::new("field_event");
        timer.skill = 111024;
        timer.amount = now + 240_000;
        a.observe(&[timer], &Catalogue::default(), now - 120_000);
        assert!(a.tick(now).is_empty());
    }
    #[test]
    fn complete_catalogue_is_named_unique_and_covers_every_boss() {
        let mut a = Alerts::default();
        let dashboard = a.status(stamp("2026-10-18T12:00:00Z"));
        let rows = dashboard["catalogue"].as_array().unwrap();
        assert_eq!(rows.len(), 79);
        assert_eq!(rows.iter().filter(|r| r["category"] == "event").count(), 3);
        assert_eq!(
            rows.iter()
                .filter(|r| r["category"] == "world_boss")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|r| r["category"] == "field_boss")
                .count(),
            73
        );
        let mut ids = BTreeSet::new();
        let mut npcs = BTreeSet::new();
        for row in rows {
            assert!(ids.insert(row["id"].as_str().unwrap()));
            assert!(!row["name"].as_str().unwrap().is_empty());
            for npc in row["members"].as_array().unwrap() {
                npcs.insert(npc["id"].as_u64().unwrap());
            }
            let mut c = Config::default();
            c.rules
                .push(serde_json::from_value(row["rule"].clone()).unwrap());
            validate(&c).unwrap();
        }
        assert_eq!(npcs.len(), 85);
        assert_eq!(dashboard["clock_ready"], false);
        a.set_server(Some(2401));
        let status = a.status(1);
        assert_eq!(status["effective_region"], "latam");
        assert_eq!(status["effective_timezone"], "America/Sao_Paulo");
        assert_eq!(status["effective_faction"], "asmodian");
        assert_eq!(status["clock_ready"], true);
    }
    #[test]
    fn presets_enable_without_naming_and_follow_region_without_losing_reminders() {
        assert_eq!(
            crate::alert_catalogue::entries("latam", "America/Sao_Paulo")
                .into_iter()
                .find(|r| r.id == "festival")
                .unwrap()
                .name,
            "Shugo Festival"
        );
        let mut a = Alerts::default();
        let entry = crate::alert_catalogue::entries("latam", "America/Sao_Paulo")
            .into_iter()
            .find(|r| r.id == "watcher-kaira")
            .unwrap();
        let mut rule = entry.rule;
        rule.name = String::new();
        rule.enabled = true;
        rule.lead_seconds = vec![600, 0];
        rule.sound = "bell".into();
        let mut config = Config::default();
        config.enabled = true;
        config.region = "latam".into();
        config.timezone = "America/Sao_Paulo".into();
        config.rules.push(rule);
        a.configure(serde_json::to_value(config).unwrap()).unwrap();
        assert_eq!(a.saved.config.rules[0].name, "Watcher Kaira");
        let at = stamp("2026-10-18T13:00:00Z"); // 10:00 in South America
        assert_eq!(a.tick(at).len(), 1);
        let mut config = a.saved.config.clone();
        config.region = "tw".into();
        config.timezone = "Asia/Taipei".into();
        a.configure(serde_json::to_value(config).unwrap()).unwrap();
        let rule = &a.saved.config.rules[0];
        assert_eq!(rule.lead_seconds, vec![600, 0]);
        assert_eq!(rule.sound, "bell");
        assert!(
            matches!(&rule.schedule,Some(Schedule::Calendar{times,..}) if times==&vec!["01:00","05:00","09:00","13:00","17:00","21:00"])
        );
        let mut duplicate = a.saved.config.clone();
        let mut second = duplicate.rules[0].clone();
        second.id = "another-id".into();
        duplicate.rules.push(second);
        assert!(a
            .configure(serde_json::to_value(duplicate).unwrap())
            .is_err());
        let mut custom = a.saved.config.clone();
        custom.rules[0].schedule_override = true;
        custom.rules[0].schedule = Some(Schedule::Once { at_ms: at + 60000 });
        a.configure(serde_json::to_value(custom).unwrap()).unwrap();
        assert!(matches!(
            a.saved.config.rules[0].schedule,
            Some(Schedule::Once { .. })
        ));
    }
    #[test]
    fn built_in_calendar_waits_for_identity_and_field_ids_resolve_named_unclassified_bosses() {
        let mut a = Alerts::default();
        let entry = crate::alert_catalogue::entries("global", "UTC")
            .into_iter()
            .find(|r| r.id == "festival")
            .unwrap();
        let mut r = entry.rule;
        r.enabled = true;
        r.lead_seconds = vec![0];
        a.saved.config.enabled = true;
        a.saved.config.rules.push(r);
        let now = stamp("2026-10-18T12:00:00Z");
        assert!(a.tick(now).is_empty());
        a.set_server(Some(1401));
        assert_eq!(a.status(now)["clock_ready"], true);
        assert_eq!(a.tick(now + 3600000).len(), 1);
        let npc = crate::alert_catalogue::data()
            .bosses
            .iter()
            .find(|b| b.npc_id == 2101217)
            .unwrap();
        let catalog = Catalogue {
            npcs: vec![companion_core::combat::NpcInfo {
                id: npc.npc_id,
                name: npc.name.clone(),
                boss: false,
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut e = CombatEvent::new("field_event");
        e.skill = npc.event_id;
        e.amount = now + 60000;
        a.observe(&[e], &catalog, now);
        let status = a.status(now);
        assert_eq!(status["observed"][0]["name"], "Agglomerated Verenom");
        assert_eq!(status["observed"][0]["npc_id"], 2101217);
        assert_eq!(status["observed"][0]["due_ms"], now + 60000);
        let mut spawn = CombatEvent::new("spawn");
        spawn.skill = npc.npc_id;
        spawn.target = 99;
        a.observe(&[spawn], &catalog, now + 1000);
        assert_eq!(a.entities.get(&99), Some(&2101217));
    }
    fn countdown<'a>(status: &'a Value, entry: &str) -> &'a Value {
        status["catalogue_upcoming"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["entry_id"] == entry)
            .unwrap()
    }
    #[test]
    fn catalogue_countdowns_run_with_notifications_off_on_an_explicit_fallback_clock() {
        let mut a = Alerts::default();
        let now = stamp("2026-10-18T12:00:00Z");
        let status = a.status(now);
        assert!(!a.saved.config.enabled);
        assert!(status["upcoming"].as_array().unwrap().is_empty());
        assert_eq!(status["catalogue_upcoming"].as_array().unwrap().len(), 79);
        assert_eq!(status["clock_ready"], false);
        assert_eq!(status["clock_estimated"], true);
        assert_eq!(status["clock_source"], "fallback");
        assert!(status["detected_server"].is_null());
        // Watcher Kaira runs 01:00, 04:00, … on the custom clock, UTC by default.
        let kaira = countdown(&status, "watcher-kaira");
        assert_eq!(kaira["due_ms"], stamp("2026-10-18T13:00:00Z"));
        assert_eq!(kaira["remaining_ms"], 3_600_000);
        assert_eq!(kaira["state"], "scheduled");
        assert_eq!(kaira["clock"], "fallback");
        assert_eq!(kaira["timezone"], "UTC");
        assert_eq!(kaira["estimated"], true);
        assert_eq!(kaira["notify"], "off");
        assert!(kaira["basis"]
            .as_str()
            .unwrap()
            .contains("server not detected"));
        // An open window counts as open, not as missing.
        let festival = countdown(&status, "festival");
        assert_eq!(festival["state"], "open");
        assert_eq!(festival["due_ms"], now);
        // Nothing rings from a countdown alone.
        assert!(a.tick(now).is_empty());
        assert!(a.tick(stamp("2026-10-18T13:00:00Z")).is_empty());
        assert!(a.saved.history.is_empty());
        // The fallback clock can be changed without a server.
        a.saved.config.timezone = "America/New_York".into();
        let status = a.status(now);
        let kaira = countdown(&status, "watcher-kaira");
        assert_eq!(kaira["due_ms"], stamp("2026-10-18T14:00:00Z"));
        assert_eq!(kaira["timezone"], "America/New_York");
        assert_eq!(kaira["clock"], "fallback");
        // A detected server overrides the automatic fallback with its real clock.
        a.set_server(Some(2401));
        let status = a.status(now);
        assert_eq!(status["clock_source"], "detected");
        assert_eq!(status["clock_estimated"], false);
        let kaira = countdown(&status, "watcher-kaira");
        assert_eq!(kaira["clock"], "server");
        assert_eq!(kaira["timezone"], "America/Sao_Paulo");
        assert_eq!(kaira["estimated"], false);
        assert_eq!(kaira["due_ms"], stamp("2026-10-18T13:00:00Z"));
        // An explicit region wins over detection.
        a.saved.config.region = "eu".into();
        a.saved.config.timezone = "Europe/Berlin".into();
        assert_eq!(a.status(now)["clock_source"], "region");
    }
    #[test]
    fn notifications_wait_for_a_real_clock_and_stay_off_while_countdowns_use_custom_rules() {
        let now = stamp("2026-10-18T12:00:00Z");
        let entries = crate::alert_catalogue::entries("global", "UTC");
        let preset = |id: &str| entries.iter().find(|e| e.id == id).unwrap().rule.clone();
        let mut a = Alerts::default();
        // Customised but switched off: its own schedule drives the countdown.
        let mut kaira = preset("watcher-kaira");
        kaira.schedule_override = true;
        kaira.schedule = Some(Schedule::Once {
            at_ms: now + 600_000,
        });
        kaira.lead_seconds = vec![600, 0];
        kaira.sound = "bell".into();
        // Switched on with the master switch on, but the server is unknown.
        let mut festival = preset("festival");
        festival.enabled = true;
        festival.lead_seconds = vec![0];
        let mut custom = rule(Schedule::Once {
            at_ms: now + 60_000,
        });
        custom.lead_seconds = vec![0];
        a.saved.config.rules = vec![kaira, festival, custom];
        a.saved.config.enabled = false;
        let status = a.status(now);
        let row = countdown(&status, "watcher-kaira");
        assert_eq!(row["due_ms"], now + 600_000);
        assert_eq!(row["clock"], "own");
        assert_eq!(row["rule_id"], "preset-watcher-kaira");
        assert_eq!(row["notify"], "off");
        assert_eq!(countdown(&status, "festival")["notify"], "off");
        // Master off: custom and preset notifications stay silent, settings untouched.
        assert!(a.tick(now + 60_000).is_empty());
        assert!(a.tick(now + 600_000).is_empty());
        assert!(a.saved.history.is_empty());
        assert_eq!(a.saved.config.rules[0].sound, "bell");
        assert!(!a.saved.config.rules[0].enabled);
        assert!(!a.saved.config.enabled);
        // Master on: the custom rule rings; the built-in calendar waits for the real clock.
        let mut b = Alerts::default();
        b.saved.config.rules = a.saved.config.rules.clone();
        b.saved.config.enabled = true;
        let status = b.status(now);
        let festival = countdown(&status, "festival");
        assert_eq!(festival["notify"], "waiting_for_clock");
        assert_eq!(festival["state"], "open");
        let listed = status["upcoming"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["rule_id"] == "preset-festival")
            .unwrap();
        assert!(listed["due_ms"].is_null());
        assert_eq!(listed["state"], "unknown");
        let fired = b.tick(now + 60_000);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].rule_id, "reminder");
        assert!(b.tick(stamp("2026-10-18T13:00:00Z")).is_empty());
        b.set_server(Some(1401));
        let status = b.status(now);
        assert_eq!(countdown(&status, "festival")["clock"], "server");
        assert_eq!(countdown(&status, "festival")["notify"], "on");
        assert_eq!(b.tick(stamp("2026-10-18T14:00:00Z")).len(), 1);
    }
    #[test]
    fn observed_bosses_stay_unknown_until_seen_and_never_get_an_invented_respawn() {
        let mut a = Alerts::default();
        let now = stamp("2026-10-18T12:00:00Z");
        let boss = crate::alert_catalogue::data()
            .bosses
            .iter()
            .find(|b| !b.scheduled)
            .unwrap();
        let id = format!("field-{}", boss.npc_id);
        let status = a.status(now);
        let row = countdown(&status, &id);
        assert!(row["due_ms"].is_null());
        assert_eq!(row["state"], "unknown");
        assert_eq!(row["clock"], "observed");
        assert_eq!(row["basis"], "Waiting for a game observation");
        assert_eq!(row["estimated"], false);
        let catalog = Catalogue {
            npcs: vec![companion_core::combat::NpcInfo {
                id: boss.npc_id,
                name: boss.name.clone(),
                boss: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut spawn = CombatEvent::new("spawn");
        spawn.skill = boss.npc_id;
        spawn.target = 5;
        a.observe(&[spawn], &catalog, now);
        let mut death = CombatEvent::new("death");
        death.target = 5;
        a.observe(&[death], &catalog, now + 1000);
        let status = a.status(now + 2000);
        let row = countdown(&status, &id);
        assert!(row["due_ms"].is_null());
        assert_eq!(row["basis"], "Observed defeat; respawn time unknown");
        // A recognised in-game clock gives a real, estimated countdown.
        let mut timer = CombatEvent::new("field_event");
        timer.skill = boss.event_id;
        timer.amount = now + 900_000;
        a.observe(&[timer], &catalog, now + 3000);
        let status = a.status(now + 3000);
        let row = countdown(&status, &id);
        assert_eq!(row["due_ms"], now + 900_000);
        assert_eq!(row["state"], "scheduled");
        assert_eq!(row["estimated"], true);
        assert_eq!(row["notify"], "off");
    }
    #[test]
    fn global_volume_scales_output_once_including_snoozes_and_preserves_old_configuration() {
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        a.saved.config.volume = 0.5;
        let d = a.tick(100000).remove(0);
        assert_eq!(d.volume, 0.25);
        assert_eq!(a.saved.history.back().unwrap().volume, 0.5);
        a.action("snooze", Some(&d.id), Some(60), 100000).unwrap();
        assert_eq!(a.tick(160000).remove(0).volume, 0.25);
        assert_eq!(
            a.test_delivery("chime", 0.6, false, 170000).unwrap().volume,
            0.3
        );
        let mut old = serde_json::to_value(Config::default()).unwrap();
        old.as_object_mut().unwrap().remove("volume");
        old.as_object_mut().unwrap().remove("faction");
        let recovered: Config = serde_json::from_value(old).unwrap();
        assert_eq!(recovered.volume, 1.0);
        assert_eq!(recovered.faction, "auto");
    }
    #[test]
    fn lead_and_start_are_independent_claims_and_crossing_a_boundary_never_skips_start() {
        let mut a = engine(Schedule::Interval {
            anchor_ms: 120000,
            every_seconds: 120,
        });
        assert!(a.tick(59999).is_empty());
        let lead = a.tick(60500);
        assert_eq!(lead.len(), 1);
        assert_eq!(lead[0].phase, "before");
        assert!(a.tick(61000).is_empty());
        let start = a.tick(120500);
        assert_eq!(start.len(), 1);
        assert_eq!(start[0].phase, "start");
        assert_ne!(lead[0].id, start[0].id);
        assert!(a.tick(120600).is_empty());
        assert!(a.tick(100000).is_empty());
        assert!(a.tick(120700).is_empty());
        assert_eq!(a.tick(180500)[0].due_ms, 240000);
    }
    #[test]
    fn skipped_occurrence_advances_dashboard_and_blocks_every_reminder() {
        let mut a = engine(Schedule::Interval {
            anchor_ms: 120000,
            every_seconds: 120,
        });
        a.action("skip", Some("reminder"), None, 10000).unwrap();
        assert_eq!(a.status(10000)["upcoming"][0]["due_ms"], 240000);
        assert!(a.tick(60000).is_empty());
        assert!(a.tick(120000).is_empty());
        assert_eq!(a.tick(180000).len(), 1);
    }
    #[test]
    fn quiet_hours_span_midnight_and_muting_does_not_create_a_late_burst() {
        let now = stamp("2026-10-17T23:30:00Z");
        let mut a = engine(Schedule::Once { at_ms: now });
        a.saved.config.quiet_hours = Some(Quiet {
            start: "23:00".into(),
            end: "07:00".into(),
        });
        assert!(a.tick(now).is_empty());
        assert_eq!(a.saved.history.back().unwrap().status, "quiet");
        a.saved.config.quiet_hours = None;
        assert!(a.tick(now + 1000).is_empty());
        let mut a = engine(Schedule::Once { at_ms: now });
        a.action("mute", None, Some(300), now - 1000).unwrap();
        assert!(a.tick(now).is_empty());
        assert_eq!(a.saved.history.back().unwrap().status, "muted");
        a.action("unmute", None, None, now + 1000).unwrap();
        assert!(a.tick(now + 1000).is_empty());
    }
    #[test]
    fn sleep_skips_stale_phases_and_calendar_dst_is_wall_clock_based() {
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        a.tick(1);
        assert!(a.tick(200000).is_empty());
        let tz = zone("America/New_York").unwrap();
        let s = Schedule::Calendar {
            times: vec!["02:30".into()],
            weekdays: vec![],
        };
        let out = candidates(&s, tz, stamp("2026-03-08T12:00:00Z"));
        assert!(!out.contains(&stamp("2026-03-08T07:30:00Z")));
        assert!(out.contains(&stamp("2026-03-09T06:30:00Z")));
        let s = Schedule::Calendar {
            times: vec!["01:30".into()],
            weekdays: vec![],
        };
        let out = candidates(&s, tz, stamp("2026-11-01T12:00:00Z"));
        assert!(out.contains(&stamp("2026-11-01T05:30:00Z")));
        assert!(!out.contains(&stamp("2026-11-01T06:30:00Z")));
        let weekly = Schedule::Calendar {
            times: vec!["12:00".into()],
            weekdays: vec![0],
        };
        let out = candidates(&weekly, chrono_tz::UTC, stamp("2026-10-17T12:00:00Z"));
        assert!(out.contains(&stamp("2026-10-19T12:00:00Z")));
        assert!(!out.contains(&stamp("2026-10-18T12:00:00Z")));
    }
    #[test]
    fn snooze_has_its_own_identity_persists_and_dismisses_the_original() {
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        let d = a.tick(100000).remove(0);
        a.action("snooze", Some(&d.id), Some(60), 100000).unwrap();
        assert!(a.active(100001).is_empty());
        assert!(a.action("snooze", Some(&d.id), Some(60), 100001).is_err());
        assert_eq!(a.status(100001)["upcoming"].as_array().unwrap().len(), 2);
        let d2 = a.tick(160000).remove(0);
        assert_ne!(d.id, d2.id);
        assert_eq!(d2.phase, "snooze");
        a.action("dismiss", Some(&d2.id), None, 160001).unwrap();
        assert!(a.active(160001).is_empty());
    }
    #[test]
    fn configuration_validation_is_atomic_and_revisions_reject_lost_updates() {
        let mut a = engine(Schedule::Once { at_ms: 100000 });
        let original = serde_json::to_value(&a.saved.config).unwrap();
        let mut invalid = original.clone();
        invalid["rules"][0]["schedule"] =
            json!({"type":"calendar","times":["25:30"],"weekdays":[]});
        assert!(a.configure(invalid).is_err());
        assert_eq!(serde_json::to_value(&a.saved.config).unwrap(), original);
        a.configure(original.clone()).unwrap();
        assert_eq!(a.saved.config.revision, 1);
        assert!(a
            .configure(original)
            .unwrap_err()
            .contains("another window"));
    }
    #[test]
    fn saved_claims_prevent_replays_after_restart_and_legacy_alerts_migrate_once() {
        let root = std::env::temp_dir().join(format!(
            "aion-alerts-{}-{}",
            std::process::id(),
            stamp("2026-10-17T12:00:00Z")
        ));
        fs::create_dir_all(&root).unwrap();
        let legacy = json!({"alerts":[{"id":"old","name":"","enabled":true,"at_ms":100000,"repeat_seconds":1,"sound":"bell","volume":0.5,"lead_seconds":0}]});
        let mut a = Alerts::default();
        a.initialize(root.clone(), &legacy, 1).unwrap();
        assert_eq!(a.saved.config.rules[0].name, "Reminder");
        assert_eq!(a.tick(100000).len(), 1);
        let mut b = Alerts::default();
        b.initialize(root.clone(), &legacy, 2).unwrap();
        assert_eq!(b.saved.config.rules.len(), 1);
        assert!(b.tick(100001).is_empty());
        assert_eq!(b.tick(101000).len(), 1);
        fs::remove_file(root.join("alerts.json")).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn loaded_builtin_names_migrate_for_notifications_history_and_snoozes() {
        let root = std::env::temp_dir().join(format!(
            "aion-alert-names-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let now = stamp("2026-10-19T12:00:00Z");
        let mut festival = crate::alert_catalogue::entries("kr", "Asia/Seoul")
            .into_iter()
            .find(|entry| entry.id == "festival")
            .unwrap()
            .rule;
        festival.name = "Hourly festival".into();
        festival.enabled = true;
        festival.schedule_override = true;
        festival.schedule = Some(Schedule::Once { at_ms: now });
        festival.lead_seconds = vec![0];
        let mut custom = rule(Schedule::Once { at_ms: now });
        custom.name = "Hourly festival".into();
        custom.lead_seconds = vec![0];
        let delivery = Delivery {
            id: "previous-festival".into(),
            rule_id: festival.id.clone(),
            name: festival.name.clone(),
            category: festival.category.clone(),
            due_ms: now - 1000,
            fired_ms: now - 1000,
            lead_seconds: 0,
            phase: "start".into(),
            sound: "none".into(),
            volume: 0.,
            popup: true,
            status: "delivered".into(),
        };
        let mut snooze = delivery.clone();
        snooze.id = "saved-snooze".into();
        snooze.due_ms = now + 60_000;
        snooze.phase = "snooze".into();
        let mut saved = Saved::default();
        saved.config.enabled = true;
        saved.config.rules = vec![festival.clone(), custom];
        saved.history.push_back(delivery);
        saved.snoozes.push(snooze);
        saved.claims.insert("previous-claim".into(), now - 1000);
        fs::write(
            root.join("alerts.json"),
            serde_json::to_vec(&saved).unwrap(),
        )
        .unwrap();

        let mut a = Alerts::default();
        a.initialize(root.clone(), &json!({}), now).unwrap();
        let status = a.status(now);
        assert_eq!(status["active"][0]["name"], "Shugo Festival");
        assert_eq!(status["history"][0]["name"], "Shugo Festival");
        assert!(status["upcoming"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["rule_id"] == "saved-snooze" && row["name"] == "Shugo Festival" }));
        let migrated: Saved =
            serde_json::from_slice(&fs::read(root.join("alerts.json")).unwrap()).unwrap();
        assert_eq!(migrated.config.rules[0].name, "Shugo Festival");
        assert_eq!(migrated.config.rules[1].name, "Hourly festival");
        assert_eq!(migrated.config.rules[0].timezone, festival.timezone);
        assert_eq!(
            serde_json::to_value(&migrated.config.rules[0].schedule).unwrap(),
            serde_json::to_value(&festival.schedule).unwrap()
        );
        assert!(migrated.config.rules[0].schedule_override);
        assert_eq!(migrated.config.revision, saved.config.revision);
        assert_eq!(migrated.claims, saved.claims);
        let delivered = a.tick(now);
        assert_eq!(delivered.len(), 2);
        assert_eq!(
            delivered
                .iter()
                .find(|d| d.rule_id == festival.id)
                .unwrap()
                .name,
            "Shugo Festival"
        );
        assert!(delivered.iter().any(|d| d.name == "Hourly festival"));
        assert_eq!(a.tick(now + 60_000)[0].name, "Shugo Festival");
        let mut restarted = Alerts::default();
        restarted
            .initialize(root.clone(), &json!({}), now + 60_001)
            .unwrap();
        assert!(restarted.tick(now + 60_001).is_empty());
        fs::remove_file(root.join("alerts.json")).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn failed_state_writes_retry_without_delivery_and_corrupt_files_survive_background_work() {
        let root = std::env::temp_dir().join(format!(
            "aion-alert-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut a = engine(Schedule::Once { at_ms: 120000 });
        a.root = Some(root.clone());
        assert!(a.tick(60500).is_empty());
        assert!(a.saved.history.is_empty());
        fs::create_dir(&root).unwrap();
        assert_eq!(a.tick(61000).len(), 1);
        assert!(a.tick(62000).is_empty());
        let path = root.join("alerts.json");
        fs::write(&path, b"corrupt saved settings").unwrap();
        let mut b = Alerts::default();
        assert!(b.initialize(root.clone(), &json!({}), 100000).is_err());
        let mut timer = CombatEvent::new("field_event");
        timer.skill = 5;
        b.observe(&[timer], &Catalogue::default(), 100000);
        assert!(b.tick(120000).is_empty());
        assert!(b.action("clear_history", None, None, 120000).is_err());
        assert!(b.test_delivery("none", 0., true, 120000).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"corrupt saved settings");
        b.configure(serde_json::to_value(Config::default()).unwrap())
            .unwrap();
        assert!(!b.load_failed);
        assert!(serde_json::from_slice::<Saved>(&fs::read(&path).unwrap()).is_ok());
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn game_observations_are_server_scoped_and_repeated_death_never_reanchors() {
        let mut a = engine(Schedule::Observed);
        a.saved.config.server = "one".into();
        a.saved.config.rules[0].npc_id = Some(99);
        a.saved.config.rules[0].respawn_seconds = Some(60);
        let catalog = Catalogue {
            npcs: vec![companion_core::combat::NpcInfo {
                id: 99,
                name: "Test boss".into(),
                boss: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut spawn = CombatEvent::new("spawn");
        spawn.target = 7;
        spawn.skill = 99;
        a.observe(&[spawn.clone()], &catalog, 100000);
        assert_eq!(a.status(100000)["observed"].as_array().unwrap().len(), 1);
        a.saved.config.server = "two".into();
        assert!(a.status(100000)["observed"].as_array().unwrap().is_empty());
        a.saved.config.server = "one".into();
        let mut hp = CombatEvent::new("hp");
        hp.target = 7;
        hp.current_hp = Some(0);
        a.observe(&[hp.clone()], &catalog, 110000);
        a.observe(&[hp.clone()], &catalog, 120000);
        assert_eq!(a.status(120000)["observed"][0]["due_ms"], 170000);
        assert_eq!(a.status(120000)["observed"][0]["estimated"], true);
        spawn.skill = 999;
        a.observe(&[spawn, hp], &catalog, 130000);
        assert_eq!(a.status(130000)["observed"][0]["due_ms"], 170000);
        let now = stamp("2026-10-17T12:00:00Z");
        assert_eq!(clock(now + 60000, now).0, Some(now + 60000));
        assert_eq!(
            clock((now + 60000 + 11_644_473_600_000) * 10000, now).0,
            Some(now + 60000)
        );
        assert!(clock(123, now).0.is_none());
    }
}
