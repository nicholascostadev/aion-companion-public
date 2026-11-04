//! Public character profiles, read directly from NCSOFT's official character service over the
//! user's own connection (see `docs/CHARACTER_PROFILES.md`). Every address is built here from
//! validated parts; the frontend never supplies a URL, so no command can fetch an arbitrary
//! address. Browsers cannot read these endpoints (no CORS), which is why native does.
//!
//! Requests are bounded: at most four at once, short timeouts, capped bodies, a small
//! time-limited cache keyed by every identifying parameter, and a shared back-off after the
//! service answers 429. No capture or window lock is held while a request runs.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const SEARCH: &str = "https://api-search.plaync.com/aion2global/search/v2/character";
const CHARACTER: &str = "https://aion2.plaync.com/api/character";
/// The only hosts profile data is read from: NCSOFT's official search and character service.
/// `get_json` refuses every other address before it reaches the network.
const DATA_HOSTS: [&str; 2] = ["api-search.plaync.com", "aion2.plaync.com"];
/// Official artwork: game-data resources (items, skills, boards) and character portraits.
const RESOURCES: &str = "https://assets.playnccdn.com/static-aion2-gamedata/resources/";
const PORTRAITS: &str = "https://profileimg.plaync.com/game_profile_images/aion2global/images";
/// Hosts a portrait may redirect to; anything else is refused.
const ART_HOSTS: [&str; 3] = [
    "assets.playnccdn.com",
    "profileimg.plaync.com",
    "fizz-download.playnccdn.com",
];
/// Languages the official service publishes, as its `lang` parameter spells them.
pub(crate) const LANGUAGES: [&str; 6] = ["en-US", "pt-BR", "de-DE", "fr-FR", "es-ES", "ja-JP"];
const MAX_JSON: u64 = 2_000_000;
const MAX_IMAGE: u64 = 2_000_000;
const MAX_IN_FLIGHT: usize = 4;
const MAX_CACHED: usize = 96;
const MAX_ART: usize = 160;
const MAX_ART_BYTES: usize = 32_000_000;
/// The search lists similar names first-come; a few pages are enough for an exact name.
const SEARCH_PAGES: u32 = 3;
const SEARCH_PAGE_SIZE: u32 = 20;
/// A 429 asking for at most this long is waited out once; longer ones are reported.
const SHORT_RETRY: Duration = Duration::from_secs(2);

/// What went wrong, in terms the profile view can explain and recover from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    /// The request itself was refused here (bad server, name, id or language).
    Invalid,
    /// No character with exactly this name on this server, or the record is gone.
    NotFound,
    /// The service answered 451: the character's profile is not public.
    Private,
    /// The service answered 429, or the back-off it asked for has not elapsed.
    RateLimited,
    /// The service answered with an error or a response it no longer documents.
    Unavailable,
    /// The request did not complete (offline, timeout, TLS).
    Network,
}
impl ErrorKind {
    fn name(self) -> &'static str {
        match self {
            Self::Invalid => "invalid",
            Self::NotFound => "not_found",
            Self::Private => "private",
            Self::RateLimited => "rate_limited",
            Self::Unavailable => "unavailable",
            Self::Network => "network",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileError {
    pub kind: ErrorKind,
    pub message: String,
    pub retry_after_s: Option<u64>,
}
impl ProfileError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_s: None,
        }
    }
    pub fn to_value(&self) -> Value {
        json!({"kind":self.kind.name(),"message":self.message,"retry_after_s":self.retry_after_s})
    }
}

/// One HTTP answer: status, the `Retry-After` seconds if any, and the (bounded) body.
pub struct Reply {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: Vec<u8>,
}

/// The network boundary, replaced by scripted answers in tests.
pub trait Transport: Send + Sync {
    fn get(&self, url: &str, limit: u64) -> Result<Reply, String>;
}

pub(crate) struct Http(reqwest::blocking::Client);
impl Http {
    /// A data client: bounded timeouts, this app's own user agent, no redirects.
    pub(crate) fn data() -> Result<Box<dyn Transport>, String> {
        client(reqwest::redirect::Policy::none()).map(|c| Box::new(Http(c)) as Box<dyn Transport>)
    }
}
impl Transport for Http {
    fn get(&self, url: &str, limit: u64) -> Result<Reply, String> {
        let response = self.0.get(url).send().map_err(|e| {
            if e.is_timeout() {
                "The official service did not answer in time.".to_string()
            } else {
                "The official service could not be reached.".to_string()
            }
        })?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let mut body = Vec::new();
        response
            .take(limit + 1)
            .read_to_end(&mut body)
            .map_err(|_| "The official answer could not be read.".to_string())?;
        if body.len() as u64 > limit {
            return Err("The official answer exceeds the size limit.".into());
        }
        Ok(Reply {
            status,
            retry_after,
            body,
        })
    }
}

/// Portraits redirect once to the official download host; other redirects are refused.
fn art_redirects() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let allowed = attempt.url().scheme() == "https"
            && attempt
                .url()
                .host_str()
                .is_some_and(|host| ART_HOSTS.contains(&host));
        if attempt.previous().len() >= 3 || !allowed {
            attempt.stop()
        } else {
            attempt.follow()
        }
    })
}

fn client(redirect: reqwest::redirect::Policy) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .redirect(redirect)
        .user_agent(concat!("AionCompanion/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Profile client unavailable: {e}"))
}

