import type { Anchor } from './anchor.js'

/**
 * One note about one passage.
 *
 * `author` is always `'local'` and nothing displays it. It exists so that a
 * later multi-party version does not require migrating every stored thread —
 * the cheap half of not foreclosing that, where the expensive half (identity,
 * permissions, merge) is deliberately absent.
 */
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
