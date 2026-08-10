// The native iOS folder picker for SimpleMark workspaces.
//
// `tauri-plugin-dialog` intentionally does not implement mobile folder
// selection. This is the narrow UIKit transport it omits: select a folder in
// place and keep its security scope alive for the running app. iOS explicitly
// does not support persistent security-scoped bookmarks, so this bridge does
// not pretend that it can retain arbitrary iCloud Drive access after a relaunch.
// It does not read, write, or interpret a Markdown document.

import Darwin
import Foundation
import UIKit
import UniformTypeIdentifiers

private final class ResultBox: @unchecked Sendable {
    var value: String?
}

private final class WorkspaceFolderPicker: NSObject, UIDocumentPickerDelegate {
    private let finish: (URL?) -> Void

    init(finish: @escaping (URL?) -> Void) {
        self.finish = finish
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        NSLog("SimpleMark folder picker selected %@", urls.first?.path ?? "no folder")
        finish(urls.first)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        NSLog("SimpleMark folder picker cancelled")
        finish(nil)
    }
}

// UIKit retains a picker weakly through its delegate. This strong reference
// lasts precisely until the user picks or cancels, then is released.
private var activeFolderPicker: WorkspaceFolderPicker?

private func frontViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .sorted {
            // A scene may briefly become foreground-inactive while a control
            // is being tapped. It remains a valid presentation host, and
            // preferring active first avoids treating that normal transition
            // as a silent cancelled folder selection.
            ($0.activationState == .foregroundActive ? 0 : 1)
                < ($1.activationState == .foregroundActive ? 0 : 1)
        }
    let windows = scenes.flatMap(\.windows)
    guard let root = (
        windows.first(where: { $0.isKeyWindow && $0.rootViewController != nil })
        ?? windows.first(where: { !$0.isHidden && $0.alpha > 0 && $0.rootViewController != nil })
    )?.rootViewController else {
        return nil
    }

    var controller = root
    while let presented = controller.presentedViewController {
        controller = presented
    }
    return controller
}

/// Presents Apple's real folder picker and blocks only the Rust command's
/// worker until a result is available. UIKit presentation always stays on the
/// main queue.
@_cdecl("simplemark_pick_workspace_folder")
public func simplemark_pick_workspace_folder() -> UnsafeMutablePointer<CChar>? {
    let semaphore = DispatchSemaphore(value: 0)
    let result = ResultBox()

    DispatchQueue.main.async {
        NSLog("SimpleMark folder picker requested")
        guard let presenter = frontViewController() else {
            NSLog("SimpleMark folder picker has no presentation host")
            semaphore.signal()
            return
        }

        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.folder],
            asCopy: false)
        let delegate = WorkspaceFolderPicker { url in
            defer {
                activeFolderPicker = nil
                semaphore.signal()
            }
            guard let url else {
                return
            }
            guard url.startAccessingSecurityScopedResource() else {
                NSLog("SimpleMark folder picker could not access %@", url.path)
                return
            }
            result.value = url.path
            NSLog("SimpleMark folder picker granted %@", url.path)
        }
        activeFolderPicker = delegate
        picker.delegate = delegate
        picker.modalPresentationStyle = .fullScreen
        NSLog("SimpleMark folder picker presenting from %@", String(describing: type(of: presenter)))
        presenter.present(picker, animated: true)
    }

    guard semaphore.wait(timeout: .now() + 180) == .success else {
        NSLog("SimpleMark folder picker timed out")
        return nil
    }
    return result.value?.withCString { strdup($0) }
}

@_cdecl("simplemark_workspace_picker_free")
public func simplemark_workspace_picker_free(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}
