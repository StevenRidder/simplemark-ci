import { buildSourceMap, emitDocument } from '../domain/index.js'

import { dirtyBlocks } from './dirty-blocks.js'
import type {
  BlockBoundaryPort,
  FilePort,
  StepApplicationResult,
  StepBatch,
  StepDocumentPort,
} from './ports.js'

/**
 * The coordination authority for one open document (ADR-0002).
 *
 * Every change — from the editor today, from the MCP adapter later — reaches the
 * document through this authority. Structural changes carry a base version and
 * are rebased over later accepted step batches. Whole-document changes remain a
 * compatibility path and form an explicit barrier that stale steps cannot cross.
 *
 * Run generations and scoped agent transactions arrive with the live-agent
 * deliverable. This layer sequences opaque step JSON but never interprets it;
 * the editor adapter owns schema-aware application and rebasing.
 *
 * Pure: imports `domain` and its own ports only. No DOM, no ProseMirror, no
 * filesystem — the boundary check enforces it.
 */

export interface DocumentSnapshot {
  /** Monotonic, incremented by every accepted transaction. */
  readonly revision: number
  readonly markdown: string
  /** True when the document has accepted changes that are not yet saved. */
  readonly dirty: boolean
}

export interface DocumentTransaction {
  readonly actorId: string
  /** Human-readable label, surfaced in activity. */
  readonly name: string
  /** The revision the author believed it was editing. */
  readonly expectedRevision: number
  readonly markdown: string
}

export type ApplyResult =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false
      readonly reason: 'stale-revision'
      readonly expected: number
      readonly actual: number
    }

export interface StepTransaction {
  readonly actorId: string
  /** Human-readable label, surfaced in activity. */
  readonly name: string
  /** Last authority revision observed by the submitter. A rebase input, not a guard. */
  readonly baseVersion: number
  readonly steps: StepBatch
}

export type StepTransactionError =
  | 'capability_denied'
  | 'invalid_version'
  | 'invalid_step'
  | 'invalid_schema'
  | 'rebase_failed'

export type StepTransactionApplyResult =
  | {
      readonly ok: true
      readonly revision: number
      readonly rebased: boolean
      /** The accepted batch, mapped onto the current document when rebased. */
      readonly steps: StepBatch
    }
  | { readonly ok: false; readonly reason: StepTransactionError }

export type SaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: string }

function cloneStepBatch(batch: StepBatch): StepBatch {
  return structuredClone(batch)
}

type AcceptedChange =
  | {
      readonly kind: 'steps'
      readonly actorId: string
      readonly name: string
      readonly steps: StepBatch
    }
  | {
      readonly kind: 'barrier'
      readonly actorId: string
      readonly name: string
    }

export class DocumentSession {
  #revision = 0
  #dirty = false
  /** Document text at version zero and after every accepted change. */
  readonly #documents: string[]
  /** Change at index n advances the document from version n to n + 1. */
  readonly #changes: AcceptedChange[] = []
  /**
   * The document's bytes as last read from or written to disk.
   *
   * Untouched blocks are re-emitted from this, never re-serialized, which is
   * what stops an edit to one paragraph renormalizing the whole file. Replaced
   * only by a successful save — never by `apply`, or an edit would become its
   * own baseline and preserve nothing.
   */
  #baseline: string

  private constructor(
    private readonly port: FilePort,
    private readonly handle: string,
    readonly name: string,
    private markdown: string,
    private readonly boundaries?: BlockBoundaryPort,
    private readonly steps?: StepDocumentPort,
  ) {
    this.#baseline = markdown
    this.#documents = [markdown]
  }

  static async open(
    port: FilePort,
    boundaries?: BlockBoundaryPort,
    steps?: StepDocumentPort,
  ): Promise<DocumentSession> {
    const opened = await port.open()
    return new DocumentSession(
      port,
      opened.handle,
      opened.name,
      new TextDecoder().decode(opened.bytes),
      boundaries,
      steps,
    )
  }

