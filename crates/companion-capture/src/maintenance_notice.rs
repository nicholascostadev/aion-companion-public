//! Conservative parsing of the official English announcement table, not live health.
use crate::server_status::Maintenance;
use chrono::{FixedOffset, NaiveDateTime, TimeZone};
use serde_json::Value;

pub fn candidates(list: &Value) -> Result<Vec<String>, String> {
    let rows = list["contentList"]
        .as_array()
        .ok_or("Official notice list format changed")?;
    if rows.len() > 100 {
        return Err("Official notice list exceeds limits".into());
    }
    let mut rows: Vec<_> = rows
        .iter()
        .filter(|row| {
            row["title"]
                .as_str()
                .is_some_and(|s| s.to_ascii_lowercase().contains("maintenance"))
        })
        .collect();
    rows.sort_by(|a, b| {
        b["timestamps"]["postedAt"]
            .as_str()
            .cmp(&a["timestamps"]["postedAt"].as_str())
    });
    rows.into_iter()
        .take(6)
        .map(|row| {
            row["id"]
                .as_str()
                .filter(|id| valid_id(id))
                .map(str::to_owned)
                .ok_or_else(|| "Invalid official notice ID".into())
        })
        .collect()
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 24 && id.bytes().all(|c| c.is_ascii_hexdigit())
}

