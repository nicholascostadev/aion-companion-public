use super::*;
use companion_core::wire::{tcp_segment, Flow};
use libloading::os::windows::Library;
use std::{
    collections::HashSet,
    ffi::{c_char, c_int, c_void, CStr, CString},
    net::{Ipv4Addr, Ipv6Addr},
    ptr,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
    NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
    },
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
};

#[repr(C)]
struct Device {
    next: *mut Device,
    name: *mut c_char,
    description: *mut c_char,
    addresses: *mut c_void,
    flags: u32,
}
#[repr(C)]
struct Header {
    seconds: i32,
    microseconds: i32,
    captured: u32,
    length: u32,
}
#[repr(C)]
struct Bpf {
    length: u32,
    instructions: *mut c_void,
}
type Handle = *mut c_void;

fn packet_time(origin: &mut Option<(u64, u64)>, stamp: u64, observed: u64) -> u64 {
    let (first_stamp, first_observed) = *origin.get_or_insert((stamp, observed));
    // Calibrate the capture clock once. Clipping each packet to the independently
    // rounded processing clock changes encounter intervals by a millisecond or
    // two, even when the driver timestamps describe the exact same packets.
    first_observed.saturating_add(stamp.saturating_sub(first_stamp))
}

struct Api {
    _library: Library,
    find: unsafe extern "C" fn(*mut *mut Device, *mut c_char) -> c_int,
    free: unsafe extern "C" fn(*mut Device),
    open: unsafe extern "C" fn(*const c_char, c_int, c_int, c_int, *mut c_char) -> Handle,
    close: unsafe extern "C" fn(Handle),
    nonblock: unsafe extern "C" fn(Handle, c_int, *mut c_char) -> c_int,
    compile: unsafe extern "C" fn(Handle, *mut Bpf, *const c_char, c_int, u32) -> c_int,
    setfilter: unsafe extern "C" fn(Handle, *mut Bpf) -> c_int,
    freecode: unsafe extern "C" fn(*mut Bpf),
    next: unsafe extern "C" fn(Handle, *mut *const Header, *mut *const u8) -> c_int,
    datalink: unsafe extern "C" fn(Handle) -> c_int,
    stats: unsafe extern "C" fn(Handle, *mut c_void) -> c_int,
    error: unsafe extern "C" fn(Handle) -> *const c_char,
}
impl Api {
    fn load() -> Result<Self, String> {
        let root = std::env::var_os("WINDIR").ok_or("Windows directory unavailable")?;
        let path = std::path::PathBuf::from(root).join("System32/Npcap/wpcap.dll");
        // Only load the installed driver DLL and its dependencies from trusted system paths.
        let library = unsafe { Library::load_with_flags(&path, 0x100 | 0x800) }
            .map_err(|e| format!("Npcap could not load: {e}. Install Npcap from npcap.com."))?;
        unsafe {
            macro_rules! symbol {
                ($name:literal) => {
                    *library
                        .get(concat!($name, "\0").as_bytes())
                        .map_err(|e| e.to_string())?
                };
            }
            Ok(Self {
                find: symbol!("pcap_findalldevs"),
                free: symbol!("pcap_freealldevs"),
                open: symbol!("pcap_open_live"),
                close: symbol!("pcap_close"),
                nonblock: symbol!("pcap_setnonblock"),
                compile: symbol!("pcap_compile"),
                setfilter: symbol!("pcap_setfilter"),
                freecode: symbol!("pcap_freecode"),
                next: symbol!("pcap_next_ex"),
                datalink: symbol!("pcap_datalink"),
                stats: symbol!("pcap_stats"),
                error: symbol!("pcap_geterr"),
                _library: library,
            })
        }
    }
    fn error(&self, handle: Handle) -> String {
        let error = unsafe { (self.error)(handle) };
        if error.is_null() {
            "Unknown Npcap error".into()
        } else {
            unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned()
        }
    }
}
struct Adapter<'a> {
    handle: Handle,
    link: i32,
    api: &'a Api,
}
impl Drop for Adapter<'_> {
    fn drop(&mut self) {
        unsafe {
            (self.api.close)(self.handle);
        }
    }
}
impl Adapter<'_> {
    fn filter(&self, filter: &CString) -> Result<(), String> {
        let mut code = Bpf {
            length: 0,
            instructions: ptr::null_mut(),
        };
        unsafe {
            if (self.api.compile)(self.handle, &mut code, filter.as_ptr(), 1, u32::MAX) != 0 {
                return Err(self.api.error(self.handle));
            }
            let status = (self.api.setfilter)(self.handle, &mut code);
            (self.api.freecode)(&mut code);
            if status != 0 {
                return Err(self.api.error(self.handle));
            }
        }
        Ok(())
    }
}

