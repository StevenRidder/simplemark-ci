import { describe, expect, it } from 'vitest'

import { OpenAiCompatibleDiagramFixPort } from '../../src/adapters/ai/openai-compatible-diagram-fix.js'
import type { AiSettings } from '../../src/app/ai-settings.js'

const CONFIGURED: AiSettings = { apiKey: 'sk-abc', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }

function chatCompletionResponse(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] })
}

describe('fixMarkdown', () => {
  it('keeps the fences the model returned, since they are the fix', async () => {
    // The diagram path strips an outer fence from the reply. A Markdown-span
    // repair legitimately opens and closes with fences, so stripping would
    // remove the exact delimiters that make the diagram parse.
    const corrected = '```mermaid\nflowchart LR\n  A --> B\n```'
    const port = new OpenAiCompatibleDiagramFixPort(
      async () => chatCompletionResponse(corrected),
      () => CONFIGURED,
    )

    const result = await port.fixMarkdown('complaint')

    expect(result).toEqual({ ok: true, source: corrected })
  })

  it('sends the complaint verbatim as the user turn', async () => {
    let sent = ''
    const port = new OpenAiCompatibleDiagramFixPort(
      async (_baseUrl, _apiKey, _model, messages) => {
        sent = messages[1]?.content ?? ''
        return chatCompletionResponse('```mermaid\nA\n```')
      },
      () => CONFIGURED,
    )

    await port.fixMarkdown('the whole before-and-after complaint')

    expect(sent).toBe('the whole before-and-after complaint')
  })
})
