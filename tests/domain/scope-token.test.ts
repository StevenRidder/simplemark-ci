import { describe, expect, test } from 'vitest'

import { emptyScopes, grantScope, noteIdFor } from '../../src/domain/index.js'

/**
 * Authority-issued scopes, tested as lookup.
 *
 * An agent receives a token and returns it. It cannot mint one that resolves,
 * and the token itself does not name the note — only the authority record does.
 * A new grant retires the previous token, so one scope at a time is structural
 * (MCP-SERVER.md §6).
 */
describe('grantScope', () => {
  test('issues a token that resolves to the named note', () => {
    const granted = grantScope(emptyScopes(), 'note-welcome')

    expect(granted).toBeDefined()
    expect(noteIdFor(granted!.book, granted!.token)).toBe('note-welcome')
  })

  test('does not put the note id in the token', () => {
    const granted = grantScope(emptyScopes(), 'note-welcome')

    expect(granted!.token.includes('note-welcome')).toBe(false)
  })

  test('refuses an empty note id rather than issuing a token', () => {
    expect(grantScope(emptyScopes(), '')).toBeUndefined()
    expect(grantScope(emptyScopes(), '   ')).toBeUndefined()
  })

  test('a minted token does not resolve', () => {
    const granted = grantScope(emptyScopes(), 'note-welcome')

    expect(noteIdFor(granted!.book, 'i-made-this')).toBeUndefined()
  })

  test('a new grant retires the previous token', () => {
    const first = grantScope(emptyScopes(), 'note-a')!
    const second = grantScope(first.book, 'note-b')!

    expect(noteIdFor(second.book, first.token)).toBeUndefined()
    expect(noteIdFor(second.book, second.token)).toBe('note-b')
  })

  test('a token from one book does not resolve against another', () => {
    const a = grantScope(emptyScopes(), 'note-a')!
    const b = grantScope(emptyScopes(), 'note-a')!

    expect(noteIdFor(b.book, a.token)).toBeUndefined()
  })
})
