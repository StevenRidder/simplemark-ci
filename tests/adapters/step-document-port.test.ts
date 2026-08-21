import { afterEach, describe, expect, it } from 'vitest'

import type { StepDocumentAdapter } from '../../src/adapters/editor/step-document-port.js'
import { createStepDocumentPort } from '../../src/adapters/editor/step-document-port.js'

let adapter: StepDocumentAdapter | undefined

afterEach(async () => {
  await adapter?.destroy()
  adapter = undefined
})

async function port() {
  adapter = await createStepDocumentPort()
  return adapter.port
}

describe('step document port', () => {
  it('replaces only the requested document range with structural Markdown steps', async () => {
    const document = 'first paragraph\n\nsecond paragraph'
    const stepPort = await port()
    const steps = stepPort.markdownToSteps(document, 'FIRST paragraph', { from: 0, to: 17 })

    expect(steps).toMatchObject({ ok: true })
    if (!steps.ok) throw new Error(`Expected Markdown conversion to succeed, got ${steps.kind}`)

    const result = stepPort.applySteps(document, steps.steps)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(`Expected structural replacement to apply, got ${result.kind}`)
    expect(result.markdown).toBe('FIRST paragraph\n\nsecond paragraph\n')
  })

  it('appends parsed Markdown without changing existing blocks', async () => {
    const document = 'first paragraph\n\nsecond paragraph'
    const stepPort = await port()
    const steps = stepPort.markdownToSteps(document, 'third paragraph')

    expect(steps).toMatchObject({ ok: true })
    if (!steps.ok) throw new Error(`Expected Markdown conversion to succeed, got ${steps.kind}`)

    const result = stepPort.applySteps(document, steps.steps)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(`Expected append to apply, got ${result.kind}`)
    expect(result.markdown).toBe('first paragraph\n\nsecond paragraph\n\nthird paragraph\n')
  })

  it('rebases non-overlapping batches over committed changes', async () => {
    const document = 'first paragraph\n\nsecond paragraph'
    const stepPort = await port()
    const local = stepPort.markdownToSteps(document, 'FIRST paragraph', { from: 0, to: 17 })
    const committed = stepPort.markdownToSteps(document, 'SECOND paragraph', { from: 17, to: 35 })

    expect(local).toMatchObject({ ok: true })
    expect(committed).toMatchObject({ ok: true })
    if (!local.ok || !committed.ok) throw new Error('Expected both structural batches to be created')

    const result = stepPort.rebaseSteps(document, local.steps, [committed.steps])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(`Expected rebase to succeed, got ${result.kind}`)
    expect(result.markdown).toBe('FIRST paragraph\n\nSECOND paragraph\n')
  })

  it('rebases every step in a sequential local batch', async () => {
    const document = 'first paragraph\n\nmiddle paragraph\n\nlast paragraph'
    const stepPort = await port()
    const firstLocal = stepPort.markdownToSteps(document, 'first', { from: 0, to: 17 })

    expect(firstLocal).toMatchObject({ ok: true })
    if (!firstLocal.ok) throw new Error(`Expected first local step, got ${firstLocal.kind}`)
    const locallyChanged = stepPort.applySteps(document, firstLocal.steps)
    expect(locallyChanged).toMatchObject({ ok: true })
    if (!locallyChanged.ok) throw new Error(`Expected first local step to apply, got ${locallyChanged.kind}`)

    const secondLocal = stepPort.markdownToSteps(locallyChanged.markdown, 'LAST', { from: 25, to: 41 })
    const committed = stepPort.markdownToSteps(document, 'MIDDLE paragraph expanded', { from: 17, to: 35 })

    expect(secondLocal).toMatchObject({ ok: true })
    expect(committed).toMatchObject({ ok: true })
    if (!secondLocal.ok || !committed.ok) throw new Error('Expected remaining batches to be created')

    const result = stepPort.rebaseSteps(document, [...firstLocal.steps, ...secondLocal.steps], [committed.steps])

    expect(result).toEqual({
      ok: true,
      markdown: 'first\n\nMIDDLE paragraph expanded\n\nLAST\n',
      steps: expect.any(Array),
    })
  })

  it('fails closed when a committed batch deletes the local target', async () => {
    const document = 'remove target\n\nkeep this paragraph'
    const stepPort = await port()
    const local = stepPort.markdownToSteps(document, 'TARGET', { from: 8, to: 14 })
    const committed = stepPort.markdownToSteps(document, '', { from: 0, to: 15 })

    expect(local).toMatchObject({ ok: true })
    expect(committed).toMatchObject({ ok: true })
    if (!local.ok || !committed.ok) throw new Error('Expected both structural batches to be created')

    expect(stepPort.rebaseSteps(document, local.steps, [committed.steps]))
      .toEqual({ ok: false, kind: 'rebase_failed' })
  })

  it('returns inverse steps that restore the original document', async () => {
    const document = 'first paragraph\n\nsecond paragraph'
    const stepPort = await port()
    const baseline = stepPort.applySteps(document, [])
    const steps = stepPort.markdownToSteps(document, 'FIRST paragraph', { from: 0, to: 17 })

    expect(baseline).toMatchObject({ ok: true })
    expect(steps).toMatchObject({ ok: true })
    if (!baseline.ok || !steps.ok) throw new Error('Expected a valid baseline and structural replacement')

    const changed = stepPort.applySteps(document, steps.steps)
    const inverse = stepPort.invertSteps(document, steps.steps)

    expect(changed).toMatchObject({ ok: true })
    expect(inverse).not.toBeNull()
    if (!changed.ok || inverse === null) throw new Error('Expected an invertible structural replacement')

    const restored = stepPort.applySteps(changed.markdown, inverse)

    expect(restored).toMatchObject({ ok: true })
    if (!restored.ok) throw new Error(`Expected inverse to apply, got ${restored.kind}`)
    expect(restored.markdown).toBe(baseline.markdown)
  })

  it('returns invalid_step instead of throwing for malformed step JSON', async () => {
    const stepPort = await port()

    expect(stepPort.applySteps('# Note', [{ stepType: 'not-a-step' }]))
      .toEqual({ ok: false, kind: 'invalid_step' })
  })

  it('applies structural steps using the editor underline schema', async () => {
    const stepPort = await port()
    const underlineStep = {
      stepType: 'replace',
      from: 5,
      to: 5,
      slice: {
        content: [{
          type: 'text',
          text: ' underlined',
          marks: [{ type: 'underline' }],
        }],
      },
    }

    const result = stepPort.applySteps('# Note', [underlineStep])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(`Expected underline step to apply, got ${result.kind}`)
    expect(result.markdown).toBe('# Note <u>underlined</u>\n')
  })

  it('distinguishes a schema-invalid step from malformed step JSON', async () => {
    const stepPort = await port()
    const schemaInvalidStep = {
      stepType: 'replace',
      from: 2,
      to: 2,
      slice: {
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'not allowed inside a heading' }],
        }],
      },
    }

    expect(stepPort.applySteps('# Note', [schemaInvalidStep]))
      .toEqual({ ok: false, kind: 'invalid_schema' })
  })

  it('cleans up after Milkdown clock timers have finished', async () => {
    const disposable = await createStepDocumentPort()

    expect(disposable.port.applySteps('# Note', [])).toMatchObject({ ok: true })
    await disposable.destroy()
    await new Promise<void>((resolve) => setTimeout(resolve, 3_100))
  })
})

