import {
  grantScope,
  mayApply,
  mayWriteAtCall,
  noteIdFor,
  type Capability,
  type ScopeBook,
} from '../domain/index.js'
import type { DocumentSession } from './document-session.js'
import { resolveInstructionTarget, type InstructionTarget } from './instruction-target.js'
import type {
  AgentMayOpenNotes,
  AgentMessage,
  AgentProviderPort,
  AgentToolSpec,
  StepDocumentRange,
} from './ports.js'

const DEFAULT_MAX_TURNS = 16

/**
 * What the status line says. Plain language about the document, not tool names
 * — `Rewriting the selected passage` is what a reader can act on;
 * `apply_transaction` is not (COLLABORATION.md §6.4).
 */
const ASKING_DETAIL = 'Thinking'
const PAUSED_DETAIL = 'Paused — no further edits'
const STOPPED_DETAIL = 'Stopped'
const DONE_DETAIL = 'Finished'
const FAILED_DETAIL = 'Could not finish'
const BOUND_DETAIL = 'Stopped after too many steps'

const WRITE_TOOLS: ReadonlySet<string> = new Set(['apply_transaction', 'insert_markdown'])

function detailFor(tool: string, target: InstructionTarget): string {
  if (tool === 'read_note') return 'Reading the note'
  if (tool === 'find_notes' || tool === 'search') return 'Looking through the folder'
  if (tool === 'open_note') return 'Asking to open another note'
  if (tool === 'insert_markdown') return 'Adding to the end of the note'
  if (tool !== 'apply_transaction') return ASKING_DETAIL
  if (target.kind === 'selection') return 'Rewriting the selected passage'
  if (target.kind === 'passage') return `Rewriting “${ellipsis(target.quote)}”`
  return 'Rewriting the note'
}

function ellipsis(quote: string): string {
  return quote.length <= 32 ? quote : `${quote.slice(0, 31)}…`
}

/**
 * The scope argument every note-bound tool must echo.
 *
 * Declared rather than described in prose: the authority rejects a call whose
 * scope is not the current one, so a model that was never told the parameter
 * exists cannot make a single valid call. That is not a prompt-quality
 * question — it is the difference between the tool surface working and not.
 */
const SCOPE_PARAMETER = {
  type: 'string',
  description: 'The scope token issued for this run. Echo it exactly as given.',
} as const

function scoped(properties: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    type: 'object',
    properties: { scope: SCOPE_PARAMETER, ...properties },
    required: ['scope', ...Object.keys(properties)],
    additionalProperties: false,
  }
}

const MARKDOWN_PARAMETER = {
  type: 'string',
  description: 'The Markdown to write. Supply content only; never a position or a range.',
} as const

const TOOLS: readonly AgentToolSpec[] = [
  {
    name: 'read_note',
    description: 'Read the open note that the current scope names.',
    parameters: scoped(),
  },
  {
    name: 'apply_transaction',
    description:
      'Replace the scoped passage with Markdown. The authority owns the range; you supply content.',
    parameters: scoped({ markdown: MARKDOWN_PARAMETER }),
  },
  {
    name: 'insert_markdown',
    description: 'Insert Markdown at the scoped location.',
    parameters: scoped({ markdown: MARKDOWN_PARAMETER }),
  },
  {
    name: 'find_notes',
    description: 'List notes in the adopted folder.',
    parameters: scoped(),
  },
  {
    name: 'search',
    description: 'Search note text in the adopted folder.',
    parameters: scoped({
      query: { type: 'string', description: 'Text to look for.' },
    }),
  },
  {
    name: 'open_note',
    description: 'Open another note. Starts an authority, never a window, and needs consent.',
    parameters: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'The note to open.' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
]

/**
 * What the agent is doing, in the words the status line uses.
 *
 * `paused` is resumable and distinct from `cancelled`: Pause stops further
 * writes and leaves the run alive, Stop ends it (COLLABORATION.md §5.2).
 */
export type AgentRunStatus = 'thinking' | 'writing' | 'paused' | 'cancelled' | 'completed' | 'failed'

export interface AgentRunControl {
  readonly generation: number
  readonly status: AgentRunStatus
  stop(): void
  pause(): void
  resume(): void
  redirect(instruction: string): void
}

/** One observation of a live run, for the status line and the note-row marker. */
export interface AgentActivity {
  readonly status: AgentRunStatus
  readonly generation: number
  /** Names what is happening, e.g. `Rewriting the selected passage`. */
  readonly detail: string
  /** Accepted agent transactions so far in this run. */
  readonly writes: number
  /** Where the last accepted write landed, when the authority scoped it. */
  readonly range?: StepDocumentRange
}

export type AgentLoopResult =
  | { readonly kind: 'text'; readonly text: string; readonly generation: number }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'bound' }
  | { readonly kind: 'transport_error'; readonly message: string }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'ask'; readonly reason: 'missing' | 'ambiguous'; readonly quote: string }
  | { readonly kind: 'consent_pending'; readonly handle: string }

