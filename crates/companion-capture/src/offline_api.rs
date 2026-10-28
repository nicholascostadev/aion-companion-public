//! Application-facing offline operations. Capture owns mutable observations;
//! report requests own their input and execute after releasing capture state.
use crate::{offline, LiveCapture};
use serde_json::{json, Value};

impl LiveCapture {
    /// Drain acknowledged files before a backup takes the durable-file barrier.
    pub fn flush_profile(&self) -> Result<(), String> {
        let pets = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .pets
            .clone();
        pets.lock()
            .map_err(|_| "Pet state unavailable")?
            .checkpoint()?;
        crate::flush_storage(&self.shared, true)
    }
    /// Preferences-only reads must not build or serialize a combat report.
    pub fn offline_settings(&self) -> Result<Value, String> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .settings
            .clone())
    }
    pub fn initialize_offline(&self, root: std::path::PathBuf) -> Result<(), String> {
        let mut s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        s.pets
            .lock()
            .map_err(|_| "Pet state unavailable")?
            .initialize(root.clone())?;
        s.offline.initialize(root)?;
        let storage = crate::storage::Storage::new()?;
        s.offline.storage = Some(storage.clone());
        s.pets.lock().map_err(|_| "Pet state unavailable")?.storage = Some(storage.clone());
        s.offline
            .alerts_engine
            .lock()
            .map_err(|_| "Alert state unavailable")?
            .storage = Some(storage);
        s.skill_names = s
            .offline
            .catalogue
            .skills
            .iter()
            .map(|i| (i.id, i.name.clone()))
            .collect();
        s.party_only = s.offline.settings["party_only"].as_bool().unwrap_or(false);
        Ok(())
    }
    pub fn offline_status(&self) -> Result<Value, String> {
        self.offline_status_detail(true)
    }
    pub fn offline_live_status(&self) -> Result<Value, String> {
        self.offline_status_detail(false)
    }
    fn offline_status_detail(&self, full: bool) -> Result<Value, String> {
        let mut cache = self
            .report_cache
            .lock()
            .map_err(|_| "Report state unavailable")?;
        let mut s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let now = s.now();
        s.offline.tick(now);
        let o = &s.offline;
        let key = o.report_key();
        let request = if cache
            .as_ref()
            .is_some_and(|cached| cached.key == key && cached.at.elapsed().as_millis() < 250)
        {
            None
        } else {
            Some(o.poll_update(now, cache.as_ref()))
        };
        let capabilities = json!({
            "independent": true,
            "uploads": false,
            "protocol": "Global packet layouts; TW/KR shared opcodes require regional traffic validation",
            "ready_check": true,
            "capture_running": s.running,
            "cooldown_units": "Raw cooldown units are preserved; catalogue-based timers require a verified duration"
        });
        let mut status = json!({
            "settings": o.settings,
            "trackers": o.trackers(now),
            "library_count": o.library_count(),
            "alerts": o.alerts(crate::wall_clock()),
            "catalogue": {"skills": o.catalogue.skills.len(), "npcs": o.catalogue.npcs.len()},
            "capabilities": capabilities,
            "error": o.storage.as_ref().and_then(|storage| storage.error()).or_else(|| o.persistence_error.clone()).or_else(|| o.error.clone())
        });
        drop(s);
        crate::flush_storage(&self.shared, false)?;
        // Aggregation, detail serialization and cache cloning cannot stall ingest.
        if let Some(update) = request {
            let previous = cache.take();
            *cache = Some(update.execute(previous, key));
        }
        status["report"] = cache
            .as_mut()
            .expect("Report prepared above")
            .report(full)
            .clone();
        Ok(status)
    }
    pub fn offline_configure(&self, settings: Value) -> Result<Value, String> {
        self.offline_configure_with(settings, |_| Ok(()))
    }
    /// Validate, apply native side effects, and persist as one settings transaction.
    /// Native adapters provide the side effect without introducing a Tauri dependency.
    pub fn offline_configure_with(
        &self,
        settings: Value,
        mut apply: impl FnMut(&Value) -> Result<(), String>,
    ) -> Result<Value, String> {
        let _transaction = self
            .settings_transaction
            .lock()
            .map_err(|_| "Settings transaction unavailable")?;
        let previous = self.offline_settings()?;
        let next = self.offline_validate(settings)?;
        let result = apply(&next).and_then(|()| self.persist_offline_settings(next));
        if let Err(error) = &result {
            if let Err(rollback) = apply(&previous) {
                return Err(format!(
                    "{error}; could not restore native settings: {rollback}"
                ));
            }
        }
        result
    }
    pub(super) fn persist_offline_settings(&self, settings: Value) -> Result<Value, String> {
        let next = self.offline_validate(settings)?;
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let write = s.offline.settings_write(next.clone());
        let storage = s.offline.storage.clone();
        drop(s);
        if let Some(write) = write {
            if let Some(storage) = storage {
                storage.write(vec![write])?;
            } else {
                write.execute()?;
            }
        }
        let mut s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        s.offline.settings = next.clone();
        s.party_only = next["party_only"].as_bool().unwrap_or(false);
        Ok(next)
    }
    pub fn offline_positions(&self, preset_id: &str, positions: Value) -> Result<Value, String> {
        let _transaction = self
            .settings_transaction
            .lock()
            .map_err(|_| "Settings transaction unavailable")?;
        let mut validation = offline::Offline::default();
        validation.settings = self.offline_settings()?;
        let next = validation.positions(preset_id, positions)?;
        self.persist_offline_settings(next)
    }
    pub fn offline_validate(&self, settings: Value) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let mut validation = offline::Offline::default();
        validation.settings = s.offline.settings.clone();
        validation.configure(settings)
    }
    pub fn offline_toggle_compact(&self) -> Result<(), String> {
        let _transaction = self
            .settings_transaction
            .lock()
            .map_err(|_| "Settings transaction unavailable")?;
        let compact = self.offline_settings()?["compact_strip"]
            .as_bool()
            .unwrap_or(false);
        self.persist_offline_settings(json!({"compact_strip":!compact}))?;
        Ok(())
    }
    pub fn offline_logs(&self, query: Value) -> Result<Value, String> {
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        Ok(json!(s.offline.logs(&query)?))
    }
    pub fn offline_log(&self, id: &str) -> Result<Value, String> {
        self.offline_log_filtered(id, false)
    }
    pub fn offline_log_filtered(&self, id: &str, boss_only: bool) -> Result<Value, String> {
        crate::flush_storage(&self.shared, false)?;
        let request = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .read_request(id, boss_only)?;
        request.execute()
    }
    pub fn offline_inspect(&self, id: &str) -> Result<Value, String> {
        self.offline_inspect_filtered(id, false)
    }
    pub fn offline_inspect_filtered(&self, id: &str, boss_only: bool) -> Result<Value, String> {
        crate::flush_storage(&self.shared, false)?;
        let request = {
            let s = self
                .shared
                .lock()
                .map_err(|_| "Capture state unavailable")?;
            s.offline.inspect_filtered_request(id, s.now(), boss_only)?
        };
        request.execute()
    }
    pub fn offline_log_rename(&self, id: &str, label: &str) -> Result<Value, String> {
        crate::flush_storage(&self.shared, false)?;
        let source = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .read_request(id, false)?
            .source;
        let log = source.load()?;
        crate::storage_operation(
            &self.shared,
            |state| state.offline.rename_loaded(id, label, log),
            false,
        )
    }
    pub fn offline_log_delete(&self, ids: &[String]) -> Result<usize, String> {
        crate::storage_operation(&self.shared, |state| state.offline.delete(ids), false)
    }
    pub fn offline_export(&self, id: &str) -> Result<String, String> {
        crate::flush_storage(&self.shared, false)?;
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let source = s.offline.read_request(id, false)?.source;
        let path = s.offline.export_path(id)?;
        let storage = s.offline.storage.clone();
        drop(s);
        let write = crate::storage::Write::json(path.clone(), source.load()?);
        if let Some(storage) = storage {
            storage.write(vec![write])?;
        } else {
            write.execute()?;
        }
        Ok(path.to_string_lossy().into())
    }
    pub fn offline_catalogue_import(&self, json: &str) -> Result<Value, String> {
        let _transaction = self
            .settings_transaction
            .lock()
            .map_err(|_| "Settings transaction unavailable")?;
        let mut validation = offline::Offline::default();
        validation.catalogue = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .catalogue
            .clone();
        let result = validation.catalogue_import(json)?;
        let s = self
            .shared
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        let write = s.offline.catalogue_write(validation.catalogue.clone());
        let storage = s.offline.storage.clone();
        drop(s);
        if let Some(write) = write {
            if let Some(storage) = storage {
                storage.write(vec![write])?;
            } else {
                write.execute()?;
            }
        }
        self.shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .replace_catalogue(validation.catalogue);
        Ok(result)
    }
    pub fn offline_save(&self) -> Result<Value, String> {
        crate::storage_operation(
            &self.shared,
            |s| {
                let now = s.now();
                s.offline.tick(now);
                s.offline.save()
            },
            true,
        )
    }
    pub fn offline_clear(&self) -> Result<(), String> {
        crate::storage_operation(
            &self.shared,
            |s| {
                let now = s.now();
                s.offline.finish("manual", now);
                s.offline.clear();
                Ok(())
            },
            false,
        )
    }
    pub fn offline_data_folder(&self) -> Result<String, String> {
        self.shared
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .offline
            .data_folder()
    }
    pub fn offline_summary(&self, id: Option<&str>, multiline: bool) -> Result<String, String> {
        let settings = self.offline_settings()?;
        let locale = settings["locale"].as_str().unwrap_or("en");
        let report = if let Some(id) = id {
            self.offline_log(id)?
        } else {
            self.offline_live_status()?["report"].take()
        };
        let rows = report["players"].as_array().ok_or("No recorded players")?;
        let total: f64 = rows
            .iter()
            .map(|p| p["damage"].as_f64().unwrap_or(0.))
            .sum();
        let parts = rows
            .iter()
            .filter(|p| p["damage"].as_u64().unwrap_or(0) > 0)
            .enumerate()
            .map(|(i, p)| {
                crate::localization::render(
                    locale,
                    "summaryRow",
                    &[
                        ("rank", (i + 1).to_string()),
                        (
                            "name",
                            p["name"]
                                .as_str()
                                .unwrap_or(crate::localization::text(locale, "unknownPlayer"))
                                .to_string(),
                        ),
                        (
                            "dps",
                            crate::localization::number(
                                locale,
                                p["edps"].as_f64().unwrap_or(0.),
                                0,
                            ),
                        ),
                        (
                            "damage",
                            crate::localization::number(
                                locale,
                                p["damage"].as_f64().unwrap_or(0.),
                                0,
                            ),
                        ),
                        (
                            "share",
                            crate::localization::number(
                                locale,
                                p["damage"].as_f64().unwrap_or(0.) / total.max(1.) * 100.,
                                1,
                            ),
                        ),
                    ],
                )
            })
            .collect::<Vec<_>>();
        Ok(parts.join(if multiline { "\n" } else { " | " }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use companion_core::combat::{ActorInfo, CombatEvent};
    use std::sync::Arc;

    #[test]
    fn language_settings_preserve_legacy_values_and_reject_invalid_changes() {
        let live = LiveCapture::default();
        for locale in ["pt", "pt-BR", "de", "en"] {
            let saved = live.offline_configure(json!({"locale":locale})).unwrap();
            assert_eq!(saved["locale"], locale);
            let saved = live.offline_configure(json!({"opacity":0.8})).unwrap();
            assert_eq!(saved["locale"], locale);
        }
        assert!(live.offline_configure(json!({"locale":"pt-PT"})).is_err());
        assert_eq!(live.offline_settings().unwrap()["locale"], "en");
    }

    #[test]
    fn copied_summary_follows_saved_locale_without_changing_report_data() {
        let live = LiveCapture::default();
        let root = library_root("locale-summary");
        live.initialize_offline(root.clone()).unwrap();
        seed(&live);
        live.offline_save().unwrap();
        let before = live.offline_log("snapshot-fight").unwrap();
        let english = live.offline_summary(Some("snapshot-fight"), true).unwrap();
        assert!(english.contains("Tester:"));
        assert!(english.contains("150 damage (100.0%)"));
        for locale in ["pt", "pt-BR"] {
            live.offline_configure(json!({"locale":locale})).unwrap();
            let translated = live.offline_summary(Some("snapshot-fight"), true).unwrap();
            assert!(translated.contains("Tester:"));
            assert!(translated.contains("150 de dano (100,0%)"));
            assert_eq!(live.offline_log("snapshot-fight").unwrap(), before);
        }
        drop(live);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn library_root(label: &str) -> std::path::PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "aion-architecture-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    #[test]
    fn legacy_target_scope_is_reset_once_without_resetting_other_preferences() {
        for direct in [false, true] {
            let root = library_root(if direct { "scope-direct" } else { "scope-api" });
            std::fs::create_dir_all(&root).unwrap();
            let mut legacy = offline::defaults();
            legacy["target_mode"] = "boss".into();
            legacy["locale"] = "pt-BR".into();
            legacy["party_only"] = true.into();
            legacy["idle_timeout_seconds"] = 20.into();
            legacy["opacity"] = 0.7.into();
            legacy["hotkeys"]["reset"] = "Ctrl+Shift+F7".into();
            std::fs::write(root.join("settings.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
            let live = LiveCapture::default();
            live.initialize_offline(root.clone()).unwrap();
            let mut expected = legacy;
            expected["target_mode"] = "all".into();
            assert_eq!(live.offline_settings().unwrap(), expected);
            let disk: Value = serde_json::from_slice(&std::fs::read(root.join("settings.json")).unwrap()).unwrap();
            assert_eq!(disk["target_mode"], "all");
            assert_eq!(disk, expected);
            // Migration metadata stays outside the settings API/file so older
            // versions and backup restores can still read all preferences.
            let marker: Value = serde_json::from_slice(&std::fs::read(root.join("target-scope-migration.json")).unwrap()).unwrap();
            assert_eq!(marker["version"], 1);
            if direct {
                live.shared.lock().unwrap().offline.configure(json!({"target_mode":"boss"})).unwrap();
            } else {
                live.offline_configure(json!({"target_mode":"boss"})).unwrap();
            }
            drop(live);
            let restarted = LiveCapture::default();
            restarted.initialize_offline(root.clone()).unwrap();
            expected["target_mode"] = "boss".into();
            assert_eq!(restarted.offline_settings().unwrap(), expected);
            drop(restarted);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn new_profiles_default_to_all_targets_and_keep_a_later_explicit_choice() {
        let root = library_root("scope-new");
        let live = LiveCapture::default();
        live.initialize_offline(root.clone()).unwrap();
        assert_eq!(live.offline_settings().unwrap()["target_mode"], "all");
        live.offline_configure(json!({"target_mode":"boss"})).unwrap();
        drop(live);
        let restarted = LiveCapture::default();
        restarted.initialize_offline(root.clone()).unwrap();
        assert_eq!(restarted.offline_settings().unwrap()["target_mode"], "boss");
        drop(restarted);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn target_scope_migration_retries_after_an_unwritable_settings_file() {
        let root = library_root("scope-retry");
        std::fs::create_dir_all(&root).unwrap();
        let original = br#"{"target_mode":"boss","locale":"pt-BR"}"#;
        std::fs::write(root.join("settings.json"), original).unwrap();
        std::fs::create_dir(root.join("settings.pending")).unwrap();
        let live = LiveCapture::default();
        assert!(live.initialize_offline(root.clone()).is_err());
        assert_eq!(std::fs::read(root.join("settings.json")).unwrap(), original);
        assert!(!root.join("target-scope-migration.json").exists());
        drop(live);
        std::fs::remove_dir(root.join("settings.pending")).unwrap();
        let restarted = LiveCapture::default();
        restarted.initialize_offline(root.clone()).unwrap();
        let settings = restarted.offline_settings().unwrap();
        assert_eq!(settings["target_mode"], "all");
        assert_eq!(settings["locale"], "pt-BR");
        assert!(root.join("target-scope-migration.json").exists());
        drop(restarted);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compact_polling_does_not_prepare_full_detail_and_full_reads_remain_cached() {
        let live = LiveCapture::default();
        seed(&live);
        let summary = live.offline_live_status().unwrap();
        assert_eq!(summary["report"]["event_count"], 1);
        assert_eq!(summary["report"]["events"], json!([]));
        assert_eq!(summary["report"]["detail_level"], "summary");
        assert!(!live
            .report_cache
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .has_full_detail());
        let full = live.offline_status().unwrap();
        assert_eq!(full["report"]["players"], summary["report"]["players"]);
        assert_eq!(full["report"]["events"].as_array().unwrap().len(), 1);
        assert!(live
            .report_cache
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .has_full_detail());
        live.offline_live_status().unwrap();
        assert!(live
            .report_cache
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .has_full_detail());
    }

    #[test]
    fn failed_encounter_save_is_retained_and_retried_before_clear_or_shutdown() {
        let root = library_root("retry");
        let live = LiveCapture::default();
        live.initialize_offline(root.clone()).unwrap();
        seed(&live);
        let obstruction = root.join("logs/snapshot-fight.pending");
        std::fs::create_dir(&obstruction).unwrap();
        assert!(live.offline_save().is_err());
        assert_eq!(live.shared.lock().unwrap().offline.pending_saves.len(), 1);
        assert!(live.offline_clear().is_err());
        assert!(live.stop().is_err());
        assert_eq!(live.shared.lock().unwrap().offline.log.id, "snapshot-fight");
        std::fs::remove_dir(obstruction).unwrap();
        live.offline_clear().unwrap();
        live.stop().unwrap();
        let saved: companion_core::combat::CombatLog =
            serde_json::from_slice(&std::fs::read(root.join("logs/snapshot-fight.json")).unwrap())
                .unwrap();
        assert_eq!(saved.events.len(), 1);
        let active: companion_core::combat::CombatLog =
            serde_json::from_slice(&std::fs::read(root.join("active.json")).unwrap()).unwrap();
        assert!(active.events.is_empty());
        assert!(live.shared.lock().unwrap().offline.pending_saves.is_empty());
        assert!(live.offline_live_status().unwrap()["error"].is_null());
        drop(live);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pet_and_alert_owner_waits_do_not_hold_capture_state() {
        let live = Arc::new(LiveCapture::default());
        let (pets, alerts) = {
            let state = live.shared.lock().unwrap();
            (state.pets.clone(), state.offline.alerts_engine.clone())
        };
        let pet_gate = pets.lock().unwrap();
        let alert_gate = alerts.lock().unwrap();
        let p = live.clone();
        let a = live.clone();
        let pet_read = std::thread::spawn(move || p.pets_status(None));
        let alert_read = std::thread::spawn(move || a.alerts_status());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while Arc::strong_count(&pets) < 3 || Arc::strong_count(&alerts) < 3 {
            assert!(
                std::time::Instant::now() < deadline,
                "Owner reads did not start"
            );
            std::thread::yield_now();
        }
        // Probe on its own thread so a lock-order regression fails with a timeout.
        let capture = live.clone();
        let (done, probe) = std::sync::mpsc::channel();
        let snapshot = std::thread::spawn(move || done.send(capture.snapshot()).unwrap());
        assert!(probe
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .is_ok());
        drop(pet_gate);
        drop(alert_gate);
        snapshot.join().unwrap();
        pet_read.join().unwrap().unwrap();
        alert_read.join().unwrap().unwrap();
    }

    #[test]
    fn settings_side_effects_run_without_capture_lock_and_rollback_on_write_failure() {
        let live = LiveCapture::default();
        let root = std::env::temp_dir().join(format!(
            "aion-settings-transaction-{}-{}",
            std::process::id(),
            crate::wall_clock()
        ));
        live.initialize_offline(root.clone()).unwrap();
        let previous = live.offline_settings().unwrap();
        // Force persistence failure after native side effects have succeeded.
        std::fs::create_dir(root.join("settings.pending")).unwrap();
        let mut applied = Vec::new();
        let result = live.offline_configure_with(json!({"opacity":0.7}), |settings| {
            assert!(live.shared.try_lock().is_ok());
            assert!(live.settings_transaction.try_lock().is_err());
            applied.push(settings["opacity"].clone());
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(applied, vec![json!(0.7), previous["opacity"].clone()]);
        assert_eq!(live.offline_settings().unwrap(), previous);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn settings_validation_failure_never_applies_native_side_effects() {
        let live = LiveCapture::default();
        let mut calls = 0;
        assert!(live
            .offline_configure_with(json!({"opacity":0}), |_| {
                calls += 1;
                Ok(())
            })
            .is_err());
        assert_eq!(calls, 0);
        assert_eq!(live.offline_settings().unwrap()["opacity"], 1.0);
    }

    #[test]
    fn a_partially_failed_native_settings_change_is_restored() {
        let live = LiveCapture::default();
        let mut applied = Vec::new();
        let result = live.offline_configure_with(json!({"opacity":0.7}), |settings| {
            applied.push(settings["opacity"].clone());
            if applied.len() == 1 {
                Err("Native configuration failed".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(result.unwrap_err(), "Native configuration failed");
        assert_eq!(applied, vec![json!(0.7), json!(1.0)]);
        assert_eq!(live.offline_settings().unwrap()["opacity"], 1.0);
    }

    fn seed(live: &LiveCapture) {
        let mut state = live.shared.lock().unwrap();
        let log = &mut state.offline.log;
        log.id = "snapshot-fight".into();
        log.duration_ms = 2000;
        log.actors.insert(
            1,
            ActorInfo {
                id: 1,
                name: "Tester".into(),
                ..Default::default()
            },
        );
        log.events.push(CombatEvent {
            at_ms: 1000,
            source: 1,
            target: 2,
            skill: 11010000,
            amount: 150,
            ..CombatEvent::new("damage")
        });
    }

    #[test]
    fn prepared_report_is_immutable_and_executes_while_capture_is_locked() {
        let live = LiveCapture::default();
        seed(&live);
        let request = {
            let state = live.shared.lock().unwrap();
            state
                .offline
                .inspect_request("snapshot-fight", 2000)
                .unwrap()
        };
        let mut state = live.shared.lock().unwrap();
        state.offline.log.events.clear();
        state
            .offline
            .catalogue_import(r#"{"skills":[{"id":11010000,"name":"New metadata"}]}"#)
            .unwrap();
        // No capture lock is available here. The request also retains the old
        // catalogue version instead of mixing metadata from a later command.
        let report = request.execute().unwrap();
        assert_eq!(report["players"][0]["damage"], 150);
        assert_eq!(report["players"][0]["skills"][0]["name"], "Skill #11010000");
        drop(state);
    }

    #[test]
    fn cached_polling_report_invalidates_for_metadata_and_filter_changes() {
        let live = LiveCapture::default();
        seed(&live);
        assert_eq!(
            live.offline_status().unwrap()["report"]["players"][0]["damage"],
            150
        );
        live.offline_catalogue_import(r#"{"skills":[{"id":11010000,"name":"Verified skill"}]}"#)
            .unwrap();
        let next = live.offline_status().unwrap();
        assert_eq!(
            next["report"]["players"][0]["skills"][0]["name"],
            "Verified skill"
        );
        live.offline_configure(json!({"party_only":true})).unwrap();
        assert!(live.offline_status().unwrap()["report"]["players"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_poll_waiting_for_the_report_worker_does_not_block_capture() {
        let live = Arc::new(LiveCapture::default());
        let gate = live.report_cache.lock().unwrap();
        let worker_live = live.clone();
        let (started, ready) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            worker_live.offline_status().unwrap()
        });
        ready
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        assert!(live.snapshot().is_ok());
        assert!(live.group_snapshot().is_ok());
        drop(gate);
        assert!(worker.join().unwrap()["report"].is_object());
    }
}
