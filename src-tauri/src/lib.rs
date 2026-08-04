//! The operating-system bridge for SimpleMark (APP-2).
//!
//! This crate is a thin transport, exactly like the MCP adapter: it opens a
//! file, writes bytes atomically, and reports when the file changed underneath
//! us. It holds no document model, no editor state, and no Markdown knowledge —
//! every document rule lives in the shared TypeScript modules that both shells
//! load (ADR-0001).
//!
//! Two rules shape everything here:
//!
//! * **Bytes, not strings.** The D7 fidelity contract is defined in bytes, so
//!   the boundary carries base64 rather than a decoded `String`. A lone CR, an
//!   invalid UTF-8 sequence, or a missing final newline survives the round trip.
//! * **Coarse commands.** `open_note` and `save_note` are whole-document
//!   operations called on the same debounce the browser shell uses. There is
//!   deliberately no per-keystroke IPC.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, Url};
use tauri_plugin_dialog::DialogExt;

/// Which commit produced this bundle, captured at compile time by `build.rs`.
///
/// Reported, never interpreted. The shell decides how to say it; this only
/// carries what the build knew. `sha` is `unknown` when the build had no git
/// metadata to read, which the shell must show as-is rather than hide.
#[derive(Serialize)]
pub struct BuildProvenance {
    sha: String,
    short_sha: String,
    built_at: String,
    /// `owner/name` this build came from, or `unknown`. Read from the build's
    /// own remote so no source file names the private canonical repository.
    repository: String,
}

/// The commit and time this binary was built from.
#[tauri::command]
fn build_provenance() -> BuildProvenance {
    let sha = env!("SIMPLEMARK_BUILD_SHA").to_string();
    BuildProvenance {
        short_sha: short_sha(&sha),
        sha,
        built_at: env!("SIMPLEMARK_BUILD_TIME").to_string(),
        repository: env!("SIMPLEMARK_BUILD_REPOSITORY").to_string(),
    }
}

/// Seven characters, git's own abbreviation, except for the honest non-SHA
/// values — truncating `unknown` to `unknow` would read like a real commit.
fn short_sha(sha: &str) -> String {
    if sha.len() >= 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        sha[..7].to_string()
    } else {
        sha.to_string()
    }
}

