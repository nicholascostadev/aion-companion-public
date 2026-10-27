use std::{env, process::Command};

fn git(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_default()
}

fn main() {
    // Both tauri-build and the context macro must see the same identity, even
    // for direct Cargo builds. This also isolates WebView storage.
    if cfg!(feature = "development") {
        let mut config: serde_json::Value = env::var("TAURI_CONFIG")
            .ok()
            .map(|value| serde_json::from_str(&value).expect("Invalid TAURI_CONFIG"))
            .unwrap_or_else(|| serde_json::json!({}));
        config["identifier"] = "org.aioncompanion.development".into();
        config["productName"] = "Aion Companion Dev".into();
        let config = config.to_string();
        env::set_var("TAURI_CONFIG", &config);
        println!("cargo:rustc-env=TAURI_CONFIG={config}");
    }
    let head = git(&["rev-parse", "--git-path", "HEAD"]);
    if !head.is_empty() {
        println!("cargo:rerun-if-changed={head}");
    }
    let branch = git(&["branch", "--show-current"]);
    if !branch.is_empty() {
        let reference = git(&["rev-parse", "--git-path", &format!("refs/heads/{branch}")]);
        println!("cargo:rerun-if-changed={reference}");
    }
    println!("cargo:rustc-env=AION_BUILD_BRANCH={branch}");
    println!(
        "cargo:rustc-env=AION_BUILD_REVISION={}",
        git(&["rev-parse", "--short=8", "HEAD"])
    );
    tauri_build::build();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // tauri-build links the resource/manifest into binaries. Native WebView examples
        // need that same Common Controls v6 activation context before their entry point.
        let resource =
            std::path::PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"))
                .join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resource.display());
    }
}
