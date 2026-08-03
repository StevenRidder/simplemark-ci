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
