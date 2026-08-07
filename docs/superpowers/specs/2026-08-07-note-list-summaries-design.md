# Note-list summaries — design

**A one-line subtitle under every note title: written by Apple's on-device model where it can,
extracted deterministically where it cannot.**

- **Status:** Accepted design, not yet planned
- **Date:** 2026-08-07
- **Companion to:** [`APPLE-NATIVE-AI.md`](../../APPLE-NATIVE-AI.md) (capability scoping),
  [`ADR-0001`](../../decisions/0001-single-product-modular-architecture.md) (module boundaries)
- **Supersedes nothing.** `APPLE-NATIVE-AI.md` §5 ranked four candidate features and did not
  include this one; §7 of this document explains why it is being built first anyway.

---

## 1. The problem

Every row in the note list shows the same hardcoded string. Not a preview, not a snippet — the
literal constant `'Local Markdown file'`, painted into a `<span>` for every note in the collection
([`tauri.ts:984`](../../../src/app/tauri.ts:984), and `'Current local Markdown file'` at
[`:916`](../../../src/app/tauri.ts:916)). There is a Small/Medium/Large preview-density preference
sized around a line that has never carried information.

So this is not a new UI element. It is a placeholder that has been there all along, and the work is
deciding what should fill it.

---

## 2. Two layers, one slot

**Layer 1 — deterministic extractor.** Every note, every platform, no model. Reads the file, skips
frontmatter and metadata lines, and takes the author's own lead sentence: a bold opener, a labelled
`**Headline:**` / `**One-liner:**` / `**TL;DR:**`, or failing those the first real prose sentence.

**Layer 2 — Foundation Models.** On macOS 26+ Apple silicon with Apple Intelligence enabled, an
on-device **two-sentence** summary replaces the extracted line once it arrives. The first sentence
says what the document is; the second carries the specific detail, decision, or caveat.

Two sentences was chosen after measuring both against real notes. It won on three of five: a call
transcript went from `Proposal for naming the project Maxwell` to naming what the agent actually
does. The row wraps to show it in full rather than clipping, because the second sentence is the
half worth reading and an ellipsis would hide exactly it.

Apple's line wins whenever the model answers. The two are complementary rather than redundant —
the model is stronger on transcripts and thread exports, where no author lead sentence exists, and
the extractor is stronger where one does.

Layer 1 is the floor, not a degraded mode. It is what the browser shell shows, what every Intel Mac
shows, what every Mac on macOS 25 or earlier shows, and what anyone with Apple Intelligence off
shows. §6 of `APPLE-NATIVE-AI.md` calls this population large and requires that for all of them
SimpleMark is exactly the product it is today. A row never goes blank waiting for a model.

---

## 3. Architecture

Dependency direction from [ADR-0001](../../decisions/0001-single-product-modular-architecture.md) is
unchanged: `app → adapters → application → domain`. `domain` never learns this exists and
`npm run check:boundaries` passes without modification.

### 3.1 One new port

In [`ports.ts`](../../../src/application/ports.ts), alongside `FilePort`:

```ts
export interface NoteSummary {
  readonly handle: string
  readonly contentHash: string   // hex SHA-256 of the file's bytes
  readonly summary: string
}

export interface NoteSummaryPort {
  available(): Promise<boolean>
  request(handles: readonly string[]): Promise<void>   // idempotent; supersedes
  onSummary(listener: (summary: NoteSummary) => void): () => void
}
```

That file's header rule is *bytes, not strings*. A summary is exempt, and deliberately so rather
than by oversight: it is display text that never round-trips to disk, so it cannot destroy the byte
evidence the D7 fidelity contract protects. No port that touches document content changes here.

### 3.2 Two adapters

Under `src/adapters/intelligence/`:

- `tauri-note-summary-port.ts` — invokes the Tauri commands, listens for the completion event.
- `unavailable-note-summary-port.ts` — `available()` is `false`, `request()` is a no-op,
  `onSummary()` returns a no-op unsubscribe.