#[derive(Clone, Copy)]
enum Freshness {
    Identity,
    Character,
    Detail,
}
impl Freshness {
    fn ttl(self) -> Duration {
        match self {
            Self::Identity => Duration::from_secs(30 * 60),
            Self::Character => Duration::from_secs(5 * 60),
            Self::Detail => Duration::from_secs(10 * 60),
        }
    }
}

/// Answers by request key, each kept for its freshness; the oldest go first when full.
#[derive(Default)]
struct Cache(HashMap<String, (Instant, Duration, Value)>);
impl Cache {
    fn get(&self, key: &str, now: Instant) -> Option<Value> {
        let (at, ttl, value) = self.0.get(key)?;
        (now.duration_since(*at) < *ttl).then(|| value.clone())
    }
    fn put(&mut self, key: String, freshness: Freshness, value: Value, now: Instant) {
        self.0
            .retain(|_, (at, ttl, _)| now.duration_since(*at) < *ttl);
        while self.0.len() >= MAX_CACHED {
            let Some(oldest) = self
                .0
                .iter()
                .min_by_key(|(_, (at, _, _))| *at)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            self.0.remove(&oldest);
        }
        self.0.insert(key, (now, freshness.ttl(), value));
    }
}

/// Recently shown artwork, bounded by count and bytes.
#[derive(Default)]
struct ArtCache {
    entries: HashMap<String, (Instant, &'static str, Vec<u8>)>,
    bytes: usize,
}
impl ArtCache {
    fn get(&mut self, key: &str) -> Option<(&'static str, Vec<u8>)> {
        let entry = self.entries.get_mut(key)?;
        entry.0 = Instant::now();
        Some((entry.1, entry.2.clone()))
    }
    fn put(&mut self, key: String, kind: &'static str, bytes: Vec<u8>) {
        while !self.entries.is_empty()
            && (self.entries.len() >= MAX_ART || self.bytes + bytes.len() > MAX_ART_BYTES)
        {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (at, _, _))| *at)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some((_, _, old)) = self.entries.remove(&oldest) {
                self.bytes -= old.len();
            }
        }
        self.bytes += bytes.len();
        if let Some((_, _, old)) = self.entries.insert(key, (Instant::now(), kind, bytes)) {
            self.bytes -= old.len();
        }
    }
}

/// Counting gate for requests in flight.
struct Slots {
    used: Mutex<usize>,
    freed: Condvar,
}
impl Slots {
    fn acquire(&self) -> Result<SlotGuard<'_>, ProfileError> {
        let busy = || {
            ProfileError::new(
                ErrorKind::Unavailable,
                "Too many profile requests are running.",
            )
        };
        let mut used = self.used.lock().map_err(|_| busy())?;
        let deadline = Instant::now() + Duration::from_secs(20);
        while *used >= MAX_IN_FLIGHT {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(busy());
            }
            used = self.freed.wait_timeout(used, left).map_err(|_| busy())?.0;
        }
        *used += 1;
        Ok(SlotGuard(self))
    }
}
struct SlotGuard<'a>(&'a Slots);
impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut used) = self.0.used.lock() {
            *used -= 1;
        }
        self.0.freed.notify_one();
    }
}

pub struct ProfileApi {
    transport: OnceLock<Result<Box<dyn Transport>, String>>,
    art_transport: OnceLock<Result<Box<dyn Transport>, String>>,
    cache: Mutex<Cache>,
    art: Mutex<ArtCache>,
    slots: Slots,
    art_slots: Slots,
    /// Until when the service asked us to wait after a 429.
    blocked_until: Mutex<Option<Instant>>,
    /// Server names as official character sheets gave them, by the server id they answered for.
    server_names: Mutex<HashMap<u16, String>>,
}
impl Default for ProfileApi {
    fn default() -> Self {
        Self {
            transport: OnceLock::new(),
            art_transport: OnceLock::new(),
            cache: Mutex::default(),
            art: Mutex::default(),
            slots: Slots {
                used: Mutex::new(0),
                freed: Condvar::new(),
            },
            art_slots: Slots {
                used: Mutex::new(0),
                freed: Condvar::new(),
            },
            blocked_until: Mutex::new(None),
            server_names: Mutex::default(),
        }
    }
}

impl ProfileApi {
    #[cfg(test)]
    fn with_transport(transport: impl Transport + 'static) -> Self {
        let api = Self::default();
        let _ = api.transport.set(Ok(Box::new(transport)));
        api
    }

    fn transport(&self) -> Result<&dyn Transport, ProfileError> {
        self.transport
            .get_or_init(Http::data)
            .as_ref()
            .map(|t| t.as_ref())
            .map_err(|e| ProfileError::new(ErrorKind::Network, e.clone()))
    }

    fn blocked(&self) -> Option<Duration> {
        let until = (*self.blocked_until.lock().ok()?)?;
        let left = until.saturating_duration_since(Instant::now());
        (!left.is_zero()).then_some(left)
    }

    fn block_for(&self, wait: Duration) {
        if let Ok(mut until) = self.blocked_until.lock() {
            let next = Instant::now() + wait;
            if until.is_none_or(|at| at < next) {
                *until = Some(next);
            }
        }
    }

