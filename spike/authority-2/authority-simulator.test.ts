import { describe, expect, test } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Transform } from '@milkdown/kit/prose/transform'

import {
  createAuthoritySimulator,
  type AuthoritySimulator,
  type SubmittedBatch,
} from './authority-simulator.js'
import { createAuthorityHarness, type AuthorityHarness } from './harness.js'

function insertStep(doc: ProseNode, position: number, text: string): readonly unknown[] {
  return new Transform(doc)
    .insert(position, doc.type.schema.text(text))
    .steps
    .map((step) => step.toJSON())
}

function batch(
  operationId: string,
  baseVersion: number,
  stepsJson: readonly unknown[],
  clientId = 'client-a',
): SubmittedBatch {
  return { clientId, operationId, baseVersion, stepsJson }
}

async function setup(markdown = 'abcd'): Promise<{
  readonly harness: AuthorityHarness
  readonly simulator: AuthoritySimulator
  readonly base: ProseNode
}> {
  const harness = await createAuthorityHarness()
  return {
    harness,
    simulator: createAuthoritySimulator(harness, markdown),
    base: harness.parse(markdown),
  }
}

describe('authority simulator', () => {
  test('accepts a fresh batch and advances the version exactly once', async () => {
    const { harness, simulator, base } = await setup()
    try {
      const result = simulator.submit(batch('op-1', 0, insertStep(base, 2, 'A')))

      expect(result).toMatchObject({ ok: true, version: 1, rebased: false })
      expect(simulator.snapshot()).toMatchObject({ version: 1, commitCount: 1 })
      expect(simulator.snapshot().doc.textContent).toBe('aAbcd')
    } finally {
      await harness.destroy()
    }
  })

  test('rebases a stale batch over every commit since its base version', async () => {
    const { harness, simulator, base } = await setup()
    try {
      const first = simulator.submit(batch('op-1', 0, insertStep(base, 2, 'A')))
      if (!first.ok) throw new Error(`Expected first submit to pass, got ${first.kind}`)
      const versionOne = simulator.snapshot().doc
      simulator.submit(batch('op-2', 1, insertStep(versionOne, 4, 'B')))

      const stale = simulator.submit(batch('op-3', 0, insertStep(base, 4, 'C'), 'client-b'))

      expect(stale).toMatchObject({ ok: true, version: 3, rebased: true })
      expect(simulator.snapshot().doc.textContent).toBe('aAbBcCd')
      expect(simulator.snapshot()).toMatchObject({ version: 3, commitCount: 3 })
    } finally {
      await harness.destroy()
    }
  })

  test('returns the prior result when an identical operation is retried', async () => {
    const { harness, simulator, base } = await setup()
    try {
      const operation = batch('op-retry', 0, insertStep(base, 2, 'A'))
      const first = simulator.submit(operation)
      const retry = simulator.submit(operation)

      expect(retry).toEqual(first)
      expect(simulator.snapshot().doc.textContent).toBe('aAbcd')
      expect(simulator.snapshot()).toMatchObject({ version: 1, commitCount: 1 })
    } finally {
      await harness.destroy()
    }
  })

  test('rejects operation ID reuse with a different payload', async () => {
    const { harness, simulator, base } = await setup()
    try {
      simulator.submit(batch('op-reused', 0, insertStep(base, 2, 'A')))

      const conflict = simulator.submit(batch('op-reused', 0, insertStep(base, 2, 'B')))

      expect(conflict).toEqual({ ok: false, kind: 'operation_conflict' })
      expect(simulator.snapshot().doc.textContent).toBe('aAbcd')
      expect(simulator.snapshot()).toMatchObject({ version: 1, commitCount: 1 })
    } finally {
      await harness.destroy()
    }
  })

  test.each([
    { first: 'A', second: 'B', expected: 'abABcd' },
    { first: 'B', second: 'A', expected: 'abBAcd' },
  ])('orders same-position contention by authority arrival: $first then $second', async ({
    first,
    second,
    expected,
  }) => {
    const { harness, simulator, base } = await setup()
    try {
      const firstResult = simulator.submit(
        batch(`op-${first}`, 0, insertStep(base, 3, first), `client-${first}`),
      )
      const secondResult = simulator.submit(
        batch(`op-${second}`, 0, insertStep(base, 3, second), `client-${second}`),
      )

      expect(firstResult).toMatchObject({ ok: true, version: 1, rebased: false })
      expect(secondResult).toMatchObject({ ok: true, version: 2, rebased: true })
      expect(simulator.snapshot().doc.textContent).toBe(expected)
      if (!firstResult.ok || !secondResult.ok) throw new Error('Expected both contenders to be accepted')

      const firstReplica = harness.apply(base, insertStep(base, 3, first))
      if (!firstReplica.ok) throw new Error(`Expected first replica apply, got ${firstReplica.kind}`)
      const firstConverged = harness.apply(firstReplica.doc, secondResult.stepsJson)
      if (!firstConverged.ok) throw new Error(`Expected first replica convergence, got ${firstConverged.kind}`)

      const secondConverged = harness.rebase(
        base,
        insertStep(base, 3, second),
        firstResult.stepsJson,
      )
      if (!secondConverged.ok) {
        throw new Error(`Expected second replica convergence, got ${secondConverged.kind}`)
      }

      expect(firstConverged.doc.eq(simulator.snapshot().doc)).toBe(true)
      expect(secondConverged.doc.eq(simulator.snapshot().doc)).toBe(true)
      expect(secondConverged.stepsJson).toEqual(secondResult.stepsJson)
    } finally {
      await harness.destroy()
    }
  })

  test('restores document, version, log, and retry identity from a checkpoint', async () => {
    const { harness, simulator, base } = await setup()
    try {
      const operation = batch('op-before-restart', 0, insertStep(base, 2, 'A'))
      const accepted = simulator.submit(operation)
      const restored = createAuthoritySimulator(harness, 'abcd', simulator.checkpoint())

      expect(restored.snapshot().doc.textContent).toBe('aAbcd')
      expect(restored.snapshot()).toMatchObject({ version: 1, commitCount: 1 })
      expect(restored.submit(operation)).toEqual(accepted)
      expect(restored.snapshot()).toMatchObject({ version: 1, commitCount: 1 })

      const continued = restored.submit(
        batch('op-after-restart', 1, insertStep(restored.snapshot().doc, 3, 'B')),
      )
      expect(continued).toMatchObject({ ok: true, version: 2, rebased: false })
      expect(restored.snapshot()).toMatchObject({ version: 2, commitCount: 2 })
      expect(restored.snapshot().doc.textContent).toBe('aABbcd')
    } finally {
      await harness.destroy()
    }
  })

  test('lets a reconnected client submit from its last known version', async () => {
    const { harness, simulator, base } = await setup()
    try {
      simulator.submit(batch('online-1', 0, insertStep(base, 2, 'A')))
      const versionOne = simulator.snapshot().doc
      simulator.submit(batch('online-2', 1, insertStep(versionOne, 4, 'B')))

      const reconnected = simulator.submit(
        batch('offline-1', 0, insertStep(base, 5, 'Z'), 'offline-client'),
      )

      expect(reconnected).toMatchObject({ ok: true, version: 3, rebased: true })
      expect(simulator.snapshot().doc.textContent).toBe('aAbBcdZ')
    } finally {
      await harness.destroy()
    }
  })

  test('invalid versions and malformed batches leave all authority state unchanged', async () => {
    const { harness, simulator } = await setup()
    try {
      const before = simulator.checkpoint()

      expect(simulator.submit(batch('future', 1, []))).toEqual({ ok: false, kind: 'invalid_version' })
      expect(simulator.submit(batch('malformed', 0, [{ stepType: 'not-a-step' }]))).toEqual({
        ok: false,
        kind: 'invalid_step',
      })
      expect(simulator.checkpoint()).toEqual(before)
    } finally {
      await harness.destroy()
    }
  })

  test('a destroyed stale target leaves the accepted checkpoint byte-for-byte unchanged', async () => {
    const { harness, simulator, base } = await setup('remove target\n\nkeep paragraph')
    try {
      let removedFrom = -1
      let removedTo = -1
      base.descendants((node, position) => {
        if (removedFrom !== -1 || node.type.name !== 'paragraph' || !node.textContent.includes('remove')) {
          return true
        }
        removedFrom = position
        removedTo = position + node.nodeSize
        return false
      })
      if (removedFrom < 0) throw new Error('Expected removable paragraph')
      simulator.submit(batch('delete-target', 0, new Transform(base)
        .delete(removedFrom, removedTo)
        .steps
        .map((step) => step.toJSON())))
      const acceptedCheckpoint = JSON.stringify(simulator.checkpoint())

      const refused = simulator.submit(
        batch('stale-target', 0, new Transform(base)
          .insert(8, base.type.schema.text('STALE'))
          .steps
          .map((step) => step.toJSON()), 'stale-client'),
      )

      expect(refused).toEqual({ ok: false, kind: 'rebase_failed' })
      expect(JSON.stringify(simulator.checkpoint())).toBe(acceptedCheckpoint)
    } finally {
      await harness.destroy()
    }
  })
})
