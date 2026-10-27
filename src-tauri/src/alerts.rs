//! Native reminder delivery; sound does not depend on a focused webview or browser gesture.
use companion_capture::{alerts::Delivery, LiveCapture};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn alerts_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LiveCapture>().alerts_status())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn alerts_configure(config: Value, app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<LiveCapture>().alerts_configure(config)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn alerts_action(
    action: String,
    id: Option<String>,
    seconds: Option<u64>,
    app: AppHandle,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<LiveCapture>()
            .alerts_action(&action, id.as_deref(), seconds)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn alerts_test(
    sound: String,
    volume: f64,
    popup: bool,
    app: AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let delivery = app
            .state::<LiveCapture>()
            .alerts_test(&sound, volume, popup)?;
        deliver(&app, &[delivery], true);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("local-alerts".into())
        .spawn(move || {
            let mut next_game_check = std::time::Instant::now();
            loop {
                if std::time::Instant::now() >= next_game_check {
                    let running = !crate::focus::game_process_ids().is_empty();
                    let _ = app.state::<LiveCapture>().alerts_set_game_running(running);
                    next_game_check = std::time::Instant::now() + std::time::Duration::from_secs(2);
                }
                if let Ok((deliveries, active, background)) =
                    app.state::<LiveCapture>().alerts_tick()
                {
                    deliver(&app, &deliveries, background);
                    crate::alert_window::replace(&app, &active);
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        })
        .expect("Could not start local alert clock");
}
fn deliver(app: &AppHandle, deliveries: &[Delivery], background: bool) {
    let popup: Vec<_> = deliveries
        .iter()
        .filter(|d| d.popup && d.status == "delivered")
        .filter_map(|d| serde_json::to_value(d).ok())
        .collect();
    if !popup.is_empty() {
        crate::alert_window::present(app, &popup);
    }
    if background
        || deliveries.iter().any(|d| d.phase == "recovery")
        || crate::overlay::game_active(app)
    {
        // Simultaneous notifications form one batch; one tone avoids an overlapping burst.
        if let Some(d) = deliveries
            .iter()
            .find(|d| d.status == "delivered" && d.sound != "none" && d.volume > 0.)
        {
            if let Err(error) = play(app, &d.sound, d.volume) {
                eprintln!("Local alert sound failed: {error}");
                companion_capture::diagnostics::record("error", "alert-sound", &error);
            }
        }
    }
}
static AUDIO: Mutex<()> = Mutex::new(());
pub fn wave(sound: &str, volume: f64) -> Vec<u8> {
    let rate = 22050u32;
    let samples = rate as usize;
    let mut data = Vec::with_capacity(samples * 2 + 44);
    data.extend(b"RIFF");
    data.extend((36 + samples as u32 * 2).to_le_bytes());
    data.extend(b"WAVEfmt ");
    data.extend(16u32.to_le_bytes());
    data.extend(1u16.to_le_bytes());
    data.extend(1u16.to_le_bytes());
    data.extend(rate.to_le_bytes());
    data.extend((rate * 2).to_le_bytes());
    data.extend(2u16.to_le_bytes());
    data.extend(16u16.to_le_bytes());
    data.extend(b"data");
    data.extend((samples as u32 * 2).to_le_bytes());
    for n in 0..samples {
        let t = n as f64 / rate as f64;
        let (freq, gate) = match sound {
            "ping" => (1046.5, if t < 0.4 { (-t * 12.).exp() } else { 0. }),
            "bell" => (660., (-t * 6.).exp()),
            "beep" => (
                1000.,
                if t < 0.12 || (0.2..0.32).contains(&t) {
                    1.
                } else {
                    0.
                },
            ),
            "pulse" => (
                520.,
                if t < 0.11 || (0.18..0.29).contains(&t) || (0.36..0.47).contains(&t) {
                    1.
                } else {
                    0.
                },
            ),
            "alarm" => (
                if (t / 0.2) as u32 % 2 == 0 {
                    740.
                } else {
                    988.
                },
                if t < 0.8 { 0.7 } else { 0. },
            ),
            _ => (if t < 0.14 { 880. } else { 1318.5 }, (-t * 5.).exp()),
        };
        let envelope = (t * 100.).min(1.) * ((1. - t) * 100.).min(1.);
        let sample = ((std::f64::consts::TAU * freq * t).sin()
            * gate
            * envelope
            * volume.clamp(0., 1.)
            * 10000.) as i16;
        data.extend(sample.to_le_bytes());
    }
    data
}
#[cfg(windows)]
fn play(app: &AppHandle, sound: &str, volume: f64) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "winmm")]
    extern "system" {
        fn PlaySoundW(sound: *const u16, module: *mut std::ffi::c_void, flags: u32) -> i32;
    }
    let _guard = AUDIO.lock().map_err(|_| "Alert audio unavailable")?;
    if !["chime", "ping", "bell", "beep", "pulse", "alarm"].contains(&sound) {
        return Ok(());
    }
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("offline")
        .join("alert-sounds");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let level = (volume.clamp(0., 1.) * 100.).round() as u8;
    let path = folder.join(format!("{sound}-{level}.wav"));
    if !path.exists() {
        std::fs::write(&path, wave(sound, level as f64 / 100.)).map_err(|e| e.to_string())?;
    }
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        PlaySoundW(
            name.as_ptr(),
            std::ptr::null_mut(),
            0x00020000 | 0x0001 | 0x0002,
        )
    } == 0
    {
        return Err("Windows could not play the alert tone".into());
    }
    Ok(())
}
#[cfg(not(windows))]
fn play(_: &AppHandle, _: &str, _: f64) -> Result<(), String> {
    Err("Native alert audio requires Windows".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_audio_has_valid_pcm_length_and_zero_volume_is_silent() {
        let wav = wave("chime", 0.);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44144);
        assert!(wav[44..].iter().all(|n| *n == 0));
        let loud = wave("alarm", 1.);
        assert!(loud[44..].iter().any(|n| *n != 0));
        let ping = wave("ping", 1.);
        assert_ne!(ping, wave("chime", 1.));
        assert!(ping[44 + 17640..].iter().all(|n| *n == 0));
    }
}
