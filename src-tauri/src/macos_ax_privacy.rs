//! Hides the web view from external accessibility clients (BUG-14).
//!
//! An external system service on some machines subscribes to this app's
//! accessibility notifications and, on every content or selection change,
//! re-reads the document as a spelling-annotated attributed string
//! (`AXAttributedStringForTextMarkerRange` → WebCore's
//! `attributedStringSetSpelling`). On a large note that query costs seconds
//! cold and hundreds of milliseconds warm, all of it on the renderer's main
//! thread — felt as a multi-second freeze on the first keystroke and sluggish
//! typing and selection everywhere. The same stack's other failure mode was
//! the BUG-13 wedge.
//!
//! WebKit gives embedders no switch for this, so the refusal happens at the
//! only layer we own: the `WKWebView` and its subviews are marked as not
//! accessibility elements with an explicitly empty children override, so
//! external traversal never reaches the remote web area and no query ever
//! crosses into the WebContent process. This is the shape of Chromium's
//! answer to the same storm — renderer accessibility stays off until a real
//! assistive client needs it.
//!
//! When VoiceOver is running at launch the tree is left fully exposed —
//! screen-reader users keep the whole document. Known v1 limitation, on the
//! board with BUG-14: turning VoiceOver on mid-session needs an app restart
//! to re-expose the tree.

use std::ffi::c_void;

use objc2::msg_send;
use objc2::runtime::{AnyObject, Sel};
use objc2::sel;
/// True when VoiceOver is running right now.
///
/// Raw message sends: the generated binding for this property is not in the
/// crate's enabled feature slice, and one selector is not worth widening it.
pub fn voiceover_running() -> bool {
    unsafe {
        let workspace: *mut AnyObject = msg_send![objc2::class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return false;
        }
        msg_send![workspace, isVoiceOverEnabled]
    }
}

unsafe fn responds(object: *mut AnyObject, selector: Sel) -> bool {
    let responds: bool = unsafe { msg_send![object, respondsToSelector: selector] };
    responds
}

/// Overrides one object's accessibility to "nothing here, and no children".
///
/// Explicit accessibility overrides take precedence over computed values, and
/// the empty children override is what stops an ignored element from passing
/// its subtree up to the parent — without it, "not an element" alone would
/// leave the web area reachable straight through.
unsafe fn hide_one(view: *mut AnyObject) {
    if unsafe { !responds(view, sel!(setAccessibilityElement:)) } {
        return;
    }
    let empty: *mut AnyObject = unsafe { msg_send![objc2::class!(NSArray), array] };
    let _: () = unsafe { msg_send![view, setAccessibilityElement: false] };
    let _: () = unsafe { msg_send![view, setAccessibilityChildren: empty] };
}

/// Hides a view and everything under it.
///
/// The focused-element path resolves through the first responder — an inner
/// `WKContentView`, not the `WKWebView` itself — so the override must land on
/// every subview, not only the root. If WebKit replaces its content view
/// after a renderer crash the replacement is unguarded until relaunch; the
/// BUG-13 wedge banner stays as the backstop for that window.
unsafe fn hide_tree(view: *mut AnyObject, depth: usize) {
    if view.is_null() || depth > 8 {
        return;
    }
    unsafe { hide_one(view) };
    if unsafe { !responds(view, sel!(subviews)) } {
        return;
    }
    let subviews: *mut AnyObject = unsafe { msg_send![view, subviews] };
    if subviews.is_null() {
        return;
    }
    let count: usize = unsafe { msg_send![subviews, count] };
    for index in 0..count {
        let child: *mut AnyObject = unsafe { msg_send![subviews, objectAtIndex: index] };
        unsafe { hide_tree(child, depth + 1) };
    }
}

/// Installs the override on the app's web view. Main thread, after creation.
pub fn install(webview: *mut c_void) -> Result<(), String> {
    if webview.is_null() {
        return Err("webview pointer is null".to_string());
    }
    if voiceover_running() {
        // A person is actually reading this app. Serve them everything.
        eprintln!("simplemark: VoiceOver detected - web accessibility left fully exposed");
        return Ok(());
    }
    unsafe { hide_tree(webview.cast(), 0) };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::ffi::{class_getInstanceMethod, objc_getClass};

    /// The override API this module leans on must exist on NSView — if an OS
    /// release removed it, hiding would silently guard nothing.
    #[test]
    fn nsview_carries_the_accessibility_override_setters() {
        unsafe {
            let class = objc_getClass(c"NSView".as_ptr());
            assert!(!class.is_null());
            for selector in [
                sel!(setAccessibilityElement:),
                sel!(setAccessibilityChildren:),
                sel!(subviews),
            ] {
                assert!(
                    !class_getInstanceMethod(class.cast(), Some(selector).unwrap()).is_null(),
                    "NSView lost {selector:?}"
                );
            }
        }
    }

    #[test]
    fn refuses_a_null_webview() {
        assert!(install(std::ptr::null_mut()).is_err());
    }

    /// The VoiceOver probe must answer without crashing off the main thread.
    #[test]
    fn voiceover_probe_answers() {
        let _ = voiceover_running();
    }
}
