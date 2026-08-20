/**
 * Credentials and model choice for the in-document agent.
 *
 * Shares the diagram-fix key and endpoint by default, because they are almost
 * always the same account: the reason AGENT-8 kept a separate record is that
 * repairing a diagram and rewriting a paragraph reasonably want different
 * *models*, not different providers. Sharing is a stored, visible choice — turn
 * it off and the agent's own key and endpoint apply — never an invisible reach
 * into another feature's settings.
 *
 * Plain localStorage, matching `ai-settings.ts`. Nothing here is written into a
 * `.md` file.
 */

import type { AgentConnection, AgentReasoning } from '../application/index.js'
import { AGENT_REASONING_LEVELS, isAgentConfigured } from '../application/index.js'
import { loadAiSettings } from './ai-settings.js'

export type { AgentConnection, AgentReasoning }
export { isAgentConfigured, AGENT_REASONING_LEVELS }

/** What is stored, before the shared-credential resolution is applied. */
export interface StoredAgentConnection extends AgentConnection {
  /** Take the key and endpoint from the diagram-fix settings. */
  readonly shareCredentials: boolean
}

export const DEFAULT_AGENT_CONNECTION: AgentConnection = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  reasoning: 'default',
}

export const DEFAULT_STORED_AGENT_CONNECTION: StoredAgentConnection = {
  ...DEFAULT_AGENT_CONNECTION,
  // On by default so a person who has already configured diagram fix has a
  // working agent without entering the same key twice.
  shareCredentials: true,
}

function normaliseString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function normaliseReasoning(value: unknown): AgentReasoning {
  return AGENT_REASONING_LEVELS.includes(value as AgentReasoning)
    ? (value as AgentReasoning)
    : 'default'
}

export function normaliseAgentConnection(value: unknown): StoredAgentConnection {
  if (typeof value !== 'object' || value === null) return DEFAULT_STORED_AGENT_CONNECTION
  const candidate = value as Partial<Record<keyof StoredAgentConnection, unknown>>
  const baseUrl = normaliseString(candidate.baseUrl, DEFAULT_AGENT_CONNECTION.baseUrl).replace(/\/+$/, '')
  return {
    apiKey: normaliseString(candidate.apiKey, DEFAULT_AGENT_CONNECTION.apiKey),
    baseUrl: baseUrl === '' ? DEFAULT_AGENT_CONNECTION.baseUrl : baseUrl,
    model: normaliseString(candidate.model, DEFAULT_AGENT_CONNECTION.model),
    reasoning: normaliseReasoning(candidate.reasoning),
    shareCredentials: candidate.shareCredentials !== false,
  }
}

/**
 * The GPT-5.6 tiers, as one-click presets for the Model field.
 *
 * Conveniences, not a whitelist: the field stays free text and the Load models
 * button still lists whatever the endpoint actually offers, so a model that is
 * not here — a different generation, a different provider — is unaffected. The
 * ids are the documented explicit ones; the bare `gpt-5.6` alias routes to Sol,
 * and naming the tier is worth more than inheriting whatever the alias moves to.
 */
export interface AgentModelPreset {
  readonly id: string
  readonly label: string
  readonly hint: string
}

/**
 * Where the selector lands when nothing has been chosen.
 *
 * Luna: the fast, cheap tier is the right default for editing a paragraph, and
 * the operator confirmed it. Named rather than positional so reordering the
 * list cannot change the default.
 */
export const AGENT_DEFAULT_MODEL = 'gpt-5.6-luna'

export const AGENT_MODEL_PRESETS: readonly AgentModelPreset[] = [
  { id: 'gpt-5.6-sol', label: 'Sol', hint: 'Flagship. The most capable, and the slowest.' },
  { id: 'gpt-5.6-terra', label: 'Terra', hint: 'Balanced everyday model.' },
  { id: 'gpt-5.6-luna', label: 'Luna', hint: 'Fastest and cheapest.' },
]

const AGENT_CONNECTION_KEY = 'simplemark.agent-connection'

/** The record as stored, for the Settings panel to edit. */
export function loadStoredAgentConnection(
  storage: Pick<Storage, 'getItem'>,
): StoredAgentConnection {
  try {
    const raw = storage.getItem(AGENT_CONNECTION_KEY)
    return raw === null
      ? DEFAULT_STORED_AGENT_CONNECTION
      : normaliseAgentConnection(JSON.parse(raw))
  } catch {
    return DEFAULT_STORED_AGENT_CONNECTION
  }
}

/**
 * The connection a run should actually use.
 *
 * Sharing substitutes the diagram-fix key and endpoint, and an empty agent model
 * falls back to the diagram-fix one so the feature is reachable without a second
 * round of setup. The model is still the agent's own to change, which is the
 * whole point of keeping a separate record.
 */
export function resolveAgentConnection(storage: Pick<Storage, 'getItem'>): AgentConnection {
  const stored = loadStoredAgentConnection(storage)
  if (!stored.shareCredentials) {
    const { shareCredentials: _shared, ...own } = stored
    return own
  }
  const shared = loadAiSettings(storage)
  return {
    apiKey: shared.apiKey,
    baseUrl: shared.baseUrl === '' ? stored.baseUrl : shared.baseUrl,
    model: stored.model === '' ? shared.model : stored.model,
    reasoning: stored.reasoning,
  }
}

/** Kept for callers that only want the effective connection. */
export function loadAgentConnection(storage: Pick<Storage, 'getItem'>): AgentConnection {
  return resolveAgentConnection(storage)
}

export function saveAgentConnection(
  storage: Pick<Storage, 'setItem'>,
  settings: StoredAgentConnection,
): void {
  try {
    storage.setItem(AGENT_CONNECTION_KEY, JSON.stringify(settings))
  } catch {
    // A key that cannot be persisted is not worth failing Settings over.
  }
}
