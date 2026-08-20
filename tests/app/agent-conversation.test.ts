import { describe, expect, test } from 'vitest'

import { AgentConversation, instructionFor } from '../../src/app/agent-conversation.js'

describe('AgentConversation', () => {
  test('a correction replaces the message rather than appending one', () => {
    const conversation = new AgentConversation()
    const id = conversation.post({ author: 'you', markdown: 'tighten the intro', mode: 'note' })
    conversation.post({ author: 'agent', markdown: 'Which intro?' })

    expect(conversation.edit(id, 'tighten the **first** paragraph')).toBe(true)

    // Two messages, not three: the transcript is correctable, not append-only.
    expect(conversation.messages()).toHaveLength(2)
    expect(conversation.messages()[0]).toMatchObject({
      id,
      markdown: 'tighten the **first** paragraph',
      edited: true,
    })
    // Order is untouched: a correction does not move the message to the end.
    expect(conversation.messages()[1]?.author).toBe('agent')
  })

  test('an unchanged body does not claim to have been edited', () => {
    const conversation = new AgentConversation()
    const id = conversation.post({ author: 'you', markdown: 'same', mode: 'note' })

    expect(conversation.edit(id, 'same')).toBe(true)
    expect(conversation.messages()[0]?.edited).toBe(false)
  })

  test('an empty correction is refused rather than deleting the message', () => {
    const conversation = new AgentConversation()
    const id = conversation.post({ author: 'you', markdown: 'keep me', mode: 'note' })

    expect(conversation.edit(id, '   ')).toBe(false)
    expect(conversation.messages()[0]?.markdown).toBe('keep me')
  })

  test('an unknown id changes nothing', () => {
    const conversation = new AgentConversation()
    conversation.post({ author: 'you', markdown: 'only message', mode: 'note' })

    expect(conversation.edit('message-99', 'hijack')).toBe(false)
    expect(conversation.messages()[0]?.markdown).toBe('only message')
  })

  test('the mode records what sending did, and text never decides it', () => {
    const conversation = new AgentConversation()
    conversation.post({ author: 'you', markdown: 'stop', mode: 'note' })
    conversation.post({ author: 'you', markdown: 'use a table instead', mode: 'redirect' })

    // A message reading "stop" is still only a message.
    expect(conversation.messages()[0]?.mode).toBe('note')
    expect(instructionFor('note', 'stop')).toBeUndefined()

    expect(conversation.messages()[1]?.mode).toBe('redirect')
    expect(instructionFor('redirect', 'use a table instead')).toBe('use a table instead')
  })

  test('the agent’s own messages carry no mode', () => {
    const conversation = new AgentConversation()
    conversation.post({ author: 'agent', markdown: 'Rewrote the passage.' })

    expect(conversation.messages()[0]).not.toHaveProperty('mode')
  })
})
