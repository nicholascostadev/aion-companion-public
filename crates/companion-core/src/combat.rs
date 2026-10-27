//! Offline, lossless combat observations. No estimates are counted as damage.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CombatEvent {
    pub at_ms: u64,
    pub kind: String,
    pub source: u32,
    pub target: u32,
    pub skill: u32,
    pub amount: u64,
    pub hit_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critical: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub back: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub front: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub perfect: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub double: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parry: Option<bool>,
    pub instance: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_hp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charge: Option<u8>,
    pub tick: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
}
impl CombatEvent {
    pub fn new(kind: &str) -> Self {
        Self {
            kind: kind.into(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct SkillInfo {
    pub id: u32,
    pub name: String,
    pub class: Option<String>,
    pub cooldown_ms: Option<u64>,
    pub charge_max: Option<u8>,
    pub specialty_mode: Option<String>,
    pub specialties: Vec<Value>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct NpcInfo {
    pub id: u32,
    pub name: String,
    pub boss: bool,
    pub dummy: bool,
    pub berserk_seconds: Option<u64>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Catalogue {
    pub skills: Vec<SkillInfo>,
    pub npcs: Vec<NpcInfo>,
}
impl Catalogue {
    pub fn skill(&self, id: u32) -> Option<&SkillInfo> {
        self.skills
            .binary_search_by_key(&id, |s| s.id)
            .ok()
            .map(|at| &self.skills[at])
            .or_else(|| {
                self.skills
                    .binary_search_by_key(&(id / 10000 * 10000), |s| s.id)
                    .ok()
                    .map(|at| &self.skills[at])
            })
    }
    pub fn name(&self, id: u32) -> String {
        self.skill(id)
            .map_or_else(|| format!("Skill #{id}"), |s| s.name.clone())
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct ActorInfo {
    pub id: u32,
    pub name: String,
    pub class: Option<String>,
    pub local: bool,
    pub party: bool,
    pub server_id: Option<u16>,
    pub level: Option<u32>,
    pub gear_score: Option<u32>,
    pub combat_power: Option<u64>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct TargetInfo {
    pub id: u32,
    pub npc_id: Option<u32>,
    pub name: String,
    pub boss: bool,
    pub dummy: bool,
    pub current_hp: Option<u64>,
    pub max_hp: Option<u64>,
    pub dead: bool,
    pub damage: u64,
    pub berserk_seconds: Option<u64>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct CombatLog {
    pub schema_version: u32,
    pub id: String,
    pub label: String,
    pub started_ms: u64,
    pub duration_ms: u64,
    pub end_reason: Option<String>,
    pub zone_id: Option<u32>,
    pub run_id: String,
    pub party_id: Option<u32>,
    pub actors: BTreeMap<u32, ActorInfo>,
    pub targets: BTreeMap<u32, TargetInfo>,
    pub events: Vec<CombatEvent>,
    pub warnings: Vec<String>,
}

#[derive(Default, Serialize)]
struct Stats {
    id: u32,
    name: String,
    damage: u64,
    healing: u64,
    received: u64,
    casts: u64,
    inferred_casts: u64,
    hits: u64,
    damage_hits: u64,
    damage_crits: u64,
    damage_critical_hits_observed: u64,
    direct_hits: u64,
    critical_hits_observed: u64,
    flags_observed: u64,
    crits: u64,
    back: u64,
    front: u64,
    perfect: u64,
    double: u64,
    parry: u64,
    multi: u64,
    min: Option<u64>,
    max: u64,
    avg: f64,
    cast_gap_ms: Option<f64>,
    charge: Option<u8>,
    specialties: Vec<Value>,
    #[serde(skip)]
    last_cast: Option<u64>,
    #[serde(skip)]
    gaps: u64,
}
#[derive(Default)]
struct Player {
    damage: u64,
    healing: u64,
    received: u64,
    healing_received: u64,
    deaths: u64,
    skills: BTreeMap<u32, Stats>,
    targets: BTreeMap<u32, (u64, u64, u64)>,
    first: Option<u64>,
    last: u64,
    active: BTreeSet<u64>,
    current_damage: u64,
}

impl CombatLog {
    /// Only the endpoints used by the meter's recent HP slope, at most two per
    /// target. Keep the full HP timeline exclusive to detailed reports.
    fn summary_hp<'a>(&'a self, last: BTreeMap<u32, &'a CombatEvent>) -> Vec<Value> {
        if last.is_empty() {
            return Vec::new();
        }
        let mut first: BTreeMap<u32, &CombatEvent> = BTreeMap::new();
        for e in &self.events {
            if e.kind != "hp" || e.current_hp.is_none() {
                continue;
            }
            if let Some(latest) = last.get(&e.target) {
                if e.at_ms >= latest.at_ms.saturating_sub(20_000)
                    && first
                        .get(&e.target)
                        .is_none_or(|previous| e.at_ms < previous.at_ms)
                {
                    first.insert(e.target, e);
                }
            }
        }
        let mut samples = Vec::new();
        for (target, latest) in last {
            if let Some(earliest) = first.get(&target) {
                if !std::ptr::eq(*earliest, latest) {
                    samples.push(*earliest);
                }
            }
            samples.push(latest);
        }
        samples.sort_by_key(|e| e.at_ms);
        samples.into_iter().map(|e| json!({"entity":e.target,"at_ms":e.at_ms,"current":e.current_hp,"max":e.max_hp.or_else(||self.targets.get(&e.target).and_then(|t|t.max_hp))})).collect()
    }
    /// Add timelines to a summary produced from this same immutable log snapshot.
    /// Cached live reports reuse their aggregates instead of computing them twice.
    pub fn with_report_details(&self, mut report: Value, visible_events: &[CombatEvent]) -> Value {
        let mut buffs: Vec<Value> = Vec::new();
        let mut active: BTreeMap<(u32, u32), usize> = BTreeMap::new();
        let mut hp = Vec::new();
        for e in &self.events {
            match e.kind.as_str() {
                "buff" => {
                    if let Some(index) = active.remove(&(e.target, e.instance)) {
                        let old = buffs[index]["end_ms"].as_u64().unwrap_or(u64::MAX);
                        if old >= e.at_ms && buffs[index]["skill"] == e.skill && buffs[index]["source"] == e.source {
                            buffs[index]["end_ms"] = e.duration_ms.map(|n| e.at_ms.saturating_add(n)).into();
                            active.insert((e.target, e.instance), index);
                            continue;
                        }
                        buffs[index]["end_ms"] = old.min(e.at_ms).into();
                    }
                    active.insert((e.target, e.instance), buffs.len());
                    buffs.push(json!({"source":e.source,"target":e.target,"skill":e.skill,"instance":e.instance,"start_ms":e.at_ms,"end_ms":e.duration_ms.map(|n|e.at_ms.saturating_add(n))}));
                }
                "buff_end" => {
                    if let Some(index) = active.remove(&(e.target, e.instance)) {
                        let old = buffs[index]["end_ms"].as_u64().unwrap_or(u64::MAX);
                        buffs[index]["end_ms"] = old.min(e.at_ms).into();
                    }
                }
                "hp" => hp.push(json!({"entity":e.target,"at_ms":e.at_ms,"current":e.current_hp,"max":e.max_hp})),
                _ => {}
            }
        }
        let mut warnings = self.warnings.clone();
        let truncated = visible_events.len() < self.events.len();
        if truncated {
            warnings.push("Live event detail is limited to the latest 25,000 observations. Full totals remain accurate; save/open the local log for the complete timeline.".into());
        }
        report["events"] = json!(visible_events);
        report["buffs"] = buffs.into();
        report["hp"] = hp.into();
        report["warnings"] = warnings.into();
        report["detail_level"] = "full".into();
        report["events_truncated"] = truncated.into();
        report["event_window_start_ms"] = visible_events.first().map(|e| e.at_ms).into();
        report
    }
    pub fn report(
        &self,
        catalogue: &Catalogue,
        now_ms: u64,
        party_only: bool,
        boss_only: bool,
    ) -> Value {
        self.report_events(catalogue, now_ms, party_only, boss_only, &self.events)
    }
    pub fn report_events(
        &self,
        catalogue: &Catalogue,
        now_ms: u64,
        party_only: bool,
        boss_only: bool,
        visible_events: &[CombatEvent],
    ) -> Value {
        self.with_report_details(
            self.report_summary(catalogue, now_ms, party_only, boss_only),
            visible_events,
        )
    }
    /// Aggregate meters without allocating event/buff timelines or full HP detail.
    pub fn report_summary(
        &self,
        catalogue: &Catalogue,
        now_ms: u64,
        party_only: bool,
        boss_only: bool,
    ) -> Value {
        let duration = self.duration_ms.max(1000);
        // Completed encounters keep their final rolling rate when polled later.
        let now_ms = if self.end_reason.is_some() {
            self.duration_ms
        } else {
            now_ms
        };
        let mut players: BTreeMap<u32, Player> = BTreeMap::new();
        let eligible =
            |id: u32| !party_only || self.actors.get(&id).is_some_and(|a| a.local || a.party);
        let target_ok =
            |id: u32| !boss_only || self.targets.get(&id).is_some_and(|t| t.boss || t.dummy);
        let mut coverage = BTreeMap::from([
            ("damage", false),
            ("healing", false),
            ("casts", false),
            ("buffs", false),
            ("hp", false),
            ("deaths", false),
            ("hit_flags", false),
            ("positions", false),
        ]);
        let mut biggest = (0u64, 0u32, 0u64);
        let mut first_hit = None;
        let mut last_hp: BTreeMap<u32, &CombatEvent> = BTreeMap::new();
        for event in &self.events {
            let e = event;
            match e.kind.as_str() {
                "buff" => {
                    coverage.insert("buffs", true);
                }
                "hp" => {
                    coverage.insert("hp", true);
                    if e.current_hp.is_some()
                        && self.targets.contains_key(&e.target)
                        && last_hp
                            .get(&e.target)
                            .is_none_or(|previous| e.at_ms >= previous.at_ms)
                    {
                        last_hp.insert(e.target, e);
                    }
                }
                "position" => {
                    coverage.insert("positions", true);
                }
                "death" if eligible(e.target) && self.actors.contains_key(&e.target) => {
                    coverage.insert("deaths", true);
                    players.entry(e.target).or_default().deaths += 1;
                }
                "damage" | "heal" | "cast" => {
                    if !eligible(e.source) && !self.actors.contains_key(&e.target) {
                        continue;
                    }
                    // Only recorded actors can be ranked; monsters remain sources in Taken events.
                    let player_source = self.actors.contains_key(&e.source);
                    if e.kind == "damage"
                        && self.actors.contains_key(&e.target)
                        && eligible(e.target)
                    {
                        let taken = players.entry(e.target).or_default();
                        taken.received = taken.received.saturating_add(e.amount);
                        let s = taken.skills.entry(e.skill).or_insert_with(|| Stats {
                            id: e.skill,
                            name: catalogue.name(e.skill),
                            ..Stats::default()
                        });
                        s.received = s.received.saturating_add(e.amount);
                        taken.targets.entry(e.source).or_default().2 += e.amount;
                    }
                    if e.kind == "heal" && self.actors.contains_key(&e.target) && eligible(e.target)
                    {
                        players.entry(e.target).or_default().healing_received += e.amount;
                    }
                    if !eligible(e.source) || (!target_ok(e.target) && e.kind != "heal") {
                        continue;
                    }
                    if !player_source {
                        continue;
                    }
                    if e.kind == "damage" && self.actors.contains_key(&e.target) {
                        continue;
                    }
                    let p = players.entry(e.source).or_default();
                    let s = p.skills.entry(e.skill).or_insert_with(|| Stats {
                        id: e.skill,
                        name: catalogue.name(e.skill),
                        ..Stats::default()
                    });
                    // The hundreds/tens of the wire variant encode selected
                    // specialty choices; the final digit is the release stage.
                    // A local catalogue may supply descriptions, never selection.
                    if s.specialties.is_empty() && crate::wire::player_skill(e.skill) {
                        let mut codes = e.skill % 10000 / 10;
                        let mut choices = BTreeSet::new();
                        if catalogue
                            .skill(e.skill / 10000 * 10000)
                            .is_some_and(|s| s.specialty_mode.as_deref() == Some("tier"))
                        {
                            for choice in 1..=(codes % 10).min(5) {
                                choices.insert(choice);
                            }
                            codes = 0;
                        }
                        while codes > 0 {
                            let choice = codes % 10;
                            if choice > 0 {
                                choices.insert(choice);
                            }
                            codes /= 10;
                        }
                        for choice in choices {
                            let described =
                                catalogue.skill(e.skill / 10000 * 10000).and_then(|c| {
                                    c.specialties
                                        .iter()
                                        .find(|s| s["slot"].as_u64() == Some(choice as u64))
                                });
                            if let Some(described) = described {
                                s.specialties.push(described.clone());
                            }
                        }
                    }
                    if e.kind == "cast" {
                        s.charge = e.charge.or(s.charge);
                        coverage.insert("casts", true);
                        if s.last_cast != Some(e.at_ms) {
                            if let Some(previous) = s.last_cast {
                                s.gaps += e.at_ms.saturating_sub(previous);
                            }
                            s.casts += 1;
                            s.last_cast = Some(e.at_ms);
                        }
                        continue;
                    }
                    p.active.insert(e.at_ms / 1000);
                    if e.kind == "heal" {
                        coverage.insert("healing", true);
                        p.healing = p.healing.saturating_add(e.amount);
                        s.healing = s.healing.saturating_add(e.amount);
                        p.targets.entry(e.target).or_default().1 += e.amount;
                    } else {
                        p.first.get_or_insert(e.at_ms);
                        p.last = p.last.max(e.at_ms);
                        coverage.insert("damage", true);
                        if e.back.is_some() {
                            coverage.insert("hit_flags", true);
                        }
                        p.damage = p.damage.saturating_add(e.amount);
                        if e.at_ms.saturating_add(5000) > now_ms {
                            p.current_damage = p.current_damage.saturating_add(e.amount);
                        }
                        s.damage = s.damage.saturating_add(e.amount);
                        s.damage_hits += 1;
                        s.damage_critical_hits_observed +=
                            u64::from(!e.tick && e.critical.is_some());
                        s.damage_crits += u64::from(!e.tick && e.critical == Some(true));
                        p.targets.entry(e.target).or_default().0 += e.amount;
                        if e.amount > biggest.0 {
                            biggest = (e.amount, e.source, e.at_ms);
                        }
                        if first_hit.is_none() {
                            first_hit = Some((e.source, e.at_ms));
                        }
                    }
                    s.hits += 1;
                    s.direct_hits += u64::from(!e.tick);
                    s.critical_hits_observed += u64::from(e.critical.is_some());
                    s.flags_observed += u64::from(e.back.is_some());
                    s.crits += u64::from(e.critical == Some(true));
                    s.back += u64::from(e.back == Some(true));
                    s.front += u64::from(e.front == Some(true));
                    s.perfect += u64::from(e.perfect == Some(true));
                    s.double += u64::from(e.double == Some(true));
                    s.parry += u64::from(e.parry == Some(true));
                    s.multi += u64::from(e.hit_count > 1);
                    s.min = Some(s.min.map_or(e.amount, |n| n.min(e.amount)));
                    s.max = s.max.max(e.amount);
                    s.charge = e.charge.or(s.charge);
                }
                _ => {}
            }
        }
        let mut list = Vec::new();
        let mut highlights = Vec::new();
        if biggest.0 > 0 {
            highlights.push(json!({"kind":"biggest_hit","player":biggest.1,"value":biggest.0,"at_ms":biggest.2}));
        }
        if let Some((id, at)) = first_hit {
            highlights.push(json!({"kind":"first_hit","player":id,"value":0,"at_ms":at}));
        }
        for (id, p) in players {
            let info = self.actors.get(&id).cloned().unwrap_or_else(|| ActorInfo {
                id,
                name: format!("Player #{id}"),
                ..ActorInfo::default()
            });
            let mut row = serde_json::to_value(info).unwrap();
            let active = p
                .first
                .map_or(1, |start| p.last.saturating_sub(start).max(1));
            let mut total = Stats::default();
            let mut skills = Vec::new();
            for (_, mut s) in p.skills {
                s.avg = (s.damage + s.healing) as f64 / s.hits.max(1) as f64;
                s.cast_gap_ms = (s.casts > 1).then(|| s.gaps as f64 / (s.casts - 1) as f64);
                for choice in &mut s.specialties {
                    choice["count"] = if s.casts > 0 {
                        s.casts.into()
                    } else {
                        Value::Null
                    };
                }
                total.casts += s.casts;
                total.inferred_casts += s.inferred_casts;
                total.hits += s.hits;
                total.damage_hits += s.damage_hits;
                total.damage_crits += s.damage_crits;
                total.damage_critical_hits_observed += s.damage_critical_hits_observed;
                total.direct_hits += s.direct_hits;
                total.critical_hits_observed += s.critical_hits_observed;
                total.flags_observed += s.flags_observed;
                total.crits += s.crits;
                total.back += s.back;
                total.front += s.front;
                total.perfect += s.perfect;
                total.double += s.double;
                total.parry += s.parry;
                total.multi += s.multi;
                let mut value = serde_json::to_value(&s).unwrap();
                if s.casts == 0 {
                    value["casts"] = Value::Null;
                }
                if s.critical_hits_observed == 0 {
                    value["crits"] = Value::Null;
                }
                if s.damage_critical_hits_observed == 0 {
                    value["damage_crits"] = Value::Null;
                }
                if s.flags_observed == 0 {
                    for key in ["back", "front", "perfect", "double", "parry"] {
                        value[key] = Value::Null;
                    }
                }
                skills.push(value);
            }
            skills.sort_by_key(|s| {
                std::cmp::Reverse(
                    s["damage"].as_u64().unwrap_or(0) + s["healing"].as_u64().unwrap_or(0),
                )
            });
            let totals = serde_json::to_value(total).unwrap();
            for key in [
                "casts",
                "inferred_casts",
                "hits",
                "damage_hits",
                "damage_crits",
                "damage_critical_hits_observed",
                "direct_hits",
                "critical_hits_observed",
                "flags_observed",
                "crits",
                "back",
                "front",
                "perfect",
                "double",
                "parry",
                "multi",
            ] {
                row[key] = totals[key].clone();
            }
            row["damage"] = p.damage.into();
            if totals["casts"] == 0 {
                row["casts"] = Value::Null;
            }
            row["cast_method"] = "observed skill-start packets only".into();
            if totals["critical_hits_observed"] == 0 {
                row["crits"] = Value::Null;
            }
            if totals["damage_critical_hits_observed"] == 0 {
                row["damage_crits"] = Value::Null;
            }
            if totals["flags_observed"] == 0 {
                for key in ["back", "front", "perfect", "double", "parry"] {
                    row[key] = Value::Null;
                }
            }
            row["healing"] = p.healing.into();
            row["received"] = p.received.into();
            row["deaths"] = p.deaths.into();
            row["edps"] = json!(p.damage as f64 * 1000.0 / duration as f64);
            row["adps"] = json!(p.damage as f64 * 1000.0 / active.max(1000) as f64);
            row["current_dps"] = json!(p.current_damage as f64 / 5.0);
            row["active_pct"] =
                json!((p.active.len() as f64 * 1000.0 / duration as f64 * 100.0).min(100.0));
            row["skills"] = skills.into();
            row["targets"]=p.targets.iter().map(|(target,(d,h,r))|json!({"id":target,"name":self.actors.get(target).map(|a|a.name.clone()).or_else(||self.targets.get(target).map(|t|t.name.clone())).unwrap_or_else(||format!("Entity #{target}")),"damage":d,"healing":h,"received":r})).collect::<Vec<_>>().into();
            row["healing_received"] = p.healing_received.into();
            row["activity_method"] = "one-second bins with outgoing damage or healing".into();
            for (kind, value) in [
                ("healing", p.healing),
                ("healing_received", p.healing_received),
                ("damage_taken", p.received),
            ] {
                if value > 0 {
                    highlights.push(json!({"kind":kind,"player":id,"value":value}));
                }
            }
            list.push(row);
        }
        list.sort_by_key(|p| std::cmp::Reverse(p["damage"].as_u64().unwrap_or(0)));
        json!({"id":self.id,"schema_version":self.schema_version,"label":self.label,"started_ms":self.started_ms,"duration_ms":self.duration_ms,"end_reason":self.end_reason,"zone_id":self.zone_id,"run_id":self.run_id,"party_id":self.party_id,"players":list,"targets":self.targets.values().collect::<Vec<_>>(),"events":[],"buffs":[],"hp":self.summary_hp(last_hp),"highlights":highlights,"warnings":self.warnings,"coverage":coverage,"event_count":self.events.len(),"detail_level":"summary","events_truncated":false,"event_window_start_ms":null})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_hp_preserves_recent_slope_endpoints_without_the_full_timeline() {
        let mut log = CombatLog {
            duration_ms: 120_000,
            ..Default::default()
        };
        for id in [3, 4] {
            log.targets.insert(
                id,
                TargetInfo {
                    id,
                    max_hp: Some(10_000),
                    ..Default::default()
                },
            );
        }
        for i in 0..=1000 {
            for target in [3, 4, 99] {
                // Actor HP is not needed by the target meter.
                log.events.push(CombatEvent {
                    at_ms: i * 100,
                    target,
                    current_hp: Some(10_000 - i),
                    ..CombatEvent::new("hp")
                });
            }
        }
        let report = log.report_summary(&Catalogue::default(), 120_000, false, false);
        let samples = report["hp"].as_array().unwrap();
        assert_eq!(samples.len(), 4);
        for target in [3, 4] {
            let hp: Vec<_> = samples.iter().filter(|s| s["entity"] == target).collect();
            assert_eq!(hp[0]["at_ms"], 80_000);
            assert_eq!(hp[1]["at_ms"], 100_000);
            assert_eq!(hp[0]["current"], 9200);
            assert_eq!(hp[1]["current"], 9000);
            assert_eq!(hp[0]["max"], 10_000);
        }
        assert_eq!(
            log.report(&Catalogue::default(), 120_000, false, false)["hp"]
                .as_array()
                .unwrap()
                .len(),
            3003
        );
    }
    #[test]
    fn compact_reports_preserve_aggregates_and_coverage_for_each_filter() {
        let mut log = CombatLog {
            duration_ms: 8000,
            ..Default::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                local: true,
                ..Default::default()
            },
        );
        log.actors.insert(
            2,
            ActorInfo {
                id: 2,
                ..Default::default()
            },
        );
        log.targets.insert(
            3,
            TargetInfo {
                id: 3,
                boss: true,
                ..Default::default()
            },
        );
        for (kind, source, target, at_ms) in [
            ("damage", 1, 3, 1000),
            ("damage", 2, 4, 7000),
            ("heal", 1, 2, 7500),
            ("cast", 1, 3, 500),
            ("buff", 1, 2, 3000),
            ("buff_end", 1, 2, 4000),
            ("hp", 0, 3, 6000),
            ("death", 0, 2, 7000),
        ] {
            log.events.push(CombatEvent {
                kind: kind.into(),
                source,
                target,
                at_ms,
                amount: 150,
                skill: 11010000,
                ..Default::default()
            });
        }
        for party in [false, true] {
            for boss in [false, true] {
                let full = log.report(&Catalogue::default(), 8000, party, boss);
                let summary = log.report_summary(&Catalogue::default(), 8000, party, boss);
                for key in [
                    "players",
                    "targets",
                    "highlights",
                    "warnings",
                    "coverage",
                    "event_count",
                ] {
                    assert_eq!(summary[key], full[key], "{key}: party={party}, boss={boss}");
                }
                for key in ["events", "buffs", "hp"] {
                    assert_eq!(summary[key], json!([]));
                }
                assert_eq!(summary["detail_level"], "summary");
                assert_eq!(summary["event_count"], 8);
                assert_eq!(summary["events_truncated"], false);
                assert!(!full["buffs"].as_array().unwrap().is_empty());
                assert!(!full["hp"].as_array().unwrap().is_empty());
            }
        }
    }
    #[test]
    fn damage_healing_taken_and_casts_remain_separate_and_buffs_close() {
        let mut log = CombatLog {
            duration_ms: 5000,
            ..CombatLog::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                name: "Tester".into(),
                ..ActorInfo::default()
            },
        );
        let mut e = CombatEvent::new("damage");
        e.source = 1;
        e.target = 2;
        e.skill = 11_000_101;
        e.amount = 100;
        e.hit_count = 3;
        e.at_ms = 1000;
        log.events.push(e.clone());
        e.source = 2;
        e.target = 1;
        e.amount = 25;
        log.events.push(e);
        let mut heal = CombatEvent::new("heal");
        heal.source = 1;
        heal.target = 1;
        heal.skill = 17_390_100;
        heal.amount = 10;
        heal.at_ms = 2000;
        log.events.push(heal);
        let mut b = CombatEvent::new("buff");
        b.target = 1;
        b.instance = 3;
        b.duration_ms = Some(10000);
        log.events.push(b.clone());
        b.kind = "buff_end".into();
        b.at_ms = 3000;
        log.events.push(b);
        let r = log.report(&Catalogue::default(), 5000, false, false);
        assert_eq!(r["players"][0]["damage"], 100);
        assert_eq!(r["players"][0]["received"], 25);
        assert_eq!(r["players"][0]["healing"], 10);
        assert_eq!(r["players"][0]["multi"], 1);
        assert!(r["players"][0]["crits"].is_null());
        assert!(r["players"][0]["casts"].is_null());
        assert!(r["players"][0]["back"].is_null());
        assert_eq!(r["players"][0]["healing_received"], 10);
        assert_eq!(r["buffs"][0]["end_ms"], 3000);
    }
    #[test]
    fn damage_hit_and_critical_counts_exclude_healing_and_periodic_crit_flags() {
        let mut log = CombatLog {
            duration_ms: 5000,
            ..Default::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                ..Default::default()
            },
        );
        for (at_ms, kind, skill, amount, critical, tick) in [
            (0, "damage", 11010000, 100, Some(true), false),
            (100, "heal", 11010000, 200, Some(true), false),
            (200, "damage", 11010000, 50, Some(false), false),
            (300, "damage", 11010000, 30, Some(true), true),
            (400, "damage", 11010000, 20, None, false),
            (500, "damage", 11020000, 10, None, false),
            (600, "heal", 11020000, 150, Some(false), false),
        ] {
            log.events.push(CombatEvent {
                at_ms,
                source: 1,
                target: if kind == "heal" { 1 } else { 2 },
                skill,
                amount,
                critical,
                tick,
                hit_count: 3,
                ..CombatEvent::new(kind)
            });
        }
        // Incoming damage cannot inflate outgoing hit counts or create an NPC rank.
        log.events.push(CombatEvent {
            source: 3,
            target: 1,
            amount: 500,
            critical: Some(true),
            ..CombatEvent::new("damage")
        });
        let report = log.report(&Catalogue::default(), 5000, false, false);
        assert_eq!(report["players"].as_array().unwrap().len(), 1);
        let player = &report["players"][0];
        assert_eq!(player["damage"], 210); // A multi-hit flag never multiplies damage.
        assert_eq!(player["hits"], 7); // Existing impact counters keep their meaning.
        assert_eq!(player["damage_hits"], 5);
        assert_eq!(player["damage_crits"], 1);
        assert_eq!(player["damage_critical_hits_observed"], 2);
        let skills = player["skills"].as_array().unwrap();
        let mixed = skills.iter().find(|s| s["id"] == 11010000).unwrap();
        assert_eq!(mixed["damage"], 200);
        assert_eq!(mixed["damage_hits"], 4);
        assert_eq!(mixed["damage_crits"], 1);
        assert_eq!(mixed["damage_critical_hits_observed"], 2);
        let unknown = skills.iter().find(|s| s["id"] == 11020000).unwrap();
        assert_eq!(unknown["damage_hits"], 1);
        assert_eq!(unknown["damage_critical_hits_observed"], 0);
        assert!(unknown["damage_crits"].is_null());
    }
    #[test]
    fn periodic_damage_does_not_dilute_direct_critical_rates_or_invent_casts() {
        let mut log = CombatLog {
            duration_ms: 5000,
            ..Default::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                ..Default::default()
            },
        );
        log.events.push(CombatEvent {
            source: 1,
            target: 2,
            skill: 11010000,
            ..CombatEvent::new("cast")
        });
        log.events.push(CombatEvent {
            source: 1,
            target: 2,
            skill: 11010000,
            amount: 100,
            critical: Some(true),
            ..CombatEvent::new("damage")
        });
        log.events.push(CombatEvent {
            at_ms: 2000,
            source: 1,
            target: 2,
            skill: 11010000,
            amount: 20,
            tick: true,
            ..CombatEvent::new("damage")
        });
        let r = log.report(&Catalogue::default(), 5000, false, false);
        let p = &r["players"][0];
        assert_eq!(p["casts"], 1);
        assert_eq!(p["inferred_casts"], 0);
        assert_eq!(p["hits"], 2);
        assert_eq!(p["critical_hits_observed"], 1);
        assert_eq!(p["crits"], 1);
    }
    #[test]
    fn multi_stage_hits_never_fabricate_casts_or_gaps() {
        let mut log = CombatLog {
            duration_ms: 9000,
            ..Default::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                ..Default::default()
            },
        );
        for at in [0, 500, 2000, 3000, 8000] {
            log.events.push(CombatEvent {
                at_ms: at,
                source: 1,
                target: 2,
                skill: 11010000,
                amount: 100,
                ..CombatEvent::new("damage")
            });
        }
        let report = log.report(&Catalogue::default(), 9000, false, false);
        let p = &report["players"][0];
        assert_eq!(p["damage"], 500);
        assert!(p["casts"].is_null());
        assert!(p["skills"][0]["cast_gap_ms"].is_null());
        log.events.push(CombatEvent {
            at_ms: 8100,
            source: 1,
            target: 2,
            skill: 11010000,
            ..CombatEvent::new("cast")
        });
        assert_eq!(
            log.report(&Catalogue::default(), 9000, false, false)["players"][0]["casts"],
            1
        );
    }
    #[test]
    fn refresh_does_not_fragment_an_uninterrupted_buff_window() {
        let mut log = CombatLog {
            duration_ms: 10000,
            ..Default::default()
        };
        for at in [0, 1000, 2000] {
            log.events.push(CombatEvent {
                at_ms: at,
                source: 1,
                target: 2,
                skill: 18010000,
                instance: 9,
                duration_ms: Some(4000),
                ..CombatEvent::new("buff")
            });
        }
        let r = log.report(&Catalogue::default(), 10000, false, false);
        assert_eq!(r["buffs"].as_array().unwrap().len(), 1);
        assert_eq!(r["buffs"][0]["start_ms"], 0);
        assert_eq!(r["buffs"][0]["end_ms"], 6000);
    }
    #[test]
    fn active_damage_window_is_not_extended_by_later_healing() {
        let mut log = CombatLog {
            duration_ms: 10000,
            ..Default::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                ..Default::default()
            },
        );
        for at in [0, 4000] {
            log.events.push(CombatEvent {
                at_ms: at,
                source: 1,
                target: 2,
                amount: 100,
                ..CombatEvent::new("damage")
            });
        }
        log.events.push(CombatEvent {
            at_ms: 10000,
            source: 1,
            target: 1,
            amount: 100,
            ..CombatEvent::new("heal")
        });
        let r = log.report(&Catalogue::default(), 10000, false, false);
        assert_eq!(r["players"][0]["adps"], 50.0);
        assert_eq!(r["players"][0]["edps"], 20.0);
    }
    #[test]
    fn specialty_codes_require_a_known_mapping_and_stigma_tiers_are_cumulative() {
        let mut catalogue=Catalogue{skills:vec![SkillInfo{id:11010000,name:"Test".into(),specialties:(1..=3).map(|slot|json!({"slot":slot,"name":format!("Choice {slot}"),"description":null})).collect(),..Default::default()}],..Default::default()};
        let mut log = CombatLog {
            duration_ms: 1000,
            ..Default::default()
        };
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                ..Default::default()
            },
        );
        log.events.push(CombatEvent {
            source: 1,
            target: 2,
            skill: 11010120,
            amount: 100,
            ..CombatEvent::new("damage")
        });
        assert_eq!(
            log.report(&catalogue, 1000, false, false)["players"][0]["skills"][0]["specialties"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        log.events[0].skill = 11010900;
        assert!(
            log.report(&catalogue, 1000, false, false)["players"][0]["skills"][0]["specialties"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        catalogue.skills[0].specialty_mode = Some("tier".into());
        log.events[0].skill = 11010030;
        assert_eq!(
            log.report(&catalogue, 1000, false, false)["players"][0]["skills"][0]["specialties"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }
}
