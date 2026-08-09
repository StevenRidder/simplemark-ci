import { describe, expect, test } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { addRow, TableMap } from '@milkdown/kit/prose/tables'
import { Transform } from '@milkdown/kit/prose/transform'

import { createAuthorityHarness, type AuthorityHarness } from './harness.js'

const FIXTURE_MARKDOWN = `# Authority

\`\`\`mermaid title=authority
flowchart LR
  A --> B
\`\`\`

$$
E = mc^2
$$

| Name | Value |
| --- | --- |
| authority | two |

Read [[Roadmap|the roadmap]] and =={green}important== details.

> [!NOTE]
> A portable callout.
`

interface TextRange {
  readonly from: number
  readonly to: number
}

interface ParagraphAt {
  readonly node: ProseNode
  readonly pos: number
}

interface TableAt {
  readonly node: ProseNode
  readonly pos: number
}

function stepsJson(transform: Transform): readonly unknown[] {
  return transform.steps.map((step) => step.toJSON())
}

function insertText(doc: ProseNode, position: number, text: string): {
  readonly doc: ProseNode
  readonly stepJson: unknown
} {
  const transform = new Transform(doc).insert(position, doc.type.schema.text(text))
  const step = transform.steps[0]
  if (step === undefined) throw new Error('Expected insertion to create a step')
  return { doc: transform.doc, stepJson: step.toJSON() }
}

function textRange(doc: ProseNode, target: string): TextRange {
  let found: TextRange | undefined
  doc.descendants((node, pos) => {
    if (found !== undefined) return false
    if (!node.isText) return true
    const offset = node.text?.indexOf(target) ?? -1
    if (offset !== -1) found = { from: pos + offset, to: pos + offset + target.length }
    return false
  })
  if (found === undefined) throw new Error(`Could not find ${target} in parsed document`)
  return found
}

function paragraphAt(doc: ProseNode, index: number): ParagraphAt {
  let current = 0
  let found: ParagraphAt | undefined
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph' || found !== undefined) return true
    if (current === index) found = { node, pos }
    current += 1
    return false
  })
  if (found === undefined) throw new Error(`Could not find paragraph ${index}`)
  return found
}

function tableAt(doc: ProseNode): TableAt {
  let found: TableAt | undefined
  doc.descendants((node, pos) => {
    if (found !== undefined) return false
    if (node.type.name !== 'table') return true
    found = { node, pos }
    return false
  })
  if (found === undefined) throw new Error('Could not find table in parsed document')
  return found
}

function replaceText(doc: ProseNode, target: string, replacement: string): readonly unknown[] {
  const range = textRange(doc, target)
  return stepsJson(new Transform(doc).replaceWith(range.from, range.to, doc.type.schema.text(replacement)))
}

function addTableRow(doc: ProseNode): readonly unknown[] {
  const table = tableAt(doc)
  const map = TableMap.get(table.node)
  const firstCell = map.map[0]
  if (firstCell === undefined) throw new Error('Expected parsed table to contain a cell')
  const transform = new Transform(doc)
  addRow(transform as Parameters<typeof addRow>[0], {
    ...map.findCell(firstCell),
    map,
    tableStart: table.pos + 1,
    table: table.node,
  }, map.height)
  return stepsJson(transform)
}

function concurrentTextScenario(harness: AuthorityHarness): {
  readonly base: ProseNode
  readonly local: readonly unknown[]
  readonly committed: readonly unknown[]
} {
  const base = harness.parse('first paragraph\n\nsecond paragraph')
  return {
    base,
    local: replaceText(base, 'first', 'FIRST'),
    committed: replaceText(base, 'second', 'SECOND'),
  }
}

function deletedTargetScenario(harness: AuthorityHarness): {
  readonly base: ProseNode
  readonly local: readonly unknown[]
  readonly committed: readonly unknown[]
} {
  const base = harness.parse('remove target\n\nkeep this paragraph')
  const target = paragraphAt(base, 0)
  return {
    base,
    local: replaceText(base, 'target', 'TARGET'),
    committed: stepsJson(new Transform(base).delete(target.pos, target.pos + target.node.nodeSize)),
  }
}

type StructuralScenario = 'delete' | 'split' | 'join' | 'list' | 'quote' | 'table'

