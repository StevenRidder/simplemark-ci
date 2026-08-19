/**
 * One live scope, issued by the authority and named for a note.
 *
 * The token is random. The note id lives only in the book the authority
 * holds. An agent can return a token it was given; it cannot mint one that
 * resolves, and it cannot read a note id out of the bytes (MCP-SERVER.md §6).
 *
 * Granting a new scope retires the previous token, so one-scope-at-a-time
 * is a lookup miss rather than a polite request.
 */

export type ScopeToken = string

export interface ScopeBook {
  readonly token?: ScopeToken
  readonly noteId?: string
}

export interface ScopeGrant {
  readonly book: ScopeBook
  readonly token: ScopeToken
}

export function emptyScopes(): ScopeBook {
  return {}
}

export function grantScope(_book: ScopeBook, noteId: string): ScopeGrant | undefined {
  const trimmed = noteId.trim()
  if (trimmed === '') return undefined
  const token = crypto.randomUUID()
  return { book: { token, noteId: trimmed }, token }
}

export function noteIdFor(book: ScopeBook, token: ScopeToken): string | undefined {
  if (book.token === undefined || book.token !== token) return undefined
  return book.noteId
}
