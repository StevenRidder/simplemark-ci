import { describe, expect, it } from 'vitest'

import { changedParagraphCount, groupDiffTokens } from '../../src/application/index.js'

describe('Compare presentation (ADR-0016)', () => {
  it('groups the editor\'s diff stream into paragraphs and marks the ones that changed', () => {
    const paragraphs = groupDiffTokens([
      { kind: 'same', text: 'Alpha holds the opening claim.\n\nBeta carries the argument that needs ' },
      { kind: 'deleted', text: 'work' },
      { kind: 'inserted', text: 'polish' },
      { kind: 'same', text: '.\n\nGamma closes.' },
    ])
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]).toEqual({ segments: [{ kind: 'same', text: 'Alpha holds the opening claim.' }], changed: false })
    expect(paragraphs[1]!.changed).toBe(true)
    expect(paragraphs[1]!.segments.map((segment) => segment.kind)).toEqual(['same', 'deleted', 'inserted', 'same'])
    expect(paragraphs[1]!.segments[1]).toEqual({ kind: 'deleted', text: 'work' })
    expect(paragraphs[1]!.segments[2]).toEqual({ kind: 'inserted', text: 'polish' })
    expect(paragraphs[2]!.changed).toBe(false)
    expect(changedParagraphCount(paragraphs)).toBe(1)
  })

  it('an inserted paragraph of its own is one changed paragraph', () => {
    const paragraphs = groupDiffTokens([
      { kind: 'same', text: 'First.' },
      { kind: 'inserted', text: '\n\nA whole new paragraph.' },
    ])
    expect(paragraphs.map((paragraph) => paragraph.changed)).toEqual([false, true])
    expect(paragraphs[1]!.segments).toEqual([{ kind: 'inserted', text: 'A whole new paragraph.' }])
  })

  it('identical documents are all unchanged', () => {
    const paragraphs = groupDiffTokens([{ kind: 'same', text: 'One.\n\nTwo.' }])
    expect(changedParagraphCount(paragraphs)).toBe(0)
  })
})