  snapshot(): DocumentSnapshot {
    return { revision: this.#revision, markdown: this.markdown, dirty: this.#dirty }
  }

  /** Opaque platform identity used only when another port resolves a link. */
  documentHandle(): string {
    return this.handle
  }

  apply(transaction: DocumentTransaction): ApplyResult {
    if (transaction.expectedRevision !== this.#revision) {
      return {
        ok: false,
        reason: 'stale-revision',
        expected: transaction.expectedRevision,
        actual: this.#revision,
      }
    }

    this.markdown = transaction.markdown
    this.#revision += 1
    this.#dirty = true
    this.#documents.push(this.markdown)
    this.#changes.push({
      kind: 'barrier',
      actorId: transaction.actorId,
      name: transaction.name,
    })
    return { ok: true, revision: this.#revision }
  }

  /**
   * Accept an ordered structural batch, rebasing it when the submitter is stale.
   *
   * Rejections are atomic: the current document, revision, dirty state, and log
   * change only after the editor-owned port has returned one valid result.
   */
  applySteps(transaction: StepTransaction): StepTransactionApplyResult {
    if (this.steps === undefined) return { ok: false, reason: 'capability_denied' }
    if (
      !Number.isInteger(transaction.baseVersion)
      || transaction.baseVersion < 0
      || transaction.baseVersion > this.#revision
    ) {
      return { ok: false, reason: 'invalid_version' }
    }

    const rebased = transaction.baseVersion !== this.#revision
    let result: StepApplicationResult
    if (rebased) {
      const changes = this.#changes.slice(transaction.baseVersion)
      const baseMarkdown = this.#documents[transaction.baseVersion]
      if (baseMarkdown === undefined) return { ok: false, reason: 'invalid_version' }
      const committedBatches: StepBatch[] = []
      for (const change of changes) {
        if (change.kind === 'barrier') return { ok: false, reason: 'rebase_failed' }
        committedBatches.push(change.steps)
      }
      result = this.steps.rebaseSteps(baseMarkdown, transaction.steps, committedBatches)
    } else {
      result = this.steps.applySteps(this.markdown, transaction.steps)
    }

    if (!result.ok) return { ok: false, reason: result.kind }

    this.markdown = result.markdown
    this.#revision += 1
    this.#dirty = true
    const acceptedSteps = cloneStepBatch(result.steps)
    this.#documents.push(this.markdown)
    this.#changes.push({
      kind: 'steps',
      actorId: transaction.actorId,
      name: transaction.name,
      steps: acceptedSteps,
    })
    return {
      ok: true,
      revision: this.#revision,
      rebased,
      steps: cloneStepBatch(acceptedSteps),
    }
  }

  async save(force = false): Promise<SaveResult> {
    // Selecting another note asks the current session to save before it is
    // swapped out. A clean document has nothing to persist, and writing it
    // anyway changes the file's modification date just for having been read.
    if (!force && !this.#dirty) return { ok: true, revision: this.#revision }

    const bytes = this.#preservingSerialization()

    try {
      await this.port.save(this.handle, new TextEncoder().encode(bytes))
    } catch (error) {
      // Surface the real cause. A save that failed must never leave the document
      // looking clean, or the user trusts a file that was never written.
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }

    this.#dirty = false
    this.#baseline = bytes
    return { ok: true, revision: this.#revision }
  }

  /**
   * What to write: the baseline with only the changed blocks re-serialized.
   *
   * Falls back to the whole document — which renormalizes, exactly as every
   * save did before this existed — whenever the dirty set cannot be determined
   * honestly: no boundary port composed, a block added, removed or split, or a
   * changed preamble. A wrong preservation would corrupt the file; an honest
   * re-serialization only reformats it.
   */
  #preservingSerialization(): string {
    if (this.boundaries === undefined) return this.markdown

    const baselineMap = buildSourceMap(this.#baseline, this.boundaries.starts(this.#baseline))
    const nextMap = buildSourceMap(this.markdown, this.boundaries.starts(this.markdown))

    const boundaries = this.boundaries
    const dirty = dirtyBlocks(baselineMap, nextMap, (a, b) => boundaries.equivalent(a, b))
    if (dirty === null) return this.markdown

    return emitDocument(baselineMap, dirty)
  }
}
