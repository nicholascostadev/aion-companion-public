//! Resolve GitHub CLI once per operation, including installations made after app startup.
use std::{
    ffi::OsStr,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub const REPOSITORY: &str = "nicholascostadev/aion-companion-public";
pub const LOGIN_ARGS: &[&str] = &[
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--web",
    "--git-protocol",
    "https",
];

fn resolve_in(
    program_files: Option<&OsStr>,
    local_app_data: Option<&OsStr>,
    path: Option<&OsStr>,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = program_files {
        candidates.push(PathBuf::from(root).join("GitHub CLI/gh.exe"));
    }
    if let Some(root) = local_app_data {
        candidates.push(PathBuf::from(root).join("Programs/GitHub CLI/gh.exe"));
        candidates.push(PathBuf::from(root).join("Microsoft/WinGet/Links/gh.exe"));
    }
    if let Some(path) = path {
        for folder in std::env::split_paths(path).filter(|p| p.is_absolute()) {
            candidates.push(folder.join(if cfg!(windows) { "gh.exe" } else { "gh" }));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_absolute() && path.is_file())
}

pub fn executable() -> Option<PathBuf> {
    resolve_in(
        std::env::var_os("ProgramFiles").as_deref(),
        std::env::var_os("LOCALAPPDATA").as_deref(),
        std::env::var_os("PATH").as_deref(),
    )
}

pub fn hidden_command() -> Result<Command, String> {
    let path = executable().ok_or(
        "GitHub CLI is not installed. Get it from the official download page, then check again.",
    )?;
    let mut command = Command::new(path);
    command
        .env("GH_HOST", "github.com")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env_remove("GH_DEBUG")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

/// Sign-in stays in the official CLI's own console/browser; Companion never reads its output.
pub fn launch_login() -> Result<LoginProcess, String> {
    #[cfg(windows)]
    {
        let path = executable().ok_or("Install GitHub CLI before signing in.")?;
        launch_login_at(&path)
    }
    #[cfg(not(windows))]
    {
        Err("Interactive sign-in is available in the Windows app. Run gh auth login in your own terminal, then check again.".into())
    }
}

#[cfg(windows)]
pub struct LoginProcess(std::os::windows::io::OwnedHandle);
#[cfg(not(windows))]
pub struct LoginProcess;

#[cfg(windows)]
fn launch_login_at(path: &Path) -> Result<LoginProcess, String> {
    use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            CreateProcessW, CREATE_NEW_CONSOLE, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION,
            STARTUPINFOW,
        },
    };
    let executable: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // All arguments are fixed; there is no shell or user-provided command string.
    let mut line: Vec<u16> = std::iter::once('"' as u16)
        .chain(path.as_os_str().encode_wide())
        .chain(std::iter::once('"' as u16))
        .chain(OsStr::new(&format!(" {}", LOGIN_ARGS.join(" "))).encode_wide())
        .chain(Some(0))
        .collect();
    let mut variables: Vec<_> = std::env::vars_os()
        .filter(|(key, _)| {
            ![
                "GH_HOST",
                "GH_PROMPT_DISABLED",
                "GH_DEBUG",
                "GH_NO_UPDATE_NOTIFIER",
            ]
            .iter()
            .any(|name| key.to_string_lossy().eq_ignore_ascii_case(name))
        })
        .collect();
    variables.push(("GH_HOST".into(), "github.com".into()));
    variables.push(("GH_NO_UPDATE_NOTIFIER".into(), "1".into()));
    variables.sort_by_key(|(key, _)| key.to_string_lossy().to_ascii_uppercase());
    let mut environment = Vec::new();
    for (key, value) in variables {
        environment.extend(key.encode_wide());
        environment.push('=' as u16);
        environment.extend(value.encode_wide());
        environment.push(0);
    }
    environment.push(0);
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // Leave STARTF_USESTDHANDLES unset and inherit no handles. Even when Companion was
    // launched with redirected streams, the CLI must get its own console, never app logs.
    let created = unsafe {
        CreateProcessW(
            executable.as_ptr(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT,
            environment.as_ptr().cast(),
            std::ptr::null(),
            &startup,
            &mut process,
        )
    };
    if created == 0 {
        return Err("Could not open GitHub CLI sign-in. Follow the manual sign-in steps, then check access again.".into());
    }
    unsafe {
        CloseHandle(process.hThread);
    }
    Ok(LoginProcess(unsafe {
        std::os::windows::io::OwnedHandle::from_raw_handle(process.hProcess)
    }))
}

#[derive(Debug)]
pub struct Output {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Small probes only: both pipes are bounded and consumed concurrently. Raw output is never logged.
pub fn probe(args: &[&str], timeout: Duration) -> Result<Output, String> {
    let mut command = hidden_command()?;
    command.args(args).stderr(Stdio::piped());
    run_probe(command, timeout)
}

fn run_probe(mut command: Command, timeout: Duration) -> Result<Output, String> {
    const LIMIT: u64 = 64 * 1024;
    let mut child = command
        .spawn()
        .map_err(|_| "GitHub CLI could not start. Check its installation and try again.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("GitHub CLI output is unavailable.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("GitHub CLI output is unavailable.")?;
    let read = |pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.take(LIMIT + 1).read_to_end(&mut bytes).map(|_| bytes)
        })
    };
    let out = read(Box::new(stdout));
    let err = read(Box::new(stderr));
    let started = Instant::now();
    let exit = loop {
        match child.try_wait() {
            Ok(Some(exit)) => break Ok(exit),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(
                    "GitHub could not be reached in time. Check your connection and try again.",
                );
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| "GitHub CLI output is unavailable.")?
        .map_err(|_| "GitHub CLI output could not be read.")?;
    let stderr = err
        .join()
        .map_err(|_| "GitHub CLI output is unavailable.")?
        .map_err(|_| "GitHub CLI output could not be read.")?;
    let exit = exit?;
    if stdout.len() as u64 > LIMIT || stderr.len() as u64 > LIMIT {
        return Err("GitHub CLI returned too much diagnostic output. Try again.".into());
    }
    Ok(Output {
        success: exit.success(),
        stdout,
        stderr,
    })
}

pub fn wait_for_login(child: &mut LoginProcess, timeout: Duration) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{
            Foundation::WAIT_OBJECT_0,
            System::Threading::{GetExitCodeProcess, TerminateProcess, WaitForSingleObject},
        };
        let handle = child.0.as_raw_handle();
        let wait = unsafe {
            WaitForSingleObject(handle, timeout.as_millis().min(u32::MAX as u128 - 1) as u32)
        };
        if wait == WAIT_OBJECT_0 {
            let mut exit = 1;
            if unsafe { GetExitCodeProcess(handle, &mut exit) } != 0 {
                return Ok(exit == 0);
            }
        } else {
            unsafe {
                TerminateProcess(handle, 1);
                WaitForSingleObject(handle, 5000);
            }
        }
        Err("GitHub sign-in did not finish. Try again or follow the manual steps, then check access.".into())
    }
    #[cfg(not(windows))]
    {
        let _ = (child, timeout);
        Err("Interactive sign-in is available in the Windows app.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_standard_install_is_found_without_changing_process_path() {
        let root = std::env::temp_dir().join(format!("aion-gh-resolve-{}", std::process::id()));
        let cli = root.join("Program Files/GitHub CLI/gh.exe");
        let files = root.join("Program Files");
        assert!(resolve_in(Some(files.as_os_str()), None, None).is_none());
        std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
        std::fs::write(&cli, b"fixture").unwrap();
        assert_eq!(resolve_in(Some(files.as_os_str()), None, None), Some(cli));
        assert!(root.is_absolute() && root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn relative_paths_are_not_an_executable_search_location() {
        assert!(resolve_in(None, None, Some(OsStr::new("."))).is_none());
        assert_eq!(
            LOGIN_ARGS,
            [
                "auth",
                "login",
                "--hostname",
                "github.com",
                "--web",
                "--git-protocol",
                "https"
            ]
        );
        assert!(!LOGIN_ARGS.contains(&"--with-token"));
        assert!(!LOGIN_ARGS.contains(&"--insecure-storage"));
    }
    #[cfg(windows)]
    fn fixture(script: &str) -> Command {
        let mut cmd = Command::new(
            Path::new(&std::env::var_os("SystemRoot").unwrap())
                .join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        );
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }
    #[cfg(windows)]
    #[test]
    fn probes_keep_failure_output_internal_and_have_a_real_timeout() {
        let output = run_probe(fixture("[Console]::Out.Write('HTTP/2.0 404'); [Console]::Error.Write('fixture diagnostic'); exit 1"), Duration::from_secs(10)).unwrap();
        assert!(!output.success);
        assert_eq!(output.stdout, b"HTTP/2.0 404");
        assert_eq!(output.stderr, b"fixture diagnostic");
        let started = Instant::now();
        assert!(run_probe(
            fixture("Start-Sleep -Seconds 20"),
            Duration::from_millis(250)
        )
        .unwrap_err()
        .contains("in time"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[cfg(windows)]
    #[test]
    fn login_gets_its_own_console_even_when_parent_streams_are_redirected() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("aion-gh-console-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("console.cs");
        let executable = root.join("console helper.exe");
        std::fs::write(&source, "using System; class Probe { static int Main() { return Console.IsInputRedirected || Console.IsOutputRedirected || Console.IsErrorRedirected ? 23 : 0; } }").unwrap();
        let compiler = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("Microsoft.NET/Framework64/v4.0.30319/csc.exe");
        let compiled = Command::new(compiler)
            .arg("/nologo")
            .arg("/target:exe")
            .arg(format!("/out:{}", executable.display()))
            .arg(source)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(compiled.success());
        let mut child = launch_login_at(&executable).unwrap();
        assert!(
            wait_for_login(&mut child, Duration::from_secs(10)).unwrap(),
            "Sign-in must own interactive console handles rather than inherit app pipes"
        );
        drop(child);
        assert!(root.is_absolute() && root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