    /// One GET of an official JSON object, honouring the shared 429 back-off.
    fn get_json(&self, url: &str) -> Result<Value, ProfileError> {
        if !official_data_url(url) {
            return Err(ProfileError::new(
                ErrorKind::Invalid,
                "Profiles are read only from NCSOFT's official character service.",
            ));
        }
        let mut retried = false;
        loop {
            if let Some(left) = self.blocked() {
                return Err(rate_limited(left.as_secs().max(1)));
            }
            let reply = {
                let _slot = self.slots.acquire()?;
                self.transport()?
                    .get(url, MAX_JSON)
                    .map_err(|e| ProfileError::new(ErrorKind::Network, e))?
            };
            match reply.status {
                200 => {
                    let value: Value = serde_json::from_slice(&reply.body).map_err(|_| {
                        ProfileError::new(
                            ErrorKind::Unavailable,
                            "The official answer changed format.",
                        )
                    })?;
                    if !value.is_object() {
                        return Err(ProfileError::new(
                            ErrorKind::Unavailable,
                            "The official answer changed format.",
                        ));
                    }
                    return Ok(value);
                }
                404 => {
                    return Err(ProfileError::new(
                        ErrorKind::NotFound,
                        "The official service has no such record.",
                    ))
                }
                451 => {
                    return Err(ProfileError::new(
                        ErrorKind::Private,
                        "This character's profile is not public.",
                    ))
                }
                429 => {
                    let wait = reply.retry_after.unwrap_or(10).clamp(1, 300);
                    self.block_for(Duration::from_secs(wait));
                    if !retried && Duration::from_secs(wait) <= SHORT_RETRY {
                        retried = true;
                        std::thread::sleep(Duration::from_secs(wait));
                        continue;
                    }
                    return Err(rate_limited(wait));
                }
                status => {
                    return Err(ProfileError::new(
                        ErrorKind::Unavailable,
                        format!("The official service answered {status}."),
                    ))
                }
            }
        }
    }

    fn cached(
        &self,
        url: &str,
        freshness: Freshness,
        refresh: bool,
    ) -> Result<(Value, bool), ProfileError> {
        if !refresh {
            if let Some(value) = self
                .cache
                .lock()
                .ok()
                .and_then(|c| c.get(url, Instant::now()))
            {
                return Ok((value, true));
            }
        }
        let value = self.get_json(url)?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.put(url.to_string(), freshness, value.clone(), Instant::now());
        }
        Ok((value, false))
    }

    /// The official id of exactly `name` on `server`: never a similar name from the search.
    fn identity(&self, query: &Query, refresh: bool) -> Result<String, ProfileError> {
        let key = format!("identity|{}|{}|{}", query.lang, query.server_id, query.name);
        if !refresh {
            if let Some(Value::String(id)) = self
                .cache
                .lock()
                .ok()
                .and_then(|c| c.get(&key, Instant::now()))
            {
                return Ok(id);
            }
        }
        for page in 1..=SEARCH_PAGES {
            let result = self.get_json(&search_url(query, page))?;
            if let Some(id) = exact_match(&result, &query.name, query.server_id)? {
                if let Ok(mut cache) = self.cache.lock() {
                    cache.put(
                        key,
                        Freshness::Identity,
                        Value::String(id.clone()),
                        Instant::now(),
                    );
                }
                return Ok(id);
            }
            if page >= result["pagination"]["endPage"].as_u64().unwrap_or(1) as u32 {
                break;
            }
        }
        Err(ProfileError::new(
            ErrorKind::NotFound,
            "No public character has exactly this name on this server.",
        ))
    }

    /// Identity, then the character sheet and its equipment. Either half may fail alone.
    pub fn character(&self, query: &Query, refresh: bool) -> Result<Value, ProfileError> {
        let id = self.identity(query, refresh)?;
        let base = character_query(query, &id);
        let info = self.cached(
            &format!("{CHARACTER}/info?{base}"),
            Freshness::Character,
            refresh,
        );
        let equipment = self.cached(
            &format!("{CHARACTER}/equipment?{base}"),
            Freshness::Character,
            refresh,
        );
        if let (Err(error), Err(_)) = (&info, &equipment) {
            return Err(error.clone());
        }
        let part = |result: &Result<(Value, bool), ProfileError>| match result {
            Ok((value, _)) => (value.clone(), Value::Null),
            Err(error) => (Value::Null, error.to_value()),
        };
        let (info_value, info_error) = part(&info);
        let (equipment_value, equipment_error) = part(&equipment);
        self.remember_server_name(query, &info_value);
        let cached = [&info, &equipment]
            .iter()
            .all(|r| r.as_ref().map_or(true, |(_, cached)| *cached));
        Ok(json!({
            "identity": {"character_id": id, "server_id": query.server_id, "region": query.region, "name": query.name, "lang": query.lang},
            "info": info_value,
            "info_error": info_error,
            "equipment": equipment_value,
            "equipment_error": equipment_error,
            "cached": cached,
            "fetched_ms": now_ms(),
        }))
    }

    /// Keeps the sheet's `serverName` when the sheet is exactly the looked-up character on the
    /// looked-up server, so saved characters can show the official name without a request.
    fn remember_server_name(&self, query: &Query, info: &Value) {
        let profile = &info["profile"];
        if profile["serverId"].as_u64() != Some(u64::from(query.server_id))
            || profile["characterName"].as_str() != Some(query.name.as_str())
        {
            return;
        }
        let Some(name) = profile["serverName"]
            .as_str()
            .and_then(crate::profile_identity::server_name)
        else {
            return;
        };
        if let Ok(mut names) = self.server_names.lock() {
            names.insert(query.server_id, name);
        }
    }

    /// The official name of a server a sheet has already answered for, if any.
    pub fn server_name(&self, server_id: u16) -> Option<String> {
        self.server_names.lock().ok()?.get(&server_id).cloned()
    }

    /// One equipped item as this character has it: the slot and the total enchant level
    /// (enchant plus breakthrough) pick the right copy and its breakthrough bonuses.
    pub fn item(&self, request: &ItemRequest) -> Result<Value, ProfileError> {
        let base = character_query(&request.query, &request.character_id);
        let url = format!(
            "{CHARACTER}/equipment/item?{base}&id={}&enchantLevel={}&slotPos={}",
            request.item_id, request.enchant_level, request.slot_pos
        );
        self.cached(&url, Freshness::Detail, request.refresh)
            .map(|(v, _)| v)
    }

    pub fn board(&self, request: &BoardRequest) -> Result<Value, ProfileError> {
        let base = character_query(&request.query, &request.character_id);
        let url = format!(
            "{CHARACTER}/daevanion/detail?{base}&boardId={}",
            request.board_id
        );
        self.cached(&url, Freshness::Detail, request.refresh)
            .map(|(v, _)| v)
    }

    fn art_transport(&self) -> Result<&dyn Transport, String> {
        self.art_transport
            .get_or_init(|| {
                client(art_redirects()).map(|c| Box::new(Http(c)) as Box<dyn Transport>)
            })
            .as_ref()
            .map(|t| t.as_ref())
            .map_err(Clone::clone)
    }

    /// Original artwork for an `art_url` key, from memory or the official host.
    fn artwork(&self, key: &str) -> Result<(&'static str, Vec<u8>), String> {
        if let Some(hit) = self.art.lock().ok().and_then(|mut a| a.get(key)) {
            return Ok(hit);
        }
        let url = art_url(key).ok_or("Unknown artwork.")?;
        let reply = {
            let _slot = self.art_slots.acquire().map_err(|e| e.message)?;
            self.art_transport()?.get(&url, MAX_IMAGE)?
        };
        if reply.status != 200 {
            return Err(format!("Artwork answered {}.", reply.status));
        }
        let kind = image_kind(&reply.body).ok_or("Not an image.")?;
        if let Ok(mut art) = self.art.lock() {
            art.put(key.to_string(), kind, reply.body.clone());
        }
        Ok((kind, reply.body))
    }
}

