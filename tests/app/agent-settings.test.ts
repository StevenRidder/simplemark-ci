import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_CONNECTION,
  isAgentConfigured,
  loadAgentConnection,
  normaliseAgentConnection,
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
  it('does not share the diagram-repair settings key', () => {
    const storage = fakeStorage()
    saveAiSettings(storage, { apiKey: 'diagram', baseUrl: 'https://diagram.test', model: 'd-model' })
    saveAgentConnection(storage, { apiKey: 'agent', baseUrl: 'https://agent.test', model: 'a-model' })
    expect(loadAiSettings(storage)).toEqual({
      apiKey: 'diagram',
      baseUrl: 'https://diagram.test',
      model: 'd-model',
    })
    expect(loadAgentConnection(storage)).toEqual({
      apiKey: 'agent',
      baseUrl: 'https://agent.test',
      model: 'a-model',
    })
  })

  it('falls back to defaults for garbage input', () => {
    expect(normaliseAgentConnection(null)).toEqual(DEFAULT_AGENT_CONNECTION)
    expect(isAgentConfigured(DEFAULT_AGENT_CONNECTION)).toBe(false)
  })
})
