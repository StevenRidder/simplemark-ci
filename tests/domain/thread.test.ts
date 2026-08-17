import { describe, expect, it } from 'vitest'

import { buildAnchor, detachThread, resolveThread, type Thread } from '../../src/domain/index.js'

const thread = (): Thread => ({
  id: 't1',
  noteKey: 'n1',
  author: 'local',
  createdAt: '2026-08-06T10:00:00Z',
  body: 'split by region?',
  anchor: buildAnchor('the Starlink business', 4, 12, 0),
  state: 'open',
})

describe('thread transitions', () => {
  it('resolves without touching anything else', () => {
    const resolved = resolveThread(thread())
    expect(resolved.state).toBe('resolved')
    expect(resolved.body).toBe('split by region?')
    expect(resolved.anchor).toEqual(thread().anchor)
  })

  it('detaching clears the anchor permanently', () => {
    const detached = detachThread(thread())
    expect(detached.anchor).toBeUndefined()
    expect(detached.state).toBe('open')
  })

  it('does not mutate the original', () => {
    const original = thread()
    resolveThread(original)
    expect(original.state).toBe('open')
  })
})
