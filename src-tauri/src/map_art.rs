//! Verified, content-addressed map artwork. Nothing is fetched at application startup.
//! The UI requests one map; only complete, verified images are served to the WebView.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const MAGIC: &[u8; 8] = b"ACMAP001";
const MAX_PACK: u64 = 64_000_000;
const MAX_IMAGE: u64 = 8_000_000;
const MAP_IDS: &[&str] = &[
    "World/World_L/World_L_A",
    "World/World_D/World_D_A",
    "Intersever/Abyss/Abyss_Reshanta_A",
];

#[derive(Clone, Debug, PartialEq, Eq)]
struct Image {
    file: String,
    sha256: String,
    size: u64,
}
#[derive(Clone, Debug)]
struct Pack {
    id: String,
    asset: String,
    sha256: String,
    size: u64,
    files: Vec<Image>,
}
struct Index {
    maps: Vec<Pack>,
    images: HashMap<String, Image>,
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn text(value: &Value, key: &str) -> Result<String, String> {
    value[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Map artwork index is invalid.".into())
}
fn size(value: &Value, max: u64) -> Result<u64, String> {
    value["size"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= max)
        .ok_or_else(|| "Map artwork index size is invalid.".into())
}
impl Index {
    fn parse(source: &str) -> Result<Self, String> {
        let value: Value =
            serde_json::from_str(source).map_err(|_| "Invalid map artwork index.")?;
        if value["version"] != 1 || value["format"] != "ACMAP001" {
            return Err("Unknown map artwork format.".into());
        }
        let entries = value["maps"]
            .as_array()
            .ok_or("Missing map artwork index.")?;
        if entries.is_empty() || entries.len() > MAP_IDS.len() {
            return Err("Invalid map artwork count.".into());
        }
        let mut maps = Vec::new();
        let mut images = HashMap::new();
        let mut ids = HashSet::new();
        for entry in entries {
            let id = text(entry, "id")?;
            let digest = text(entry, "sha256")?;
            if !MAP_IDS.contains(&id.as_str()) || !ids.insert(id.clone()) || !valid_hash(&digest) {
                return Err("Invalid map artwork identity.".into());
            }
            let asset = text(entry, "asset")?;
            let slug = id.rsplit('/').next().ok_or("Invalid map identity.")?;
            if asset != format!("AionCompanion-map-{slug}-{}.acmap", &digest[..20]) {
                return Err("Invalid map artwork asset name.".into());
            }
            let pack_size = size(entry, MAX_PACK)?;
            let entries = entry["files"].as_array().ok_or("Missing map images.")?;
            if entries.is_empty() || entries.len() > 65 {
                return Err("Invalid map image count.".into());
            }
            let mut files = Vec::new();
            let mut names = HashSet::new();
            let mut total = MAGIC.len() as u64;
            for entry in entries {
                let digest = text(entry, "sha256")?;
                let file = text(entry, "file")?;
                if !valid_hash(&digest)
                    || file != format!("{}.webp", &digest[..20])
                    || !names.insert(file.clone())
                {
                    return Err("Invalid map image name.".into());
                }
                let image = Image {
                    file: file.clone(),
                    sha256: digest,
                    size: size(entry, MAX_IMAGE)?,
                };
                total = total
                    .checked_add(4 + image.size)
                    .ok_or("Map pack is too large.")?;
                if images.get(&file).is_some_and(|existing| existing != &image) {
                    return Err("Conflicting map image metadata.".into());
                }
                images.insert(file, image.clone());
                files.push(image);
            }
            if total != pack_size {
                return Err("Invalid map pack length.".into());
            }
            maps.push(Pack {
                id,
                asset,
                sha256: digest,
                size: pack_size,
                files,
            });
        }
        Ok(Self { maps, images })
    }

    fn map(&self, id: &str) -> Result<&Pack, String> {
        self.maps
            .iter()
            .find(|pack| pack.id == id)
            .ok_or_else(|| "This map has no downloadable artwork.".into())
    }
}
static INDEX: LazyLock<Result<Index, String>> =
    LazyLock::new(|| Index::parse(include_str!("../map-art-index.json")));
fn index() -> Result<&'static Index, String> {
    INDEX.as_ref().map_err(Clone::clone)
}

#[derive(Clone)]
struct Progress {
    phase: &'static str,
    downloaded: u64,
    error: Option<String>,
}
impl Default for Progress {
    fn default() -> Self {
        Self {
            phase: "missing",
            downloaded: 0,
            error: None,
        }
    }
}
#[derive(Clone, Default)]
pub struct MapArtState {
    inner: Arc<Mutex<HashMap<String, Progress>>>,
}
impl MapArtState {
    fn snapshot(&self, pack: &Pack) -> Result<Value, String> {
        let data = self
            .inner
            .lock()
            .map_err(|_| "Map download state is unavailable.")?;
        let progress = data.get(&pack.id).cloned().unwrap_or_default();
        Ok(json!({ "map_id": pack.id, "phase": progress.phase,
            "downloaded_bytes": progress.downloaded, "total_bytes": pack.size,
            "error": progress.error }))
    }
    fn begin(&self, pack: &Pack) -> Result<bool, String> {
        let mut data = self
            .inner
            .lock()
            .map_err(|_| "Map download state is unavailable.")?;
        let progress = data.entry(pack.id.clone()).or_default();
        if matches!(progress.phase, "downloading" | "ready") {
            return Ok(false);
        }
        *progress = Progress {
            phase: "downloading",
            downloaded: 0,
            error: None,
        };
        Ok(true)
    }
    fn progress(&self, pack: &Pack, downloaded: u64) {
        if let Ok(mut data) = self.inner.lock() {
            if let Some(progress) = data.get_mut(&pack.id) {
                progress.downloaded = downloaded.min(pack.size);
            }
        }
    }
    fn finish(&self, pack: &Pack, result: Result<(), String>) {
        if let Ok(mut data) = self.inner.lock() {
            let progress = data.entry(pack.id.clone()).or_default();
            match result {
                Ok(()) => {
                    *progress = Progress {
                        phase: "ready",
                        downloaded: pack.size,
                        error: None,
                    }
                }
                Err(error) => {
                    progress.phase = "error";
                    progress.error = Some(error);
                }
            }
        }
    }
    fn unavailable_image(&self, file: &str) {
        if let (Ok(index), Ok(mut data)) = (index(), self.inner.lock()) {
            for pack in &index.maps {
                if pack.files.iter().any(|image| image.file == file) {
                    if let Some(progress) = data.get_mut(&pack.id) {
                        if progress.phase == "ready" {
                            progress.phase = "error";
                            progress.error = Some(
                                "Cached map artwork is unavailable. Retry the map download.".into(),
                            );
                        }
                    }
                }
            }
        }
    }
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("map-art"))
        .map_err(|_| "The map cache folder is unavailable.".into())
}
fn read_image(root: &Path, image: &Image) -> Result<Vec<u8>, String> {
    let path = root.join(&image.file);
    let metadata = fs::symlink_metadata(&path).map_err(|_| "Map image is missing.")?;
    if !metadata.is_file() || metadata.len() != image.size {
        return Err("Map image size is invalid.".into());
    }
    let mut bytes = Vec::with_capacity(image.size as usize);
    File::open(path)
        .map_err(|_| "Map image is unavailable.")?
        .take(image.size + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Map image could not be read.")?;
    if bytes.len() as u64 != image.size || sha256(&bytes) != image.sha256 {
        return Err("Map image checksum verification failed.".into());
    }
    Ok(bytes)
}
fn verify_pack(file: &Path, pack: &Pack) -> Result<(), String> {
    let mut input = File::open(file).map_err(|_| "Downloaded map is unavailable.")?;
    if input
        .metadata()
        .map_err(|_| "Downloaded map is unavailable.")?
        .len()
        != pack.size
    {
        return Err("Downloaded map has an unexpected size.".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    let mut count = 0u64;
    loop {
        let size = input
            .read(&mut buffer)
            .map_err(|_| "Downloaded map could not be read.")?;
        if size == 0 {
            break;
        }
        count += size as u64;
        if count > pack.size {
            return Err("Downloaded map is too large.".into());
        }
        digest.update(&buffer[..size]);
    }
    if count != pack.size || format!("{:x}", digest.finalize()) != pack.sha256 {
        return Err("Map download verification failed. Retry the download.".into());
    }
    Ok(())
}

// A map pack has no names or paths. The executable's pinned index determines every
// destination and length. Verify the complete pack and all images before publishing.
fn unpack(root: &Path, staging: &Path, pack: &Pack) -> Result<(), String> {
    let downloaded = staging.join("download.acmap");
    verify_pack(&downloaded, pack)?;
    let mut input = File::open(downloaded).map_err(|_| "Downloaded map is unavailable.")?;
    let mut magic = [0; 8];
    input
        .read_exact(&mut magic)
        .map_err(|_| "Incomplete map download.")?;
    if &magic != MAGIC {
        return Err("Unknown map download format.".into());
    }
    for image in &pack.files {
        let mut length = [0; 4];
        input
            .read_exact(&mut length)
            .map_err(|_| "Incomplete map download.")?;
        if u32::from_le_bytes(length) as u64 != image.size {
            return Err("Map image length verification failed.".into());
        }
        let mut bytes = vec![0; image.size as usize];
        input
            .read_exact(&mut bytes)
            .map_err(|_| "Incomplete map download.")?;
        if sha256(&bytes) != image.sha256 {
            return Err("Map image verification failed.".into());
        }
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(staging.join(&image.file))
            .map_err(|_| "The map cache could not be written.")?;
        output
            .write_all(&bytes)
            .and_then(|_| output.sync_all())
            .map_err(|_| "The map cache could not be saved.")?;
    }
    if input
        .read(&mut [0])
        .map_err(|_| "Map download could not be read.")?
        != 0
    {
        return Err("Unexpected data in map download.".into());
    }
    for image in &pack.files {
        if read_image(root, image).is_ok() {
            continue;
        }
        let destination = root.join(&image.file);
        if destination.exists() {
            fs::remove_file(&destination).map_err(|_| "The map cache could not be repaired.")?;
        }
        fs::rename(staging.join(&image.file), destination)
            .map_err(|_| "The map cache could not be saved.")?;
    }
    Ok(())
}

struct Staging<'a> {
    path: PathBuf,
    pack: &'a Pack,
}
impl Staging<'_> {
    fn clean(&self) {
        let _ = fs::remove_file(self.path.join("download.acmap"));
        for image in &self.pack.files {
            let _ = fs::remove_file(self.path.join(&image.file));
        }
    }
}
impl Drop for Staging<'_> {
    fn drop(&mut self) {
        self.clean();
        let _ = fs::remove_dir(&self.path);
    }
}
fn cache_map_with(
    root: &Path,
    pack: &Pack,
    download: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if pack
        .files
        .iter()
        .all(|image| read_image(root, image).is_ok())
    {
        return Ok(());
    }
    fs::create_dir_all(root).map_err(|_| "The map cache folder could not be created.")?;
    let staging = Staging {
        path: root.join(format!(".download-{}", pack.sha256)),
        pack,
    };
    fs::create_dir_all(&staging.path)
        .map_err(|_| "The map download folder could not be created.")?;
    // Remove only our known leftovers after an interrupted process, never unrelated files.
    staging.clean();
    download(&staging.path.join("download.acmap"))?;
    unpack(root, &staging.path, pack)
}

