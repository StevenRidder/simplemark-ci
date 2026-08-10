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
})
