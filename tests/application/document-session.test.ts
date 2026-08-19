import { describe, expect, test } from 'vitest'

import { DocumentSession } from '../../src/application/index.js'
import type {
  FilePort,
  OpenedDocument,
  StepApplicationResult,
  StepBatch,
  StepDocumentPort,
} from '../../src/application/index.js'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** A file port that records what it was asked to save, and can be told to fail. */
function stubPort(initial: string, options: { failSave?: string } = {}) {
  const saved: string[] = []
  const port: FilePort = {
    async open(): Promise<OpenedDocument> {
      return { handle: 'fixture:test', name: 'test.md', bytes: encode(initial) }
    },
    async save(_handle: string, bytes: Uint8Array): Promise<void> {
      if (options.failSave !== undefined) {
        throw new Error(options.failSave)
      }
      saved.push(decode(bytes))
    },
  }
  return { port, saved }
}

interface TestStep {
  readonly append?: string
  readonly deleteToken?: string
  readonly uninvertible?: boolean
  readonly error?: 'invalid_step' | 'invalid_schema' | 'rebase_failed'
}

function stepPort() {
  const rebases: {
    readonly baseMarkdown: string
    readonly localSteps: StepBatch
    readonly committedBatches: readonly StepBatch[]
  }[] = []

  const apply = (markdown: string, steps: StepBatch): StepApplicationResult => {
    let next = markdown
    for (const step of steps as readonly TestStep[]) {
      if (step.error !== undefined) return { ok: false, kind: step.error }
      if (typeof step.deleteToken === 'string') {
        const at = next.lastIndexOf(step.deleteToken)
        if (at < 0) return { ok: false, kind: 'rebase_failed' }
        next = next.slice(0, at) + next.slice(at + step.deleteToken.length)
        continue
      }
      if (typeof step.append !== 'string') return { ok: false, kind: 'invalid_step' }
      next += step.append
    }
    return { ok: true, markdown: next, steps }
  }

  const port: StepDocumentPort = {
    applySteps: apply,
    rebaseSteps(baseMarkdown, localSteps, committedBatches) {
      rebases.push({ baseMarkdown, localSteps, committedBatches })
      let current = baseMarkdown
      for (const batch of committedBatches) {
        const committed = apply(current, batch)
        if (!committed.ok) return committed
        current = committed.markdown
      }
      return apply(current, localSteps)
    },
    invertSteps(_markdown, steps) {
      const inverse: TestStep[] = []
      for (const step of steps as readonly TestStep[]) {
        if (step.uninvertible === true) return null
        if (typeof step.append === 'string') {
          inverse.unshift({ deleteToken: step.append })
          continue
        }
        if (typeof step.deleteToken === 'string') {
          inverse.unshift({ append: step.deleteToken })
          continue
        }
        return null
      }
      return inverse as unknown as StepBatch
    },
    markdownToSteps: () => ({ ok: false, kind: 'invalid_step' }),
  }

  return { port, rebases }
}

