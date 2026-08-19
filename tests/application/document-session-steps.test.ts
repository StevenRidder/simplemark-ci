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
    const paraEnd = afterAgent.indexOf('\n')
    const laterDeletion = markdownSteps(afterAgent, '', { from: 0, to: paraEnd + 1 })
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
