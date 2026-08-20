import { runAgentLoop } from '../application/index.js'
import type {
  AcceptedChange,
  AgentActivity,
  AgentProviderPort,
  AgentRunControl,
  DocumentSession,
  StepBatch,
  StepDocumentRange,
} from '../application/index.js'
import { AgentConversation, type ComposerMode } from './agent-conversation.js'
import type { AgentPanel, AgentQuestion } from './ui/agent-panel.js'
import type { AgentStatusLine } from './ui/agent-status-line.js'

/**
 * One live agent, wired to the surfaces a person sees (APP-32).
 *
 * The loop, the fence, the scopes and the instruction-target resolver already
 * existed and are not re-implemented here. What this owns is the join: turning
 * one accepted change into every consequence of it, and keeping the two things
 * a reader controls — Pause and Redirect — pointed at the run's own control
 * channel rather than at the text.
 *
 * The write path is deliberately one-way. `runAgentLoop` commits through the
 * session authority; the session announces the accepted change; this mirrors
 * that change into the visible editor, credits the block, counts it against the
 * note, and offers it to Follow. Nothing writes to the editor directly, so
 * there is no second path by which an agent edit could reach the document
 * without the authority having accepted it (ADR-0006).
 */

export interface AgentEditorBridge {
  /** Mirrors an accepted batch into the visible view, credited to `actorId`. */
  applyRemoteSteps(steps: StepBatch, actorId: string): boolean
  /** The live selection, when the reader has one. */
  selectionRange(): { readonly from: number; readonly to: number } | undefined
  /** Brings a range into view. Called only while Follow is on. */
  reveal(range: { readonly from: number; readonly to: number }): void
  /** Highlights the scope an agent is writing in. `undefined` clears it. */
  showScope(range: { readonly from: number; readonly to: number } | undefined): void
  /**
   * The text an instruction is matched against, and the mapping back into
   * document positions. Both come from the editor so a matched offset and the
   * range it is applied at cannot be in different coordinate spaces.
   */
  documentText(): string
  documentRangeAt(
    offset: number,
    length: number,
  ): { readonly from: number; readonly to: number } | undefined
}

export interface AgentControllerOptions {
  readonly session: DocumentSession
  readonly editor: AgentEditorBridge
  readonly panel: AgentPanel
  readonly status: AgentStatusLine
  readonly conversation: AgentConversation
  /** Undefined when no provider is configured. Read per run, never cached. */
  readonly provider: () => AgentProviderPort | undefined
  /** The note an accepted agent change should be counted against. */
  readonly noteHandle: () => string
  /** Called with the running total of agent changes for that note. */
  readonly onAgentEdit: (handle: string) => void
  /**
   * Where an accepted agent change landed, by transaction id.
   *
   * The authority scoped the write, so this is the one place that knows —
   * the session itself only sequences opaque steps.
   */
  readonly onAcceptedAt?: (transactionId: string, from: number) => void
  /** The actor id agent writes are credited to in the margin. */
  readonly actorId?: string
}

export interface AgentController {
  /** Sends a composer message. `note` posts and returns; `redirect` runs. */
  send(mode: ComposerMode, markdown: string): void
  pause(): void
  resume(): void
  stop(): void
  /**
   * Runs the agent against one passage, answering with what to put in its thread.
   *
   * The passage conversation's entry point (AGENT-9). Unlike `send`, this
   * resolves rather than posting into the app-level conversation, because the
   * answer belongs in the anchored thread the reader asked from.
   */
  runForPassage(instruction: string, range: StepDocumentRange): Promise<string>
  /**
   * Fences the live run and starts replacement work in the same passage.
   *
   * A range of `undefined` means the anchor no longer matches; the redirect
   * still fences, because a reader who said stop has stopped it either way.
   */
  redirectForPassage(instruction: string, range?: StepDocumentRange): Promise<string>
  /** Answers "which occurrence?" and runs the held instruction against it. */
  answerQuestion(occurrence: number): void
  /** True while a run has not reached a terminal status. */
  isRunning(): boolean
  dispose(): void
}

/**
 * The note id the scope is issued against.
 *
 * Not the file path: a scope is per-note and per-run, and the handle can change
 * under a long-lived controller when a note is renamed.
 */
function noteIdOf(session: DocumentSession): string {
  const handle = session.documentHandle()
  return handle === '' ? 'note' : handle
}