fn copy_download(
    mut input: impl Read,
    destination: &Path,
    expected: u64,
    progress: &impl Fn(u64),
) -> Result<(), String> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| "The map download could not be saved.")?;
    let mut buffer = [0; 65536];
    let mut total = 0u64;
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|_| "Map download was interrupted. Check your connection and retry.")?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > expected {
            return Err("The map download exceeded its expected size.".into());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| "The map download could not be saved.")?;
        progress(total);
    }
    if total != expected {
        return Err("Map download was incomplete. Check your connection and retry.".into());
    }
    output
        .sync_all()
        .map_err(|_| "The map download could not be saved.".into())
}
fn download_private(
    pack: &Pack,
    destination: &Path,
    progress: &impl Fn(u64),
) -> Result<(), String> {
    let repository = crate::github_cli::REPOSITORY;
    let endpoint = format!(
        "repos/{repository}/releases/tags/v{}",
        env!("CARGO_PKG_VERSION")
    );
    let bytes = crate::updates::run_gh(
        &["api", &endpoint, "--hostname", "github.com"],
        Duration::from_secs(30),
        2 * 1024 * 1024,
    )?;
    let release: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Map release is unavailable.")?;
    if release["draft"] != false || release["prerelease"] != false {
        return Err("The map download is not available in a published release yet.".into());
    }
    let assets = release["assets"]
        .as_array()
        .ok_or("Map release assets are unavailable.")?;
    let matches: Vec<_> = assets
        .iter()
        .filter(|asset| asset["name"] == pack.asset)
        .collect();
    if matches.len() != 1 {
        return Err("The map download is not available in this release yet.".into());
    }
    let asset = matches[0];
    if asset["size"].as_u64() != Some(pack.size)
        || asset["digest"] != format!("sha256:{}", pack.sha256)
    {
        return Err("The released map does not match this app's verified map artwork.".into());
    }
    let id = asset["id"]
        .as_u64()
        .ok_or("Map release asset is invalid.")?;
    let endpoint = format!("repos/{repository}/releases/assets/{id}");
    let bytes = crate::updates::run_gh(
        &[
            "api",
            &endpoint,
            "--hostname",
            "github.com",
            "-H",
            "Accept: application/octet-stream",
        ],
        Duration::from_secs(300),
        pack.size,
    )?;
    copy_download(
        std::io::Cursor::new(bytes),
        destination,
        pack.size,
        progress,
    )
}
// Dev builds can exercise first-use caching before the next release is published.
// Stable builds contain no workspace path or source-art fallback.
#[cfg(any(feature = "development", test))]
fn write_workspace_pack(
    source: &Path,
    pack: &Pack,
    destination: &Path,
    progress: &impl Fn(u64),
) -> Result<(), String> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| "The Dev map pack could not be created.")?;
    output
        .write_all(MAGIC)
        .map_err(|_| "The Dev map pack could not be written.")?;
    let mut total = MAGIC.len() as u64;
    for image in &pack.files {
        let bytes = read_image(source, image)?;
        output
            .write_all(&(bytes.len() as u32).to_le_bytes())
            .and_then(|_| output.write_all(&bytes))
            .map_err(|_| "The Dev map pack could not be written.")?;
        total += 4 + bytes.len() as u64;
        progress(total);
    }
    output
        .sync_all()
        .map_err(|_| "The Dev map pack could not be saved.".into())
}

