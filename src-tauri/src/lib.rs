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
#[cfg(target_os = "ios")]
use std::collections::HashSet;
#[cfg(target_os = "ios")]
use std::ffi::{c_char, CStr};
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
// Subprocesses, filesystem watching, and the timing they need are all desktop
// capabilities: iOS forbids spawning processes and offers no `notify` backend.
#[cfg(desktop)]
use std::process::Command;
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
#[cfg(desktop)]
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
// Not desktop-only: the watcher was its first user, but the AI request timeout
// needs it on every platform. Gating it broke the iOS build the moment that
// timeout landed.
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
#[cfg(desktop)]
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_dialog::DialogExt;

// Its two commands are registered on every platform so the shell can ask and be
// told no, but everything behind them is AppKit. On iOS that leaves the helpers
// unreferenced rather than wrong.
#[cfg_attr(mobile, allow(dead_code))]
mod app_icons;
#[cfg(target_os = "macos")]
mod macos_context_menu;
#[cfg(target_os = "macos")]
mod macos_note_navigation;
#[cfg(target_os = "macos")]
mod macos_traffic_lights;
#[cfg(target_os = "macos")]
mod macos_zoom;

pub mod note_images;
pub mod note_preview;
pub mod note_summaries;

#[cfg(all(any(target_os = "macos", target_os = "ios"), target_arch = "aarch64"))]
pub mod foundation_models;

#[cfg(target_os = "macos")]
use objc2::{runtime::AnyObject, sel, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplication;
#[cfg(target_os = "macos")]
use objc2_foundation::{
    NSNumber, NSString, NSURLIsUbiquitousItemKey, NSURLResourceKey,
    NSURLUbiquitousItemDownloadingStatusKey, NSURLUbiquitousItemDownloadingStatusNotDownloaded,
    NSURL,
};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::RunEvent;

/// iOS owns the security-scoped folder token, because UIKit creates it. Rust
/// receives only an already-authorized path and keeps all normal workspace
/// listing and document operations in the existing native transport.
#[cfg(target_os = "ios")]
mod ios_workspace_picker {
    use super::*;

    unsafe extern "C" {
        fn simplemark_pick_workspace_folder() -> *mut c_char;
        fn simplemark_workspace_picker_free(pointer: *mut c_char);
    }

    unsafe fn take_path(pointer: *mut c_char) -> Option<PathBuf> {
        if pointer.is_null() {
            return None;
        }
        // Swift returns a malloc'd UTF-8 path and provides the matching free
        // entrypoint. Invalid UTF-8 cannot become a local Rust path, so treat
        // it as a cancelled/unavailable selection rather than guessing.
        let path = CStr::from_ptr(pointer).to_str().ok().map(PathBuf::from);
        simplemark_workspace_picker_free(pointer);
        path
    }

    pub fn pick_folder() -> Option<PathBuf> {
        // The command runs off the UI thread; Swift presents UIKit on its main
        // queue and waits only for the person's explicit choice.
        unsafe { take_path(simplemark_pick_workspace_folder()) }
    }

}

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
    /// Native capabilities compiled into *this* binary.
    ///
    /// A capability can be absent for honest reasons — wrong architecture, an
    /// SDK without the framework, a platform Apple does not serve — and a
    /// green build proves nothing about which. Reporting it lets an installed
    /// bundle be asked rather than inferred: grepping a `.app` answers only
    /// for things that survive as symbols or shell config, and gives false
    /// negatives for everything else.
    capabilities: Vec<String>,
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
        capabilities: native_capabilities(),
    }
}

/// What this binary can actually do, as opposed to what the source allows.
fn native_capabilities() -> Vec<String> {
    let mut capabilities = Vec::new();
    if cfg!(simplemark_intelligence) {
        capabilities.push("note-summaries".to_string());
    }
    capabilities
}

/// One message in an OpenAI-compatible chat-completion request.
#[derive(serde::Serialize, serde::Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn chat_completion_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

fn chat_completion_body(model: &str, messages: &[ChatMessage]) -> serde_json::Value {
    serde_json::json!({ "model": model, "messages": messages })
}

/// One shared, timed-out `reqwest::Client` for the Fix-it network call.
///
/// A `Client` is meant to be pooled and reused rather than built per request,
/// and a fixed timeout means a wedged endpoint fails instead of leaving the
/// frontend's `await` — and the Fix it button, stuck on "Fixing… (N/3)" —
/// hanging forever.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_default()
    })
}

/// The diagram-error "Fix it" button's one network call (EDITOR error-recovery).
///
/// This crate is a thin transport everywhere else (module doc, top of this
/// file) and stays one here too: it knows the OpenAI request/response
/// envelope only as far as building the URL and the `{model, messages}` body,
/// and returns the response text unparsed. Everything else — the prompt, the
/// retry loop, extracting the fixed source from the response — lives in the
/// shared TypeScript adapter that also drives the browser dev shell's direct
/// `fetch`, so the two platforms cannot drift.
///
/// Going through Rust is not optional: the packaged app's CSP
/// (`connect-src 'self' ipc: http://ipc.localhost`, tauri.conf.json) silently
/// blocks a frontend `fetch` to any external host.
#[tauri::command]
async fn ai_chat_completion(
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = http_client();
    let url = chat_completion_url(&base_url);
    let body = chat_completion_body(&model, &messages);
    let response = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach {url}: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the response from {url}: {error}"))?;
    if !status.is_success() {
        return Err(format!("{url} returned {status}: {text}"));
    }
    Ok(text)
}

fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

/// The Settings panel's "Load models" button — same thin-transport contract
/// as `ai_chat_completion`: this returns the response text unparsed. Which
/// ids are chat-capable, and sorting them, is a TypeScript concern
/// (`parseModelList` in `openai-compatible-diagram-fix.ts`).
#[tauri::command]
async fn ai_list_models(base_url: String, api_key: String) -> Result<String, String> {
    let client = http_client();
    let url = models_url(&base_url);
    let response = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|error| format!("Could not reach {url}: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the response from {url}: {error}"))?;
    if !status.is_success() {
        return Err(format!("{url} returned {status}: {text}"));
    }
    Ok(text)
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
    /// The author's own lead sentence, when the note has one. `None` renders
    /// no subtitle rather than an empty one.
    ///
    /// Skipped rather than serialized as `null`, so the field is genuinely
    /// absent on the wire and the TypeScript `preview?: string` is honest
    /// instead of quietly meaning `string | null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

/// A preview delivered after the catalog metadata has already reached the UI.
///
/// A cloud-backed file can block while macOS materializes its bytes, so this
/// travels over an event rather than delaying the folder's initial response.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePreview {
    handle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
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

/// iCloud Drive's on-disk name for the container this app declares in
/// `NSUbiquitousContainers`. The daemon writes `iCloud.app.simplemark.ios` as a
/// directory by replacing every `.` with `~`, and both platforms must name the
/// same container or "the same notes on a phone and a Mac" is not true.
#[cfg(target_os = "macos")]
const ICLOUD_CONTAINER_DIRECTORY: &str = "iCloud~app~simplemark~ios";

/// The folder this app keeps at the top of iCloud Drive, beside the container.
///
/// Both spellings are tried because only one of them is this product's name and
/// the other is what a person actually types. On the case-insensitive volume
/// iCloud Drive lives on, the first match answers for both; the second entry is
/// what makes the lookup survive a case-sensitive one.
#[cfg(target_os = "macos")]
const ICLOUD_DRIVE_FOLDER_NAMES: [&str; 2] = ["SimpleMark", "Simplemark"];

