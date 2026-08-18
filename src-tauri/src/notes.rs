// Threads live beside the document in `.simplemark/`, keyed by the note id.
//
// The `.md` holds a front-matter `comments:` link to that file (ADR-0011).
// Opening a document never writes. A degraded `path-` key stays in application
// data so a read-only file does not grow a sidecar folder.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

fn threads_dir_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "No application data directory".to_string())?;
    Ok(base.join("SimpleMark").join("threads"))
}

fn validate_note_key(note_key: &str) -> Result<(), String> {
    // The key is either an opaque id we generated or `path-<hex>`; neither can
    // contain a separator. Refuse anything else rather than write outside.
    if note_key.is_empty()
        || note_key.contains('/')
        || note_key.contains('\\')
        || note_key.contains("..")
        || note_key.chars().any(|c| c.is_control())
    {
        return Err("Invalid note key".to_string());
    }
    Ok(())
}

fn threads_file(note_key: &str) -> Result<PathBuf, String> {
    validate_note_key(note_key)?;
    Ok(threads_dir_path()?.join(format!("{note_key}.json")))
}

#[cfg(test)]
fn threads_file_in(dir: &Path, note_key: &str) -> Result<PathBuf, String> {
    validate_note_key(note_key)?;
    Ok(dir.join(format!("{note_key}.json")))
}

fn read_threads_file(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

fn write_threads_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    write_bytes_atomically(path, contents.as_bytes()).map_err(|error| error.to_string())
}

/// Writes bytes atomically: temp file in the same directory, fsync, rename.
fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path is not a file"))?
        .to_string_lossy();
    let temp = directory.join(format!(".{file_name}.simplemark-tmp"));
    let write_result = (|| -> io::Result<()> {
        let mut file = File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if let Ok(existing) = fs::metadata(path) {
            let _ = fs::set_permissions(&temp, existing.permissions());
        }
        fs::rename(&temp, path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write_result
}

fn path_is_unwritable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.permissions().readonly())
        .unwrap_or(false)
}

