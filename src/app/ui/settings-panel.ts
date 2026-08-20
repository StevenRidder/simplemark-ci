import type { ModelListTransport } from '../../adapters/ai/openai-compatible-diagram-fix.js'
import { listModels } from '../../adapters/ai/openai-compatible-diagram-fix.js'
import { AGENT_MODEL_OTHER, agentModelOptions } from '../agent-model-options.js'
import {
  AGENT_REASONING_LEVELS,
  loadStoredAgentConnection,
  normaliseAgentConnection,
  saveAgentConnection,
} from '../agent-settings.js'
import { loadAiSettings, normaliseAiSettings, saveAiSettings } from '../ai-settings.js'

export interface SettingsPanel {
  readonly element: HTMLElement
  open(): void
  close(): void
  toggle(): void
}

export interface SettingsPanelOptions {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  /** Backs the "Load models" button next to the Model field. */
  readonly listModels: ModelListTransport
}

function field(label: string, type: string, placeholder: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label')
  row.className = 'settings-field'
  const name = document.createElement('span')
  name.className = 'settings-field-label'
  name.textContent = label
  const input = document.createElement('input')
  input.type = type
  input.placeholder = placeholder
  input.spellcheck = false
  input.autocomplete = 'off'
  row.append(name, input)
  return { row, input }
}

/**
 * The app's one Settings surface today: the AI diagram fix-it credentials.
 *
 * A centred overlay rather than the "Aa" popover's floating-aside style —
 * this is a form the user fills in once, not something read while editing,
 * so it earns the modal attention a popover deliberately avoids.
 */
