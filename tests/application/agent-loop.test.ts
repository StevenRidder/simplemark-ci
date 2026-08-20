import { describe, expect, test } from 'vitest'

import { DocumentSession, runAgentLoop } from '../../src/application/index.js'
import type {
  AgentActivity,
  AgentRunControl,
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
    revertSteps: (current, inverse) => apply(current, inverse),
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

describe('runAgentLoop observers (APP-32)', () => {
  test('Pause taken from onStart lands before the first write', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'Starlink revenue', scope: 'pending' },
      },
      { kind: 'text', text: 'Resumed and finished.' },
    ])

    let control: AgentRunControl | undefined
    const loop = runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onStart: (started) => {
        control = started
        // The press a reader can physically make while the model is being
        // asked. Before onStart existed there was no handle to receive it.
        started.pause()
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(provider.calls).toBe(0)
    expect(session.snapshot().markdown).toBe(document)
    expect(control?.status).toBe('paused')
    // Pause is not Stop: the generation is untouched, so resuming lands.
    expect(control?.generation).toBe(0)

    control?.resume()
    await expect(loop).resolves.toEqual({
      kind: 'text',
      text: 'Resumed and finished.',
      generation: 0,
    })
    expect(session.snapshot().markdown).toBe('alpha Starlink revenue omega')
  })

  test('activity names the document work, not the tool, and counts writes', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      { kind: 'tool', id: 'call-1', name: 'read_note', args: { scope: 'pending' } },
      {
        kind: 'tool',
        id: 'call-2',
        name: 'apply_transaction',
        args: { markdown: 'Starlink revenue', scope: 'pending' },
      },
      { kind: 'text', text: 'done' },
    ])

    const seen: AgentActivity[] = []
    await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onActivity: (activity) => seen.push(activity),
    })

    const details = seen.map((activity) => activity.detail)
    expect(details).toContain('Reading the note')
    expect(details).toContain('Rewriting “Starlink business”')
    expect(details).not.toContain('apply_transaction')
    expect(details.at(-1)).toBe('Finished')
    // read_note is not a write; only the transaction counts.
    expect(seen.at(-1)?.writes).toBe(1)
    expect(seen.at(-1)?.status).toBe('completed')
  })

  test('a selection is named as the selection, and the write reports its range', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'replacement', scope: 'pending' },
      },
      { kind: 'text', text: 'done' },
    ])

    const seen: AgentActivity[] = []
    await runAgentLoop({
      session,
      provider,
      instruction: 'tighten this',
      noteId: 'note-1',
      actorId: 'agent',
      selection: { from: 6, to: 24 },
      onActivity: (activity) => seen.push(activity),
    })

    expect(seen.map((activity) => activity.detail)).toContain('Rewriting the selected passage')
    expect(seen.at(-1)?.range).toEqual({ from: 6, to: 24 })
  })

  test('a transport failure reports failed rather than going quiet', async () => {
    const session = await openSession()
    const provider: AgentProviderPort = {
      async complete() {
        throw new Error('socket closed')
      },
    }

    const seen: AgentActivity[] = []
    await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onActivity: (activity) => seen.push(activity),
    })

    expect(seen.at(-1)).toMatchObject({ status: 'failed', detail: 'Could not finish' })
  })
})