export function createAgentController(options: AgentControllerOptions): AgentController {
  const actorId = options.actorId ?? 'agent'
  let control: AgentRunControl | undefined
  let running = false
  /** An instruction held back because the target was ambiguous. */
  let held: string | undefined
  /** The scope of the run in flight, for attributing where a change landed. */
  let lastScope: { readonly from: number; readonly to: number } | undefined

  const unsubscribe = options.session.onAccepted((change: AcceptedChange) => {
    if (change.actorId !== actorId) return
    // A barrier cannot be mirrored as steps. Re-rendering the whole view is the
    // caller's business; saying nothing and leaving a stale view is not.
    if (change.steps === undefined) return
    options.editor.applyRemoteSteps(change.steps, actorId)
    if (lastScope !== undefined) {
      options.onAcceptedAt?.(String(change.revision), lastScope.from)
    }
    options.onAgentEdit(options.noteHandle())
  })

  const TERMINAL: ReadonlySet<AgentActivity['status']> = new Set([
    'completed',
    'cancelled',
    'failed',
  ])

  function onActivity(activity: AgentActivity): void {
    running = activity.status === 'thinking'
      || activity.status === 'writing'
      || activity.status === 'paused'
    // Where it is working, while it works. Cleared the moment the run ends, so
    // a finished run leaves no highlight claiming otherwise.
    if (activity.range !== undefined) lastScope = activity.range
    options.editor.showScope(TERMINAL.has(activity.status) ? undefined : activity.range)
    options.status.show(activity)
    // Repaint, never open: a run must not change which surface a reader is on.
    options.panel.repaint()
  }

  /**
   * One run, answering with what the agent said.
   *
   * The string is returned as well as posted so a caller can put it somewhere
   * else — the passage conversation needs the answer in its own thread, not in
   * the app-level one.
   */
  async function run(
    instruction: string,
    selection?: { from: number; to: number },
  ): Promise<string> {
    const provider = options.provider()
    if (provider === undefined) {
      // Visible and local. An unconfigured agent says so instead of looking
      // like one that had nothing to say.
      const unconfigured = 'No document agent is configured. Settings → Document agent.'
      options.conversation.post({ author: 'agent', markdown: unconfigured })
      options.panel.repaint()
      return unconfigured
    }

    options.panel.setQuestion(undefined)

    const result = await runAgentLoop({
      session: options.session,
      provider,
      instruction,
      noteId: noteIdOf(options.session),
      actorId,
      ...(selection === undefined ? {} : { selection }),
      onStart: (started) => {
        control = started
      },
      onActivity,
      textTarget: {
        text: () => options.editor.documentText(),
        rangeAt: (offset, length) => options.editor.documentRangeAt(offset, length),
      },
    })

    if (result.kind === 'ask') {
      // Nothing has been edited and nothing will be until this is answered:
      // the target is resolved before a scope is ever issued.
      held = instruction
      const occurrences = result.reason === 'ambiguous'
        // Counted in the same text the loop matched against, so the offsets a
        // reader picks from are the offsets the next run can map.
        ? occurrencesOf(options.editor.documentText(), result.quote)
        : []
      options.panel.setQuestion({ reason: result.reason, quote: result.quote, occurrences })
      options.status.show(undefined)
      running = false
      control = undefined
      return result.reason === 'ambiguous'
        ? `“${result.quote}” appears more than once. Say which one.`
        : `“${result.quote}” is not in this note, so nothing was changed.`
    }

    held = undefined
    const answer = result.kind === 'text'
      ? result.text
      : result.kind === 'transport_error' || result.kind === 'unsupported'
        ? `Could not finish — ${result.message}`
        : result.kind === 'consent_pending'
          ? `Asked to open **${result.handle}**. Opening another note needs your say-so.`
          : 'Stopped after too many steps without finishing.'
    if (result.kind !== 'stopped') options.conversation.post({ author: 'agent', markdown: answer })
    running = false
    // The run is over; its control must not be reachable. A later Pause hitting
    // a finished run's control would report a paused agent that does not exist.
    control = undefined
    options.panel.repaint()
    return result.kind === 'stopped' ? 'Stopped.' : answer
  }

  return {
    send(mode, markdown) {
      options.conversation.post({ author: 'you', markdown, mode })
      options.panel.repaint()

      if (mode === 'note') {
        // Leave note communicates and has no control effect — including when
        // its text reads "stop" (SWITCHBOARD-KERNEL.md §5).
        return
      }

      if (control !== undefined && running) {
        // Redirect fences the current generation and starts replacement work.
        // The old generation's next write is refused, not merged.
        control.redirect(markdown)
        return
      }
      void run(markdown, options.editor.selectionRange())
    },
    async runForPassage(instruction, range) {
      const outcome = await run(instruction, { from: range.from, to: range.to })
      return outcome
    },
    async redirectForPassage(instruction, range) {
      // Fence first, whatever happens next: the reader has said stop.
      if (control !== undefined && running) control.redirect(instruction)
      else if (range !== undefined) return run(instruction, { from: range.from, to: range.to })
      return 'Redirected.'
    },
    pause: () => control?.pause(),
    resume: () => control?.resume(),
    stop: () => {
      control?.stop()
      control = undefined
      running = false
      options.editor.showScope(undefined)
      options.status.show(undefined)
    },
    answerQuestion(occurrence) {
      const instruction = held
      if (instruction === undefined) return
      held = undefined
      options.panel.setQuestion(undefined)
      const text = options.editor.documentText()
      const quote = quoteAt(text, occurrence, instruction)
      // Passed as a selection, which the loop treats as document positions —
      // so the text offset the reader chose is mapped exactly once, here.
      const range = quote === ''
        ? undefined
        : options.editor.documentRangeAt(occurrence, quote.length)
      void run(instruction, range)
    },
    isRunning: () => running,
    dispose: () => {
      control?.stop()
      unsubscribe()
    },
  }
}

/** Every offset at which `quote` occurs, so the reader can pick one. */
export function occurrencesOf(document: string, quote: string): readonly number[] {
  if (quote === '') return []
  const found: number[] = []
  let index = document.indexOf(quote)
  while (index >= 0) {
    found.push(index)
    index = document.indexOf(quote, index + 1)
  }
  return found
}

/**
 * The text the chosen occurrence stands for.
 *
 * The instruction may be the passage itself (a paste) or may quote it. Falling
 * back to the whole instruction would scope the run to the wrong length, so an
 * unrecognised shape scopes to nothing and the loop resolves the target again.
 */
function quoteAt(document: string, offset: number, instruction: string): string {
  const pasted = instruction.trim()
  if (pasted !== '' && document.startsWith(pasted, offset)) return pasted
  const quoted = /"([^"]+)"|'([^']+)'/.exec(instruction)
  const inner = (quoted?.[1] ?? quoted?.[2])?.trim()
  if (inner !== undefined && inner !== '' && document.startsWith(inner, offset)) return inner
  return ''
}
