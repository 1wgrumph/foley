use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (repo, steps) = match args.as_slice() {
        [a, repo, b, steps] if a == "--repo" && b == "--steps" => (repo, steps),
        _ => {
            eprintln!("usage: bran-media-evidence --repo <repo-dir> --steps <steps.json>");
            return ExitCode::from(2);
        }
    };
    match bran_media_evidence::locate(&PathBuf::from(repo), &PathBuf::from(steps)) {
        Ok(document) => {
            println!("{document}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("bran-media-evidence: {error}");
            ExitCode::FAILURE
        }
    }
}
