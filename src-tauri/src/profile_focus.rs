//! The character profile's exception to `no_activate`: a profile the user opens takes the
//! foreground once, a click on it activates it like any dialog, so AION stops holding the
//! mouse while the user reads it, and an explicit Close or Escape gives it back to the game.
//!
//! Every other in-game window still never activates (`no_activate`). Showing the profile
//! (the focus gate) never activates it either: only the steps below and the user's own
//! clicks make it the foreground window.
//! - **Grant.** Each `profile_window_open` owes one foreground request to its revision. It
//!   is made the first time the window is shown for that revision, within `GRANT_WINDOW`
//!   of the open, with `SetForegroundWindow`, which the documentation names as the way to
//!   activate a `WS_EX_NOACTIVATE` window. Windows grants it only to the process that
//!   received the last input (the click on the profile mark), so it is asked for at once
//!   and only once; a later show by the focus gate (the user returning to the game) never
//!   asks again. A refusal is reported (`denied`) and the page offers a button, whose own
//!   click lets `profile_window_focus` ask again.
//! - **Cursor.** A game that confines the cursor (`ClipCursor`) releases it when it loses
//!   the foreground. If a confinement is still in place one focus tick after the grant,
//!   while the profile still holds the foreground, it is released once with
//!   `ClipCursor(NULL)`. Nothing else touches the cursor: no warping, no repeated release,
//!   no restoring an old rectangle, and nothing is sent to or read from the game.
//! - **Clicks.** A click on the profile activates it normally (`no_activate::Activation`).
//!   When that makes it the foreground window outside a grant, it holds the lease as a grant
//!   would, with the AION window last seen in the foreground (while the profile was shown)
//!   to return to, and the same one cursor check.
//! - **Leaving.** Once the foreground moves anywhere else (Alt+Tab, a click on the game
//!   or another app) the lease is over: the profile never takes the foreground back by
//!   itself; only the user's next click on it does.
//! - **Restore.** Close, Escape and Alt+F4 hand the foreground back to the AION window it
//!   was taken from, only while the profile still holds it and that window still belongs
//!   to a running, unminimized AION. Hiding names drops the lease without restoring.

use std::time::{Duration, Instant};

/// How long after an open its one foreground request may still be made (the window may be
/// built and shown for the first time in between).
pub const GRANT_WINDOW: Duration = Duration::from_secs(2);

/// What the page is told about the last foreground request.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum State {
    /// No request: nothing opened yet, or the lease was closed.
    #[default]
    Idle,
    /// Asked for at the next show of this revision.
    Pending,
    /// The profile holds the foreground.
    Granted,
    /// Windows kept another window in front; the game may still hold the mouse.
    Denied,
    /// The user moved the foreground elsewhere after a grant.
    Left,
}