/**
 * BUG-23. The live editor strips closed front matter before parsing, so the
 * positions it hands this port count from the first body node. Parsing the
 * whole file put the front matter into the document ahead of the body: a
 * positioned agent edit on an annotated note landed inside the `id:` line and
 * the serialized result carried a second, torn copy of the front matter as
 * body. Every method that takes Markdown has to work in the editor's space.
 */
describe('front matter stays front matter (BUG-23)', () => {
  const MATTER = '---\nid: abc\ncomments: .simplemark/abc.json\n---\n\n'
  const BODY = '# Tiny probe\n\nOne paragraph. Nothing else.\n'
  const DOCUMENT = MATTER + BODY
  // Just after the heading node in the editor's document — which has no front matter in it.
  const AFTER_HEADING = 12

  it('inserts at an editor position and keeps the front matter once, as front matter', async () => {
    const stepPort = await port()
    const steps = stepPort.markdownToSteps(DOCUMENT, 'Inserted.', { from: AFTER_HEADING, to: AFTER_HEADING })
    expect(steps).toMatchObject({ ok: true })
    if (!steps.ok) throw new Error(steps.kind)
    const result = stepPort.applySteps(DOCUMENT, steps.steps)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.kind)
    expect(result.markdown).toBe(`${MATTER}# Tiny probe\n\nInserted.\n\nOne paragraph. Nothing else.\n`)
  })

  it('replaces the whole body without touching the front matter', async () => {
    const stepPort = await port()
    const steps = stepPort.replaceAllSteps(DOCUMENT, 'New body.')
    expect(steps).toMatchObject({ ok: true })
    if (!steps.ok) throw new Error(steps.kind)
    const result = stepPort.applySteps(DOCUMENT, steps.steps)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.kind)
    expect(result.markdown).toBe(`${MATTER}New body.\n`)
  })

  it('inverts and reverts in the same space, front matter intact both ways', async () => {
    const stepPort = await port()
    const steps = stepPort.markdownToSteps(DOCUMENT, 'Inserted.', { from: AFTER_HEADING, to: AFTER_HEADING })
    if (!steps.ok) throw new Error(steps.kind)
    const applied = stepPort.applySteps(DOCUMENT, steps.steps)
    if (!applied.ok) throw new Error(applied.kind)
    const inverse = stepPort.invertSteps(DOCUMENT, steps.steps)
    expect(inverse).not.toBeNull()
    const reverted = stepPort.revertSteps(applied.markdown, inverse!, [])
    expect(reverted).toMatchObject({ ok: true })
    if (!reverted.ok) throw new Error(reverted.kind)
    expect(reverted.markdown).toBe(DOCUMENT)
  })

  it('rebases a body-positioned batch over a committed one and keeps one front matter', async () => {
    const stepPort = await port()
    const mine = stepPort.markdownToSteps(DOCUMENT, 'Mine.', { from: AFTER_HEADING, to: AFTER_HEADING })
    const theirs = stepPort.markdownToSteps(DOCUMENT, 'Theirs.', { from: AFTER_HEADING, to: AFTER_HEADING })
    if (!mine.ok || !theirs.ok) throw new Error('conversion failed')
    const rebased = stepPort.rebaseSteps(DOCUMENT, mine.steps, [theirs.steps])
    expect(rebased).toMatchObject({ ok: true })
    if (!rebased.ok) throw new Error(rebased.kind)
    expect(rebased.markdown.startsWith(MATTER)).toBe(true)
    expect(rebased.markdown.slice(MATTER.length)).not.toContain('---')
    expect(rebased.markdown).toContain('Mine.')
    expect(rebased.markdown).toContain('Theirs.')
    expect(rebased.markdown).toContain('One paragraph. Nothing else.')
  })
})

