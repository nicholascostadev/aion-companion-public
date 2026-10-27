// One native capture across stable, standalone Dev and live development. The
// OS releases the handle after a crash, so there is no stale lock file.
// The launcher uses a separate signal: WM_CLOSE belongs to hide-to-tray.
#[cfg(windows)]
struct QuitSignal(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl QuitSignal {
    fn create(process_id: u32) -> Result<Self, String> {
        let name: Vec<u16> = format!("Local\\AionCompanion.SaveAndQuit.{process_id}")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let handle = unsafe {
            windows_sys::Win32::System::Threading::CreateEventW(
                std::ptr::null(),
                0,
                0,
                name.as_ptr(),
            )
        };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(Self(handle))
    }
}

#[cfg(windows)]
impl Drop for QuitSignal {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(windows)]
pub fn setup_quit_signal(app: &tauri::AppHandle) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::WAIT_OBJECT_0,
        System::Threading::{WaitForSingleObject, INFINITE},
    };
    let signal = QuitSignal::create(std::process::id())?;
    // Transfer ownership to the blocking worker; Win32 event handles can cross threads.
    let handle = signal.0 as isize;
    std::mem::forget(signal);
    let app = app.clone();
    std::thread::spawn(move || {
        let signal = QuitSignal(handle as _);
        while unsafe { WaitForSingleObject(signal.0, INFINITE) } == WAIT_OBJECT_0 {
            // A failed save cancels quitting; the auto-reset event accepts a later retry.
            let _ = crate::overlay::quit_and_save(
                app.clone(),
                "The launcher asked the app to save and quit",
            );
        }
        crate::overlay::record_error(&app, "Launcher quit signal failed".into());
    });
    Ok(())
}

#[cfg(not(windows))]
pub fn setup_quit_signal(_: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub struct Guard(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Guard {
    pub fn acquire() -> Result<Self, String> {
        Self::acquire_named("Local\\AionCompanion.Capture")
    }
    fn acquire_named(name: &str) -> Result<Self, String> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        };
        let name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe {
                CloseHandle(handle);
            }
            return Err("Aion Companion is already running. Quit its tray app before starting another version.".into());
        }
        Ok(Self(handle))
    }
}
#[cfg(windows)]
impl Drop for Guard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(not(windows))]
pub struct Guard;
#[cfg(not(windows))]
impl Guard {
    pub fn acquire() -> Result<Self, String> {
        Ok(Self)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn launcher_quit_signal_is_separate_and_accepts_retries() {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT},
            System::Threading::{OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE},
        };
        let process_id = std::process::id();
        let signal = QuitSignal::create(process_id).unwrap();
        let name: Vec<u16> = format!("Local\\AionCompanion.SaveAndQuit.{process_id}")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let sender = OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr());
            assert!(!sender.is_null());
            for _ in 0..2 {
                assert_eq!(WaitForSingleObject(signal.0, 0), WAIT_TIMEOUT);
                assert_ne!(SetEvent(sender), 0);
                assert_eq!(WaitForSingleObject(signal.0, 0), WAIT_OBJECT_0);
            }
            CloseHandle(sender);
        }
    }
    #[test]
    fn duplicate_capture_is_rejected_and_exit_releases_guard() {
        let name = format!("Local\\AionCompanion.Test.{}", std::process::id());
        let guard = Guard::acquire_named(&name).unwrap();
        assert!(Guard::acquire_named(&name).is_err());
        drop(guard);
        assert!(Guard::acquire_named(&name).is_ok());
    }
}
