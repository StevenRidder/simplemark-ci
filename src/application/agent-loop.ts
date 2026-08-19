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

const TOOLS: readonly AgentToolSpec[] = [
  { name: 'read_note', description: 'Read the open note that the current scope names.' },
  { name: 'apply_transaction', description: 'Replace the scoped passage with Markdown.' },
  { name: 'insert_markdown', description: 'Insert Markdown at the scoped location.' },
  { name: 'find_notes', description: 'List notes in the adopted folder.' },
  { name: 'search', description: 'Search note text in the adopted folder.' },
  { name: 'open_note', description: 'Open another note. Starts an authority, never a window.' },
]

export interface AgentRunControl {
  readonly generation: number
  stop(): void
  pause(): void
  resume(): void
  redirect(instruction: string): void
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
}

class RunControl implements AgentRunControl {
  generation = 0
  status: 'writing' | 'paused' | 'cancelled' | 'completed' | 'failed' = 'writing'
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
    if (this.status !== 'writing') return
    this.status = 'paused'
    this.#pause = new Promise((resolve) => {
      this.#releasePause = resolve
    })
  }

  resume(): void {
    if (this.status !== 'paused') return
    this.status = 'writing'
    this.#releasePause?.()
    this.#pause = null
    this.#releasePause = null
  }

  redirect(instruction: string): void {
    this.generation += 1
    this.instruction = instruction
    this.status = 'writing'
    this.#releasePause?.()
    this.#pause = null
    this.#releasePause = null
  }

  async waitIfPaused(): Promise<void> {
    if (this.status === 'paused' && this.#pause !== null) await this.#pause
  }
}

function rangeFor(target: InstructionTarget): StepDocumentRange | undefined {
  if (target.kind === 'selection') return { from: target.from, to: target.to }
  if (target.kind === 'passage') {
    return { from: target.offset, to: target.offset + target.quote.length }
  }
  return undefined
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
  const snapshot = input.session.snapshot()
  const target = resolveInstructionTarget({
    document: snapshot.markdown,
    instruction: input.instruction,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
  })
  if (target.kind === 'ask') return { kind: 'ask', reason: target.reason, quote: target.quote }

  const granted = grantScope({}, input.noteId)
  if (granted === undefined) {
    return { kind: 'transport_error', message: 'The authority could not issue a scope.' }
  }

  const book: ScopeBook = granted.book
  const range = rangeFor(target)
  const control = new RunControl(input.instruction)
  const capability = input.capability ?? 'editor'
  const inviter = input.inviterCapability ?? 'owner'
  const openPolicy = input.agentMayOpenNotes ?? 'ask'
  const messages: AgentMessage[] = [{ role: 'user', content: input.instruction }]
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS

  for (let turn = 0; turn < maxTurns; turn += 1) {
    await control.waitIfPaused()
    if (control.status === 'cancelled') return { kind: 'stopped' }

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
      return {
        kind: 'transport_error',
        message: error instanceof Error ? error.message : String(error),
      }
    }

    if (!mayApply(control.snapshot(), claimed)) {
      return { kind: 'stopped' }
    }
    if (providerTurn.kind === 'unsupported') return providerTurn
    if (providerTurn.kind === 'error') {
      return { kind: 'transport_error', message: providerTurn.message }
    }
    if (providerTurn.kind === 'text') {
      control.status = 'completed'
      return { kind: 'text', text: providerTurn.text, generation: control.generation }
    }

    control.status = 'writing'
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
    const range = input.name === 'insert_markdown'
      ? {
          from: input.range?.from ?? current.markdown.length,
          to: input.range?.from ?? current.markdown.length,
        }
      : input.range
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
