#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::{AllocAnyThread, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSString, NSUserDefaults};
use std::path::{Path, PathBuf};

const PREFERENCE_KEY: &str = "app.simplemark.selected-app-icon";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AppIconId {
    Original,
    LiveLayers,
    MovableBlocks,
    BlueTrio,
    ElectricBlocks,
    Midnight,
    BluePage,
}

impl AppIconId {
    #[cfg(test)]
    pub(crate) const ALL: [Self; 7] = [
        Self::Original,
        Self::LiveLayers,
        Self::MovableBlocks,
        Self::BlueTrio,
        Self::ElectricBlocks,
        Self::Midnight,
        Self::BluePage,
    ];

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "original" => Some(Self::Original),
            "live-layers" => Some(Self::LiveLayers),
            "movable-blocks" => Some(Self::MovableBlocks),
            "blue-trio" => Some(Self::BlueTrio),
            "electric-blocks" => Some(Self::ElectricBlocks),
            "midnight" => Some(Self::Midnight),
            "blue-page" => Some(Self::BluePage),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::LiveLayers => "live-layers",
            Self::MovableBlocks => "movable-blocks",
            Self::BlueTrio => "blue-trio",
            Self::ElectricBlocks => "electric-blocks",
            Self::Midnight => "midnight",
            Self::BluePage => "blue-page",
        }
    }

    pub(crate) const fn png(self) -> &'static [u8] {
        match self {
            Self::Original => include_bytes!("../icons/alternates/png/original.png"),
            Self::LiveLayers => include_bytes!("../icons/alternates/png/live-layers.png"),
            Self::MovableBlocks => include_bytes!("../icons/alternates/png/movable-blocks.png"),
            Self::BlueTrio => include_bytes!("../icons/alternates/png/blue-trio.png"),
            Self::ElectricBlocks => include_bytes!("../icons/alternates/png/electric-blocks.png"),
            Self::Midnight => include_bytes!("../icons/alternates/png/midnight.png"),
            Self::BluePage => include_bytes!("../icons/alternates/png/blue-page.png"),
        }
    }
}

fn normalise_stored(value: Option<&str>) -> AppIconId {
    value
        .and_then(AppIconId::parse)
        .unwrap_or(AppIconId::Original)
}

#[cfg(target_os = "macos")]
fn stored() -> AppIconId {
    let defaults = NSUserDefaults::standardUserDefaults();
    let key = NSString::from_str(PREFERENCE_KEY);
    let value = defaults.stringForKey(&key);
    normalise_stored(value.as_ref().map(|value| value.to_string()).as_deref())
}

#[cfg(not(target_os = "macos"))]
fn stored() -> AppIconId {
    AppIconId::Original
}

/// Decodes one of the bundled alternate-icon PNGs into an `NSImage`, shared
/// by the runtime dock-tile swap (`apply`) and the on-disk bundle write
/// (`write_bundle_icon`) so the two call sites can't drift on how a PNG
/// becomes an image.
#[cfg(target_os = "macos")]
fn decode_icon_image(icon: AppIconId) -> Result<Retained<NSImage>, String> {
    let data = NSData::with_bytes(icon.png());
    NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| format!("Could not decode the {} app icon", icon.as_str()))
}

