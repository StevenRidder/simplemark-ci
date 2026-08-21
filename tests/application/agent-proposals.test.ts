import { describe, expect, test } from 'vitest'

import { ProposalQueue, locateProposal, virtualMarkdown } from '../../src/application/index.js'

/**
 * ADR-0013. The model is pure and the rules are the product: a proposal is
 * relocated by text, never by a remembered position; ambiguity refuses; an
 * append lands at the end with a blank line before it.
 */

const replace = (quote: string, markdown: string, offset = -1) =>
  ({ name: 'n', actorId: 'agent', kind: 'replace' as const, quote, offset, markdown })

describe('locateProposal', () => {
  test('prefers the remembered offset while the quote is still there', () => {
    const text = 'alpha beta alpha'
    expect(locateProposal(text, replace('alpha', 'x', 11))).toEqual({ offset: 11, length: 5 })
  })

  test('falls back to a unique occurrence when the remembered offset moved', () => {
    const text = 'intro. beta carries the point.'
    expect(locateProposal(text, replace('beta carries', 'x', 0))).toEqual({ offset: 7, length: 12 })
  })

  test('refuses an ambiguous quote rather than guessing', () => {
    expect(locateProposal('same same', replace('same', 'x'))).toBeUndefined()
  })

  test('refuses a quote that is gone', () => {
    expect(locateProposal('nothing here', replace('vanished', 'x'))).toBeUndefined()
  })

  test('an append is always the end of the text', () => {
    const append = { name: 'n', actorId: 'agent', kind: 'append' as const, quote: '', offset: -1, markdown: 'tail' }
    expect(locateProposal('body', append)).toEqual({ offset: 4, length: 0 })
  })
})

describe('virtualMarkdown', () => {
  test('shows the note as it would read with proposals applied', () => {
    const out = virtualMarkdown('one two three', [replace('two', 'TWO')])
    expect(out).toBe('one TWO three')
  })

  test('an append gets its own paragraph', () => {
    expect(virtualMarkdown('body', [{ name: 'n', actorId: 'agent', kind: 'append', quote: '', offset: -1, markdown: 'tail' }]))
      .toBe('body\n\ntail')
  })

  test('a proposal that cannot be placed is left out, not guessed', () => {
    expect(virtualMarkdown('same same', [replace('same', 'X')])).toBe('same same')
  })
})

describe('ProposalQueue', () => {
  test('hands out stable ids and forgets on remove and clear', () => {
    const queue = new ProposalQueue()
    const first = queue.add(replace('a', 'A'))
    const second = queue.add(replace('b', 'B'))
    expect(first.id).not.toBe(second.id)
    expect(queue.size).toBe(2)
    expect(queue.remove(first.id)?.quote).toBe('a')
    expect(queue.list().map((p) => p.id)).toEqual([second.id])
    expect(queue.clear().length).toBe(1)
    expect(queue.size).toBe(0)
  })
})
