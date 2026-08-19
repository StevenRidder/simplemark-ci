import { describe, expect, test } from 'vitest'

import { resolveInstructionTarget } from '../../src/application/index.js'

/**
 * The application, not the model, decides which part of the document an
 * instruction is about.
 *
 * A live selection is the scope. Otherwise a quote or paste is located with
 * the text-anchor matcher. Append is only the remainder: nothing in the
 * instruction pointed at content that already exists.
 */
const document = 'alpha Starlink business omega'

describe('resolveInstructionTarget', () => {
  test('a live selection is the scope, even when the instruction quotes elsewhere', () => {
    expect(
      resolveInstructionTarget({
        document,
        selection: { from: 0, to: 5 },
        instruction: 'rewrite "Starlink business"',
      }),
    ).toEqual({ kind: 'selection', from: 0, to: 5 })
  })

  test('a unique quoted passage scopes to that occurrence', () => {
    expect(
      resolveInstructionTarget({
        document,
        instruction: 'tighten "Starlink business"',
      }),
    ).toEqual({ kind: 'passage', offset: 6, quote: 'Starlink business' })
  })

  test('pasted text with surrounding whitespace still matches', () => {
    expect(
      resolveInstructionTarget({
        document,
        instruction: '  \nStarlink business  ',
      }),
    ).toEqual({ kind: 'passage', offset: 6, quote: 'Starlink business' })
  })

  test('an unfound quote asks rather than appending', () => {
    expect(
      resolveInstructionTarget({
        document,
        instruction: 'fix "not in this document"',
      }),
    ).toEqual({ kind: 'ask', reason: 'missing', quote: 'not in this document' })
  })

  test('an ambiguous quote asks which, and never picks one', () => {
    expect(
      resolveInstructionTarget({
        document: 'x TARGET y ... x TARGET y',
        instruction: 'edit "TARGET"',
      }),
    ).toEqual({ kind: 'ask', reason: 'ambiguous', quote: 'TARGET' })
  })

  test('append only when nothing points at existing content', () => {
    expect(
      resolveInstructionTarget({
        document,
        instruction: 'add a conclusion',
      }),
    ).toEqual({ kind: 'append' })
  })

  test('a caret with nothing selected is not a live selection', () => {
    expect(
      resolveInstructionTarget({
        document,
        selection: { from: 3, to: 3 },
        instruction: 'add a conclusion',
      }),
    ).toEqual({ kind: 'append' })
  })

  test('a paste that contains quotes matches the whole paste, not the inner span', () => {
    const quoted = 'He said "go now" and left'
    expect(
      resolveInstructionTarget({
        document: quoted,
        instruction: `  ${quoted}  `,
      }),
    ).toEqual({ kind: 'passage', offset: 0, quote: quoted })
  })
})
