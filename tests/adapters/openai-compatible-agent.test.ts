import { describe, expect, it } from 'vitest'

import { parseAgentCompletion } from '../../src/adapters/ai/openai-compatible-agent.js'

describe('parseAgentCompletion', () => {
  it('reads the first tool call as one unit', () => {
    expect(
      parseAgentCompletion(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call-1',
                    function: {
                      name: 'apply_transaction',
                      arguments: '{"markdown":"Hello","scope":"tok"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual({
      kind: 'tool',
      id: 'call-1',
      name: 'apply_transaction',
      args: { markdown: 'Hello', scope: 'tok' },
    })
  })

  it('finishes on a text turn', () => {
    expect(
      parseAgentCompletion(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] })),
    ).toEqual({ kind: 'text', text: 'Done.' })
  })

  it('fails closed when the endpoint rejects tools', () => {
    expect(
      parseAgentCompletion(
        JSON.stringify({ error: { message: 'This model does not support tool calling' } }),
      ),
    ).toEqual({
      kind: 'unsupported',
      message: 'This model does not support tool calling',
    })
  })
})
