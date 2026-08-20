import { describe, expect, it } from 'vitest'

import {
  OpenAiCompatibleAgentPort,
  parseAgentCompletion,
} from '../../src/adapters/ai/openai-compatible-agent.js'

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

describe('OpenAiCompatibleAgentPort request (APP-32)', () => {
  /**
   * These assert the wire shape rather than a parse, because the wire shape is
   * what broke: tools were declared with an empty parameter schema and the
   * scope token was never stated, so a real model could not make one valid
   * call — and nothing in the suite noticed, since every test drove the loop
   * with a scripted provider that skipped this code entirely.
   */
  function capture(): { port: OpenAiCompatibleAgentPort; body: () => Record<string, unknown> } {
    let sent: unknown
    const port = new OpenAiCompatibleAgentPort(
      async (_baseUrl, _apiKey, _model, body) => {
        sent = body
        return JSON.stringify({ choices: [{ message: { content: 'done' } }] })
      },
      () => ({ apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'a-model', reasoning: 'default' as const }),
    )
    return { port, body: () => sent as Record<string, unknown> }
  }

  const input = {
    scope: 'scope-token-abc',
    instruction: 'tighten the intro',
    noteMarkdown: '# Note\n\nThe intro.',
    messages: [{ role: 'user' as const, content: 'tighten the intro' }],
    tools: [
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
    ],
  }

  it('declares each tool with the contract’s own parameter schema', async () => {
    const { port, body } = capture()
    await port.complete(input)

    const tools = body()['tools'] as Array<{ function: { parameters: unknown } }>
    expect(tools).toHaveLength(1)
    // Not `{type:'object'}`: the required arguments have to reach the model.
    expect(tools[0]?.function.parameters).toEqual(input.tools[0]?.parameters)
  })

  it('states the scope token so the model can echo it', async () => {
    const { port, body } = capture()
    await port.complete(input)

    const messages = body()['messages'] as Array<{ role: string; content: string }>
    const system = messages.find((message) => message.role === 'system')
    expect(system?.content).toContain('scope-token-abc')
  })

  it('sends the note so the first turn is not blind', async () => {
    const { port, body } = capture()
    await port.complete(input)

    const messages = body()['messages'] as Array<{ role: string; content: string }>
    expect(messages.some((message) => message.content.includes('The intro.'))).toBe(true)
  })

  it('omits reasoning_effort entirely at the endpoint default', async () => {
    const { port, body } = capture()
    await port.complete(input)

    // Not `reasoning_effort: 'default'`: an endpoint without the parameter must
    // be unaffected by a setting nobody changed.
    expect(body()).not.toHaveProperty('reasoning_effort')
  })

  it('sends a high-end level verbatim rather than clamping it', async () => {
    let sent: Record<string, unknown> | undefined
    const port = new OpenAiCompatibleAgentPort(
      async (_baseUrl, _apiKey, _model, requestBody) => {
        sent = requestBody as Record<string, unknown>
        return JSON.stringify({ choices: [{ message: { content: 'done' } }] })
      },
      () => ({
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'gpt-5.6-sol',
        reasoning: 'xhigh' as const,
      }),
    )

    await port.complete(input)
    // Which levels a given model accepts is model-dependent, so the endpoint
    // refuses an unsupported one. Clamping here would silently think less.
    expect(sent?.['reasoning_effort']).toBe('xhigh')
  })

  it('sends the chosen reasoning level', async () => {
    let sent: Record<string, unknown> | undefined
    const port = new OpenAiCompatibleAgentPort(
      async (_baseUrl, _apiKey, _model, requestBody) => {
        sent = requestBody as Record<string, unknown>
        return JSON.stringify({ choices: [{ message: { content: 'done' } }] })
      },
      () => ({
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'a-model',
        reasoning: 'high' as const,
      }),
    )

    await port.complete(input)
    expect(sent?.['reasoning_effort']).toBe('high')
  })

  it('refuses to call out at all when nothing is configured', async () => {
    let called = false
    const port = new OpenAiCompatibleAgentPort(
      async () => {
        called = true
        return ''
      },
      () => ({ apiKey: '', baseUrl: 'https://example.test/v1', model: 'a-model', reasoning: 'default' as const }),
    )

    await expect(port.complete(input)).resolves.toMatchObject({ kind: 'error' })
    expect(called).toBe(false)
  })
})
