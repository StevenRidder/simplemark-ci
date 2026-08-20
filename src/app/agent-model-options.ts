import { AGENT_DEFAULT_MODEL, AGENT_MODEL_PRESETS } from './agent-settings.js'

/**
 * What the Document agent's Model selector should show (APP-38).
 *
 * Pure, and separate from the panel, because the Settings panel has no
 * browser-mode entry point and so cannot be driven by Playwright. Leaving this
 * logic inline would mean the one part with real decisions in it — a stored id
 * the list has never heard of, a load that must not change the current choice —
 * shipped covered by nothing but the type checker.
 */

/** The sentinel option that reveals the free-text field. */
export const AGENT_MODEL_OTHER = '__other__'

export interface AgentModelOption {
  readonly value: string
  readonly label: string
  /** Set for ids the endpoint reported, so they can be grouped apart. */
  readonly fromEndpoint?: true
  readonly hint?: string
}

export interface AgentModelSelection {
  readonly options: readonly AgentModelOption[]
  /** The option to select. `AGENT_MODEL_OTHER` when the id is not listed. */
  readonly value: string
  /** The free-text field's contents; empty unless `value` is the sentinel. */
  readonly otherValue: string
}

export function agentModelOptions(input: {
  /** The stored model id. Empty means nothing chosen yet. */
  readonly selected: string
  /** Ids the endpoint reported this session. */
  readonly loaded?: readonly string[]
}): AgentModelSelection {
  const tiers = AGENT_MODEL_PRESETS.map((preset) => ({
    value: preset.id,
    label: `${preset.label} — ${preset.id}`,
    hint: preset.hint,
  }))
  const tierIds = new Set(tiers.map((tier) => tier.value))

  // Only what the endpoint actually reported. A stored id from neither source
  // belongs under `Other…`, not in a group claiming this endpoint offers it.
  const extras = [...new Set(input.loaded ?? [])]
    .filter((id) => !tierIds.has(id))
    .map((id) => ({ value: id, label: id, fromEndpoint: true as const }))

  const options: readonly AgentModelOption[] = [
    ...tiers,
    ...extras,
    { value: AGENT_MODEL_OTHER, label: 'Other…' },
  ]

  // Nothing stored yet: the named default, not whichever tier happens to be
  // first in the list.
  if (input.selected === '') {
    return { options, value: AGENT_DEFAULT_MODEL, otherValue: '' }
  }
  // Listed: select it directly.
  if (options.some((option) => option.value === input.selected)) {
    return { options, value: input.selected, otherValue: '' }
  }
  // Not listed. Keep it, visibly, rather than silently moving the reader to a
  // model they did not choose.
  return { options, value: AGENT_MODEL_OTHER, otherValue: input.selected }
}
