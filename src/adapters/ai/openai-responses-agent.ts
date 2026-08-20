import type {
  AgentConnection,
  AgentMessage,
  AgentProviderInput,
  AgentProviderPort,
  AgentProviderTurn,
} from '../../application/index.js'
import { isAgentConfigured } from '../../application/index.js'

/**
 * The document agent over `/v1/responses` (AGENT-11).
 *
 * Chat completions cannot carry function tools and a reasoning level together
 * for this model — the endpoint says so outright:
 *
 *   Function tools with reasoning_effort are not supported for gpt-5.6-luna in
 *   /v1/chat/completions. To use function tools, use /v1/responses or set
 *   reasoning_effort to 'none'.
 *
 * The agent needs both: tools are how it edits anything, and effort is a control
 * the operator asked for. So the agent moves here. Diagram repair stays on chat
 * completions — it sends no tools and is unaffected.
 *
 * Four differences from the chat-completions shape, and every one of them is a
 * silent failure if guessed wrong:
 *
 * - A function tool is flat: `{type, name, description, parameters}`. There is no
 *   `function` wrapper.
 * - Reasoning is an object, `reasoning: { effort }`, not a flat field.
 * - History is `input`, and a tool exchange is two items: `function_call` with
 *   `call_id`, `name` and a JSON-**string** `arguments`, then
 *   `function_call_output` with the same `call_id` and an `output`.
 * - The reply arrives in `output[]`, not `choices[]`.
 */