fn download_map(pack: &Pack, destination: &Path, progress: impl Fn(u64)) -> Result<(), String> {
    #[cfg(feature = "development")]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../artwork/delivery/pet-map-art");
        if source.is_dir() {
            return write_workspace_pack(&source, pack, destination, &progress);
        }
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("AionCompanion/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| "Secure map downloads could not be initialized.")?;
    let url = format!(
        "https://github.com/{}/releases/download/v{}/{}",
        crate::github_cli::REPOSITORY,
        env!("CARGO_PKG_VERSION"),
        pack.asset
    );
    let response = client
        .get(url)
        .send()
        .map_err(|_| "Map download failed. Check your connection and retry.")?;
    if response.status().is_success() {
        return copy_download(response, destination, pack.size, &progress);
    }
    if matches!(response.status().as_u16(), 401 | 403 | 404) {
        return download_private(pack, destination, &progress);
    }
    Err(format!(
        "Map download returned HTTP {}. Retry later.",
        response.status().as_u16()
    ))
}

#[tauri::command]
pub fn map_art_status(
    map_id: String,
    state: tauri::State<'_, MapArtState>,
) -> Result<Value, String> {
    state.snapshot(index()?.map(&map_id)?)
}
#[tauri::command]
pub fn map_art_ensure(
    app: AppHandle,
    map_id: String,
    state: tauri::State<'_, MapArtState>,
) -> Result<Value, String> {
    let pack = index()?.map(&map_id)?;
    let root = cache_root(&app)?;
    if state.begin(pack)? {
        let worker = state.inner().clone();
        let spawn = std::thread::Builder::new()
            .name("map-art-download".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    cache_map_with(&root, pack, |destination| {
                        download_map(pack, destination, |bytes| worker.progress(pack, bytes))
                    })
                }))
                .unwrap_or_else(|_| {
                    Err("Map download stopped unexpectedly. Retry the download.".into())
                });
                worker.finish(pack, result);
            });
        if spawn.is_err() {
            state.finish(
                pack,
                Err("The map download could not start. Retry the download.".into()),
            );
        }
    }
    state.snapshot(pack)
}

