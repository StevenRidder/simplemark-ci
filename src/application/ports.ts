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
