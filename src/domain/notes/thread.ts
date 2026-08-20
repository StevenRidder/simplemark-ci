import type { Anchor } from './anchor.js'

/**
 * One note about one passage.
 *
 * `author` is always `'local'` and nothing displays it. It exists so that a
 * later multi-party version does not require migrating every stored thread —
 * the cheap half of not foreclosing that, where the expensive half (identity,
 * permissions, merge) is deliberately absent.
 */
/**
 * One turn in a passage conversation (AGENT-9).
 *
 * The thread's own `body` is the first turn — a person's note. Everything after
 * it is a reply, from a person or an agent. What separates a note from a
 * conversation is that somebody answered, not a different surface: the
 * wireframe's passage conversation *is* the anchored thread with an agent in it
 * (COLLABORATION.md §4).
 */
export interface ThreadMessage {
  readonly id: string
  /** `local` for this person, or the participant id that wrote it. */
  readonly author: string
  readonly createdAt: string
  /** Markdown, rendered the way the thread's own body is. */
  readonly body: string
  /**
   * What sending it did, for a person's own turn.
   *
   * Recorded because the sequence has to stay readable later: which of these
   * actually fenced a generation? Absent on an agent's turn, which is never a
   * control action, and absent on a plain note.
   */
  readonly mode?: 'note' | 'redirect'
}

export interface Thread {
  readonly id: string
  /** A note id, or `path-<hash>` when the document would not take one. */
  readonly noteKey: string
  readonly author: string
  readonly createdAt: string
  /** Markdown. Links and embeds resolve; block diagrams are not offered. */
  readonly body: string
  /** Absent once detached: the note is about the document, not a passage. */
  readonly anchor: Anchor | undefined
  readonly state: 'open' | 'resolved'
  /** Keyed by path because the document could not take an id. */
  readonly degraded?: true
  /**
   * Turns after the opening note, oldest first.
   *
   * Absent on a thread nobody has answered, so a note written before this
   * existed reads back exactly as it was stored. Bodies live in the
   * `.simplemark/` sidecar with the rest of the thread and never enter the
   * `.md` (ADR-0011).
   */
  readonly replies?: readonly ThreadMessage[]
}

/** Appends a turn. Pure: the caller persists the result. */
export function appendReply(thread: Thread, message: ThreadMessage): Thread {
  return { ...thread, replies: [...(thread.replies ?? []), message] }
}

/**
 * Every turn in order, the opening note first.
 *
 * One list rather than "body, then replies" at each call site, so no surface
 * can render a conversation that silently omits how it started.
 */
export function threadTurns(thread: Thread): readonly ThreadMessage[] {
  return [
    {
      id: `${thread.id}-open`,
      author: thread.author,
      createdAt: thread.createdAt,
      body: thread.body,
    },
    ...(thread.replies ?? []),
  ]
}

/** True once somebody other than the note's author has answered. */
export function hasAgentTurn(thread: Thread, agentAuthor = 'agent'): boolean {
  return (thread.replies ?? []).some((reply) => reply.author === agentAuthor)
}

/**
 * Resolving closes the thread and nothing else.
 *
 * It deliberately does not write to the document. Any edit the conclusion
 * deserves is one the author makes themselves, with ordinary undo — which is
 * what keeps threads disposable (COLLABORATION.md §1.1).
 */
export function resolveThread(thread: Thread): Thread {
  return { ...thread, state: 'resolved' }
}

/** "Keep as note": stop trying to attach this to any passage, forever. */
export function detachThread(thread: Thread): Thread {
  return { ...thread, anchor: undefined }
}