pub fn protocol(
    app: AppHandle,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let filename = request
        .uri()
        .path()
        .strip_prefix('/')
        .unwrap_or("")
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes: Result<Vec<u8>, String> = (|| {
            if request.method() != tauri::http::Method::GET {
                return Err("Invalid map image request.".into());
            }
            let image = index()?.images.get(&filename).ok_or("Unknown map image.")?;
            read_image(&cache_root(&app)?, image)
        })();
        let response = match bytes {
            Ok(bytes) => tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", "image/webp")
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes),
            Err(_) => {
                if request.method() == tauri::http::Method::GET {
                    app.state::<MapArtState>().unavailable_image(&filename);
                }
                tauri::http::Response::builder()
                    .status(404)
                    .header("Cache-Control", "no-store")
                    .body(Vec::new())
            }
        };
        // All header values are constants, so constructing the response cannot fail.
        if let Ok(response) = response {
            responder.respond(response);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Cursor, net::TcpListener, sync::Barrier, time::SystemTime};

    struct Root(PathBuf);
    impl Root {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "aion-map-cache-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn fixture() -> (Pack, Vec<u8>) {
        let mut bytes = MAGIC.to_vec();
        let mut files = Vec::new();
        for content in [
            b"first original map image".as_slice(),
            b"second original map image".as_slice(),
        ] {
            let digest = sha256(content);
            files.push(Image {
                file: format!("{}.webp", &digest[..20]),
                sha256: digest,
                size: content.len() as u64,
            });
            bytes.extend_from_slice(&(content.len() as u32).to_le_bytes());
            bytes.extend_from_slice(content);
        }
        let digest = sha256(&bytes);
        let pack = Pack {
            id: MAP_IDS[0].into(),
            asset: format!("AionCompanion-map-World_L_A-{}.acmap", &digest[..20]),
            sha256: digest,
            size: bytes.len() as u64,
            files,
        };
        (pack, bytes)
    }
    fn index_json(pack: &Pack) -> Value {
        json!({"version":1,"format":"ACMAP001","maps":[{"id":pack.id,"asset":pack.asset,"sha256":pack.sha256,
            "size":pack.size,"files":pack.files.iter().map(|image| json!({"file":image.file,"sha256":image.sha256,"size":image.size})).collect::<Vec<_>>()}]})
    }
    fn serve(bytes: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/map.acmap", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .unwrap();
            stream.write_all(&bytes).unwrap();
        });
        (url, handle)
    }

    #[test]
    fn embedded_index_covers_all_original_maps_without_bundling_the_images() {
        let index = index().unwrap();
        assert_eq!(index.maps.len(), 3);
        assert_eq!(index.images.len(), 147);
        for id in MAP_IDS {
            assert!(index.map(id).is_ok());
        }
        assert!(index.map("../other-map").is_err());
    }

    #[test]
    fn dev_workspace_uses_the_same_verified_pack_and_rejects_corrupt_art() {
        let root = Root::new();
        let (pack, bytes) = fixture();
        let mut offset = MAGIC.len();
        for image in &pack.files {
            offset += 4;
            fs::write(
                root.0.join(&image.file),
                &bytes[offset..offset + image.size as usize],
            )
            .unwrap();
            offset += image.size as usize;
        }
        let destination = root.0.join("dev.acmap");
        write_workspace_pack(&root.0, &pack, &destination, &|_| {}).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        verify_pack(&destination, &pack).unwrap();
        fs::remove_file(&destination).unwrap();
        fs::write(root.0.join(&pack.files[0].file), b"corrupt").unwrap();
        assert!(write_workspace_pack(&root.0, &pack, &destination, &|_| {}).is_err());
    }

    #[test]
    #[ignore = "requires Node-generated map packs in AION_MAP_PACK_TEST_DIR"]
    fn release_map_packs_match_native_index_and_cache_offline() {
        let packs = PathBuf::from(
            std::env::var_os("AION_MAP_PACK_TEST_DIR").expect("Set AION_MAP_PACK_TEST_DIR"),
        );
        let root = Root::new();
        for pack in &index().unwrap().maps {
            let source = packs.join(&pack.asset);
            cache_map_with(&root.0, pack, |destination| {
                fs::copy(&source, destination)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();
            for image in &pack.files {
                assert!(read_image(&root.0, image).is_ok());
            }
            cache_map_with(&root.0, pack, |_| {
                panic!("Verified cache must work offline")
            })
            .unwrap();
        }
    }

    #[test]
    fn first_use_downloads_one_map_then_a_fresh_cache_owner_works_offline() {
        let root = Root::new();
        let (pack, bytes) = fixture();
        let (url, server) = serve(bytes);
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let progress = Mutex::new(Vec::new());
        cache_map_with(&root.0, &pack, |destination| {
            let response = client.get(url).send().map_err(|e| e.to_string())?;
            copy_download(response, destination, pack.size, &|bytes| {
                progress.lock().unwrap().push(bytes)
            })
        })
        .unwrap();
        server.join().unwrap();
        assert_eq!(progress.lock().unwrap().last(), Some(&pack.size));
        assert_eq!(
            read_image(&root.0, &pack.files[0]).unwrap(),
            b"first original map image"
        );
        // No process-memory marker is required: the cache itself is verified after restart.
        cache_map_with(&root.0, &pack, |_| {
            panic!("A cached map must not use the network")
        })
        .unwrap();
        assert!(fs::read_dir(&root.0).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with('.')));
    }

    #[test]
    fn corrupted_cached_image_is_never_served_and_can_be_repaired() {
        let root = Root::new();
        let (pack, bytes) = fixture();
        let fetch = |destination: &Path| {
            copy_download(Cursor::new(&bytes), destination, pack.size, &|_| {})
        };
        cache_map_with(&root.0, &pack, fetch).unwrap();
        fs::write(
            root.0.join(&pack.files[0].file),
            vec![b'x'; pack.files[0].size as usize],
        )
        .unwrap();
        assert!(read_image(&root.0, &pack.files[0]).is_err());
        cache_map_with(&root.0, &pack, fetch).unwrap();
        assert!(pack
            .files
            .iter()
            .all(|image| read_image(&root.0, image).is_ok()));
    }

    #[test]
    fn corrupt_incomplete_and_oversized_downloads_never_publish_images() {
        for kind in ["corrupt", "incomplete", "oversized"] {
            let root = Root::new();
            let (pack, mut bytes) = fixture();
            match kind {
                "corrupt" => bytes[15] ^= 1,
                "incomplete" => {
                    bytes.pop();
                }
                _ => bytes.push(0),
            }
            assert!(
                cache_map_with(&root.0, &pack, |destination| copy_download(
                    Cursor::new(bytes),
                    destination,
                    pack.size,
                    &|_| {}
                ))
                .is_err(),
                "{kind}"
            );
            assert_eq!(fs::read_dir(&root.0).unwrap().count(), 0, "{kind}");
        }
    }

    #[test]
    fn invalid_magic_lengths_image_digests_and_trailing_data_are_rejected() {
        for kind in ["magic", "length", "image", "trailing"] {
            let root = Root::new();
            let (mut pack, mut bytes) = fixture();
            match kind {
                "magic" => bytes[0] = b'X',
                "length" => bytes[8..12].copy_from_slice(&u32::MAX.to_le_bytes()),
                "image" => bytes[15] ^= 1,
                _ => bytes.push(0),
            }
            // Prove the parser also rejects a malformed container with a matching pack hash.
            pack.sha256 = sha256(&bytes);
            pack.size = bytes.len() as u64;
            assert!(
                cache_map_with(&root.0, &pack, |destination| fs::write(destination, bytes)
                    .map_err(|e| e.to_string()))
                .is_err(),
                "{kind}"
            );
            assert_eq!(fs::read_dir(&root.0).unwrap().count(), 0, "{kind}");
        }
    }

    #[test]
    fn retries_clean_known_interrupted_downloads_and_preserve_unrelated_files() {
        let root = Root::new();
        let (pack, bytes) = fixture();
        let staging = root.0.join(format!(".download-{}", pack.sha256));
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("download.acmap"), "interrupted").unwrap();
        fs::write(staging.join(&pack.files[0].file), "partial image").unwrap();
        fs::write(staging.join("keep.txt"), "unrelated").unwrap();
        fs::write(root.0.join("keep.txt"), "unrelated").unwrap();
        cache_map_with(&root.0, &pack, |destination| {
            copy_download(Cursor::new(bytes), destination, pack.size, &|_| {})
        })
        .unwrap();
        assert_eq!(fs::read(staging.join("keep.txt")).unwrap(), b"unrelated");
        assert_eq!(fs::read(root.0.join("keep.txt")).unwrap(), b"unrelated");
        assert!(!staging.join("download.acmap").exists());
    }

    #[test]
    fn multiple_windows_share_one_job_and_failure_allows_retry() {
        let state = MapArtState::default();
        let (pack, _) = fixture();
        let barrier = Arc::new(Barrier::new(12));
        let jobs: Vec<_> = (0..12)
            .map(|_| {
                let (state, pack, barrier) = (state.clone(), pack.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    state.begin(&pack).unwrap()
                })
            })
            .collect();
        assert_eq!(
            jobs.into_iter()
                .map(|job| job.join().unwrap())
                .filter(|started| *started)
                .count(),
            1
        );
        state.progress(&pack, pack.size + 10);
        assert_eq!(
            state.snapshot(&pack).unwrap()["downloaded_bytes"],
            pack.size
        );
        state.finish(&pack, Err("offline".into()));
        assert_eq!(state.snapshot(&pack).unwrap()["phase"], "error");
        assert!(state.begin(&pack).unwrap());
        state.finish(&pack, Ok(()));
        assert!(!state.begin(&pack).unwrap());
        assert_eq!(state.snapshot(&pack).unwrap()["phase"], "ready");
    }

    #[test]
    fn index_rejects_paths_bad_hashes_conflicting_lengths_and_duplicate_maps() {
        let (pack, _) = fixture();
        assert!(Index::parse(&index_json(&pack).to_string()).is_ok());
        for kind in ["path", "hash", "size", "duplicate", "asset"] {
            let mut value = index_json(&pack);
            match kind {
                "path" => value["maps"][0]["files"][0]["file"] = json!("../settings.json"),
                "hash" => value["maps"][0]["files"][0]["sha256"] = json!("bad"),
                "size" => value["maps"][0]["files"][0]["size"] = json!(u32::MAX),
                "duplicate" => {
                    let duplicate = value["maps"][0].clone();
                    value["maps"].as_array_mut().unwrap().push(duplicate);
                }
                _ => value["maps"][0]["asset"] = json!("../../other-file"),
            }
            assert!(Index::parse(&value.to_string()).is_err(), "{kind}");
        }
    }
}