export type AgentResponsesTransport = (
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

/** Arguments arrive as a JSON string; a malformed one is an error, not `{}`. */
function parseArguments(raw: unknown): { ok: true; args: unknown } | { ok: false } {
  const text = asString(raw)
  if (text === undefined) return { ok: false }
  if (text.trim() === '') return { ok: true, args: {} }
  try {
    return { ok: true, args: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** The visible text of a `message` item, from its `output_text` parts. */
function messageText(item: Record<string, unknown>): string | undefined {
  const content = item['content']
  if (!Array.isArray(content)) return undefined
  const parts = content
    .map((part) => recordOf(part))
    .filter((part): part is Record<string, unknown> => part !== undefined)
    .filter((part) => part['type'] === 'output_text' || part['type'] === 'text')
    .map((part) => asString(part['text']) ?? '')
  return parts.length === 0 ? undefined : parts.join('')
}

/**
 * One `/v1/responses` reply as a provider turn.
 *
 * A tool call wins over text when both are present: the model saying what it is
 * about to do and then doing it is one turn, and answering with the prose would
 * drop the edit.
 */
export function parseResponsesReply(responseText: string): AgentProviderTurn {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return { kind: 'error', message: 'The API response was not valid JSON.' }
  }

  const root = recordOf(parsed)
  if (root === undefined) return { kind: 'error', message: 'The API response was not an object.' }

  const error = recordOf(root['error'])
  const errorMessage = asString(error?.['message'])
  if (errorMessage !== undefined) {
    // The endpoint's own refusals are the most useful thing it can say, so they
    // are passed through verbatim rather than summarised away.
    if (/tool|function/i.test(errorMessage) && /support/i.test(errorMessage)) {
      return { kind: 'unsupported', message: errorMessage }
    }
    return { kind: 'error', message: errorMessage }
  }

  const output = root['output']
  if (!Array.isArray(output)) {
    return { kind: 'error', message: 'The API response did not include an output array.' }
  }

  const items = output
    .map((item) => recordOf(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)

  const call = items.find((item) => item['type'] === 'function_call')
  if (call !== undefined) {
    const id = asString(call['call_id']) ?? asString(call['id'])
    const name = asString(call['name'])
    if (id === undefined || name === undefined) {
      return { kind: 'error', message: 'A function call arrived without a call id or name.' }
    }
    const args = parseArguments(call['arguments'])
    if (!args.ok) {
      return { kind: 'error', message: `The arguments for ${name} were not valid JSON.` }
    }
    return { kind: 'tool', id, name, args: args.args }
  }

  for (const item of items) {
    if (item['type'] !== 'message' && item['type'] !== 'output_text') continue
    const text = item['type'] === 'message' ? messageText(item) : asString(item['text'])
    if (text !== undefined && text !== '') return { kind: 'text', text }
  }

  const topLevelText = asString(root['output_text'])
  if (topLevelText !== undefined && topLevelText !== '') {
    return { kind: 'text', text: topLevelText }
  }

  // Reasoning-only output with nothing else is not an answer; saying so beats
  // reporting an empty success.
  return { kind: 'error', message: 'The model returned no message and no tool call.' }
}

/**
 * The conversation as `input` items.
 *
 * An assistant tool turn becomes a `function_call` rebuilt from the name and
 * arguments the transcript carries, and its result becomes a
 * `function_call_output` under the same `call_id`. Sending the result without
 * the call it answers is what makes a second turn fail.
 */
export function responsesInput(messages: readonly AgentMessage[]): readonly unknown[] {
  const items: unknown[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.toolCallId ?? '',
        output: message.content,
      })
      continue
    }
    if (message.role === 'assistant' && message.toolName !== undefined) {
      items.push({
        type: 'function_call',
        call_id: message.toolCallId ?? '',
        name: message.toolName,
        // A JSON string, not an object: the field is `arguments`, and the API
        // reads it as text.
        arguments: JSON.stringify(message.toolArgs ?? {}),
      })
      continue
    }
    items.push({ role: message.role, content: message.content })
  }
  return items
}

export class OpenAiResponsesAgentPort implements AgentProviderPort {
  constructor(
    private readonly transport: AgentResponsesTransport,
    private readonly getConnection: () => AgentConnection,
  ) {}

  async complete(input: AgentProviderInput): Promise<AgentProviderTurn> {
    const settings = this.getConnection()
    if (!isAgentConfigured(settings)) {
      return {
        kind: 'error',
        message: 'Add a document-agent key in Settings before invoking an agent.',
      }
    }

    try {
      const responseText = await this.transport(settings.baseUrl, settings.apiKey, settings.model, {
        model: settings.model,
        // `instructions` is this endpoint's system channel. The scope token is
        // stated rather than alluded to: the authority refuses any call whose
        // scope is not current, so a model made to guess it cannot make one
        // valid call.
        instructions: [
          'You edit one local Markdown note through tools.',
          `The scope token for this run is exactly: ${input.scope}`,
          'Pass that token as the `scope` argument of every tool that takes one.',
          'You supply the Markdown that changes. The authority owns the range —',
          'never invent, compute, or send a position, offset, or range.',
          // AGENT-12: without this the model writes walls of prose into the
          // document while happily bulleting the same content in its replies.
          'Write in the note’s own Markdown idiom: use headings, bullet',
          'lists, emphasis, and tables where they aid reading — reasons,',
          'steps, and comparisons belong in lists, not paragraphs of prose.',
          'When the work is done, reply with plain text and call no further tool.',
        ].join(' '),
        input: [
          { role: 'user', content: `The note currently reads:\n\n${input.noteMarkdown}` },
          ...responsesInput(input.messages),
        ],
        // Flat, with no `function` wrapper — the Responses shape.
        tools: input.tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        tool_choice: 'auto',
        // An object here, unlike chat completions' flat `reasoning_effort`.
        // Omitted entirely at `default`, so a model with its own default is
        // untouched and one without the parameter is unaffected.
        ...(settings.reasoning === 'default' ? {} : { reasoning: { effort: settings.reasoning } }),
      })
      return parseResponsesReply(responseText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/tool|function/i.test(message) && /support/i.test(message)) {
        return { kind: 'unsupported', message }
      }
      return { kind: 'error', message }
    }
  }
}