/// The folders in iCloud Drive this app answers for without anyone choosing.
///
/// Two, in the order the sidebar should show them:
///
/// 1. The ubiquity container, as macOS mirrors it on disk.
///    `URLForUbiquityContainerIdentifier` is the API for this and is what iOS
///    calls, but it answers only for a build carrying the iCloud entitlement and
///    the Mac build carries none. The mirror is not a workaround for that: macOS
///    materialises every container under `Mobile Documents` for the signed-in
///    person regardless of which app asks, and this app is not sandboxed, so the
///    folder it published from the phone is simply readable.
/// 2. `iCloud Drive/SimpleMark`, the ordinary folder a person makes when they
///    want the app's notes somewhere they can see. It is not this app's
///    container and nothing about it is guaranteed — which is why it is matched
///    by name and skipped in silence when it is not there.
///
/// Split from its caller so the lookup can be tested against a temporary home
/// rather than the machine's real one. Absent is the ordinary answer, not a
/// fault: signed out of iCloud, iCloud Drive switched off, the phone has never
/// run the app.
#[cfg(target_os = "macos")]
fn icloud_workspaces_in(home: &Path) -> Vec<PathBuf> {
    let mobile_documents = home.join("Library/Mobile Documents");
    let mut candidates = vec![mobile_documents
        .join(ICLOUD_CONTAINER_DIRECTORY)
        .join("Documents")];
    let icloud_drive = mobile_documents.join("com~apple~CloudDocs");
    candidates.extend(
        ICLOUD_DRIVE_FOLDER_NAMES
            .iter()
            .map(|name| icloud_drive.join(name)),
    );

    let mut found: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        // `canonicalize` rather than the literal path: on a case-insensitive
        // volume both spellings resolve to one directory, and adopting it twice
        // would put the same folder in the sidebar twice under two names.
        let Ok(resolved) = candidate.canonicalize() else {
            continue;
        };
        if resolved.is_dir() && !found.contains(&resolved) {
            found.push(resolved);
        }
    }
    found
}

#[cfg(target_os = "macos")]
fn icloud_workspaces() -> Vec<PathBuf> {
    match std::env::var_os("HOME") {
        Some(home) => icloud_workspaces_in(&PathBuf::from(home)),
        None => Vec::new(),
    }
}

/// The folders this platform supplies without anyone choosing them.
///
/// An arbitrary directory would be a guess, and desktop makes none: it has a
/// picker, and a folder becomes a collection because a person chose it. This
/// app's folders in iCloud Drive are the exception and are not guesses. The
/// application publishes one of them, the phone writes notes into it, and both
/// carry the app's name. A Mac that ignores them breaks the single promise the
/// folders were created to make — that a note written on a phone is on the Mac
/// too — and leaves a person to discover, through a file picker, a directory
/// the app itself created.
///
/// Everywhere else this is empty and the shell stays in its welcome state
/// rather than claiming a directory nobody pointed at.
#[cfg(desktop)]
#[tauri::command]
async fn default_workspaces() -> Result<Vec<WorkspaceCatalog>, String> {
    #[cfg(target_os = "macos")]
    {
        // A folder that will not list is left out rather than failing the
        // launch: this is the platform volunteering folders, and a volunteered
        // folder nobody can read is not worth an error a person did not ask for.
        return Ok(icloud_workspaces()
            .iter()
            .filter_map(|directory| workspace_catalog_for_directory(directory).ok())
            .collect());
    }

    #[cfg(not(target_os = "macos"))]
    Ok(Vec::new())
}

/// The app's folder in iCloud Drive, when the platform will grant one.
///
/// `URLForUbiquityContainerIdentifier` answers `nil` for every honest reason a
/// person might have — signed out of iCloud, iCloud Drive switched off, the
/// entitlement not granted to this build — and none of them is an error worth
/// reporting. The caller falls back to the on-device folder, which is a smaller
/// promise that still works.
///
/// It can block while the daemon sets the container up, which is why this is
/// only ever reached from an async command rather than the UI thread.
#[cfg(target_os = "ios")]
fn icloud_documents() -> Option<PathBuf> {
    use objc2_foundation::NSFileManager;

    let container = NSFileManager::defaultManager().URLForUbiquityContainerIdentifier(None)?;
    let path = container.path()?;
    // `Documents` is the one subdirectory iCloud Drive shows to a person; the
    // rest of a ubiquity container stays private to the application.
    let documents = PathBuf::from(path.to_string()).join("Documents");
    fs::create_dir_all(&documents).ok()?;
    Some(documents)
}

#[cfg(all(mobile, not(target_os = "ios")))]
fn icloud_documents() -> Option<PathBuf> {
    None
}

/// Turns the directory the mobile shell owns into the one visible collection.
///
/// The iCloud API correctly returns the container's `Documents` subdirectory,
/// but that is implementation detail, not the name a person should see in
/// SimpleMark. Both launch and Open Folder use this one function so they can
/// never disagree about either directory or label.
#[cfg(mobile)]
fn mobile_workspace_catalog(app: &AppHandle) -> Result<WorkspaceCatalog, String> {
    let directory = match icloud_documents() {
        Some(icloud) => icloud,
        None => app
            .path()
            .document_dir()
            .map_err(|error| format!("This device exposed no documents directory: {error}"))?,
    };
    workspace_catalog_named(&directory, "SimpleMark")
}

/// Mobile supplies exactly one folder, so the list it returns holds one entry.
/// The shell adopts every folder a platform names and does not care how many
/// that is.
#[cfg(mobile)]
#[tauri::command]
async fn default_workspaces(app: AppHandle) -> Result<Vec<WorkspaceCatalog>, String> {
    // iCloud first, because the same notes on a phone and a Mac is the whole
    // point of the folder; on-device second, because a person without iCloud
    // still has notes. Whichever answers, the shell receives one ordinary
    // folder of Markdown and cannot tell the difference.
    mobile_workspace_catalog(&app).map(|catalog| vec![catalog])
}

/// Prompts for a folder whose direct Markdown children become one collection.
///
/// Picking a folder is deliberately separate from opening a file: opening
/// `Downloads/example.md` must never imply permission to adopt every Markdown
/// file in Downloads.
#[cfg(desktop)]
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

/// On iOS, select a real Files folder through UIKit and retain its
/// security-scoped authorization. That lets a person choose iCloud Drive's
/// existing Simplemark directory instead of silently switching to the app's
/// different private iCloud container.
#[cfg(mobile)]
#[tauri::command]
async fn open_workspace_folder(app: AppHandle) -> Result<Option<WorkspaceCatalog>, String> {
    #[cfg(target_os = "ios")]
    {
        let picked = tauri::async_runtime::spawn_blocking(ios_workspace_picker::pick_folder)
            .await
            .map_err(|error| format!("The iOS folder picker stopped unexpectedly: {error}"))?;
        return match picked {
            Some(directory) => {
                eprintln!("SimpleMark iOS folder picker returned {}", directory.display());
                off_the_ui_thread(move || workspace_catalog_for_directory(&directory))
                    .await
                    .map(Some)
            }
            None => {
                eprintln!("SimpleMark iOS folder picker returned no folder");
                Ok(None)
            }
        };
    }

    #[cfg(not(target_os = "ios"))]
    mobile_workspace_catalog(&app).map(Some)
}

/// Runs a blocking filesystem read somewhere other than the thread that draws.
///
/// A synchronous `#[tauri::command]` runs on the main thread; only an `async`
/// one reaches the runtime. That distinction does not matter for a local file,
/// where a read is microseconds, and matters entirely for a cloud-backed one:
/// iCloud keeps a file as a placeholder until something asks for its bytes, and
/// the asking is what blocks. On a phone every note is cloud-backed, so a
/// synchronous read is a UI freeze for as long as the provider takes.
async fn off_the_ui_thread<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("The filesystem worker did not finish: {error}"))?
}