/** ADR-0016: the port's diff answers with the words that changed, not the paragraphs around them. */
describe('diffMarkdown (prosemirror-changeset)', () => {
  it('a one-word change yields that word deleted and the new word inserted, with the rest kept', async () => {
    const stepPort = await port()
    const tokens = stepPort.diffMarkdown(
      'Alpha holds the opening claim.\n\nBeta carries the argument that needs work.\n',
      'Alpha holds the opening claim.\n\nBeta carries the argument that needs polish.\n',
    )
    expect(tokens.map((token) => token.kind)).toEqual(['same', 'deleted', 'inserted', 'same'])
    expect(tokens[1]).toEqual({ kind: 'deleted', text: 'work' })
    expect(tokens[2]).toEqual({ kind: 'inserted', text: 'polish' })
    expect(tokens[0]!.text).toContain('Alpha holds the opening claim.\n\nBeta carries')
  })

  it('front matter is not part of the comparison', async () => {
    const stepPort = await port()
    const tokens = stepPort.diffMarkdown('---\nid: abc\n---\n\nOne.\n', '---\nid: abc\n---\n\nOne.\n')
    expect(tokens).toEqual([{ kind: 'same', text: 'One.' }])
  })

  it('an added paragraph is one inserted token', async () => {
    const stepPort = await port()
    const tokens = stepPort.diffMarkdown('One.\n', 'One.\n\nTwo.\n')
    expect(tokens.filter((token) => token.kind === 'inserted').map((token) => token.text.trim())).toEqual(['Two.'])
    expect(tokens.some((token) => token.kind === 'deleted')).toBe(false)
  })
})

/** BUG-28: a multi-block rewrite of a bullet's passage lands instead of refusing. */
describe('a multi-block replacement inside a list item (BUG-28)', () => {
  it('widens to the enclosing list item so a heading and paragraphs can land', async () => {
    const stepPort = await port()
    const document = '# Evaluation\n\n- Finding first: the agent receives every signal.\n- Second bullet stays.\n'
    // Positions inside the first bullet's paragraph text.
    const from = 16
    const to = from + 'Finding first'.length
    const steps = stepPort.markdownToSteps(document, '## What happened\n\nDecision: do not promote.\n\nIt closes more leaks.', { from, to })
    expect(steps).toMatchObject({ ok: true })
    if (!steps.ok) throw new Error(steps.kind)
    const result = stepPort.applySteps(document, steps.steps)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.kind)
    expect(result.markdown).toContain('What happened')
    expect(result.markdown).toContain('Decision: do not promote.')
    expect(result.markdown).toContain('Second bullet stays.')
    expect(result.markdown).not.toContain('Finding first')
  })
})

/** BUG-28: a replacement that carries a list must survive the JSON seam. */
describe('list attributes across the step JSON seam (BUG-28)', () => {
  it('a replacement containing a bullet list applies instead of failing validation', async () => {
    const stepPort = await port()
    const document = '# Evaluation\n\n- Finding first.\n- Second bullet stays.\n\nClosing paragraph.\n'
    const steps = stepPort.markdownToSteps(document, '- Finding first, rewritten.\n- And a new one.\n', { from: 15, to: 15 + 'Finding first.'.length })
    expect(steps).toMatchObject({ ok: true })
    if (!steps.ok) throw new Error(steps.kind)
    const result = stepPort.applySteps(document, steps.steps)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.kind)
    expect(result.markdown).toContain('Finding first, rewritten.')
    expect(result.markdown).toContain('And a new one.')
    expect(result.markdown).toContain('Second bullet stays.')
  })

  it('an appended list applies', async () => {
    const stepPort = await port()
    const document = 'Intro.\n'
    const steps = stepPort.markdownToSteps(document, '1. one\n2. two\n')
    if (!steps.ok) throw new Error(steps.kind)
    const result = stepPort.applySteps(document, steps.steps)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.kind)
    expect(result.markdown).toContain('1. one')
  })
})
