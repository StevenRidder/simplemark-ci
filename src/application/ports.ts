/**
 * Ports the application owns and adapters implement (ADR-0001).
 *
 * These are declarations only. `application` may import `domain` and nothing
 * else, so a port never names a browser API, a Tauri command, `node:fs`, or an
 * editor type — the concrete capability lives in `adapters/*` and is supplied
 * at the composition root.
 *
 * Bytes, not strings. The D7 fidelity contract is defined in bytes, and a port
 * that handed back a decoded string would have already destroyed the evidence
 * (a lone CR, an invalid sequence, a missing final newline).
 */

import type { Thread } from '../domain/index.js'

/** A document opened through a file port, with the bytes exactly as stored. */
export interface OpenedDocument {
  /** Opaque handle the adapter uses to write back to the same location. */
  readonly handle: string
  /** Display name for the window title. Never used for identity. */
  readonly name: string
  /** The file's exact bytes. */
  readonly bytes: Uint8Array
}

/**
 * Reading and atomically writing one local Markdown file.
 *
 * Implementations: an in-memory fixture port (EDITOR-1, used before the
 * fidelity verdict), the File System Access API (APP-1), and Tauri's native
 * filesystem (APP-2). The contract is identical for all three; a feature that
 * works in only one of them is not accepted.
 */
export interface FilePort {
  /** Prompts for and opens one Markdown file. */
  open(): Promise<OpenedDocument>

  /**
   * Writes bytes to `handle` atomically: temp file in the same directory,
   * fsync, then rename. A partially written note is never observable.
   */
  save(handle: string, bytes: Uint8Array): Promise<void>
}

/** One portable Markdown file discovered beside the active document. */
export interface WorkspaceCatalogEntry {
  /** Opaque, stable identity. Native uses the canonical absolute path. */
  readonly handle: string
  readonly name: string
  readonly modifiedMs: number
  readonly createdMs: number
  /** The note's own lead sentence, when it has one. */
  readonly preview?: string
  /**
   * Accepted agent transactions on this note this session (APP-32).
   *
   * Absent, never zero: a note no agent has written to carries no marker, so
   * the list looks exactly as it did before an agent was in the room.
   */
  readonly agentChanges?: number
  /**
   * Notes on this document (APP-44): open, and resolved. Absent when both are
   * zero, by the same rule as `agentChanges` — a document nobody annotated
   * looks exactly as it always did.
   */
  readonly openNotes?: number
  readonly resolvedNotes?: number
}

/** A non-recursive local folder whose Markdown files form the visible catalog. */
export interface WorkspaceCatalog {
  readonly handle: string
  readonly name: string
  readonly notes: readonly WorkspaceCatalogEntry[]
}

/**
 * Discovers and creates notes around the active document.
 *
 * It intentionally owns no filtering, selection, pinning, or Markdown parsing.
 * Those are application/shell concerns; native and future browser adapters only
 * translate their platform's folder capability into this contract.
 */
export interface WorkspaceCatalogPort {
  /** Describes only the explicitly opened note and its containing directory. */
  inspect(documentHandle: string): Promise<WorkspaceCatalog>
  /** Lets the person explicitly adopt one folder as a visible collection. */
  chooseFolder(): Promise<WorkspaceCatalog | null>
  /** Full-folder discovery, reserved for an explicit Open Folder action. */
  listAround(documentHandle: string): Promise<WorkspaceCatalog>
  /** Refreshes one folder the person already adopted. */
  listFolder(workspaceHandle: string): Promise<WorkspaceCatalog>
  create(workspaceHandle: string): Promise<OpenedDocument>
}

/** The only two asset forms that this product may write into Markdown. */
export type AssetKind = 'image' | 'file'

/**
 * A portable reference chosen by a platform adapter.
 *
 * `src` is deliberately the string written into Markdown, never a browser
 * object URL, an absolute operating-system path, or an adapter-private id.
 */
export interface AssetReference {
  readonly kind: AssetKind
  readonly src: string
  readonly label: string
  /** A named limitation the shell should show rather than hiding it. */
  readonly notice?: string
}

/**
 * Chooses a portable asset reference for the current document.
 *
 * Browser and native shells implement this differently: the browser can only
 * create a reference to a file the person places beside the note, while the
 * native shell may later offer an explicit copy into `assets/`. The editor and
 * document session receive only ordinary Markdown either way.
 */
