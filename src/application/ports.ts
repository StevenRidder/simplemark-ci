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

/** The outcome of rendering diagram source. Failure is a value, never a throw. */
export type RenderedDiagram =
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly message: string }

/**
 * Turns diagram source into safe, embeddable SVG.
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
