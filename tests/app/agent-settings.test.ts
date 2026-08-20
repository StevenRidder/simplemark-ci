import { describe, expect, it } from 'vitest'

import {
  AGENT_MODEL_PRESETS,
  AGENT_REASONING_LEVELS,
  DEFAULT_AGENT_CONNECTION,
  DEFAULT_STORED_AGENT_CONNECTION,
  isAgentConfigured,
  loadStoredAgentConnection,
  normaliseAgentConnection,
  resolveAgentConnection,
  saveAgentConnection,
} from '../../src/app/agent-settings.js'
import { loadAiSettings, saveAiSettings } from '../../src/app/ai-settings.js'

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial }
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage
}

describe('agent connection storage', () => {
  it('keeps its own record separate from the diagram-repair one', () => {
    const storage = fakeStorage()
    saveAiSettings(storage, { apiKey: 'diagram', baseUrl: 'https://diagram.test', model: 'd-model' })
    saveAgentConnection(storage, {
      apiKey: 'agent',
      baseUrl: 'https://agent.test',
      model: 'a-model',
      reasoning: 'high',
      shareCredentials: false,
    })

    expect(loadAiSettings(storage)).toEqual({
      apiKey: 'diagram',
      baseUrl: 'https://diagram.test',
      model: 'd-model',
    })
    // Sharing off: the agent's own key and endpoint apply, untouched.
    expect(resolveAgentConnection(storage)).toEqual({
      apiKey: 'agent',
      baseUrl: 'https://agent.test',
      model: 'a-model',
      reasoning: 'high',
    })
  })

  it('shares the key and endpoint while keeping its own model', () => {
    const storage = fakeStorage()
    saveAiSettings(storage, { apiKey: 'diagram', baseUrl: 'https://diagram.test', model: 'd-model' })
    saveAgentConnection(storage, {
      ...DEFAULT_STORED_AGENT_CONNECTION,
      model: 'a-model',
      reasoning: 'low',
    })

    expect(resolveAgentConnection(storage)).toEqual({
      apiKey: 'diagram',
      baseUrl: 'https://diagram.test',
      // The separate record exists for this: same account, different model.
      model: 'a-model',
      reasoning: 'low',
    })
  })

  it('falls back to the shared model when the agent has not chosen one', () => {
    const storage = fakeStorage()
    saveAiSettings(storage, { apiKey: 'diagram', baseUrl: 'https://diagram.test', model: 'd-model' })

    // Nothing stored for the agent at all: sharing is the default, so a person
    // who configured diagram fix already has a working agent.
    expect(resolveAgentConnection(storage)).toEqual({
      apiKey: 'diagram',
      baseUrl: 'https://diagram.test',
      model: 'd-model',
      reasoning: 'default',
    })
    expect(isAgentConfigured(resolveAgentConnection(storage))).toBe(true)
  })

  it('is unconfigured when the shared key is empty, rather than half-working', () => {
    const storage = fakeStorage()
    expect(isAgentConfigured(resolveAgentConnection(storage))).toBe(false)
  })

  it('rejects an unknown reasoning level instead of passing it through', () => {
    expect(normaliseAgentConnection({ reasoning: 'ludicrous' }).reasoning).toBe('default')
    expect(normaliseAgentConnection({ reasoning: 'medium' }).reasoning).toBe('medium')
  })

  it('carries the documented reasoning_effort values, plus our own default', () => {
    // The chat-completions set is none | minimal | low | medium | high | xhigh
    // | max. `default` is ours and means "send no reasoning_effort at all".
    expect([...AGENT_REASONING_LEVELS]).toEqual([
      'default',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    for (const level of AGENT_REASONING_LEVELS) {
      expect(normaliseAgentConnection({ reasoning: level }).reasoning).toBe(level)
    }
  })

  it('offers the three GPT-5.6 tiers by their explicit ids', () => {
    // Explicit ids, not the bare `gpt-5.6` alias: the alias routes to Sol today
    // and naming the tier survives it moving.
    expect(AGENT_MODEL_PRESETS.map((preset) => preset.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ])
    expect(AGENT_MODEL_PRESETS.map((preset) => preset.label)).toEqual(['Sol', 'Terra', 'Luna'])
  })

  it('falls back to defaults for garbage input', () => {
    expect(normaliseAgentConnection(null)).toEqual(DEFAULT_STORED_AGENT_CONNECTION)
    expect(isAgentConfigured(DEFAULT_AGENT_CONNECTION)).toBe(false)
    expect(loadStoredAgentConnection(fakeStorage({ 'simplemark.agent-connection': '{' })))
      .toEqual(DEFAULT_STORED_AGENT_CONNECTION)
  })
})
