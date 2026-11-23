//! Overlay visibility intent is independent from the foreground application's focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Game,
    Overlay,
    Other,
}

/// Focus-gated panels: DPS meter (which also shows the party room), top menu and damage details.
pub const PANELS: usize = 3;
/// The panels Escape puts away: the meter and its damage details. The top menu stays, and
/// its meter button brings them back.
const PUT_AWAY: [bool; PANELS] = [true, false, true];

#[derive(Default)]
pub struct Visibility {
    pub requested: [bool; PANELS],
    pub active: bool,
    pub game_focused: bool,
    /// Escape put the meter away (`escape`) until the next Escape or show request.
    pub put_away: bool,
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
        self.active && self.wanted(index)
    }
    /// The user wants this panel: requested, and not put away by Escape.
    pub fn wanted(&self, index: usize) -> bool {
        self.requested[index] && !(self.put_away && PUT_AWAY[index])
    }
    /// Escape pressed. In the game it puts a wanted meter away, so the game's own windows are
    /// not covered, and the next one brings it back. Returns whether anything changed.
    pub fn escape(&mut self) -> bool {
        if !self.game_focused {
            return false;
        }
        let before = self.put_away;
        self.put_away = !before && (0..PANELS).any(|i| PUT_AWAY[i] && self.requested[i]);
        self.put_away != before
    }
    /// A panel was asked for or dismissed: showing the meter or its details ends a put-away.
    pub fn request(&mut self, index: usize, visible: bool) {
        self.requested[index] = visible;
        if visible && PUT_AWAY[index] {
            self.put_away = false;
        }
    }
}

/// Presses of one key, from polling `GetAsyncKeyState`.
#[derive(Default)]
pub struct KeyPresses {
    /// Whether the key was down at the last read; none before the first one.
    down: Option<bool>,
    /// When the press now held was first read.
    since: Option<std::time::Instant>,
}
/// A held key repeats no sooner than Windows' shortest repeat delay (250 ms) after it went
/// down; the margin covers a read that came late.
const BEFORE_REPEAT: std::time::Duration = std::time::Duration::from_millis(150);
impl KeyPresses {
    /// Whether `state`, read at `now`, starts a new press. The low bit (pressed since the
    /// last read) catches a tap shorter than the poll. At the first read it may be a press
    /// from long ago. On a key that was down at the last read and still is, it is a release
    /// and a second press between the two reads, until auto-repeat can have set it.
    pub fn pressed(&mut self, state: u16, now: std::time::Instant) -> bool {
        let down = state & 0x8000 != 0;
        let recent = state & 1 != 0;
        let pressed = match self.down {
            None => false,
            Some(false) => down || recent,
            Some(true) => {
                down && recent
                    && self
                        .since
                        .is_some_and(|at| now.duration_since(at) < BEFORE_REPEAT)
            }
        };
        if pressed || (down && self.down != Some(true)) {
            self.since = Some(now);
        }
        self.down = Some(down);
        pressed
    }
}

/// Escape's `GetAsyncKeyState`. Windows reports zero while the foreground window belongs to
/// a process of higher integrity: an administrator game hides its keys from a companion that
/// was not started as administrator too (`elevated`).
#[cfg(windows)]
pub fn escape_state() -> u16 {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
    (unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE)) }) as u16
}
#[cfg(not(windows))]
pub fn escape_state() -> u16 {
    0
}

