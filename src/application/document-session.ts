import { buildSourceMap, emitDocument, splitClosedFrontMatter } from '../domain/index.js'

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

export type RevertResult =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false
      readonly reason: 'capability_denied' | 'unknown-id' | 'rebase_failed'
    }

function cloneStepBatch(batch: StepBatch): StepBatch {
  return structuredClone(batch)
}

type AcceptedChange =
  | {
      readonly kind: 'steps'
      readonly actorId: string
      readonly name: string
      readonly steps: StepBatch
      /** Inverse against the document immediately before this change. Null when invert failed. */
      readonly inverse: StepBatch | null
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

  /**
   * Front matter written beside the editor (ensureId) becomes the save baseline.
   *
   * The living document does not author those lines. The next body save must
   * keep them, including when the editor still holds the previous prefix.
   */
  adoptDiskWrite(bytes: string): void {
    const matter = splitClosedFrontMatter(bytes).matter
    this.#baseline = matter + splitClosedFrontMatter(this.#baseline).body
    this.markdown = matter + splitClosedFrontMatter(this.markdown).body
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

    const acceptedSteps = cloneStepBatch(result.steps)
    this.#acceptSteps(transaction.actorId, transaction.name, acceptedSteps, result.markdown)
    return {
      ok: true,
      revision: this.#revision,
      rebased,
      steps: cloneStepBatch(acceptedSteps),
    }
  }

  /**
   * Undo one named step transaction by applying its inverse over later commits.
   *
   * This never restores a saved snapshot: later edits stay unless the inverse
   * cannot rebase, in which case the document is left untouched.
   */
  revert(transactionId: string): RevertResult {
    if (this.steps === undefined) return { ok: false, reason: 'capability_denied' }

    const changeIndex = this.#changeIndexFor(transactionId)
    if (changeIndex === undefined) return { ok: false, reason: 'unknown-id' }

    const change = this.#changes[changeIndex]
    if (change === undefined || change.kind !== 'steps' || change.inverse === null) {
      return { ok: false, reason: 'rebase_failed' }
    }

    const later = this.#laterStepBatches(changeIndex)
    if (later === null) return { ok: false, reason: 'rebase_failed' }

    const afterMarkdown = this.#documents[changeIndex + 1]
    if (afterMarkdown === undefined) return { ok: false, reason: 'unknown-id' }

    const inverse = cloneStepBatch(change.inverse)
    const result = later.length === 0
      ? this.steps.applySteps(this.markdown, inverse)
      : this.steps.rebaseSteps(afterMarkdown, inverse, later)
    if (!result.ok) return { ok: false, reason: 'rebase_failed' }

    this.#acceptSteps('activity', `Revert ${change.name}`, cloneStepBatch(result.steps), result.markdown)
    return { ok: true, revision: this.#revision }
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
    const serialized = this.#serializeDirtyBlocks()
    const matter = splitClosedFrontMatter(this.#baseline).matter
    if (matter === '') return serialized
    const next = splitClosedFrontMatter(serialized)
    if (next.matter === matter) return serialized
    return matter + next.body
  }

  #serializeDirtyBlocks(): string {
    if (this.boundaries === undefined) return this.markdown

    const baselineMap = buildSourceMap(this.#baseline, this.boundaries.starts(this.#baseline))
    const nextMap = buildSourceMap(this.markdown, this.boundaries.starts(this.markdown))

    const boundaries = this.boundaries
    const dirty = dirtyBlocks(baselineMap, nextMap, (a, b) => boundaries.equivalent(a, b))
    if (dirty === null) return this.markdown

    return emitDocument(baselineMap, dirty)
  }

  #acceptSteps(
    actorId: string,
    name: string,
    acceptedSteps: StepBatch,
    nextMarkdown: string,
  ): void {
    const inverse = this.steps === undefined
      ? null
      : this.steps.invertSteps(this.markdown, acceptedSteps)
    this.markdown = nextMarkdown
    this.#revision += 1
    this.#dirty = true
    this.#documents.push(this.markdown)
    this.#changes.push({
      kind: 'steps',
      actorId,
      name,
      steps: cloneStepBatch(acceptedSteps),
      inverse: inverse === null ? null : cloneStepBatch(inverse),
    })
  }

  #changeIndexFor(transactionId: string): number | undefined {
    if (!/^[1-9]\d*$/.test(transactionId)) return undefined
    const revision = Number(transactionId)
    if (String(revision) !== transactionId) return undefined
    const index = revision - 1
    if (index < 0 || index >= this.#changes.length) return undefined
    return index
  }

  #laterStepBatches(afterIndex: number): StepBatch[] | null {
    const batches: StepBatch[] = []
    for (const change of this.#changes.slice(afterIndex + 1)) {
      if (change.kind === 'barrier') return null
      batches.push(change.steps)
    }
    return batches
  }
}