impl State {
    pub fn word(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Left => "left",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Held {
    revision: u64,
    /// The AION window the foreground was taken from, if it was AION's.
    restore: Option<isize>,
    /// The one cursor check after the grant has been made.
    clip_checked: bool,
}

/// One step for the native side to run (outside any lock: `SetForegroundWindow` sends
/// messages to this thread's windows).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Nothing,
    /// Ask for the foreground for this revision.
    Grant(u64),
    /// Release a confinement left in place after the grant, once.
    ReleaseClip,
    /// The user's click made the profile the foreground window for this revision.
    Clicked(u64),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Lease {
    pending: Option<(u64, Instant)>,
    held: Option<Held>,
    state: State,
    /// The revision `state` is about.
    revision: u64,
    /// The cursor confinement was released after the current grant.
    pub cursor_released: bool,
    /// The AION window last seen in the foreground while the profile was shown: where a
    /// Close returns a profile the user clicked into.
    last_game: Option<isize>,
}

impl Lease {
    pub fn state(&self) -> State {
        self.state
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    /// Whether a Close now would return to an AION window.
    pub fn restores(&self) -> bool {
        self.held.is_some_and(|h| h.restore.is_some())
    }

    /// The user opened (or retargeted) the profile: this revision is owed one request.
    pub fn request(&mut self, revision: u64, now: Instant) {
        self.pending = Some((revision, now + GRANT_WINDOW));
        self.state = State::Pending;
        self.revision = revision;
    }

    /// Names were hidden: no request is left and nothing is restored.
    pub fn forget(&mut self) {
        *self = Self::default();
    }

    /// One focus tick. `shown` is the revision the visible window shows (None while
    /// hidden); `ours` whether the profile is the foreground window now; `game` the
    /// foreground window when it is a live AION window.
    pub fn next(
        &mut self,
        shown: Option<u64>,
        ours: bool,
        game: Option<isize>,
        now: Instant,
    ) -> Step {
        // Hidden, the profile is not over the game: the window to return to is seen again.
        if shown.is_none() {
            self.last_game = None;
        } else if game.is_some() {
            self.last_game = game;
        }
        if let (None, Some(revision), true) = (self.held, shown, ours) {
            if self.pending.is_none_or(|(pending, _)| pending != revision) {
                // A click activated the shown profile (after a refusal, Alt+Tab or a
                // click on the game): held like a grant, returning to that game window.
                self.held = Some(Held {
                    revision,
                    restore: self.last_game,
                    clip_checked: false,
                });
                self.state = State::Granted;
                self.revision = revision;
                self.cursor_released = false;
                return Step::Clicked(revision);
            }
        }
        if let Some(held) = self.held {
            if !ours {
                // Alt+Tab or a click elsewhere: never taken back.
                self.held = None;
                if self.state == State::Granted {
                    self.state = State::Left;
                }
            } else if !held.clip_checked {
                self.held = Some(Held {
                    clip_checked: true,
                    ..held
                });
                return Step::ReleaseClip;
            }
        }
        let Some((revision, until)) = self.pending else {
            return Step::Nothing;
        };
        if now > until {
            // Never shown in time (the game was not in front): not asked for later.
            self.pending = None;
            if self.state == State::Pending && self.revision == revision {
                self.state = State::Idle;
            }
            return Step::Nothing;
        }
        if shown != Some(revision) {
            return Step::Nothing;
        }
        self.pending = None;
        if ours {
            // Already in front (an open from the profile's own saved list): keep the
            // window to return to from the first grant.
            self.state = State::Granted;
            self.revision = revision;
            if let Some(held) = &mut self.held {
                held.revision = revision;
            }
            return Step::Nothing;
        }
        Step::Grant(revision)
    }

    /// The answer to a `Grant` (or to the page's explicit request). `restore` is the AION
    /// window that had the foreground, if it was AION's; a grant while the profile already
    /// held it keeps the window it was first taken from.
    pub fn granted(&mut self, revision: u64, ok: bool, restore: Option<isize>) {
        self.revision = revision;
        self.cursor_released = false;
        if ok {
            self.held = Some(Held {
                revision,
                restore: restore.or(self.held.and_then(|h| h.restore)),
                clip_checked: false,
            });
            self.state = State::Granted;
        } else {
            self.held = None;
            self.state = State::Denied;
        }
    }

    /// The user asked again from the page (a click, so Windows may allow it now).
    pub fn ask_again(&mut self, revision: u64) -> Step {
        self.pending = None;
        Step::Grant(revision)
    }

    /// Close, Escape or Alt+F4: the AION window to give the foreground back to, only while
    /// the profile still holds it.
    pub fn close(&mut self, ours: bool) -> Option<isize> {
        let held = self.held.take();
        self.pending = None;
        self.state = State::Idle;
        held.filter(|_| ours).and_then(|h| h.restore)
    }
}

/// Native calls, on the window's own thread. No lock is held while they run.
#[cfg(windows)]
pub mod native {
    use windows_sys::Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            ClipCursor, GetClipCursor, GetForegroundWindow, GetSystemMetrics,
            GetWindowThreadProcessId, IsIconic, IsWindow, SetForegroundWindow, SM_CXVIRTUALSCREEN,
            SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
        },
    };

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() as isize }
    }

    /// A live, unminimized window of a running AION process.
    pub fn is_game_window(hwnd: isize, game_ids: &[u32]) -> bool {
        let hwnd = hwnd as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 || unsafe { IsIconic(hwnd) } != 0 {
            return false;
        }
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        game_ids.contains(&pid)
    }

    /// Asks for the foreground; true only when Windows actually gave it.
    pub fn take(hwnd: isize) -> bool {
        unsafe { SetForegroundWindow(hwnd as HWND) != 0 && GetForegroundWindow() == hwnd as HWND }
    }

    /// Whether the cursor is confined to less than the whole virtual screen.
    pub fn cursor_confined() -> bool {
        let mut clip = RECT::default();
        if unsafe { GetClipCursor(&mut clip) } == 0 {
            return false;
        }
        let (x, y, w, h) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };
        clip.left > x || clip.top > y || clip.right < x + w || clip.bottom < y + h
    }

    /// `ClipCursor(NULL)`: the cursor may move anywhere again.
    pub fn release_cursor() -> bool {
        unsafe { ClipCursor(std::ptr::null()) != 0 }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WS_EX_TOOLWINDOW, WS_POPUP,
        };

        /// A real hidden window of this process stands in for AION's: only the process ids
        /// given decide whether it is the game's. Nothing is activated, shown or moved, so
        /// the user's session is left alone while the tests run.
        #[test]
        fn only_a_live_window_of_a_listed_process_is_a_game_window() {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    class.as_ptr(),
                    std::ptr::null(),
                    WS_POPUP,
                    0,
                    0,
                    10,
                    10,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null());
            let ours = std::process::id();
            assert!(is_game_window(hwnd as isize, &[ours]));
            assert!(!is_game_window(hwnd as isize, &[]));
            assert!(!is_game_window(hwnd as isize, &[ours.wrapping_add(1)]));
            assert!(!is_game_window(0, &[ours]));
            unsafe { DestroyWindow(hwnd) };
            assert!(
                !is_game_window(hwnd as isize, &[ours]),
                "a closed game window is never given the foreground"
            );
            // Reading the confinement changes nothing.
            let _ = cursor_confined();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAME: isize = 0x100;

    fn opened(revision: u64) -> (Lease, Instant) {
        let now = Instant::now();
        let mut lease = Lease::default();
        lease.request(revision, now);
        (lease, now)
    }

    #[test]
    fn an_open_asks_once_when_its_window_is_shown_and_then_checks_the_cursor_once() {
        let (mut lease, now) = opened(3);
        assert_eq!(lease.state(), State::Pending);
        // Still hidden (being built, or the game not in front): nothing yet.
        assert_eq!(lease.next(None, false, Some(GAME), now), Step::Nothing);
        assert_eq!(lease.next(Some(3), false, Some(GAME), now), Step::Grant(3));
        // The request is spent: the next ticks never ask again, whatever happens.
        assert_eq!(lease.next(Some(3), false, Some(GAME), now), Step::Nothing);
        lease.granted(3, true, Some(GAME));
        assert_eq!(lease.state(), State::Granted);
        assert_eq!(lease.next(Some(3), true, None, now), Step::ReleaseClip);
        for _ in 0..5 {
            assert_eq!(lease.next(Some(3), true, None, now), Step::Nothing);
        }
        assert_eq!(lease.close(true), Some(GAME));
        assert_eq!(lease.state(), State::Idle);
    }

    #[test]
    fn a_refusal_is_reported_and_never_retried_by_itself() {
        let (mut lease, now) = opened(1);
        assert_eq!(lease.next(Some(1), false, Some(GAME), now), Step::Grant(1));
        lease.granted(1, false, Some(GAME));
        assert_eq!(lease.state(), State::Denied);
        for _ in 0..5 {
            assert_eq!(lease.next(Some(1), false, Some(GAME), now), Step::Nothing);
        }
        // Nothing was taken, so Close gives nothing back.
        assert_eq!(lease.close(false), None);
        // The page's button is a new click: one more request, then the same rules.
        let (mut lease, now) = opened(1);
        lease.next(Some(1), false, Some(GAME), now);
        lease.granted(1, false, None);
        assert_eq!(lease.ask_again(1), Step::Grant(1));
        lease.granted(1, true, Some(GAME));
        assert_eq!(lease.state(), State::Granted);
        assert_eq!(lease.next(Some(1), true, None, now), Step::ReleaseClip);
    }

    #[test]
    fn leaving_ends_the_lease_and_close_never_takes_the_foreground_back() {
        let (mut lease, now) = opened(2);
        lease.next(Some(2), false, Some(GAME), now);
        lease.granted(2, true, Some(GAME));
        lease.next(Some(2), true, None, now);
        // Alt+Tab to another app (or a click on the game).
        assert_eq!(lease.next(Some(2), false, Some(GAME), now), Step::Nothing);
        assert_eq!(lease.state(), State::Left);
        // Coming back to the game shows the window again, but never asks for focus.
        for _ in 0..5 {
            assert_eq!(lease.next(Some(2), false, Some(GAME), now), Step::Nothing);
        }
        assert_eq!(lease.close(false), None);
        // A lease given up restores nothing, even if the profile is in front again before a
        // tick has seen the click that brought it there.
        let (mut lease, now) = opened(2);
        lease.next(Some(2), false, Some(GAME), now);
        lease.granted(2, true, Some(GAME));
        lease.next(Some(2), false, Some(GAME), now);
        assert_eq!(lease.close(true), None);
    }

    #[test]
    fn close_restores_only_an_aion_window_and_only_while_the_profile_holds_the_foreground() {
        let (mut lease, now) = opened(4);
        lease.next(Some(4), false, Some(GAME), now);
        // Opened from the workspace: the foreground was not AION's.
        lease.granted(4, true, None);
        assert_eq!(lease.close(true), None);
        let (mut lease, now) = opened(4);
        lease.next(Some(4), false, Some(GAME), now);
        lease.granted(4, true, Some(GAME));
        assert_eq!(
            lease.close(false),
            None,
            "the user is elsewhere: leave them there"
        );
    }

    #[test]
    fn an_open_not_shown_in_time_is_dropped_so_a_later_show_never_steals_focus() {
        let (mut lease, now) = opened(5);
        let later = now + GRANT_WINDOW + Duration::from_millis(1);
        assert_eq!(lease.next(None, false, Some(GAME), later), Step::Nothing);
        assert_eq!(lease.state(), State::Idle);
        // The focus gate shows it when the user returns to the game: no request.
        assert_eq!(lease.next(Some(5), false, Some(GAME), later), Step::Nothing);
        // A late first show within the window still asks once.
        let (mut lease, now) = opened(5);
        let soon = now + GRANT_WINDOW - Duration::from_millis(1);
        assert_eq!(lease.next(Some(5), false, Some(GAME), soon), Step::Grant(5));
    }

    #[test]
    fn a_newer_open_replaces_the_request_and_an_older_show_never_answers_it() {
        let (mut lease, now) = opened(6);
        lease.request(7, now);
        // The window still shows revision 6 for a moment: not this request's show.
        assert_eq!(lease.next(Some(6), false, Some(GAME), now), Step::Nothing);
        assert_eq!(lease.next(Some(7), false, Some(GAME), now), Step::Grant(7));
    }

    #[test]
    fn an_open_from_inside_the_held_profile_keeps_the_window_to_return_to() {
        let (mut lease, now) = opened(8);
        lease.next(Some(8), false, Some(GAME), now);
        lease.granted(8, true, Some(GAME));
        lease.next(Some(8), true, None, now);
        // A saved character opened from the profile itself.
        lease.request(9, now);
        assert_eq!(lease.next(Some(9), true, None, now), Step::Nothing);
        assert_eq!(lease.state(), State::Granted);
        assert_eq!(lease.revision(), 9);
        // Asking again while in front (the foreground is the profile, not AION) keeps it too.
        assert_eq!(lease.ask_again(9), Step::Grant(9));
        lease.granted(9, true, None);
        assert_eq!(lease.close(true), Some(GAME));
    }

    #[test]
    fn hiding_names_drops_the_lease_without_restoring() {
        let (mut lease, now) = opened(10);
        lease.next(Some(10), false, Some(GAME), now);
        lease.granted(10, true, Some(GAME));
        lease.forget();
        assert_eq!(lease.state(), State::Idle);
        assert_eq!(lease.close(true), None);
        // The window is hidden with the names: nothing is held or asked for.
        assert_eq!(lease.next(None, true, None, now), Step::Nothing);
        assert_eq!(lease.state(), State::Idle);
    }

    const OTHER_GAME: isize = 0x200;

    #[test]
    fn a_click_after_leaving_holds_the_lease_again_and_close_returns_to_the_latest_game() {
        let (mut lease, now) = opened(11);
        lease.next(Some(11), false, Some(GAME), now);
        lease.granted(11, true, Some(GAME));
        lease.next(Some(11), true, None, now);
        // Alt+Tab away: the gate hides the window and nothing is taken back.
        assert_eq!(lease.next(Some(11), false, None, now), Step::Nothing);
        assert_eq!(lease.state(), State::Left);
        assert_eq!(lease.next(None, false, None, now), Step::Nothing);
        // Back in the game (a new client window), the window shows again without focus.
        for _ in 0..3 {
            assert_eq!(
                lease.next(Some(11), false, Some(OTHER_GAME), now),
                Step::Nothing
            );
        }
        assert_eq!(lease.state(), State::Left);
        // The user's click activates it: held again, never by a request of ours.
        assert_eq!(lease.next(Some(11), true, None, now), Step::Clicked(11));
        assert_eq!(lease.state(), State::Granted);
        assert!(lease.restores());
        assert_eq!(lease.next(Some(11), true, None, now), Step::ReleaseClip);
        for _ in 0..5 {
            assert_eq!(lease.next(Some(11), true, None, now), Step::Nothing);
        }
        assert_eq!(lease.close(true), Some(OTHER_GAME));
    }

    #[test]
    fn a_click_after_a_refusal_needs_no_button_and_a_click_away_is_never_undone() {
        let (mut lease, now) = opened(12);
        assert_eq!(
            lease.next(Some(12), false, Some(GAME), now),
            Step::Grant(12)
        );
        lease.granted(12, false, Some(GAME));
        assert_eq!(lease.state(), State::Denied);
        assert_eq!(lease.next(Some(12), false, Some(GAME), now), Step::Nothing);
        assert_eq!(lease.next(Some(12), true, None, now), Step::Clicked(12));
        assert_eq!(lease.state(), State::Granted);
        // A click on the game ends it; the profile stays shown but never asks again.
        assert_eq!(lease.next(Some(12), false, Some(GAME), now), Step::Nothing);
        assert_eq!(lease.state(), State::Left);
        for _ in 0..5 {
            assert_eq!(lease.next(Some(12), false, Some(GAME), now), Step::Nothing);
        }
        assert_eq!(lease.close(false), None);
    }

    #[test]
    fn a_click_with_no_game_seen_while_shown_returns_nowhere() {
        // Shown, then hidden (the user went to another app), then a click once shown again
        // before any game window was seen: Close leaves the foreground where it is.
        let (mut lease, now) = opened(13);
        lease.next(Some(13), false, Some(GAME), now);
        lease.granted(13, false, Some(GAME));
        lease.next(None, false, None, now);
        assert_eq!(lease.next(Some(13), true, None, now), Step::Clicked(13));
        assert!(!lease.restores());
        assert_eq!(lease.close(true), None);
        // While hidden, being the foreground window is never taken as a click.
        let (mut lease, now) = opened(14);
        lease.next(None, false, Some(GAME), now);
        assert_eq!(lease.next(None, true, None, now), Step::Nothing);
    }
}
