//! Opens one character's public Shugo.gg profile. The address is always built here from an
//! observed Global server id and character name; no caller-supplied URL is ever opened.
//!
//! Shugo's profile route is `/character/global/<sub-region>-<server>/<name>` (see
//! `docs/SHUGO_PROFILES.md`). Global ids are `[faction][sub-region][index]`: faction 1 Elyos or
//! 2 Asmodian, sub-region 1 NA East, 2 NA West, 3 EU, 4 South America, 5 Asia. Korean and
//! Taiwanese ids (`10xx`, `20xx`) cannot tell those two regions apart, so they get no link.
//! The server table below only builds Shugo's URL slugs; the profile window never shows it.
use crate::profile_identity::{encode, region, valid_name};

/// Server names in index order; every sub-region uses a prefix of these lists.
const ELYOS: [&str; 23] = [
    "Siel", "Nezekan", "Vaizel", "Kaisinel", "Yustiel", "Ariel", "Fregion", "Meslamtaeda",
    "Hithanya", "Nania", "Tahavatha", "Luteros", "Phernos", "Daminu", "Kasaka", "Bakarma",
    "Tsenka", "Kochi", "Ishtar", "Tiamat", "Gauss", "Lamuatan", "Nathara",
];
const ASMODIAN: [&str; 23] = [
    "Israphel", "Zikel", "Triniel", "Lumiel", "Marchutan", "Azphel", "Ereshkigal", "Beritra",
    "Nemon", "Hadala", "Ludra", "Ulgorn", "Munin", "Odar", "Zemurru", "Kromede", "Quai", "Baba",
    "Fafnir", "Indnath", "Agnita", "Atiel", "Tassin",
];
/// How many servers per faction Shugo names in each sub-region (digits 1–5).
const SUB_REGION_SERVERS: [u16; 5] = [10, 5, 23, 6, 18];

/// The name Shugo's slug uses for a Global server, such as `Triniel` for 2403.
fn server_name(id: u16) -> Option<&'static str> {
    region(id)?;
    let faction = id / 1000;
    let count = SUB_REGION_SERVERS[usize::from((id / 100) % 10 - 1)];
    let index = id % 100;
    if !(1..=count).contains(&index) {
        return None;
    }
    let names = if faction == 1 { &ELYOS } else { &ASMODIAN };
    Some(names[usize::from(index - 1)])
}

/// Shugo's server segment: its named slug, or the bare id (which Shugo also resolves) for a
/// Global server it does not name yet. None outside the Global id range.
fn server_slug(id: u16) -> Option<String> {
    let code = region(id)?;
    Some(server_name(id).map_or_else(
        || id.to_string(),
        |name| format!("{code}-{}", name.to_lowercase()),
    ))
}

fn profile_url(server_id: u16, name: &str) -> Result<String, String> {
    let server = server_slug(server_id)
        .ok_or("Shugo.gg profiles are only linked for Global servers.")?;
    if !valid_name(name) {
        return Err("This character has no observed name to look up.".into());
    }
    Ok(format!("https://shugo.gg/character/global/{server}/{}", encode(name)))
}

#[tauri::command]
pub fn shugo_open_profile(server_id: u16, name: String) -> Result<(), String> {
    crate::setup::open_in_browser(&profile_url(server_id, &name)?)
}

/// Copies one character's Shugo.gg profile address with the native clipboard and returns
/// it. Refused while character names are hidden, since the address names the character.
#[tauri::command]
pub async fn shugo_copy_profile_link(
    app: tauri::AppHandle,
    server_id: u16,
    name: String,
) -> Result<String, String> {
    let url = profile_url(server_id, &name)?;
    crate::background::run(move || {
        if crate::profile_window::hide_names(&app) {
            return Err("Character names are hidden, so profile links are too.".into());
        }
        crate::offline::clipboard(&app, &url)?;
        Ok(url)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_servers_use_shugos_sub_region_slugs() {
        assert_eq!(
            profile_url(1304, "Aahz").unwrap(),
            "https://shugo.gg/character/global/eu-kaisinel/Aahz"
        );
        assert_eq!(server_slug(1101).unwrap(), "nae-siel");
        assert_eq!(server_slug(2205).unwrap(), "naw-marchutan");
        assert_eq!(server_slug(2320).unwrap(), "eu-indnath");
        assert_eq!(server_slug(1406).unwrap(), "la-ariel");
        assert_eq!(server_slug(2518).unwrap(), "as-baba");
        // The same server name in another sub-region is another server.
        assert_ne!(server_slug(2101), server_slug(2301));
    }

    #[test]
    fn exactly_shugos_named_global_servers_get_a_slug() {
        let named = (1000..3000).filter_map(server_slug).filter(|s| s.contains('-')).count();
        assert_eq!(named, 124);
        // A Global id Shugo names no slug for stays a bare id, which its router accepts.
        assert_eq!(server_slug(1206).unwrap(), "1206");
        assert_eq!(server_slug(1300).unwrap(), "1300");
    }

    #[test]
    fn global_servers_are_named_and_unnamed_ids_are_not() {
        assert_eq!(server_name(2403), Some("Triniel"));
        assert_eq!(server_name(1304), Some("Kaisinel"));
        assert_eq!(server_name(1206), None);
        assert_eq!(server_name(1001), None);
    }

    #[test]
    fn regional_ids_and_unobserved_names_never_build_a_link() {
        for id in [1001, 2021, 1601, 3001, 999] {
            assert!(profile_url(id, "Aahz").is_err(), "{id}");
        }
        for name in ["", "Player #12", "a/b", "../x", "x?y=1", "two words", "tab\t", &"x".repeat(33)] {
            assert!(profile_url(1304, name).is_err(), "{name:?}");
        }
    }

    #[test]
    fn names_are_percent_encoded_as_one_path_segment() {
        assert_eq!(
            profile_url(1501, "슉").unwrap(),
            "https://shugo.gg/character/global/as-siel/%EC%8A%89"
        );
        assert_eq!(
            profile_url(2304, "Ä'x.").unwrap(),
            "https://shugo.gg/character/global/eu-lumiel/%C3%84%27x."
        );
    }
}
