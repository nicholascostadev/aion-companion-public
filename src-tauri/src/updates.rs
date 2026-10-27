//! Public releases use HTTPS directly; private releases reuse GitHub CLI authentication.
use semver::Version;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const REPOSITORY: &str = crate::github_cli::REPOSITORY;
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const MAX_EXE: u64 = 512 * 1024 * 1024;
static PUBLIC_RELEASES: AtomicBool = AtomicBool::new(false);

pub fn public_releases() -> bool {
    PUBLIC_RELEASES.load(Ordering::Acquire)
}

#[derive(Clone, Debug)]
struct Asset {
    name: String,
    digest: String,
    size: u64,
}
#[derive(Clone, Debug)]
struct Release {
    version: Version,
    tag: String,
    notes: String,
    exe: Asset,
    notices: Asset,
    authenticated: bool,
}
#[derive(Default)]
struct Data {
    phase: String,
    release: Option<Release>,
    prepared: Option<String>,
    error: Option<String>,
    checked_ms: Option<u64>,
}
#[derive(Default)]
pub struct UpdatesState {
    data: Mutex<Data>,
    busy: AtomicBool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |t| t.as_millis() as u64)
}
fn install_root() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|root| PathBuf::from(root).join("AionCompanion"))
        .ok_or_else(|| "Windows application data folder is unavailable.".into())
}
pub fn supported() -> bool {
    if crate::build_info::DEVELOPMENT {
        return false;
    }
    install_root().is_ok_and(|root| {
        root.join("Aion Companion.exe").is_file()
            && fs::read_to_string(root.join("launcher.protocol"))
                .is_ok_and(|value| value.trim() == "2")
            && std::env::current_exe()
                .ok()
                .and_then(|exe| {
                    Some(managed_executable(
                        &fs::canonicalize(&root).ok()?,
                        &fs::canonicalize(exe).ok()?,
                    ))
                })
                .unwrap_or(false)
    })
}

fn managed_executable(root: &Path, exe: &Path) -> bool {
    let Ok(relative) = exe.strip_prefix(root.join("versions")) else {
        return false;
    };
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 2 {
        return false;
    }
    let hash = parts[0].as_os_str().to_string_lossy();
    hash.len() == 64
        && hash.bytes().all(|b| b.is_ascii_hexdigit())
        && parts[1].as_os_str() == "aion-companion.exe"
}
fn status(state: &UpdatesState) -> Result<Value, String> {
    if crate::build_info::DEVELOPMENT {
        return Ok(json!({"channel":"development","current_version":CURRENT,
            "latest_version":null,"phase":"development","error":null,"checked_ms":null,
            "release_url":null,"notes":null,"restart_supported":false,"repository":REPOSITORY}));
    }
    let data = state.data.lock().map_err(|_| "Update state unavailable")?;
    Ok(
        json!({"current_version":CURRENT,"latest_version":data.release.as_ref().map(|r|r.version.to_string()),
        "distribution":if public_releases(){"public"}else{"private"},
        "phase":if data.phase.is_empty(){"idle"}else{&data.phase},"error":data.error,"checked_ms":data.checked_ms,
        "release_url":data.release.as_ref().map(|r|format!("https://github.com/{REPOSITORY}/releases/tag/{}",r.tag)),
        "notes":data.release.as_ref().map(|r|&r.notes),"restart_supported":supported(),"repository":REPOSITORY}),
    )
}

