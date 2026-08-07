// Spike: can Apple's on-device Foundation Models write a useful one-line
// subtitle for a Markdown note? Measures availability, latency, and output.
//
// Usage: swift summarize.swift <char-budget> <file.md> [file.md ...]

import Foundation
import FoundationModels

let INSTRUCTIONS = """
You write one-line subtitles for a note list, like the grey line under a \
subject in Mail. Given a Markdown document, reply with a single sentence, \
at most 12 words, saying what this specific document is about. Name the \
actual subject matter. Do not start with "This document" or "The note". \
Do not use markdown. Do not add quotes. Reply with the sentence only.
"""

/// Strips YAML frontmatter and collapses whitespace so the budget is spent on
/// prose rather than on formatting the model does not need.
func prepare(_ raw: String, budget: Int) -> String {
    var text = raw
    if text.hasPrefix("---\n"), let end = text.range(of: "\n---\n", range: text.index(text.startIndex, offsetBy: 3)..<text.endIndex) {
        text = String(text[end.upperBound...])
    }
    text = text.replacingOccurrences(of: "\r\n", with: "\n")
    if text.count > budget {
        text = String(text.prefix(budget))
    }
    return text
}

let args = CommandLine.arguments
guard args.count > 2, let budget = Int(args[1]) else {
    FileHandle.standardError.write("usage: summarize.swift <char-budget> <file.md> ...\n".data(using: .utf8)!)
    exit(2)
}
let paths = Array(args.dropFirst(2))

let model = SystemLanguageModel.default
switch model.availability {
case .available:
    print("availability: available")
case .unavailable(let reason):
    print("availability: UNAVAILABLE — \(reason)")
    exit(1)
@unknown default:
    print("availability: unknown case")
    exit(1)
}
print("char budget: \(budget)")
print(String(repeating: "=", count: 78))

var latencies: [Double] = []
var failures = 0

for path in paths {
    let name = (path as NSString).lastPathComponent
    guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else {
        print("\(name)\n  READ FAILED\n")
        continue
    }
    let body = prepare(raw, budget: budget)

    // A fresh session per note: a reused session accumulates every prior
    // document in its transcript and would exhaust the context window.
    let session = LanguageModelSession(instructions: INSTRUCTIONS)
    let started = Date()
    do {
        let response = try await session.respond(
            to: body,
            options: GenerationOptions(temperature: 0.3)
        )
        let ms = Date().timeIntervalSince(started) * 1000
        latencies.append(ms)
        let summary = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = summary.split(separator: " ").count
        print("\(name)  [\(raw.count) chars in, sent \(body.count), \(Int(ms))ms, \(words)w]")
        print("  → \(summary)\n")
    } catch {
        failures += 1
        let ms = Date().timeIntervalSince(started) * 1000
        print("\(name)  [\(raw.count) chars in, sent \(body.count), \(Int(ms))ms]")
        print("  ✗ \(error)\n")
    }
}

print(String(repeating: "=", count: 78))
if !latencies.isEmpty {
    let sorted = latencies.sorted()
    let total = latencies.reduce(0, +)
    print("ok: \(latencies.count)  failed: \(failures)")
    print("latency ms — min \(Int(sorted.first!))  median \(Int(sorted[sorted.count / 2]))  max \(Int(sorted.last!))  mean \(Int(total / Double(latencies.count)))")
} else {
    print("ok: 0  failed: \(failures)")
}
