import Foundation

/// A small, portable Quick Look renderer. It is intentionally read-only and
/// closed to remote resources: a preview extension must never turn opening a
/// note into a network request or a second editor runtime.
enum MarkdownPreview {
  static func html(for markdown: String) -> String {
    var output = [String]()
    var paragraph = [String]()
    var listItems = [String]()
    var inCodeFence = false
    var codeLines = [String]()

    func flushParagraph() {
      guard !paragraph.isEmpty else { return }
      output.append("<p>\(inline(paragraph.joined(separator: " ")))</p>")
      paragraph.removeAll()
    }
    func flushList() {
      guard !listItems.isEmpty else { return }
      output.append("<ul>\(listItems.map { "<li>\(inline($0))</li>" }.joined())</ul>")
      listItems.removeAll()
    }
    func flushCode() {
      guard !codeLines.isEmpty else { return }
      output.append("<pre><code>\(escape(codeLines.joined(separator: "\n")))</code></pre>")
      codeLines.removeAll()
    }

    for line in markdown.components(separatedBy: .newlines) {
      if line.hasPrefix("```") {
        if inCodeFence { flushCode() }
        inCodeFence.toggle()
        continue
      }
      if inCodeFence {
        codeLines.append(line)
        continue
      }

      if line.trimmingCharacters(in: .whitespaces).isEmpty {
        flushParagraph()
        flushList()
        continue
      }
      if let heading = heading(line) {
        flushParagraph()
        flushList()
        output.append("<h\(heading.level)>\(inline(heading.text))</h\(heading.level)>")
      } else if line.hasPrefix("> ") {
        flushParagraph()
        flushList()
        output.append("<blockquote><p>\(inline(String(line.dropFirst(2))))</p></blockquote>")
      } else if line == "---" || line == "***" || line == "___" {
        flushParagraph()
        flushList()
        output.append("<hr>")
      } else if let item = listItem(line) {
        flushParagraph()
        listItems.append(item)
      } else if line.contains("|") && line.contains("---") {
        // A separator is represented by its surrounding rows as readable text
        // instead of attempting a half-correct table parser in an extension.
        continue
      } else {
        paragraph.append(line)
      }
    }
    if inCodeFence { flushCode() }
    flushParagraph()
    flushList()
    return document(output.joined(separator: "\n"))
  }

  private static func heading(_ line: String) -> (level: Int, text: String)? {
    let hashes = line.prefix { $0 == "#" }
    guard !hashes.isEmpty, hashes.count <= 6, line.dropFirst(hashes.count).first == " " else { return nil }
    return (hashes.count, String(line.dropFirst(hashes.count + 1)))
  }

  private static func listItem(_ line: String) -> String? {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") else { return nil }
    return String(trimmed.dropFirst(2))
  }

  private static func inline(_ source: String) -> String {
    // Image syntax deliberately remains a link; an extension must not fetch a
    // remote image while Quick Look merely inspects a document.
    var rendered = escape(source)
    rendered = rendered.replacingOccurrences(of: "**", with: "<strong>", options: [], range: nil)
    let strongParts = rendered.components(separatedBy: "<strong>")
    if strongParts.count > 1 {
      rendered = strongParts.enumerated().map { index, part in
        index == 0 ? part : "<strong>\(part)</strong>"
      }.joined()
    }
    rendered = linkify(rendered)
    return rendered
  }

  private static func linkify(_ escaped: String) -> String {
    let pattern = #"(?<bang>!?)[\[](?<label>[^\]]+)[\]\((?<url>[^\s)]+)\)"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return escaped }
    let range = NSRange(escaped.startIndex..., in: escaped)
    return regex.stringByReplacingMatches(in: escaped, range: range, withTemplate: "<a href=\"$3\">$2</a>")
  }

  private static func escape(_ source: String) -> String {
    source
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
  }

  private static func document(_ body: String) -> String {
    """
    <!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { color: #1d1d1f; background: #fff; font: 17px -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.55; margin: 0 auto; max-width: 46rem; padding: 2rem 1.25rem; }
      h1, h2, h3, h4, h5, h6 { line-height: 1.2; margin-top: 1.5em; }
      pre { background: #f5f5f7; border-radius: 8px; overflow-x: auto; padding: 1rem; }
      code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, monospace; }
      blockquote { border-left: 3px solid #a2a2a7; color: #59595d; margin: 1rem 0; padding-left: 1rem; }
      a { color: #0a66c2; } hr { border: 0; border-top: 1px solid #d2d2d7; }
    </style></head><body>\(body)</body></html>
    """
  }
}
