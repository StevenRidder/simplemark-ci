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
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, Url};
use tauri_plugin_dialog::DialogExt;

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

/// What this process last wrote to each path, so the watcher can tell our own
/// saves apart from someone else's edit.
#[derive(Default)]
pub struct WriteLedger(Mutex<HashMap<PathBuf, u64>>);

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

/// Reads a note that is already chosen — used by reopen and by the watcher.
#[tauri::command]
fn read_note_at(path: String) -> Result<OpenedNote, String> {
    read_note(Path::new(&path))
}

fn read_note(path: &Path) -> Result<OpenedNote, String> {
    let bytes = fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
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

fn queue_opened_notes(app: &AppHandle, urls: &[Url]) {
    let paths = opened_markdown_paths(urls);
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
fn watch_note(app: AppHandle, handle: String) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    let directory = path
        .parent()
        .ok_or_else(|| format!("{handle} has no parent directory to watch"))?
        .to_path_buf();

    std::thread::spawn(move || {
        let (sender, receiver) = channel::<notify::Result<Event>>();
        let Ok(mut watcher) = notify::recommended_watcher(sender) else {
            return;
        };
        // Watch the directory, not the file: editors that save by rename
        // replace the inode, and a file watch would follow the old one into
        // oblivion and then report nothing forever.
        if watcher.watch(&directory, RecursiveMode::NonRecursive).is_err() {
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
            if !event.paths.iter().any(|changed| changed == &path) {
                continue;
            }

            // Coalesce: one logical save produces several filesystem events.
            std::thread::sleep(Duration::from_millis(120));

            let Ok(current) = fs::read(&path) else { continue };
            let hash = content_hash(&current);

            let ours = app
                .state::<WriteLedger>()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WriteLedger::default())
        .manage(OpenRequestQueue::default())
        .invoke_handler(tauri::generate_handler![
            open_note,
            read_note_at,
            take_open_note_request,
            save_note,
            watch_note
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

    #[test]
    fn identical_content_hashes_identically() {
        assert_eq!(content_hash(b"# note\n"), content_hash(b"# note\n"));
        assert_ne!(content_hash(b"# note\n"), content_hash(b"# note"));
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
}