/// Whether this process runs as administrator, read once.
#[cfg(windows)]
pub fn elevated() -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    static ELEVATED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ELEVATED.get_or_init(|| unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = 0;
        let read = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        CloseHandle(token);
        read != 0 && elevation.TokenIsElevated != 0
    })
}
#[cfg(not(windows))]
pub fn elevated() -> bool {
    false
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
            requested: [false, true, true],
            ..Default::default()
        };
        assert!(!state.visible(1));
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.visible(1));
        assert!(state.visible(2));
        state.observe(Target::Other);
        assert!((0..PANELS).all(|i| !state.visible(i)));
        assert_eq!(state.requested, [false, true, true]);
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.visible(2));
    }
    #[test]
    fn escape_in_the_game_puts_the_meter_away_and_the_next_one_brings_it_back() {
        let mut state = Visibility {
            requested: [true, true, true],
            ..Default::default()
        };
        // Escape in another app, or in one of our own windows, is not the game's.
        assert!(!state.escape());
        state.observe(Target::Game);
        state.observe(Target::Overlay);
        assert!(!state.escape());
        assert!(state.visible(0));
        state.observe(Target::Game);
        // The meter and its details go; the top menu stays, and no request is lost.
        assert!(state.escape());
        assert_eq!(
            [state.visible(0), state.visible(1), state.visible(2)],
            [false, true, false]
        );
        assert_eq!(state.requested, [true, true, true]);
        assert!(!state.wanted(0));
        // Switching apps and back keeps it away: the game's window is still open.
        state.observe(Target::Other);
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.escape());
        assert!(state.visible(0) && state.visible(2));
    }
    #[test]
    fn a_show_request_ends_a_put_away_and_nothing_is_put_away_without_a_meter() {
        let mut state = Visibility {
            requested: [true, true, false],
            ..Default::default()
        };
        state.observe(Target::Game);
        state.escape();
        // Asking for the menu changes nothing; asking for the meter brings it back.
        state.request(1, true);
        assert!(!state.visible(0));
        state.request(0, true);
        assert!(state.visible(0));
        // Hidden by the user: Escape has nothing to put away, so the next show is not undone.
        state.request(0, false);
        assert!(!state.escape());
        assert!(!state.put_away);
        state.request(0, true);
        assert!(state.visible(0));
    }
    #[test]
    fn a_key_press_counts_once_however_long_it_is_held() {
        let start = std::time::Instant::now();
        let at = |ms: u64| start + std::time::Duration::from_millis(ms);
        let mut key = KeyPresses::default();
        // A press from before the first read is not a new one.
        assert!(!key.pressed(0x0001, at(0)));
        assert!(!key.pressed(0, at(25)));
        // Down, held until it auto-repeats, released: one press.
        assert!(key.pressed(0x8001, at(50)));
        assert!(!key.pressed(0x8000, at(75)));
        assert!(!key.pressed(0x8001, at(300)));
        assert!(!key.pressed(0x8001, at(325)));
        assert!(!key.pressed(0x0001, at(350)));
        assert!(!key.pressed(0, at(375)));
        // A tap shorter than the poll leaves only the low bit.
        assert!(key.pressed(0x0001, at(400)));
        assert!(!key.pressed(0, at(425)));
        // Unreadable keys (an administrator game in front) never press.
        assert!((0..8).all(|i| !key.pressed(0, at(450 + i * 25))));
        // A key already down at the first read is not a new press either.
        let mut held = KeyPresses::default();
        assert!(!held.pressed(0x8000, at(0)));
        assert!(!held.pressed(0, at(25)));
        assert!(held.pressed(0x8000, at(50)));
    }
    #[test]
    fn a_second_press_between_two_reads_counts_before_auto_repeat_can_start() {
        let start = std::time::Instant::now();
        let at = |ms: u64| start + std::time::Duration::from_millis(ms);
        let mut key = KeyPresses::default();
        assert!(!key.pressed(0, at(0)));
        // Pressed, then released and pressed again between two reads: down both times, with
        // a new press recorded.
        assert!(key.pressed(0x8001, at(25)));
        assert!(key.pressed(0x8001, at(50)));
        assert!(!key.pressed(0x8000, at(75)));
        // Held on, the same reading is auto-repeat.
        assert!(!key.pressed(0x8001, at(325)));
        assert!(!key.pressed(0, at(350)));
    }
    #[test]
    fn overlay_interactions_preserve_game_context_but_cannot_start_it() {
        let mut state = Visibility {
            requested: [true, true, true],
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
            requested: [true, false, false],
            ..Default::default()
        };
        state.observe(Target::Game);
        state.observe(Target::Other);
        state.requested[0] = false;
        state.requested[1] = true;
        assert!((0..PANELS).all(|i| !state.visible(i)));
        state.observe(Target::Game);
        assert!(!state.visible(0));
        assert!(state.visible(1));
        state.requested[2] = true;
        // An open damage-details panel follows the same focus gate as the meter.
        assert!(state.visible(2));
        state.observe(Target::Other);
        assert!(!state.visible(2));
    }
}