/// Reads a note that is already chosen — used by reopen and by the watcher.
///
/// Opening a note is the read that a person is actually waiting on, so it is
/// the one that must never hold the UI thread. See `off_the_ui_thread`.
#[tauri::command]
async fn read_note_at(path: String) -> Result<OpenedNote, String> {
    off_the_ui_thread(move || read_note(Path::new(&path))).await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LocalFileAvailability {
    Available,
    ICloudNotDownloaded,
    Unknown,
}

fn require_local_note_bytes(
    path: &Path,
    availability: LocalFileAvailability,
) -> Result<(), String> {
    if availability == LocalFileAvailability::ICloudNotDownloaded {
        return Err(format!(
            "{} is stored in iCloud but has not been downloaded. Download it in Finder, then open it again.",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_resource_value(
    url: &NSURL,
    key: &NSURLResourceKey,
) -> Option<objc2::rc::Retained<AnyObject>> {
    let mut value = None;
    // SAFETY: Foundation documents both requested URL resource keys as object
    // values. The result is dynamically checked before this module interprets it.
    unsafe { url.getResourceValue_forKey_error(&mut value, key).ok()? };
    value
}

#[cfg(target_os = "macos")]
fn macos_note_availability(path: &Path) -> LocalFileAvailability {
    let Some(path) = path.to_str() else {
        return LocalFileAvailability::Unknown;
    };
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    // SAFETY: These Foundation global resource keys are immutable constants.
    let ubiquitous_key = unsafe { NSURLIsUbiquitousItemKey };
    let Some(ubiquitous) = macos_resource_value(&url, ubiquitous_key)
        .and_then(|value| value.downcast::<NSNumber>().ok())
    else {
        return LocalFileAvailability::Unknown;
    };
    if !ubiquitous.boolValue() {
        return LocalFileAvailability::Available;
    }
    // SAFETY: These Foundation global resource keys are immutable constants.
    let downloading_status_key = unsafe { NSURLUbiquitousItemDownloadingStatusKey };
    let Some(status) = macos_resource_value(&url, downloading_status_key)
        .and_then(|value| value.downcast::<NSString>().ok())
    else {
        return LocalFileAvailability::Unknown;
    };
    // SAFETY: Foundation exposes this status as an immutable global string.
    let not_downloaded = unsafe { NSURLUbiquitousItemDownloadingStatusNotDownloaded };
    if &*status == not_downloaded {
        LocalFileAvailability::ICloudNotDownloaded
    } else {
        LocalFileAvailability::Available
    }
}

#[cfg(target_os = "macos")]
fn local_note_availability(path: &Path) -> LocalFileAvailability {
    macos_note_availability(path)
}

#[cfg(not(target_os = "macos"))]
fn local_note_availability(_path: &Path) -> LocalFileAvailability {
    LocalFileAvailability::Unknown
}

fn read_note(path: &Path) -> Result<OpenedNote, String> {
    read_note_after_availability_check(path, local_note_availability(path), || fs::read(path))
}

/// Reads bytes only after macOS has confirmed that an iCloud item is local.
///
/// Derived work such as note summaries has no place to surface an open error,
/// so it receives `None` for either an unavailable placeholder or an ordinary
/// read failure. In particular, it must never make iCloud materialize a note
/// merely to replace the row's extracted preview.
pub(crate) fn locally_available_note_bytes(path: &Path) -> Option<Vec<u8>> {
    #[cfg(target_os = "macos")]
    {
        let path = summary_read_path(path)?;
        return summary_note_bytes_after_availability_check(
            local_note_availability(&path),
            path_is_in_icloud_storage(&path),
            || fs::read(&path),
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        fs::read(path).ok()
    }
}

/// Follows only the final path component, which is the note entry accepted by
/// the catalog. `read_link` inspects the link itself; it does not open the
/// target's bytes. Refuse a loop or an uninspectable path rather than using a
/// derived summary to trigger provider I/O.
#[cfg(target_os = "macos")]
fn summary_read_path(path: &Path) -> Option<PathBuf> {
    let mut candidate = summary_path_with_resolved_parent(path)?;
    for _ in 0..16 {
        let metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            // A dangling path can still identify iCloud storage. Let the
            // availability policy classify it; a later byte read will simply
            // decline the ordinary missing-file case.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(candidate),
            Err(_) => return None,
        };
        if !metadata.file_type().is_symlink() {
            return Some(candidate);
        }
        let target = fs::read_link(&candidate).ok()?;
        let target = if target.is_absolute() {
            target
        } else {
            candidate.parent()?.join(target)
        };
        candidate = summary_path_with_resolved_parent(&target)?;
    }
    None
}

/// Resolves directory links and `..` components without opening the note. The
/// filename remains uninspected so a dataless item is never materialized just
/// to decide whether it is safe to summarize.
#[cfg(target_os = "macos")]
fn summary_path_with_resolved_parent(path: &Path) -> Option<PathBuf> {
    let parent = fs::canonicalize(path.parent()?).ok()?;
    Some(parent.join(path.file_name()?))
}

/// Summary work is optional, so macOS reads it only when metadata positively
/// confirms the bytes are local, or when an unknown item is outside iCloud's
/// on-disk root. An explicit open remains more permissive and can report a
/// normal filesystem error for an item whose metadata is unknown.
#[cfg(target_os = "macos")]
fn summary_note_bytes_after_availability_check(
    availability: LocalFileAvailability,
    is_in_icloud_storage: bool,
    read: impl FnOnce() -> Result<Vec<u8>, std::io::Error>,
) -> Option<Vec<u8>> {
    match availability {
        LocalFileAvailability::Available => read().ok(),
        LocalFileAvailability::ICloudNotDownloaded => None,
        LocalFileAvailability::Unknown if is_in_icloud_storage => None,
        LocalFileAvailability::Unknown => read().ok(),
    }
}

#[cfg(target_os = "macos")]
fn path_is_in_icloud_storage(path: &Path) -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };
    path_is_in_icloud_storage_in(path, Path::new(&home))
}

#[cfg(target_os = "macos")]
fn path_is_in_icloud_storage_in(path: &Path, home: &Path) -> bool {
    let home = fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    path.starts_with(home.join("Library/Mobile Documents"))
}

fn read_note_after_availability_check(
    path: &Path,
    availability: LocalFileAvailability,
    read: impl FnOnce() -> Result<Vec<u8>, std::io::Error>,
) -> Result<OpenedNote, String> {
    require_local_note_bytes(path, availability)?;
    let bytes = read().map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    opened_note_from_bytes(path, bytes)
}

fn opened_note_from_bytes(path: &Path, bytes: Vec<u8>) -> Result<OpenedNote, String> {
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

const REMOTE_DATA_MESSAGE: &str =
    "Remote data is not loaded. Put the values in the chart, or link a file next to your note.";

/// Reads a data file named by a chart, resolved exactly as a document link is.
///
/// Deliberately the same resolver as `open_document_link`, because a chart
/// naming a file and a link naming a file are the same act: relative paths
/// resolve against the note's folder and may traverse upward, while absolute
/// paths and `file:` URLs are refused as machine-specific. No containment rule
/// is added here that links do not already have.
///
/// The one divergence is the remote case. A link hands `http(s)` to the system
/// browser; a chart has nowhere to hand it and this crate holds no network
/// permission, so it is refused with the message the reader can act on.
/// Consent-gated remote data is a separate task.
fn read_data_at(document_handle: &str, href: &str) -> Result<String, String> {
    match resolve_document_link(document_handle, href)? {
        ResolvedDocumentLink::External(_) => Err(REMOTE_DATA_MESSAGE.to_string()),
        ResolvedDocumentLink::Local(path) => std::fs::read_to_string(&path)
            .map_err(|error| format!("Linked file is unavailable: {error}")),
    }
}

#[tauri::command]
fn read_note_data(document_handle: String, href: String) -> Result<String, String> {
    read_data_at(&document_handle, &href)
}

/// iOS forbids spawning a subprocess, so the desktop `open`/`xdg-open` route
/// does not exist. The platform equivalent is `UIApplication.open`, which is
/// Phase 1 work; until then this is a named limitation rather than a silent
/// failure, and the Markdown source is untouched either way.
#[cfg(mobile)]
fn open_with_system(_target: &str) -> Result<(), String> {
    Err("Opening external links is not available on iOS yet".to_string())
}

#[cfg(desktop)]
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

/// Validates a person-supplied filename and supplies the Markdown suffix when
/// it is omitted. Paths are deliberately not accepted here: Save and Rename
/// must never turn a filename field into authority to write somewhere else.
fn markdown_file_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A note needs a name".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err("A note name cannot contain a path separator".to_string());
    }
    let mut components = Path::new(name).components();
    let component = components
        .next()
        .ok_or_else(|| "A note needs a name".to_string())?;
    if components.next().is_some() || !matches!(component, Component::Normal(_)) {
        return Err("A note name must be a filename, not a path".to_string());
    }
    let extension = Path::new(name).extension().and_then(|value| value.to_str());
    match extension {
        None => Ok(format!("{name}.md")),
        Some(extension)
            if extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("markdown") =>
        {
            Ok(name.to_string())
        }
        Some(_) => Err("Notes must use a .md or .markdown filename".to_string()),
    }
}

/// Uses the native Save panel's directory choice but keeps the name a
/// Markdown filename. A filter alone is only a convenience in Finder, not a
/// file-safety guarantee.
fn markdown_destination(path: PathBuf) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{} is not a file destination", path.display()))?
        .to_string_lossy();
    let name = markdown_file_name(&file_name)?;
    Ok(path.with_file_name(name))
}

/// Creates a new file with bytes exactly once. `create_new` is the overwrite
/// guard — no preflight `exists()` check can make a collision safe.
fn write_new_note(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!(
                    "A note named {} already exists — choose another name",
                    path.file_name()
                        .map(|name| name.to_string_lossy())
                        .unwrap_or_else(|| path.display().to_string().into())
                )
            } else {
                format!("Could not create {}: {error}", path.display())
            }
        })?;

    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("Could not finish {}: {error}", path.display()));
    }
    Ok(())
}