/// None is a notice explicitly affecting another service. Unrecognized game
/// maintenance fails the refresh instead of falling back to an older schedule.
pub fn parse(value: &Value) -> Result<Option<Maintenance>, String> {
    let meta = &value["article"]["contentMeta"];
    let id = meta["id"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or("Invalid official notice ID")?;
    let title = meta["title"]
        .as_str()
        .filter(|s| s.len() <= 500)
        .ok_or("Missing official notice title")?;
    let html = value["article"]["content"]["content"]
        .as_str()
        .filter(|s| s.len() <= 1_000_000)
        .ok_or("Missing official notice body")?;
    let lower_title = title.to_ascii_lowercase();
    if lower_title.contains("cancelled") || lower_title.contains("canceled") {
        return Err("The latest maintenance notice was canceled".into());
    }
    let rows: Vec<_> = html
        .split("<tr")
        .skip(1)
        .filter_map(|row| {
            let (head, _) = row.split_once("</tr>")?;
            let label = cell(head, "th").or_else(|| cell(head, "td"))?;
            let body = if head.contains("<th") {
                cell(head, "td")?
            } else {
                let (_, remaining) = head.split_once("</td>")?;
                cell(remaining, "td")?
            };
            Some((label.trim_matches('\u{200b}').to_ascii_lowercase(), body))
        })
        .collect();
    for key in ["when:", "duration:", "affected services:"] {
        if rows.iter().filter(|(label, _)| label == key).count() > 1 {
            return Err("Ambiguous maintenance tables".into());
        }
    }
    let services = rows
        .iter()
        .find(|(k, _)| k == "affected services:")
        .map(|(_, v)| v.to_ascii_lowercase());
    match services.as_deref() {
        Some("game servers" | "all services") => {}
        Some("account registration") => return Ok(None),
        Some(_) => return Err("Unrecognized maintenance service scope".into()),
        None => return Err("Unrecognized maintenance service scope".into()),
    }
    if rows
        .iter()
        .any(|(k, _)| k.starts_with("duration (") || k.starts_with("when ("))
    {
        return Err("Regional maintenance windows are not supported by this notice format".into());
    }
    let when = rows
        .iter()
        .find(|(k, _)| k == "when:")
        .map(|(_, v)| v)
        .ok_or("Missing maintenance start")?;
    let mut dates = when.split('/').map(parse_date);
    let starts_ms = dates
        .next()
        .flatten()
        .ok_or("Unrecognized maintenance date")?;
    if dates.any(|at| at != Some(starts_ms)) {
        return Err("Maintenance timezone dates disagree".into());
    }
    let duration = rows
        .iter()
        .find(|(k, _)| k == "duration:")
        .and_then(|(_, v)| parse_duration(v))
        .ok_or("Unrecognized maintenance duration")?;
    let text = plain(html).to_ascii_lowercase();
    let completed = lower_title.contains("(completed)")
        || text.contains("maintenance is complete and servers are back online")
        || text.contains("all servers are now back online");
    Ok(Some(Maintenance {
        title: title.into(),
        url: format!("https://aion2.plaync.com/en-us/board/notice/view?articleId={id}"),
        starts_ms,
        ends_ms: starts_ms
            .checked_add(duration)
            .ok_or("Maintenance date overflow")?,
        completed,
    }))
}

fn cell(html: &str, tag: &str) -> Option<String> {
    let (_, remaining) = html.split_once(&format!("<{tag}"))?;
    let (_, content) = remaining.split_once('>')?;
    let (content, _) = content.split_once(&format!("</{tag}>"))?;
    Some(plain(content))
}

fn plain(html: &str) -> String {
    let mut inside = false;
    let mut out = String::new();
    for c in html.chars() {
        match c {
            '<' => {
                inside = true;
                out.push(' ');
            }
            '>' => inside = false,
            _ if !inside => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace('\u{200b}', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_date(date: &str) -> Option<u64> {
    let (date, tz) = date.trim().rsplit_once(' ')?;
    let offset = match tz {
        "PDT" => -7,
        "PST" => -8,
        "CEST" => 2,
        "CET" => 1,
        "UTC" => 0,
        _ => return None,
    };
    let (day, time) = date.split_once(" at ")?;
    let date = NaiveDateTime::parse_from_str(
        &format!("{day} at {}", time.replace('h', ":")),
        "%B %e, %Y at %H:%M",
    )
    .ok()?;
    let time = FixedOffset::east_opt(offset * 3600)?
        .from_local_datetime(&date)
        .single()?
        .timestamp_millis();
    u64::try_from(time).ok()
}

fn parse_duration(duration: &str) -> Option<u64> {
    let duration = duration
        .to_ascii_lowercase()
        .replace("hours", "h")
        .replace("hour", "h")
        .replace("minutes", "m")
        .replace("minute", "m")
        .replace("min.", "m")
        .replace("min", "m")
        .replace(' ', "");
    let (hours, minutes) = if let Some((hours, rest)) = duration.split_once('h') {
        (
            hours.parse::<f64>().ok()?,
            if rest.is_empty() {
                0.
            } else {
                rest.strip_suffix('m')?.parse::<f64>().ok()?
            },
        )
    } else {
        (0., duration.strip_suffix('m')?.parse::<f64>().ok()?)
    };
    let millis = (hours * 60. + minutes) * 60000.;
    (hours >= 0.
        && (0. ..60.).contains(&minutes)
        && millis.is_finite()
        && (60_000. ..=86_400_000.).contains(&millis))
    .then_some(millis.round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }
    #[test]
    fn official_current_and_completed_notices_have_utc_windows() {
        let current = parse(&fixture(include_str!(
            "../data/server-status-maintenance.json"
        )))
        .unwrap()
        .unwrap();
        assert_eq!(current.starts_ms, 1792564200000);
        assert_eq!(current.ends_ms - current.starts_ms, 19_800_000);
        assert!(!current.completed);
        let completed = parse(&fixture(include_str!(
            "../data/server-status-completed.json"
        )))
        .unwrap()
        .unwrap();
        assert!(completed.completed);
        assert_eq!(completed.ends_ms - completed.starts_ms, 14_400_000);
    }
    #[test]
    fn platform_and_unsupported_regional_notices_cannot_suppress_game() {
        assert!(parse(&fixture(include_str!(
            "../data/server-status-platform.json"
        )))
        .unwrap()
        .is_none());
        assert!(parse(&fixture(include_str!(
            "../data/server-status-regional.json"
        )))
        .is_err());
        assert!(parse(&serde_json::json!({})).is_err());
        let mut canceled = fixture(include_str!("../data/server-status-maintenance.json"));
        canceled["article"]["contentMeta"]["title"] = serde_json::json!("Maintenance (Cancelled)");
        assert!(parse(&canceled).is_err());
        assert!(parse_duration("until done").is_none());
        assert_eq!(parse_duration("3 hours 30min."), Some(12_600_000));
        assert_eq!(
            parse_date("October 20, 2026 at 23h30 PDT"),
            parse_date("October 21, 2026 at 08h30 CEST")
        );
        assert!(parse_date("October 21 at 08h30 CEST").is_none());
        assert!(parse_date("March 21, 2026 at 08h30 CET").is_some());
    }
    #[test]
    fn notice_list_is_bounded_sorted_and_validated() {
        let list = serde_json::json!({"contentList":[{"id":"6ace8dc0263e537d356d10c3","title":"Maintenance (Completed)","timestamps":{"postedAt":"2026-10-13"}},{"id":"6ad7900028c7452635072c01","title":"Maintenance","timestamps":{"postedAt":"2026-10-20"}},{"id":"bad","title":"Event"}]});
        assert_eq!(candidates(&list).unwrap()[0], "6ad7900028c7452635072c01");
        assert!(candidates(&serde_json::json!({})).is_err());
    }
}