export interface AgentLoopInput {
  readonly session: DocumentSession
  readonly provider: AgentProviderPort
  readonly instruction: string
  readonly noteId: string
  readonly actorId: string
  readonly selection?: { readonly from: number; readonly to: number }
  readonly maxTurns?: number
  readonly agentMayOpenNotes?: AgentMayOpenNotes
  readonly capability?: Capability
  readonly inviterCapability?: Capability
  readonly afterUnit?: (control: AgentRunControl) => void
  /**
   * Handed the control before the first provider call.
   *
   * `afterUnit` is too late for Pause: the reader can press it while the model
   * is still being asked, and with no handle yet that press would be dropped
   * and the next unit would write anyway.
   */
  readonly onStart?: (control: AgentRunControl) => void
  /** Every status change, so a status line can name the current activity. */
  readonly onActivity?: (activity: AgentActivity) => void
  /**
   * Maps matched text offsets to document positions (see `TextTargetResolver`).
   *
   * Supply it whenever the document has a real editor behind it. Without it the
   * caller's offsets are taken to be document positions already.
   */
  readonly textTarget?: TextTargetResolver
}

class RunControl implements AgentRunControl {
  generation = 0
  status: AgentRunStatus = 'thinking'
  instruction: string
  #pause: Promise<void> | null = null
  #releasePause: (() => void) | null = null

  constructor(instruction: string) {
    this.instruction = instruction
  }

  snapshot() {
    return { runId: 'agent-run', generation: this.generation, status: this.status }
  }

  stop(): void {
    this.generation += 1
    this.status = 'cancelled'
    this.#releasePause?.()
  }

  pause(): void {
    if (this.status !== 'writing' && this.status !== 'thinking') return
    this.status = 'paused'
    this.#pause = new Promise((resolve) => {
      this.#releasePause = resolve
    })
  }

  resume(): void {
    if (this.status !== 'paused') return
    this.status = 'thinking'
    this.#releasePause?.()
    this.#pause = null
    this.#releasePause = null
  }

  redirect(instruction: string): void {
    this.generation += 1
    this.instruction = instruction
    this.status = 'thinking'
    this.#releasePause?.()
    this.#pause = null
    this.#releasePause = null
  }

  async waitIfPaused(): Promise<void> {
    if (this.status === 'paused' && this.#pause !== null) await this.#pause
  }
}

/**
 * Turns a passage the instruction pointed at into document positions.
 *
 * This exists because two different coordinate spaces meet here and used to be
 * silently interchanged. A live selection arrives as **document positions**. A
 * quoted or pasted passage is located by matching **text offsets**. They are not
 * the same number: block boundaries and any Markdown syntax between them shift
 * one relative to the other, so a passage range used as a document range landed
 * one position late in a three-paragraph note — replacing the passage but
 * leaving its first character behind as a block of its own — and drifted
 * further with every preceding block.
 *
 * Only the editor adapter can map between the two, because only it holds the
 * parse. Supplying this is therefore how a caller says "my offsets are text
 * offsets"; a caller that omits it is stating that its offsets already are
 * document positions, which is true of a test double whose port treats the
 * Markdown string as the document.
 */
export interface TextTargetResolver {
  /** The text an instruction is matched against — the editor's own. */
  text(): string
  /** Document positions for the `[offset, offset + length)` span of that text. */
  rangeAt(offset: number, length: number): StepDocumentRange | undefined
}

