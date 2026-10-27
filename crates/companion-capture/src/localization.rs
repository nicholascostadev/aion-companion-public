//! Small native presentation catalog shared with the frontend. It deliberately
//! supports only plain text and named scalar placeholders, not a second plural engine.
use serde_json::Value;
use std::sync::OnceLock;

pub fn resolve_locale(locale: &str) -> &'static str {
    match locale {
        "pt" | "pt-BR" => "pt-BR",
        _ => "en",
    }
}

fn catalog(locale: &str) -> &'static Value {
    static EN: OnceLock<Value> = OnceLock::new();
    static PT: OnceLock<Value> = OnceLock::new();
    if resolve_locale(locale) == "pt-BR" {
        PT.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../frontend/src/i18n/locales/pt-BR/native.json"
            ))
            .expect("Valid embedded Brazilian Portuguese native catalog")
        })
    } else {
        EN.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../frontend/src/i18n/locales/en/native.json"
            ))
            .expect("Valid embedded English native catalog")
        })
    }
}

pub fn text<'a>(locale: &str, key: &'a str) -> &'a str {
    catalog(locale)[key]
        .as_str()
        .or_else(|| catalog("en")[key].as_str())
        .unwrap_or(key)
}

/// One pass: user names containing placeholder syntax are always kept verbatim.
pub fn render(locale: &str, key: &str, values: &[(&str, String)]) -> String {
    let mut rest = text(locale, key);
    let mut result = String::new();
    while let Some(start) = rest.find("{{") {
        result.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            result.push_str(&rest[start..]);
            return result;
        };
        let name = &after[..end];
        if let Some((_, value)) = values.iter().find(|(key, _)| *key == name) {
            result.push_str(value);
        } else {
            result.push_str(&rest[start..start + 2 + end + 2]);
        }
        rest = &after[end + 2..];
    }
    result.push_str(rest);
    result
}

/// Human-readable native summary figures only. Never used for serialization.
pub fn number(locale: &str, value: f64, digits: usize) -> String {
    if !value.is_finite() {
        return "—".into();
    }
    let brazilian = resolve_locale(locale) == "pt-BR";
    let raw = format!("{:.*}", digits, value);
    let (integer, fraction) = raw.split_once('.').unwrap_or((&raw, ""));
    let (sign, integer) = integer
        .strip_prefix('-')
        .map_or(("", integer), |n| ("-", n));
    let mut result = String::from(sign);
    for (index, digit) in integer.chars().enumerate() {
        if index > 0 && (integer.len() - index) % 3 == 0 {
            result.push(if brazilian { '.' } else { ',' });
        }
        result.push(digit);
    }
    if digits > 0 {
        result.push(if brazilian { ',' } else { '.' });
        result.push_str(fraction);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_portuguese_resolves_to_brazilian_and_other_locales_fall_back() {
        for locale in ["pt", "pt-BR"] {
            assert_eq!(resolve_locale(locale), "pt-BR");
            assert_eq!(text(locale, "trayQuit"), "Sair do Aion Companion");
        }
        for locale in ["", "en", "de", "pt-PT", "invalid"] {
            assert_eq!(resolve_locale(locale), "en");
        }
    }

    #[test]
    fn embedded_catalogs_have_identical_nonempty_keys_and_placeholders() {
        let en = catalog("en").as_object().unwrap();
        let pt = catalog("pt-BR").as_object().unwrap();
        assert_eq!(en.keys().collect::<Vec<_>>(), pt.keys().collect::<Vec<_>>());
        for (key, value) in en {
            let english = value.as_str().unwrap();
            let portuguese = pt[key].as_str().unwrap();
            assert!(!english.trim().is_empty() && !portuguese.trim().is_empty());
            let tokens = |s: &str| {
                let mut tokens = s
                    .split("{{")
                    .skip(1)
                    .map(|v| v.split_once("}}").unwrap().0.to_owned())
                    .collect::<Vec<_>>();
                tokens.sort();
                tokens
            };
            assert_eq!(tokens(english), tokens(portuguese), "{key}");
        }
    }

    #[test]
    fn user_text_is_not_interpreted_as_another_placeholder() {
        let rendered = render(
            "pt-BR",
            "summaryRow",
            &[
                ("rank", "1".into()),
                ("name", "<Player {{damage}}>".into()),
                ("dps", "1.234".into()),
                ("damage", "9.876".into()),
                ("share", "42,5".into()),
            ],
        );
        assert_eq!(
            rendered,
            "1. <Player {{damage}}>: 1.234 DPS, 9.876 de dano (42,5%)"
        );
    }

    #[test]
    fn native_summary_numbers_use_explicit_locale_and_precision() {
        assert_eq!(number("en", 12345.25, 1), "12,345.2");
        assert_eq!(number("pt-BR", 12345.25, 1), "12.345,2");
        assert_eq!(number("pt", -1234.5, 1), "-1.234,5");
        assert_eq!(number("en", 0., 0), "0");
        assert_eq!(number("pt-BR", f64::NAN, 1), "—");
    }
}