export interface AssetReferencePort {
  chooseReference(): Promise<AssetReference | null>
}

/**
 * Opens a link from the active document without changing the Markdown source.
 * Relative targets are resolved by the platform adapter from `documentHandle`
 * at click time, so a synced or cloned folder keeps working on another device.
 */
export interface DocumentLinkPort {
  open(documentHandle: string, href: string): Promise<void>
}

/** The outcome of rendering diagram source. Failure is a value, never a throw. */
export type RenderedDiagram =
  | { readonly ok: true; readonly markup: string }
  | { readonly ok: false; readonly message: string }

/**
 * Turns block source into safe, embeddable markup — SVG for diagram
 * languages, sanitised HTML for the paste-exhaust renderers (ANSI, diff,
 * JSON, file trees). One contract either way: validate, then return inert
 * markup or a message; never throw.
 *
 * A port rather than a direct import so the editor adapter never depends on
 * Mermaid: adapters do not import one another (ADR-0001 §Enforcement 3), and
 * the composition root injects the concrete renderer. It also keeps the editor
 * testable without loading a rendering engine.
 *
 * Implementations must sanitise before returning — pasted diagram source is
 * untrusted input (DESIGN.md §7) — and must resolve with `ok: false` rather
 * than throwing, so a broken diagram renders an inline error card instead of
 * taking down the surrounding document.
 */
export interface DiagramRenderer {
  /** Diagram languages this renderer claims, e.g. `mermaid`. */
  readonly languages: readonly string[]
  render(language: string, source: string): Promise<RenderedDiagram>
}

/**
 * Reads a data file a chart names, resolved against the open note (EDITOR-17).
 *
 * A port rather than a constructor detail of the chart renderer because the two
 * halves live in different adapters — the renderer compiles the chart, the
 * native side resolves and reads the file — and adapters do not import one
 * another (ADR-0001 §Enforcement 3). The composition root injects it.
 *
 * Absent in hosts that cannot read files. A chart naming one then says so
 * rather than rendering empty axes.
 */
export interface ChartDataReader {
  /** Resolve `href` against the open note and return its contents as text. */
  read(href: string): Promise<string>
}

/** An image stored beside the open note, as the reference written into Markdown. */
export interface StoredImage {
  /** Always a note-relative path such as `assets/3f9a1c2b7d4e5f60.png`. */
  readonly src: string
}

/** Bytes of a note-relative image, for display only — never written to Markdown. */
export interface LoadedImage {
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/**
 * Stores remote images beside the open note and reads them back for display
 * (ADR-0008).
 *
 * The packaged app's content policy blocks both a remote `<img>` and a webview
 * `fetch`, so a pasted article's pictures can only work if the shell downloads
 * them and the note references them relatively. A port rather than a direct
 * call because the halves live in different adapters — the editor decides which
 * sources to capture, the native side fetches and writes — and adapters do not
 * import one another (ADR-0001 §Enforcement 3).
 *
 * The document handle travels per call, as it does for `DocumentLinkPort`: the
 * open note changes under a long-lived port, and a handle captured at
 * construction would resolve against whichever note was open at startup.
 *
 * Absent in hosts that cannot write next to the document. A paste there keeps
 * the remote URL it arrived with, unchanged and visible.
 */
export interface ImageStorePort {
  /** Download `url` into the note's `assets/` folder. `null` declines — keep the remote URL. */
  store(documentHandle: string, url: string): Promise<StoredImage | null>
  /** Read a note-relative image for rendering. `null` when it is not available. */
  read(documentHandle: string, href: string): Promise<LoadedImage | null>
}

/** The same capability with the open note already bound, as the editor sees it. */
export interface NoteImageStore {
  store(url: string): Promise<StoredImage | null>
  read(href: string): Promise<LoadedImage | null>
}

/** What a copy places on the clipboard, keyed by MIME type. */
export interface ClipboardPayload {
  readonly 'text/plain': string
  readonly 'text/html'?: string
}

/**
 * Writing and reading the platform clipboard (EDITOR-10).
 *
 * A port rather than a direct `navigator.clipboard` call because the hosts
 * genuinely differ — the browser needs a user gesture and may refuse, and the
 * native shell talks to NSPasteboard. What must not differ is the
 * selection-to-format contract, which is why the conversions live in `domain`
 * and this interface only carries finished strings.
 *
 * `write` resolves `false` rather than throwing when the host refuses, so a
 * blocked clipboard becomes a visible message instead of a silent no-op.
 */
export interface ClipboardPort {
  write(payload: ClipboardPayload): Promise<boolean>
  /** The clipboard's text, or null when the host will not surrender it. */
  readText(): Promise<string | null>
}

/** One note's summary, keyed to the exact content it describes. */
export interface NoteSummary {
  readonly handle: string
  /** Hex SHA-256 of the bytes this summary was written from. */
  readonly contentHash: string
  readonly summary: string
}

/**
 * Optional one-line summaries for note-list rows.
 *
 * The "bytes, not strings" rule above does not reach this port: a summary is
 * display text that never round-trips to disk, so it cannot destroy the byte
 * evidence the D7 contract protects.
 *
 * Implementations: Foundation Models on macOS 26+ Apple silicon, and an
 * unavailable one everywhere else. A caller must work correctly when
 * `available()` is false — the note list then shows extracted previews only.
 */
export interface NoteSummaryPort {
  available(): Promise<boolean>
  /** Requests summaries, highest priority first. Idempotent; supersedes. */
  request(handles: readonly string[]): Promise<void>
  /** Returns an unsubscribe function. */
  onSummary(listener: (summary: NoteSummary) => void): () => void
}

/** The outcome of asking a model to fix broken diagram source. Failure is a value, never a throw. */
export type DiagramFixResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly message: string }