function rangeFor(
  target: InstructionTarget,
  resolver: TextTargetResolver | undefined,
): StepDocumentRange | undefined {
  if (target.kind === 'selection') return { from: target.from, to: target.to }
  if (target.kind !== 'passage') return undefined
  if (resolver === undefined) {
    return { from: target.offset, to: target.offset + target.quote.length }
  }
  return resolver.rangeAt(target.offset, target.quote.length)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  // Resolved against the same text the range mapper indexes. Matching one
  // string and mapping through another is what produced the off-by-N above.
  const targetText = input.textTarget?.text() ?? input.session.snapshot().markdown
  const target = resolveInstructionTarget({
    document: targetText,
    instruction: input.instruction,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
  })
  if (target.kind === 'ask') return { kind: 'ask', reason: target.reason, quote: target.quote }

  const granted = grantScope({}, input.noteId)
  if (granted === undefined) {
    return { kind: 'transport_error', message: 'The authority could not issue a scope.' }
  }

  const book: ScopeBook = granted.book
  let currentTarget = target
  let range = rangeFor(target, input.textTarget)
  const control = new RunControl(input.instruction)
  // The generation the target was resolved at. A Redirect bumps the generation
  // and replaces the instruction, so the target has to be resolved again —
  // otherwise replacement work is written into the passage the *previous*
  // instruction named, which is the one thing a redirect is asking to change.
  let resolvedAt = control.generation
  const capability = input.capability ?? 'editor'
  const inviter = input.inviterCapability ?? 'owner'
  const openPolicy = input.agentMayOpenNotes ?? 'ask'
  const messages: AgentMessage[] = [{ role: 'user', content: input.instruction }]
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS

  let writes = 0
  let lastRange: StepDocumentRange | undefined
  const report = (detail: string): void => {
    input.onActivity?.({
      status: control.status,
      generation: control.generation,
      detail,
      writes,
      ...(lastRange === undefined ? {} : { range: lastRange }),
    })
  }

  // Before the first provider call, not after the first unit: Pause pressed
  // while the model is being asked has to reach a real control.
  input.onStart?.(control)
  report(ASKING_DETAIL)

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (control.status === 'paused') report(PAUSED_DETAIL)
    await control.waitIfPaused()
    if (control.status === 'cancelled') {
      report(STOPPED_DETAIL)
      return { kind: 'stopped' }
    }
    report(ASKING_DETAIL)

    if (control.generation !== resolvedAt) {
      const redirected = resolveInstructionTarget({
        document: input.textTarget?.text() ?? input.session.snapshot().markdown,
        instruction: control.instruction,
      })
      // An ambiguous or missing referent in the *new* instruction is still a
      // question, and asking it beats writing somewhere nobody pointed at.
      if (redirected.kind === 'ask') {
        return { kind: 'ask', reason: redirected.reason, quote: redirected.quote }
      }
      currentTarget = redirected
      range = rangeFor(redirected, input.textTarget)
      resolvedAt = control.generation
      // Replacement work, not a continuation: the abandoned exchange must not
      // steer the new instruction, or the agent keeps answering the question it
      // was just told to stop answering.
      messages.length = 0
      messages.push({ role: 'user', content: control.instruction })
    }

    const claimed = control.generation
    let providerTurn
    try {
      providerTurn = await input.provider.complete({
        scope: granted.token,
        instruction: control.instruction,
        noteMarkdown: input.session.snapshot().markdown,
        messages,
        tools: TOOLS,
      })
    } catch (error) {
      control.status = 'failed'
      report(FAILED_DETAIL)
      return {
        kind: 'transport_error',
        message: error instanceof Error ? error.message : String(error),
      }
    }

    if (!mayApply(control.snapshot(), claimed)) {
      // The generation moved while this turn was in flight, so its result is
      // refused rather than merged. *Why* it moved decides what happens next:
      // Stop ends the run, but Redirect asked for replacement work, and ending
      // the run there would make Redirect a differently-spelled Stop.
      if (control.snapshot().status === 'cancelled') {
        report(STOPPED_DETAIL)
        return { kind: 'stopped' }
      }
      report(ASKING_DETAIL)
      continue
    }
    if (providerTurn.kind === 'unsupported') {
      control.status = 'failed'
      report(FAILED_DETAIL)
      return providerTurn
    }
    if (providerTurn.kind === 'error') {
      control.status = 'failed'
      report(FAILED_DETAIL)
      return { kind: 'transport_error', message: providerTurn.message }
    }
    if (providerTurn.kind === 'text') {
      control.status = 'completed'
      report(DONE_DETAIL)
      return { kind: 'text', text: providerTurn.text, generation: control.generation }
    }

    // A Pause pressed while the model was being asked has to hold the write it
    // implies. Setting `writing` unconditionally here discarded that press —
    // the run reported itself as writing and the edit landed anyway.
    if (control.status === 'paused') {
      report(PAUSED_DETAIL)
      await control.waitIfPaused()
    }
    // Read through `snapshot()` rather than the field. Resume releases the wait,
    // but so does Stop, and a field narrowed before a suspension point keeps
    // that narrowing across the await even though the value can change — so the
    // Stop case would be compiled away as unreachable.
    if (control.snapshot().status === 'cancelled') {
      report(STOPPED_DETAIL)
      return { kind: 'stopped' }
    }
    control.status = 'writing'
    report(detailFor(providerTurn.name, currentTarget))
    const tool = dispatchTool({
      name: providerTurn.name,
      args: providerTurn.args,
      session: input.session,
      book,
      noteId: input.noteId,
      range,
      actorId: input.actorId,
      capability,
      inviter,
      openPolicy,
    })
    if (tool.kind === 'consent_pending') return tool
    if (tool.kind === 'ok' && WRITE_TOOLS.has(providerTurn.name)) {
      writes += 1
      lastRange = range
      report(detailFor(providerTurn.name, currentTarget))
    }

    messages.push({
      role: 'assistant',
      content: providerTurn.name,
      toolCallId: providerTurn.id,
    })
    messages.push({
      role: 'tool',
      content: tool.kind === 'ok' ? tool.content : tool.message,
      toolCallId: providerTurn.id,
    })

    input.afterUnit?.(control)
  }

  report(BOUND_DETAIL)
  return { kind: 'bound' }
}

