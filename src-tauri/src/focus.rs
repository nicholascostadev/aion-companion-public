//! Overlay visibility intent is independent from the foreground application's focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Game,
    Overlay,
    Other,
}

/// Focus-gated panels: DPS meter, top menu, Group inspection and damage details.
pub const PANELS: usize = 4;

#[derive(Default)]
pub struct Visibility {
    pub requested: [bool; PANELS],
    pub active: bool,
    pub game_focused: bool,
}
impl Visibility {
    pub fn observe(&mut self, target: Target) -> bool {
        let previous = (self.active, self.game_focused);
        self.game_focused = target == Target::Game;
        self.active = match target {
            Target::Game => true,
            // Preserve interaction with our own overlay after clicking it over the game.
            Target::Overlay => self.active,
            Target::Other => false,
        };
        previous != (self.active, self.game_focused)
    }
    pub fn visible(&self, index: usize) -> bool {
        self.active && self.requested[index]
    }
}

#[cfg(windows)]
pub fn game_process_ids() -> Vec<u32> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    let mut ids = Vec::new();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return ids;
    }
    let mut row = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    unsafe {
        let mut exists = Process32FirstW(snapshot, &mut row);
        while exists != 0 {
            let end = row
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(row.szExeFile.len());
            if String::from_utf16_lossy(&row.szExeFile[..end]).eq_ignore_ascii_case("AION2.exe") {
                ids.push(row.th32ProcessID);
            }
            exists = Process32NextW(snapshot, &mut row);
        }
        CloseHandle(snapshot);
    }
    ids
}

#[cfg(windows)]
pub fn foreground_target(game_ids: &[u32], overlay_handles: &[isize]) -> Target {
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        },
    };
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return Target::Other;
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(foreground, &mut pid);
    }
    if game_ids.contains(&pid) && unsafe { IsIconic(foreground) } == 0 {
        return Target::Game;
    }
    if pid != std::process::id() || !overlay_handles.contains(&(foreground as isize)) {
        return Target::Other;
    }
    struct Search<'a> {
        ids: &'a [u32],
        visible: bool,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> i32 {
        let search = unsafe { &mut *(data as *mut Search<'_>) };
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if search.ids.contains(&pid)
            && unsafe { IsWindowVisible(hwnd) } != 0
            && unsafe { IsIconic(hwnd) } == 0
        {
            search.visible = true;
            return 0;
        }
        1
    }
    let mut search = Search {
        ids: game_ids,
        visible: false,
    };
    unsafe {
        EnumWindows(Some(visit), &mut search as *mut Search<'_> as LPARAM);
    }
    if search.visible {
        Target::Overlay
    } else {
        Target::Other
    }
}

#[cfg(not(windows))]
pub fn game_process_ids() -> Vec<u32> {
    Vec::new()
}
#[cfg(not(windows))]
pub fn foreground_target(_: &[u32], _: &[isize]) -> Target {
    Target::Other
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn switching_apps_hides_and_restores_only_requested_panels() {
        let mut state = Visibility {
            requested: [false, true, true, false],
            ..Default::default()
        };
        assert!(!state.visible(1));
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.visible(1));
        assert!(state.visible(2));
        state.observe(Target::Other);
        assert!((0..PANELS).all(|i| !state.visible(i)));
        assert_eq!(state.requested, [false, true, true, false]);
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.visible(2));
    }
    #[test]
    fn overlay_interactions_preserve_game_context_but_cannot_start_it() {
        let mut state = Visibility {
            requested: [true, true, true, true],
            ..Default::default()
        };
        state.observe(Target::Overlay);
        assert!(!state.active);
        state.observe(Target::Game);
        state.observe(Target::Overlay);
        assert!(state.active);
        assert!(!state.game_focused);
        assert!(state.visible(0));
        state.observe(Target::Other);
        state.observe(Target::Overlay);
        assert!(!state.active);
    }
    #[test]
    fn manual_choices_while_unfocused_are_used_when_game_returns() {
        let mut state = Visibility {
            requested: [true, true, false, true],
            ..Default::default()
        };
        state.observe(Target::Game);
        state.observe(Target::Other);
        state.requested[0] = false;
        state.requested[2] = true;
        assert!((0..PANELS).all(|i| !state.visible(i)));
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.visible(2));
        // An open damage-details panel follows the same focus gate as the meter.
        assert!(state.visible(3));
        state.observe(Target::Other);
        assert!(!state.visible(3));
    }
}
