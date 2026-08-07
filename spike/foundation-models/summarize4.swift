// Spike v3: three changes aimed at the two failures v1 and v2 shared.
//
//  1. @Generable structured output. Fields generate in order, so earlier
//     fields steer later ones — a cheap scratchpad the model must fill in
//     before it commits to the subtitle.
//  2. Extractive grounding. `keySentence` asks the model to COPY the best
//     sentence from the source. Small models copy far more reliably than
//     they abstract, and it anchors the subtitle to real text.
//  3. An explicit `ordering` field targeting the negation-inversion bug:
//     documents whose thesis is "X before Y" came back backwards in both
//     earlier passes. Naming both sides forces the model to look at it.
//
// Also: every instruction is POSITIVE. v1 and v2 both ignored "never say
// 'This document'"; the model does not reliably obey prohibitions, so the
// title is supplied separately and the rule becomes "add what the title lacks".
//
// Usage: swift summarize3.swift <char-budget> <file.md> [file.md ...]

import Foundation
import FoundationModels

@Generable
struct NoteSubtitle {
    @Guide(description: "Copy, word for word, the one sentence from the document that best states its main point. Copy it exactly; do not rewrite it.")
    var keySentence: String

    @Guide(description: "If the document argues for doing one thing BEFORE, INSTEAD OF, or RATHER THAN another, name both sides in the form 'X before Y' or 'X instead of Y'. If it makes no such argument, write exactly: none")
    var ordering: String

    @Guide(description: "A note-list subtitle of at most 12 words. Begin with a verb or a concrete noun. It must state information the title does not already contain. If ordering is not 'none', the subtitle must preserve that direction.")
    var subtitle: String
}

let INSTRUCTIONS = """
You write the grey subtitle line under a note title in a note list, the way \
Mail shows a preview under a subject.

Work from the document you are given. Ground every field in its actual words. \
Prefer the specific over the general: name the mechanism, the decision, or the \
constraint the document commits to.
"""

/// Distils the document to title plus a sample from *each* section, rather
/// than the opening alone. v2 read only the first prose lines, which for an
/// ADR is the context section — the decision itself sits further down, and
/// that is where the theses the model inverted actually live.
func distil(_ raw: String, budget: Int) -> (title: String, body: String) {
    var lines = raw.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    if lines.first == "---", let end = lines.dropFirst().firstIndex(of: "---") {
        lines = Array(lines[(end + 1)...])
    }

    var title = ""
    var sections: [(String, [String])] = [("", [])]
    var inFence = false

    for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { inFence.toggle(); continue }
        if inFence { continue }

        if trimmed.hasPrefix("# ") {
            if title.isEmpty { title = String(trimmed.dropFirst(2)) }
            continue
        }
        if trimmed.hasPrefix("## ") || trimmed.hasPrefix("### ") {
            sections.append((trimmed.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces), []))
            continue
        }
        if trimmed.isEmpty { continue }
        if trimmed.hasPrefix("|") || trimmed.hasPrefix(">") || trimmed.hasPrefix("!")
            || trimmed.hasPrefix("<") || trimmed.allSatisfy({ $0 == "-" || $0 == "=" }) { continue }
        // Two prose lines per section is enough to carry the section's claim
        // without letting one long section crowd out the rest.
        if sections[sections.count - 1].1.count < 2 {
            let cleaned = trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ")
                ? String(trimmed.dropFirst(2)) : trimmed
            sections[sections.count - 1].1.append(cleaned)
        }
    }

    var body = ""
    for (heading, prose) in sections.prefix(10) where !prose.isEmpty {
        if !heading.isEmpty { body += "\n[\(heading)]\n" }
        body += prose.joined(separator: "\n") + "\n"
    }
    if body.count > budget { body = String(body.prefix(budget)) }
    return (title.isEmpty ? "(untitled)" : title, body)
}


/// Deterministic validity gate. Every v3 failure — a three-word fragment, a
/// question copied out of a heading, leaked markdown, a subtitle that only
/// echoes the title — is mechanically detectable. Rejecting here turns the
/// failure mode from "shows nonsense" into "silently falls back to the
/// distilled preview", which is the rule TECH-SPEC §4.4 already imposes on
/// the paste ladder: never guess silently wrong.
func gate(_ subtitle: String, title: String, ordering: String) -> String {
    let words = subtitle.split(separator: " ")
    if words.count < 5 { return "REJECT too short (\(words.count)w)" }
    if words.count > 14 { return "REJECT too long (\(words.count)w)" }
    if subtitle.hasSuffix("?") { return "REJECT is a question" }
    if subtitle.rangeOfCharacter(from: CharacterSet(charactersIn: "`*[]#|")) != nil {
        return "REJECT markdown leaked"
    }
    if subtitle.caseInsensitiveCompare(ordering.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame {
        return "REJECT echoes scratchpad field"
    }
    for opener in ["this document", "the note", "the document", "a guide", "outlines ", "describes "] {
        if subtitle.lowercased().hasPrefix(opener) { return "REJECT genre opener" }
    }
    // Adds nothing the title does not already say.
    let titleWords = Set(title.lowercased().split(separator: " ").map(String.init))
    let novel = words.map { String($0).lowercased().trimmingCharacters(in: .punctuationCharacters) }
        .filter { $0.count > 3 && !titleWords.contains($0) }
    if novel.count < 2 { return "REJECT restates title" }
    return "ACCEPT"
}

let args = CommandLine.arguments
guard args.count > 2, let budget = Int(args[1]) else {
    FileHandle.standardError.write("usage: summarize3.swift <char-budget> <file.md> ...\n".data(using: .utf8)!)
    exit(2)
}

guard case .available = SystemLanguageModel.default.availability else {
    print("availability: UNAVAILABLE — \(SystemLanguageModel.default.availability)")
    exit(1)
}
print("availability: available   budget: \(budget)   @Generable + extractive grounding")
print(String(repeating: "=", count: 78))

var latencies: [Double] = []
var failures = 0
var accepted = 0
var rejected = 0

for path in args.dropFirst(2) {
    let name = (path as NSString).lastPathComponent
    guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
    let (title, body) = distil(raw, budget: budget)

    let session = LanguageModelSession(instructions: INSTRUCTIONS)
    let prompt = "Title: \(title)\n\nDocument:\(body)"
    let started = Date()
    do {
        let response = try await session.respond(
            to: prompt,
            generating: NoteSubtitle.self,
            options: GenerationOptions(temperature: 0.0)
        )
        let ms = Date().timeIntervalSince(started) * 1000
        latencies.append(ms)
        let result = response.content
        let subtitle = result.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        print("\(name)  [\(raw.count) → \(body.count) chars, \(Int(ms))ms, \(subtitle.split(separator: " ").count)w]")
        let verdict = gate(subtitle, title: title, ordering: result.ordering)
        if verdict == "ACCEPT" { accepted += 1 } else { rejected += 1 }
        print("  \(verdict)")
        print("  → \(subtitle)\n")
    } catch {
        failures += 1
        print("\(name)\n  ✗ \(error)\n")
    }
}

print(String(repeating: "=", count: 78))
if !latencies.isEmpty {
    let sorted = latencies.sorted()
    print("ok: \(latencies.count)  failed: \(failures)")
    print("gate — accepted \(accepted)  rejected \(rejected)")
    print("latency ms — min \(Int(sorted.first!))  median \(Int(sorted[sorted.count / 2]))  max \(Int(sorted.last!))")
}