fn adapters(api: &Api) -> Result<Vec<Adapter<'_>>, String> {
    let mut first = ptr::null_mut();
    let mut error = [0i8; 256];
    if unsafe { (api.find)(&mut first, error.as_mut_ptr()) } != 0 {
        return Err(unsafe { CStr::from_ptr(error.as_ptr()) }
            .to_string_lossy()
            .into_owned());
    }
    let mut cursor = first;
    let mut out = Vec::new();
    unsafe {
        while !cursor.is_null() {
            let device = &*cursor;
            if !device.name.is_null() {
                // Non-promiscuous. Immediately install a reject-all filter before polling.
                let handle = (api.open)(device.name, 65535, 0, 10, error.as_mut_ptr());
                if !handle.is_null() {
                    let adapter = Adapter {
                        handle,
                        link: (api.datalink)(handle),
                        api,
                    };
                    if matches!(adapter.link, 0 | 1 | 12 | 101 | 108)
                        && (api.nonblock)(handle, 1, error.as_mut_ptr()) == 0
                        && adapter
                            .filter(&CString::new("tcp and port 0").unwrap())
                            .is_ok()
                    {
                        out.push(adapter);
                    }
                }
            }
            cursor = device.next;
        }
        (api.free)(first);
    }
    if out.is_empty() {
        return Err("Npcap could not open a supported adapter. Check the Npcap service and driver permissions.".into());
    }
    Ok(out)
}

pub(super) fn requirements() -> Value {
    let Some(root) = std::env::var_os("WINDIR") else {
        return json!({"state":"unavailable","detail":"Windows directory unavailable"});
    };
    if !std::path::PathBuf::from(root)
        .join("System32/Npcap/wpcap.dll")
        .is_file()
    {
        return json!({"state":"missing","detail":null});
    }
    let result = Api::load().and_then(|api| adapters(&api).map(|_| ()));
    match result {
        Ok(()) => json!({"state":"ready","detail":null}),
        Err(error) => json!({"state":"unavailable","detail":error}),
    }
}

fn game_pids() -> Result<HashSet<u32>, String> {
    let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if handle == INVALID_HANDLE_VALUE {
        return Err("Windows could not enumerate process names.".into());
    }
    let mut row = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut ids = HashSet::new();
    unsafe {
        let mut found = Process32FirstW(handle, &mut row);
        while found != 0 {
            let end = row
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(row.szExeFile.len());
            if String::from_utf16_lossy(&row.szExeFile[..end]).eq_ignore_ascii_case("AION2.exe") {
                ids.insert(row.th32ProcessID);
            }
            found = Process32NextW(handle, &mut row);
        }
        CloseHandle(handle);
    }
    Ok(ids)
}

fn tcp_table(family: u32) -> Result<Vec<u8>, String> {
    for _ in 0..3 {
        let mut size = 0;
        unsafe {
            GetExtendedTcpTable(
                ptr::null_mut(),
                &mut size,
                0,
                family,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            );
        }
        if size == 0 || size > 16 * 1024 * 1024 {
            return Err("Invalid Windows TCP table size.".into());
        }
        let mut data = vec![0u8; size as usize];
        let result = unsafe {
            GetExtendedTcpTable(
                data.as_mut_ptr().cast(),
                &mut size,
                0,
                family,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            )
        };
        if result == 0 {
            data.truncate(size as usize);
            return Ok(data);
        }
        if result != 122 {
            return Err(format!("Windows TCP table failed ({result})."));
        }
    }
    Err("Windows TCP table changed while being read. Retry capture.".into())
}

fn connections(port: u16) -> Result<HashSet<Flow>, String> {
    let pids = game_pids()?;
    let mut flows = HashSet::new();
    if pids.is_empty() {
        return Ok(flows);
    }
    for family in [2, 23] {
        let data = tcp_table(family)?;
        let count = u32::from_ne_bytes(
            data.get(..4)
                .ok_or("Short TCP table")?
                .try_into()
                .map_err(|_| "Invalid TCP table")?,
        ) as usize;
        let size = if family == 2 {
            std::mem::size_of::<MIB_TCPROW_OWNER_PID>()
        } else {
            std::mem::size_of::<MIB_TCP6ROW_OWNER_PID>()
        };
        if count > data.len().saturating_sub(4) / size {
            return Err("Truncated Windows TCP table.".into());
        }
        for index in 0..count {
            let at = unsafe { data.as_ptr().add(4 + index * size) };
            let mut source = [0u8; 16];
            let mut destination = [0u8; 16];
            let (pid, state, remote_port, local_port) = if family == 2 {
                let row = unsafe { ptr::read_unaligned(at.cast::<MIB_TCPROW_OWNER_PID>()) };
                source[..4].copy_from_slice(&row.dwRemoteAddr.to_ne_bytes());
                destination[..4].copy_from_slice(&row.dwLocalAddr.to_ne_bytes());
                (
                    row.dwOwningPid,
                    row.dwState,
                    u16::from_be(row.dwRemotePort as u16),
                    u16::from_be(row.dwLocalPort as u16),
                )
            } else {
                let row = unsafe { ptr::read_unaligned(at.cast::<MIB_TCP6ROW_OWNER_PID>()) };
                source = row.ucRemoteAddr;
                destination = row.ucLocalAddr;
                (
                    row.dwOwningPid,
                    row.dwState,
                    u16::from_be(row.dwRemotePort as u16),
                    u16::from_be(row.dwLocalPort as u16),
                )
            };
            if pids.contains(&pid) && state == 5 && remote_port == port {
                flows.insert(Flow {
                    source,
                    destination,
                    source_port: remote_port,
                    destination_port: local_port,
                    ipv6: family == 23,
                });
            }
        }
    }
    Ok(flows)
}

