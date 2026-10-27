//! The collector retains only the metadata it uses. The complete bundled document is
//! sent to views as JSON without constructing or cloning a second object tree.
use serde::Deserialize;
use std::{borrow::Cow, sync::OnceLock};

pub const JSON: &str = include_str!("../data/pet-catalogue.json");

#[derive(Deserialize)]
pub struct Catalogue<'a> {
    #[serde(borrow)]
    pub pets: Box<[Pet<'a>]>,
    #[serde(borrow)]
    pub maps: Box<[Map<'a>]>,
    #[serde(borrow)]
    pub npcs: Box<[Npc<'a>]>,
}

#[derive(Deserialize)]
pub struct Pet<'a> {
    pub id: u32,
    pub npc_ids: Box<[u32]>,
    #[serde(borrow)]
    pub spawns: Box<[Spawn<'a>]>,
}

#[derive(Deserialize)]
pub struct Spawn<'a> {
    #[serde(borrow)]
    pub map_id: Cow<'a, str>,
    pub npc_id: u32,
    pub x: i64,
    pub y: i64,
}

#[derive(Deserialize)]
pub struct Map<'a> {
    #[serde(borrow)]
    pub id: Cow<'a, str>,
    pub zone_ids: Box<[u32]>,
}

#[derive(Deserialize)]
pub struct Npc<'a> {
    pub id: u32,
    #[serde(borrow)]
    pub name: Cow<'a, str>,
}

pub fn catalogue() -> &'static Catalogue<'static> {
    static DATA: OnceLock<Catalogue<'static>> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(JSON).expect("Bundled pet metadata"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn compact_metadata_preserves_every_collector_field() {
        let full: Value = serde_json::from_str(crate::pet_catalogue()).unwrap();
        let compact = catalogue();
        assert_eq!(compact.pets.len(), full["pets"].as_array().unwrap().len());
        for (pet, original) in compact.pets.iter().zip(full["pets"].as_array().unwrap()) {
            assert_eq!(pet.id, original["id"]);
            assert_eq!(
                serde_json::to_value(&pet.npc_ids).unwrap(),
                original["npc_ids"]
            );
            assert_eq!(
                pet.spawns.len(),
                original["spawns"].as_array().unwrap().len()
            );
            for (spawn, original) in pet
                .spawns
                .iter()
                .zip(original["spawns"].as_array().unwrap())
            {
                assert_eq!(spawn.map_id, original["map_id"].as_str().unwrap());
                assert_eq!(spawn.npc_id, original["npc_id"]);
                assert_eq!(spawn.x, original["x"]);
                assert_eq!(spawn.y, original["y"]);
            }
        }
        assert_eq!(compact.maps.len(), full["maps"].as_array().unwrap().len());
        for (map, original) in compact.maps.iter().zip(full["maps"].as_array().unwrap()) {
            assert_eq!(map.id, original["id"].as_str().unwrap());
            assert_eq!(
                serde_json::to_value(&map.zone_ids).unwrap(),
                original["zone_ids"]
            );
        }
        assert_eq!(compact.npcs.len(), full["npcs"].as_array().unwrap().len());
        for (npc, original) in compact.npcs.iter().zip(full["npcs"].as_array().unwrap()) {
            assert_eq!(npc.id, original["id"]);
            assert_eq!(npc.name, original["name"].as_str().unwrap());
        }
    }

    #[test]
    fn escaped_labels_are_owned_while_plain_labels_borrow_the_document() {
        let escaped: Npc<'_> = serde_json::from_str(r#"{"id":1,"name":"A \"name\""}"#).unwrap();
        assert_eq!(escaped.name, "A \"name\"");
        assert!(matches!(escaped.name, Cow::Owned(_)));
        let plain: Npc<'_> = serde_json::from_str(r#"{"id":1,"name":"Name"}"#).unwrap();
        assert!(matches!(plain.name, Cow::Borrowed(_)));
    }
}