function localStructuralSteps(base: ProseNode, kind: StructuralScenario): readonly unknown[] {
  const transform = new Transform(base)
  const first = paragraphAt(base, 0)

  switch (kind) {
    case 'delete':
      transform.delete(first.pos, first.pos + first.node.nodeSize)
      break
    case 'split':
      transform.split(textRange(base, 'split target').from + 'split'.length)
      break
    case 'join':
      transform.join(first.pos + first.node.nodeSize)
      break
    case 'list': {
      const { bullet_list: bulletList, list_item: listItem } = base.type.schema.nodes
      if (bulletList === undefined || listItem === undefined) throw new Error('Expected GFM list nodes')
      const item = listItem.createChecked(null, first.node)
      transform.replaceWith(first.pos, first.pos + first.node.nodeSize, bulletList.createChecked(null, item))
      break
    }
    case 'quote': {
      const blockquote = base.type.schema.nodes['blockquote']
      if (blockquote === undefined) throw new Error('Expected CommonMark blockquote node')
      transform.replaceWith(first.pos, first.pos + first.node.nodeSize, blockquote.createChecked(null, first.node))
      break
    }
    case 'table':
      return addTableRow(base)
  }

  return stepsJson(transform)
}

async function applyConcurrentStructuralScenario(kind: StructuralScenario): Promise<{
  readonly ok: boolean
  readonly schemaValid: boolean
  readonly tableRows?: number
}> {
  const harness = await createAuthorityHarness()
  try {
    const source = kind === 'table'
      ? '| Name | Value |\n| --- | --- |\n| table target | one |\n\nlater paragraph'
      : kind === 'join'
        ? 'join target\n\nnext paragraph\n\nlater paragraph'
        : `${kind} target\n\nlater paragraph`
    const base = harness.parse(source)
    const result = harness.rebase(base, localStructuralSteps(base, kind), replaceText(base, 'later', 'LATER'))
    const schemaValid = result.ok && result.doc.type.validContent(result.doc.content)
    if (!result.ok || kind !== 'table') {
      return { ok: result.ok, schemaValid }
    }
    return {
      ok: result.ok,
      schemaValid,
      tableRows: tableAt(result.doc).node.childCount,
    }
  } finally {
    await harness.destroy()
  }
}