export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanel {
  const overlay = document.createElement('div')
  overlay.className = 'settings-overlay'
  overlay.hidden = true

  const panel = document.createElement('section')
  panel.className = 'settings-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Settings')

  const header = document.createElement('header')
  header.className = 'settings-header'
  const title = document.createElement('span')
  title.className = 'settings-title'
  title.textContent = 'Settings'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'settings-close'
  close.textContent = '✕'
  close.title = 'Close (Esc)'
  close.setAttribute('aria-label', 'Close settings')
  close.addEventListener('click', (event) => {
    event.preventDefault()
    closePanel()
  })
  header.append(title, close)

  const body = document.createElement('div')
  body.className = 'settings-body'

  const sectionTitle = document.createElement('h3')
  sectionTitle.textContent = 'AI diagram fix'
  const sectionHint = document.createElement('p')
  sectionHint.className = 'settings-hint'
  sectionHint.textContent =
    'Used by the "Fix it" button on a broken diagram. Stored locally on this device, not encrypted.'

  const apiKeyField = field('API key', 'password', 'sk-…')
  const baseUrlField = field('Base URL', 'text', 'https://api.openai.com/v1')
  const modelField = field('Model', 'text', 'e.g. gpt-4o')

  const loadModelsRow = document.createElement('div')
  loadModelsRow.className = 'settings-load-models-row'
  const loadModelsButton = document.createElement('button')
  loadModelsButton.type = 'button'
  loadModelsButton.className = 'settings-load-models'
  loadModelsButton.textContent = 'Load models'
  loadModelsRow.append(loadModelsButton)

  const modelSelect = document.createElement('select')
  modelSelect.className = 'settings-model-select'
  modelSelect.hidden = true
  modelSelect.setAttribute('aria-label', 'Pick a model')

  const modelError = document.createElement('p')
  modelError.className = 'settings-model-error'
  modelError.hidden = true

  function refreshLoadModelsAvailability(): void {
    loadModelsButton.disabled =
      apiKeyField.input.value.trim() === '' || baseUrlField.input.value.trim() === ''
  }
  apiKeyField.input.addEventListener('input', refreshLoadModelsAvailability)
  baseUrlField.input.addEventListener('input', refreshLoadModelsAvailability)

  async function handleLoadModels(): Promise<void> {
    const effective = normaliseAiSettings({
      apiKey: apiKeyField.input.value,
      baseUrl: baseUrlField.input.value,
    })
    modelError.hidden = true
    modelSelect.hidden = true
    loadModelsButton.disabled = true
    loadModelsButton.textContent = 'Loading…'
    const result = await listModels(options.listModels, effective.baseUrl, effective.apiKey)
    loadModelsButton.textContent = 'Load models'
    refreshLoadModelsAvailability()

    if (!result.ok) {
      modelError.textContent = `Couldn't load models — ${result.message}. You can still type one.`
      modelError.hidden = false
      return
    }
    modelSelect.replaceChildren()
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = `Pick from ${result.models.length} model${result.models.length === 1 ? '' : 's'}…`
    placeholder.disabled = true
    placeholder.selected = true
    modelSelect.append(placeholder, ...result.models.map((id) => {
      const option = document.createElement('option')
      option.value = id
      option.textContent = id
      return option
    }))
    modelSelect.hidden = false
  }
  loadModelsButton.addEventListener('click', (event) => {
    event.preventDefault()
    void handleLoadModels()
  })
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value !== '') modelField.input.value = modelSelect.value
  })

  const agentTitle = document.createElement('h3')
  agentTitle.textContent = 'Document agent'
  const agentHint = document.createElement('p')
  agentHint.className = 'settings-hint'
  agentHint.textContent =
    'Used when an agent edits the open note. Shares the key above by default — the separate record exists so this job can use a different model.'

  // Sharing is a visible, stored choice. Reaching into the diagram settings
  // without saying so would be exactly the invisible behaviour this app's rules
  // forbid, however convenient it looks.
  const agentShareRow = document.createElement('label')
  agentShareRow.className = 'settings-field settings-field-check'
  const agentShare = document.createElement('input')
  agentShare.type = 'checkbox'
  agentShare.dataset['field'] = 'agent-share'
  const agentShareLabel = document.createElement('span')
  agentShareLabel.className = 'settings-field-label'
  agentShareLabel.textContent = 'Use the same key and base URL as above'
  agentShareRow.append(agentShare, agentShareLabel)

  const agentKeyField = field('API key', 'password', 'sk-…')
  const agentUrlField = field('Base URL', 'text', 'https://api.openai.com/v1')
  /**
   * Model is a selector, not a text box.
   *
   * Naming a tier is a choice from a short list, and typing `gpt-5.6-terra`
   * correctly is not part of that choice. The named tiers are always present,
   * whatever the endpoint answers; Load models adds the rest of what it offers;
   * and `Other…` keeps any id the list cannot know reachable, so the selector
   * never becomes a smaller set of options than the field it replaced.
   *
   * Which options and which selection is decided by `agentModelOptions`, which
   * is unit-tested; this only renders the answer.
   */
  const agentModelRowField = document.createElement('label')
  agentModelRowField.className = 'settings-field'
  const agentModelLabel = document.createElement('span')
  agentModelLabel.className = 'settings-field-label'
  agentModelLabel.textContent = 'Model'
  const agentModelSelect = document.createElement('select')
  agentModelSelect.dataset['field'] = 'agent-model'
  agentModelRowField.append(agentModelLabel, agentModelSelect)

  const agentModelOther = field('Other model id', 'text', 'e.g. gpt-4o')
  agentModelOther.input.dataset['field'] = 'agent-model-other'
  agentModelOther.row.hidden = true

  /** Ids the endpoint reported this session, beyond the named tiers. */
  let agentLoadedModels: readonly string[] = []

  /** The model id the panel would save. */
  function agentModelValue(): string {
    return agentModelSelect.value === AGENT_MODEL_OTHER
      ? agentModelOther.input.value.trim()
      : agentModelSelect.value
  }

  /**
   * Rebuilds the options, keeping `selected` selectable even when neither the
   * tiers nor the endpoint list carry it — otherwise opening Settings would
   * quietly change a model somebody had deliberately set.
   */
  function paintAgentModels(selected: string): void {
    const plan = agentModelOptions({ selected, loaded: agentLoadedModels })

    agentModelSelect.replaceChildren()
    let endpointGroup: HTMLOptGroupElement | undefined
    for (const candidate of plan.options) {
      const option = document.createElement('option')
      option.value = candidate.value
      option.textContent = candidate.label
      if (candidate.hint !== undefined) option.title = candidate.hint
      if (candidate.fromEndpoint !== true) {
        agentModelSelect.append(option)
        continue
      }
      if (endpointGroup === undefined) {
        endpointGroup = document.createElement('optgroup')
        endpointGroup.label = 'Other models on this endpoint'
        agentModelSelect.append(endpointGroup)
      }
      endpointGroup.append(option)
    }

    agentModelSelect.value = plan.value
    if (plan.otherValue !== '') agentModelOther.input.value = plan.otherValue
    agentModelOther.row.hidden = plan.value !== AGENT_MODEL_OTHER
  }

  agentModelSelect.addEventListener('change', () => {
    agentModelOther.row.hidden = agentModelSelect.value !== AGENT_MODEL_OTHER
    if (agentModelSelect.value === AGENT_MODEL_OTHER) agentModelOther.input.focus()
  })

  const agentModelRow = document.createElement('div')
  agentModelRow.className = 'settings-model-row'
  const agentLoadModels = document.createElement('button')
  agentLoadModels.type = 'button'
  agentLoadModels.className = 'settings-load-models'
  agentLoadModels.dataset['action'] = 'agent-load-models'
  agentLoadModels.textContent = 'Load models'
  agentModelRow.append(agentLoadModels)

  const agentModelError = document.createElement('p')
  agentModelError.className = 'settings-model-error'
  agentModelError.hidden = true

  const agentReasoningRow = document.createElement('label')
  agentReasoningRow.className = 'settings-field'
  const agentReasoningLabel = document.createElement('span')
  agentReasoningLabel.className = 'settings-field-label'
  agentReasoningLabel.textContent = 'Reasoning'
  const agentReasoning = document.createElement('select')
  agentReasoning.dataset['field'] = 'agent-reasoning'
  for (const level of AGENT_REASONING_LEVELS) {
    const option = document.createElement('option')
    option.value = level
    // `default` sends no reasoning parameter at all, which is the only honest
    // label for an endpoint that may not have one.
    option.textContent = level === 'default' ? 'Endpoint default' : level
    agentReasoning.append(option)
  }
  agentReasoningRow.append(agentReasoningLabel, agentReasoning)

  /** Which key and endpoint the agent's own model list should be fetched with. */
  const agentCredentials = (): { apiKey: string; baseUrl: string } =>
    agentShare.checked
      ? { apiKey: apiKeyField.input.value, baseUrl: baseUrlField.input.value }
      : { apiKey: agentKeyField.input.value, baseUrl: agentUrlField.input.value }

  function refreshAgentFields(): void {
    // Disabled rather than hidden: a reader can see what sharing is standing in
    // for instead of wondering where the fields went.
    agentKeyField.input.disabled = agentShare.checked
    agentUrlField.input.disabled = agentShare.checked
    const credentials = agentCredentials()
    agentLoadModels.disabled =
      credentials.apiKey.trim() === '' || credentials.baseUrl.trim() === ''
  }
  agentShare.addEventListener('change', refreshAgentFields)
  for (const input of [apiKeyField.input, baseUrlField.input, agentKeyField.input, agentUrlField.input]) {
    input.addEventListener('input', refreshAgentFields)
  }

  async function handleLoadAgentModels(): Promise<void> {
    const credentials = agentCredentials()
    agentModelError.hidden = true
    agentModelSelect.hidden = true
    agentLoadModels.disabled = true
    agentLoadModels.textContent = 'Loading…'
    const result = await listModels(
      options.listModels,
      credentials.baseUrl.trim().replace(/\/+$/, ''),
      credentials.apiKey.trim(),
    )
    agentLoadModels.textContent = 'Load models'
    refreshAgentFields()

    if (!result.ok) {
      // The named tiers are still selectable, so a failed load costs the extras
      // and nothing else.
      agentModelError.textContent = `Couldn't load models — ${result.message}. The tiers above still work.`
      agentModelError.hidden = false
      return
    }
    agentLoadedModels = result.models
    // Keeps whatever was chosen chosen: loading a list is not choosing from it.
    paintAgentModels(agentModelValue())
  }
  agentLoadModels.addEventListener('click', (event) => {
    event.preventDefault()
    void handleLoadAgentModels()
  })
  const actions = document.createElement('div')
  actions.className = 'settings-actions'
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'settings-save'
  save.textContent = 'Save'
  save.addEventListener('click', (event) => {
    event.preventDefault()
    const next = normaliseAiSettings({
      apiKey: apiKeyField.input.value,
      baseUrl: baseUrlField.input.value,
      model: modelField.input.value,
    })
    saveAiSettings(options.storage, next)
    saveAgentConnection(
      options.storage,
      normaliseAgentConnection({
        apiKey: agentKeyField.input.value,
        baseUrl: agentUrlField.input.value,
        model: agentModelValue(),
        reasoning: agentReasoning.value,
        shareCredentials: agentShare.checked,
      }),
    )
    closePanel()
  })
  actions.append(save)

  body.append(
    sectionTitle,
    sectionHint,
    apiKeyField.row,
    baseUrlField.row,
    modelField.row,
    loadModelsRow,
    modelSelect,
    modelError,
    agentTitle,
    agentHint,
    agentShareRow,
    agentKeyField.row,
    agentUrlField.row,
    agentModelRowField,
    agentModelOther.row,
    agentModelRow,
    agentModelError,
    agentReasoningRow,
    actions,
  )
  panel.append(header, body)
  overlay.append(panel)

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closePanel()
  })

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closePanel()
  }

  function paint(): void {
    const current = loadAiSettings(options.storage)
    apiKeyField.input.value = current.apiKey
    baseUrlField.input.value = current.baseUrl
    modelField.input.value = current.model
    // The stored record, not the resolved one: the panel edits what is saved,
    // and showing the shared key here would put the diagram key in a box whose
    // own value is empty.
    const agent = loadStoredAgentConnection(options.storage)
    agentShare.checked = agent.shareCredentials
    agentKeyField.input.value = agent.apiKey
    agentUrlField.input.value = agent.baseUrl
    agentReasoning.value = agent.reasoning
    agentLoadedModels = []
    paintAgentModels(agent.model)
    agentModelError.hidden = true
    agentLoadModels.textContent = 'Load models'
    refreshAgentFields()
    modelSelect.hidden = true
    modelSelect.replaceChildren()
    modelError.hidden = true
    loadModelsButton.textContent = 'Load models'
    refreshLoadModelsAvailability()
  }

  function openPanel(): void {
    paint()
    overlay.hidden = false
    document.addEventListener('keydown', onEscape)
    apiKeyField.input.focus()
  }

  function closePanel(): void {
    overlay.hidden = true
    document.removeEventListener('keydown', onEscape)
  }

  return {
    element: overlay,
    open: openPanel,
    close: closePanel,
    toggle: () => (overlay.hidden ? openPanel() : closePanel()),
  }
}
