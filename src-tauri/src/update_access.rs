//! Private update onboarding. Status is cached; checks and sign-in are explicit operations.
use crate::github_cli::{self, Output, REPOSITORY};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Default)]
struct Data {
    phase: &'static str,
    cli_installed: Option<bool>,
    authenticated: Option<bool>,
    repository_access: Option<bool>,
    checked_ms: Option<u64>,
    error: Option<String>,
}
#[derive(Default)]
pub struct UpdateAccessState {
    data: Mutex<Data>,
    busy: AtomicBool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}
fn snapshot(state: &UpdateAccessState, development: bool) -> Result<Value, String> {
    let stored = state
        .data
        .lock()
        .map_err(|_| "Update setup is unavailable.")?;
    let data = if development {
        Data::default()
    } else {
        stored.clone()
    };
    Ok(json!({
        "phase": if development { "development" } else if data.phase.is_empty() { "unchecked" } else { data.phase },
        "cli_installed": data.cli_installed,
        "authenticated": data.authenticated,
        "repository_access": data.repository_access,
        "checked_ms": data.checked_ms,
        "error": data.error,
        "login_supported": cfg!(windows) && !development,
        "repository": REPOSITORY,
    }))
}

fn http_status(output: &[u8]) -> Option<u16> {
    String::from_utf8_lossy(output)
        .lines()
        .find(|line| line.starts_with("HTTP/"))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

fn probe_with(cli_installed: bool, mut run: impl FnMut(&[&str]) -> Result<Output, String>) -> Data {
    let mut data = Data {
        phase: "checked",
        cli_installed: Some(cli_installed),
        checked_ms: Some(now()),
        ..Data::default()
    };
    if !cli_installed {
        return data;
    }
    let auth_args = ["auth", "status", "--hostname", "github.com", "--active"];
    let result = (|| {
        let mut auth = run(&auth_args)?;
        // Older CLI versions do not offer --active. Their standard status remains usable.
        if !auth.success && String::from_utf8_lossy(&auth.stderr).contains("unknown flag: --active")
        {
            auth = run(&auth_args[..4])?;
        }
        if !auth.success {
            let message = String::from_utf8_lossy(&auth.stderr).to_ascii_lowercase();
            if message.contains("not logged")
                || (message.contains("token") && message.contains("invalid"))
            {
                data.authenticated = Some(false);
                return Ok(());
            }
            // Offline, proxy and server failures must not be presented as a signed-out account.
            return Err("Could not verify GitHub sign-in. Check your connection and GitHub CLI, then try again.".into());
        }
        data.authenticated = Some(true);
        let endpoint = format!("repos/{REPOSITORY}");
        let response = run(&[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            "--include",
            "--silent",
            &endpoint,
        ])?;
        let headers = String::from_utf8_lossy(&response.stdout).to_ascii_lowercase();
        match http_status(&response.stdout) {
            Some(200) if response.success => data.repository_access = Some(true),
            Some(401) => data.authenticated = Some(false),
            Some(403)
                if headers
                    .lines()
                    .any(|line| line.trim() == "x-ratelimit-remaining: 0") =>
            {
                return Err(
                    "GitHub's request limit was reached. Wait a little, then check access again."
                        .into(),
                );
            }
            Some(403 | 404) => data.repository_access = Some(false),
            _ => {
                return Err(
                    "Could not confirm repository access. Check your connection and try again."
                        .into(),
                )
            }
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        data.error = Some(error);
    }
    data
}

fn probe() -> Data {
    probe_with(github_cli::executable().is_some(), |args| {
        github_cli::probe(args, Duration::from_secs(20))
    })
}

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn operation_with(
    state: &UpdateAccessState,
    development: bool,
    login: bool,
    sign_in: impl FnOnce() -> Result<bool, String>,
    check: impl FnOnce() -> Data,
) -> Result<Value, String> {
    if development || state.busy.swap(true, Ordering::AcqRel) {
        return snapshot(state, development);
    }
    let _busy = Busy(&state.busy);
    {
        let mut data = state
            .data
            .lock()
            .map_err(|_| "Update setup is unavailable.")?;
        data.phase = if login { "signing_in" } else { "checking" };
        data.error = None;
    }
    if login {
        match sign_in() {
            Ok(true) => {
                state
                    .data
                    .lock()
                    .map_err(|_| "Update setup is unavailable.")?
                    .phase = "checking";
            }
            result => {
                let mut data = state
                    .data
                    .lock()
                    .map_err(|_| "Update setup is unavailable.")?;
                data.phase = "checked";
                data.error = Some(result.err().unwrap_or_else(|| "GitHub sign-in was canceled or did not finish. Try again or follow the manual steps, then check access.".into()));
                // Do not preserve a stale access grant after an attempted account change.
                data.authenticated = None;
                data.repository_access = None;
                return snapshot_after_unlock(state, data);
            }
        }
    }
    *state
        .data
        .lock()
        .map_err(|_| "Update setup is unavailable.")? = check();
    snapshot(state, false)
}

fn snapshot_after_unlock(
    state: &UpdateAccessState,
    guard: std::sync::MutexGuard<'_, Data>,
) -> Result<Value, String> {
    drop(guard);
    snapshot(state, false)
}

fn operation(app: &AppHandle, login: bool) -> Result<Value, String> {
    operation_with(
        &app.state::<UpdateAccessState>(),
        crate::build_info::DEVELOPMENT,
        login,
        || {
            let mut child = github_cli::launch_login()?;
            github_cli::wait_for_login(&mut child, Duration::from_secs(15 * 60))
        },
        probe,
    )
}

#[tauri::command]
pub fn updates_access_status(app: AppHandle) -> Result<Value, String> {
    snapshot(
        &app.state::<UpdateAccessState>(),
        crate::build_info::DEVELOPMENT,
    )
}
#[tauri::command]
pub async fn updates_access_check(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || operation(&app, false))
        .await
        .map_err(|_| "Update setup could not finish.")?
}
#[tauri::command]
pub async fn updates_access_login(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || operation(&app, true))
        .await
        .map_err(|_| "GitHub sign-in could not finish.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    fn output(success: bool, stdout: &str, stderr: &str) -> Output {
        Output {
            success,
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }
    fn checked(results: Vec<Output>) -> Data {
        let mut results = VecDeque::from(results);
        let data = probe_with(true, |_| {
            Ok(results.pop_front().expect("unexpected CLI operation"))
        });
        assert!(results.is_empty());
        data
    }
    #[test]
    fn missing_cli_and_signed_out_do_not_request_repository_data() {
        let data = probe_with(false, |_| panic!("Missing CLI must not execute a probe"));
        assert_eq!(data.cli_installed, Some(false));
        assert_eq!(data.authenticated, None);
        let data = checked(vec![output(
            false,
            "",
            "You are not logged into any GitHub hosts.",
        )]);
        assert_eq!(data.authenticated, Some(false));
        assert_eq!(data.repository_access, None);
        assert!(data.error.is_none());
    }
    #[test]
    fn permission_can_be_granted_after_sign_in_and_missing_access() {
        let denied = checked(vec![
            output(true, "", ""),
            output(
                false,
                "HTTP/2.0 404 Not Found\r\n",
                "private fixture diagnostic",
            ),
        ]);
        assert_eq!(denied.authenticated, Some(true));
        assert_eq!(denied.repository_access, Some(false));
        assert!(denied.error.is_none());
        let ready = checked(vec![
            output(true, "", ""),
            output(true, "HTTP/2.0 200 OK\r\n", ""),
        ]);
        assert_eq!(ready.repository_access, Some(true));
    }
    #[test]
    fn offline_or_rate_limit_is_not_a_permission_denial_or_logout() {
        let offline = checked(vec![output(
            false,
            "",
            "error connecting to api.github.com",
        )]);
        assert_eq!(offline.authenticated, None);
        assert!(offline.error.is_some());
        let limited = checked(vec![
            output(true, "", ""),
            output(
                false,
                "HTTP/2.0 403 Forbidden\r\nX-RateLimit-Remaining: 0\r\n",
                "",
            ),
        ]);
        assert_eq!(limited.authenticated, Some(true));
        assert_eq!(limited.repository_access, None);
        assert!(limited.error.unwrap().contains("limit"));
        let network = checked(vec![
            output(true, "", ""),
            output(false, "", "secret fixture output"),
        ]);
        assert_eq!(network.repository_access, None);
        assert!(!network.error.unwrap().contains("secret"));
    }
    #[test]
    fn auth_expiring_between_probes_and_old_cli_are_handled() {
        let expired = checked(vec![
            output(true, "", ""),
            output(false, "HTTP/2.0 401 Unauthorized\r\n", ""),
        ]);
        assert_eq!(expired.authenticated, Some(false));
        assert_eq!(expired.repository_access, None);
        let old_cli = checked(vec![
            output(false, "", "unknown flag: --active"),
            output(true, "", ""),
            output(true, "HTTP/1.1 200 OK\r\n", ""),
        ]);
        assert_eq!(old_cli.repository_access, Some(true));
    }
    #[test]
    fn status_is_cached_and_development_and_busy_calls_have_no_side_effects() {
        let state = UpdateAccessState::default();
        assert_eq!(snapshot(&state, false).unwrap()["phase"], "unchecked");
        let dev = operation_with(
            &state,
            true,
            true,
            || panic!("development login"),
            || panic!("development probe"),
        )
        .unwrap();
        assert_eq!(dev["phase"], "development");
        assert_eq!(dev["login_supported"], false);
        state.busy.store(true, Ordering::Release);
        let busy = operation_with(
            &state,
            false,
            true,
            || panic!("overlapping login"),
            || panic!("overlapping probe"),
        )
        .unwrap();
        assert_eq!(busy["phase"], "unchecked");
    }
    #[test]
    fn successful_login_rechecks_access_cancel_does_not_leak_stale_ready_state() {
        let state = UpdateAccessState::default();
        let ready = operation_with(
            &state,
            false,
            true,
            || {
                assert_eq!(snapshot(&state, false).unwrap()["phase"], "signing_in");
                Ok(true)
            },
            || {
                assert_eq!(snapshot(&state, false).unwrap()["phase"], "checking");
                checked(vec![
                    output(true, "", ""),
                    output(true, "HTTP/2.0 200 OK\r\n", ""),
                ])
            },
        )
        .unwrap();
        assert_eq!(ready["repository_access"], true);
        assert!(!state.busy.load(Ordering::Acquire));
        let canceled = operation_with(
            &state,
            false,
            true,
            || Ok(false),
            || panic!("canceled login must not probe"),
        )
        .unwrap();
        assert!(canceled["authenticated"].is_null());
        assert!(canceled["repository_access"].is_null());
        assert!(canceled["error"].as_str().unwrap().contains("canceled"));
        assert!(!state.busy.load(Ordering::Acquire));
    }

    #[test]
    #[ignore = "requires existing GitHub CLI authentication and read access to this repository"]
    fn live_private_access_probe_uses_existing_sign_in_without_exposing_identity() {
        let data = probe();
        assert_eq!(data.cli_installed, Some(true));
        assert_eq!(
            data.authenticated,
            Some(true),
            "{}",
            data.error
                .as_deref()
                .unwrap_or("GitHub CLI is not signed in")
        );
        assert_eq!(
            data.repository_access,
            Some(true),
            "{}",
            data.error
                .as_deref()
                .unwrap_or("Repository access was not confirmed")
        );
        println!("Existing GitHub CLI sign-in and private repository read access verified; no credential or account identity was returned.");
    }
}