fn rate_limited(seconds: u64) -> ProfileError {
    ProfileError {
        kind: ErrorKind::RateLimited,
        message: "The official service asked to wait before more profile requests.".into(),
        retry_after_s: Some(seconds),
    }
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// A validated character lookup: a Global server, an observed name and a published language.
#[derive(Clone, Debug)]
pub struct Query {
    pub server_id: u16,
    pub region: &'static str,
    pub name: String,
    pub lang: &'static str,
}
impl Query {
    pub fn new(server_id: u16, name: &str, lang: &str) -> Result<Self, ProfileError> {
        let region = crate::profile_identity::region(server_id).ok_or_else(|| {
            ProfileError::new(
                ErrorKind::Invalid,
                "Official profiles are only available for Global servers.",
            )
        })?;
        if !crate::profile_identity::valid_name(name) {
            return Err(ProfileError::new(
                ErrorKind::Invalid,
                "This character has no observed name to look up.",
            ));
        }
        let lang = LANGUAGES
            .iter()
            .copied()
            .find(|l| *l == lang)
            .ok_or_else(|| {
                ProfileError::new(ErrorKind::Invalid, "Unsupported profile language.")
            })?;
        Ok(Self {
            server_id,
            region,
            name: name.to_string(),
            lang,
        })
    }
}

pub struct ItemRequest {
    pub query: Query,
    pub character_id: String,
    pub item_id: u64,
    pub slot_pos: u16,
    pub enchant_level: u16,
    pub refresh: bool,
}
pub struct BoardRequest {
    pub query: Query,
    pub character_id: String,
    pub board_id: u16,
    pub refresh: bool,
}

/// An HTTPS address on one of NCSOFT's official profile data hosts, with no port or login.
fn official_data_url(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.port().is_none()
            && u.username().is_empty()
            && u.password().is_none()
            && u.host_str().is_some_and(|host| DATA_HOSTS.contains(&host))
    })
}

fn search_url(query: &Query, page: u32) -> String {
    format!(
        "{SEARCH}?keyword={}&page={page}&size={SEARCH_PAGE_SIZE}&localeInfo={}&region={}&serverId={}",
        crate::profile_identity::encode(&query.name),
        query.lang,
        query.region,
        query.server_id
    )
}

/// `lang`, `characterId` (query-encoded exactly once), `serverId` and `region`.
fn character_query(query: &Query, character_id: &str) -> String {
    format!(
        "lang={}&characterId={}&serverId={}&region={}",
        query.lang,
        crate::profile_identity::encode(character_id),
        query.server_id,
        query.region
    )
}