fn millis(time: Result<SystemTime, std::io::Error>) -> u64 {
    time.ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// How much of a note is read to find its preview.
///
/// Every extraction rule looks at the document's opening only, and opening a
/// folder must not wait on I/O — so this is deliberately small.
const PREVIEW_READ_LIMIT: u64 = 8 * 1024;

/// Inspects one candidate note.
///
/// The single stat answers both questions a catalog asks — is this a file, and
/// when did it change — so a caller never has to ask twice about a path that
/// may not survive between the asking. A directory called `notes.md` is not a
/// note, and neither is a name whose file has already gone.
fn catalog_entry(path: &Path) -> Result<WorkspaceCatalogEntry, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    Ok(WorkspaceCatalogEntry {
        handle: path.display().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        modified_ms: millis(metadata.modified()),
        created_ms: millis(metadata.created()),
        preview: None,
    })
}

/// An unreadable note is not a catalog failure. The row still lists, without
/// a subtitle — the same outcome as a note that has no prose.
fn preview_of(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut buffer = Vec::with_capacity(PREVIEW_READ_LIMIT as usize);
    file.take(PREVIEW_READ_LIMIT).read_to_end(&mut buffer).ok()?;
    note_preview::extract_preview(&String::from_utf8_lossy(&buffer))
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
        // One unreadable entry is not a folder that cannot be listed. A
        // directory being read while iCloud materialises or evicts files in it
        // hands back entries that stop existing between the listing and the
        // inspection, and failing the whole call there makes the collection
        // disappear over a single file. The note is left out; the folder opens.
        // One unreadable entry is not a folder that cannot be listed. A folder
        // read while iCloud materialises or evicts files in it yields entries
        // that stop existing before they can be inspected, and failing the
        // whole call there loses the collection over a single file.
        let Ok(entry) = entry else { continue };
        let note_path = entry.path();
        if !is_markdown(&note_path) {
            continue;
        }
        // The inspection decides whether this is a note, rather than a
        // separate `is_file` first. Two stats of the same path are not just a
        // wasted syscall — they are a window the file can vanish through, and
        // vanishing is ordinary here.
        let Ok(note) = catalog_entry(&note_path) else {
            continue;
        };
        notes.push(note);
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

/// A platform-owned workspace may need a person-facing label that is different
/// from its implementation directory name. iCloud's public directory is named
/// `Documents`; the product folder it represents is SimpleMark.
#[cfg_attr(not(mobile), allow(dead_code))]
fn workspace_catalog_named(directory: &Path, name: &str) -> Result<WorkspaceCatalog, String> {
    let mut catalog = workspace_catalog_for_directory(directory)?;
    catalog.name = name.to_owned();
    Ok(catalog)
}

/// Listing walks a directory and stats every entry, which a cloud provider may
/// also make slow — and this runs on every relist, not only at launch. Off the
/// UI thread for the same reason reads are (see `off_the_ui_thread`).
#[tauri::command]
async fn list_workspace(handle: String) -> Result<WorkspaceCatalog, String> {
    off_the_ui_thread(move || workspace_catalog(Path::new(&handle))).await
}

#[tauri::command]
async fn list_workspace_folder(handle: String) -> Result<WorkspaceCatalog, String> {
    off_the_ui_thread(move || workspace_catalog_for_directory(Path::new(&handle))).await
}

/// Starts bounded preview reads only after the UI has listed each note.
///
/// The worker may wait for a cloud provider to materialize a placeholder, but
/// it never occupies AppKit's event loop. A missing or unreadable file emits
/// no preview, matching the catalog's existing filename-only row behavior.
#[tauri::command]
fn request_workspace_previews(app: AppHandle, handles: Vec<String>) {
    for handle in handles {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let preview = preview_of(Path::new(&handle));
            let _ = app.emit(
                "workspace-note-preview",
                WorkspacePreview { handle, preview },
            );
        });
    }
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

/// Saves a rendered figure (Copy image's Save image sibling) through the
/// native save dialog — the packaged app's answer to the browser build's
/// canvas→blob download, per the figure-viewer-everywhere spec §1 ruling 4.
///
/// `bytes` arrives base64-encoded (D7 fidelity boundary convention, matching
/// `save_new_note` above) since PNG/SVG bytes are never valid UTF-8 text.
/// `extension` selects the save-dialog filter — `png` or `svg`, the only two
/// formats the viewer offers. Returns `false` when the person cancels the
/// dialog, mirroring every other verb's honest refusal rather than an error.
#[tauri::command]
async fn save_image(
    app: AppHandle,
    suggested_name: String,
    extension: String,
    bytes: String,
) -> Result<bool, String> {
    let decoded = BASE64
        .decode(bytes.as_bytes())
        .map_err(|error| format!("Rejected a malformed image payload: {error}"))?;
    let filter_name = if extension == "svg" { "SVG" } else { "PNG" };
    let picked = app
        .dialog()
        .file()
        .add_filter(filter_name, &[extension.as_str()])
        .set_file_name(suggested_name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(false);
    };
    let destination = picked
        .into_path()
        .map_err(|error| format!("That destination has no writable path: {error}"))?;
    fs::write(&destination, &decoded)
        .map_err(|error| format!("Could not save {}: {error}", destination.display()))?;
    Ok(true)
}

/// First save for an in-memory note. The operating system, not a remembered
/// folder, owns the destination choice; cancelling leaves the draft untouched.
#[tauri::command]
async fn save_new_note(
    app: AppHandle,
    suggested_name: String,
    bytes: String,
) -> Result<Option<OpenedNote>, String> {
    let suggested_name = markdown_file_name(&suggested_name)?;
    let decoded = BASE64
        .decode(bytes.as_bytes())
        .map_err(|error| format!("Rejected a malformed new-note payload: {error}"))?;
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(suggested_name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let destination = markdown_destination(
        picked
            .into_path()
            .map_err(|error| format!("That save destination has no writable path: {error}"))?,
    )?;
    write_new_note(&destination, &decoded)?;
    read_note(&destination).map(Some)
}

/// Renames one note without relying on `rename`'s platform-specific overwrite
/// behaviour. Linking the old file to the requested new name first makes a
/// collision fail safely before the source is removed.
#[tauri::command]
fn rename_note(handle: String, name: String) -> Result<OpenedNote, String> {
    let source = PathBuf::from(&handle);
    let directory = source
        .parent()
        .ok_or_else(|| format!("{handle} has no parent folder"))?;
    let destination = directory.join(markdown_file_name(&name)?);
    if source == destination {
        return read_note(&source);
    }

    fs::hard_link(&source, &destination).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!(
                "A note named {} already exists — choose another name",
                destination
                    .file_name()
                    .map(|value| value.to_string_lossy())
                    .unwrap_or_else(|| destination.display().to_string().into())
            )
        } else {
            format!(
                "Could not rename {} to {}: {error}",
                source.display(),
                destination.display()
            )
        }
    })?;
    if let Err(error) = fs::remove_file(&source) {
        let _ = fs::remove_file(&destination);
        return Err(format!(
            "Could not finish renaming {} to {}: {error}",
            source.display(),
            destination.display()
        ));
    }
    read_note(&destination)
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

