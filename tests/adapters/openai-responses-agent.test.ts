import { describe, expect, it } from 'vitest'

import {
  OpenAiResponsesAgentPort,
  parseResponsesReply,
  responsesInput,
} from '../../src/adapters/ai/openai-responses-agent.js'
import type { AgentMessage } from '../../src/application/index.js'

/**
 * AGENT-11. These assert the wire shape, because the wire shape is the work:
 * `/v1/responses` differs from chat completions in four ways that each fail
 * silently if guessed — a wrapped tool, a flat reasoning field, `messages`
 * instead of `input`, and `choices` instead of `output`.
 */

const TOOLS = [
  {
    name: 'apply_transaction',
    description: 'Replace the scoped passage with Markdown.',
    parameters: {
      type: 'object',
      properties: { scope: { type: 'string' }, markdown: { type: 'string' } },
      required: ['scope', 'markdown'],
      additionalProperties: false,
    },
  },
]

const input = {
  scope: 'scope-token-abc',
  instruction: 'tighten the intro',
  noteMarkdown: '# Note\n\nThe intro.',
  messages: [{ role: 'user' as const, content: 'tighten the intro' }],
  tools: TOOLS,
}

function capture(reasoning: 'default' | 'low' | 'xhigh' = 'default') {
  let sent: Record<string, unknown> | undefined
  const port = new OpenAiResponsesAgentPort(
    async (_baseUrl, _apiKey, _model, body) => {
      sent = body as Record<string, unknown>
      return JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
      })
    },
    () => ({
      apiKey: 'k',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5.6-luna',
      reasoning,
    }),
  )
  return { port, body: () => sent! }
}

describe('the /v1/responses request', () => {
  it('declares a flat function tool, with no `function` wrapper', async () => {
    const { port, body } = capture()
    await port.complete(input)

    const tools = body()['tools'] as Array<Record<string, unknown>>
    expect(tools).toHaveLength(1)
    // Chat completions nests this under `function`. Responses does not, and a
    // wrapped tool here is simply not a tool.
    expect(tools[0]).not.toHaveProperty('function')
    expect(tools[0]?.['type']).toBe('function')
    expect(tools[0]?.['name']).toBe('apply_transaction')
    expect(tools[0]?.['parameters']).toEqual(TOOLS[0]?.parameters)
  })

  it('sends reasoning as an object, not a flat field', async () => {
    const { port, body } = capture('low')
    await port.complete(input)

    expect(body()['reasoning']).toEqual({ effort: 'low' })
    // The flat form is the chat-completions spelling, and is what this endpoint
    // rejected in the first place.
    expect(body()).not.toHaveProperty('reasoning_effort')
  })

  it('omits reasoning entirely at the endpoint default', async () => {
    const { port, body } = capture('default')
    await port.complete(input)
    expect(body()).not.toHaveProperty('reasoning')
  })

  it('passes a high-end level verbatim rather than clamping it', async () => {
    const { port, body } = capture('xhigh')
    await port.complete(input)
    expect(body()['reasoning']).toEqual({ effort: 'xhigh' })
  })

  it('uses `input`, states the scope token, and sends the note', async () => {
    const { port, body } = capture()
    await port.complete(input)

    expect(body()).not.toHaveProperty('messages')
    const items = body()['input'] as Array<Record<string, unknown>>
    expect(items.some((item) => String(item['content']).includes('The intro.'))).toBe(true)
    // The authority refuses any call whose scope is not current, so a model made
    // to guess the token cannot make one valid call.
    expect(String(body()['instructions'])).toContain('scope-token-abc')
    // AGENT-12: document edits must be told to use the note's Markdown idiom,
    // or the model bulletpoints its replies while writing prose into the note.
    expect(String(body()['instructions'])).toContain('Markdown idiom')
  })

  it('refuses to call out at all when nothing is configured', async () => {
    let called = false
    const port = new OpenAiResponsesAgentPort(
      async () => {
        called = true
        return ''
      },
      () => ({ apiKey: '', baseUrl: 'https://example.test/v1', model: 'm', reasoning: 'default' }),
    )
    await expect(port.complete(input)).resolves.toMatchObject({ kind: 'error' })
    expect(called).toBe(false)
  })
})

