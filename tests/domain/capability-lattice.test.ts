import { describe, expect, test } from 'vitest'

import { mayIssueGrant, mayWrite, mayWriteAtCall } from '../../src/domain/index.js'

/**
 * The capability lattice, tested as rank.
 *
 * Only owner and editor may write. A grant is strictly narrower than the
 * granter, checked when issued and again on every call because the inviter
 * may have been demoted since (MCP-SERVER.md §3.1, COLLABORATION.md §3.3).
 */
describe('mayWrite', () => {
  test('allows owner and editor', () => {
    expect(mayWrite('owner')).toBe(true)
    expect(mayWrite('editor')).toBe(true)
  })

  test('refuses commenter and reader, so a commenter is proposal-only', () => {
    expect(mayWrite('commenter')).toBe(false)
    expect(mayWrite('reader')).toBe(false)
  })
})

describe('mayIssueGrant', () => {
  test('an owner may grant editor, commenter, or reader', () => {
    expect(mayIssueGrant('owner', 'editor')).toBe(true)
    expect(mayIssueGrant('owner', 'commenter')).toBe(true)
    expect(mayIssueGrant('owner', 'reader')).toBe(true)
  })

  test('an editor may grant commenter or reader, never editor or owner', () => {
    expect(mayIssueGrant('editor', 'commenter')).toBe(true)
    expect(mayIssueGrant('editor', 'reader')).toBe(true)
    expect(mayIssueGrant('editor', 'editor')).toBe(false)
    expect(mayIssueGrant('editor', 'owner')).toBe(false)
  })

  test('a commenter may grant reader only', () => {
    expect(mayIssueGrant('commenter', 'reader')).toBe(true)
    expect(mayIssueGrant('commenter', 'commenter')).toBe(false)
    expect(mayIssueGrant('commenter', 'editor')).toBe(false)
  })

  test('a reader cannot grant', () => {
    expect(mayIssueGrant('reader', 'reader')).toBe(false)
    expect(mayIssueGrant('reader', 'commenter')).toBe(false)
  })

  test('nobody can grant owner', () => {
    expect(mayIssueGrant('owner', 'owner')).toBe(false)
  })
})

describe('mayWriteAtCall', () => {
  test('an editor agent invited by an owner may write', () => {
    expect(mayWriteAtCall('editor', 'owner')).toBe(true)
  })

  test('a commenter agent cannot write even when the inviter still outranks it', () => {
    expect(mayWriteAtCall('commenter', 'owner')).toBe(false)
  })

  test('refuses a write after the inviter is demoted to the agent rank', () => {
    expect(mayWriteAtCall('editor', 'editor')).toBe(false)
  })

  test('refuses a write after the inviter is demoted below the agent', () => {
    expect(mayWriteAtCall('editor', 'commenter')).toBe(false)
  })
})