/// Copies `source`'s exact bytes to `destination` and reads the result back.
///
/// A destination equal to the source is not copied — `fs::copy` opens the
/// destination for writing before it has finished reading the source, so
/// copying a file onto itself risks truncating it mid-read.
fn copy_note_to(source: &Path, destination: &Path) -> Result<OpenedNote, String> {
    if destination == source {
        return read_note(source);
    }
    fs::copy(source, destination).map_err(|error| {
        format!(
            "Could not save {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    read_note(destination)
}

/// Prompts for a new name/location and switches the document to the copy.
///
/// Unlike `duplicate_note`, the destination is the person's own choice, not
/// an auto-generated "copy" name — the traditional desktop Save As.
#[tauri::command]
async fn save_note_as(app: AppHandle, handle: String) -> Result<Option<OpenedNote>, String> {
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
        return Ok(None);
    };
    let destination = picked
        .into_path()
        .map_err(|error| format!("That destination has no writable path: {error}"))?;
    copy_note_to(&source, &destination).map(Some)
}

#[cfg(desktop)]
#[tauri::command]
async fn trash_note(handle: String) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    move_note_to_trash(path).map_err(|error| format!("Could not move {handle} to Trash: {error}"))
}

/// iOS has no user-visible Trash an app may move a document into, so this is a
/// named limitation rather than a silent no-op: the note is still the person's
/// file, and the Files app is where it is deleted.
#[cfg(mobile)]
#[tauri::command]
async fn trash_note(_handle: String) -> Result<(), String> {
    Err("Deleting a note is done from the Files app on iOS".to_string())
}

/// Reveals a note or folder in the platform file manager, with the item
/// selected where the platform supports that (Finder, Explorer).
#[tauri::command]
async fn reveal_in_finder(handle: String) -> Result<(), String> {
    #[cfg_attr(mobile, allow(unused_variables))]
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

#[cfg(desktop)]
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

/// Returns the next Markdown file iOS or macOS asked SimpleMark to open.
#[tauri::command]
fn take_open_note_request(queue: State<'_, OpenRequestQueue>) -> Result<Option<String>, String> {
    let path = queue
        .0
        .lock()
        .map_err(|_| "The open-file queue was poisoned by an earlier panic".to_string())?
        .pop_front();
    Ok(path.map(|path| path.display().to_string()))
}

/// One plain-text share awaiting the person's normal Save destination.
///
/// This is deliberately not an `OpenedNote`: Grammarly and similar share
/// sheets have text, not a provider-owned Markdown URL. The app shows it as a
/// draft and leaves it unsaved until the person chooses a location.
#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
struct SharedTextDraft {
    id: String,
    text: String,
}

#[cfg(target_os = "ios")]
const SHARED_DRAFT_GROUP: &str = "group.app.simplemark.ios";
#[cfg(target_os = "ios")]
const SHARED_DRAFT_KEY: &str = "app.simplemark.pending-plain-text-draft";
#[cfg(any(target_os = "ios", test))]
const MAX_SHARED_DRAFT_BYTES: usize = 1_048_576;

#[cfg(any(target_os = "ios", test))]
fn parse_shared_text_draft(value: &str) -> Result<SharedTextDraft, String> {
    let draft: SharedTextDraft = serde_json::from_str(value)
        .map_err(|error| format!("The shared text draft was invalid: {error}"))?;
    if draft.id.is_empty() || draft.text.is_empty() {
        return Err("The shared text draft was empty".to_string());
    }
    if draft.text.len() > MAX_SHARED_DRAFT_BYTES {
        return Err("The shared text draft was too large".to_string());
    }
    Ok(draft)
}

#[cfg(target_os = "ios")]
fn shared_draft_defaults() -> Result<objc2::rc::Retained<objc2_foundation::NSUserDefaults>, String> {
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSString, NSUserDefaults};

    let group = NSString::from_str(SHARED_DRAFT_GROUP);
    NSUserDefaults::initWithSuiteName(NSUserDefaults::alloc(), Some(&group))
        .ok_or_else(|| "SimpleMark could not access its shared Share-sheet container".to_string())
}

/// Reads, but does not consume, the Share extension's pending text.
///
/// Keeping it until `acknowledge_shared_text_draft` means cancelling Save or
/// quitting the app cannot silently lose a share.
#[tauri::command]
fn peek_shared_text_draft() -> Result<Option<SharedTextDraft>, String> {
    #[cfg(target_os = "ios")]
    {
        use objc2_foundation::NSString;

        let defaults = shared_draft_defaults()?;
        let key = NSString::from_str(SHARED_DRAFT_KEY);
        return defaults
            .stringForKey(&key)
            .map(|value| parse_shared_text_draft(&value.to_string()))
            .transpose();
    }

    #[cfg(not(target_os = "ios"))]
    Ok(None)
}

/// Deletes precisely the share that has become a durable Markdown document.
#[tauri::command]
fn acknowledge_shared_text_draft(id: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        use objc2_foundation::NSString;

        let defaults = shared_draft_defaults()?;
        let key = NSString::from_str(SHARED_DRAFT_KEY);
        let Some(value) = defaults.stringForKey(&key) else {
            return Ok(());
        };
        let pending = parse_shared_text_draft(&value.to_string())?;
        if pending.id == id {
            defaults.removeObjectForKey(&key);
        }
        return Ok(());
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = id;
        Ok(())
    }
}

/// Tauri delivers Files/Open In URLs through `RunEvent::Opened` on iOS and
/// macOS. The queue keeps a launch-time delivery until TypeScript has mounted.
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

/// Files hands an iOS editor a security-scoped URL. Converting that URL to a
/// Rust path does not carry the permission with it, so opening it without this
/// call commonly looks like an empty launch: the shell receives an open event,
/// then the first real read is denied. Keep each explicitly delivered document
/// scope alive for the app process. A document stays open/editable for that
/// process, and iOS releases the scopes when the process exits.
#[cfg(target_os = "ios")]
fn retain_opened_document_scopes(paths: &[PathBuf]) {
    use std::sync::OnceLock;

    static OPENED_SCOPES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    let scopes = OPENED_SCOPES.get_or_init(|| Mutex::new(HashSet::new()));
    let Ok(mut scopes) = scopes.lock() else {
        return;
    };

    for path in paths {
        if !scopes.insert(path.clone()) {
            continue;
        }

        use objc2_foundation::{NSString, NSURL};
        let path = NSString::from_str(&path.to_string_lossy());
        let url = NSURL::fileURLWithPath(&path);
        // The URL is supplied by Files/Open In rather than the webview. A
        // false result is still not a reason to discard it: app-owned paths do
        // not need a scope, while the ordinary reader below gives the person a
        // concrete error if the provider later refuses the bytes.
        let _ = unsafe { url.startAccessingSecurityScopedResource() };
    }
}

