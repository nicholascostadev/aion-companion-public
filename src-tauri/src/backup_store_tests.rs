use super::*;

struct Profile(PathBuf);
impl Profile {
    fn new() -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "aion-native-backup-test-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        fs::create_dir(path.join("offline")).unwrap();
        Self(path)
    }
    fn put(&self, path: &str, bytes: &[u8]) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn options() -> Value {
    json!({"settings":true,"pets":false,"logs":true})
}
fn archive() -> Archive {
    let root = Profile::new();
    root.put(
        "offline/settings.json",
        br#"{"hide_names":true,"locale":"pt-BR"}"#,
    );
    root.put(
        "offline/logs/fixture.json",
        br#"{"schema_version":1,"id":"fixture","events":[]}"#,
    );
    capture(&root.0, &options(), "stable", "0.7.9").unwrap()
}
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn id(s: &str) -> String {
    digest(s.as_bytes())
}
fn rewrite(entry: &mut Value, contents: &str) {
    entry["contents"] = contents.into();
    entry["bytes"] = contents.len().into();
    entry["sha256"] = digest(contents.as_bytes()).into();
}

#[test]
fn snapshot_roundtrip_preserves_exact_bytes_and_explicit_selection() {
    let source = Profile::new();
    source.put("offline/settings.json", b"{\n  \"hide_names\": true\n}\n");
    source.put("offline/active.json", b"excluded live checkpoint");
    source.put("offline/catalogue.json", b"excluded metadata");
    source.put("diagnostics/private.json", b"excluded support data");
    let archive = capture(&source.0, &options(), "stable", "0.7.9").unwrap();
    assert_eq!(archive.files.len(), 1);
    let decoded = decode(&bytes(&archive.value), "stable").unwrap();
    assert_eq!(decoded.files, archive.files);
    let plan = plan(&source.0, &options()).unwrap();
    assert_eq!(plan["files"].as_array().unwrap().len(), 1);
    let export_path = source.0.join("saved.aion-backup.json");
    export(&export_path, &archive).unwrap();
    assert_eq!(
        decode(&fs::read(export_path).unwrap(), "stable")
            .unwrap()
            .files,
        archive.files
    );
}

#[test]
fn retired_checklist_entries_are_verified_but_never_restored_or_exported() {
    let source = Profile::new();
    source.put("offline/settings.json", b"{}");
    source.put("checklist.json", b"retired local progress");
    let current = capture(&source.0, &options(), "stable", "0.7.9").unwrap();
    assert!(!allowed("checklist.json"));
    assert!(!current.files.contains_key("checklist.json"));

    let mut legacy = current.value;
    let mut retired = json!({"path":"checklist.json"});
    rewrite(
        &mut retired,
        r#"{"version":1,"revision":4,"profiles":{},"servers":{}}"#,
    );
    legacy["entries"].as_array_mut().unwrap().push(retired);
    let decoded = decode(&bytes(&legacy), "stable").unwrap();
    assert_eq!(decoded.files.len(), 1);
    let root = Profile::new();
    root.put("checklist.json", b"existing retired data");
    let preview = preview(&root.0, &decoded, "token").unwrap();
    assert_eq!(preview["files"].as_array().unwrap().len(), 1);
    stage(&root.0, &decoded, "stable", &id("legacy-checklist")).unwrap();
    let recovery = begin(&root.0, "stable").unwrap().unwrap();
    finish(&root.0, &recovery, true).unwrap();
    assert_eq!(
        fs::read(root.0.join("checklist.json")).unwrap(),
        b"existing retired data"
    );
    assert!(root.0.join("offline/settings.json").exists());

    legacy["entries"][1]["sha256"] = "0".repeat(64).into();
    assert!(decode(&bytes(&legacy), "stable").is_err());
    legacy["entries"].as_array_mut().unwrap().remove(0);
    let contents = legacy["entries"][0]["contents"]
        .as_str()
        .unwrap()
        .to_owned();
    rewrite(&mut legacy["entries"][0], &contents);
    assert!(decode(&bytes(&legacy), "stable")
        .err()
        .unwrap()
        .contains("no supported data"));
}

