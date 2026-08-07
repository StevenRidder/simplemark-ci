// Spike v2: same question, two changes — a prompt with worked examples and a
// negative constraint the model can actually obey, and a distilled input
// (title + section outline + opening prose) instead of raw leading bytes.
//
// Both changes are chosen to be implementable in Rust later: the distillation
// is line-oriented Markdown scanning, nothing more.
//
// Usage: swift summarize2.swift <char-budget> <file.md> [file.md ...]

import Foundation
import FoundationModels

let INSTRUCTIONS = """
You write the grey subtitle line under a note title in a note list.

Given a distilled Markdown document, reply with ONE sentence of at most 14 \
words naming what the document specifically says, decides, or explains.

Rules:
- Never restate the title. The reader can already see the title. A subtitle \
that only repeats it is worthless.
- Never begin with "This document", "The note", "A guide to", or the app name.
- Start with a verb or a concrete noun.
- State the substance, not the genre.
- Plain text only. No markdown, no quotes, no trailing period commentary.

Examples:

Title: Merge Queue
Bad: This document describes a GitHub merge queue for SimpleMark.
Good: Every PR lands through GitHub's queue after a four-platform build.

Title: Third Party Icons
Bad: This document discusses using Tabler Icons in SimpleMark.
Good: Tabler Icons under MIT, inlined at build time, no runtime fetch.

Title: Local Document Session Before CRDT
Bad: Outlines a distributed collaboration system for Markdown editing.
Good: Ship a single-user session first; defer CRDTs until collaboration is real.
"""

/// Distils a Markdown document into the parts that actually carry meaning:
/// the title, the section outline, and the first real prose. Leading status
/// blocks, badge lists, and metadata bullets are skipped — in v1 those were
/// most of what the model saw, which is why it kept restating titles.
func distil(_ raw: String, budget: Int) -> String {
    var lines = raw.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")

    // Drop YAML frontmatter.
    if lines.first == "---", let end = lines.dropFirst().firstIndex(of: "---") {
        lines = Array(lines[(end + 1)...])
    }

    var title = ""
    var headings: [String] = []
    var prose: [String] = []
    var inFence = false

    for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
            inFence.toggle()
            continue
        }
        if inFence { continue }

        if trimmed.hasPrefix("# ") {
            if title.isEmpty { title = String(trimmed.dropFirst(2)) }
            continue
        }
        if trimmed.hasPrefix("## ") || trimmed.hasPrefix("### ") {
            headings.append(trimmed.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces))
            continue
        }
        // Prose only: skip metadata bullets, tables, quotes, images, rules.
        if trimmed.isEmpty { continue }
        if trimmed.hasPrefix("-") || trimmed.hasPrefix("*") || trimmed.hasPrefix("|")
            || trimmed.hasPrefix(">") || trimmed.hasPrefix("!") || trimmed.hasPrefix("<")
            || trimmed.allSatisfy({ $0 == "-" || $0 == "=" }) { continue }
        if prose.count < 6 { prose.append(trimmed) }
    }

    var out = "Title: \(title)\n"
    if !headings.isEmpty {
        out += "Sections: \(headings.prefix(14).joined(separator: "; "))\n"
    }
    out += "\nOpening:\n" + prose.joined(separator: "\n")
    if out.count > budget { out = String(out.prefix(budget)) }
    return out
}

let args = CommandLine.arguments
guard args.count > 2, let budget = Int(args[1]) else {
    FileHandle.standardError.write("usage: summarize2.swift <char-budget> <file.md> ...\n".data(using: .utf8)!)
    exit(2)
}
let paths = Array(args.dropFirst(2))

guard case .available = SystemLanguageModel.default.availability else {
    print("availability: UNAVAILABLE — \(SystemLanguageModel.default.availability)")
    exit(1)
}
print("availability: available   char budget: \(budget)   distilled input")
print(String(repeating: "=", count: 78))

var latencies: [Double] = []
var failures = 0

for path in paths {
    let name = (path as NSString).lastPathComponent
    guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
    let body = distil(raw, budget: budget)

    let session = LanguageModelSession(instructions: INSTRUCTIONS)
    let started = Date()
    do {
        let response = try await session.respond(
            to: body,
            options: GenerationOptions(temperature: 0.0)
        )
        let ms = Date().timeIntervalSince(started) * 1000
        latencies.append(ms)
        let summary = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        print("\(name)  [\(raw.count) → \(body.count) chars, \(Int(ms))ms, \(summary.split(separator: " ").count)w]")
        print("  → \(summary)\n")
    } catch {
        failures += 1
        print("\(name)\n  ✗ \(error)\n")
    }
}

print(String(repeating: "=", count: 78))
if !latencies.isEmpty {
    let sorted = latencies.sorted()
    print("ok: \(latencies.count)  failed: \(failures)")
    print("latency ms — min \(Int(sorted.first!))  median \(Int(sorted[sorted.count / 2]))  max \(Int(sorted.last!))")
}
