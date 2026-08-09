import { describe, expect, test } from 'vitest'

import { applyHiddenDiagramFix, findHiddenDiagramFences } from '../../src/domain/index.js'

const BROKEN = [
  '# Notes',
  '',
  '```',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
  '',
  'Trailing prose.',
  '',
].join('\n')

function fenceIn(markdown: string) {
  const fence = findHiddenDiagramFences(markdown)[0]
  if (fence === undefined) throw new Error('expected a detected fence')
  return fence
}

describe('applyHiddenDiagramFix', () => {
  test('replaces only the flagged span, leaving the rest byte-identical', () => {
    const corrected = ['```mermaid', 'flowchart LR', '  A --> B', '```'].join('\n')

    const result = applyHiddenDiagramFix(BROKEN, fenceIn(BROKEN), corrected)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toBe(
      ['# Notes', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', 'Trailing prose.', ''].join('\n'),
    )
  })

  test('rejects a correction that still hides the diagram', () => {
    // The model may return the span unchanged. Verify rather than trust, the way
    // the diagram fix loop re-renders instead of believing the reply.
    const unchanged = ['```', '```mermaid', 'flowchart LR', '  A --> B', '```'].join('\n')

    const result = applyHiddenDiagramFix(BROKEN, fenceIn(BROKEN), unchanged)

    expect(result).toEqual({
      ok: false,
      message: 'The correction still does not parse as a mermaid diagram.',
    })
  })

  test('rejects a correction that drops the diagram body', () => {
    const gutted = ['```mermaid', '```'].join('\n')

    const result = applyHiddenDiagramFix(BROKEN, fenceIn(BROKEN), gutted)

    expect(result.ok).toBe(false)
  })
})