#[test]
fn interrupted_legacy_restore_can_roll_back_retired_progress() {
    let root = Profile::new();
    let tx = id("legacy-interrupted");
    stage(&root.0, &archive(), "stable", &tx).unwrap();
    let dir = tx_path(&root.0, &tx).unwrap();
    let original = b"original retired progress";
    fs::create_dir_all(dir.join("rollback")).unwrap();
    fs::write(dir.join("rollback/checklist.json"), original).unwrap();
    root.put("checklist.json", b"interrupted replacement");
    persistence::write_json(
        &dir.join("journal.json"),
        &json!({
            "schema_version":1,"phase":"applied",
            "entries":[{"path":"checklist.json","existed":true,"sha256":digest(original)}]
        }),
    )
    .unwrap();
    assert!(begin(&root.0, "stable").unwrap().is_none());
    assert_eq!(fs::read(root.0.join("checklist.json")).unwrap(), original);
    assert!(!pending(&root.0));
}

#[test]
fn rejects_corruption_future_schemas_cross_channel_and_wrong_native_file() {
    let original = archive().value;
    for change in [
        "checksum",
        "length",
        "schema",
        "channel",
        "file-schema",
        "file-kind",
    ] {
        let mut value = original.clone();
        match change {
            "checksum" => value["entries"][0]["sha256"] = "0".repeat(64).into(),
            "length" => value["entries"][0]["bytes"] = 0.into(),
            "schema" => value["schema_version"] = 2.into(),
            "channel" => value["channel"] = "development".into(),
            "file-schema" => rewrite(
                &mut value["entries"][0],
                r#"{"schema_version":2,"id":"fixture","events":[]}"#,
            ),
            "file-kind" => rewrite(&mut value["entries"][1], r#"{"not_a_setting":true}"#),
            _ => unreachable!(),
        }
        assert!(decode(&bytes(&value), "stable").is_err(), "{change}");
    }
    assert!(decode(b"{broken", "stable").is_err());
}

#[test]
fn rejects_duplicate_paths_traversal_devices_and_unlisted_state() {
    for path in [
        "../settings.json",
        "offline/../settings.json",
        "C:/state.json",
        "offline\\settings.json",
        "offline/active.json",
        "offline/index.json",
        "offline/logs/CON.json",
        "offline/logs/a/b.json",
        "recordings/a.replay.json",
    ] {
        assert!(!allowed(path), "{path}");
        let mut value = archive().value;
        value["entries"][0]["path"] = path.into();
        assert!(decode(&bytes(&value), "stable").is_err());
    }
    let mut value = archive().value;
    let entry = value["entries"][0].clone();
    value["entries"].as_array_mut().unwrap().push(entry);
    assert!(decode(&bytes(&value), "stable").is_err());
}

#[test]
fn staging_does_not_mutate_state_then_startup_applies_and_commits() {
    let root = Profile::new();
    let original = b"{\"hide_names\":false}";
    root.put("offline/settings.json", original);
    let archive = archive();
    let preview = preview(&root.0, &archive, "token").unwrap();
    assert!(preview["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["will_replace"] == true));
    stage(&root.0, &archive, "stable", &id("commit")).unwrap();
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        original
    );
    let recovery = begin(&root.0, "stable").unwrap().unwrap();
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        archive.files["offline/settings.json"]
    );
    finish(&root.0, &recovery, true).unwrap();
    assert!(!pending(&root.0));
    assert_eq!(last_result(&root.0).unwrap()["phase"], "restored");
    assert_eq!(
        fs::read(recovery.dir.join("rollback/offline/settings.json")).unwrap(),
        original
    );
    assert!(begin(&root.0, "stable").unwrap().is_none());
}

#[test]
fn interrupted_restore_rolls_back_original_bytes_and_removes_new_files() {
    let root = Profile::new();
    let original = b"corrupt old state is preserved byte for byte";
    root.put("offline/settings.json", original);
    stage(&root.0, &archive(), "stable", &id("interrupted")).unwrap();
    let recovery = begin(&root.0, "stable").unwrap().unwrap();
    assert!(root.0.join("offline/logs/fixture.json").exists());
    // Simulate process termination before successful application setup, then a new launch.
    drop(recovery);
    assert!(begin(&root.0, "stable").unwrap().is_none());
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        original
    );
    assert!(!root.0.join("offline/logs/fixture.json").exists());
    assert_eq!(last_result(&root.0).unwrap()["phase"], "rolled_back");
}

