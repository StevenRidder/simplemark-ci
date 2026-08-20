import type {
  AgentConnection,
  AgentProviderInput,
  AgentProviderPort,
  AgentProviderTurn,
} from '../../application/index.js'
import { isAgentConfigured } from '../../application/index.js'

/**
 * One chat-completion round trip, given the whole request body.
 *
 * The body is opaque to the transport on purpose. The agent request carries
 * `tools` and `tool_choice`, so a transport that rebuilt the body from
 * `{model, messages}` — as the diagram-fix one does — would silently drop the
 * tool declarations and the model would answer in prose instead of calling
 * anything. Passing the body through is what keeps the packaged app's Rust hop
 * a transport rather than a second, lossy copy of the request shape.
 */
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
            // The token is stated, not alluded to. The authority refuses any
            // call whose scope is not the current one, so a model that has to
            // guess this value cannot make a single valid call — which is what
            // an earlier prompt saying only "the scope token is the where"
            // asked it to do.
            content: [
              'You edit one local Markdown note through tools.',
              `The scope token for this run is exactly: ${input.scope}`,
              'Pass that token as the `scope` argument of every tool that takes one.',
              'You supply the Markdown that changes. The authority owns the range —',
              'never invent, compute, or send a position, offset, or range.',
              'When the work is done, reply with plain text and call no further tool.',
            ].join(' '),
          },
          { role: 'user', content: `The note currently reads:\n\n${input.noteMarkdown}` },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
          })),
        ],
        // The declared parameters come from the application's own tool
        // contract. Declaring `{type:'object'}` here instead would hide every
        // required argument from the model.
        tools: input.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: 'auto',
        // Omitted entirely at `default`, so an endpoint with no such parameter
        // is unaffected. A level it rejects comes back as its own error rather
        // than being dropped — a run that quietly thought less than it was
        // asked to is worse than one that says the setting is unsupported.
        ...(settings.reasoning === 'default' ? {} : { reasoning_effort: settings.reasoning }),
      })
      return parseAgentCompletion(responseText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/tool/i.test(message)) return { kind: 'unsupported', message }
      return { kind: 'error', message }
    }
  }
}