/// An official character id as the service issues it: URL-safe Base64, `=` padded.
pub fn valid_character_id(id: &str) -> bool {
    (8..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_=".contains(&b))
}

/// Decodes `%XX` escapes once; None for a malformed escape or invalid UTF-8.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The search marks the matched part of a name with tags (`<strong>foxy</strong>T`); the
/// name is the text without any tag, with the few entities HTML text may carry decoded.
fn plain_name(marked: &str) -> String {
    let mut text = String::with_capacity(marked.len());
    let mut in_tag = false;
    for c in marked.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The decoded id of the one entry named exactly `name` on `server`, if the page has it.
fn exact_match(result: &Value, name: &str, server: u16) -> Result<Option<String>, ProfileError> {
    let format = || {
        ProfileError::new(
            ErrorKind::Unavailable,
            "The official search changed format.",
        )
    };
    let list = result["list"].as_array().ok_or_else(format)?;
    let matches: Vec<&Value> = list
        .iter()
        .filter(|entry| {
            entry["serverId"].as_u64() == Some(u64::from(server))
                && entry["name"].as_str().map(plain_name).as_deref() == Some(name)
        })
        .collect();
    match matches.as_slice() {
        [] => Ok(None),
        [entry] => {
            let id = entry["characterId"]
                .as_str()
                .and_then(percent_decode)
                .filter(|id| valid_character_id(id))
                .ok_or_else(format)?;
            Ok(Some(id))
        }
        _ => Err(ProfileError::new(
            ErrorKind::Unavailable,
            "The official search lists this name twice on one server.",
        )),
    }
}

/// The official address behind an artwork key: `r.<file>.png` is a game-data resource,
/// `p.<server key>.<character key>` a character portrait. Anything else is refused.
pub fn art_url(key: &str) -> Option<String> {
    if let Some(file) = key.strip_prefix("r.") {
        let valid = file.len() <= 120
            && file.ends_with(".png")
            && file
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
            && !file.contains("..");
        return valid.then(|| format!("{RESOURCES}{file}"));
    }
    let (server, character) = key.strip_prefix("p.")?.split_once('.')?;
    let digits = |s: &str, max: usize| {
        !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit())
    };
    (digits(server, 6) && digits(character, 24))
        .then(|| format!("{PORTRAITS}?gameServerKey={server}&charKey={character}"))
}

fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Runs a blocking request off the async executor; errors reach the page as objects.
pub(crate) async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ProfileError> + Send + 'static,
) -> Result<T, Value> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| ProfileError::new(ErrorKind::Unavailable, e.to_string()).to_value())?
        .map_err(|e| e.to_value())
}

fn checked_id(character_id: &str) -> Result<String, ProfileError> {
    valid_character_id(character_id)
        .then(|| character_id.to_string())
        .ok_or_else(|| ProfileError::new(ErrorKind::Invalid, "Invalid character id."))
}