#[test]
fn replacement_failure_rolls_back_the_whole_batch() {
    let root = Profile::new();
    let original = br#"{"hide_names":false}"#;
    root.put("offline/settings.json", original);
    stage(&root.0, &archive(), "stable", &id("failure")).unwrap();
    let mut count = 0;
    let outcome = begin_with(&root.0, "stable", &mut |path, bytes| {
        count += 1;
        if count == 2 {
            return Err("Injected disk replacement failure".into());
        }
        persistence::atomic_bytes(path, bytes)
    })
    .unwrap();
    assert!(outcome.is_none());
    assert_eq!(count, 2);
    assert!(!root.0.join("offline/logs/fixture.json").exists());
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        original
    );
    assert!(!pending(&root.0));
}

#[test]
fn failed_application_setup_rolls_back_without_losing_rollback_copy() {
    let root = Profile::new();
    root.put("offline/settings.json", b"{}");
    stage(&root.0, &archive(), "stable", &id("boot-failure")).unwrap();
    let recovery = begin(&root.0, "stable").unwrap().unwrap();
    finish(&root.0, &recovery, false).unwrap();
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        b"{}"
    );
    assert!(recovery.dir.join("rollback/offline/settings.json").exists());
}

#[test]
fn replaced_logs_invalidate_only_derived_index_and_keep_unselected_logs() {
    let source = Profile::new();
    source.put(
        "offline/logs/fight-a.json",
        br#"{"schema_version":1,"id":"fight-a","label":"new","events":[]}"#,
    );
    let archive = capture(
        &source.0,
        &json!({"settings":false,"pets":false,"logs":true}),
        "stable",
        "0.7.9",
    )
    .unwrap();
    let root = Profile::new();
    root.put("offline/logs/fight-a.json", b"old selected log");
    root.put("offline/logs/fight-b.json", b"unselected log");
    root.put("offline/index.json", b"original index");
    stage(&root.0, &archive, "stable", &id("logs")).unwrap();
    let recovery = begin(&root.0, "stable").unwrap().unwrap();
    assert!(!root.0.join("offline/index.json").exists());
    assert_eq!(
        fs::read(root.0.join("offline/logs/fight-b.json")).unwrap(),
        b"unselected log"
    );
    finish(&root.0, &recovery, false).unwrap();
    assert_eq!(
        fs::read(root.0.join("offline/index.json")).unwrap(),
        b"original index"
    );
    assert_eq!(
        fs::read(root.0.join("offline/logs/fight-a.json")).unwrap(),
        b"old selected log"
    );
}

#[test]
fn changed_staged_backup_is_rejected_before_mutation() {
    let root = Profile::new();
    root.put("offline/settings.json", b"{}");
    let tx = id("corrupt-staged");
    stage(&root.0, &archive(), "stable", &tx).unwrap();
    fs::write(
        tx_path(&root.0, &tx).unwrap().join("incoming.json"),
        b"{invalid",
    )
    .unwrap();
    assert!(begin(&root.0, "stable").unwrap().is_none());
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        b"{}"
    );
    assert_eq!(last_result(&root.0).unwrap()["phase"], "failed");
}

#[test]
fn unavailable_staged_input_does_not_trap_the_original_profile() {
    let root = Profile::new();
    root.put("offline/settings.json", b"{}");
    let tx = id("missing-staged");
    stage(&root.0, &archive(), "stable", &tx).unwrap();
    fs::remove_file(tx_path(&root.0, &tx).unwrap().join("incoming.json")).unwrap();
    assert!(begin(&root.0, "stable").unwrap().is_none());
    assert!(!pending(&root.0));
    assert_eq!(
        fs::read(root.0.join("offline/settings.json")).unwrap(),
        b"{}"
    );
    assert_eq!(last_result(&root.0).unwrap()["phase"], "failed");
}

#[test]
fn invalid_selection_and_large_files_do_not_create_a_backup() {
    let root = Profile::new();
    assert!(plan(&root.0, &json!({"settings":true})).is_err());
    assert!(capture(&root.0, &options(), "stable", "0.7.9").is_err());
    let file = fs::File::create(root.0.join("offline/settings.json")).unwrap();
    file.set_len(FILE_BYTES + 1).unwrap();
    assert_eq!(
        plan(&root.0, &options()).unwrap()["files"][0]["bytes"],
        FILE_BYTES + 1
    );
    assert!(capture(&root.0, &options(), "stable", "0.7.9").is_err());
}
