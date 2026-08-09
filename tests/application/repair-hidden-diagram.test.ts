import { describe, expect, test } from 'vitest'

import { repairHiddenDiagram } from '../../src/application/index.js'
import type { DiagramFixPort, DiagramFixResult } from '../../src/application/index.js'

const BROKEN = ['```', '```mermaid', 'flowchart LR', '  A --> B', '```', ''].join('\n')
const GOOD = ['```mermaid', 'flowchart LR', '  A --> B', '```'].join('\n')

function portReturning(...replies: readonly DiagramFixResult[]): DiagramFixPort & { calls: string[] } {
  const calls: string[] = []
  let index = 0
  return {
    calls,
    isConfigured: () => true,
    fix: async () => ({ ok: false, message: 'unused' }),
    fixMarkdown: async (complaint: string) => {
      calls.push(complaint)
      return replies[Math.min(index++, replies.length - 1)] ?? { ok: false, message: 'exhausted' }
    },
  }
}

describe('repairHiddenDiagram', () => {
  test('returns the repaired document when the model corrects the span', async () => {
    const port = portReturning({ ok: true, source: GOOD })

    const result = await repairHiddenDiagram(BROKEN, port)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toBe([GOOD, ''].join('\n'))
  })

  test('retries when the correction still hides the diagram', async () => {
    const port = portReturning({ ok: true, source: BROKEN }, { ok: true, source: GOOD })

    const result = await repairHiddenDiagram(BROKEN, port)

    expect(result.ok).toBe(true)
    expect(port.calls).toHaveLength(2)
  })

  test('stops immediately on a transport failure rather than spending attempts', async () => {
    const port = portReturning({ ok: false, message: 'Unauthorized' })

    const result = await repairHiddenDiagram(BROKEN, port)

    expect(result).toEqual({ ok: false, message: 'Unauthorized' })
    expect(port.calls).toHaveLength(1)
  })

  test('reports nothing to do when the document has no hidden diagram', async () => {
    const port = portReturning({ ok: true, source: GOOD })

    const result = await repairHiddenDiagram(GOOD, port)

    expect(result).toEqual({ ok: false, message: 'No hidden diagram fence to fix.' })
    expect(port.calls).toHaveLength(0)
  })
})
