import { describe, expect, test } from 'vitest'

import { describeHiddenDiagramFence, findHiddenDiagramFences } from '../../src/domain/index.js'

const MARKDOWN = ['```', '```mermaid', 'flowchart LR', '  A --> B', '```', ''].join('\n')

describe('describeHiddenDiagramFence', () => {
  test('states the intended and actual structure, and asks for a minimal edit', () => {
    const fence = findHiddenDiagramFences(MARKDOWN)[0]
    if (fence === undefined) throw new Error('expected a detected fence')

    const complaint = describeHiddenDiagramFence(MARKDOWN, fence)

    expect(complaint).toContain('info string "mermaid"')
    expect(complaint).toContain('code block with no info string')
    expect(complaint).toContain('Change as little as possible')
  })

  test('quotes the swallowed source so the model sees what was lost', () => {
    const fence = findHiddenDiagramFences(MARKDOWN)[0]
    if (fence === undefined) throw new Error('expected a detected fence')

    expect(describeHiddenDiagramFence(MARKDOWN, fence)).toContain('flowchart LR')
  })
})
