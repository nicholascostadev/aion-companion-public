// Reference packet vectors: SkeeveTV, MIT; see THIRD_PARTY_NOTICES.
use super::*;

fn hex(text: &str) -> Vec<u8> {
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}
fn wire(body: &[u8]) -> Vec<u8> {
    let mut n = body.len() + 4;
    let mut out = Vec::new();
    while n >= 128 {
        out.push((n as u8 & 127) | 128);
        n >>= 7;
    }
    out.push(n as u8);
    out.extend_from_slice(body);
    out
}
const HIT: &str = "04388484030600be08fe26a8004f02000002433baf4101000000ba4ffd020100";
const CRIT: &str = "04388484032600be08fe26a8005703000002433baf4101000000ba4fcc0401020100";

#[test]
fn spell_entity_damage_is_credited_only_to_an_unambiguous_observed_cast() {
    let cast = hex("0438e482020000f33c0c28e9005f03c5a4135b02000000a4600200");
    let spawn = hex("4136dfaa021f0000cf902c004002fef200478ae91ac70000c34682fc4c43c59101f78e01f78e01b4120000b41200000000000000000000000000007434020064000000f04902000100000000000000a086010000000000f09c0900010101110181969800ffffffffffffffff8075d52abb030000dfaa020102fef200478ae91ac70000c346070206731e000002cd00be050000d0006d0100002d00000000");
    let damage = hex("0438e482020400dfaa020e28e900030383a5135b01000000a460f20a0100");
    let mut decoder = Decoder::default();
    decoder.entities.local = Some(7795);
    decoder.decode_at(&cast, 1000);
    decoder.decode_at(&spawn, 1044);
    let hits = decoder.decode_at(&damage, 1448);
    assert_eq!(hits.len(), 1);
    assert_eq!((hits[0].actor, hits[0].amount), (7795, 1394));
    assert!(decoder.observations.iter().any(|e| e.kind == "damage" && e.source == 7795 && e.amount == 1394));
    // Two casters using the same variant are ambiguous, even when one is local.
    let mut ambiguous = Decoder::default();
    ambiguous.entities.local = Some(7795);
    let identity = hex("4536f43c0000000001054f74686572");
    ambiguous.entities.observe(&identity).unwrap();
    assert!(ambiguous.entities.known_player(7796));
    ambiguous.decode_at(&cast, 1000);
    let mut other = cast.clone();
    other[7..9].copy_from_slice(&[0xf4, 0x3c]); // another observed player, 7796
    ambiguous.decode_at(&other, 1010);
    ambiguous.decode_at(&spawn, 1044);
    assert!(ambiguous.decode_at(&damage, 1448).is_empty());
    // A different specialty variant must not compete for this spell entity.
    let mut variant = Decoder::default();
    variant.entities.local = Some(7795);
    variant.decode_at(&cast, 1000);
    other[9..13].copy_from_slice(&15_280_240u32.to_le_bytes());
    variant.entities.local = Some(7796);
    variant.decode_at(&other, 1010);
    variant.entities.local = Some(7795);
    variant.decode_at(&spawn, 1044);
    assert_eq!(variant.decode_at(&damage, 1448)[0].actor, 7795);
    // Reusing an entity ID without a fresh cast cannot retain ownership.
    decoder.decode_at(&spawn, 10000);
    assert!(decoder.decode_at(&damage, 10404).is_empty());
}

#[test]
fn spell_release_feedback_owns_periodic_damage_without_guessing_from_a_hit() {
    let spawn = hex("4136b29c031f00001f912c0040023b29fe4605081ac70000c3461acad141a61201f78e01f78e01b4120000b41200000000000000000000000000007434020064000000f04902000100000000000000a086010000000000f09c0900010101110181969800ffffffffffffffff8075d52abb030000b29c0301023b29fe4605081ac70000c346070206731e000001d0006d0100002d00000000");
    let feedback = hex("0438f33c0000b29c032fefe7000402676e995a01000000dc770100");
    let tick = hex("0538e482020ab29c03dc01bb60995ae70316efe700");
    let mut decoder = Decoder::default();
    decoder.entities.local = Some(7795);
    decoder.decode_at(&spawn, 1000);
    assert!(decoder.decode_at(&tick, 1200).is_empty());
    decoder.decode_at(&feedback, 1500);
    assert_eq!(decoder.entities.owner(52786), Some(7795));
    assert_eq!(decoder.decode_at(&tick, 2000)[0].amount, 487);
    assert!(decoder.observations.iter().any(|e| e.kind == "damage" && e.source == 7795 && e.tick && e.amount == 487));
    // An ordinary dungeon NPC with the same skill must never acquire an owner.
    let mut boss = spawn.clone();
    boss[8..12].copy_from_slice(&2_300_909u32.to_le_bytes());
    decoder.decode_at(&boss, 3000);
    decoder.decode_at(&feedback, 3100);
    assert_eq!(decoder.entities.owner(52786), None);
}