/// A document handed to the shared application layer.
///
/// `handle` is the absolute path. It is opaque to the TypeScript side, which
/// only ever passes it back to `save_note` — the same contract the browser
/// port's opaque `fsa:N` handles satisfy.
#[derive(Serialize)]
pub struct OpenedNote {
    handle: String,
    name: String,
    /// Base64 of the file's exact bytes.
    bytes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCatalogEntry {
    handle: String,
    name: String,
    modified_ms: u64,
    created_ms: u64,
}

#[derive(Serialize)]
pub struct WorkspaceCatalog {
    handle: String,
    name: String,
    notes: Vec<WorkspaceCatalogEntry>,
}

/// What this process last wrote to each path, so the watcher can tell our own
/// saves apart from someone else's edit.
#[derive(Clone, Default)]
pub struct WriteLedger(Arc<Mutex<HashMap<PathBuf, u64>>>);

/// Owns the one filesystem watcher associated with the current document.
///
/// Reopening or switching a note replaces the previous generation and signals
/// its thread to stop. The stop sender also disconnects during application
/// teardown, so no detached watcher can outlive Tauri's managed state.
#[derive(Default)]
pub struct NoteWatchControl(Mutex<Option<ActiveNoteWatch>>);

struct ActiveNoteWatch {
    path: PathBuf,
    stop: Sender<()>,
}

fn watcher_was_stopped(stop: &Receiver<()>) -> bool {
    matches!(stop.try_recv(), Ok(()) | Err(TryRecvError::Disconnected))
}

fn active_note_watch_matches(active: &Option<ActiveNoteWatch>, path: &Path) -> bool {
    active.as_ref().is_some_and(|watch| watch.path == path)
}

fn replace_active_note_watch(
    active: &mut Option<ActiveNoteWatch>,
    path: PathBuf,
    stop: Sender<()>,
) {
    if let Some(previous) = active.replace(ActiveNoteWatch { path, stop }) {
        let _ = previous.stop.send(());
    }
}

fn stop_active_note_watch(active: &mut Option<ActiveNoteWatch>) -> bool {
    let Some(watch) = active.take() else {
        return false;
    };
    let _ = watch.stop.send(());
    true
}

/// Finder may hand the app a file before the webview has installed listeners.
/// Keep those paths until the TypeScript composition root explicitly takes
/// them; the event is only a wake-up signal, never the durable delivery path.
#[derive(Default)]
pub struct OpenRequestQueue(Mutex<VecDeque<PathBuf>>);

fn content_hash(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Prompts for one Markdown file and returns its exact bytes.
#[tauri::command]
async fn open_note(app: AppHandle) -> Result<Option<OpenedNote>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

    let Some(picked) = picked else {
        // A cancelled picker is an ordinary outcome, not an error. The shell
        // leaves the current document exactly as it was.
        return Ok(None);
    };

    let path = picked
        .into_path()
        .map_err(|error| format!("That selection has no readable path: {error}"))?;

    read_note(&path).map(Some)
}

/// Prompts for a folder whose direct Markdown children become one collection.
///
/// Picking a folder is deliberately separate from opening a file: opening
/// `Downloads/example.md` must never imply permission to adopt every Markdown
/// file in Downloads.
#[tauri::command]
async fn open_workspace_folder(app: AppHandle) -> Result<Option<WorkspaceCatalog>, String> {
    let picked = app.dialog().file().blocking_pick_folder();

    let Some(picked) = picked else {
        return Ok(None);
    };

    let directory = picked
        .into_path()
        .map_err(|error| format!("That folder has no readable path: {error}"))?;
    workspace_catalog_for_directory(&directory).map(Some)
}

/// Reads a note that is already chosen — used by reopen and by the watcher.
#[tauri::command]
fn read_note_at(path: String) -> Result<OpenedNote, String> {
    read_note(Path::new(&path))
}

fn read_note(path: &Path) -> Result<OpenedNote, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    Ok(OpenedNote {
        handle: path.display().to_string(),
        name,
        bytes: BASE64.encode(&bytes),
    })
}

#[derive(Debug, PartialEq)]
enum ResolvedDocumentLink {
    External(String),
    Local(PathBuf),
}

/// Resolves portable Markdown links at click time from the note's current
/// location. The Markdown never receives this absolute path; moving the whole
/// folder to another device therefore keeps the same relative source valid.
fn resolve_document_link(
    document_handle: &str,
    href: &str,
) -> Result<ResolvedDocumentLink, String> {
    let href = href.trim();
    if href.is_empty() {
        return Err("The link has no destination".to_string());
    }

    if let Ok(url) = Url::parse(href) {
        return match url.scheme() {
            "http" | "https" | "mailto" => Ok(ResolvedDocumentLink::External(url.to_string())),
            "file" => Err(
                "Absolute file links are tied to one machine; use a relative Markdown path"
                    .to_string(),
            ),
            scheme => Err(format!("Links using {scheme}: are not allowed")),
        };
    }

    let raw_path = Path::new(href.split(['?', '#']).next().unwrap_or_default());
    if raw_path.is_absolute() || href.starts_with('~') {
        return Err(
            "Absolute file links are tied to one machine; use a relative Markdown path".to_string(),
        );
    }

    let document = Path::new(document_handle);
    let base = document
        .parent()
        .ok_or_else(|| "The open document has no containing folder".to_string())?;
    let base_url = Url::from_directory_path(base)
        .map_err(|_| "The document folder cannot resolve relative links".to_string())?;
    let target_url = base_url
        .join(href)
        .map_err(|error| format!("The relative link is invalid: {error}"))?;
    if target_url.scheme() != "file" {
        return Err("The link does not resolve to a local file".to_string());
    }
    let target = target_url
        .to_file_path()
        .map_err(|_| "The local link is not a valid file path".to_string())?
        .canonicalize()
        .map_err(|error| format!("Linked file is unavailable: {error}"))?;
    Ok(ResolvedDocumentLink::Local(target))
}