#[cfg(target_os = "macos")]
fn apply(icon: AppIconId) -> Result<(), String> {
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "The application icon must change on the macOS main thread".to_string())?;
    let image = decode_icon_image(icon)?;
    let application = NSApplication::sharedApplication(marker);
    // SAFETY: `image` is a live NSImage created from a bundled PNG and AppKit
    // retains the application icon for the process lifetime.
    unsafe { application.setApplicationIconImage(Some(&image)) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply(_icon: AppIconId) -> Result<(), String> {
    Err("Alternate application icons are available only on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn persist(icon: AppIconId) {
    let defaults = NSUserDefaults::standardUserDefaults();
    let key = NSString::from_str(PREFERENCE_KEY);
    let value = NSString::from_str(icon.as_str());
    // SAFETY: NSString is a valid property-list value for NSUserDefaults.
    unsafe { defaults.setObject_forKey(Some(&value), &key) };
}

/// Recovers the installed `.app` bundle root from the path to the running
/// executable.
///
/// `apply()` (via `NSApplication::setApplicationIconImage`) only ever
/// repaints the Dock tile of the *running process* — it never touches
/// anything on disk. Finder, Launchpad, Spotlight, and the Dock tile shown
/// while the app is *not* running all read the icon baked into the bundle
/// itself (`Contents/Resources/icon.icns`, overridable by a custom-icon
/// extended attribute). So persisting a choice across quit/relaunch requires
/// a *second*, independent write: onto the bundle, not just the process.
///
/// A macOS app bundle built by Tauri is laid out as
/// `<Name>.app/Contents/MacOS/<exe>`, so the bundle root is exactly three
/// parents above the executable path. This function only performs that walk
/// and validates the result — it does no filesystem I/O and touches no
/// AppKit API, which is what makes it possible to unit test the one part of
/// this feature (the parent-walking arithmetic) that is easy to get subtly
/// wrong, on any platform, without a bundle or a display to test against.
fn bundle_path_from_exe(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.parent()?.parent()?.parent()?;
    if bundle.extension().and_then(|ext| ext.to_str()) == Some("app") {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

/// Writes (or removes) the custom icon on the installed `.app` bundle itself,
/// via the same mechanism as Finder's Get Info → paste icon
/// (`NSWorkspace.setIcon(_:forFile:options:)`). This is what makes an icon
/// choice survive quitting SimpleMark: `apply()` only ever changes the
/// in-memory Dock tile of the current process, while this function changes
/// what Finder/Launchpad/Spotlight/the-Dock-when-quit will read next time,
/// because they all resolve the bundle's icon from disk, not from any
/// running process.
///
/// Passing `None` for `Original` deliberately *removes* the custom-icon
/// attribute rather than painting the original artwork over it — the bundle
/// then falls back to its own shipped `icon.icns`, which is the real
/// "original" state, not a copy of it that would need un-doing again later.
///
/// Returns `Ok(())` without writing anything when the running binary is not
/// inside an installed bundle (e.g. `cargo run`, `cargo test`) — there is
/// nothing to write to, and that is normal for development, not a failure.
/// A real write failure (read-only volume, another user's install, running
/// from a mounted DMG) is reported as `Err("<bundle path>: <reason>")` so
/// callers can build a message that tells the reader exactly what happened
/// and what to expect next, per DESIGN.md's "failures are visible and
/// local".
///
/// # This writes inside the bundle, which a signed release will notice
///
/// A custom icon on a directory is not only an extended attribute: macOS also
/// creates a zero-length `Icon\r` file at the bundle root to carry the
/// artwork. Measured on this machine: setting an icon added
/// `com.apple.FinderInfo` *and* that file.
///
/// Today that costs nothing. Local builds are `adhoc, linker-signed` with
/// `Sealed Resources=none`, and `codesign --verify` reports exactly the same
/// thing before and after the write. But `RELEASE-TRUST.md` describes a
/// release that is signed, notarized and stapled, and a sealed bundle does
/// account for its top-level files — so on such a build this write would add
/// a resource the signature does not cover and could fail verification or
/// Gatekeeper. Nothing in the repo is notarized yet (`RELEASE-TRUST.md`
/// states as much), which is why this ships now rather than waiting.
///
/// Whoever turns on real signing must decide this deliberately: either accept
/// that choosing an icon invalidates the seal on the user's own copy, or drop
/// back to the runtime-only Dock tile for signed builds. It must not be
/// discovered as a mysterious "app is damaged" report.
#[cfg(target_os = "macos")]
fn write_bundle_icon(icon: AppIconId) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("could not locate the running app ({error})"))?;
    let Some(bundle) = bundle_path_from_exe(&exe) else {
        return Ok(());
    };
    let image = match icon {
        AppIconId::Original => None,
        other => Some(decode_icon_image(other)?),
    };
    let bundle_display = bundle.display().to_string();
    let full_path = NSString::from_str(&bundle_display);
    let workspace = NSWorkspace::sharedWorkspace();
    let wrote = workspace.setIcon_forFile_options(
        image.as_deref(),
        &full_path,
        NSWorkspaceIconCreationOptions::empty(),
    );
    if wrote {
        Ok(())
    } else {
        Err(format!(
            "{bundle_display}: macOS declined to write the icon onto the app bundle"
        ))
    }
}

#[tauri::command]
pub(crate) fn get_app_icon() -> String {
    stored().as_str().to_string()
}

#[tauri::command]
pub(crate) fn set_app_icon(icon: String) -> Result<(), String> {
    let icon =
        AppIconId::parse(&icon).ok_or_else(|| format!("Unknown application icon: {icon}"))?;
    // The runtime swap and the preference are applied first and unconditionally:
    // per DESIGN.md, a bundle-write failure below must not undo the part of
    // the change that already succeeded, it must only be reported.
    apply(icon)?;
    #[cfg(target_os = "macos")]
    {
        persist(icon);
        if let Err(detail) = write_bundle_icon(icon) {
            return Err(format!(
                "The icon changed for this session, but SimpleMark could not write it onto its own bundle at {detail}. It will show the original icon when SimpleMark is closed."
            ));
        }
    }
    Ok(())
}

/// Re-applies the stored icon choice at startup, both to the running
/// process (`apply`, always) and — when the choice is not `Original` — to
/// the bundle on disk (`write_bundle_icon`). The second part exists to
/// self-heal after `scripts/install-main.sh` (or any reinstall) replaces
/// `/Applications/SimpleMark.app` wholesale: a fresh bundle carries no
/// custom-icon attribute, so without this the chosen icon would silently
/// revert on every rebuild even though the preference itself survives (it
/// lives in `NSUserDefaults`, not in the bundle). A bundle-write failure
/// here is logged by the caller and never propagated as fatal — restoring
/// the on-disk icon is a nice-to-have at launch, not a precondition for the
/// app to open.
pub(crate) fn restore() -> Result<(), String> {
    let icon = stored();
    apply(icon)?;
    #[cfg(target_os = "macos")]
    if icon != AppIconId::Original {
        if let Err(detail) = write_bundle_icon(icon) {
            eprintln!(
                "SimpleMark could not heal its app bundle icon at {detail}. It will keep showing the original icon there until SimpleMark can write to its own bundle."
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalise_stored, AppIconId};
    use std::path::{Path, PathBuf};

    #[test]
    fn parses_only_known_icon_ids() {
        assert_eq!(AppIconId::parse("midnight"), Some(AppIconId::Midnight));
        assert_eq!(AppIconId::parse("blue-trio"), Some(AppIconId::BlueTrio));
        assert_eq!(
            AppIconId::parse("electric-blocks"),
            Some(AppIconId::ElectricBlocks)
        );
        assert_eq!(AppIconId::parse("unknown"), None);
    }

    #[test]
    fn every_icon_has_embedded_png_bytes() {
        for icon in AppIconId::ALL {
            assert!(icon.png().starts_with(b"\x89PNG\r\n\x1a\n"));
        }
    }

    #[test]
    fn invalid_stored_values_fall_back_to_original() {
        assert_eq!(normalise_stored(Some("live-layers")), AppIconId::LiveLayers);
        assert_eq!(normalise_stored(Some("retired-icon")), AppIconId::Original);
        assert_eq!(normalise_stored(None), AppIconId::Original);
    }

    #[test]
    fn bundle_path_from_exe_finds_the_bundle_root_three_parents_up() {
        let exe = Path::new("/Applications/SimpleMark.app/Contents/MacOS/simplemark");
        assert_eq!(
            super::bundle_path_from_exe(exe),
            Some(PathBuf::from("/Applications/SimpleMark.app"))
        );
    }

    #[test]
    fn bundle_path_from_exe_rejects_a_path_too_shallow_to_have_three_parents() {
        // Only one real parent directory exists above `simplemark`, so the
        // walk runs out of path before it can find a candidate bundle root.
        let exe = Path::new("MacOS/simplemark");
        assert_eq!(super::bundle_path_from_exe(exe), None);
    }

    #[test]
    fn bundle_path_from_exe_rejects_a_third_parent_that_is_not_dot_app() {
        // Shape of a `cargo run` / `cargo test` binary: three real parent
        // directories exist, but none of them is a `.app` bundle.
        let exe = Path::new("/tmp/simplemark/target/debug/simplemark");
        assert_eq!(super::bundle_path_from_exe(exe), None);
    }

    #[test]
    fn bundle_path_from_exe_rejects_a_path_with_no_parents() {
        let exe = Path::new("simplemark");
        assert_eq!(super::bundle_path_from_exe(exe), None);
    }
}