describe('DocumentSession', () => {
  test('opens a document and exposes its markdown, clean, at the first revision', async () => {
    const { port } = stubPort('# Title\n\nbody\n')

    const session = await DocumentSession.open(port)

    expect(session.snapshot()).toEqual({ revision: 0, markdown: '# Title\n\nbody\n', dirty: false })
  })

  test('saving an untouched document is a no-op', async () => {
    const { port, saved } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)

    await expect(session.save()).resolves.toEqual({ ok: true, revision: 0 })
    expect(saved).toEqual([])
    expect(session.snapshot().dirty).toBe(false)
  })

  test('a forced save can export an untouched document without making it dirty', async () => {
    const { port, saved } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)

    await expect(session.save(true)).resolves.toEqual({ ok: true, revision: 0 })
    expect(saved).toEqual(['# Title\n'])
    expect(session.snapshot().dirty).toBe(false)
  })

  test('applying a transaction at the current revision advances it and marks the document dirty', async () => {
    const { port } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)

    const result = session.apply({
      actorId: 'human',
      name: 'Type',
      expectedRevision: 0,
      markdown: '# Title\n\nnew paragraph\n',
    })

    expect(result).toEqual({ ok: true, revision: 1 })
    expect(session.snapshot()).toEqual({
      revision: 1,
      markdown: '# Title\n\nnew paragraph\n',
      dirty: true,
    })
  })

  test('commits a fresh structural batch without rebasing', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)

    const result = session.applySteps({
      actorId: 'agent',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })

    expect(result).toEqual({
      ok: true,
      revision: 1,
      rebased: false,
      steps: [{ append: 'A' }],
    })
    expect(session.snapshot()).toEqual({ revision: 1, markdown: 'baseA', dirty: true })
    expect(steps.rebases).toEqual([])
  })

  test('rebases a stale structural batch over every accepted batch since its base version', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)

    session.applySteps({
      actorId: 'human',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    session.applySteps({
      actorId: 'human',
      name: 'Append B',
      baseVersion: 1,
      steps: [{ append: 'B' }],
    })

    const stale = session.applySteps({
      actorId: 'agent',
      name: 'Append C',
      baseVersion: 0,
      steps: [{ append: 'C' }],
    })

    expect(stale).toEqual({
      ok: true,
      revision: 3,
      rebased: true,
      steps: [{ append: 'C' }],
    })
    expect(session.snapshot()).toEqual({ revision: 3, markdown: 'baseABC', dirty: true })
    expect(steps.rebases).toEqual([{
      baseMarkdown: 'base',
      localSteps: [{ append: 'C' }],
      committedBatches: [[{ append: 'A' }], [{ append: 'B' }]],
    }])
  })

  test('reports a failed rebase without changing the accepted document or revision', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    session.applySteps({
      actorId: 'human',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    const before = session.snapshot()

    const refused = session.applySteps({
      actorId: 'agent',
      name: 'Destroyed target',
      baseVersion: 0,
      steps: [{ error: 'rebase_failed' }],
    })

    expect(refused).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual(before)
  })

  test('propagates schema rejection without changing the accepted document or revision', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)

    expect(session.applySteps({
      actorId: 'agent',
      name: 'Invalid structure',
      baseVersion: 0,
      steps: [{ error: 'invalid_schema' }],
    })).toEqual({ ok: false, reason: 'invalid_schema' })
    expect(session.snapshot()).toEqual({ revision: 0, markdown: 'base', dirty: false })
  })

  test('records legacy whole-document apply as a barrier no stale batch rebases across', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    session.apply({
      actorId: 'external',
      name: 'External file import',
      expectedRevision: 0,
      markdown: 'replaced',
    })

    const refused = session.applySteps({
      actorId: 'agent',
      name: 'Late structural change',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })

    expect(refused).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual({ revision: 1, markdown: 'replaced', dirty: true })
    expect(steps.rebases).toEqual([])
  })

  test('rejects an invalid base version and an unavailable structural capability atomically', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)

    expect(session.applySteps({
      actorId: 'agent',
      name: 'Future change',
      baseVersion: 1,
      steps: [{ append: 'A' }],
    })).toEqual({ ok: false, reason: 'invalid_version' })
    expect(session.snapshot()).toEqual({ revision: 0, markdown: 'base', dirty: false })

    const unconfigured = await DocumentSession.open(files)
    expect(unconfigured.applySteps({
      actorId: 'agent',
      name: 'Unsupported change',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })).toEqual({ ok: false, reason: 'capability_denied' })
    expect(unconfigured.snapshot()).toEqual({ revision: 0, markdown: 'base', dirty: false })
  })

  // Whole-document compatibility changes still use compare-and-swap because
  // they are barriers, not structural batches that can be rebased safely.
  test('a transaction built against a stale revision is refused and changes nothing', async () => {
    const { port } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)
    session.apply({ actorId: 'human', name: 'Type', expectedRevision: 0, markdown: 'first\n' })

    const stale = session.apply({
      actorId: 'agent',
      name: 'Late write',
      expectedRevision: 0,
      markdown: 'clobbered\n',
    })

    expect(stale).toEqual({ ok: false, reason: 'stale-revision', expected: 0, actual: 1 })
    expect(session.snapshot().markdown).toBe('first\n')
  })

  test('saving writes the current markdown through the port and leaves the document clean', async () => {
    const { port, saved } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)
    session.apply({ actorId: 'human', name: 'Type', expectedRevision: 0, markdown: 'edited\n' })

    const result = await session.save()

    expect(result).toEqual({ ok: true, revision: 1 })
    expect(saved).toEqual(['edited\n'])
    expect(session.snapshot().dirty).toBe(false)
  })

  // A failed write must never look like a successful one, or the user trusts a
  // file that was never written.
  test('a failed save reports the error and keeps the document dirty', async () => {
    const { port, saved } = stubPort('# Title\n', { failSave: 'disk full' })
    const session = await DocumentSession.open(port)
    session.apply({ actorId: 'human', name: 'Type', expectedRevision: 0, markdown: 'edited\n' })

    const result = await session.save()

    expect(result).toEqual({ ok: false, reason: 'disk full' })
    expect(saved).toEqual([])
    expect(session.snapshot().dirty).toBe(true)
  })

  test('adopting an on-disk comments link keeps it through the next body save', async () => {
    const opened = '---\nid: abc\n---\n\nAlpha.\n\nBravo.\n'
    const onDisk = '---\nid: abc\ncomments: .simplemark/abc.json\n---\n\nAlpha.\n\nBravo.\n'
    const { port, saved } = stubPort(opened)
    const session = await DocumentSession.open(port)
    session.adoptDiskWrite(onDisk)
    expect(session.snapshot()).toEqual({
      revision: 0,
      markdown: onDisk,
      dirty: false,
    })

    session.apply({
      actorId: 'human',
      name: 'Edit',
      expectedRevision: 0,
      markdown: '---\nid: abc\n---\n\nAlpha changed.\n\nBravo.\n',
    })
    await expect(session.save()).resolves.toEqual({ ok: true, revision: 1 })
    expect(saved[0]).toContain('comments: .simplemark/abc.json')
    expect(saved[0]).toContain('Alpha changed.')
  })

  test('reverting the most recent agent transaction restores the document', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    const applied = session.applySteps({
      actorId: 'agent',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    expect(applied).toMatchObject({ ok: true, revision: 1 })
    if (!applied.ok) throw new Error('Expected the agent write to commit')

    const reverted = session.revert(String(applied.revision))

    expect(reverted).toEqual({ ok: true, revision: 2 })
    expect(session.snapshot()).toEqual({ revision: 2, markdown: 'base', dirty: true })
  })

  test('reverting an older agent transaction keeps later edits', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    const first = session.applySteps({
      actorId: 'agent',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    session.applySteps({
      actorId: 'human',
      name: 'Append B',
      baseVersion: 1,
      steps: [{ append: 'B' }],
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the first write to commit')

    const reverted = session.revert(String(first.revision))

    expect(reverted).toEqual({ ok: true, revision: 3 })
    expect(session.snapshot()).toEqual({ revision: 3, markdown: 'baseB', dirty: true })
    expect(steps.rebases).toEqual([{
      baseMarkdown: 'baseA',
      localSteps: [{ deleteToken: 'A' }],
      committedBatches: [[{ append: 'B' }]],
    }])
  })

  test('refuses an unrebasable revert and leaves the document untouched', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    const first = session.applySteps({
      actorId: 'agent',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    session.applySteps({
      actorId: 'human',
      name: 'Remove A',
      baseVersion: 1,
      steps: [{ deleteToken: 'A' }],
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the first write to commit')
    const before = session.snapshot()

    const refused = session.revert(String(first.revision))

    expect(refused).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual(before)
  })

  test('refuses revert when a barrier sits between the transaction and now', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    const first = session.applySteps({
      actorId: 'agent',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    session.apply({
      actorId: 'external',
      name: 'External file import',
      expectedRevision: 1,
      markdown: 'replaced',
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    if (!first.ok) throw new Error('Expected the first write to commit')
    const before = session.snapshot()

    const refused = session.revert(String(first.revision))

    expect(refused).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual(before)
  })

  test('an unknown transaction id fails as a value rather than throwing', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    session.applySteps({
      actorId: 'agent',
      name: 'Append A',
      baseVersion: 0,
      steps: [{ append: 'A' }],
    })
    const before = session.snapshot()

    expect(() => session.revert('no-such-id')).not.toThrow()
    expect(session.revert('no-such-id')).toEqual({ ok: false, reason: 'unknown-id' })
    expect(session.snapshot()).toEqual(before)
  })

  test('revert without a step port is refused as a missing capability', async () => {
    const { port: files } = stubPort('base')
    const session = await DocumentSession.open(files)

    expect(session.revert('1')).toEqual({ ok: false, reason: 'capability_denied' })
    expect(session.snapshot()).toEqual({ revision: 0, markdown: 'base', dirty: false })
  })

  test('a transaction with no inverse cannot be reverted and changes nothing', async () => {
    const { port: files } = stubPort('base')
    const steps = stepPort()
    const session = await DocumentSession.open(files, undefined, steps.port)
    const applied = session.applySteps({
      actorId: 'agent',
      name: 'Opaque write',
      baseVersion: 0,
      steps: [{ append: 'A', uninvertible: true }],
    })
    expect(applied).toMatchObject({ ok: true, revision: 1 })
    if (!applied.ok) throw new Error('Expected the opaque write to commit')
    const before = session.snapshot()

    const refused = session.revert(String(applied.revision))

    expect(refused).toEqual({ ok: false, reason: 'rebase_failed' })
    expect(session.snapshot()).toEqual(before)
  })
})
