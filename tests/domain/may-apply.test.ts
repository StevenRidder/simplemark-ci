import { describe, expect, test } from 'vitest'

import { mayApply } from '../../src/domain/index.js'
import type { AgentRun } from '../../src/domain/index.js'

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: 'run-17',
    generation: 3,
    status: 'writing',
    ...over,
  }
}

/**
 * The generation fence, tested as arithmetic.
 *
 * Stop and Redirect bump the generation. A write that still carries the old
 * number is refused, never merged. Pause does not bump, so a paused run
 * still accepts the current generation (SWITCHBOARD-KERNEL.md §2, MCP-SERVER.md §7).
 */
describe('mayApply', () => {
  test('accepts a write that claims the current non-terminal generation', () => {
    expect(mayApply(run(), 3)).toBe(true)
  })

  test('accepts a paused run at the current generation', () => {
    expect(mayApply(run({ status: 'paused' }), 3)).toBe(true)
  })

  test('refuses a stale generation after Stop or Redirect', () => {
    expect(mayApply(run({ generation: 4, status: 'writing' }), 3)).toBe(false)
  })

  test('refuses a future generation', () => {
    expect(mayApply(run({ generation: 3 }), 4)).toBe(false)
  })

  test('refuses a malformed generation', () => {
    expect(mayApply(run(), Number.NaN)).toBe(false)
    expect(mayApply(run(), 3.5)).toBe(false)
    expect(mayApply(run(), -1)).toBe(false)
  })

  test('refuses every terminal status even when the generation matches', () => {
    expect(mayApply(run({ status: 'completed' }), 3)).toBe(false)
    expect(mayApply(run({ status: 'cancelled' }), 3)).toBe(false)
    expect(mayApply(run({ status: 'failed' }), 3)).toBe(false)
  })
})
