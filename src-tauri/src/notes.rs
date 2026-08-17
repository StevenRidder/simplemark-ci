// Threads live beside the application, never beside the document.
//
// A note opened from `~/Downloads` must not cause a hidden directory to
// appear in `~/Downloads`. The app is a guest in folders it does not own.
// The only Markdown this module may write is a front-matter `id` (ADR-0007).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

fn threads_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "No application data directory".to_string())?;
    let dir = base.join("SimpleMark").join("threads");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn threads_file(note_key: &str) -> Result<PathBuf, String> {
    // The key is either an opaque id we generated or `path-<hex>`; neither can
    // contain a separator. Refuse anything else rather than write outside.
    if note_key.contains('/') || note_key.contains('\\') || note_key.contains("..") {
        return Err("Invalid note key".to_string());
    }
    Ok(threads_dir()?.join(format!("{note_key}.json")))
}

#[tauri::command]
pub fn read_note_threads(note_key: String) -> Result<String, String> {
    let path = threads_file(&note_key)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_note_threads(note_key: String, contents: String) -> Result<(), String> {
    let path = threads_file(&note_key)?;
    fs::write(&path, contents).map_err(|error| error.to_string())
}

#[derive(Serialize)]
pub struct EnsureNoteId {
    pub id: Option<String>,
    pub unwritable: bool,
}

/// The `id:` line from front matter, if there is one.
///
/// This must never write. Opening a document is a read, and a reader that
/// modifies what it reads is the behaviour this whole design exists to avoid.
#[tauri::command]
pub fn read_note_id(document_handle: String) -> Result<Option<String>, String> {
    let text = fs::read_to_string(&document_handle).map_err(|error| error.to_string())?;
    Ok(extract_id(&text))
}

fn extract_id(text: &str) -> Option<String> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    rest[..end].lines().find_map(|line| {
        let value = line.strip_prefix("id:")?.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[tauri::command]
pub fn ensure_note_id(document_handle: String) -> Result<EnsureNoteId, String> {
    let text = fs::read_to_string(&document_handle).map_err(|error| error.to_string())?;
    if let Some(existing) = extract_id(&text) {
        return Ok(EnsureNoteId {
            id: Some(existing),
            unwritable: false,
        });
    }

    let id = new_id();
    let updated = insert_id(&text, &id);
    match fs::write(&document_handle, updated) {
        Ok(()) => Ok(EnsureNoteId {
            id: Some(id),
            unwritable: false,
        }),
        // Read-only file, or a directory we may not write. Report it; the
        // caller offers a degraded note rather than failing silently.
        Err(_) => Ok(EnsureNoteId {
            id: None,
            unwritable: true,
        }),
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
fn insert_id(text: &str, id: &str) -> String {
    if let Some(rest) = text.strip_prefix("---\n") {
        return format!("---\nid: {id}\n{rest}");
    }
    format!("---\nid: {id}\n---\n\n{text}")
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
        assert!(out.starts_with("---\nid: abc\ntitle: x\n---"));
        assert!(out.ends_with("body"));
    }

    #[test]
    fn inserting_creates_front_matter_when_absent() {
        assert_eq!(insert_id("body", "abc"), "---\nid: abc\n---\n\nbody");
    }

    #[test]
    fn refuses_a_note_key_with_a_path_separator() {
        assert_eq!(
            read_note_threads("foo/bar".into()),
            Err("Invalid note key".into())
        );
        assert_eq!(
            read_note_threads("foo\\bar".into()),
            Err("Invalid note key".into())
        );
        assert_eq!(
            read_note_threads("..secret".into()),
            Err("Invalid note key".into())
        );
    }

    #[test]
    fn read_note_id_does_not_write() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let original = "# Just a heading\n";
        fs::write(&path, original).expect("write fixture");
        let id = read_note_id(path.to_string_lossy().into_owned()).expect("read id");
        assert_eq!(id, None);
        let after = fs::read_to_string(&path).expect("re-read fixture");
        assert_eq!(after, original);
    }
}
