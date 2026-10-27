//! Alert state has its own owner: durable delivery claims never hold capture state.
use crate::{alerts, LiveCapture, Shared};
use companion_core::combat::{Catalogue, CombatEvent};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub(super) enum Update {
    Reset(u64),
    Observe {
        server: Option<u16>,
        events: Vec<CombatEvent>,
        catalogue: Arc<Catalogue>,
        now: u64,
    },
}

/// Lock order is alerts -> capture, and only to take owned observation batches.
/// No caller may wait for the alert owner while holding capture state.
pub(super) fn flush(shared: &Mutex<Shared>) -> Result<(), String> {
    let owner = shared
        .lock()
        .map_err(|_| "Capture state unavailable")?
        .offline
        .alerts_engine
        .clone();
    let mut alerts = owner.lock().map_err(|_| "Alert state unavailable")?;
    let updates = std::mem::take(
        &mut shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .alert_updates,
    );
    for update in updates {
        match update {
            Update::Reset(now) => alerts.reset_session(now),
            Update::Observe {
                server,
                events,
                catalogue,
                now,
            } => {
                alerts.set_server(server);
                alerts.observe(&events, &catalogue, now);
            }
        }
    }
    Ok(())
}

impl LiveCapture {
    pub fn alerts_update_maintenance(
        &self,
        result: Result<Option<crate::server_status::Maintenance>, String>,
        now: u64,
    ) -> Result<(), String> {
        self.with_alerts(|alerts| {
            alerts.update_maintenance(result, now);
            Ok(())
        })
    }
    pub fn alerts_set_game_running(&self, running: bool) -> Result<(), String> {
        self.with_alerts(|alerts| {
            alerts.set_game_running(running);
            Ok(())
        })
    }
    fn with_alerts<T>(
        &self,
        action: impl FnOnce(&mut alerts::Alerts) -> Result<T, String>,
    ) -> Result<T, String> {
        flush(&self.shared)?;
        let owner = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .alerts_engine
            .clone();
        let mut alerts = owner.lock().map_err(|_| "Alert state unavailable")?;
        action(&mut alerts)
    }
    fn alert_dashboard(
        &self,
        action: impl FnOnce(&mut alerts::Alerts) -> Result<(), String>,
    ) -> Result<Value, String> {
        let mut dashboard = self.with_alerts(|alerts| {
            action(alerts)?;
            Ok(alerts.status(crate::wall_clock()))
        })?;
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        dashboard["live_observations"] = (s.running && s.phase == "capturing").into();
        dashboard["bosses"] = s
            .offline
            .catalogue
            .npcs
            .iter()
            .filter(|n| n.boss || crate::alert_catalogue::known_boss(n.id))
            .map(|n| json!({"id":n.id,"name":n.name}))
            .collect::<Vec<_>>()
            .into();
        Ok(dashboard)
    }
    pub fn alerts_status(&self) -> Result<Value, String> {
        self.alert_dashboard(|_| Ok(()))
    }
    pub fn alerts_configure(&self, config: Value) -> Result<Value, String> {
        self.alert_dashboard(|alerts| alerts.configure(config))
    }
    pub fn alerts_action(
        &self,
        action: &str,
        id: Option<&str>,
        seconds: Option<u64>,
    ) -> Result<Value, String> {
        self.alert_dashboard(|alerts| alerts.action(action, id, seconds, crate::wall_clock()))
    }
    pub fn alerts_tick(&self) -> Result<(Vec<alerts::Delivery>, Vec<Value>, bool), String> {
        self.with_alerts(|alerts| {
            let now = crate::wall_clock();
            Ok((
                alerts.tick(now),
                alerts.active(now),
                alerts.background_sound(),
            ))
        })
    }
    pub fn alerts_test(
        &self,
        sound: &str,
        volume: f64,
        popup: bool,
    ) -> Result<alerts::Delivery, String> {
        self.with_alerts(|alerts| alerts.test_delivery(sound, volume, popup, crate::wall_clock()))
    }
}