#[test]
fn observed_player_identity_allows_generic_damage_procs_without_guessing_a_class() {
    for skill in [3_000_017u32, 3_000_022] {
        let mut frame = hex(HIT);
        let mut at = 2;
        varint(&frame, &mut at).unwrap();
        at += 2;
        varint(&frame, &mut at).unwrap();
        frame[at..at+4].copy_from_slice(&skill.to_le_bytes());
        assert!(Decoder::default().decode(&frame).is_empty());
        let mut decoder = Decoder::default();
        decoder.entities.local = Some(1086);
        assert_eq!(decoder.decode(&frame)[0].amount, 381);
        assert!(decoder.observations.iter().any(|e| e.kind == "damage" && e.skill == skill && e.amount == 381));
    }
}

#[test]
fn direct_and_tick_damage_to_named_players_are_not_discarded_as_healing() {
    let frame = hex(HIT);
    let mut at = 2;
    let target = varint(&frame, &mut at).unwrap();
    let target_bytes = &frame[2..at];
    let mut identity = vec![0x45, 0x36];
    identity.extend_from_slice(target_bytes);
    identity.extend_from_slice(&[0, 0, 0, 0, 1, 3]);
    identity.extend_from_slice(b"Foe");
    let mut decoder = Decoder::default();
    decoder.entities.local = Some(1086);
    decoder.entities.observe(&identity).unwrap();
    assert!(decoder.entities.known_player(target));
    let hits = decoder.decode(&frame);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].amount, 381);
    assert!(decoder.observations.iter().any(|e| e.kind == "damage" && e.target == target && e.amount == 381));
    decoder.observations.clear();
    let mut tick = vec![0x05, 0x38];
    tick.extend_from_slice(target_bytes);
    tick.extend_from_slice(&[0x0a, 0xbe, 0x08, 1]);
    tick.extend_from_slice(&1_000_000_001u32.to_le_bytes());
    tick.push(50);
    tick.extend_from_slice(&11_010_000u32.to_le_bytes());
    assert_eq!(decoder.decode(&tick)[0].amount, 50);
    assert!(decoder.observations.iter().any(|e| e.kind == "damage" && e.tick && e.amount == 50));
    decoder.observations.clear();
    let mut heal = vec![0x05, 0x38];
    heal.extend_from_slice(target_bytes);
    heal.extend_from_slice(&[0x09, 0xbe, 0x08, 1]);
    heal.extend_from_slice(&1_000_000_001u32.to_le_bytes());
    heal.push(75);
    heal.extend_from_slice(&11_010_000u32.to_le_bytes());
    assert!(decoder.decode(&heal).is_empty());
    assert_eq!(decoder.observations.len(), 1);
    assert_eq!(decoder.observations[0].kind, "heal");
    assert_eq!(decoder.observations[0].amount, 75);
}

#[test]
fn lobby_frames_can_synchronize_a_capture_without_damage() {
    let inspect = hex(
        "50360000070b54657374737069656c65720600000001022d000000000000004c0900001805e80c30000000",
    );
    let roster = hex("0297180503416263200000002d000000");
    let bytes = [wire(&roster), wire(&inspect), wire(&inspect)].concat();
    let mut stream = Stream::default();
    let frames = stream.push(100, &bytes, 0);
    assert_eq!(frames.len(), 3);
    let mut decoder = Decoder::default();
    for frame in frames {
        assert!(decoder.decode(&frame).is_empty());
    }
    assert_eq!(
        decoder.entities.inspections().front().unwrap().gear_score,
        2380
    );
    assert_eq!(decoder.entities.group_members().len(), 1);
}

