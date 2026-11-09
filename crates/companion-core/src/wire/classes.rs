//! The one class list. Each wire family numbers it differently: a skill ID carries the
//! class in its millions, while roster, inspection and identity records carry a class code.
//! Brawler has no observed class code, so none is listed.

const CLASSES: [(&str, u32, Option<u32>); 9] = [
    ("Gladiator", 11, Some(1)),
    ("Templar", 12, Some(2)),
    ("Assassin", 13, Some(4)),
    ("Ranger", 14, Some(3)),
    ("Sorcerer", 15, Some(6)),
    ("Spiritmaster", 16, Some(5)),
    ("Cleric", 17, Some(7)),
    ("Chanter", 18, Some(8)),
    ("Brawler", 19, None),
];

pub(crate) fn by_skill(skill: u32) -> Option<&'static str> {
    let family = skill / 1_000_000;
    CLASSES
        .iter()
        .find(|class| class.1 == family)
        .map(|class| class.0)
}

pub(crate) fn by_code(code: u32) -> Option<&'static str> {
    CLASSES
        .iter()
        .find(|class| class.2 == Some(code))
        .map(|class| class.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_families_and_class_codes_name_the_same_classes_in_their_own_orders() {
        let skills: Vec<_> = (11..=19).map(|family| by_skill(family * 1_000_000 + 100)).collect();
        assert_eq!(
            skills,
            ["Gladiator", "Templar", "Assassin", "Ranger", "Sorcerer", "Spiritmaster", "Cleric", "Chanter", "Brawler"]
                .map(Some)
        );
        let codes: Vec<_> = (1..=8).map(by_code).collect();
        assert_eq!(
            codes,
            ["Gladiator", "Templar", "Ranger", "Assassin", "Spiritmaster", "Sorcerer", "Cleric", "Chanter"]
                .map(Some)
        );
        for unknown in [0, 10_999_999, 20_000_000] {
            assert_eq!(by_skill(unknown), None);
        }
        for unknown in [0, 9, 40] {
            assert_eq!(by_code(unknown), None);
        }
    }
}
