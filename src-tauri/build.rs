use std::path::Path;
use std::process::Command;

/// Build provenance (APP-22).
///
/// An installed bundle carries no other evidence of which commit produced it:
/// `CFBundleShortVersionString` is `0.1.0` on every build this project has ever
/// made, so "does this app contain that merge?" has until now been answered by
/// reading the bundle's file timestamp and hoping. These two values make it a
/// fact you can read instead.
///
/// `SIMPLEMARK_BUILD_SHA` may be supplied by the caller, and
/// `scripts/install-main.sh` always does. That is deliberate rather than
/// redundant: this script's working directory is one checkout among many on a
/// machine that carries a worktree per task, and the installer's whole promise
/// is that the bundle came from `origin/main` specifically. Letting the caller
/// state the commit keeps the promise with the one who can actually prove it,
/// and `rerun-if-env-changed` means a different commit forces a real rebuild
/// rather than reusing an artifact stamped with the previous one.
///
/// `unknown` is an expected value, not a failure being papered over. A build
/// from a source archive has no git metadata at all, and a bundle that names a
/// commit it could not read would be worse than one that admits it has none.
fn main() {
    println!("cargo:rustc-env=SIMPLEMARK_BUILD_SHA={}", resolve_sha());
    println!("cargo:rustc-env=SIMPLEMARK_BUILD_TIME={}", build_time());
    println!(
        "cargo:rustc-env=SIMPLEMARK_BUILD_REPOSITORY={}",
        resolve_repository()
    );

    println!("cargo:rerun-if-env-changed=SIMPLEMARK_BUILD_SHA");
    println!("cargo:rerun-if-env-changed=SIMPLEMARK_BUILD_REPOSITORY");
    // Best effort only: a plain checkout moves HEAD, but a commit on the branch
    // you are already on moves a ref file this cannot name in advance. The
    // installer's explicit env var is what actually guarantees freshness; these
    // only spare an ordinary local rebuild from going stale.
    for path in ["../.git/HEAD", "../.git/ORIG_HEAD"] {
        if Path::new(path).exists() {
            println!("cargo:rerun-if-changed={path}");
        }
    }

    tauri_build::build()
}

fn resolve_sha() -> String {
    if let Some(supplied) = supplied("SIMPLEMARK_BUILD_SHA") {
        return supplied;
    }
    git(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".to_string())
}

/// UTC, second resolution, no added dependency. `date` is POSIX and this build
/// already requires a shell toolchain to exist.
fn build_time() -> String {
    if let Some(supplied) = supplied("SIMPLEMARK_BUILD_TIME") {
        return supplied;
    }
    run("date", &["-u", "+%Y-%m-%dT%H:%M:%SZ"]).unwrap_or_else(|| "unknown".to_string())
}

/// Which repository this build should ask about updates, as `owner/name`.
///
/// Read from the build's own `origin` rather than written into the source. The
/// canonical repository is private, and `scripts/mirror` refuses to publish any
/// source naming it — so a constant would either leak the private identity into
/// the public mirror or have to be wrong there. Reading the remote is also the
/// behaviour a fork wants: it checks itself, with no configuration, and the
/// public mirror checks the public mirror.
///
/// `unknown` when there is no git, no remote, or an unrecognised URL shape. The
/// update check then reports that it cannot run rather than guessing a target.
fn resolve_repository() -> String {
    if let Some(supplied) = supplied("SIMPLEMARK_BUILD_REPOSITORY") {
        return supplied;
    }
    git(&["remote", "get-url", "origin"])
        .and_then(|url| normalise_repository(&url))
        .unwrap_or_else(|| "unknown".to_string())
}

/// `owner/name` from either remote form, HTTPS or SSH.
fn normalise_repository(url: &str) -> Option<String> {
    let without_suffix = url.trim().strip_suffix(".git").unwrap_or(url.trim());
    // `git@host:owner/name` and `https://host/owner/name` both end in the two
    // segments we want, so take them from the end rather than parsing the host.
    let tail = without_suffix
        .rsplit(['/', ':'])
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    if tail.len() != 2 || tail.iter().any(|part| part.is_empty()) {
        return None;
    }
    Some(tail.join("/"))
}

fn supplied(name: &str) -> Option<String> {
    let value = std::env::var(name).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn git(args: &[&str]) -> Option<String> {
    run("git", args)
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
