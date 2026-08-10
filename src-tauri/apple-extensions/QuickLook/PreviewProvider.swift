import Foundation
import QuickLook
import UniformTypeIdentifiers

final class PreviewProvider: QLPreviewProvider {
  private let maximumDocumentBytes = 4 * 1_024 * 1_024

  func providePreview(
    for request: QLFilePreviewRequest,
    completionHandler handler: @escaping (QLPreviewReply?, (any Error)?) -> Void
  ) {
    let reply = QLPreviewReply(
      dataOfContentType: .html,
      contentSize: CGSize(width: 768, height: 1024)
    ) { [maximumDocumentBytes] _ throws -> Data in
      let data = try Data(contentsOf: request.fileURL, options: .mappedIfSafe)
      guard data.count <= maximumDocumentBytes else {
        throw NSError(
          domain: "app.simplemark.quicklook",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "This Markdown document is larger than 4 MB."]
        )
      }
      guard let markdown = String(data: data, encoding: .utf8) else {
        throw NSError(
          domain: "app.simplemark.quicklook",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "This Markdown document is not UTF-8 text."]
        )
      }
      return MarkdownPreview.html(for: markdown).data(using: .utf8) ?? Data()
    }
    handler(reply, nil)
  }
}