fn asset(value: &Value, name: &str, max: u64) -> Result<Asset, String> {
    let matches: Vec<_> = value["assets"]
        .as_array()
        .ok_or("Release assets are unavailable")?
        .iter()
        .filter(|a| a["name"] == name)
        .collect();
    if matches.len() != 1 {
        return Err(format!("The release does not contain exactly one {name}."));
    }
    let item = matches[0];
    let size = item["size"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= max)
        .ok_or("Release asset size is invalid")?;
    let digest = item["digest"]
        .as_str()
        .and_then(|s| s.strip_prefix("sha256:"))
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("The release has no verified SHA-256 asset digest")?
        .to_ascii_lowercase();
    Ok(Asset {
        name: name.into(),
        digest,
        size,
    })
}
fn parse_release(value: Value) -> Result<Release, String> {
    if value["draft"] != false || value["prerelease"] != false {
        return Err("Only published stable releases can be installed.".into());
    }
    let tag = value["tag_name"]
        .as_str()
        .ok_or("Release version unavailable")?;
    let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "Invalid release version")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("Only stable release versions can be installed.".into());
    }
    // The exact asset names prevent wildcard downloads, path traversal and source archives.
    let exe = asset(
        &value,
        &format!("AionCompanion-{version}-windows-x64.exe"),
        MAX_EXE,
    )?;
    let notices = asset(&value, "THIRD_PARTY_NOTICES.txt", 2 * 1024 * 1024)?;
    Ok(Release {
        version,
        tag: tag.into(),
        notes: value["body"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(32_000)
            .collect(),
        exe,
        notices,
        authenticated: false,
    })
}

pub(crate) fn run_gh(args: &[&str], timeout: Duration, output_limit: u64) -> Result<Vec<u8>, String> {
    let mut child = crate::github_cli::hidden_command()?
        .args(args)
        .spawn()
        .map_err(|_| "GitHub CLI could not start. Check its installation in App updates setup.")?;
    // Drain stdout concurrently so a full pipe cannot deadlock the timeout loop.
    let stdout = child.stdout.take().ok_or("GitHub output unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(output_limit + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(exit)) => break Ok(exit),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(100))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("GitHub request timed out. Check your connection and try again.");
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "GitHub output unavailable")?
        .map_err(|_| "GitHub output could not be read")?;
    if !result?.success() {
        return Err("GitHub could not access the release. Check your connection and run gh auth login with an account that can read this private repository.".into());
    }
    if bytes.len() as u64 > output_limit {
        return Err("GitHub response exceeded the allowed size.".into());
    }
    Ok(bytes)
}
fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("AionCompanion/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|_| "Could not initialize secure update downloads.".into())
}

fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "GitHub response could not be read.")?;
    if bytes.len() as u64 > limit {
        return Err("GitHub response exceeded the allowed size.".into());
    }
    Ok(bytes)
}

