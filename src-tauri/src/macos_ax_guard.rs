//! Refuses `AXEnhancedUserInterface` (BUG-13).
//!
//! External accessibility clients set this attribute on an application to flip
//! it into "enhanced" mode, after which the app builds and serves its complete
//! accessibility tree at interactive rates. For a WKWebView holding a large
//! editable document that turns every attribute query into a whole-document
//! layout walk — the storm that pinned this app's renderer at 100% CPU and
//! starved every interaction. Chromium gated renderer accessibility behind
//! `AXManualAccessibility` for exactly this reason; WebKit offers no such gate
//! to embedders, so the refusal happens at the application object instead.
//!
//! VoiceOver and other assistive clients do not need this attribute to read
//! the app — the ordinary accessibility tree stays fully served. What is
//! refused is only the mode switch that historically exists for automation
//! clients, and every refusal is logged so the next investigation starts with
//! a name for who asked.

use std::ffi::c_void;
use std::sync::OnceLock;

use objc2::ffi::{
    class_getInstanceMethod, method_getImplementation, method_setImplementation, objc_getClass,
    sel_registerName,
};
use objc2_foundation::NSString;

const REFUSED_ATTRIBUTE: &str = "AXEnhancedUserInterface";

type SetValueForAttribute =
    unsafe extern "C-unwind" fn(*mut c_void, *const c_void, *mut c_void, *mut NSString);

static ORIGINAL: OnceLock<SetValueForAttribute> = OnceLock::new();

unsafe extern "C-unwind" fn guarded_set_value(
    this: *mut c_void,
    cmd: *const c_void,
    value: *mut c_void,
    attribute: *mut NSString,
) {
    if !attribute.is_null() {
        let name = unsafe { (*attribute).to_string() };
        if name == REFUSED_ATTRIBUTE {
            // Visible in Console under this process: the next time something
            // wedges, the log names the moment a client asked for the mode.
            eprintln!("simplemark: refused accessibility attribute set: {REFUSED_ATTRIBUTE}");
            return;
        }
    }
    if let Some(original) = ORIGINAL.get() {
        unsafe { original(this, cmd, value, attribute) }
    }
}

/// Installs the guard on `NSApplication`. Main thread, once, at setup.
pub fn install() -> Result<(), String> {
    unsafe {
        let class = objc_getClass(c"NSApplication".as_ptr());
        if class.is_null() {
            return Err("NSApplication class not found".to_string());
        }
        let selector = sel_registerName(c"accessibilitySetValue:forAttribute:".as_ptr())
            .ok_or_else(|| "selector registration failed".to_string())?;
        let method = class_getInstanceMethod(class.cast(), selector);
        if method.is_null() {
            return Err("accessibilitySetValue:forAttribute: not found".to_string());
        }
        let original = method_getImplementation(method);
        let Some(original) = original else {
            return Err("original implementation missing".to_string());
        };
        // Stored before the swap, so the guard can only ever forward to the
        // real implementation.
        let _ = ORIGINAL.set(std::mem::transmute::<
            unsafe extern "C-unwind" fn(),
            SetValueForAttribute,
        >(original));
        method_setImplementation(
            method,
            std::mem::transmute::<SetValueForAttribute, unsafe extern "C-unwind" fn()>(
                guarded_set_value,
            ),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The attribute name is the contract with macOS; a typo here would make
    /// the guard silently guard nothing.
    #[test]
    fn refuses_exactly_the_enhanced_ui_attribute() {
        assert_eq!(REFUSED_ATTRIBUTE, "AXEnhancedUserInterface");
    }

    /// The swizzle itself: NSApplication and the selector must exist, and the
    /// installation must capture an original before swapping.
    #[test]
    fn installs_against_the_real_nsapplication() {
        assert!(install().is_ok());
        assert!(ORIGINAL.get().is_some());
    }
}