describe('authority harness', () => {
  test('parses and serializes Mermaid, math, table, wiki link, and highlight without EditorView', async () => {
    const harness = await createAuthorityHarness()
    try {
      const serialized = harness.serialize(harness.parse(FIXTURE_MARKDOWN))

      expect(serialized).toContain('```mermaid')
      expect(serialized).toContain('$$')
      expect(serialized).toContain('[[Roadmap|the roadmap]]')
      expect(serialized).toContain('=={green}important==')
    } finally {
      await harness.destroy()
    }
  })

  test('uses the production underline schema extension', async () => {
    const harness = await createAuthorityHarness()
    try {
      const doc = harness.parse('Keep <u>underlined text</u> portable.')
      let hasUnderline = false
      doc.descendants((node) => {
        if (node.marks.some((mark) => mark.type.name === 'underline')) hasUnderline = true
        return true
      })

      expect(hasUnderline).toBe(true)
      expect(harness.serialize(doc)).toContain('<u>underlined text</u>')
    } finally {
      await harness.destroy()
    }
  })

  test('returns invalid_step rather than throwing for malformed step JSON', async () => {
    const harness = await createAuthorityHarness()
    try {
      const result = harness.apply(harness.parse('# Note'), [{ stepType: 'not-a-step' }])

      expect(result).toMatchObject({ ok: false, kind: 'invalid_step' })
    } finally {
      await harness.destroy()
    }
  })

  test('applies and serializes the production inline-math schema', async () => {
    const harness = await createAuthorityHarness()
    try {
      const result = harness.apply(harness.parse('# Note'), [{
        stepType: 'replace',
        from: 5,
        to: 5,
        slice: { content: [{ type: 'inline_math', attrs: { value: 'x^2' } }] },
      }])

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error(`Expected inline math step to apply, got ${result.kind}`)
      expect(harness.serialize(result.doc)).toContain('$x^2$')
    } finally {
      await harness.destroy()
    }
  })

  test('releases resources when destroy is called more than once', async () => {
    const harness = await createAuthorityHarness()

    await harness.destroy()
    await expect(harness.destroy()).resolves.toBeUndefined()
  })

  test('rebases a non-overlapping local edit over a committed edit', async () => {
    const harness = await createAuthorityHarness()
    try {
      const { base, local, committed } = concurrentTextScenario(harness)
      const result = harness.rebase(base, local, committed)

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error(`Expected rebase to succeed, got ${result.kind}`)
      expect(harness.serialize(result.doc)).toContain('FIRST paragraph')
      expect(harness.serialize(result.doc)).toContain('SECOND paragraph')
    } finally {
      await harness.destroy()
    }
  })

  test('maps each step in a sequential local batch through earlier local steps', async () => {
    const harness = await createAuthorityHarness()
    try {
      const base = harness.parse('abcd')
      const firstLocal = insertText(base, 2, 'X')
      const secondLocal = insertText(firstLocal.doc, 4, 'Y')
      const committed = insertText(base, 4, 'Z')

      const result = harness.rebase(
        base,
        [firstLocal.stepJson, secondLocal.stepJson],
        [committed.stepJson],
      )

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error(`Expected rebase to succeed, got ${result.kind}`)
      expect(result.doc.textContent).toBe('aXbYcZd')
      expect(result.stepsJson).toHaveLength(2)
    } finally {
      await harness.destroy()
    }
  })

  test('orders same-position inserts by committed arrival before the rebased local batch', async () => {
    const harness = await createAuthorityHarness()
    try {
      const base = harness.parse('abcd')
      const local = insertText(base, 3, 'L')
      const committed = insertText(base, 3, 'C')

      const result = harness.rebase(base, [local.stepJson], [committed.stepJson])

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error(`Expected rebase to succeed, got ${result.kind}`)
      expect(result.doc.textContent).toBe('abCLcd')
    } finally {
      await harness.destroy()
    }
  })

  test('rebases a text edit created inside a preceding local structural step', async () => {
    const harness = await createAuthorityHarness()
    try {
      const base = harness.parse('structure target\n\nlater paragraph')
      const first = paragraphAt(base, 0)
      const blockquote = base.type.schema.nodes['blockquote']
      if (blockquote === undefined) throw new Error('Expected CommonMark blockquote node')
      const structural = new Transform(base).replaceWith(
        first.pos,
        first.pos + first.node.nodeSize,
        blockquote.createChecked(null, first.node),
      )
      const text = replaceText(structural.doc, 'target', 'TARGET')
      const committed = replaceText(base, 'later', 'LATER')

      const result = harness.rebase(
        base,
        [...stepsJson(structural), ...text],
        committed,
      )

      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error(`Expected rebase to succeed, got ${result.kind}`)
      expect(harness.serialize(result.doc)).toContain('> structure TARGET')
      expect(result.doc.textContent).toContain('LATER paragraph')
    } finally {
      await harness.destroy()
    }
  })

  test('refuses an overlapping replacement whose original intent was deleted', async () => {
    const harness = await createAuthorityHarness()
    try {
      const base = harness.parse('replace this target')
      const local = replaceText(base, 'this target', 'LOCAL')
      const committed = replaceText(base, 'replace this', 'COMMITTED')

      expect(harness.rebase(base, local, committed)).toEqual({ ok: false, kind: 'rebase_failed' })
    } finally {
      await harness.destroy()
    }
  })

  test('does not expose an accepted prefix when a later local step cannot rebase', async () => {
    const harness = await createAuthorityHarness()
    try {
      const base = harness.parse('remove target\n\nkeep paragraph')
      const firstLocal = insertText(base, textRange(base, 'keep').to, ' SAFE')
      const secondLocal = replaceText(firstLocal.doc, 'target', 'TARGET')
      const removed = paragraphAt(base, 0)
      const committed = stepsJson(
        new Transform(base).delete(removed.pos, removed.pos + removed.node.nodeSize),
      )

      const result = harness.rebase(
        base,
        [firstLocal.stepJson, ...secondLocal],
        committed,
      )

      expect(result).toEqual({ ok: false, kind: 'rebase_failed' })
      expect('doc' in result).toBe(false)
      expect('stepsJson' in result).toBe(false)
    } finally {
      await harness.destroy()
    }
  })

  test('returns rebase_failed when the committed edit deletes the local target', async () => {
    const harness = await createAuthorityHarness()
    try {
      const { base, local, committed } = deletedTargetScenario(harness)
      expect(harness.rebase(base, local, committed)).toMatchObject({ ok: false, kind: 'rebase_failed' })
    } finally {
      await harness.destroy()
    }
  })

  test.each<StructuralScenario>(['delete', 'split', 'join', 'list', 'quote', 'table'])(
    '%s concurrent edits keep the real schema valid',
    async (kind) => {
      const scenario = await applyConcurrentStructuralScenario(kind)
      expect(scenario).toMatchObject({ ok: true, schemaValid: true })
      if (kind === 'table') expect(scenario.tableRows).toBe(3)
    },
  )
})