The unavailable adapter is load-bearing, not a stub. [`tauri.ts`](../../../src/app/tauri.ts)
composes the real one; [`browser.ts`](../../../src/app/browser.ts) composes the unavailable one.

### 3.3 Three Rust files, split by what Linux CI can build

| File | Platform | Contents |
|---|---|---|
| `note_preview.rs` | all | Deterministic extractor and SHA-256. Pure functions, no Tauri, fully unit-tested on Linux. |
| `note_summaries.rs` | all | Cache, queue, Tauri commands. Reaches the model through a trait, so tests stub it. |
| `foundation_models.rs` | `cfg(macos + aarch64)` | `extern "C"` declarations. Nothing else. |

### 3.4 One Swift file

`src-tauri/swift/SimpleMarkIntelligence.swift`, exposing two `@_cdecl` functions — availability and
summarize — compiled to a static library by `build.rs` and linked into the Rust binary. This is
option 1 from [`APPLE-NATIVE-AI.md`](../../APPLE-NATIVE-AI.md) §4: no IPC, no sidecar process
lifecycle, one binary.

**Gated on `macos + aarch64`, not `macos` alone.** Apple Intelligence requires Apple silicon, so
excluding Intel is honest rather than a workaround — and it leaves the `macos-15-intel` CI leg
building exactly as it does today. Only the `macos-arm64` leg needs a new runner image.

---

## 4. Behaviour

### 4.1 Timing, measured

From the spike (§7), on an M-series Mac running macOS 26.3:

| Step | Cost |
|---|---|
| SHA-256 and distillation | pure string scan, negligible |
| Cache hit | no model call |
| Cold summary | 894–2121 ms, median ~1.5 s |
| Note list first paint | unaffected — extractor only |

A 20-note folder fills completely in about 26 seconds of idle background work; a 100-note folder in
roughly two minutes. Visible rows fill within 15–20 seconds and the open note within about a
second. Revisiting a folder is instant, because the cache survives restarts.

### 4.2 What each trigger does

| Trigger | Immediate | Background |
|---|---|---|
| Open folder | Catalog and extractor previews on every row | Active note summarised first, then visible rows |
| Open single `.md` | Row renders | That note is front of queue |
| Create note | Row renders, empty | Nothing queued — an empty note has nothing to summarise |
| Scroll | Nothing computed on scroll | Newly visible handles requested, debounced |
| Revisit | Instant from cache | Nothing |

Priority is: the active note, then the rows currently on screen. The webview reports visible
handles via an `IntersectionObserver` on `.note-item`, debounced through the existing
[`SupersedingOperationQueue`](../../../src/app/superseding-operation-queue.ts), whose
`enqueueLatest` is already the right primitive — a newer viewport supersedes an older one rather
than queueing behind it. Rust holds the wanted set and drains it one request at a time.

### 4.3 Re-summarising after a change

**On quiescence only: 30 seconds after writes to a file stop.** The interval is one named constant,
chosen to sit well clear of an agent's write cadence rather than measured from anything.

Saves and agent writes change the content hash and are therefore cache misses. Taken literally that
means a model call per save, and SimpleMark's premise is an agent rewriting the file continuously
while you read — [`watch_note`](../../../src-tauri/src/lib.rs:610) fires on every one. Quiescence
collapses a burst into one re-summary, costing one call per editing session rather than one per
write. The previous summary stays visible in the meantime, which is correct: it described the note
a moment ago.

### 4.4a Distillation is not optional

The model is never given the note. It is given a distillation: title, section outline, and the
first two prose lines of each section, capped at 3,000 characters.

This is the largest measured win in the feature and it needs no model — it took a 33,736-character
document to 867 and halved latency, and it makes the 4,096-token context window a non-issue rather
than a constraint to design around.

It is also load-bearing for quality, which was learned the hard way: an early build sent raw leading
characters instead, and a call transcript came back as *"The document discusses naming a project"* —
because the first three thousand characters of a transcript are the header and the opening
pleasantries. Sampling every section fixed it in one change.

