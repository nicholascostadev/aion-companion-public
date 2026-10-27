//! Receive-only validation of the richer offline collector, without opening any UI.
use companion_capture::LiveCapture;
use serde_json::json;
fn main()->Result<(),String>{
    let folder=std::env::args_os().nth(1).ok_or("Pass a local diagnostic folder")?;
    let folder=std::path::PathBuf::from(folder);std::fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    let seconds=std::env::args().nth(2).and_then(|n|n.parse::<u64>().ok()).unwrap_or(120).clamp(1,600);
    let capture=LiveCapture::default();capture.initialize_offline(folder.join("library"))?;capture.start(13328)?;
    let start=std::time::Instant::now();while start.elapsed().as_secs()<seconds{
        let status=json!({"offline":capture.offline_status()?,"group":capture.group_snapshot()?,"identity":capture.identity_diagnostic()?,"live":capture.snapshot()?});
        let tmp=folder.join("status.pending");std::fs::write(&tmp,serde_json::to_vec(&status).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        std::fs::rename(tmp,folder.join("status.json")).map_err(|e|e.to_string())?;
        std::thread::sleep(std::time::Duration::from_secs(1));
    }capture.stop()?;let result=capture.offline_status()?;println!("{}",json!({"library_count":result["library_count"],"coverage":result["report"]["coverage"],"events":result["report"]["events"].as_array().map(Vec::len),"error":result["error"]}));Ok(())
}