describe('runAgentLoop coordinate spaces (APP-32)', () => {
  /**
   * A port that records the range it was handed, because the defect these
   * cover is not a wrong result but a wrong *number* — one that the stub port
   * above cannot expose, since it treats the Markdown string as the document
   * and so makes the two coordinate spaces coincide.
   */
  function rangeRecordingSteps(): StepDocumentPort & {
    ranges: Array<{ from: number; to: number } | undefined>
  } {
    const base = recordingSteps()
    const ranges: Array<{ from: number; to: number } | undefined> = []
    return {
      ...base,
      ranges,
      markdownToSteps: (markdown, replacement, range) => {
        ranges.push(range === undefined ? undefined : { from: range.from, to: range.to })
        return base.markdownToSteps(markdown, replacement, range)
      },
    }
  }

  test('a passage range is mapped out of text offsets, never used raw', async () => {
    const steps = rangeRecordingSteps()
    const session = await DocumentSession.open(filePort(document), undefined, steps)
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'replacement', scope: 'pending' },
      },
      { kind: 'text', text: 'done' },
    ])

    const asked: Array<{ offset: number; length: number }> = []
    await runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      textTarget: {
        text: () => document,
        rangeAt: (offset, length) => {
          asked.push({ offset, length })
          // A real editor's positions differ from text offsets by the block
          // boundaries between them. Shifting by one here proves the mapped
          // value is what gets applied, rather than the raw offset.
          return { from: offset - 1, to: offset - 1 + length }
        },
      },
    })

    expect(asked).toEqual([{ offset: 6, length: 'Starlink business'.length }])
    expect(steps.ranges).toEqual([{ from: 5, to: 5 + 'Starlink business'.length }])
  })

  test('an append passes no range at all rather than a Markdown length', async () => {
    const steps = rangeRecordingSteps()
    const session = await DocumentSession.open(filePort(document), undefined, steps)
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'insert_markdown',
        args: { markdown: '\n\nAppended.', scope: 'pending' },
      },
      { kind: 'text', text: 'done' },
    ])

    await runAgentLoop({
      session,
      provider,
      // Nothing in this instruction points at existing text, so the target is
      // an append and there is no position to give.
      instruction: 'add a closing line',
      noteId: 'note-1',
      actorId: 'agent',
      textTarget: { text: () => document, rangeAt: () => undefined },
    })

    // `undefined`, not `document.length`: the port owns the end of the document
    // it parsed, and a character count is not a position in it.
    expect(steps.ranges).toEqual([undefined])
    expect(session.snapshot().markdown).toContain('Appended.')
  })

  test('Pause during the provider call holds the write it implied', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'Starlink revenue', scope: 'pending' },
      },
      { kind: 'text', text: 'done' },
    ])

    let control: AgentRunControl | undefined
    const loop = runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onStart: (started) => {
        control = started
        started.pause()
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(session.snapshot().markdown).toBe(document)
    control?.resume()
    await loop
    expect(session.snapshot().markdown).toBe('alpha Starlink revenue omega')
  })

  test('Stop while paused ends the run instead of writing on release', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'should never land', scope: 'pending' },
      },
      { kind: 'text', text: 'done' },
    ])

    let control: AgentRunControl | undefined
    const loop = runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onStart: (started) => {
        control = started
        started.pause()
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    control?.stop()
    await expect(loop).resolves.toEqual({ kind: 'stopped' })
    expect(session.snapshot().markdown).toBe(document)
  })
})

describe('runAgentLoop redirect (APP-32)', () => {
  test('a redirect replaces the work instead of ending the run', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'from the abandoned run', scope: 'pending' },
      },
      {
        kind: 'tool',
        id: 'call-2',
        name: 'apply_transaction',
        args: { markdown: 'from the replacement run', scope: 'pending' },
      },
      { kind: 'text', text: 'Replaced.' },
    ])

    let control: AgentRunControl | undefined
    const seen: string[] = []
    const loop = runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onStart: (started) => {
        control = started
      },
      afterUnit: () => {},
      onActivity: (activity) => seen.push(activity.status),
    })

    // Redirect before the first turn's result can land.
    control?.redirect('replace "Starlink business"')
    const result = await loop

    // Not `stopped`: the run continued and did the replacement work. Ending it
    // here would make Redirect a differently-spelled Stop.
    expect(result).toEqual({ kind: 'text', text: 'Replaced.', generation: 1 })
    expect(session.snapshot().markdown).toContain('from the replacement run')
    expect(session.snapshot().markdown).not.toContain('from the abandoned run')
    expect(seen).not.toContain('cancelled')
  })

  test('a stop still ends the run, unlike a redirect', async () => {
    const session = await openSession()
    const provider = scriptedProvider([
      {
        kind: 'tool',
        id: 'call-1',
        name: 'apply_transaction',
        args: { markdown: 'should never land', scope: 'pending' },
      },
      { kind: 'text', text: 'unreachable' },
    ])

    let control: AgentRunControl | undefined
    const loop = runAgentLoop({
      session,
      provider,
      instruction: 'tighten "Starlink business"',
      noteId: 'note-1',
      actorId: 'agent',
      onStart: (started) => {
        control = started
      },
    })

    control?.stop()
    await expect(loop).resolves.toEqual({ kind: 'stopped' })
    expect(session.snapshot().markdown).toBe(document)
  })
})
