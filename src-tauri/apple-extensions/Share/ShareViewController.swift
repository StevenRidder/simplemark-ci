import UIKit
import UniformTypeIdentifiers

private let appGroup = "group.app.simplemark.ios"
private let pendingDraftKey = "app.simplemark.pending-plain-text-draft"
private let maximumTextBytes = 1_048_576

private struct PendingShareDraft: Codable {
  let id: String
  let text: String
}

/// A deliberately narrow share sheet: plain text is an unsaved draft, while a
/// Markdown file continues through iOS's document/Open In path and stays at
/// its provider-owned URL.
final class ShareViewController: UIViewController {
  private let textView = UITextView()
  private let saveButton = UIButton(type: .system)
  private var sharedText = ""
  private var saved = false

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Save text to SimpleMark"
    view.backgroundColor = .systemBackground

    textView.font = .preferredFont(forTextStyle: .body)
    textView.isEditable = false
    textView.translatesAutoresizingMaskIntoConstraints = false
    saveButton.configuration = .filled()
    saveButton.configuration?.title = "Save as SimpleMark draft"
    saveButton.isEnabled = false
    saveButton.addTarget(self, action: #selector(saveDraft), for: .touchUpInside)
    saveButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(textView)
    view.addSubview(saveButton)
    NSLayoutConstraint.activate([
      textView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      textView.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      textView.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
      textView.bottomAnchor.constraint(equalTo: saveButton.topAnchor, constant: -16),
      saveButton.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      saveButton.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
      saveButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
    ])
    loadSharedText()
  }

  private func loadSharedText() {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
      showError("This share contained no text.")
      return
    }
    guard let provider = item.attachments?.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
    }) else {
      showError("SimpleMark accepts plain text from this Share action.")
      return
    }
    // Providers commonly offer a data-backed plain-text representation. Asking
    // for an arbitrary item only works when they choose to vend NSString, which
    // left the Share sheet empty for providers such as Grammarly.
    provider.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { [weak self] data, error in
      let text = data.flatMap { String(data: $0, encoding: .utf8) }
      DispatchQueue.main.async {
        guard let self else { return }
        guard error == nil, let text, !text.isEmpty else {
          self.showError("This share did not contain readable text.")
          return
        }
        guard text.lengthOfBytes(using: .utf8) <= maximumTextBytes else {
          self.showError("This share is larger than 1 MB. Save it as a Markdown file, then use Open In.")
          return
        }
        self.sharedText = text
        self.textView.text = text
        self.saveButton.isEnabled = true
      }
    }
  }

  @objc private func saveDraft() {
    if saved {
      extensionContext?.completeRequest(returningItems: nil)
      return
    }
    guard !sharedText.isEmpty else { return }
    let draft = PendingShareDraft(id: UUID().uuidString, text: sharedText)
    do {
      let encoded = try JSONEncoder().encode(draft)
      guard let json = String(data: encoded, encoding: .utf8),
            let defaults = UserDefaults(suiteName: appGroup) else {
        showError("SimpleMark could not store this share.")
        return
      }
      // A single defaults value is atomically replaced. The main app leaves it
      // in place until its standard Save flow has made a real Markdown file.
      defaults.set(json, forKey: pendingDraftKey)
      defaults.synchronize()
      saved = true
      sharedText = ""
      textView.text = "Saved for SimpleMark. Open SimpleMark to choose where to place it."
      saveButton.configuration?.title = "Done"
      saveButton.isEnabled = true
    } catch {
      showError("SimpleMark could not encode this share: \(error.localizedDescription)")
    }
  }

  private func showError(_ message: String) {
    textView.text = message
    saveButton.isEnabled = false
  }
}
