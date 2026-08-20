import { describe, expect, test } from 'vitest'

import { appendReply, hasAgentTurn, threadTurns } from '../../src/domain/index.js'
import type { Thread } from '../../src/domain/index.js'

const note: Thread = {
  id: 't1',
  noteKey: 'n',
  author: 'local',
  createdAt: '2026-08-20T00:00:00Z',
  body: 'Split this by region before the customer call?',
  anchor: { quote: 'operational rather than theoretical', prefix: '', suffix: '', blockIndex: 0 },
  state: 'open',
}

describe('passage conversation (AGENT-9)', () => {
  test('a note with nobody answering has no replies field at all', () => {
    // A thread written before conversations existed must read back byte-for-byte
    // as it was stored.
    expect(note).not.toHaveProperty('replies')
    expect(hasAgentTurn(note)).toBe(false)
  })

  test('the opening note is the first turn, not a separate thing', () => {
    const turns = threadTurns(note)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.body).toBe('Split this by region before the customer call?')
    expect(turns[0]?.author).toBe('local')
  })

  test('replies append in order and leave the original body alone', () => {
    const asked = appendReply(note, {
      id: 'm1',
      author: 'agent',
      createdAt: '2026-08-20T00:01:00Z',
      body: 'Split it into three regional paragraphs.',
    })
    const answered = appendReply(asked, {
      id: 'm2',
      author: 'local',
      createdAt: '2026-08-20T00:02:00Z',
      body: 'Keep Markdown at the centre.',
      mode: 'redirect',
    })

    expect(threadTurns(answered).map((turn) => turn.author)).toEqual(['local', 'agent', 'local'])
    expect(answered.body).toBe(note.body)
    // Pure: the input thread is untouched.
    expect(note.replies).toBeUndefined()
    expect(asked.replies).toHaveLength(1)
  })

  test('an agent turn is what makes a note a conversation', () => {
    const withHuman = appendReply(note, {
      id: 'm1', author: 'local', createdAt: 'x', body: 'a second thought', mode: 'note',
    })
    expect(hasAgentTurn(withHuman)).toBe(false)

    const withAgent = appendReply(withHuman, {
      id: 'm2', author: 'agent', createdAt: 'y', body: 'Done.',
    })
    expect(hasAgentTurn(withAgent)).toBe(true)
  })

  test('a mode is recorded on a person’s turn and never on the agent’s', () => {
    const conversation = appendReply(
      appendReply(note, { id: 'm1', author: 'agent', createdAt: 'x', body: 'Rewrote it.' }),
      { id: 'm2', author: 'local', createdAt: 'y', body: 'stop', mode: 'note' },
    )
    const turns = threadTurns(conversation)
    // "stop" as a note is a message; the mode is what says so.
    expect(turns[1]).not.toHaveProperty('mode')
    expect(turns[2]?.mode).toBe('note')
  })
})
