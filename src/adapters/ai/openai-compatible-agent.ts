import type {
  AgentConnection,
  AgentProviderInput,
  AgentProviderPort,
  AgentProviderTurn,
} from '../../application/index.js'
import { isAgentConfigured } from '../../application/index.js'

export type AgentCompletionTransport = (
  baseUrl: string,
  apiKey: string,
  model: string,
  body: unknown,
) => Promise<string>

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * One OpenAI-shape chat completion that may include a tool call.
 *
 * A model or endpoint that cannot call tools fails here, rather than
 * degrading into pasting Markdown at the person.
 */
export function parseAgentCompletion(responseText: string): AgentProviderTurn {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return { kind: 'error', message: 'The API response was not valid JSON.' }
  }

  const root = recordOf(parsed)
  if (root === undefined) return { kind: 'error', message: 'The API response was not an object.' }

  const error = recordOf(root.error)
  const errorMessage = asString(error?.message)
  if (errorMessage !== undefined) {
    if (/tool/i.test(errorMessage)) return { kind: 'unsupported', message: errorMessage }
    return { kind: 'error', message: errorMessage }
  }

  const choices = root.choices
  const choice = Array.isArray(choices) ? recordOf(choices[0]) : undefined
  const message = recordOf(choice?.message)
  if (message === undefined) {
    return { kind: 'error', message: 'The API response did not include a message.' }
  }

  const toolCalls = message.tool_calls
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const call = recordOf(toolCalls[0])
    const fn = recordOf(call?.function)
    const name = asString(fn?.name)
    const id = asString(call?.id) ?? 'tool-call'
    if (name === undefined) return { kind: 'error', message: 'The tool call had no name.' }
    let args: unknown = {}
    const rawArgs = asString(fn?.arguments)
    if (rawArgs !== undefined && rawArgs !== '') {
      try {
        args = JSON.parse(rawArgs) as unknown
      } catch {
        return { kind: 'error', message: 'The tool call arguments were not valid JSON.' }
      }
    }
    return { kind: 'tool', id, name, args }
  }

  const content = asString(message.content)?.trim()
  if (content === undefined || content === '') {
    return { kind: 'error', message: 'The API returned an empty answer.' }
  }
  return { kind: 'text', text: content }
}

export class OpenAiCompatibleAgentPort implements AgentProviderPort {
  constructor(
    private readonly transport: AgentCompletionTransport,
    private readonly getConnection: () => AgentConnection,
  ) {}

  async complete(input: AgentProviderInput): Promise<AgentProviderTurn> {
    const settings = this.getConnection()
    if (!isAgentConfigured(settings)) {
      return { kind: 'error', message: 'Add a document-agent key in Settings before invoking an agent.' }
    }
    try {
      const responseText = await this.transport(settings.baseUrl, settings.apiKey, settings.model, {
        model: settings.model,
        messages: [
          {
            role: 'system',
            content:
              'You edit one local Markdown note through tools. The scope token is the where. You supply the Markdown that changes. Never invent a range.',
          },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
          })),
        ],
        tools: input.tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: { type: 'object' } },
        })),
        tool_choice: 'auto',
      })
      return parseAgentCompletion(responseText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/tool/i.test(message)) return { kind: 'unsupported', message }
      return { kind: 'error', message }
    }
  }
}
