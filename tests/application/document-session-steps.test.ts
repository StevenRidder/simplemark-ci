import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  createStepDocumentPort,
  type StepDocumentAdapter,
} from '../../src/adapters/editor/step-document-port.js'
import { DocumentSession } from '../../src/application/index.js'
import type { FilePort, OpenedDocument, StepBatch } from '../../src/application/index.js'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

function filePort(markdown: string): FilePort {
  return {
    async open(): Promise<OpenedDocument> {
      return { handle: 'fixture:steps', name: 'steps.md', bytes: encode(markdown) }
    },
    async save(): Promise<void> {
      throw new Error('This integration test does not save')
    },
  }
}

describe('DocumentSession with the real step adapter', () => {
  let adapter: StepDocumentAdapter

  beforeAll(async () => {
    adapter = await createStepDocumentPort()
  })

  afterAll(async () => {
    await adapter.destroy()
  })

  function markdownSteps(
    markdown: string,
    replacement: string,
    range: { readonly from: number; readonly to: number },
  ): StepBatch {
    const result = adapter.port.markdownToSteps(markdown, replacement, range)
    if (!result.ok) throw new Error(`Expected Markdown conversion to succeed, got ${result.kind}`)
    return result.steps
  }

  test('lands non-overlapping stale steps after rebasing them onto the current document', async () => {
    const markdown = 'first paragraph\n\nsecond paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const local = markdownSteps(markdown, 'FIRST paragraph', { from: 0, to: 17 })
    const committed = markdownSteps(markdown, 'SECOND paragraph', { from: 17, to: 35 })

    expect(session.applySteps({
      actorId: 'human',
      name: 'Edit second paragraph',
      baseVersion: 0,
      steps: committed,
    })).toMatchObject({ ok: true, revision: 1, rebased: false })

    expect(session.applySteps({
      actorId: 'agent',
      name: 'Edit first paragraph',
      baseVersion: 0,
      steps: local,
    })).toMatchObject({ ok: true, revision: 2, rebased: true })
    expect(session.snapshot()).toEqual({
      revision: 2,
      markdown: 'FIRST paragraph\n\nSECOND paragraph\n',
      dirty: true,
    })
  })

  test('reports rebase_failed when an accepted deletion destroyed the stale target', async () => {
    const markdown = 'remove target\n\nkeep this paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const stale = markdownSteps(markdown, 'TARGET', { from: 8, to: 14 })
    const deletion = markdownSteps(markdown, '', { from: 0, to: 15 })

    expect(session.applySteps({
      actorId: 'human',
      name: 'Delete target',
      baseVersion: 0,
      steps: deletion,
    })).toMatchObject({ ok: true, revision: 1, rebased: false })
    const accepted = session.snapshot()

    expect(session.applySteps({
      actorId: 'agent',
      name: 'Edit deleted target',
      baseVersion: 0,
      steps: stale,
    })).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual(accepted)
  })

  test('reverting the most recent agent transaction restores the document', async () => {
    const markdown = 'first paragraph\n\nsecond paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const baseline = adapter.port.applySteps(markdown, [])
    if (!baseline.ok) throw new Error('Expected an empty baseline apply to succeed')
    const replacement = markdownSteps(markdown, 'FIRST paragraph', { from: 0, to: 17 })

    const applied = session.applySteps({
      actorId: 'agent',
      name: 'Edit first paragraph',
      baseVersion: 0,
      steps: replacement,
    })
    expect(applied).toMatchObject({ ok: true, revision: 1 })
    if (!applied.ok) throw new Error('Expected the agent write to commit')

    expect(session.revert(String(applied.revision))).toEqual({ ok: true, revision: 2 })
    expect(session.snapshot()).toEqual({
      revision: 2,
      markdown: baseline.markdown,
      dirty: true,
    })
  })

  test('reverting an older agent transaction keeps a later non-overlapping edit', async () => {
    const markdown = 'first paragraph\n\nsecond paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const agent = markdownSteps(markdown, 'FIRST paragraph', { from: 0, to: 17 })
    const later = markdownSteps(markdown, 'SECOND paragraph', { from: 17, to: 35 })

    const first = session.applySteps({
      actorId: 'agent',
      name: 'Edit first paragraph',
      baseVersion: 0,
      steps: agent,
    })
    expect(session.applySteps({
      actorId: 'human',
      name: 'Edit second paragraph',
      baseVersion: 0,
      steps: later,
    })).toMatchObject({ ok: true, revision: 2, rebased: true })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the agent write to commit')

    expect(session.revert(String(first.revision))).toEqual({ ok: true, revision: 3 })
    expect(session.snapshot().markdown).toBe('first paragraph\n\nSECOND paragraph\n')
    expect(session.snapshot().revision).toBe(3)
  })

  test('reverting an older agent write maps the inverse over a later prefix insert', async () => {
    const markdown = 'first paragraph\n\nsecond paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const agent = markdownSteps(markdown, 'FIRST paragraph', { from: 0, to: 17 })
    const first = session.applySteps({
      actorId: 'agent',
      name: 'Edit first paragraph',
      baseVersion: 0,
      steps: agent,
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the agent write to commit')
    const afterAgent = session.snapshot().markdown
    const prefix = markdownSteps(afterAgent, 'INTRO', { from: 0, to: 0 })
    expect(session.applySteps({
      actorId: 'human',
      name: 'Insert prefix',
      baseVersion: first.revision,
      steps: prefix,
    })).toMatchObject({ ok: true, revision: 2 })

    expect(session.revert(String(first.revision))).toEqual({ ok: true, revision: 3 })
    expect(session.snapshot().markdown).toContain('INTRO')
    expect(session.snapshot().markdown).toContain('first paragraph')
    expect(session.snapshot().markdown).not.toContain('FIRST paragraph')
  })

  test('reverting past a live editor batch keeps what that batch added (BUG-9)', async () => {
    const markdown = 'first paragraph\n\nsecond paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const agent = markdownSteps(markdown, 'FIRST paragraph', { from: 0, to: 17 })
    const first = session.applySteps({
      actorId: 'agent',
      name: 'Edit first paragraph',
      baseVersion: 0,
      steps: agent,
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the agent write to commit')

    // The live editor appends a paragraph and the batch is stored as the
    // editor's own step JSON — here with coordinates only the live document
    // has (a restored deferred table makes it larger than the headless parse).
    // Replaying this batch is impossible; its positional map is still exact.
    expect(session.acceptEditorSteps({
      actorId: 'human',
      name: 'Typing',
      baseVersion: first.revision,
      steps: [{
        stepType: 'replace',
        from: 500,
        to: 500,
        slice: { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mine.' }] }] },
      }],
      markdown: 'FIRST paragraph\n\nsecond paragraph\n\nMine.\n',
    })).toMatchObject({ ok: true, revision: 2 })

    expect(session.revert(String(first.revision))).toEqual({ ok: true, revision: 3 })
    const after = session.snapshot().markdown
    expect(after).toContain('first paragraph')
    expect(after).not.toContain('FIRST paragraph')
    // The paragraph the reader typed in between is exactly what BUG-9 lost.
    expect(after).toContain('Mine.')
  })

  test('reverting past an Enter-split at the end of the agent paragraph keeps the typed paragraph (BUG-9)', async () => {
    // Captured from a live Chromium editor session, verbatim — including the
    // non-breaking spaces WebKit types before replacing them. Pressing Enter at
    // the end of the agent's paragraph SPLITS the agent's node, so the typed
    // paragraph lives positionally inside the span the agent's inverse
    // replaces. A plainly-mapped inverse expands over it and eats it; the
    // revert must exclude what later batches inserted into the span.
    const markdown = '# New note\n\nAlpha holds the opening claim.\n\nBeta carries the argument that needs work.'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const first = session.applyMarkdown({
      actorId: 'agent',
      name: 'Split this by region.',
      baseVersion: 0,
      markdown: 'Beta, split by region.',
      range: { from: 43, to: 85 },
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the agent write to commit')

    const nbsp = '\u00A0'
    const typedAtEnd: StepBatch = [
      { stepType: 'replace', from: 65, to: 65, slice: { content: [{ type: 'paragraph' }, { type: 'paragraph' }], openStart: 1, openEnd: 1 }, structure: true },
      { stepType: 'replace', from: 67, to: 67, slice: { content: [{ type: 'text', text: 'A' }] } },
      { stepType: 'replace', from: 68, to: 68, slice: { content: [{ type: 'text', text: nbsp }] } },
      { stepType: 'replace', from: 68, to: 69, slice: { content: [{ type: 'text', text: ' p' }] } },
      { stepType: 'replace', from: 70, to: 70, slice: { content: [{ type: 'text', text: 'a' }] } },
      { stepType: 'replace', from: 71, to: 71, slice: { content: [{ type: 'text', text: 'r' }] } },
      { stepType: 'replace', from: 72, to: 72, slice: { content: [{ type: 'text', text: 'a' }] } },
      { stepType: 'replace', from: 73, to: 73, slice: { content: [{ type: 'text', text: 'g' }] } },
      { stepType: 'replace', from: 74, to: 74, slice: { content: [{ type: 'text', text: 'r' }] } },
      { stepType: 'replace', from: 75, to: 75, slice: { content: [{ type: 'text', text: 'a' }] } },
      { stepType: 'replace', from: 76, to: 76, slice: { content: [{ type: 'text', text: 'p' }] } },
      { stepType: 'replace', from: 77, to: 77, slice: { content: [{ type: 'text', text: 'h' }] } },
      { stepType: 'replace', from: 78, to: 78, slice: { content: [{ type: 'text', text: nbsp }] } },
      { stepType: 'replace', from: 78, to: 79, slice: { content: [{ type: 'text', text: ' o' }] } },
      { stepType: 'replace', from: 80, to: 80, slice: { content: [{ type: 'text', text: 'f' }] } },
      { stepType: 'replace', from: 81, to: 81, slice: { content: [{ type: 'text', text: nbsp }] } },
      { stepType: 'replace', from: 81, to: 82, slice: { content: [{ type: 'text', text: ' m' }] } },
      { stepType: 'replace', from: 83, to: 83, slice: { content: [{ type: 'text', text: 'y' }] } },
      { stepType: 'replace', from: 84, to: 84, slice: { content: [{ type: 'text', text: nbsp }] } },
      { stepType: 'replace', from: 84, to: 85, slice: { content: [{ type: 'text', text: ' o' }] } },
      { stepType: 'replace', from: 86, to: 86, slice: { content: [{ type: 'text', text: 'w' }] } },
      { stepType: 'replace', from: 87, to: 87, slice: { content: [{ type: 'text', text: 'n' }] } },
      { stepType: 'replace', from: 88, to: 88, slice: { content: [{ type: 'text', text: '.' }] } },
    ]
    expect(session.acceptEditorSteps({
      actorId: 'human',
      name: 'Edit',
      baseVersion: first.revision,
      steps: typedAtEnd,
      markdown: '# New note\n\nAlpha holds the opening claim.\n\nBeta, split by region.\n\nA paragraph of my own.\n',
    })).toMatchObject({ ok: true, revision: 2 })

    expect(session.revert(String(first.revision))).toEqual({ ok: true, revision: 3 })
    const after = session.snapshot().markdown
    expect(after).toContain('Beta carries the argument that needs work.')
    expect(after).not.toContain('Beta, split by region.')
    expect(after).toContain('A paragraph of my own.')
    // As its own paragraph, not merged into the restored passage.
    expect(after).toContain('work.\n\nA paragraph')
  })

  test('refuses revert when a later deletion destroyed the inverted target', async () => {
    const markdown = 'remove target\n\nkeep this paragraph'
    const session = await DocumentSession.open(filePort(markdown), undefined, adapter.port)
    const agent = markdownSteps(markdown, 'TARGET', { from: 8, to: 14 })

    const first = session.applySteps({
      actorId: 'agent',
      name: 'Rename target',
      baseVersion: 0,
      steps: agent,
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the agent write to commit')
    const afterAgent = session.snapshot().markdown
    expect(afterAgent).toBe('remove \n\nTARGET\n\nkeep this paragraph\n')
    // Delete the TARGET paragraph itself — the node the inverse would write
    // back into. 9..17 is that whole paragraph: "remove " is positions 0..9.
    const laterDeletion = markdownSteps(afterAgent, '', { from: 9, to: 17 })
    expect(session.applySteps({
      actorId: 'human',
      name: 'Delete target',
      baseVersion: first.revision,
      steps: laterDeletion,
    })).toMatchObject({ ok: true })
    const before = session.snapshot()

    expect(session.revert(String(first.revision))).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual(before)
  })
})