fn ensure_write_outcome(error: io::Error) -> Result<EnsureNoteId, String> {
    if error.kind() == io::ErrorKind::PermissionDenied {
        return Ok(EnsureNoteId {
            id: None,
            unwritable: true,
            markdown: None,
        });
    }
    Err(error.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ThreadsLocation {
    Sidecar(PathBuf),
    AppData(PathBuf),
}

impl ThreadsLocation {
    fn path(&self) -> &Path {
        match self {
            ThreadsLocation::Sidecar(path) | ThreadsLocation::AppData(path) => path,
        }
    }
}

#[derive(Clone, Copy)]
enum Intent {
    Read,
    Write,
}

/// Where the sidecar *would* be, when this key and handle allow one at all.
fn sidecar_candidate(note_key: &str, document_handle: Option<&Path>) -> Result<Option<PathBuf>, String> {
    validate_note_key(note_key)?;
    if note_key.starts_with("path-") {
        return Ok(None);
    }
    let Some(document) = document_handle else {
        return Ok(None);
    };
    if !document.is_absolute() {
        return Ok(None);
    }
    let parent = document
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    Ok(Some(parent.join(".simplemark").join(format!("{note_key}.json"))))
}

/// Can we create the sidecar directory and a file inside it?
///
/// iOS grants a document opened from Files a scope on the file, not on the
/// folder around it, so the answer there is usually "no" — and that must cost
/// the sidecar, never the note. Only permission answers count as "no"; a full
/// disk is still an error.
fn sidecar_dir_is_writable(sidecar: &Path) -> Result<bool, String> {
    sidecar_dir_is_writable_with(sidecar, |probe| {
        fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(probe)
            .map(|_file| ())
    })
}

/// `sidecar_dir_is_writable`, with the probe's open call swapped out so a test
/// can force the denied path deterministically. When the probe reports "not
/// writable" and this call is the one that created `directory`, the empty
/// directory is removed again — a failed probe must not leave `.simplemark/`
/// behind next to a document we were never granted write access to.
fn sidecar_dir_is_writable_with(
    sidecar: &Path,
    probe: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<bool, String> {
    let Some(directory) = sidecar.parent() else {
        return Ok(false);
    };
    let denied = |error: &io::Error| {
        matches!(
            error.kind(),
            io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem
        )
    };
    let existed = directory.exists();
    if let Err(error) = fs::create_dir_all(directory) {
        return if denied(&error) { Ok(false) } else { Err(error.to_string()) };
    }
    let probe_path = directory.join(".write-probe");
    let outcome = probe(&probe_path);
    let _ = fs::remove_file(&probe_path);
    match outcome {
        Ok(()) => Ok(true),
        Err(error) if denied(&error) => {
            if !existed {
                // Best-effort: only removes an empty directory, and the probe
                // file above is already gone, so this is exactly the
                // directory we just created and nothing else.
                let _ = fs::remove_dir(directory);
            }
            Ok(false)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn resolve_threads_location(
    note_key: &str,
    document_handle: Option<&Path>,
    intent: Intent,
) -> Result<ThreadsLocation, String> {
    if let Some(sidecar) = sidecar_candidate(note_key, document_handle)? {
        let use_sidecar = match intent {
            Intent::Read => sidecar.exists(),
            Intent::Write => sidecar.exists() || sidecar_dir_is_writable(&sidecar)?,
        };
        if use_sidecar {
            return Ok(ThreadsLocation::Sidecar(sidecar));
        }
    }
    Ok(ThreadsLocation::AppData(threads_file(note_key)?))
}

fn apply_read_note_threads(note_key: &str, document_handle: Option<&Path>) -> Result<String, String> {
    let location = resolve_threads_location(note_key, document_handle, Intent::Read)?;
    read_threads_file(location.path())
}

fn apply_write_note_threads(
    note_key: &str,
    contents: &str,
    document_handle: Option<&Path>,
    ledger: &crate::WriteLedger,
) -> Result<(), String> {
    let location = resolve_threads_location(note_key, document_handle, Intent::Write)?;
    let path = location.path().to_path_buf();
    // Record before the bytes land: a mobile poll that lands in the window
    // between the write and the record would otherwise see a changed file
    // with no ledger entry and emit a spurious reload.
    ledger.record_bytes(path.clone(), contents.as_bytes())?;
    write_threads_file(&path, contents)
}

/// The threads file the mobile watcher should hash for this document: the
/// linked sidecar when it exists, else app data for the id (or the degraded key).
#[cfg_attr(not(mobile), allow(dead_code))]
pub(crate) fn threads_file_for_document(document: &Path) -> Result<PathBuf, String> {
    let text = fs::read_to_string(document).unwrap_or_default();
    let key = extract_id(&text).unwrap_or_else(|| degraded_key_for_path(document));
    Ok(resolve_threads_location(&key, Some(document), Intent::Read)?.path().to_path_buf())
}

/// Mirrors `noteKeyForPath` in src/adapters/filesystem/tauri-thread-store.ts:
/// hash = (hash * 131 + codepoint) mod 2^64 over the path's chars, hex, 16 wide.
/// Called from `threads_file_for_document`, which only the mobile watcher uses.
#[cfg_attr(not(mobile), allow(dead_code))]
fn degraded_key_for_path(path: &Path) -> String {
    let mut hash: u64 = 0;
    for ch in path.to_string_lossy().chars() {
        hash = hash.wrapping_mul(131).wrapping_add(ch as u64);
    }
    format!("path-{hash:016x}")
}

#[tauri::command]
pub async fn read_note_threads(
    note_key: String,
    document_handle: Option<String>,
) -> Result<String, String> {
    crate::off_the_ui_thread(move || {
        apply_read_note_threads(&note_key, document_handle.as_deref().map(Path::new))
    })
    .await
}

#[tauri::command]
pub async fn write_note_threads(
    note_key: String,
    contents: String,
    document_handle: Option<String>,
    ledger: State<'_, crate::WriteLedger>,
) -> Result<(), String> {
    let ledger = ledger.inner().clone();
    crate::off_the_ui_thread(move || {
        apply_write_note_threads(
            &note_key,
            &contents,
            document_handle.as_deref().map(Path::new),
            &ledger,
        )
    })
    .await
}

#[derive(Serialize)]
pub struct EnsureNoteId {
    pub id: Option<String>,
    pub unwritable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
}

/// The `id:` line from front matter, if there is one.
///
/// This must never write. Opening a document is a read, and a reader that
/// modifies what it reads is the behaviour this whole design exists to avoid.
#[tauri::command]
pub async fn read_note_id(document_handle: String) -> Result<Option<String>, String> {
    crate::off_the_ui_thread(move || read_id_at(Path::new(&document_handle))).await
}

/// A handle with no readable file behind it (the welcome sample, an unsaved
/// draft) has no id. Opening a document must never fail on its notes.
fn read_id_at(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(extract_id(&text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn extract_id(text: &str) -> Option<String> {
    extract_front_matter_field(text, "id")
}

fn extract_comments(text: &str) -> Option<String> {
    extract_front_matter_field(text, "comments")
}

fn extract_front_matter_field(text: &str, key: &str) -> Option<String> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    let prefix = format!("{key}:");
    rest[..end].lines().find_map(|line| {
        let value = line.strip_prefix(&prefix)?.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn comments_href(id: &str) -> String {
    format!(".simplemark/{id}.json")
}

#[tauri::command]
pub async fn ensure_note_id(
    document_handle: String,
    ledger: State<'_, crate::WriteLedger>,
) -> Result<EnsureNoteId, String> {
    let ledger = ledger.inner().clone();
    crate::off_the_ui_thread(move || {
        let path = PathBuf::from(&document_handle);
        let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        apply_ensure_note_id(&path, &text, |bytes| ledger.record_bytes(path.clone(), bytes))
    })
    .await
}

fn apply_ensure_note_id(
    path: &Path,
    text: &str,
    record: impl FnOnce(&[u8]) -> Result<(), String>,
) -> Result<EnsureNoteId, String> {
    if path_is_unwritable(path) {
        return Ok(EnsureNoteId {
            id: extract_id(text),
            unwritable: true,
            markdown: None,
        });
    }
    if let Some(existing) = extract_id(text) {
        if extract_comments(text).is_some() {
            return Ok(EnsureNoteId {
                id: Some(existing),
                unwritable: false,
                markdown: None,
            });
        }
        let updated = insert_comments_link(text, &existing);
        let bytes = updated.as_bytes();
        record(bytes)?;
        return match write_bytes_atomically(path, bytes) {
            Ok(()) => Ok(EnsureNoteId {
                id: Some(existing),
                unwritable: false,
                markdown: Some(updated),
            }),
            Err(error) => ensure_write_outcome(error),
        };
    }

    let id = new_id();
    let updated = insert_id(text, &id);
    let bytes = updated.as_bytes();
    // Record before the rename: the watcher may fire the moment it lands.
    record(bytes)?;
    match write_bytes_atomically(path, bytes) {
        Ok(()) => Ok(EnsureNoteId {
            id: Some(id),
            unwritable: false,
            markdown: Some(updated),
        }),
        Err(error) => ensure_write_outcome(error),
    }
}

/// Time-ordered and collision-resistant enough for one machine's notes.
fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

/// Adds `id:` to existing front matter, or creates a block if there is none.
/// Existing keys, comments and ordering are preserved — the fidelity corpus
/// (DESIGN.md §548) requires front matter to survive untouched.
///
/// A leading `---` is only a YAML fence when a later `\n---` closes it. A
/// thematic break (`---\n\n# Title`) is document text, not an open block.
fn insert_id(text: &str, id: &str) -> String {
    let comments = comments_href(id);
    if let Some(rest) = text.strip_prefix("---\n") {
        if rest.contains("\n---") {
            return format!("---\nid: {id}\ncomments: {comments}\n{rest}");
        }
    }
    format!("---\nid: {id}\ncomments: {comments}\n---\n\n{text}")
}

/// Adds `comments:` after the existing `id:` line. Does not invent an id.
fn insert_comments_link(text: &str, id: &str) -> String {
    if extract_comments(text).is_some() {
        return text.to_string();
    }
    let comments = comments_href(id);
    let needle = format!("id: {id}\n");
    if let Some(at) = text.find(&needle) {
        let end = at + needle.len();
        return format!("{}comments: {comments}\n{}", &text[..end], &text[end..]);
    }
    if let Some(rest) = text.strip_prefix("---\n") {
        if rest.contains("\n---") {
            return format!("---\ncomments: {comments}\n{rest}");
        }
    }
    format!("---\nid: {id}\ncomments: {comments}\n---\n\n{text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_id_from_front_matter() {
        assert_eq!(
            extract_id("---\nid: abc\ntitle: x\n---\n\nbody"),
            Some("abc".into())
        );
    }

    #[test]
    fn has_no_id_when_there_is_no_front_matter() {
        assert_eq!(extract_id("# Just a heading"), None);
    }

    #[test]
    fn inserting_keeps_existing_front_matter() {
        let out = insert_id("---\ntitle: x\n---\n\nbody", "abc");
        assert!(out.starts_with("---\nid: abc\ncomments: .simplemark/abc.json\ntitle: x\n---"));
        assert!(out.ends_with("body"));
    }

    #[test]
    fn inserting_creates_front_matter_when_absent() {
        assert_eq!(
            insert_id("body", "abc"),
            "---\nid: abc\ncomments: .simplemark/abc.json\n---\n\nbody"
        );
    }

    #[test]
    fn inserting_wraps_a_thematic_break_instead_of_injecting_under_it() {
        let out = insert_id("---\n\n# Title\n", "abc");
        assert_eq!(
            out,
            "---\nid: abc\ncomments: .simplemark/abc.json\n---\n\n---\n\n# Title\n"
        );
        assert_eq!(extract_id(&out), Some("abc".into()));
    }

    #[test]
    fn comments_link_is_added_after_an_existing_id() {
        let out = insert_comments_link("---\nid: abc\ntitle: x\n---\n\nbody", "abc");
        assert_eq!(
            out,
            "---\nid: abc\ncomments: .simplemark/abc.json\ntitle: x\n---\n\nbody"
        );
    }

    #[test]
    fn a_handle_that_is_not_a_file_has_no_id() {
        assert_eq!(read_id_at(Path::new("fixture:welcome-to-simplemark")), Ok(None));
    }

    #[test]
    fn refuses_a_note_key_with_a_path_separator() {
        assert_eq!(
            apply_read_note_threads("foo/bar", None),
            Err("Invalid note key".into())
        );
        assert_eq!(
            apply_read_note_threads("foo\\bar", None),
            Err("Invalid note key".into())
        );
        assert_eq!(
            apply_read_note_threads("..secret", None),
            Err("Invalid note key".into())
        );
    }

    #[test]
    fn refuses_an_empty_or_control_character_note_key() {
        assert_eq!(
            apply_read_note_threads("", None),
            Err("Invalid note key".into())
        );
        assert_eq!(
            apply_read_note_threads("foo\nbar", None),
            Err("Invalid note key".into())
        );
    }

    #[test]
    fn read_note_id_does_not_write() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "# Just a heading\n";
        fs::write(&path, original).expect("write fixture");
        let id = read_id_at(&path).expect("read id");
        assert_eq!(id, None);
        let after = fs::read_to_string(&path).expect("re-read fixture");
        assert_eq!(after, original);
    }

    #[test]
    fn threads_round_trip_creates_the_directory_only_on_write() {
        let dir = tempfile::tempdir().expect("temp dir");
        let threads = dir.path().join("threads");
        let path = threads_file_in(&threads, "abc123").expect("valid key");
        assert_eq!(read_threads_file(&path).expect("missing is empty"), "");
        assert!(
            !threads.exists(),
            "a read must not create SimpleMark/threads"
        );
        write_threads_file(&path, "{\"ok\":true}").expect("write threads");
        assert!(threads.is_dir());
        assert_eq!(
            read_threads_file(&path).expect("read back"),
            "{\"ok\":true}"
        );
        let leftovers: Vec<_> = fs::read_dir(&threads)
            .expect("list threads")
            .filter_map(|entry| {
                let name = entry.ok()?.file_name();
                let name = name.to_string_lossy();
                name.contains("simplemark-tmp").then(|| name.into_owned())
            })
            .collect();
        assert!(leftovers.is_empty(), "atomic write left debris: {leftovers:?}");
    }

    #[test]
    fn ensure_writes_a_closed_id_block_on_a_bare_note() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "# Title\n";
        fs::write(&path, original).expect("write fixture");
        let mut recorded = None;
        let result = apply_ensure_note_id(&path, original, |bytes| {
            recorded = Some(bytes.to_vec());
            Ok(())
        })
        .expect("ensure id");
        assert!(!result.unwritable);
        let id = result.id.expect("issued id");
        let after = fs::read_to_string(&path).expect("re-read");
        assert_eq!(
            after,
            format!("---\nid: {id}\ncomments: .simplemark/{id}.json\n---\n\n# Title\n")
        );
        assert_eq!(extract_id(&after), Some(id.clone()));
        assert!(
            after.contains(&format!("comments: .simplemark/{id}.json")),
            "front matter must link the sidecar: {after}"
        );
        assert_eq!(recorded.as_deref(), Some(after.as_bytes()));
    }

    #[test]
    fn ensure_wraps_a_thematic_break_on_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "---\n\n# Title\n";
        fs::write(&path, original).expect("write fixture");
        let result = apply_ensure_note_id(&path, original, |_| Ok(())).expect("ensure id");
        let id = result.id.expect("issued id");
        let after = fs::read_to_string(&path).expect("re-read");
        assert_eq!(
            after,
            format!("---\nid: {id}\ncomments: .simplemark/{id}.json\n---\n\n---\n\n# Title\n")
        );
        assert_eq!(extract_id(&after), Some(id));
    }

    #[test]
    fn ensure_reports_unwritable_when_the_file_is_read_only() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "body\n";
        fs::write(&path, original).expect("write fixture");
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).expect("chmod");
        let result = apply_ensure_note_id(&path, original, |_| {
            panic!("must not record a write that cannot land")
        })
        .expect("degraded note");
        assert!(result.unwritable);
        assert_eq!(result.id, None);
        assert_eq!(fs::read_to_string(&path).expect("unchanged"), original);
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).expect("restore");
    }

    #[test]
    fn ensure_reports_unwritable_when_a_read_only_file_already_has_an_id() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "---\nid: abc\n---\n\nbody\n";
        fs::write(&path, original).expect("write fixture");
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).expect("chmod");
        let result = apply_ensure_note_id(&path, original, |_| {
            panic!("must not record a write that cannot land")
        })
        .expect("degraded note");
        assert!(result.unwritable);
        assert_eq!(fs::read_to_string(&path).expect("unchanged"), original);
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).expect("restore");
    }

    #[test]
    fn ensure_reports_unwritable_when_a_read_only_file_already_has_comments() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "---\nid: abc\ncomments: .simplemark/abc.json\n---\n\nbody\n";
        fs::write(&path, original).expect("write fixture");
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).expect("chmod");
        let result = apply_ensure_note_id(&path, original, |_| {
            panic!("must not record a write that cannot land")
        })
        .expect("degraded note");
        assert!(result.unwritable);
        assert_eq!(fs::read_to_string(&path).expect("unchanged"), original);
        let mut permissions = fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).expect("restore");
    }

    #[test]
    fn ensure_returns_err_when_the_parent_directory_is_missing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("missing").join("note.md");
        let result = apply_ensure_note_id(&path, "body\n", |_| Ok(()));
        assert!(result.is_err(), "non-permission IO must not look unwritable");
    }

    #[test]
    fn permission_denied_is_the_only_unwritable_io_error() {
        let denied = ensure_write_outcome(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "access denied",
        ))
        .expect("mapped");
        assert!(denied.unwritable);
        assert_eq!(denied.id, None);
        let other = ensure_write_outcome(io::Error::new(io::ErrorKind::NotFound, "gone"));
        assert!(other.is_err());
    }

    #[test]
    fn write_threads_beside_the_document() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "---\nid: abc\n---\n\nbody\n").expect("write fixture");
        let ledger = crate::WriteLedger::default();
        apply_write_note_threads("sidecartest-abc", "[{\"ok\":true}]", Some(&path), &ledger)
            .expect("write");
        let sidecar = dir.path().join(".simplemark").join("sidecartest-abc.json");
        assert_eq!(
            fs::read_to_string(&sidecar).expect("sidecar"),
            "[{\"ok\":true}]"
        );
        assert_eq!(
            apply_read_note_threads("sidecartest-abc", Some(&path)).expect("read"),
            "[{\"ok\":true}]"
        );
        let leftovers: Vec<_> = fs::read_dir(dir.path().join(".simplemark"))
            .expect("list sidecar dir")
            .filter_map(|entry| {
                let name = entry.ok()?.file_name();
                let name = name.to_string_lossy();
                name.contains("simplemark-tmp").then(|| name.into_owned())
            })
            .collect();
        assert!(leftovers.is_empty(), "atomic write left debris: {leftovers:?}");
    }

    #[test]
    fn reading_threads_does_not_create_the_sidecar_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "---\nid: abc\n---\n\nbody\n").expect("write fixture");
        assert_eq!(
            apply_read_note_threads("sidecartest-read-empty", Some(&path)).expect("missing is empty"),
            ""
        );
        assert!(
            !dir.path().join(".simplemark").exists(),
            "a read must not create .simplemark"
        );
    }

    #[test]
    fn degraded_path_keys_do_not_use_the_sidecar_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        assert_eq!(
            sidecar_candidate("path-0123456789abcdef", Some(&path)).expect("valid key"),
            None
        );
        assert!(!dir.path().join(".simplemark").exists());
    }

    #[test]
    fn relative_document_handles_do_not_use_the_sidecar_folder() {
        assert_eq!(
            sidecar_candidate("abc", Some(Path::new("Not saved"))).expect("valid key"),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_write_falls_back_to_app_data_when_the_parent_dir_is_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "---\nid: fallbackabc\n---\n\nbody\n").expect("fixture");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).expect("chmod");
        let location = resolve_threads_location("fallbackabc", Some(&path), Intent::Write)
            .expect("resolves");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).expect("restore");
        assert!(matches!(location, ThreadsLocation::AppData(_)), "{location:?}");
        assert!(!dir.path().join(".simplemark").exists());
    }

    #[test]
    fn a_failed_probe_does_not_leave_a_freshly_created_sidecar_dir_behind() {
        let dir = tempfile::tempdir().expect("temp dir");
        let sidecar = dir.path().join(".simplemark").join("probefail.json");
        let writable = sidecar_dir_is_writable_with(&sidecar, |_probe| {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        })
        .expect("resolves");
        assert_eq!(writable, false);
        assert!(
            !dir.path().join(".simplemark").exists(),
            "must not leave the directory it created when the probe is denied"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_probe_leaves_a_pre_existing_sidecar_dir_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("temp dir");
        let sidecar_dir = dir.path().join(".simplemark");
        fs::create_dir_all(&sidecar_dir).expect("mkdir");
        fs::set_permissions(&sidecar_dir, fs::Permissions::from_mode(0o500)).expect("chmod");
        let sidecar = sidecar_dir.join("preexisting.json");
        let writable = sidecar_dir_is_writable(&sidecar).expect("resolves");
        fs::set_permissions(&sidecar_dir, fs::Permissions::from_mode(0o700)).expect("restore");
        assert_eq!(writable, false);
        assert!(sidecar_dir.exists(), "a pre-existing directory must survive a denied probe");
        assert!(
            !sidecar_dir.join(".write-probe").exists(),
            "the probe file must not be left behind"
        );
    }

    #[test]
    fn a_write_uses_the_sidecar_when_the_parent_dir_is_writable() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "body\n").expect("fixture");
        let location = resolve_threads_location("writableabc", Some(&path), Intent::Write)
            .expect("resolves");
        assert_eq!(
            location,
            ThreadsLocation::Sidecar(dir.path().join(".simplemark").join("writableabc.json"))
        );
        assert!(
            !dir.path().join(".simplemark").join(".write-probe").exists(),
            "the probe file must not be left behind"
        );
    }

    #[test]
    fn a_read_prefers_an_existing_sidecar_and_otherwise_app_data() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "body\n").expect("fixture");
        assert!(matches!(
            resolve_threads_location("readabc", Some(&path), Intent::Read).expect("resolves"),
            ThreadsLocation::AppData(_)
        ));
        fs::create_dir_all(dir.path().join(".simplemark")).expect("mkdir");
        fs::write(dir.path().join(".simplemark").join("readabc.json"), "[]").expect("sidecar");
        assert!(matches!(
            resolve_threads_location("readabc", Some(&path), Intent::Read).expect("resolves"),
            ThreadsLocation::Sidecar(_)
        ));
    }

    #[test]
    fn threads_file_for_document_follows_the_front_matter_link() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "---\nid: linked1\ncomments: .simplemark/linked1.json\n---\n\nbody\n")
            .expect("fixture");
        let sidecar = dir.path().join(".simplemark").join("linked1.json");
        // Not present yet: app data.
        assert_ne!(threads_file_for_document(&path).expect("resolves"), sidecar);
        fs::create_dir_all(sidecar.parent().unwrap()).expect("mkdir");
        fs::write(&sidecar, "[]").expect("sidecar");
        assert_eq!(threads_file_for_document(&path).expect("resolves"), sidecar);
    }

    #[test]
    fn threads_file_for_document_uses_the_degraded_key_without_an_id() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "body\n").expect("fixture");
        let file = threads_file_for_document(&path).expect("resolves");
        let name = file.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("path-"), "{name}");
    }

    #[test]
    fn degraded_key_matches_the_typescript_note_key_for_path() {
        // node -e "…noteKeyForPath('/tmp/a.md')" → path-39a4d087f4444fa3
        assert_eq!(degraded_key_for_path(Path::new("/tmp/a.md")), "path-39a4d087f4444fa3");
    }
}
