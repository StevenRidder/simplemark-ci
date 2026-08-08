#include "bindings/bindings.h"

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

/*
 * Take away WebKit's own accessory bar above the keyboard.
 *
 * A web view puts a "previous / next / Done" strip over the keyboard for every
 * editable thing on the page. It is meant for tabbing between the fields of a
 * form, and SimpleMark has no form — it has a document. What it costs is real:
 * ~55pt of a small screen, and a second bar directly under SimpleMark's own
 * formatting palette, so the phone shows two stacked toolbars where Bear and
 * Notes show one.
 *
 * `inputAccessoryView` is read off the private class that backs the web view's
 * content, so it has to be replaced by name at runtime; returning nil is the
 * documented meaning of "this responder has no accessory". This is the same
 * suppression Capacitor and Cordova have shipped for years, and it is
 * deliberately narrow — one selector, one class, and a silent no-op if a
 * future WebKit renames the class, which costs us the strip back rather than
 * the app.
 */
__attribute__((constructor)) static void simplemark_suppress_input_accessory(void) {
	Class content = NSClassFromString(@"WKContentView");
	if (content == Nil) {
		return;
	}
	IMP none = imp_implementationWithBlock(^id(id _self) { return nil; });
	class_replaceMethod(content, @selector(inputAccessoryView), none, "@@:");
}

int main(int argc, char * argv[]) {
	ffi::start_app();
	return 0;
}