### 4.4 The hygiene gate

Model output is checked for **hygiene only** — leaked Markdown characters stripped, empty rejected,
absurd length capped. It makes no quality judgement.

This is a deliberate narrowing. An earlier draft of the gate rejected short summaries, questions,
and lines that merely restated the title; on review those rejections were overruled, because
several of the outputs they killed were judged good. A gate that second-guesses accepted output is
just a source of false negatives.

### 4.5 Failure

| Condition | Behaviour |
|---|---|
| Apple Intelligence off, downloading, device ineligible, macOS 25 or earlier, Intel Mac, browser shell | `available()` is `false`, the webview never asks, extractor previews only |
| Model declines or errors one note | Row keeps its extractor preview. Not cached, so a later session retries; marked attempted in memory so it does not loop this session |
| Distilled input too large | Skipped. Largest distilled input in the spike was 2,253 chars against a 4,096-token window, so this should be unreachable — handled rather than trusted |
| Swift throws | Caught inside Swift, returned as a null pointer. Nothing traps across the FFI boundary |

Every one of these is *absence*, never a disabled affordance: no greyed control, no explanation, no
setting. The feature vanishes, exactly as `APPLE-NATIVE-AI.md` §6 requires.

### 4.6 The three invariants

- **Never reorders.** Summaries arrive keyed by handle and swap one `<span>`'s `textContent`
  ([`window-chrome.ts:2243`](../../../src/app/ui/window-chrome.ts:2243)). Sort order is computed
  from the catalog, which this path never writes.
- **Never delays opening.** Nothing in the open path awaits a summary; the port is fire-and-forget
  with an event back.
- **Never marks a document modified.** The summary path only reads. It does not go through
  `DocumentSession`, does not touch `originalSource`, and stays out of the
  [`WriteLedger`](../../../src-tauri/src/lib.rs:117) entirely, so it cannot be mistaken for one of
  our own saves and cannot perturb the watcher.

---

## 5. Storage

`~/Library/Application Support/app.simplemark.desktop/note-summaries.json`, written atomically
(temp file, then rename within the same directory — the discipline `FilePort.save` already uses)
and debounced.

```json
{ "version": 1,
  "entries": { "<hex sha256>": { "summary": "…", "lastSeenMs": 1754500000000 } } }
```

**Keyed by hex SHA-256 of the file's bytes and nothing else — never the path.** Rename a note and
its summary still applies, because identity is content. Two notes with identical bytes share one
entry.

`lastSeenMs` is touched on every hit because the cache needs eviction, which is a direct consequence
of §4.3: each editing session mints a new content hash and the previous hash is never referenced
again. Cap at 5,000 entries, evict least-recently-seen.

### 5.1 A new hash, not a replacement

[`content_hash`](../../../src-tauri/src/lib.rs:164) is `DefaultHasher` over the file's bytes, and it
serves the write ledger's "was this our own save?" check. It is correct for that and is **left
alone**. `DefaultHasher` is unsuitable as a cache key — it carries no cross-process stability
guarantee — so SHA-256 is added alongside it. Re-keying the save watcher would buy nothing and put
the paste and save paths at risk.

---

## 6. Testing

Everything except the model call is testable with no model, because `note_summaries.rs` reaches the
summarizer through a trait that tests stub.

**Rust, on Linux CI:**

- `note_preview.rs` — SHA-256 stability across processes (the property `DefaultHasher` lacks);
  extractor against fixtures covering each real shape found in §7: bold lead sentence, labelled
  `**Headline:**`, metadata-first document, and call transcript.
- Cache — round-trip, atomic write, eviction at cap, `lastSeenMs` touched on hit.
- Queue — supersede on newer viewport, one request at a time, active note first, attempted-set
  suppresses retry within a session.

**Playwright:** the note list renders extractor previews; a stubbed summary event swaps one
subtitle and the row order is asserted unchanged.

**macOS arm64 CI leg:** compiles and links the Swift module and asserts `availability()` returns
cleanly.

