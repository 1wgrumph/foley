use bran_media_evidence::locate;
use std::path::Path;
use std::process::Command;

#[test]
fn library_and_cli_agree_on_owned_fixture() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/app");
    let steps =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/stages/archive-steps.json");
    let first = locate(&repo, &steps).expect("locate fixture");
    assert_eq!(first, locate(&repo, &steps).expect("repeat locate"));
    assert!(first.contains("foley.anchors/1"));
    assert!(first.contains("logic.mjs"));
    let result = Command::new(env!("CARGO_BIN_EXE_bran-media-evidence"))
        .args([
            "--repo",
            repo.to_str().unwrap(),
            "--steps",
            steps.to_str().unwrap(),
        ])
        .output()
        .expect("run adapter");
    assert!(result.status.success());
    assert_eq!(
        first.trim(),
        String::from_utf8(result.stdout).unwrap().trim()
    );
}