type ToolOutcome =
  | { readonly kind: 'ok'; readonly content: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'consent_pending'; readonly handle: string }

function dispatchTool(input: {
  readonly name: string
  readonly args: unknown
  readonly session: DocumentSession
  readonly book: ScopeBook
  readonly noteId: string
  readonly range: StepDocumentRange | undefined
  readonly actorId: string
  readonly capability: Capability
  readonly inviter: Capability
  readonly openPolicy: AgentMayOpenNotes
}): ToolOutcome {
  const args = asRecord(input.args) ?? {}

  if (input.name === 'open_note') {
    const handle = textOf(args.handle)
    if (handle === undefined || handle === '') {
      return { kind: 'error', message: 'open_note requires a handle.' }
    }
    if (handle === input.session.documentHandle()) {
      return { kind: 'ok', content: handle }
    }
    if (input.openPolicy === 'deny') {
      return { kind: 'error', message: 'Opening another note is denied for this vault.' }
    }
    return { kind: 'consent_pending', handle }
  }

  const scope = textOf(args.scope)
  if (scope === undefined || noteIdFor(input.book, scope) !== input.noteId) {
    return { kind: 'error', message: 'The scope token is not current for this note.' }
  }

  if (input.name === 'read_note') {
    return { kind: 'ok', content: input.session.snapshot().markdown }
  }

  if (input.name === 'find_notes' || input.name === 'search') {
    return { kind: 'error', message: `${input.name} needs an adopted folder.` }
  }

  if (input.name === 'apply_transaction' || input.name === 'insert_markdown') {
    if (!mayWriteAtCall(input.capability, input.inviter)) {
      return { kind: 'error', message: 'This capability cannot write.' }
    }
    const markdown = textOf(args.markdown)
    if (markdown === undefined) {
      return { kind: 'error', message: `${input.name} requires markdown.` }
    }
    const current = input.session.snapshot()
    // An append has no position of its own to give. Leaving the range absent
    // lets the step port use the end of the document it just parsed; deriving
    // one from `markdown.length` put a Markdown character count where a
    // document position belongs, which is past the end of the document and so
    // failed the whole insert.
    const range = input.name !== 'insert_markdown'
      ? input.range
      : input.range === undefined
        ? undefined
        : { from: input.range.from, to: input.range.from }
    const applied = input.session.applyMarkdown({
      actorId: input.actorId,
      name: 'Agent edit',
      baseVersion: current.revision,
      markdown,
      ...(range === undefined ? {} : { range }),
    })
    if (!applied.ok) return { kind: 'error', message: applied.reason }
    return { kind: 'ok', content: input.session.snapshot().markdown }
  }

  return { kind: 'error', message: `Unknown tool ${input.name}.` }
}