fn open_with_system(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("Opening links is not supported on this platform".to_string());

    command
        .arg(target)
        .spawn()
        .map_err(|error| format!("The operating system could not open the link: {error}"))?;
    Ok(())
}

#[tauri::command]
fn open_document_link(app: AppHandle, document_handle: String, href: String) -> Result<(), String> {
    let resolved = resolve_document_link(&document_handle, &href)?;
    match resolved {
        ResolvedDocumentLink::External(url) => open_with_system(&url),
        ResolvedDocumentLink::Local(path) if is_markdown(&path) => {
            // Markdown stays in this window regardless of the user's global
            // Finder association. The existing queue is the sole open route.
            queue_opened_paths(&app, vec![path]);
            Ok(())
        }
        ResolvedDocumentLink::Local(path) => open_with_system(&path.to_string_lossy()),
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn millis(time: Result<SystemTime, std::io::Error>) -> u64 {
    time.ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn catalog_entry(path: &Path) -> Result<WorkspaceCatalogEntry, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    Ok(WorkspaceCatalogEntry {
        handle: path.display().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        modified_ms: millis(metadata.modified()),
        created_ms: millis(metadata.created()),
    })
}

fn inspected_workspace_note(path: &Path) -> Result<WorkspaceCatalog, String> {
    let directory = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    Ok(WorkspaceCatalog {
        handle: directory.display().to_string(),
        name: directory
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| directory.display().to_string()),
        notes: vec![catalog_entry(path)?],
    })
}

fn workspace_catalog(path: &Path) -> Result<WorkspaceCatalog, String> {
    let directory = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    workspace_catalog_for_directory(directory)
}

fn workspace_catalog_for_directory(directory: &Path) -> Result<WorkspaceCatalog, String> {
    let mut notes = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Could not list {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let note_path = entry.path();
        if !note_path.is_file() || !is_markdown(&note_path) {
            continue;
        }
        notes.push(catalog_entry(&note_path)?);
    }
    notes.sort_by(|left, right| {
        right
            .modified_ms
            .cmp(&left.modified_ms)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(WorkspaceCatalog {
        handle: directory.display().to_string(),
        name: directory
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| directory.display().to_string()),
        notes,
    })
}

#[tauri::command]
fn list_workspace(handle: String) -> Result<WorkspaceCatalog, String> {
    workspace_catalog(Path::new(&handle))
}

#[tauri::command]
fn list_workspace_folder(handle: String) -> Result<WorkspaceCatalog, String> {
    workspace_catalog_for_directory(Path::new(&handle))
}

#[tauri::command]
fn inspect_workspace_note(handle: String) -> Result<WorkspaceCatalog, String> {
    inspected_workspace_note(Path::new(&handle))
}

#[tauri::command]
fn create_note(workspace_handle: String) -> Result<OpenedNote, String> {
    let directory = PathBuf::from(&workspace_handle);
    for number in 1..=10_000 {
        let name = if number == 1 {
            "Untitled.md".to_string()
        } else {
            format!("Untitled {number}.md")
        };
        let path = directory.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(b"# New note\n\n")
                    .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
                file.sync_all()
                    .map_err(|error| format!("Could not finish {}: {error}", path.display()))?;
                return read_note(&path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create {}: {error}", path.display())),
        }
    }
    Err("Could not choose a unique Untitled note name".to_string())
}

#[tauri::command]
fn duplicate_note(handle: String) -> Result<OpenedNote, String> {
    let source = PathBuf::from(&handle);
    let directory = source
        .parent()
        .ok_or_else(|| format!("{handle} has no parent folder"))?;
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{handle} has no file name"))?;
    let extension = source
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "md".to_string());

    for number in 1..=10_000 {
        let suffix = if number == 1 {
            " copy".to_string()
        } else {
            format!(" copy {number}")
        };
        let destination = directory.join(format!("{stem}{suffix}.{extension}"));
        if destination.exists() {
            continue;
        }
        fs::copy(&source, &destination).map_err(|error| {
            format!(
                "Could not duplicate {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
        return read_note(&destination);
    }

    Err("Could not choose an unused duplicate name".to_string())
}

#[tauri::command]
async fn export_note(app: AppHandle, handle: String) -> Result<bool, String> {
    let source = PathBuf::from(&handle);
    let name = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note.md".to_string());
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(false);
    };
    let destination = picked
        .into_path()
        .map_err(|error| format!("That export destination has no writable path: {error}"))?;
    fs::copy(&source, &destination).map_err(|error| {
        format!(
            "Could not export {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(true)
}

#[tauri::command]
async fn trash_note(handle: String) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    move_note_to_trash(path).map_err(|error| format!("Could not move {handle} to Trash: {error}"))
}

/// Reveals a note or folder in the platform file manager, with the item
/// selected where the platform supports that (Finder, Explorer).
#[tauri::command]
async fn reveal_in_finder(handle: String) -> Result<(), String> {
    let path = PathBuf::from(&handle);

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("Could not reveal {handle} in Finder: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let mut argument = std::ffi::OsString::from("/select,");
        argument.push(path.as_os_str());
        Command::new("explorer")
            .arg(argument)
            .spawn()
            .map_err(|error| format!("Could not reveal {handle} in Explorer: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open has no cross-desktop "reveal and select" verb, so open the
        // containing folder — the closest portable equivalent.
        let directory = path.parent().unwrap_or(&path);
        Command::new("xdg-open")
            .arg(directory)
            .spawn()
            .map_err(|error| format!("Could not reveal {handle}: {error}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Err("Revealing files is not supported on this platform".to_string())
}

fn move_note_to_trash(path: PathBuf) -> Result<(), trash::Error> {
    // trash-rs defaults to scripting Finder on macOS. That adds an Automation
    // permission prompt and can leave the app waiting for an AppleEvent timeout.
    // NSFileManager is the native, permission-free Trash operation and keeps
    // this ordinary note action immediate.
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};

        let mut context = trash::TrashContext::new();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(path)
    }

    #[cfg(not(target_os = "macos"))]
    trash::delete(path)
}

/// Returns the next file macOS asked SimpleMark to open.
#[tauri::command]
fn take_open_note_request(queue: State<'_, OpenRequestQueue>) -> Result<Option<String>, String> {
    let path = queue
        .0
        .lock()
        .map_err(|_| "The open-file queue was poisoned by an earlier panic".to_string())?
        .pop_front();
    Ok(path.map(|path| path.display().to_string()))
}

fn opened_markdown_paths(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    extension.eq_ignore_ascii_case("md")
                        || extension.eq_ignore_ascii_case("markdown")
                })
        })
        .collect()
}

fn opened_markdown_args(args: &[String], cwd: &str) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter_map(|arg| {
            if let Ok(url) = Url::parse(arg) {
                return url.to_file_path().ok();
            }
            let path = PathBuf::from(arg);
            Some(if path.is_absolute() {
                path
            } else {
                Path::new(cwd).join(path)
            })
        })
        .filter(|path| is_markdown(path))
        .collect()
}

fn queue_opened_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }

    let queued = app
        .state::<OpenRequestQueue>()
        .0
        .lock()
        .map(|mut queue| queue.extend(paths))
        .is_ok();
    if !queued {
        return;
    }

    // The queue prevents launch-time loss. This event lets an already-running
    // webview react immediately without polling.
    let _ = app.emit("open-note-requested", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn queue_opened_notes(app: &AppHandle, urls: &[Url]) {
    queue_opened_paths(app, opened_markdown_paths(urls));
}

/// Writes bytes atomically: temp file in the same directory, fsync, rename.
///
/// Same directory matters — `rename` is only atomic within a filesystem, and a
/// temp file in `/tmp` can land on a different volume. fsync before the rename
/// is what makes the rename safe rather than merely quick: without it the
/// rename can be durable while the contents are not, which is how a crash
/// produces an empty note.
#[tauri::command]
fn save_note(handle: String, bytes: String, ledger: State<'_, WriteLedger>) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    let decoded = BASE64
        .decode(bytes.as_bytes())
        .map_err(|error| format!("Rejected a malformed payload for {handle}: {error}"))?;

    let directory = path
        .parent()
        .ok_or_else(|| format!("{handle} has no parent directory to stage a write in"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{handle} is not a file path"))?
        .to_string_lossy()
        .into_owned();

    let temp = directory.join(format!(".{file_name}.simplemark-tmp"));

    // Record before the rename: the watcher may fire the moment it lands, and
    // an unrecorded write would look to us like somebody else's edit.
    ledger
        .0
        .lock()
        .map_err(|_| "The write ledger was poisoned by an earlier panic".to_string())?
        .insert(path.clone(), content_hash(&decoded));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = File::create(&temp)?;
        file.write_all(&decoded)?;
        file.sync_all()?;
        drop(file);
        // Preserve the original file's permissions rather than inheriting the
        // temp file's; a saved note must not change mode behind your back.
        if let Ok(existing) = fs::metadata(&path) {
            let _ = fs::set_permissions(&temp, existing.permissions());
        }
        fs::rename(&temp, &path)
    })();

    if let Err(error) = write_result {
        // Never leave debris behind a failed save, and never report success.
        let _ = fs::remove_file(&temp);
        return Err(format!("Not saved — {}: {error}", path.display()));
    }

    Ok(())
}

/// Watches one note and emits `note-changed-externally` when somebody else
/// writes it.
///
/// The event carries only the path. The shared application layer decides what a
/// change means; this crate must not reach into the document to apply it.
#[tauri::command]
fn watch_note(
    app: AppHandle,
    handle: String,
    ledger: State<'_, WriteLedger>,
    control: State<'_, NoteWatchControl>,
) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    let directory = path
        .parent()
        .ok_or_else(|| format!("{handle} has no parent directory to watch"))?
        .to_path_buf();

    let mut active = control
        .0
        .lock()
        .map_err(|_| "The note watcher registry was poisoned by an earlier panic".to_string())?;
    if active_note_watch_matches(&active, &path) {
        return Ok(());
    }

    // Establish the replacement before retiring the old watcher. A setup
    // failure must leave the known-good watcher running and be visible to the
    // caller rather than silently disabling external-change detection.
    let (event_sender, event_receiver) = channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(event_sender)
        .map_err(|error| format!("Could not watch {handle}: {error}"))?;
    // Watch the directory, not the file: editors that save by rename replace
    // the inode, and a file watch would follow the old one into oblivion.
    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|error| format!("Could not watch {}: {error}", directory.display()))?;

    let (stop_sender, stop_receiver) = channel::<()>();
    replace_active_note_watch(&mut active, path.clone(), stop_sender);
    drop(active);

    // Clone the narrow state this worker needs. It never reaches back through
    // `AppHandle::state`, whose missing-state path intentionally panics during
    // teardown.
    let ledger = ledger.inner().clone();
    std::thread::spawn(move || {
        // Moving `watcher` into the worker makes its lifetime explicit: notify
        // stops monitoring when this loop exits and the watcher is dropped.
        let _watcher = watcher;
        loop {
            if watcher_was_stopped(&stop_receiver) {
                break;
            }

            let event = match event_receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(event) => event,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            };

            let Ok(event) = event else { continue };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                continue;
            }
            if !event.paths.iter().any(|changed| changed == &path) {
                continue;
            }

            // Coalesce: one logical save produces several filesystem events.
            std::thread::sleep(Duration::from_millis(120));
            if watcher_was_stopped(&stop_receiver) {
                break;
            }

            let Ok(current) = fs::read(&path) else {
                continue;
            };
            let hash = content_hash(&current);

            let ours = ledger
                .0
                .lock()
                .map(|ledger| ledger.get(&path).copied() == Some(hash))
                .unwrap_or(false);
            if ours {
                continue;
            }

            let _ = app.emit("note-changed-externally", handle.clone());
        }
    });

    Ok(())
}

