import { describe, expect, test } from 'vitest'

import { DocumentSession, runAgentLoop } from '../../src/application/index.js'
import type {
  AgentProviderPort,
  AgentProviderTurn,
  FilePort,
  OpenedDocument,
  StepApplicationResult,
  StepBatch,
  StepDocumentPort,
} from '../../src/application/index.js'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

function filePort(markdown: string): FilePort {
  return {
    async open(): Promise<OpenedDocument> {
      return { handle: 'fixture:note', name: 'note.md', bytes: encode(markdown) }
    },
    async save(): Promise<void> {
      throw new Error('This loop test does not save')
    },
  }
}

function recordingSteps(): StepDocumentPort {
  const apply = (markdown: string, steps: StepBatch): StepApplicationResult => {
    let next = markdown
    for (const step of steps) {
      const replacement = step.replacement
      if (typeof replacement !== 'string') return { ok: false, kind: 'invalid_step' }
      const from = typeof step.from === 'number' ? step.from : next.length
      const to = typeof step.to === 'number' ? step.to : from
      next = next.slice(0, from) + replacement + next.slice(to)
    }
    return { ok: true, markdown: next, steps }
  }
  return {
    applySteps: apply,
    rebaseSteps: (base, local, committed) => {
      let current = base
      for (const batch of committed) {
        const result = apply(current, batch)
        if (!result.ok) return result
        current = result.markdown
      }
      return apply(current, local)
    },
    invertSteps: () => [],
    markdownToSteps: (markdown, replacement, range) => ({
      ok: true,
      steps: [
        {
          replacement,
          from: range?.from ?? markdown.length,
          to: range?.to ?? range?.from ?? markdown.length,
        },
      ],
    }),
  }
}

function scriptedProvider(script: AgentProviderTurn[]): AgentProviderPort & { calls: number } {
  const state = { calls: 0 }
  return {
    get calls() {
      return state.calls
    },
    async complete(input) {
      state.calls += 1
      const turn = script.shift() ?? { kind: 'text' as const, text: 'done' }
      if (turn.kind !== 'tool') return turn
      const args = turn.args
      if (typeof args !== 'object' || args === null || !('scope' in args) || args.scope !== 'pending') {
        return turn
      }
      return { ...turn, args: { ...args, scope: input.scope } }
    },
  }
}

const document = 'alpha Starlink business omega'

async function openSession() {
  return DocumentSession.open(filePort(document), undefined, recordingSteps())
}

describe('runAgentLoop', () => {
  test('a tool call commits and the loop finishes on a text turn', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'Starlink revenue', scope: 'pending' },
      },
      { kind: 'text', text: 'Tightened the paragraph.' },
    ])

    const result = await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
    })

    expect(result).toEqual({ kind: 'text', text: 'Tightened the paragraph.', generation: 0 })
    expect(session.snapshot().markdown).toBe('alpha Starlink revenue omega')
    expect(session.snapshot().dirty).toBe(true)
    expect(provider.calls).toBe(2)
  })

  test('a transport failure is reported rather than thrown', async () => {
    const session = await openSession()
    const provider: AgentProviderPort = {
      async complete() {
        throw new Error('socket closed')
      },
    }

    await expect(
      runAgentLoop({
        session,
        provider,
        instruction: 'tighten "Starlink business"',
        noteId: 'note-1',
        actorId: 'agent',
      }),
    ).resolves.toEqual({ kind: 'transport_error', message: 'socket closed' })
    expect(session.snapshot().markdown).toBe(document)
  })

  test('a stopped run does not call the model again', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'read_note',
        args: { scope: 'pending' },
      },
      { kind: 'text', text: 'should not happen' },
    ])

    const result = await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      afterUnit: (control) => {
        control.stop()
      },
    })

    expect(result).toEqual({ kind: 'stopped' })
    expect(provider.calls).toBe(1)
  })

  test('pause and resume leave the generation intact', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'read_note',
        args: { scope: 'pending' },
      },
      { kind: 'text', text: 'Resumed.' },
    ])
    let controlRef: { generation: number; pause: () => void; resume: () => void } | undefined

    const loop = runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      afterUnit: (control) => {
        controlRef = control
        control.pause()
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(provider.calls).toBe(1)
    expect(controlRef?.generation).toBe(0)
    controlRef?.resume()
    await expect(loop).resolves.toEqual({ kind: 'text', text: 'Resumed.', generation: 0 })
    expect(provider.calls).toBe(2)
  })

  test('the loop gives up rather than looping forever', async () => {
    const session = await openSession()
    const provider: AgentProviderPort & { calls: number } = {
      calls: 0,
      async complete() {
        this.calls += 1
        return {
          kind: 'tool',
          id: `call-${this.calls}`,
          name: 'read_note',
          args: { scope: 'pending' },
        }
      },
    }

    const result = await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      maxTurns: 3,
    })

    expect(result).toEqual({ kind: 'bound' })
    expect(provider.calls).toBe(3)
  })

  test('a model without tool calling fails on the first invocation', async () => {
    const session = await openSession()
    const provider = scriptedProvider([{ kind: 'unsupported', message: 'This model does not support tools.' }])

    await expect(
      runAgentLoop({
        session,
        provider,
        instruction: 'tighten "Starlink business"',
        noteId: 'note-1',
        actorId: 'agent',
      }),
    ).resolves.toEqual({
      kind: 'unsupported',
      message: 'This model does not support tools.',
    })
    expect(provider.calls).toBe(1)
    expect(session.snapshot().markdown).toBe(document)
  })

  test('apply_transaction uses the resolved scope, not a range the model invents', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'elsewhere', scope: 'forged-token', from: 0, to: 5 },
      },
      { kind: 'text', text: 'done' },
    ])

    const result = await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
    })

    expect(result.kind).toBe('text')
    expect(session.snapshot().markdown).toBe(document)
  })

  test('an unfound quote asks rather than appending', async () => {
    const session = await openSession()
    const provider = scriptedProvider([{ kind: 'text', text: 'should not happen' }])

    await expect(
      runAgentLoop({
        session,
        provider,
        instruction: 'fix "not in this document"',
        noteId: 'note-1',
        actorId: 'agent',
      }),
    ).resolves.toEqual({
      kind: 'ask',
      reason: 'missing',
      quote: 'not in this document',
    })
    expect(provider.calls).toBe(0)
  })

  test('redirect fences the old generation and continues in the same scope', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'read_note',
        args: { scope: 'pending' },
      },
      { kind: 'text', text: 'Replacement work.' },
    ])

    const result = await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      afterUnit: (control) => {
        control.redirect('add a conclusion')
      },
    })

    expect(result).toEqual({ kind: 'text', text: 'Replacement work.', generation: 1 })
    expect(provider.calls).toBe(2)
  })

  test('opening a closed note under ask returns consent_pending', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'open_note',
        args: { handle: 'fixture:other' },
      },
      { kind: 'text', text: 'should not steal focus' },
    ])

    const result = await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      agentMayOpenNotes: 'ask',
    })

    expect(result).toEqual({
      kind: 'consent_pending',
      handle: 'fixture:other',
    })
    expect(provider.calls).toBe(1)
  })
})
