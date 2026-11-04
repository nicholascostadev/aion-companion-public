//! Local CP updates verified by an app-owned Global equipment removal/re-equip.
use super::Entities;

#[derive(Clone)]
pub(super) struct LocalPower {
    entity: u32,
    name: Option<String>,
    server: Option<u16>,
    value: u64,
}

impl Entities {
    /// Only the identified local player owns the entity-less CP update.
    pub fn combat_power(&self, id: u32) -> Option<u64> {
        let power = self.local_power.as_ref()?;
        (self.local == Some(id)
            && power.entity == id
            && power
                .name
                .as_deref()
                .is_none_or(|name| self.name(id) == Some(name))
            && power
                .server
                .is_none_or(|server| self.server_id(id) == Some(server)))
        .then_some(power.value)
    }

    pub(super) fn observe_power(&mut self, frame: &[u8]) {
        if self
            .local_power
            .as_ref()
            .is_some_and(|power| self.combat_power(power.entity).is_none())
        {
            self.local_power = None;
            self.revision = self.revision.wrapping_add(1);
        }
        // The second u64 stayed fixed while the first followed actual CP. Its meaning
        // remains unknown. Accept only the complete observed record, never a prefix.
        if frame.len() != 18 || frame[..2] != [0x56, 0x36] {
            return;
        }
        let Some(entity) = self.local else {
            return;
        };
        let value = u64::from_le_bytes(frame[2..10].try_into().unwrap());
        // Same broad sanity bound as roster CP, not a claimed game cap.
        if !(1..=100_000_000).contains(&value) {
            return;
        }
        if self.combat_power(entity) == Some(value) {
            return;
        }
        self.local_power = Some(LocalPower {
            entity,
            name: self.name(entity).map(str::to_owned),
            server: self.server_id(entity),
            value,
        });
        self.revision = self.revision.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(value: u64) -> Vec<u8> {
        [
            vec![0x56, 0x36],
            value.to_le_bytes().to_vec(),
            164343u64.to_le_bytes().to_vec(),
        ]
        .concat()
    }

    #[test]
    fn equipment_changes_update_only_the_identified_local_player() {
        let mut entities = Entities::default();
        entities.observe(&frame(145988)).unwrap();
        entities.local = Some(331);
        assert_eq!(entities.combat_power(331), None);
        for value in [145988, 164343, 145988] {
            entities.observe(&frame(value)).unwrap();
            assert_eq!(entities.combat_power(331), Some(value));
            assert_eq!(entities.combat_power(332), None);
            assert_eq!(
                entities.combat_context(&[], [331]).combat_power(331),
                Some(value)
            );
        }
        entities.local = Some(332);
        entities.observe(&[0, 1]).unwrap();
        entities.local = Some(331);
        assert_eq!(entities.combat_power(331), None);
    }

    #[test]
    fn malformed_updates_do_not_replace_a_known_value() {
        let mut entities = Entities::default();
        entities.local = Some(331);
        entities.observe(&frame(164343)).unwrap();
        let record = frame(145988);
        for end in 0..record.len() {
            let _ = entities.observe(&record[..end]);
            assert_eq!(entities.combat_power(331), Some(164343));
        }
        let mut extra = record.clone();
        extra.push(0);
        let mut unrelated = record;
        unrelated[0] = 0x57;
        for invalid in [extra, unrelated, frame(0), frame(u64::MAX)] {
            entities.observe(&invalid).unwrap();
            assert_eq!(entities.combat_power(331), Some(164343));
        }
    }

    #[test]
    fn reused_entity_identity_does_not_inherit_the_previous_characters_power() {
        let mut entities = Entities::default();
        entities.local = Some(331);
        entities.register(331, "Testactor");
        entities.row(331).unwrap().server_id = Some(1304);
        entities.observe(&frame(164343)).unwrap();
        entities.register(331, "Newactor");
        assert_eq!(entities.combat_power(331), None);
        entities.observe(&[0, 1]).unwrap();
        entities.register(331, "Testactor");
        assert_eq!(entities.combat_power(331), None);
    }
}