/// Stops watching when the document pane no longer owns a real file.
///
/// Switching directly to another note uses `watch_note`, which replaces the
/// prior generation atomically. This command is only for the zero-selection
/// state after the final visible note is closed.
#[tauri::command]
fn stop_watching_note(control: State<'_, NoteWatchControl>) -> Result<(), String> {
    let mut active = control
        .0
        .lock()
        .map_err(|_| "The note watcher registry was poisoned by an earlier panic".to_string())?;
    stop_active_note_watch(&mut active);
    Ok(())
}

/// Watches one explicitly adopted folder for Markdown membership changes.
///
/// The event names the folder only. TypeScript re-lists it through the catalog
/// port, keeping filesystem observation out of the shared application model.
#[tauri::command]
fn watch_workspace_folder(app: AppHandle, handle: String) -> Result<(), String> {
    let directory = PathBuf::from(&handle);
    if !directory.is_dir() {
        return Err(format!("{handle} is not a readable folder"));
    }

    std::thread::spawn(move || {
        let (sender, receiver) = channel::<notify::Result<Event>>();
        let Ok(mut watcher) = notify::recommended_watcher(sender) else {
            return;
        };
        if watcher
            .watch(&directory, RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }

        for event in receiver {
            let Ok(event) = event else { continue };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                continue;
            }
            if !event.paths.iter().any(|path| is_markdown(path)) {
                continue;
            }
            std::thread::sleep(Duration::from_millis(120));
            let _ = app.emit("workspace-folder-changed", directory.display().to_string());
        }
    });

    Ok(())
}

