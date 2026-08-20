import { describe, expect, test } from 'vitest'

import { AGENT_MODEL_OTHER, agentModelOptions } from '../../src/app/agent-model-options.js'
import { AGENT_DEFAULT_MODEL } from '../../src/app/agent-settings.js'

const values = (selected: string, loaded?: readonly string[]): readonly string[] =>
  agentModelOptions({ selected, ...(loaded === undefined ? {} : { loaded }) })
    .options.map((option) => option.value)

describe('agentModelOptions', () => {
  test('always offers the three named tiers, whatever the endpoint says', () => {
    // The tiers do not depend on a successful model load, so a failed load
    // still leaves a usable selector.
    expect(values('')).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      AGENT_MODEL_OTHER,
    ])
  })

  test('lands on the named default when nothing is stored', () => {
    const plan = agentModelOptions({ selected: '' })
    expect(plan.value).toBe(AGENT_DEFAULT_MODEL)
    expect(plan.value).toBe('gpt-5.6-luna')
    expect(plan.otherValue).toBe('')
  })

  test('selects a stored tier directly', () => {
    const plan = agentModelOptions({ selected: 'gpt-5.6-sol' })
    expect(plan.value).toBe('gpt-5.6-sol')
    expect(plan.otherValue).toBe('')
  })

  test('adds endpoint models without duplicating the tiers', () => {
    const plan = agentModelOptions({
      selected: '',
      loaded: ['gpt-5.6-luna', 'o4-mini', 'o4-mini', 'some-local-model'],
    })
    expect(plan.options.map((option) => option.value)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'o4-mini',
      'some-local-model',
      AGENT_MODEL_OTHER,
    ])
    // Grouped apart, so "this endpoint offers it" is only claimed of ids it did.
    expect(plan.options.filter((option) => option.fromEndpoint === true).map((o) => o.value))
      .toEqual(['o4-mini', 'some-local-model'])
  })

  test('an unknown stored id falls to Other rather than being replaced', () => {
    // The failure this prevents: opening Settings silently moving somebody from
    // their deliberately-set model onto a tier.
    const plan = agentModelOptions({ selected: 'my-self-hosted-thing' })
    expect(plan.value).toBe(AGENT_MODEL_OTHER)
    expect(plan.otherValue).toBe('my-self-hosted-thing')
  })

  test('an id the endpoint reported is selected directly, not as Other', () => {
    const plan = agentModelOptions({ selected: 'o4-mini', loaded: ['o4-mini'] })
    expect(plan.value).toBe('o4-mini')
    expect(plan.otherValue).toBe('')
  })

  test('loading a list does not change what is chosen', () => {
    const before = agentModelOptions({ selected: 'gpt-5.6-terra' })
    const after = agentModelOptions({ selected: 'gpt-5.6-terra', loaded: ['o4-mini', 'gpt-4o'] })
    expect(after.value).toBe(before.value)
    expect(after.options.length).toBeGreaterThan(before.options.length)
  })

  test('Other is always last, so the list never ends on a real model', () => {
    for (const loaded of [undefined, [], ['x'], ['x', 'y']]) {
      const list = values('', loaded)
      expect(list.at(-1)).toBe(AGENT_MODEL_OTHER)
    }
  })
})
