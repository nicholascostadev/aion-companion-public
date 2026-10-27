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
