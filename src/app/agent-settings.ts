/**
 * Credentials for the in-document agent. Separate from diagram-repair
 * settings — the two jobs reasonably want different models.
 *
 * Plain localStorage, matching `ai-settings.ts`. Nothing here is written
 * into a `.md` file.
 */

import type { AgentConnection } from '../application/index.js'
import { isAgentConfigured } from '../application/index.js'

export type { AgentConnection }
export { isAgentConfigured }

export const DEFAULT_AGENT_CONNECTION: AgentConnection = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
}

function normaliseString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

export function normaliseAgentConnection(value: unknown): AgentConnection {
  if (typeof value !== 'object' || value === null) return DEFAULT_AGENT_CONNECTION
  const candidate = value as Partial<Record<keyof AgentConnection, unknown>>
  const baseUrl = normaliseString(candidate.baseUrl, DEFAULT_AGENT_CONNECTION.baseUrl).replace(/\/+$/, '')
  return {
    apiKey: normaliseString(candidate.apiKey, DEFAULT_AGENT_CONNECTION.apiKey),
    baseUrl: baseUrl === '' ? DEFAULT_AGENT_CONNECTION.baseUrl : baseUrl,
    model: normaliseString(candidate.model, DEFAULT_AGENT_CONNECTION.model),
  }
}

const AGENT_CONNECTION_KEY = 'simplemark.agent-connection'

export function loadAgentConnection(storage: Pick<Storage, 'getItem'>): AgentConnection {
  try {
    const raw = storage.getItem(AGENT_CONNECTION_KEY)
    return raw === null ? DEFAULT_AGENT_CONNECTION : normaliseAgentConnection(JSON.parse(raw))
  } catch {
    return DEFAULT_AGENT_CONNECTION
  }
}

export function saveAgentConnection(storage: Pick<Storage, 'setItem'>, settings: AgentConnection): void {
  try {
    storage.setItem(AGENT_CONNECTION_KEY, JSON.stringify(settings))
  } catch {
    // A key that cannot be persisted is not worth failing Settings over.
  }
}
