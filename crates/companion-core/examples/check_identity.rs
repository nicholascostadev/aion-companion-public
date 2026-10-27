//! Decode a local hex protocol body for identity/roster diagnostics without game interaction.
use companion_core::wire::entities::Entities;
fn main() -> Result<(), String> {
    let path = std::env::args().nth(1).ok_or("Provide a hex protocol body file")?;
    let text = std::fs::read_to_string(path).map_err(|e|e.to_string())?;
    let text = text.trim();
    if text.len() > 128 * 1024 || text.len() % 2 != 0 {return Err("Invalid hex body size".into());}
    let bytes: Result<Vec<_>, _> = text.as_bytes().chunks_exact(2).map(|pair|
        std::str::from_utf8(pair).map_err(|e|e.to_string()).and_then(|pair|
            u8::from_str_radix(pair,16).map_err(|e|e.to_string()))).collect();
    let mut entities = Entities::default();
    entities.observe(&bytes?).map_err(|_| "Invalid protocol body")?;
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({
        "local":entities.local,"names":entities.name_bindings(),"party_id":entities.party_id,
        "capacity":entities.capacity,"members":entities.group_members(),
        "roster_seen":entities.roster_seen,"unsupported":entities.unparsed_roster.is_some()
    })).map_err(|e|e.to_string())?);
    Ok(())
}