#[cfg_attr(mobile, allow(dead_code))]
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
    let paths = opened_markdown_paths(urls);
    #[cfg(target_os = "ios")]
    retain_opened_document_scopes(&paths);
    queue_opened_paths(app, paths);
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
#[cfg(desktop)]
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

            // Starts the quiescence timer. An agent rewriting this file fires
            // here many times a second; this only stamps a time, so the burst
            // costs one re-summary once the writes stop rather than one each.
            if let Some(summaries) = app.try_state::<note_summaries::SummaryState>() {
                note_summaries::note_changed_externally(&summaries, &handle);
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
#[cfg(desktop)]
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

/// iOS placeholders for the two filesystem watches.
///
/// `notify` has no iOS backend, and iCloud is not a plain filesystem anyway: a
/// note can exist as a placeholder before its bytes have been downloaded, so
/// the desktop "the directory changed" signal is the wrong shape even if it
/// were available. The real iOS input is `NSFilePresenter`/`NSFileCoordinator`,
/// which reports when a download completes.
///
/// Until that exists, these resolve rather than fail so that opening a note
/// works — but nothing is being watched. **External changes made on another
/// device are not detected on iOS**, which means ADR-0006's external-bytes
/// adapter currently has no mobile input. This is a known, named gap, not a
/// working watcher.
/// How often iOS looks for somebody else's write.
///
/// `notify` has no iOS backend, and the push alternatives do not fit what this
/// has to watch: a `dispatch` vnode source dies when an atomic save replaces
/// the inode, and `NSMetadataQuery` only ever sees the iCloud container, not
/// the on-device folder the app falls back to. So this asks, on an interval
/// slow enough to be invisible on a battery and quick enough that a note edited
/// on a Mac appears while you are still looking at the phone.
///
/// It is a poll, and the comment says so rather than the name pretending
/// otherwise. `NSFilePresenter` would replace the trigger without touching any
/// of the meaning below — same ledger comparison, same coalescing, same event.
#[cfg(mobile)]
const MOBILE_WATCH_INTERVAL: Duration = Duration::from_millis(1500);

/// Reports when somebody other than this process writes the open note.
///
/// Deliberately the same shape as the desktop watcher, because the difference
/// between them must stay in how a change is noticed and never in what a change
/// means: content is hashed and compared against the write ledger so this app's
/// own saves are silent, and the event carries only the path — the shared
/// application layer decides what a change implies.
#[cfg(mobile)]
#[tauri::command]
fn watch_note(
    app: AppHandle,
    handle: String,
    ledger: State<'_, WriteLedger>,
    control: State<'_, NoteWatchControl>,
) -> Result<(), String> {
    let path = PathBuf::from(&handle);

    let mut active = control
        .0
        .lock()
        .map_err(|_| "The note watcher registry was poisoned by an earlier panic".to_string())?;
    if active_note_watch_matches(&active, &path) {
        return Ok(());
    }

    let (stop_sender, stop_receiver) = channel::<()>();
    replace_active_note_watch(&mut active, path.clone(), stop_sender);
    drop(active);

    let ledger = ledger.inner().clone();
    std::thread::spawn(move || {
        // Whatever is on disk when watching starts is the baseline, not a
        // change. Reading it here means the first poll cannot mistake the file
        // you just opened for somebody else's edit.
        let mut seen = fs::read(&path).ok().map(|bytes| content_hash(&bytes));

        loop {
            std::thread::sleep(MOBILE_WATCH_INTERVAL);
            if watcher_was_stopped(&stop_receiver) {
                break;
            }

            // iCloud materialises lazily, so a file can exist as a placeholder
            // before its bytes arrive. A failed read is that state, not a
            // deletion, and waiting is the honest response.
            let Ok(current) = fs::read(&path) else {
                continue;
            };
            let hash = content_hash(&current);
            if seen == Some(hash) {
                continue;
            }
            seen = Some(hash);

            let ours = ledger
                .0
                .lock()
                .map(|ledger| ledger.get(&path).copied() == Some(hash))
                .unwrap_or(false);
            if ours {
                continue;
            }

            if let Some(summaries) = app.try_state::<note_summaries::SummaryState>() {
                note_summaries::note_changed_externally(&summaries, &handle);
            }

            let _ = app.emit("note-changed-externally", handle.clone());
        }
    });

    Ok(())
}

/// Reports when the adopted folder gains or loses a Markdown file.
///
/// Membership only. The event names the folder and TypeScript re-lists it
/// through the catalog port, which keeps filesystem observation out of the
/// shared application model exactly as it is on desktop.
#[cfg(mobile)]
#[tauri::command]
fn watch_workspace_folder(app: AppHandle, handle: String) -> Result<(), String> {
    let directory = PathBuf::from(&handle);
    if !directory.is_dir() {
        return Err(format!("{handle} is not a readable folder"));
    }

    // Names rather than a count: a note renamed, or one swapped for another
    // between polls, leaves the count identical and the folder different.
    let membership = |directory: &Path| -> Vec<String> {
        let Ok(entries) = fs::read_dir(directory) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| is_markdown(path))
            .filter_map(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .collect();
        names.sort();
        names
    };

    std::thread::spawn(move || {
        let mut seen = membership(&directory);
        loop {
            std::thread::sleep(MOBILE_WATCH_INTERVAL);
            let current = membership(&directory);
            if current == seen {
                continue;
            }
            seen = current;
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
#[cfg(desktop)]
#[tauri::command]
fn print_note(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|error| format!("Could not open the print panel: {error}"))
}

/// iOS printing goes through `UIPrintInteractionController`, not the webview,
/// so there is no `print()` to forward to. The shared print stylesheet is
/// unaffected; only the transport is missing.
#[cfg(mobile)]
#[tauri::command]
fn print_note(_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Printing is not available on iOS yet".to_string())
}

/// Sends a standard AppKit text-service action through the responder chain.
///
/// The focused WKWebView remains the target, so macOS owns dictionaries,
/// substitutions, replacements, language settings, and speech. The shared
/// editor neither reimplements those services nor receives document text over
/// IPC. The allow-list is intentionally closed: this is not a generic Cocoa
/// selector bridge.
#[tauri::command]
#[cfg(target_os = "macos")]
fn perform_macos_text_service(service: String) -> Result<(), String> {
    let action = match service.as_str() {
        "show_spelling_and_grammar" => sel!(showGuessPanel:),
        "check_spelling" => sel!(checkSpelling:),
        "toggle_continuous_spell_checking" => sel!(toggleContinuousSpellChecking:),
        "toggle_grammar_checking" => sel!(toggleGrammarChecking:),
        "show_substitutions" => sel!(orderFrontSubstitutionsPanel:),
        "toggle_smart_quotes" => sel!(toggleAutomaticQuoteSubstitution:),
        "toggle_smart_dashes" => sel!(toggleAutomaticDashSubstitution:),
        "toggle_text_replacement" => sel!(toggleAutomaticTextReplacement:),
        "start_speaking" => sel!(startSpeaking:),
        "stop_speaking" => sel!(stopSpeaking:),
        _ => return Err(format!("Unsupported macOS text service: {service}")),
    };
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "macOS text services must run on the main thread".to_string())?;
    let application = NSApplication::sharedApplication(marker);
    // SAFETY: every selector above is a standard NSResponder action, the
    // target is intentionally nil so AppKit resolves the focused responder,
    // and no untrusted selector crosses this boundary.
    let handled = unsafe { application.sendAction_to_from(action, None, None) };
    handled
        .then_some(())
        .ok_or_else(|| "The focused control does not support that macOS text service".to_string())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn perform_macos_text_service(_service: String) -> Result<(), String> {
    Err("macOS text services are available only on macOS".to_string())
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn set_native_context_menu_shape(shape: macos_context_menu::NativeContextMenuShape) {
    macos_context_menu::set_selection_shape(shape);
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn set_native_context_menu_shape(_shape: serde_json::Value) {}

/// Turns on the native macOS browser-style pinch recognizer. The command
/// crosses no document data; it emits only transient gesture deltas.
#[cfg(target_os = "macos")]
#[tauri::command]
fn enable_page_magnification(window: tauri::WebviewWindow) -> Result<(), String> {
    macos_zoom::enable(&window)
}

/// Other desktop shells load the same TypeScript entrypoint, but do not claim
/// macOS pinch support. Keeping this transport present lets the shared command
/// registration compile on every native target without creating a second zoom
/// implementation outside macOS.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn enable_page_magnification(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Restores one persisted native page magnification or returns Actual Size to
/// the engine default. Values are constrained by the shared UI preference.
#[cfg(target_os = "macos")]
#[tauri::command]
fn set_page_magnification(window: tauri::WebviewWindow, magnification: f64) -> Result<(), String> {
    macos_zoom::set_magnification(&window, magnification)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn set_page_magnification(
    _window: tauri::WebviewWindow,
    _magnification: f64,
) -> Result<(), String> {
    Ok(())
}

/// Keeps the native traffic lights aligned with the whole-page WebKit zoom.
/// The controls live outside the web view, so AppKit cannot infer that scale.
#[cfg(target_os = "macos")]
#[tauri::command]
fn sync_traffic_lights_to_page_zoom(
    window: tauri::WebviewWindow,
    magnification: f64,
) -> Result<(), String> {
    macos_traffic_lights::sync_to_page_zoom(&window, magnification)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn sync_traffic_lights_to_page_zoom(
    _window: tauri::WebviewWindow,
    _magnification: f64,
) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin. A Finder open while SimpleMark is already
    // running is a document transition in that window, never permission
    // to create a second application process and another main window.
    //
    // iOS needs no such lock: the operating system already guarantees one
    // process per application, and there is no command line to inspect.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        queue_opened_paths(app, opened_markdown_args(&args, &cwd));
    }));

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(WriteLedger::default())
        .manage(NoteWatchControl::default())
        .manage(OpenRequestQueue::default())
        .setup(|app| {
            // Summaries are derived data: if the data directory cannot be
            // resolved, the note list shows extracted previews and the app
            // starts normally rather than refusing to run.
            if let Ok(path) = note_summaries::cache_path(&app.handle()) {
                tauri::Manager::manage(app, note_summaries::SummaryState::new(path));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_note,
            open_workspace_folder,
            default_workspaces,
            read_note_at,
            read_note_data,
            open_document_link,
            inspect_workspace_note,
            list_workspace,
            list_workspace_folder,
            request_workspace_previews,
            create_note,
            save_new_note,
            rename_note,
            duplicate_note,
            export_note,
            save_note_as,
            save_image,
            trash_note,
            reveal_in_finder,
            take_open_note_request,
            peek_shared_text_draft,
            acknowledge_shared_text_draft,
            save_note,
            print_note,
            perform_macos_text_service,
            set_native_context_menu_shape,
            app_icons::get_app_icon,
            app_icons::set_app_icon,
            build_provenance,
            ai_chat_completion,
            ai_list_models,
            enable_page_magnification,
            set_page_magnification,
            sync_traffic_lights_to_page_zoom,
            watch_note,
            stop_watching_note,
            watch_workspace_folder,
            note_summaries::note_summaries_available,
            note_summaries::request_note_summaries,
            note_images::download_note_image,
            note_images::read_note_asset
        ])
        .build(tauri::generate_context!())
        .expect("SimpleMark failed to start");

    #[cfg(target_os = "macos")]
    macos_context_menu::install(app.handle())
        .expect("SimpleMark failed to install the native context menu bridge");

    #[cfg(target_os = "macos")]
    macos_note_navigation::install(app.handle());

    #[cfg(target_os = "macos")]
    if let Err(error) = app_icons::restore() {
        eprintln!("SimpleMark could not restore the selected app icon: {error}");
    }

    app.run(|_app, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = _event {
            queue_opened_notes(_app, &urls);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_an_icloud_note_that_has_not_been_downloaded_before_reading() {
        let error = require_local_note_bytes(
            Path::new("/iCloudDrive/plan.md"),
            LocalFileAvailability::ICloudNotDownloaded,
        )
        .unwrap_err();

        assert!(error.contains("plan.md"));
        assert!(error.contains("Download it in Finder"));
    }

    #[test]
    fn permits_a_locally_available_note() {
        assert!(require_local_note_bytes(
            Path::new("/notes/plan.md"),
            LocalFileAvailability::Available,
        )
        .is_ok());
    }

    #[test]
    fn leaves_unknown_availability_to_the_existing_filesystem_read() {
        assert!(require_local_note_bytes(
            Path::new("/notes/plan.md"),
            LocalFileAvailability::Unknown,
        )
        .is_ok());
    }

    #[test]
    fn available_note_state_runs_the_normal_note_reader() {
        let opened = read_note_after_availability_check(
            Path::new("/notes/plan.md"),
            LocalFileAvailability::Available,
            || Ok(b"# Plan\n".to_vec()),
        )
        .unwrap();

        assert_eq!(opened.name, "plan.md");
        assert_eq!(opened.bytes, BASE64.encode(b"# Plan\n"));
    }

    #[test]
    fn unknown_note_availability_runs_the_normal_note_reader() {
        let opened = read_note_after_availability_check(
            Path::new("/notes/unknown.md"),
            LocalFileAvailability::Unknown,
            || Ok(b"# Unknown\n".to_vec()),
        )
        .unwrap();

        assert_eq!(opened.name, "unknown.md");
        assert_eq!(opened.bytes, BASE64.encode(b"# Unknown\n"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_summary_never_reads_an_icloud_note_with_unknown_local_availability() {
        let bytes = summary_note_bytes_after_availability_check(
            LocalFileAvailability::Unknown,
            true,
            || -> Result<Vec<u8>, std::io::Error> {
                panic!("a summary must not read an item whose iCloud state is unknown")
            },
        );

        assert!(bytes.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_summary_reads_an_unknown_note_outside_icloud_storage() {
        let bytes = summary_note_bytes_after_availability_check(
            LocalFileAvailability::Unknown,
            false,
            || Ok(b"# Local\n".to_vec()),
        );

        assert_eq!(bytes, Some(b"# Local\n".to_vec()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_summary_resolves_a_symlink_before_classifying_icloud_storage() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("home");
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
        std::fs::create_dir_all(&icloud).unwrap();
        let linked = directory.path().join("linked.md");
        let target = icloud.join("offline.md");
        std::os::unix::fs::symlink(target, &linked).unwrap();

        let resolved = summary_read_path(&linked).expect("symlink target");
        let bytes = summary_note_bytes_after_availability_check(
            LocalFileAvailability::Unknown,
            path_is_in_icloud_storage_in(&resolved, &home),
            || -> Result<Vec<u8>, std::io::Error> {
                panic!("a summary must not read an iCloud placeholder through a symlink")
            },
        );

        assert!(bytes.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_summary_resolves_a_symlinked_workspace_before_classifying_icloud_storage() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("home");
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
        std::fs::create_dir_all(&icloud).unwrap();
        let note = icloud.join("offline.md");
        std::fs::write(&note, "# Offline\n").unwrap();
        let workspace = directory.path().join("workspace");
        std::os::unix::fs::symlink(&icloud, &workspace).unwrap();

        let resolved = summary_read_path(&workspace.join("offline.md")).expect("workspace target");
        let bytes = summary_note_bytes_after_availability_check(
            LocalFileAvailability::Unknown,
            path_is_in_icloud_storage_in(&resolved, &home),
            || -> Result<Vec<u8>, std::io::Error> {
                panic!("a summary must not read an iCloud note through a workspace symlink")
            },
        );

        assert!(bytes.is_none());
    }

    #[test]
    fn unavailable_icloud_state_is_rejected_before_the_note_reader_runs() {
        let path = Path::new("/iCloudDrive/plan.md");
        let result = read_note_after_availability_check(
            path,
            LocalFileAvailability::ICloudNotDownloaded,
            || -> Result<Vec<u8>, std::io::Error> {
                panic!("an unavailable iCloud note must not be read")
            },
        );

        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("an unavailable iCloud note must be rejected"),
        };
        assert!(error.contains("Download it in Finder"));
    }

    /// Reads that may wait on a cloud provider must not be synchronous
    /// commands.
    ///
    /// A synchronous `#[tauri::command]` runs on the main thread; only an
    /// `async` one reaches the runtime. On a desktop with local files the
    /// difference is invisible, which is exactly why this went unnoticed: on a
    /// phone every note lives in iCloud as a placeholder until its bytes are
    /// asked for, and the asking is what blocks. `read_note_at` was
    /// synchronous, so opening a note froze the interface for as long as the
    /// provider took — seconds, on a note that had been evicted.
    ///
    /// This is asserted against the source text because there is nothing else
    /// to assert against. The failure has no behavioural signature anywhere a
    /// test can run: a simulator has no placeholders, CI has no iCloud, and a
    /// local temp file materializes instantly. The only durable evidence that
    /// the invariant still holds is the keyword.
    #[test]
    fn commands_that_may_wait_on_a_cloud_provider_are_async() {
        let source = include_str!("lib.rs");
        for command in ["read_note_at", "list_workspace", "list_workspace_folder"] {
            assert!(
                source.contains(&format!("async fn {command}(")),
                "`{command}` reads files a cloud provider may not have materialized yet, so it \
                 must be an async command — a synchronous one runs on the UI thread and freezes \
                 the app for the length of the download. Wrap the work in `off_the_ui_thread`.",
            );
        }
    }

    /// The D7 contract in the one place this crate can break it.
    #[test]
    fn catalog_entries_do_not_read_preview_bytes() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("note.md"),
            b"# Title\n\nThe agent rewrites this file while you read it.\n",
        )
        .unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(
            catalog.notes[0].preview,
            None,
        );
    }

    /// A note with no prose is not an error and not an empty string — it has
    /// no preview, and the row simply shows none.
    #[test]
    fn a_note_without_prose_has_no_preview() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("stub.md"), b"# Just A Heading\n").unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(catalog.notes[0].preview, None);
    }

    /// Preview extraction stays bounded even though it happens after the
    /// metadata-only folder catalog has already rendered.
    #[test]
    fn preview_worker_reads_only_a_bounded_prefix_of_each_note() {
        let directory = tempfile::tempdir().unwrap();
        let mut huge = String::from("# Huge\n\nThe opening sentence is right here.\n");
        huge.push_str(&"filler filler filler\n".repeat(250_000));
        fs::write(directory.path().join("huge.md"), huge.as_bytes()).unwrap();

        assert_eq!(
            preview_of(&directory.path().join("huge.md")).as_deref(),
            Some("The opening sentence is right here.")
        );
    }

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
    fn chat_completion_url_appends_the_endpoint_regardless_of_a_trailing_slash() {
        assert_eq!(
            chat_completion_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completion_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn models_url_appends_the_endpoint_regardless_of_a_trailing_slash() {
        assert_eq!(
            models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn chat_completion_body_carries_the_model_and_messages_verbatim() {
        let messages = vec![ChatMessage {
            role: "system".to_string(),
            content: "fix it".to_string(),
        }];
        let body = chat_completion_body("gpt-4o", &messages);
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "fix it");
    }

    /// Chart data resolves exactly the way a Markdown link does — same
    /// resolver, same refusals — because a chart naming a file and a link
    /// naming a file are the same act (EDITOR-17).
    #[test]
    fn chart_data_reads_a_file_beside_the_note() {
        let dir = tempfile::tempdir().expect("temp dir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");
        std::fs::write(dir.path().join("sales.csv"), "slot,hit\n1,0.94\n").expect("write data");

        let read = read_data_at(note.to_str().expect("note path"), "sales.csv").expect("read data");

        assert_eq!(read, "slot,hit\n1,0.94\n");
    }

    #[test]
    fn chart_data_follows_a_relative_path_out_of_the_notes_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        let notes = dir.path().join("notes");
        let shared = dir.path().join("shared");
        std::fs::create_dir_all(&notes).expect("notes dir");
        std::fs::create_dir_all(&shared).expect("shared dir");
        let note = notes.join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");
        std::fs::write(shared.join("sales.csv"), "a,b\n1,2\n").expect("write data");

        let read = read_data_at(note.to_str().expect("note path"), "../shared/sales.csv")
            .expect("read data");

        assert_eq!(read, "a,b\n1,2\n");
    }

    #[test]
    fn chart_data_refuses_an_absolute_path_and_a_remote_url() {
        let dir = tempfile::tempdir().expect("temp dir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");
        let handle = note.to_str().expect("note path");

        let absolute = read_data_at(handle, "/etc/hosts").expect_err("absolute must be refused");
        assert!(absolute.contains("tied to one machine"), "{absolute}");

        let remote = read_data_at(handle, "https://vega.github.io/data/cars.json")
            .expect_err("remote must be refused");
        assert!(remote.contains("Remote data"), "{remote}");
    }

    #[test]
    fn chart_data_reports_a_missing_file_rather_than_an_empty_string() {
        let dir = tempfile::tempdir().expect("temp dir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");

        let error = read_data_at(note.to_str().expect("note path"), "missing.csv")
            .expect_err("missing file must be refused");

        assert!(error.contains("unavailable"), "{error}");
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
    fn shared_text_draft_keeps_unicode_and_rejects_empty_or_large_input() {
        let accepted = parse_shared_text_draft(r#"{"id":"draft-1","text":"Résumé — ✅"}"#)
            .expect("a nonempty Unicode share is a valid draft");
        assert_eq!(accepted.text, "Résumé — ✅");
        assert!(parse_shared_text_draft(r#"{"id":"","text":"text"}"#).is_err());
        assert!(parse_shared_text_draft(r#"{"id":"draft-2","text":""}"#).is_err());
        let oversized = format!(
            r#"{{"id":"draft-3","text":"{}"}}"#,
            "x".repeat(MAX_SHARED_DRAFT_BYTES + 1)
        );
        assert!(parse_shared_text_draft(&oversized).is_err());
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

    /// The Mac must look in the same container the phone writes to, or the
    /// folder's whole reason for existing is unmet. This pins the mirrored
    /// path, because a typo here fails silently: the app simply supplies no
    /// folder, which is indistinguishable from not being signed in to iCloud.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_icloud_folder_is_the_container_published_from_the_phone() {
        let home = tempfile::tempdir().unwrap();
        let documents = home
            .path()
            .join("Library/Mobile Documents/iCloud~app~simplemark~ios/Documents");
        fs::create_dir_all(&documents).unwrap();

        assert_eq!(
            icloud_workspaces_in(home.path()),
            vec![documents.canonicalize().unwrap()],
        );
    }

    /// The folder a person keeps at the top of iCloud Drive counts too, and
    /// comes after the container the app publishes.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_icloud_drive_folder_is_supplied_after_the_container() {
        let home = tempfile::tempdir().unwrap();
        let mobile = home.path().join("Library/Mobile Documents");
        let container = mobile.join("iCloud~app~simplemark~ios/Documents");
        let drive_folder = mobile.join("com~apple~CloudDocs/SimpleMark");
        fs::create_dir_all(&container).unwrap();
        fs::create_dir_all(&drive_folder).unwrap();

        assert_eq!(
            icloud_workspaces_in(home.path()),
            vec![
                container.canonicalize().unwrap(),
                drive_folder.canonicalize().unwrap(),
            ],
        );
    }

    /// Two spellings of one name on a case-insensitive volume are one folder.
    /// Adopting it twice would put the same notes in the sidebar under two
    /// headings, each with its own watcher.
    #[cfg(target_os = "macos")]
    #[test]
    fn one_folder_is_supplied_once_however_it_is_spelled() {
        let home = tempfile::tempdir().unwrap();
        let drive_folder = home
            .path()
            .join("Library/Mobile Documents/com~apple~CloudDocs/Simplemark");
        fs::create_dir_all(&drive_folder).unwrap();

        let supplied = icloud_workspaces_in(home.path());
        assert_eq!(supplied.len(), 1, "supplied {supplied:?}");
    }

    /// Signed out of iCloud, iCloud Drive off, or the phone has never run the
    /// app. None of those is an error to report — desktop simply supplies no
    /// folder and the shell stays where it was.
    #[cfg(target_os = "macos")]
    #[test]
    fn no_icloud_folder_is_an_answer_rather_than_a_failure() {
        let home = tempfile::tempdir().unwrap();

        assert!(icloud_workspaces_in(home.path()).is_empty());
    }

    /// A file that stops existing between the listing and the inspection must
    /// cost that one note, never the folder. Simulated with a symlink whose
    /// target is deleted, which `read_dir` still reports and `metadata` cannot
    /// answer for — the same pair of facts iCloud produces while it evicts a
    /// directory, and the reason a whole collection could vanish over one file.
    #[test]
    fn a_note_that_cannot_be_inspected_does_not_fail_the_folder() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("real.md"), b"# Real\n").unwrap();

        let vanished = directory.path().join("vanished.md");
        fs::write(&vanished, b"# Gone\n").unwrap();
        let dangling = directory.path().join("dangling.md");
        std::os::unix::fs::symlink(&vanished, &dangling).unwrap();
        fs::remove_file(&vanished).unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "real.md");
    }

    /// Following symlinks is the existing behaviour and stays that way: a note
    /// reached through a link is a note. Only the broken ones are skipped.
    #[test]
    fn a_note_reached_through_a_symlink_is_still_listed() {
        let directory = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let target = elsewhere.path().join("target.md");
        fs::write(&target, b"# Target\n").unwrap();
        std::os::unix::fs::symlink(&target, directory.path().join("linked.md")).unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "linked.md");
    }

    /// Dropping the separate `is_file` check must not let a directory whose
    /// name ends in `.md` be listed as a note.
    #[test]
    fn a_directory_named_like_a_note_is_not_a_note() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("archive.md")).unwrap();
        fs::write(directory.path().join("real.md"), b"# Real\n").unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "real.md");
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
    fn named_workspace_catalog_keeps_the_person_facing_folder_name() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("first.md"), b"# First\n").unwrap();

        let catalog = workspace_catalog_named(directory.path(), "SimpleMark").unwrap();

        assert_eq!(catalog.name, "SimpleMark");
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
    fn new_note_names_are_markdown_filenames_not_paths() {
        assert_eq!(
            markdown_file_name("Project plan").unwrap(),
            "Project plan.md"
        );
        assert_eq!(
            markdown_file_name("Project.markdown").unwrap(),
            "Project.markdown"
        );
        assert!(markdown_file_name("../outside.md").is_err());
        assert!(markdown_file_name("Project.txt").is_err());
    }

    #[test]
    fn first_save_uses_create_new_and_never_replaces_an_existing_note() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("Plan.md");
        fs::write(&destination, b"keep me").unwrap();

        let error = write_new_note(&destination, b"# replacement\n").unwrap_err();

        assert!(error.contains("already exists"));
        assert_eq!(fs::read(&destination).unwrap(), b"keep me");
    }

    #[test]
    fn rename_preserves_bytes_and_refuses_to_replace_an_existing_note() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("draft.md");
        let occupied = directory.path().join("taken.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        fs::write(&occupied, b"do not replace").unwrap();

        let collision = match rename_note(source.display().to_string(), "taken".to_string()) {
            Ok(_) => panic!("renaming onto an existing note must fail"),
            Err(error) => error,
        };
        assert!(collision.contains("already exists"));
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
        assert_eq!(fs::read(&occupied).unwrap(), b"do not replace");

        let renamed = rename_note(source.display().to_string(), "renamed".to_string()).unwrap();
        assert_eq!(renamed.name, "renamed.md");
        assert!(!source.exists());
        assert_eq!(
            fs::read(directory.path().join("renamed.md")).unwrap(),
            b"# Exact\r\n\r\nbytes"
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

    #[test]
    fn copy_note_to_copies_bytes_to_a_new_path() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        let destination = directory.path().join("renamed idea.md");

        let saved = copy_note_to(&source, &destination).unwrap();

        assert_eq!(saved.name, "renamed idea.md");
        assert_eq!(fs::read(&destination).unwrap(), b"# Exact\r\n\r\nbytes");
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
    }

    #[test]
    fn copy_note_to_the_same_path_reads_without_copying() {
        // fs::copy opens the destination for writing before it has finished
        // reading the source, so copying a file onto itself risks truncating
        // it mid-read. The same path must short-circuit instead.
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();

        let saved = copy_note_to(&source, &source).unwrap();

        assert_eq!(saved.name, "idea.md");
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
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