#[test]
fn recorded_spirits_are_credited_to_explicit_owners_and_reused_ids_are_cleared() {
    let water="4136A5AE011F1000C18E2C0000020028A04500788245008031440E86B1437AFC01DF28DF2819070000190700000000000000000000000000005892010064000000F04902000100000000000000A08601000000000090D00300010111010F329A09FFFFFFFFFFFFFFFF8075D52ABB0300008E5509022B5A9B45CADA7B4590C525440702068E2A000002CD00C4040000D0003D0100001E000000E31D030000";
    let fire="4136B7DD011F1000B28E2C00400200E8E44500F06B4500806C443AAF7D4366B40198639863630B0000630B000000000000000000000000000060B2010064000000F049020001000000000000000000000000A08601000000000000E20400010101110144AA9809FFFFFFFFFFFFFFFF8075D52ABB030000CF190E02FB71E7451296784571BE6044070206CF0C000002CD005A000000D000300100002D000000DD1D030000";
    let mut decoder = Decoder::default();
    decoder.decode(&hex(water));
    let water_hp=decoder.observations.iter().find(|e|e.kind=="hp").unwrap();
    assert_eq!((water_hp.current_hp,water_hp.max_hp),(Some(5215),Some(5215)));
    decoder.decode(&hex(fire));
    let water_hit = "0438EC91010600A5AE01BB86010002020000024FA09800010000009E5A690100";
    let hit = decoder.decode(&hex(water_hit)).pop().unwrap();
    assert_eq!((hit.actor, hit.amount), (10894, 105));
    let hit = decoder
        .decode(&hex(
            "0438EC91012600B7DD01AE8601000503000002D99A980001000000C0528B0501410100",
        ))
        .pop()
        .unwrap();
    assert_eq!((hit.actor, hit.amount, hit.critical), (3279, 651, true));
    decoder.decode(&hex(
        &water.replace("8075D52ABB0300008E55", "8075D52ABB030000A5AE01")
    ));
    assert!(decoder.decode(&hex(water_hit)).is_empty());
}

#[test]
fn healing_family_attack_is_restored_only_for_an_observed_monster() {
    let frame = hex("0438D9240400833A407D140105020BED006C010000008256B4020100");
    let mut decoder = Decoder::default();
    assert!(decoder.decode(&frame).is_empty());
    decoder.decode(&hex("4136D92400000001000000"));
    assert_eq!(decoder.decode(&frame)[0].amount, 308);
}

#[test]
fn captured_damage_crit_dot_and_non_damage_notices() {
    let mut decoder = Decoder::default();
    let hit = decoder.decode(&hex(HIT)).pop().unwrap();
    assert_eq!((hit.actor, hit.amount, hit.critical), (1086, 381, false));
    let crit = decoder.decode(&hex(CRIT)).pop().unwrap();
    assert_eq!((crit.amount, crit.critical), (588, true));
    assert_eq!(decoder.observations.iter().filter(|e|e.kind=="damage").map(|e|e.amount).collect::<Vec<_>>(),[381,588]);
    let tick = decoder
        .decode(&hex("0538D490020AC522108BAF3360A804E046F600"))
        .pop()
        .unwrap();
    assert_eq!(
        (tick.amount, tick.actor, tick.target, tick.tick),
        (552, 4421, 34900, true)
    );
    for no_damage in [
        "0438C5220000C522E2B7F8000F0253D4276101000000A85A0100",
        "0438D9240400833A407D140105020BED006C010000008256B4020100",
        "0538D9240A833A490BED006C4D407D1401",
        "0538833A0B833A91015FB2FC0BFF03AA01DDAF1E00",
        "0538C5220AD49002F402E71327076AE0771B00",
    ] {
        assert!(decoder.decode(&hex(no_damage)).is_empty(), "{no_damage}");
    }
}

#[test]
fn compressed_reference_bundle_yields_exact_hits_and_corruption_is_rejected() {
    let bytes = hex("ffff08020000ff13200438b81c0400ec1b5e7d14011a02c3f8006c01000000c24e87080100200438f81b1d000150c40701001e1d0015003a0015c43a000c1b002700c51b004f200438ea53000212cd53001fea530007071b000c53001fe153000212b353001fe1530007071b00095300f100332a38f81b011335ade5cc0ae02e0001006065a020f4a0019e00f0090c5e7d1401004f576fc60aa7724600c021440d0e92f81b012e0090160538f81b09ec1b354a0120c00b2a0080332a38ea1b0113391f000f4d001415ea4d0010ea4d0010394d00118d77004f332a38e19a001c15e14d0010e14d00019a0011854d00b00e0036857120f4a0010000");
    let mut decoder = Decoder::default();
    // The reference bundle's four hits are in a healing family, conservatively excluded.
    assert!(decoder.decode(&bytes).is_empty());
    assert_eq!(decoder.bundles, 1);
    assert_eq!(decoder.rejected, 0);
    let raw: Vec<_> = [HIT, CRIT, HIT]
        .iter()
        .flat_map(|h| wire(&hex(h)))
        .collect();
    let mut bundled = vec![0xff, 0xff];
    bundled.extend_from_slice(&(raw.len() as u32).to_le_bytes());
    bundled.extend_from_slice(&lz4_flex::block::compress(&raw));
    assert_eq!(
        decoder
            .decode(&bundled)
            .iter()
            .map(|h| h.amount)
            .collect::<Vec<_>>(),
        [381, 588, 381]
    );
    assert!(decoder.decode(&bytes[..bytes.len() - 3]).is_empty());
    assert_eq!(decoder.rejected, 1);
}

