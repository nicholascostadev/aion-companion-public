//! Native replay sessions are independent of live capture. Replacing a replay
//! swaps one Arc; snapshot computation and file writes never hold its mutex.
use companion_core::{DemoSource, EventSource, Recording, Snapshot};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

pub struct Session(Mutex<Arc<Recording>>);

impl Default for Session {
    fn default() -> Self {
        Self(Mutex::new(Arc::new(
            DemoSource.recording().expect("Valid bundled fixture"),
        )))
    }
}

impl Session {
    fn current(&self) -> Result<Arc<Recording>, String> {
        self.0
            .lock()
            .map(|r| r.clone())
            .map_err(|_| "Session unavailable".into())
    }

    fn replace(&self, recording: Recording) -> Result<Recording, String> {
        let stored = Arc::new(recording.clone());
        *self.0.lock().map_err(|_| "Session unavailable")? = stored;
        Ok(recording)
    }
}

#[tauri::command]
pub async fn load_live_recording(id: Option<u64>, app: AppHandle) -> Result<Recording, String> {
    crate::background::run(move || {
        let recording = app
            .state::<companion_capture::LiveCapture>()
            .recording_id(id)?;
        app.state::<Session>().replace(recording)
    })
    .await
}

#[tauri::command]
pub async fn demo(app: AppHandle) -> Result<Recording, String> {
    crate::background::run(move || app.state::<Session>().replace(DemoSource.recording()?)).await
}

#[tauri::command]
pub async fn snapshot(at_ms: u64, app: AppHandle) -> Result<Snapshot, String> {
    crate::background::run(move || app.state::<Session>().current()?.snapshot(at_ms)).await
}

#[tauri::command]
pub async fn import_recording(json: String, app: AppHandle) -> Result<Recording, String> {
    crate::background::run(move || {
        if json.len() > 128 * 1024 * 1024 {
            return Err("Recording exceeds 128 MiB".into());
        }
        app.state::<Session>().replace(Recording::from_json(&json)?)
    })
    .await
}

#[tauri::command]
pub async fn save_recording(app: AppHandle) -> Result<String, String> {
    crate::background::run(move || {
        let recording = app.state::<Session>().current()?;
        let folder = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("recordings");
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let path = folder.join(format!("{stamp}.replay.json"));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, &*recording).map_err(|e| e.to_string())?;
        std::io::Write::flush(&mut writer).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacing_a_replay_preserves_an_in_flight_snapshot() {
        let session = Session::default();
        let previous = session.current().unwrap();
        let mut next = (*previous).clone();
        next.events.clear();
        session.replace(next).unwrap();
        assert!(!previous.events.is_empty());
        assert!(session.current().unwrap().events.is_empty());
        assert!(previous.snapshot(previous.duration_ms).is_ok());
    }

    #[test]
    fn reading_a_session_shares_immutable_data() {
        let session = Session::default();
        assert!(Arc::ptr_eq(
            &session.current().unwrap(),
            &session.current().unwrap()
        ));
    }
}