/**
 * Asks a configured LLM to correct diagram source that failed to render.
 *
 * A port, for the same reason `DiagramRenderer` is one: the editor adapter
 * must not depend on a concrete HTTP client, and the packaged app's CSP means
 * the concrete implementation differs by platform (a Rust command vs. a
 * direct `fetch`) even though the request/response shape does not.
 */
export interface DiagramFixPort {
  /** Whether a fix attempt can be made right now — false until Settings has a key, base URL, and model. */
  isConfigured(): boolean
  /** Never throws; a transport or parsing failure resolves `{ ok: false, message }`. */
  fix(language: string, source: string, errorMessage: string): Promise<DiagramFixResult>
  /**
   * Repairs a span of Markdown whose structure is wrong, given a complaint that
   * carries its own before-and-after evidence.
   *
   * Separate from `fix` because there is no renderer error to pass and the
   * answer is Markdown, not diagram source — so the reply keeps its fences
   * instead of being unwrapped. Never throws.
   */
  fixMarkdown(complaint: string): Promise<DiagramFixResult>
}

/**
 * Credentials and endpoint for the diagram-error "Fix it" button (EDITOR
 * error-recovery).
 *
 * Lives here rather than in `app/ai-settings.ts` because `DiagramFixPort`
 * implementations (adapters) need the shape too, and adapters may not import
 * `app` (ADR-0001). `app/ai-settings.ts` still owns storage — loading,
 * saving, defaulting, and normalising untrusted input — and re-exports this
 * type so its existing consumers are unaffected.
 */
export interface AiSettings {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

/** Whether a fix attempt can be made at all — false until all three fields are filled in. */
export function isAiConfigured(settings: AiSettings): boolean {
  return settings.apiKey !== '' && settings.baseUrl !== '' && settings.model !== ''
}

/**
 * The offset of every top-level block in a Markdown document.
 *
 * `domain`'s `buildSourceMap` is a pure tiling function and takes these from
 * its caller — it does not parse Markdown. Parsing needs a real Markdown
 * parser, which `application` may not import (ADR-0001), so the capability
 * arrives as a port and the composition root supplies it.
 *
 * The contract is *self-consistency*, not agreement with the editor: the same
 * implementation reads both the baseline and the edited document, so a coarser
 * answer (a GFM table seen as one block rather than several) is safe. What is
 * not safe is two different answers for the same bytes.
 *
 * Offsets must be ascending, and must be genuine block starts — the first byte
 * of a top-level node, not of its leading whitespace.
 */
export interface BlockBoundaryPort {
  starts(markdown: string): readonly number[]

