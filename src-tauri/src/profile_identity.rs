//! Which observed characters NCSOFT's official AION 2 Global character service can look up,
//! and the `region` code each request names. Owned here so the profile client depends on no
//! external-link module.
//!
//! The region codes are the official character page's own region list
//! (`aion2.plaync.com/en-us/characters`, bundle `characters/js/index.js`, inspected
//! 2026-11-04): `nae`, `naw`, `eu`, `la`, `as`. A Global server id is
//! `[faction][sub-region][index]`, faction 1 Elyos or 2 Asmodian, and the sub-region digit
//! 1–5 picks those codes in that order; the official search answers `region: "la"` for
//! server 2403 (`fixtures/profile/search.json`). Korean and Taiwanese ids (`10xx`, `20xx`)
//! cannot tell those two regions apart, so they get no profile.

const REGIONS: [&str; 5] = ["nae", "naw", "eu", "la", "as"];

/// The official `region` parameter of a Global server id, or None outside the Global range.
pub(crate) fn region(id: u16) -> Option<&'static str> {
    let faction = id / 1000;
    let sub_region = (id / 100) % 10;
    ((1..=2).contains(&faction) && (1..=5).contains(&sub_region))
        .then(|| REGIONS[usize::from(sub_region - 1)])
}

/// A character name as the game shows it: no separators, controls or URL syntax, so a
/// placeholder such as `Player #12` is refused rather than looked up.
pub(crate) fn valid_name(name: &str) -> bool {
    let length = name.chars().count();
    (1..=32).contains(&length)
        && name
            .chars()
            .all(|c| !c.is_control() && !c.is_whitespace() && !"/\\?#%&+".contains(c))
}

/// Percent-encodes everything but unreserved characters: one URL query component or path
/// segment.
pub(crate) fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// A server name as an official answer gives it, kept only when it is plain display text.
pub(crate) fn server_name(name: &str) -> Option<String> {
    let name = name.trim();
    ((1..=32).contains(&name.chars().count()) && !name.chars().any(char::is_control))
        .then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_ids_name_the_official_region_and_regional_ids_none() {
        assert_eq!(region(2403), Some("la"));
        assert_eq!(region(1101), Some("nae"));
        assert_eq!(region(2205), Some("naw"));
        assert_eq!(region(1304), Some("eu"));
        assert_eq!(region(2518), Some("as"));
        for id in [1001, 2021, 1601, 3001, 999, 0] {
            assert_eq!(region(id), None, "{id}");
        }
    }

    #[test]
    fn official_server_names_must_be_plain_text() {
        assert_eq!(server_name(" Triniel ").as_deref(), Some("Triniel"));
        assert_eq!(server_name(""), None);
        assert_eq!(server_name("a\nb"), None);
        assert_eq!(server_name(&"x".repeat(33)), None);
    }
}