describe('responsesInput', () => {
  it('rebuilds a tool exchange as two items under one call id', () => {
    const messages: readonly AgentMessage[] = [
      { role: 'user', content: 'tighten it' },
      {
        role: 'assistant',
        content: 'apply_transaction',
        toolCallId: 'call_1',
        toolName: 'apply_transaction',
        toolArgs: { scope: 'tok', markdown: 'Tighter.' },
      },
      { role: 'tool', content: '# Note\n\nTighter.', toolCallId: 'call_1' },
    ]

    expect(responsesInput(messages)).toEqual([
      { role: 'user', content: 'tighten it' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'apply_transaction',
        // A JSON string, not an object: the field is read as text.
        arguments: JSON.stringify({ scope: 'tok', markdown: 'Tighter.' }),
      },
      { type: 'function_call_output', call_id: 'call_1', output: '# Note\n\nTighter.' },
    ])
  })

  it('leaves a plain assistant turn as a message', () => {
    expect(responsesInput([{ role: 'assistant', content: 'All done.' }]))
      .toEqual([{ role: 'assistant', content: 'All done.' }])
  })
})

describe('parseResponsesReply', () => {
  it('reads a function call out of the output array', () => {
    expect(
      parseResponsesReply(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              call_id: 'call_9',
              name: 'apply_transaction',
              arguments: '{"scope":"tok","markdown":"Hello"}',
            },
          ],
        }),
      ),
    ).toEqual({
      kind: 'tool',
      id: 'call_9',
      name: 'apply_transaction',
      args: { scope: 'tok', markdown: 'Hello' },
    })
  })

  it('prefers the tool call when the model also narrated', () => {
    // Saying what it is about to do and then doing it is one turn; answering
    // with the prose would drop the edit.
    const reply = parseResponsesReply(
      JSON.stringify({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'I will tighten it.' }] },
          { type: 'function_call', call_id: 'c', name: 'apply_transaction', arguments: '{}' },
        ],
      }),
    )
    expect(reply.kind).toBe('tool')
  })

  it('reads assembled output_text as the answer', () => {
    expect(
      parseResponsesReply(
        JSON.stringify({
          output: [
            { type: 'reasoning', summary: [] },
            { type: 'message', content: [{ type: 'output_text', text: 'Tightened ' }, { type: 'output_text', text: 'it.' }] },
          ],
        }),
      ),
    ).toEqual({ kind: 'text', text: 'Tightened it.' })
  })

  it('passes the endpoint’s own refusal through, marked unsupported', () => {
    // The real message that sent the agent to this endpoint.
    const message = "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions."
    expect(parseResponsesReply(JSON.stringify({ error: { message } })))
      .toEqual({ kind: 'unsupported', message })
  })

  it('reports malformed arguments rather than pretending they were empty', () => {
    expect(
      parseResponsesReply(
        JSON.stringify({
          output: [{ type: 'function_call', call_id: 'c', name: 'apply_transaction', arguments: '{oops' }],
        }),
      ),
    ).toMatchObject({ kind: 'error' })
  })

  it('reasoning-only output is not an answer', () => {
    expect(parseResponsesReply(JSON.stringify({ output: [{ type: 'reasoning', summary: [] }] })))
      .toMatchObject({ kind: 'error' })
  })

  it('a chat-completions shaped reply is refused rather than half-read', () => {
    // `choices` is the other endpoint. Reading it here would mean the agent
    // silently worked against the wrong contract.
    expect(parseResponsesReply(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })))
      .toMatchObject({ kind: 'error' })
  })
})