#[tauri::command]
pub async fn profile_character(
    app: AppHandle,
    server_id: u16,
    name: String,
    lang: String,
    refresh: Option<bool>,
) -> Result<Value, Value> {
    run(move || {
        let query = Query::new(server_id, &name, &lang)?;
        app.state::<ProfileApi>()
            .character(&query, refresh.unwrap_or(false))
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn profile_item(
    app: AppHandle,
    server_id: u16,
    name: String,
    lang: String,
    character_id: String,
    item_id: u64,
    slot_pos: u16,
    enchant_level: u16,
    refresh: Option<bool>,
) -> Result<Value, Value> {
    run(move || {
        if !(1..=99).contains(&slot_pos) || enchant_level > 40 || item_id == 0 {
            return Err(ProfileError::new(
                ErrorKind::Invalid,
                "Invalid item request.",
            ));
        }
        let request = ItemRequest {
            query: Query::new(server_id, &name, &lang)?,
            character_id: checked_id(&character_id)?,
            item_id,
            slot_pos,
            enchant_level,
            refresh: refresh.unwrap_or(false),
        };
        app.state::<ProfileApi>().item(&request)
    })
    .await
}

#[tauri::command]
pub async fn profile_board(
    app: AppHandle,
    server_id: u16,
    name: String,
    lang: String,
    character_id: String,
    board_id: u16,
    refresh: Option<bool>,
) -> Result<Value, Value> {
    run(move || {
        if !(1..=999).contains(&board_id) {
            return Err(ProfileError::new(ErrorKind::Invalid, "Invalid board."));
        }
        let request = BoardRequest {
            query: Query::new(server_id, &name, &lang)?,
            character_id: checked_id(&character_id)?,
            board_id,
            refresh: refresh.unwrap_or(false),
        };
        app.state::<ProfileApi>().board(&request)
    })
    .await
}

/// `profile-art://localhost/<key>`: official artwork through the bounded native client, so
/// the pages' content policy never has to trust a remote image host.
pub fn protocol(
    app: AppHandle,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let key = request
        .uri()
        .path()
        .strip_prefix('/')
        .and_then(percent_decode)
        .unwrap_or_default();
    let get = request.method() == tauri::http::Method::GET;
    tauri::async_runtime::spawn_blocking(move || {
        let art = if get {
            app.state::<ProfileApi>().artwork(&key)
        } else {
            Err("Invalid artwork request.".into())
        };
        let response = match art {
            Ok((kind, bytes)) => tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", kind)
                .header("Cache-Control", "public, max-age=86400")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes),
            Err(_) => tauri::http::Response::builder()
                .status(404)
                .header("Cache-Control", "no-store")
                .body(Vec::new()),
        };
        if let Ok(response) = response {
            responder.respond(response);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    const SEARCH_FIXTURE: &str = include_str!("../../fixtures/profile/search.json");
    const INFO_FIXTURE: &str = include_str!("../../fixtures/profile/info.json");
    const EQUIPMENT_FIXTURE: &str = include_str!("../../fixtures/profile/equipment.json");
    const ID: &str = "TdP6Luz0qAX4HHsk72ETnopWGMVw_LvgJUWeiZZtv4k=";

    /// Answers by URL fragment, in order of registration, and records every request.
    #[derive(Clone, Default)]
    struct Script {
        routes: Arc<Mutex<Vec<(String, Vec<(u16, Option<u64>, String)>)>>>,
        seen: Arc<Mutex<Vec<String>>>,
        calls: Arc<AtomicUsize>,
    }
    impl Script {
        fn on(self, fragment: &str, replies: Vec<(u16, Option<u64>, &str)>) -> Self {
            self.routes.lock().unwrap().push((
                fragment.into(),
                replies
                    .into_iter()
                    .map(|(s, r, b)| (s, r, b.to_string()))
                    .collect(),
            ));
            self
        }
        fn seen(&self) -> Vec<String> {
            self.seen.lock().unwrap().clone()
        }
    }
    impl Transport for Script {
        fn get(&self, url: &str, _: u64) -> Result<Reply, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.seen.lock().unwrap().push(url.to_string());
            let mut routes = self.routes.lock().unwrap();
            let (_, replies) = routes
                .iter_mut()
                .find(|(fragment, _)| url.contains(fragment.as_str()))
                .ok_or_else(|| format!("unscripted {url}"))?;
            let (status, retry_after, body) = if replies.len() > 1 {
                replies.remove(0)
            } else {
                replies[0].clone()
            };
            Ok(Reply {
                status,
                retry_after,
                body: body.into_bytes(),
            })
        }
    }

    fn fixture_api() -> (ProfileApi, Script) {
        let script = Script::default()
            .on("api-search", vec![(200, None, SEARCH_FIXTURE)])
            .on("/info?", vec![(200, None, INFO_FIXTURE)])
            .on("/equipment?", vec![(200, None, EQUIPMENT_FIXTURE)]);
        (ProfileApi::with_transport(script.clone()), script)
    }

    fn query() -> Query {
        Query::new(2403, "foxyyyynm", "en-US").unwrap()
    }

    #[test]
    fn the_exact_name_and_server_win_over_similar_search_results() {
        let search: Value = serde_json::from_str(SEARCH_FIXTURE).unwrap();
        // The official search lists foxyyyynm, foxyyyynmT and foxyyyynmG, all highlighted.
        assert_eq!(
            exact_match(&search, "foxyyyynm", 2403).unwrap().as_deref(),
            Some(ID)
        );
        assert_eq!(
            exact_match(&search, "foxyyyynmT", 2403).unwrap().as_deref(),
            Some("TdP6Luz0qAX4HHsk72ETnuXbB8eectQsqMgvvrtyu-8=")
        );
        assert_eq!(exact_match(&search, "foxyyyy", 2403).unwrap(), None);
        assert_eq!(exact_match(&search, "foxyyyynm", 2404).unwrap(), None);
        assert_eq!(exact_match(&search, "FOXYYYYNM", 2403).unwrap(), None);
    }

    #[test]
    fn only_the_looked_up_characters_own_sheet_names_its_server() {
        let (api, _) = fixture_api();
        assert_eq!(api.server_name(2403), None);
        api.character(&query(), false).unwrap();
        assert_eq!(api.server_name(2403).as_deref(), Some("Triniel"));
        // A sheet for another server or another name never names this one.
        let other = ProfileApi::default();
        let info: Value = serde_json::from_str(INFO_FIXTURE).unwrap();
        other.remember_server_name(&Query::new(2404, "foxyyyynm", "en-US").unwrap(), &info);
        other.remember_server_name(&Query::new(2403, "foxyyyynmT", "en-US").unwrap(), &info);
        assert_eq!(other.server_name(2403), None);
        assert_eq!(other.server_name(2404), None);
    }

    #[test]
    fn a_name_listed_twice_on_one_server_is_refused_rather_than_guessed() {
        let entry =
            json!({"characterId":"AAAAAAAAAAA%3D","name":"<strong>Ab</strong>","serverId":1304});
        let twice = json!({"list":[entry.clone(), entry]});
        assert_eq!(
            exact_match(&twice, "Ab", 1304).unwrap_err().kind,
            ErrorKind::Unavailable
        );
        assert!(exact_match(&json!({"items":[]}), "Ab", 1304).is_err());
    }

    #[test]
    fn highlight_tags_and_entities_are_stripped_from_names() {
        assert_eq!(plain_name("<strong>foxy</strong>T"), "foxyT");
        assert_eq!(plain_name("<b>A</b>&amp;<i>b</i>"), "A&b");
        assert_eq!(plain_name("&lt;strong&gt;"), "<strong>");
    }

    #[test]
    fn the_character_id_is_decoded_once_and_query_encoded_once() {
        let (api, script) = fixture_api();
        let sheet = api.character(&query(), false).unwrap();
        assert_eq!(sheet["identity"]["character_id"], ID);
        assert_eq!(sheet["identity"]["region"], "la");
        let seen = script.seen();
        assert!(seen[0].starts_with(
            "https://api-search.plaync.com/aion2global/search/v2/character?keyword=foxyyyynm&page=1&size=20&localeInfo=en-US&region=la&serverId=2403"
        ));
        for url in &seen[1..] {
            assert!(
                url.contains("characterId=TdP6Luz0qAX4HHsk72ETnopWGMVw_LvgJUWeiZZtv4k%3D&"),
                "{url}"
            );
            assert!(!url.contains("%253D"), "{url}");
        }
        assert!(seen.contains(&format!(
            "{CHARACTER}/info?lang=en-US&characterId=TdP6Luz0qAX4HHsk72ETnopWGMVw_LvgJUWeiZZtv4k%3D&serverId=2403&region=la"
        )));
        assert_eq!(sheet["info"]["profile"]["characterName"], "foxyyyynm");
        assert_eq!(sheet["equipment"]["petwing"]["pet"]["level"], 3);
        assert!(sheet["info_error"].is_null() && sheet["equipment_error"].is_null());
    }

    #[test]
    fn item_details_ask_for_the_slot_and_enchant_plus_breakthrough() {
        let (api, script) = fixture_api();
        let script = script.on("/equipment/item?", vec![(200, None, "{\"id\":110830050}")]);
        // Equipped: enchant 15 with breakthrough 2 in the main hand.
        api.item(&ItemRequest {
            query: query(),
            character_id: ID.into(),
            item_id: 110830050,
            slot_pos: 1,
            enchant_level: 15 + 2,
            refresh: false,
        })
        .unwrap();
        assert!(script
            .seen()
            .last()
            .unwrap()
            .ends_with("region=la&id=110830050&enchantLevel=17&slotPos=1"));
    }

    #[test]
    fn every_profile_read_goes_only_to_the_official_hosts() {
        let (api, script) = fixture_api();
        let script = script
            .on("/equipment/item?", vec![(200, None, "{\"id\":110830050}")])
            .on("/daevanion/detail?", vec![(200, None, "{\"nodeList\":[]}")]);
        api.character(&query(), false).unwrap();
        api.item(&ItemRequest {
            query: query(),
            character_id: ID.into(),
            item_id: 110830050,
            slot_pos: 1,
            enchant_level: 17,
            refresh: false,
        })
        .unwrap();
        api.board(&BoardRequest {
            query: query(),
            character_id: ID.into(),
            board_id: 81,
            refresh: false,
        })
        .unwrap();
        let seen = script.seen();
        assert_eq!(seen.len(), 5, "{seen:?}");
        for url in &seen {
            assert!(official_data_url(url), "{url}");
            assert!(
                url.starts_with(SEARCH) || url.starts_with(&format!("{CHARACTER}/")),
                "{url}"
            );
        }
    }

    #[test]
    fn any_other_address_is_refused_before_the_network() {
        let (api, script) = fixture_api();
        let script = script.on("", vec![(200, None, "{}")]);
        for url in [
            "https://shugo.gg/data/skills/chanter.json",
            "https://shugo.gg/data/i18n/pt-BR/skills/chanter.json",
            "http://aion2.plaync.com/api/character/info",
            "https://aion2.plaync.com:8443/api/character/info",
            "https://user@aion2.plaync.com/api/character/info",
            "https://aion2.plaync.com.evil.example/api/character/info",
            "https://evil.example/?aion2.plaync.com",
            "https://assets.playnccdn.com/static-aion2-gamedata/resources/x.png",
            "not a url",
        ] {
            let error = api.get_json(url).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Invalid, "{url}");
        }
        assert_eq!(script.calls.load(Ordering::SeqCst), 0);
        assert!(official_data_url(&format!("{CHARACTER}/info?lang=en-US")));
        assert!(official_data_url(SEARCH));
    }

    #[test]
    fn answers_are_cached_per_identity_until_refreshed() {
        let (api, script) = fixture_api();
        api.character(&query(), false).unwrap();
        let first = script.calls.load(Ordering::SeqCst);
        assert_eq!(first, 3);
        let again = api.character(&query(), false).unwrap();
        assert_eq!(script.calls.load(Ordering::SeqCst), first);
        assert_eq!(again["cached"], true);
        // Another language is another request.
        api.character(&Query::new(2403, "foxyyyynm", "pt-BR").unwrap(), false)
            .unwrap();
        assert_eq!(script.calls.load(Ordering::SeqCst), first + 3);
        let fresh = api.character(&query(), true).unwrap();
        assert_eq!(script.calls.load(Ordering::SeqCst), first + 6);
        assert_eq!(fresh["cached"], false);
    }

    #[test]
    fn the_cache_stays_bounded() {
        let mut cache = Cache::default();
        let now = Instant::now();
        for i in 0..(MAX_CACHED + 20) {
            cache.put(
                format!("k{i}"),
                Freshness::Detail,
                json!(i),
                now + Duration::from_millis(i as u64),
            );
        }
        assert_eq!(cache.0.len(), MAX_CACHED);
        assert!(cache.get("k0", now).is_none());
        assert!(cache.get(&format!("k{}", MAX_CACHED + 19), now).is_some());
        assert!(cache.get("k50", now + Duration::from_secs(3600)).is_none());
    }

    #[test]
    fn private_missing_and_failed_answers_are_told_apart() {
        for (status, kind) in [
            (451, ErrorKind::Private),
            (404, ErrorKind::NotFound),
            (500, ErrorKind::Unavailable),
            (302, ErrorKind::Unavailable),
        ] {
            let script = Script::default().on("api-search", vec![(status, None, "")]);
            let error = ProfileApi::with_transport(script)
                .character(&query(), false)
                .unwrap_err();
            assert_eq!(error.kind, kind, "{status}");
        }
        let html = Script::default().on("api-search", vec![(200, None, "<!DOCTYPE html>")]);
        assert_eq!(
            ProfileApi::with_transport(html)
                .character(&query(), false)
                .unwrap_err()
                .kind,
            ErrorKind::Unavailable
        );
        assert!(ProfileApi::with_transport(
            Script::default().on("api-search", vec![(200, None, SEARCH_FIXTURE)])
        )
        .character(&Query::new(2403, "nobody", "en-US").unwrap(), false)
        .is_err_and(|e| e.kind == ErrorKind::NotFound));
    }

    #[test]
    fn one_failed_half_of_the_sheet_is_reported_beside_the_other() {
        let script = Script::default()
            .on("api-search", vec![(200, None, SEARCH_FIXTURE)])
            .on("/info?", vec![(200, None, INFO_FIXTURE)])
            .on("/equipment?", vec![(503, None, "")]);
        let sheet = ProfileApi::with_transport(script)
            .character(&query(), false)
            .unwrap();
        assert_eq!(sheet["info"]["profile"]["className"], "Chanter");
        assert!(sheet["equipment"].is_null());
        assert_eq!(sheet["equipment_error"]["kind"], "unavailable");
    }

    #[test]
    fn a_short_429_is_waited_out_once_and_a_long_one_blocks_further_requests() {
        let script = Script::default()
            .on(
                "api-search",
                vec![(429, Some(1), ""), (200, None, SEARCH_FIXTURE)],
            )
            .on("/info?", vec![(200, None, INFO_FIXTURE)])
            .on("/equipment?", vec![(200, None, EQUIPMENT_FIXTURE)]);
        let api = ProfileApi::with_transport(script.clone());
        assert!(api.character(&query(), false).is_ok());
        assert_eq!(script.calls.load(Ordering::SeqCst), 4);

        let script = Script::default().on("api-search", vec![(429, Some(120), "")]);
        let api = ProfileApi::with_transport(script.clone());
        let error = api.character(&query(), false).unwrap_err();
        assert_eq!(error.kind, ErrorKind::RateLimited);
        assert_eq!(error.retry_after_s, Some(120));
        // Refused here without asking the service again while the back-off lasts.
        let again = api.character(&query(), true).unwrap_err();
        assert_eq!(again.kind, ErrorKind::RateLimited);
        assert!(again.retry_after_s.unwrap() <= 120);
        assert_eq!(script.calls.load(Ordering::SeqCst), 1);
        assert_eq!(error.to_value()["kind"], "rate_limited");
    }

    #[test]
    fn lookups_need_a_global_server_an_observed_name_and_a_published_language() {
        assert_eq!(query().region, "la");
        assert_eq!(Query::new(1304, "Aahz", "pt-BR").unwrap().region, "eu");
        assert_eq!(Query::new(2101, "Aahz", "en-US").unwrap().region, "nae");
        for id in [1001, 2021, 1601, 999] {
            assert!(Query::new(id, "Aahz", "en-US").is_err(), "{id}");
        }
        for name in ["", "Player #12", "a/b", "two words"] {
            assert!(Query::new(1304, name, "en-US").is_err(), "{name:?}");
        }
        assert!(Query::new(1304, "Aahz", "xx-YY").is_err());
        assert!(valid_character_id(ID));
        for id in [
            "short",
            "has space AAAAAAAA",
            "TdP6%3D_AAAAAAAAAA",
            &"A".repeat(129),
        ] {
            assert!(!valid_character_id(id), "{id}");
        }
        assert_eq!(percent_decode("a%3D%3d").as_deref(), Some("a=="));
        assert!(percent_decode("a%3").is_none());
        assert!(percent_decode("%FF").is_none());
    }

    #[test]
    fn artwork_keys_map_only_to_official_files() {
        assert_eq!(
            art_url("r.Icon_WP_ST_0028_T05.png").as_deref(),
            Some("https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_WP_ST_0028_T05.png")
        );
        assert_eq!(
            art_url("p.2403.676384369036038819").as_deref(),
            Some("https://profileimg.plaync.com/game_profile_images/aion2global/images?gameServerKey=2403&charKey=676384369036038819")
        );
        for key in [
            "r.../x.png",
            "r.a/b.png",
            "r.x.svg",
            "r.x.png?y=1",
            "p.2403",
            "p.24a.1",
            "https://evil.example/x.png",
            "x.png",
        ] {
            assert!(art_url(key).is_none(), "{key}");
        }
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_kind(b"<?xml"), None);
    }

    #[test]
    fn the_artwork_cache_stays_within_its_byte_budget() {
        let mut art = ArtCache::default();
        for i in 0..40 {
            art.put(format!("r.{i}.png"), "image/png", vec![0; 1_000_000]);
        }
        assert!(art.bytes <= MAX_ART_BYTES);
        assert_eq!(
            art.bytes,
            art.entries.values().map(|e| e.2.len()).sum::<usize>()
        );
        assert!(art.get("r.39.png").is_some());
    }

    #[test]
    #[ignore = "explicit public-network integration check"]
    fn the_public_official_profile_can_be_read_directly() {
        let api = ProfileApi::default();
        let sheet = api.character(&query(), true).unwrap();
        assert_eq!(sheet["info"]["profile"]["serverName"], "Triniel");
        let boards = sheet["info"]["daevanion"]["boardList"].as_array().unwrap();
        assert_eq!(boards.len(), 6);
    }
}
