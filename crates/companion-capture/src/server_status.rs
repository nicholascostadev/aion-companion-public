//! Ephemeral official maintenance information. Failed requests never prove an outage.
use serde::{Deserialize, Serialize};

pub const FRESH_FOR_MS: u64 = 180_000;
pub const SOURCE: &str = "https://api-global-community.plaync.com/aion2_global/board/notice_en/article/search/moreArticle?isVote=true&moreSize=18&moreDirection=BEFORE&previousArticleId=0";

#[derive(Clone, Debug, Serialize)]
pub struct Maintenance {
    pub title: String,
    pub url: String,
    pub starts_ms: u64,
    pub ends_ms: u64,
    pub completed: bool,
}
// The native adapter supplies the verified public endpoint as the source.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub region: String,
    pub status: String,
    pub population: Option<f64>,
    pub character_creation_open: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Snapshot {
    pub checked_ms: Option<u64>,
    pub last_attempt_ms: Option<u64>,
    pub stale: bool,
    pub error: Option<String>,
    pub source: String,
    pub servers: Vec<Server>,
    pub maintenance: Option<Maintenance>,
}

impl Snapshot {
    pub fn update_maintenance(&mut self, result: Result<Option<Maintenance>, String>, now: u64) {
        match result {
            Ok(maintenance) => {
                let rows: Vec<serde_json::Value> =
                    serde_json::from_str(include_str!("../data/alert-servers.json"))
                        .expect("Bundled server roster");
                let servers = rows
                    .into_iter()
                    .map(|row| Server {
                        id: row["id"].as_str().unwrap_or_default().into(),
                        name: row["name"].as_str().unwrap_or_default().into(),
                        region: row["region"].as_str().unwrap_or_default().into(),
                        status: "unknown".into(),
                        population: None,
                        character_creation_open: None,
                    })
                    .collect();
                self.maintenance = maintenance;
                self.update(Ok(servers), SOURCE, now);
            }
            Err(error) => self.update(Err(error), SOURCE, now),
        }
    }
    pub(crate) fn update(&mut self, result: Result<Vec<Server>, String>, source: &str, now: u64) {
        self.source = source.into();
        self.last_attempt_ms = Some(now);
        match result {
            Ok(servers) if !servers.is_empty() => {
                self.checked_ms = Some(now);
                self.servers = servers;
                self.error = None;
            }
            Ok(_) => self.error = Some("The server status response was empty".into()),
            Err(error) => self.error = Some(error),
        }
    }

    pub fn at(&self, now: u64) -> Self {
        let mut snapshot = self.clone();
        snapshot.stale = !self.fresh(now);
        if let Some(maintenance) = &self.maintenance {
            let active =
                !maintenance.completed && maintenance.starts_ms <= now && now < maintenance.ends_ms;
            for server in &mut snapshot.servers {
                server.status = if active { "maintenance" } else { "unknown" }.into();
            }
        }
        snapshot
    }
    pub fn fresh(&self, now: u64) -> bool {
        self.error.is_none()
            && self
                .checked_ms
                .is_some_and(|at| now >= at && now - at <= FRESH_FOR_MS)
    }

    /// A chosen server wins. Without one, suppress only if every server in the
    /// region is explicitly unavailable. Mixed or unrecognized states stay open.
    pub fn down(&self, server: &str, region: &str, now: u64) -> bool {
        if !matches!(
            region,
            "global" | "latam" | "eu" | "na-east" | "na-west" | "asia"
        ) {
            return false;
        }
        if !self.fresh(now) {
            return false;
        }
        let maintenance_active = self
            .maintenance
            .as_ref()
            .is_some_and(|m| !m.completed && m.starts_ms <= now && now < m.ends_ms);
        let rows: Vec<_> = self
            .servers
            .iter()
            .filter(|row| {
                if !server.is_empty() {
                    row.id == server
                } else {
                    region == "global" || row.region == region
                }
            })
            .collect();
        !rows.is_empty()
            && rows.iter().all(|row| {
                maintenance_active || matches!(row.status.as_str(), "maintenance" | "offline")
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, region: &str, status: &str) -> Server {
        Server {
            id: id.into(),
            name: id.into(),
            region: region.into(),
            status: status.into(),
            population: None,
            character_creation_open: None,
        }
    }

    #[test]
    fn outage_is_scoped_to_selected_server_or_entire_region() {
        let mut snapshot = Snapshot::default();
        snapshot.update(
            Ok(vec![
                row("1401", "latam", "maintenance"),
                row("1402", "latam", "online"),
                row("1301", "eu", "offline"),
            ]),
            "public",
            1000,
        );
        assert!(snapshot.down("1401", "latam", 1001));
        assert!(!snapshot.down("1402", "latam", 1001));
        assert!(!snapshot.down("missing", "latam", 1001));
        assert!(!snapshot.down("", "latam", 1001));
        assert!(snapshot.down("", "eu", 1001));
        assert!(!snapshot.down("", "kr", 1001));
        assert!(!snapshot.down("", "global", 1001));
    }

    #[test]
    fn failed_stale_future_and_unknown_data_cannot_suppress() {
        let mut snapshot = Snapshot::default();
        assert!(snapshot.at(1000).stale);
        snapshot.update(
            Ok(vec![row("1401", "latam", "maintenance")]),
            "public",
            1000,
        );
        assert!(snapshot.down("1401", "latam", 1001));
        assert!(!snapshot.down("1401", "latam", 999));
        assert!(!snapshot.down("1401", "latam", 1001 + FRESH_FOR_MS));
        assert!(snapshot.at(1001 + FRESH_FOR_MS).stale);
        snapshot.update(Err("timeout".into()), "public", 1002);
        assert_eq!(snapshot.checked_ms, Some(1000));
        assert_eq!(snapshot.servers.len(), 1);
        assert!(!snapshot.down("1401", "latam", 1002));
        snapshot.update(Ok(vec![]), "public", 1003);
        assert!(!snapshot.down("1401", "latam", 1003));
        snapshot.update(Ok(vec![row("1401", "latam", "unknown")]), "public", 1004);
        assert!(!snapshot.down("1401", "latam", 1004));
    }
    #[test]
    fn announced_window_has_exact_boundaries_and_completion_cancels_it() {
        let mut snapshot = Snapshot::default();
        let mut maintenance = Maintenance {
            title: "Maintenance".into(),
            url: "https://aion2.plaync.com/notice".into(),
            starts_ms: 1000,
            ends_ms: 10000,
            completed: false,
        };
        snapshot.update_maintenance(Ok(Some(maintenance.clone())), 500);
        assert!(!snapshot.down("1401", "latam", 999));
        assert!(snapshot.down("1401", "latam", 1000));
        assert!(snapshot.down("1401", "latam", 9999));
        assert!(!snapshot.down("1401", "latam", 10000));
        assert!(!snapshot.down("1401", "kr", 1001));
        assert_eq!(snapshot.at(10000).servers[0].status, "unknown");
        maintenance.completed = true;
        snapshot.update_maintenance(Ok(Some(maintenance)), 1100);
        assert!(!snapshot.down("1401", "latam", 1101));
        assert_eq!(snapshot.at(1101).servers[0].status, "unknown");
    }
}