  /**
   * Whether two blocks say the same thing, whatever their bytes.
   *
   * Byte comparison cannot answer this, and that is not a detail — the editor
   * re-serializes the *whole* document on every edit, so every block's bytes
   * differ from the author's even where nothing was touched. Comparing bytes
   * would mark all of them dirty and preserve nothing.
   *
   * Equivalent blocks keep the author's original bytes; only blocks whose
   * meaning changed are re-serialized. `- a` and `* a` are the same list, so
   * the author's `-` survives.
   */
  equivalent(a: string, b: string): boolean
}

/** A JSON object emitted by an editor step without exposing its editor type. */
export type StepJson = Readonly<Record<string, unknown>>

/** One ordered batch of opaque editor operations. */
export type StepBatch = readonly StepJson[]

/** A document coordinate supplied by an editor adapter, never interpreted here. */
export interface StepDocumentRange {
  readonly from: number
  readonly to: number
}

/** Failures that must remain visible rather than becoming an assumed edit. */
export type StepDocumentError = 'invalid_step' | 'invalid_schema' | 'rebase_failed'

/** A successfully applied batch, serialized by the adapter that owns the schema. */
export type StepApplicationResult =
  | { readonly ok: true; readonly markdown: string; readonly steps: StepBatch }
  | { readonly ok: false; readonly kind: StepDocumentError }

/** The structural replacement emitted for agent-supplied Markdown. */
export type MarkdownStepResult =
  | { readonly ok: true; readonly steps: StepBatch }
  | { readonly ok: false; readonly kind: StepDocumentError }

/**
 * The application boundary for structural document changes (AUTHORITY-3).
 *
 * Editor steps cross as the JSON their owning editor emits. The application
 * can store, sequence, and send them to this port, but can never interpret a
 * step: decoding, schema validation, rebasing, inversion, and Markdown
 * parsing are all editor-adapter responsibilities.
 */
export interface StepDocumentPort {
  applySteps(markdown: string, steps: StepBatch): StepApplicationResult
  rebaseSteps(
    baseMarkdown: string,
    localSteps: StepBatch,
    committedBatches: readonly StepBatch[],
  ): StepApplicationResult
  invertSteps(markdown: string, steps: StepBatch): StepBatch | null
  /**
   * Applies one change's stored inverse to the current document, positioned
   * through the batches committed after it (BUG-9).
   *
   * Deliberately not `rebaseSteps`: rebasing replays the later batches onto a
   * historical document, and a live editor batch is stored as the editor's own
   * step JSON, which does not reproduce its recorded markdown under a headless
   * replay — content the batch added silently vanishes. Repositioning the
   * inverse needs only each later step's positional map, never its replay, so
   * the one document this parses is the current one.
   */
  revertSteps(
    currentMarkdown: string,
    inverse: StepBatch,
    laterBatches: readonly StepBatch[],
  ): StepApplicationResult
  /**
   * Steps that replace the whole document with `replacement` (ADR-0014 §4).
   *
   * The range is the parsed document's own extent, which only the editor
   * adapter can know — a caller guessing it from text offsets would miss the
   * structure around the text.
   */
  replaceAllSteps(markdown: string, replacement: string): MarkdownStepResult
  markdownToSteps(
    markdown: string,
    replacement: string,
    range?: StepDocumentRange,
  ): MarkdownStepResult
}

/**
 * Where anchored notes are stored.
 *
 * Optional in exactly the way `ChartDataReader` is: the browser build has no
 * filesystem, so it receives no store and the notes affordances are not
 * offered. An absent capability is not an error to report at use time; it is a
 * feature that is not present.
 */
export interface ThreadStore {
  list(noteKey: string): Promise<Thread[]>
  save(thread: Thread): Promise<void>
  remove(noteKey: string, threadId: string): Promise<void>
}

/**
 * A document's stable identity, so notes survive it being renamed or moved.
 *
 * Two calls rather than one, and the split is the whole point: `readId` cannot
 * write, so opening a document can never modify it. Only creating the first
 * note on a document calls `ensureId`.
 */
export interface NoteIdentity {
  readId(documentHandle: string): Promise<string | undefined>
  ensureId(documentHandle: string): Promise<
    { id: string; markdown?: string } | { unwritable: true }
  >
}

/** Open and resolved notes on one catalog document (APP-47). */
export interface NoteCountEntry {
  readonly handle: string
  readonly open: number
  readonly resolved: number
}

export interface NoteCountReport {
  readonly counts: readonly NoteCountEntry[]
  /**
   * Documents whose notes could not be read. Named, never counted as zero:
   * zero means "no notes", which is not something we know about a file we
   * could not read.
   */
  readonly unreadable: readonly string[]
}

/**
 * Counts notes for documents nobody has opened this session (APP-47).
 *
 * One request for many handles: a catalog is a folder, and a round-trip per
 * row would be N calls across the bridge where the native side can read N
 * files in one. Reads only — a count must never create a sidecar.
 */
export interface NoteCountSource {
  count(handles: readonly string[]): Promise<NoteCountReport>
}

/**
 * Credentials for the in-document agent (AGENT-8). Same three fields as
 * diagram-repair settings, stored separately — repairing a diagram and
 * rewriting a paragraph reasonably want different models.
 */
export interface AgentConnection {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
  /**
   * How hard the model should think, for endpoints that expose it.
   *
   * `default` sends nothing at all rather than a guess, so an endpoint with no
   * such parameter is unaffected. A level the endpoint rejects surfaces as the
   * provider error it is — the field is not quietly dropped on failure, because
   * a run that silently thought less than asked is a worse answer than one that
   * says the setting is unsupported.
   */
  readonly reasoning: AgentReasoning
}

/**
 * `reasoning_effort` on an OpenAI-compatible chat completion, plus `default`.
 *
 * The documented value set for `/chat/completions` is
 * `none | minimal | low | medium | high | xhigh | max`, and which of them a
 * given model accepts is model-dependent — so this is the full set and the
 * endpoint is left to refuse one it does not support, visibly.
 *
 * `default` is ours, not the API's: it means send no `reasoning_effort` at all,
 * so a model with its own default (or no such parameter) is untouched. The
 * Responses API spells the same thing `reasoning: { effort }`; the flat name
 * here is the chat-completions one, which is the endpoint this app calls.
 */
export type AgentReasoning =
  | 'default'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export const AGENT_REASONING_LEVELS: readonly AgentReasoning[] = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function isAgentConfigured(settings: AgentConnection): boolean {
  return settings.apiKey !== '' && settings.baseUrl !== '' && settings.model !== ''
}

export type AgentMayOpenNotes = 'ask' | 'allow' | 'deny'

export interface AgentToolSpec {
  readonly name: string
  readonly description: string
  /**
   * JSON Schema for the call's arguments.
   *
   * Part of the contract, not the transport's business. A provider adapter
   * translates this to whatever wire shape its API wants; it must not invent
   * the shape, because the authority validates the arguments it actually
   * receives and a tool declared without its parameters is a tool no model can
   * call correctly.
   */
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface AgentMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly toolCallId?: string
  /**
   * The tool an assistant turn called, and the arguments it passed.
   *
   * Chat completions needs only the name to echo a turn back. The Responses API
   * needs the call rebuilt as an item — `function_call` with `call_id`, `name`
   * and a JSON-encoded `arguments` — so the transcript has to carry enough to
   * reconstruct it. Storing the name in `content` and hoping is what made this
   * ambiguous.
   */
  readonly toolName?: string
  readonly toolArgs?: unknown
}

export interface AgentProviderInput {
  readonly scope: string
  readonly instruction: string
  readonly noteMarkdown: string
  readonly messages: readonly AgentMessage[]
  readonly tools: readonly AgentToolSpec[]
  /**
   * True when writes are staged as proposals (ADR-0013): the note text shown
   * may not include the model's own pending edits, and it must not redo them.
   */
  readonly staging?: boolean
}

export type AgentProviderTurn =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly name: string
      readonly args: unknown
    }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

export interface AgentProviderPort {
  complete(input: AgentProviderInput): Promise<AgentProviderTurn>
}


/** One saved version of a document (ADR-0014). */
export interface SnapshotEntry {
  readonly id: string
  readonly createdMs: number
  /** A person's name for it; absent on automatic snapshots. */
  readonly label?: string
  /** Why it was taken. */
  readonly trigger: 'agent' | 'manual' | 'restore'
  readonly bytes: number
}

/**
 * Versions beside the document (ADR-0014).
 *
 * The same "beside" as threads: the sidecar directory when it is writable,
 * application data otherwise, keyed by the note's id or degraded path key.
 * Bytes in, bytes out — a snapshot is the document exactly as it was.
 */
export interface SnapshotStore {
  list(noteKey: string): Promise<readonly SnapshotEntry[]>
  write(noteKey: string, markdown: string, options: { readonly trigger: SnapshotEntry['trigger']; readonly label?: string }): Promise<SnapshotEntry>
  read(noteKey: string, id: string): Promise<string>
  remove(noteKey: string, id: string): Promise<void>
}