fn read_latest() -> Result<Release, String> {
    let response = http_client(Duration::from_secs(30))?
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/releases/latest"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|_| "Could not reach GitHub. Check your connection and try again.")?;
    if response.status().is_success() {
        let bytes = read_bounded(response, 2 * 1024 * 1024)?;
        let release = parse_release(
            serde_json::from_slice(&bytes).map_err(|_| "GitHub returned an invalid release")?,
        )?;
        PUBLIC_RELEASES.store(true, Ordering::Release);
        return Ok(release);
    }
    if !matches!(response.status().as_u16(), 401 | 403 | 404) {
        return Err(format!(
            "GitHub returned HTTP {}. Try again later.",
            response.status().as_u16()
        ));
    }
    // GitHub intentionally returns 404 for private resources to unauthenticated clients.
    PUBLIC_RELEASES.store(false, Ordering::Release);
    let bytes = run_gh(
        &[
            "api",
            &format!("repos/{REPOSITORY}/releases/latest"),
            "--hostname",
            "github.com",
        ],
        Duration::from_secs(30),
        2 * 1024 * 1024,
    )?;
    let mut release = parse_release(
        serde_json::from_slice(&bytes).map_err(|_| "GitHub returned an invalid release")?,
    )?;
    release.authenticated = true;
    Ok(release)
}
fn verify(path: &Path, asset: &Asset) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|_| "Downloaded file is unavailable")?;
    if file.metadata().map_err(|e| e.to_string())?.len() != asset.size {
        return Err("Downloaded asset size did not match the release.".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if format!("{:x}", digest.finalize()) != asset.digest {
        return Err("SHA-256 verification failed. The update was not installed.".into());
    }
    Ok(())
}
fn download(release: &Release, folder: &Path) -> Result<(), String> {
    let destination = folder.to_str().ok_or("Update path is not valid Unicode")?;
    if release.authenticated {
        run_gh(
            &[
                "release",
                "download",
                &release.tag,
                "--repo",
                REPOSITORY,
                "--pattern",
                &release.exe.name,
                "--pattern",
                &release.notices.name,
                "--dir",
                destination,
            ],
            Duration::from_secs(300),
            64 * 1024,
        )?;
    } else {
        let client = http_client(Duration::from_secs(300))?;
        for asset in [&release.exe, &release.notices] {
            let response = client
                .get(format!(
                    "https://github.com/{REPOSITORY}/releases/download/{}/{}",
                    release.tag, asset.name
                ))
                .send()
                .map_err(|_| "Update download failed. Check your connection and try again.")?
                .error_for_status()
                .map_err(|_| "GitHub could not provide the release asset.")?;
            let mut file = fs::File::create(folder.join(&asset.name)).map_err(|e| e.to_string())?;
            let count = std::io::copy(&mut response.take(asset.size + 1), &mut file)
                .map_err(|_| "Update download was interrupted.")?;
            if count != asset.size {
                return Err("Downloaded asset size did not match the release.".into());
            }
            file.sync_all().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// Own only the named assets in this uniquely created download folder. Delete
// them on success and failure, without recursively touching unexpected files.
struct DownloadFolder<'a> {
    path: PathBuf,
    release: &'a Release,
}
impl Drop for DownloadFolder<'_> {
    fn drop(&mut self) {
        for asset in [&self.release.exe, &self.release.notices] {
            let _ = fs::remove_file(self.path.join(&asset.name));
        }
        let _ = fs::remove_dir(&self.path);
    }
}

fn stage_with(
    release: &Release,
    root: &Path,
    download: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<String, String> {
    let updates = root.join("updates");
    fs::create_dir_all(&updates).map_err(|e| e.to_string())?;
    let folder = updates.join(format!(
        "{}-{}",
        release.version,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    fs::create_dir(&folder).map_err(|e| e.to_string())?;
    let _cleanup = DownloadFolder {
        path: folder.clone(),
        release,
    };
    download(&folder)?;
    verify(&folder.join(&release.exe.name), &release.exe)?;
    verify(&folder.join(&release.notices.name), &release.notices)?;
    let published = root.join("versions").join(&release.exe.digest);
    fs::create_dir_all(&published).map_err(|e| e.to_string())?;
    let exe = published.join("aion-companion.exe");
    if exe.exists() {
        verify(&exe, &release.exe)?;
    } else {
        let temporary = published.join(format!("{}.tmp", now()));
        fs::copy(folder.join(&release.exe.name), &temporary).map_err(|e| e.to_string())?;
        verify(&temporary, &release.exe)?;
        fs::rename(temporary, &exe).map_err(|e| e.to_string())?;
    }
    fs::copy(
        folder.join(&release.notices.name),
        published.join(&release.notices.name),
    )
    .map_err(|e| e.to_string())?;
    Ok(release.exe.digest.clone())
}
fn stage(release: &Release, root: &Path) -> Result<String, String> {
    stage_with(release, root, |folder| download(release, folder))
}

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
fn operation(app: &AppHandle, download: bool) -> Result<Value, String> {
    let state = app.state::<UpdatesState>();
    if crate::build_info::DEVELOPMENT {
        return status(&state);
    }
    if state.busy.swap(true, Ordering::AcqRel) {
        return status(&state);
    }
    let _busy = Busy(&state.busy);
    let result = (|| {
        if download {
            if !supported() {
                return Err("Install Aion Companion from the latest release to enable automatic updates. Portable copies can be replaced manually.".into());
            }
            let release = {
                let mut data = state.data.lock().map_err(|_| "Update state unavailable")?;
                let release = data.release.clone().ok_or("Check for an update first")?;
                if release.version <= Version::parse(CURRENT).map_err(|e| e.to_string())? {
                    return Err("This release is not newer than the installed version.".into());
                }
                data.phase = "downloading".into();
                data.error = None;
                release
            };
            let prepared = stage(&release, &install_root()?)?;
            let mut data = state.data.lock().map_err(|_| "Update state unavailable")?;
            data.prepared = Some(prepared);
            data.phase = "ready".into();
        } else {
            {
                let mut data = state.data.lock().map_err(|_| "Update state unavailable")?;
                data.phase = "checking".into();
                data.error = None;
            }
            let release = read_latest()?;
            let newer = release.version > Version::parse(CURRENT).map_err(|e| e.to_string())?;
            let mut data = state.data.lock().map_err(|_| "Update state unavailable")?;
            data.phase = if newer {
                if data.prepared.as_deref() == Some(&release.exe.digest) {
                    "ready"
                } else {
                    "available"
                }
            } else {
                "current"
            }
            .into();
            data.release = Some(release);
            data.checked_ms = Some(now());
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        companion_capture::diagnostics::record("error", "updates", &error);
        let mut data = state.data.lock().map_err(|_| "Update state unavailable")?;
        data.phase = "error".into();
        data.error = Some(error);
    }
    status(&state)
}

pub fn setup(app: &AppHandle) {
    if crate::build_info::DEVELOPMENT {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        let _ = operation(&handle, false);
    });
}
#[tauri::command]
pub fn updates_status(app: AppHandle) -> Result<Value, String> {
    status(&app.state::<UpdatesState>())
}
#[tauri::command]
pub async fn updates_check(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || operation(&app, false))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn updates_download(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || operation(&app, true))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn updates_install(app: AppHandle) -> Result<Value, String> {
    if crate::build_info::DEVELOPMENT {
        return status(&app.state::<UpdatesState>());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<UpdatesState>();
        if state.busy.swap(true,Ordering::AcqRel){return status(&state);}
        let _busy=Busy(&state.busy);
        let result=(||{
            let (release,hash)={let mut data=state.data.lock().map_err(|_|"Update state unavailable")?;
                if data.phase!="ready"{return Err("Download an update before restarting.".into());}
                let release=data.release.clone().ok_or("Update release unavailable")?;
                let hash=data.prepared.clone().ok_or("Downloaded update unavailable")?;
                data.phase="restarting".into();data.error=None;(release,hash)};
            let root=install_root()?;
            if !supported(){return Err("Open the app through its installed Desktop or Start menu shortcut before updating.".into());}
            if hash!=release.exe.digest{return Err("Prepared update does not match the checked release.".into());}
            verify(&root.join("versions").join(&hash).join("aion-companion.exe"),&release.exe)?;
            let mut command=Command::new(root.join("Aion Companion.exe"));
            command.arg("--apply-update").arg(&hash).arg(std::process::id().to_string()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
            let mut helper=command.spawn().map_err(|e|format!("Update restart could not launch: {e}"))?;
            if let Err(error)=crate::overlay::quit_and_save(app.clone(),"Restarting to install an update") {let _=helper.kill();let _=helper.wait();return Err(error);}
            Ok::<(),String>(())
        })();
        if let Err(error)=result {let mut data=state.data.lock().map_err(|_|"Update state unavailable")?;data.phase="error".into();data.error=Some(error);}
        status(&state)
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn development_never_offers_release_installation() {
        if crate::build_info::DEVELOPMENT {
            assert!(!supported());
            let value = status(&UpdatesState::default()).unwrap();
            assert_eq!(value["phase"], "development");
            assert_eq!(value["restart_supported"], false);
            assert!(value["latest_version"].is_null());
        }
    }
    fn release() -> Value {
        json!({"tag_name":"v1.2.3","draft":false,"prerelease":false,"body":"Changes", "assets":[{"name":"AionCompanion-1.2.3-windows-x64.exe","size":3,"digest":format!("sha256:{:x}",Sha256::digest(b"abc"))},{"name":"THIRD_PARTY_NOTICES.txt","size":3,"digest":format!("sha256:{:x}",Sha256::digest(b"abc"))}]})
    }
    #[test]
    fn release_requires_exact_stable_version_assets_and_digests() {
        assert_eq!(
            parse_release(release()).unwrap().version,
            Version::new(1, 2, 3)
        );
        for bad in ["v1.2.3-beta.1", "../../other", "v1.2.3+local"] {
            let mut r = release();
            r["tag_name"] = json!(bad);
            assert!(parse_release(r).is_err());
        }
        let mut r = release();
        r["prerelease"] = json!(true);
        assert!(parse_release(r).is_err());
        let mut r = release();
        r["assets"][0]["digest"] = Value::Null;
        assert!(parse_release(r).is_err());
        let mut r = release();
        r["assets"][0]["name"] = json!("../app.exe");
        assert!(parse_release(r).is_err());
        let mut r = release();
        r["assets"][0]["size"] = json!(MAX_EXE + 1);
        assert!(parse_release(r).is_err());
    }
    #[test]
    fn digest_checks_reject_changed_or_truncated_downloads() {
        let folder =
            std::env::temp_dir().join(format!("aion-update-test-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&folder).unwrap();
        let file = folder.join("asset");
        let expected = parse_release(release()).unwrap().exe;
        fs::write(&file, b"abc").unwrap();
        assert!(verify(&file, &expected).is_ok());
        fs::write(&file, b"abd").unwrap();
        assert!(verify(&file, &expected).is_err());
        fs::write(&file, b"ab").unwrap();
        assert!(verify(&file, &expected).is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir(folder).unwrap();
    }
    #[test]
    fn semantic_versions_prevent_downgrades() {
        assert!(Version::new(0, 10, 0) > Version::new(0, 9, 9));
        assert!(Version::new(0, 6, 4) <= Version::parse(CURRENT).unwrap());
    }
    #[test]
    fn staging_cleans_downloads_after_success_interruption_and_verification_failure() {
        let release = parse_release(release()).unwrap();
        let root = std::env::temp_dir().join(format!(
            "aion-stage-cleanup-{}-{}",
            std::process::id(),
            now()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("current.txt"), "previous-version").unwrap();
        for outcome in ["success", "interrupted", "corrupt"] {
            let result = stage_with(&release, &root, |folder| {
                fs::write(
                    folder.join(&release.exe.name),
                    if outcome == "corrupt" { b"bad" } else { b"abc" },
                )
                .unwrap();
                if outcome == "interrupted" {
                    return Err("Download interrupted".into());
                }
                fs::write(folder.join(&release.notices.name), b"abc").unwrap();
                Ok(())
            });
            assert_eq!(result.is_ok(), outcome == "success");
            assert_eq!(fs::read_dir(root.join("updates")).unwrap().count(), 0);
            assert_eq!(
                fs::read_to_string(root.join("current.txt")).unwrap(),
                "previous-version"
            );
        }
        verify(
            &root
                .join("versions")
                .join(&release.exe.digest)
                .join("aion-companion.exe"),
            &release.exe,
        )
        .unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn portable_copies_do_not_inherit_an_unrelated_installation() {
        let root = Path::new("installation");
        assert!(managed_executable(
            root,
            &root
                .join("versions")
                .join("a".repeat(64))
                .join("aion-companion.exe")
        ));
        for path in [
            root.join("aion-companion.exe"),
            PathBuf::from("Downloads/app.exe"),
            root.join("versions/not-a-hash/aion-companion.exe"),
            root.join("versions").join("a".repeat(64)).join("other.exe"),
        ] {
            assert!(!managed_executable(root, &path));
        }
    }
    #[test]
    fn oversized_metadata_is_rejected() {
        assert_eq!(read_bounded(&b"abc"[..], 3).unwrap(), b"abc");
        assert!(read_bounded(&b"abcd"[..], 3).is_err());
    }
    #[test]
    #[ignore = "Requires the user's existing GitHub CLI authentication and downloads the current official release"]
    fn authenticated_release_download_stages_without_activating() {
        let release = read_latest().unwrap();
        let root = std::env::temp_dir().join(format!(
            "aion-release-stage-test-{}-{}",
            std::process::id(),
            now()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("current.txt"), "previous-version").unwrap();
        let hash = stage(&release, &root).unwrap();
        assert_eq!(hash, release.exe.digest);
        verify(
            &root.join("versions").join(&hash).join("aion-companion.exe"),
            &release.exe,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("current.txt")).unwrap(),
            "previous-version"
        );
        // Keep the verified artifact as local evidence; it is never launched by this test.
        println!(
            "Verified official release {} in {}",
            release.version,
            root.display()
        );
    }
}
