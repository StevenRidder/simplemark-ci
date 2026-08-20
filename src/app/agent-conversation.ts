/**
 * The app-level agent conversation (ADR-0012).
 *
 * App state, never document content. Nothing here is written into a `.md`, and
 * it is not the `.simplemark/` thread sidecar either: threads are a person's
 * anchored notes on one document (ADR-0011), and this spans notes.
 *
 * Two rules the type system carries rather than a comment:
 *
 * **A message is correctable.** `edit` replaces a body in place; it does not
 * append a correction below the original. A transcript nobody can fix is the
 * pile this product exists to replace.
 *
 * **Communication is not control.** A posted message's `mode` records what
 * sending it did, and `redirect` is the only value that had a control effect.
 * The effect belongs to the run's generation, never to the text: a message
 * whose body is "stop" is a message (`SWITCHBOARD-KERNEL.md` §5).
 */

/** What the composer's Send did. Never inferred from the text. */
export type ComposerMode = 'note' | 'redirect'

export type MessageAuthor = 'you' | 'agent'

export interface ConversationMessage {
  readonly id: string
  readonly author: MessageAuthor
  /** Markdown, rendered through the document's own parser and schema. */
  readonly markdown: string
  /**
   * For a person's message, what sending it did. Absent on the agent's own
   * messages, which are never a control action.
   */
  readonly mode?: ComposerMode
  /** True once corrected in place, so the surface can say so honestly. */
  readonly edited: boolean
}

export interface PostedMessage {
  readonly author: MessageAuthor
  readonly markdown: string
  readonly mode?: ComposerMode
}

/**
 * The message list, and nothing else.
 *
 * Deliberately holds no run, no provider and no note: a conversation that owned
 * those would be the place a second copy of the agent's state grew.
 */
export class AgentConversation {
  #messages: ConversationMessage[] = []
  #nextId = 1

  messages(): readonly ConversationMessage[] {
    return this.#messages
  }

  /** Appends a message and answers with its id, so a caller can correct it. */
  post(message: PostedMessage): string {
    const id = `message-${this.#nextId}`
    this.#nextId += 1
    this.#messages.push({
      id,
      author: message.author,
      markdown: message.markdown,
      ...(message.mode === undefined ? {} : { mode: message.mode }),
      edited: false,
    })
    return id
  }

  /**
   * Corrects a message in place.
   *
   * Answers `false` for an unknown id or an empty body rather than deleting the
   * message: a body that vanished on a stray keystroke is a lost message, and
   * the composer's own Cancel is how a correction is abandoned.
   */
  edit(id: string, markdown: string): boolean {
    if (markdown.trim() === '') return false
    const index = this.#messages.findIndex((message) => message.id === id)
    if (index < 0) return false
    const existing = this.#messages[index]!
    if (existing.markdown === markdown) return true
    this.#messages[index] = { ...existing, markdown, edited: true }
    return true
  }

  /** Empties the conversation — a different workspace is a different subject. */
  clear(): void {
    this.#messages = []
  }
}

/**
 * The instruction a run should receive for a message sent in this mode.
 *
 * `note` returns undefined: leaving a note starts nothing and redirects
 * nothing. Keeping that decision here, rather than at the call site, is what
 * stops a future caller reading intent out of the body text.
 */
export function instructionFor(mode: ComposerMode, markdown: string): string | undefined {
  return mode === 'redirect' ? markdown : undefined
}