/// Raises the operating system's print panel for the document window.
///
/// This exists because WKWebView leaves the webview's own `window.print()`
/// unanswered — the browser shell's one-liner has no macOS equivalent, so the
/// panel must be opened from the native side. It stays a transport all the
/// same: pagination, what is hidden, and what a page looks like are decided by
/// the shared print stylesheet, and this function neither reads the document
/// nor knows that it is Markdown.
#[tauri::command]
fn print_note(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|error| format!("Could not open the print panel: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Must be the first plugin. A Finder open while SimpleMark is already
        // running is a document transition in that window, never permission
        // to create a second application process and another main window.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_opened_paths(app, opened_markdown_args(&args, &cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(WriteLedger::default())
        .manage(NoteWatchControl::default())
        .manage(OpenRequestQueue::default())
        .invoke_handler(tauri::generate_handler![
            open_note,
            open_workspace_folder,
            read_note_at,
            open_document_link,
            inspect_workspace_note,
            list_workspace,
            list_workspace_folder,
            create_note,
            duplicate_note,
            export_note,
            trash_note,
            reveal_in_finder,
            take_open_note_request,
            save_note,
            print_note,
            build_provenance,
            watch_note,
            stop_watching_note,
            watch_workspace_folder
        ])
        .build(tauri::generate_context!())
        .expect("SimpleMark failed to start");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            queue_opened_notes(app, &urls);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The D7 contract in the one place this crate can break it.
    #[test]
    fn round_trips_bytes_that_a_string_would_destroy() {
        let awkward: Vec<u8> = vec![b'a', b'\r', 0xF0, 0x9F, 0x92, 0xA9, 0xFF, b'\n'];
        let encoded = BASE64.encode(&awkward);
        assert_eq!(BASE64.decode(encoded.as_bytes()).unwrap(), awkward);
    }

    /// The bundle must be able to name its own commit — that is the entire
    /// point of APP-22, and a build that silently lost the stamp would look
    /// exactly like a working one until somebody trusted a stale app.
    #[test]
    fn the_build_stamps_a_commit_and_a_time() {
        let provenance = build_provenance();
        assert!(!provenance.sha.is_empty());
        assert!(!provenance.built_at.is_empty());
        assert_eq!(provenance.short_sha, short_sha(&provenance.sha));
    }

    #[test]
    fn short_sha_abbreviates_commits_and_leaves_non_commits_intact() {
        assert_eq!(
            short_sha("7670ea436b308c4ba6669ddc47c54565deb6fa26"),
            "7670ea4"
        );
        // Never abbreviate the honest fallback into something SHA-shaped.
        assert_eq!(short_sha("unknown"), "unknown");
    }

    #[test]
    fn identical_content_hashes_identically() {
        assert_eq!(content_hash(b"# note\n"), content_hash(b"# note\n"));
        assert_ne!(content_hash(b"# note\n"), content_hash(b"# note"));
    }

    #[test]
    fn replacing_note_watcher_cancels_the_previous_generation() {
        let (first_stop, first_stopped) = channel();
        let (second_stop, second_stopped) = channel();
        let mut active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/first.md"),
            stop: first_stop,
        });

        replace_active_note_watch(&mut active, PathBuf::from("/tmp/second.md"), second_stop);

        assert_eq!(
            first_stopped.recv_timeout(Duration::from_millis(20)),
            Ok(())
        );
        assert!(matches!(
            second_stopped.try_recv(),
            Err(TryRecvError::Empty)
        ));
        assert_eq!(
            active.as_ref().map(|watch| watch.path.as_path()),
            Some(Path::new("/tmp/second.md"))
        );
    }

    #[test]
    fn reopening_the_same_note_deduplicates_its_watcher() {
        let (stop, _stopped) = channel();
        let active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/note.md"),
            stop,
        });

        assert!(active_note_watch_matches(
            &active,
            Path::new("/tmp/note.md")
        ));
        assert!(!active_note_watch_matches(
            &active,
            Path::new("/tmp/other.md")
        ));
    }

    #[test]
    fn dropping_note_watcher_control_stops_the_worker() {
        let (stop, stopped) = channel();
        let active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/note.md"),
            stop,
        });

        drop(active);

        assert!(watcher_was_stopped(&stopped));
    }

    #[test]
    fn closing_the_final_note_explicitly_stops_its_watcher() {
        let (stop, stopped) = channel();
        let mut active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/note.md"),
            stop,
        });

        assert!(stop_active_note_watch(&mut active));
        assert!(active.is_none());
        assert_eq!(stopped.recv_timeout(Duration::from_millis(20)), Ok(()));
        assert!(!stop_active_note_watch(&mut active));
    }

    /// Every menu shortcut, parsed by the parser the menubar really uses.
    ///
    /// An accelerator this crate cannot parse is not a menu item that quietly
    /// loses its shortcut — it fails while the menubar is being built, and the
    /// application comes up with no menus at all. The Linux gate cannot catch
    /// that by construction, so it is caught here, where the parser lives.
    ///
    /// The registry stays the single source of truth: this reads the shortcuts
    /// out of it rather than keeping a second list that could agree with the
    /// grammar while disagreeing with the application.
    #[test]
    fn every_registry_accelerator_parses() {
        use std::str::FromStr;

        let registry = include_str!("../../src/application/commands.ts");
        let accelerators: Vec<&str> = registry
            .split("accelerator: '")
            .skip(1)
            .filter_map(|rest| rest.split('\'').next())
            .collect();

        // A refactor that renames the field must fail loudly rather than
        // silently checking nothing at all.
        assert!(
            accelerators.len() > 20,
            "found only {} accelerators — has commands.ts changed shape?",
            accelerators.len()
        );

        for accelerator in accelerators {
            assert!(
                muda::accelerator::Accelerator::from_str(accelerator).is_ok(),
                "the menubar cannot parse the accelerator {accelerator:?}, so building it would fail"
            );
        }
    }

    #[test]
    fn relative_document_links_follow_the_folder_on_this_device() {
        let directory = tempfile::tempdir().unwrap();
        let note_dir = directory.path().join("notes");
        let shared_dir = directory.path().join("shared");
        fs::create_dir_all(&note_dir).unwrap();
        fs::create_dir_all(&shared_dir).unwrap();
        let note = note_dir.join("index.md");
        let target = shared_dir.join("Decision One.pdf");
        fs::write(&note, b"[Decision](../shared/Decision%20One.pdf)\n").unwrap();
        fs::write(&target, b"pdf").unwrap();

        assert_eq!(
            resolve_document_link(
                &note.to_string_lossy(),
                "../shared/Decision%20One.pdf#page=2"
            )
            .unwrap(),
            ResolvedDocumentLink::Local(target.canonicalize().unwrap())
        );
    }

    #[test]
    fn web_links_remain_web_links() {
        assert_eq!(
            resolve_document_link("/tmp/note.md", "https://example.com/docs?q=1#part").unwrap(),
            ResolvedDocumentLink::External("https://example.com/docs?q=1#part".to_string())
        );
    }

    #[test]
    fn absolute_file_links_are_rejected_as_machine_specific() {
        let error =
            resolve_document_link("/device/notes/note.md", "file:///device-root/secret.pdf")
                .unwrap_err();
        assert!(error.contains("tied to one machine"));
    }

    #[test]
    fn finder_open_accepts_only_local_markdown_paths() {
        let markdown = Url::from_file_path("/tmp/note.markdown").unwrap();
        let uppercase = Url::from_file_path("/tmp/README.MD").unwrap();
        let text = Url::from_file_path("/tmp/note.txt").unwrap();
        let remote = Url::parse("https://example.com/note.md").unwrap();

        assert_eq!(
            opened_markdown_paths(&[markdown, uppercase, text, remote]),
            vec![
                PathBuf::from("/tmp/note.markdown"),
                PathBuf::from("/tmp/README.MD")
            ]
        );
    }

    #[test]
    fn second_instance_arguments_keep_only_markdown_and_resolve_relative_paths() {
        let args = vec![
            "/Applications/SimpleMark.app/Contents/MacOS/simplemark".to_string(),
            "next.md".to_string(),
            "/tmp/also.markdown".to_string(),
            "/tmp/ignore.txt".to_string(),
        ];

        assert_eq!(
            opened_markdown_args(&args, "/tmp/notes"),
            vec![
                PathBuf::from("/tmp/notes/next.md"),
                PathBuf::from("/tmp/also.markdown")
            ]
        );
    }

    #[test]
    fn catalog_lists_only_markdown() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("first.md"), b"# First\n").unwrap();
        fs::write(directory.path().join("second.markdown"), b"# Second\n").unwrap();
        fs::write(directory.path().join("ignore.txt"), b"ignore").unwrap();

        let catalog = workspace_catalog(&directory.path().join("first.md")).unwrap();
        assert_eq!(catalog.notes.len(), 2);
        assert!(catalog.notes.iter().any(|note| note.name == "first.md"));
        assert!(catalog
            .notes
            .iter()
            .any(|note| note.name == "second.markdown"));
    }

    #[test]
    fn explicit_folder_catalog_lists_that_directory_only() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("first.md"), b"# First\n").unwrap();
        fs::write(directory.path().join("ignore.txt"), b"ignore").unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();
        assert_eq!(catalog.handle, directory.path().display().to_string());
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "first.md");
    }

    #[test]
    fn inspecting_one_note_does_not_adopt_every_markdown_sibling() {
        let directory = tempfile::tempdir().unwrap();
        let opened = directory.path().join("opened.md");
        fs::write(&opened, b"# Opened\n").unwrap();
        fs::write(directory.path().join("unrelated.md"), b"# Unrelated\n").unwrap();

        let catalog = inspected_workspace_note(&opened).unwrap();
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "opened.md");
    }

    #[test]
    fn create_note_never_overwrites_an_existing_untitled_note() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("Untitled.md"), b"keep me").unwrap();

        let created = create_note(directory.path().display().to_string()).unwrap();
        assert_eq!(created.name, "Untitled 2.md");
        assert_eq!(
            fs::read(directory.path().join("Untitled.md")).unwrap(),
            b"keep me"
        );
        assert_eq!(
            fs::read(directory.path().join("Untitled 2.md")).unwrap(),
            b"# New note\n\n"
        );
    }

    #[test]
    fn duplicate_note_copies_bytes_without_overwriting_prior_copies() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        fs::write(directory.path().join("idea copy.md"), b"keep me").unwrap();

        let duplicate = duplicate_note(source.display().to_string()).unwrap();

        assert_eq!(duplicate.name, "idea copy 2.md");
        assert_eq!(
            fs::read(directory.path().join("idea copy 2.md")).unwrap(),
            b"# Exact\r\n\r\nbytes"
        );
        assert_eq!(
            fs::read(directory.path().join("idea copy.md")).unwrap(),
            b"keep me"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_trash_removes_the_note_without_finder_automation() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("discard.md");
        fs::write(&source, b"disposable").unwrap();

        move_note_to_trash(source.clone()).unwrap();

        assert!(!source.exists());
    }
}
