import { describe, expect, test } from 'vitest'

import { findHiddenDiagramFences } from '../../src/domain/index.js'

describe('findHiddenDiagramFences', () => {
  test('reports a mermaid fence swallowed by a stray info-less fence', () => {
    const markdown = ['```', '```mermaid', 'flowchart LR', '  A --> B', '```', ''].join('\n')

    const found = findHiddenDiagramFences(markdown)

    expect(found).toHaveLength(1)
    expect(found[0]?.language).toBe('mermaid')
    expect(found[0]?.startLine).toBe(1)
    expect(found[0]?.endLine).toBe(5)
  })

  test('leaves a correctly fenced diagram alone', () => {
    const markdown = ['```mermaid', 'flowchart LR', '  A --> B', '```', ''].join('\n')

    expect(findHiddenDiagramFences(markdown)).toEqual([])
  })

  test('leaves a deliberate longer outer fence alone', () => {
    // Wrapping a diagram in a *longer* fence is how you quote mermaid source on
    // purpose. Flagging it would fire on every document that documents Markdown.
    const markdown = ['````', '```mermaid', 'flowchart LR', '```', '````', ''].join('\n')

    expect(findHiddenDiagramFences(markdown)).toEqual([])
  })

  test('matches a longer outer fence only when told the nesting was accidental', () => {
    // Milkdown's serializer rewrites the stray ``` to ````, which is exactly how
    // a deliberate quote looks. Bytes alone cannot separate them — so the
    // relaxed match is opt-in, used only when the paste that produced it is
    // known to have arrived with an equal-length fence.
    const markdown = ['````', '```mermaid', 'flowchart LR', '```', '````', ''].join('\n')

    expect(findHiddenDiagramFences(markdown)).toEqual([])
    expect(findHiddenDiagramFences(markdown, { includeLongerOuterFence: true })).toHaveLength(1)
  })
})