### 6.1 What CI cannot prove, stated plainly

**GitHub's macOS runners do not have Apple Intelligence enabled.** The arm64 leg can prove the
Swift module compiles, links, and reports availability without trapping. It can never prove a
summary is produced.

This is the same shape as the Graphviz CSP defect, where dev, vitest and Playwright all missed a
rule that only applies in packaged builds. Naming it here is the mitigation, alongside two others:
the path CI *does* exercise — unavailable, extractor previews — is the path most users take; and
summarization itself is proven by the spike binary run on a real machine, with output recorded as
evidence.

---

## 7. Evidence: the spike

Four passes were run against 22 documents — 17 repository docs and 5 real-world notes (a news
report, a CEO briefing, an architecture thread, a public README, and a call transcript). The four
scripts are in [`spike/foundation-models/`](../../../spike/foundation-models/), one per pass; each
is self-contained and takes a character budget and a list of files.

**Established:**

- A plain Swift binary reaches `FoundationModels`, compiles under Xcode 26.5, reports `.available`,
  and answered every document with no errors, no refusals, no network, and no entitlement.
- **Distillation is the largest engineering win and it needs no model.** Reducing a document to
  title, section outline and opening prose took `MCP-SERVER.md` from 33,736 characters to 867 and
  halved median latency. It also makes the 4,096-token window a non-issue rather than a constraint
  to design around.
- Output quality is highly sensitive to prompt design. A naive prompt inverted the thesis of any
  document arguing "X before Y" — ADR-0002 (*local session before any CRDT*) came back as "a
  distributed collaboration system". Structured `@Generable` output with an explicit ordering field
  and extractive grounding fixed every such inversion and eliminated the "This document outlines…"
  tic entirely.
- The model performs best on documents whose author already wrote a one-liner, which is also where
  the deterministic extractor performs best. Both layers are therefore worth having, and §2's
  ordering — extractor as floor, model as upgrade — reflects the measurement rather than caution.

**Known limit:** the on-device model does not synthesise across a whole document. It did not notice
that a news report's actual story was two sources disagreeing on a product name, nor that a CEO
briefing's headline was undercut by its own TODO list. Summaries are accurate but local. This is
accepted; §4.4 does not attempt to filter for it.

---

## 8. Sequencing

Two pull requests, in order. Both go through the merge queue like any `src/` or `src-tauri/`
change.

1. **The spine, all platforms.** SHA-256, extractor, cache, queue, port, both adapters, UI wiring.
   Replaces `'Local Markdown file'` with a real preview on every row on every platform. Fully
   tested on Linux CI. Ships value on its own with no Swift and no runner change.
2. **The bridge, macOS arm64.** Swift module, `build.rs` linking, `foundation_models.rs`, and the
   `macos-arm64` runner move to a macOS 26 image.

Splitting this way keeps a four-platform gate change and a new Apple API out of the same pull
request, and means a problem with either one cannot strand the other.

### 8.1 Open item for the plan

The `macos-arm64` leg currently runs on `macos-15`
([`native-testbuild.yml:40`](../../../.github/workflows/native-testbuild.yml:40)), which carries the
macOS 15 SDK and cannot compile `FoundationModels`. **Confirming which GitHub-hosted image provides
the macOS 26 SDK is the first step of PR 2 and blocks it** — the design assumes such an image
exists and does not depend on which one it is. `macos-15-intel` is unaffected by §3.4's
architecture gate.

---

## 9. Why this before `APPLE-NATIVE-AI.md` §5.1

That document recommended "tell me what changed" as the first Foundation Models feature, and its
reasoning still holds: a bounded transaction is a far better input than a whole document whose
thesis must be inferred, and §7 above independently confirms the weakness it predicted.

This feature is nonetheless first for a reason that does not depend on the model at all: layer 1
fixes a placeholder that ships in the product today, on every platform, with no Swift. The bridge
that PR 2 builds is the same bridge §5.1 needs, so that feature inherits it complete.