#[test]
fn tcp_reassembly_handles_splits_retransmits_reordering_and_sequence_wrap() {
    let bytes: Vec<u8> = [HIT, CRIT, HIT]
        .iter()
        .flat_map(|h| wire(&hex(h)))
        .collect();
    let mut stream = Stream::default();
    let start = u32::MAX - 10;
    assert!(stream.push(start, &bytes[..8], 0).is_empty());
    assert!(stream
        .push(start.wrapping_add(20), &bytes[20..], 100)
        .is_empty());
    let frames = stream.push(start.wrapping_add(8), &bytes[8..20], 200);
    assert_eq!(frames.len(), 3);
    assert!(stream.push(start, &bytes, 250).is_empty());
    assert_eq!(stream.retransmissions, 1);
    let mut decoder = Decoder::default();
    assert_eq!(
        frames
            .iter()
            .flat_map(|f| decoder.decode(f))
            .map(|h| h.amount)
            .sum::<u64>(),
        1350
    );
}

#[test]
fn loss_and_midstream_capture_resync_without_inventing_hits() {
    let bytes: Vec<u8> = [HIT, CRIT, HIT]
        .iter()
        .flat_map(|h| wire(&hex(h)))
        .collect();
    let mut stream = Stream::default();
    let mut mid = vec![0x80, 0x80, 0xff, 0, 0xff];
    mid.extend_from_slice(&bytes);
    assert_eq!(stream.push(100, &mid, 0).len(), 3);
    let next = 100 + mid.len() as u32;
    assert!(stream.push(next + 100, &bytes, 1).is_empty());
    assert_eq!(stream.push(next + 100, &bytes, 2000).len(), 3);
    assert_eq!(stream.gaps, 1);
    for size in 0..hex(HIT).len() {
        Decoder::default().decode(&hex(HIT)[..size]);
    }
}

#[test]
fn ethernet_vlan_loopback_ipv6_and_truncation() {
    let mut ip = vec![0u8; 40];
    ip[0] = 0x45;
    ip[2..4].copy_from_slice(&43u16.to_be_bytes());
    ip[9] = 6;
    ip[20..22].copy_from_slice(&13328u16.to_be_bytes());
    ip[22..24].copy_from_slice(&50000u16.to_be_bytes());
    ip[32] = 0x50;
    ip.extend_from_slice(&[1, 2, 3]);
    let mut ethernet = vec![0u8; 14];
    ethernet[12..14].copy_from_slice(&0x0800u16.to_be_bytes());
    ethernet.extend_from_slice(&ip);
    assert_eq!(tcp_segment(&ethernet, 1).unwrap().payload, [1, 2, 3]);
    for size in 0..ethernet.len() {
        assert!(tcp_segment(&ethernet[..size], 1).is_none());
    }
    let mut vlan = ethernet[..12].to_vec();
    vlan.extend_from_slice(&[0x81, 0, 0, 1, 8, 0]);
    vlan.extend_from_slice(&ip);
    assert_eq!(tcp_segment(&vlan, 1).unwrap().flow.source_port, 13328);
    let mut loopback = 2u32.to_le_bytes().to_vec();
    loopback.extend_from_slice(&ip);
    assert_eq!(tcp_segment(&loopback, 0).unwrap().payload, [1, 2, 3]);
    ip[6] = 0x20;
    assert!(tcp_segment(&ip, 101).is_none());
    let mut v6 = vec![0u8; 40];
    v6[0] = 0x60;
    v6[4..6].copy_from_slice(&23u16.to_be_bytes());
    v6[6] = 6;
    v6.extend_from_slice(&ip[20..]);
    assert_eq!(tcp_segment(&v6, 101).unwrap().payload, [1, 2, 3]);
}