fn bpf(flows: &HashSet<Flow>) -> CString {
    if flows.is_empty() {
        return CString::new("tcp and port 0").unwrap();
    }
    let clauses: Vec<_> = flows
        .iter()
        .map(|flow| {
            let address = if !flow.ipv6 {
                Ipv4Addr::new(
                    flow.source[0],
                    flow.source[1],
                    flow.source[2],
                    flow.source[3],
                )
                .to_string()
            } else {
                Ipv6Addr::from(flow.source).to_string()
            };
            format!(
                "(src host {address} and src port {} and dst port {})",
                flow.source_port, flow.destination_port
            )
        })
        .collect();
    CString::new(format!("tcp and ({})", clauses.join(" or "))).unwrap()
}

pub(super) fn capture(port: u16, stop: &AtomicBool, shared: &Mutex<Shared>) -> Result<(), String> {
    let api = Api::load()?;
    let adapters = adapters(&api)?;
    let mut pipeline = Pipeline::default();
    let mut flows = HashSet::new();
    let mut refresh = Instant::now() - std::time::Duration::from_secs(3);
    let mut publish_at = Instant::now();
    let mut generation = 0;
    let mut timestamp_origin: Option<(u64, u64)> = None;
    while !stop.load(Ordering::Acquire) {
        super::flush_storage(shared, false)?;
        if refresh.elapsed().as_secs() >= 2 {
            let next = connections(port)?;
            // Replacing a live BPF can discard buffered packets. Change it only on reconnect.
            if next != flows {
                diagnostics::record(
                    "info",
                    "capture",
                    &format!(
                        "Game connection changed: {} active flows on {} adapters",
                        next.len(),
                        adapters.len()
                    ),
                );
                let filter = bpf(&next);
                for adapter in &adapters {
                    adapter.filter(&filter)?;
                }
                pipeline.retain_flows(&next);
                if !flows.is_empty() {
                    let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
                    state.archive()?;
                    let now = state.now();
                    state.offline.reset_connection(now);
                    let pets = state.pets.clone();
                    state.entities = Default::default();
                    state.clear_odyle();
                    state.cubes.reset_connection();
                    state.group_trace.records.clear();
                    pipeline.decoder.entities = Default::default();
                    pipeline.decoder.odyle = Default::default();
                    drop(state);
                    pets.lock()
                        .map_err(|_| "Pet state unavailable")?
                        .reset_connection();
                }
            }
            flows = next;
            refresh = Instant::now();
            let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
            if flows.is_empty() {
                state.phase = "waiting_for_game".into();
                state.message = format!("Waiting for AION2.exe’s game connection on port {port}.");
            } else {
                state.phase = "capturing".into();
                state.message = if state.meter.event_count() > 0 {
                    "Collecting independent player-skill damage. Session totals include idle time."
                } else {
                    "Receiving game traffic. Waiting for recognized player damage."
                }
                .into();
            }
        }
        let mut busy = false;
        for adapter in &adapters {
            for _ in 0..128 {
                let mut header = ptr::null();
                let mut data = ptr::null();
                let result = unsafe { (api.next)(adapter.handle, &mut header, &mut data) };
                if result == 0 {
                    break;
                }
                if result != 1 {
                    return Err(api.error(adapter.handle));
                }
                if header.is_null() || data.is_null() {
                    return Err("Npcap returned an empty packet pointer.".into());
                }
                let size = unsafe { (*header).captured } as usize;
                if size > 65535 {
                    continue;
                }
                let packet = unsafe { std::slice::from_raw_parts(data, size) };
                let Some(segment) = tcp_segment(packet, adapter.link) else {
                    continue;
                };
                if !flows.contains(&segment.flow) {
                    continue;
                }
                busy = true;
                let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
                let observed = state.now();
                let captured = unsafe { &*header };
                if captured.seconds < 0 || !(0..1_000_000).contains(&captured.microseconds) {
                    continue;
                }
                let stamp = captured.seconds as u64 * 1000 + captured.microseconds as u64 / 1000;
                let now = packet_time(&mut timestamp_origin, stamp, observed);
                if state.generation != generation {
                    let entities = std::mem::take(&mut pipeline.decoder.entities);
                    let odyle = std::mem::take(&mut pipeline.decoder.odyle);
                    pipeline = Pipeline::default();
                    pipeline.decoder.entities = entities;
                    pipeline.decoder.odyle = odyle;
                    generation = state.generation;
                }
                if now < state.reset_ms {
                    continue;
                }
                pipeline.decoder.group_trace.enabled = state.group_trace.enabled;
                pipeline.decoder.group_trace.identity_mode = state.group_trace.identity_mode;
                let closed = segment.close;
                let hits = pipeline.ingest(segment, now);
                if closed {
                    pipeline.decoder.odyle = Default::default();
                    state.clear_odyle();
                    state.cubes.reset_connection();
                }
                state.receive_odyle(&pipeline.decoder.odyle, now);
                state
                    .group_trace
                    .append(pipeline.decoder.group_trace.take());
                let pet_observations = std::mem::take(&mut pipeline.decoder.pet_observations);
                let cube_observations = std::mem::take(&mut pipeline.decoder.cube_observations);
                if !closed {
                    let observed_ms = super::wall_clock();
                    state
                        .cubes
                        .receive(cube_observations, &pipeline.decoder.entities, observed_ms);
                    state.cubes.observe_facing(
                        &pet_observations,
                        &pipeline.decoder.entities,
                        observed_ms,
                    );
                }
                let pets = state.pets.clone();
                if state.entities.revision != pipeline.decoder.entities.revision
                    || state.entities.unparsed_roster != pipeline.decoder.entities.unparsed_roster
                    || state.entities.self_records != pipeline.decoder.entities.self_records
                    || state.entities.group_diagnostic != pipeline.decoder.entities.group_diagnostic
                {
                    state.entities = pipeline.decoder.entities.clone();
                }
                state.add_hits(now, hits)?;
                let observations = std::mem::take(&mut pipeline.decoder.observations);
                let epoch = state.epoch_ms;
                let Shared {
                    offline, entities, ..
                } = &mut *state;
                offline.receive(observations, entities, now, epoch);
                if state.meter.event_count() > 0 {
                    state.message="Collecting outgoing damage with observed identities and explicit summon ownership.".into();
                }
                drop(state);
                pets.lock().map_err(|_| "Pet state unavailable")?.receive(
                    pet_observations,
                    &pipeline.decoder.entities,
                    super::wall_clock(),
                );
                super::flush_storage(shared, false)?;
            }
        }
        if publish_at.elapsed().as_millis() >= 250 {
            let mut dropped = 0;
            for adapter in &adapters {
                let mut stats = [0u32; 8];
                if unsafe { (api.stats)(adapter.handle, stats.as_mut_ptr().cast()) } == 0 {
                    dropped += u64::from(stats[1]);
                }
            }
            publish(shared, &pipeline, adapters.len(), dropped)?;
            publish_at = Instant::now();
        }
        if !busy {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    let mut dropped = 0;
    for adapter in &adapters {
        let mut stats = [0u32; 8];
        if unsafe { (api.stats)(adapter.handle, stats.as_mut_ptr().cast()) } == 0 {
            dropped += u64::from(stats[1]);
        }
    }
    publish(shared, &pipeline, adapters.len(), dropped)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_intervals_do_not_change_with_processing_clock_rounding() {
        let mut origin = None;
        let start = packet_time(&mut origin, 100000, 1000);
        // The independently rounded processing clock can be a millisecond
        // behind the anchored packet clock without changing capture intervals.
        let end = packet_time(&mut origin, 118649, 19648);
        assert_eq!(end - start, 18649);
        let next = packet_time(&mut origin, 125000, 27000);
        assert_eq!(next - end, 6351);
    }
    #[test]
    fn driver_filters_are_narrow_and_keep_ipv6_address_family() {
        assert_eq!(bpf(&HashSet::new()).to_str().unwrap(), "tcp and port 0");
        let flow = Flow {
            source: [192, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            destination: [0; 16],
            source_port: 13328,
            destination_port: 50000,
            ipv6: false,
        };
        let filter = bpf(&HashSet::from([flow]));
        assert!(filter
            .to_str()
            .unwrap()
            .contains("src host 192.0.2.1 and src port 13328 and dst port 50000"));
        let ipv6 = Flow {
            source: [0x20, 1, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ipv6: true,
            ..flow
        };
        assert!(bpf(&HashSet::from([ipv6]))
            .to_str()
            .unwrap()
            .contains("src host 2001:db8::"));
    }
}
