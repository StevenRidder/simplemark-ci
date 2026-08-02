/**
 * The window chrome from docs/wireframe.html, as a reusable module.
 *
 * Owns presentation only. It reports intent through `onCommand` and never
 * touches the document, the editor, or a file — ADR-0001 keeps document rules
 * out of UI event handlers.
 *
 * Controls whose behaviour belongs to a later task are rendered and visibly
 * disabled rather than omitted, so the shell matches the approved wireframe
 * without advertising behaviour it does not have. EDITOR-1's acceptance is
 * explicit: unsupported controls are absent or disabled, never fake.
 */

export type EditorCommand =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'table'
  | 'undo'
  | 'redo'
  | 'convertToDiagram'

import { FONT_FAMILIES, READER_THEMES, nextScale } from '../reader-preferences.js'
import type { ReaderPreferences } from '../reader-preferences.js'

export type SaveState = 'saved' | 'dirty' | 'error'

export interface WindowChromeOptions {
  readonly fileName: string
  readonly filePath: string
  readonly onCommand: (command: EditorCommand) => void
  readonly preferences: ReaderPreferences
  readonly onPreferences: (next: ReaderPreferences) => void
  /**
   * Opens a real file (APP-1). Absent when the platform cannot: the control
   * then renders visibly disabled with the reason — never fake, never hidden.
   */
  readonly onOpenFile?: (() => void) | undefined
  /** Why onOpenFile is absent, shown on the disabled control. */
  readonly openFileUnavailableReason?: string | undefined
}

export interface WindowChrome {
  readonly element: HTMLElement
  /** The node the editor mounts into. */
  readonly editorHost: HTMLElement
  setStatus(state: SaveState, message?: string): void
}

/** A toolbar button that runs an editor command without stealing the selection. */
function commandButton(
  className: string,
  label: string,
  content: string,
  command: EditorCommand,
  onCommand: (command: EditorCommand) => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.innerHTML = content
  button.setAttribute('aria-label', label)
  button.title = label
  // mousedown, not click: the editor must keep focus and selection, or the
  // command runs against nothing.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onCommand(command)
  })
  return button
}

/** Controls the approved wireframe shows but a later task delivers. */
/** Toolbar commands that are real. */
const TOOL_COMMANDS: ReadonlyArray<{ label: string; icon: string; command: EditorCommand }> = [
  {
    label: 'Checklist',
    command: 'taskList',
    icon: '<path d="m4 6 1.5 1.5L8 5"/><path d="m4 12 1.5 1.5L8 11"/><path d="m4 18 1.5 1.5L8 17"/><path d="M11 6h9M11 12h9M11 18h9"/>',
  },
  {
    label: 'Table',
    command: 'table',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>',
  },
  {
    label: 'Convert to diagram',
    command: 'convertToDiagram',
    icon: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h5a3 3 0 0 1 3 3V15M12 12l5 3 4-3"/>',
  },
]

const DEFERRED: ReadonlyArray<{ label: string; icon: string; owner: string }> = [
  {
    label: 'Attach file',
    owner: 'the attachments work',
    icon: '<path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.6 9.5a2 2 0 1 1-2.8-2.8l8.8-8.8"/>',
  },
]

const TRAILING: ReadonlyArray<{ label: string; icon: string; owner: string }> = [
  {
    label: 'Share',
    owner: 'a later release',
    icon: '<path d="M12 16V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>',
  },
  {
    label: 'Search',
    owner: 'the Bear-parity shell',
    icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  },
]

function svgButton(
  className: string,
  label: string,
  icon: string,
  options: { disabled?: boolean; owner?: string } = {},
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`
  if (options.disabled === true) {
    button.disabled = true
    button.title = `${label} — not in this build; ${options.owner ?? 'a later task'} delivers it`
  } else {
    button.title = label
  }
  return button
}

export function createWindowChrome(options: WindowChromeOptions): WindowChrome {
  const stage = document.createElement('div')
  stage.className = 'stage'

  const windowEl = document.createElement('main')
  windowEl.className = 'window'
  windowEl.setAttribute('aria-label', 'SimpleMark document')

  // ---- title bar ----
  const titlebar = document.createElement('header')
  titlebar.className = 'titlebar'

  const left = document.createElement('div')
  left.className = 'left'
  const lights = document.createElement('div')
  lights.className = 'lights'
  lights.setAttribute('aria-hidden', 'true')
  lights.innerHTML = '<i></i><i></i><i></i>'
  left.append(
    lights,
    commandButton(
      'tool',
      'Undo',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
      'undo',
      options.onCommand,
    ),
    commandButton(
      'tool',
      'Redo',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
      'redo',
      options.onCommand,
    ),
    svgButton('tool path-hide', 'Document list', '<path d="M4 6h16M4 12h16M4 18h10"/>', {
      disabled: true,
      owner: 'the Bear-parity shell',
    }),
    svgButton(
      'tool',
      'New note',
      '<path d="M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9"/><path d="m14 14 6-6-4-4-6 6-1 5 5-1Z"/>',
      { disabled: true, owner: 'the Bear-parity shell' },
    ),
  )

  // Open a real file (APP-1). Sits with the document controls because it is
  // one: the leading cluster is navigation, the trailing cluster is editing.
  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'tool open-file'
  openButton.setAttribute('aria-label', 'Open file')
  if (options.onOpenFile !== undefined) {
    openButton.title = 'Open a Markdown file'
    openButton.addEventListener('click', () => options.onOpenFile?.())
  } else {
    openButton.disabled = true
    openButton.title =
      options.openFileUnavailableReason ?? 'Open file — not available on this platform'
  }
  openButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5a1 1 0 0 1 1-1h5l2 3h7a1 1 0 0 1 1 1v3"/><path d="M4 19l2.5-8H22l-2.7 8Z"/></svg>'
  left.append(openButton)

  const filename = document.createElement('div')
  filename.className = 'filename'
  filename.append(options.fileName)
  const path = document.createElement('small')
  path.textContent = options.filePath
  filename.append(path)

  // ---- editing tools ----
  const editTools = document.createElement('div')
  editTools.className = 'edit-tools'
  editTools.setAttribute('aria-label', 'Editing tools')

  const formatButton = document.createElement('button')
  formatButton.className = 'edit-tool type'
  formatButton.type = 'button'
  formatButton.textContent = 'Aa'
  formatButton.setAttribute('aria-label', 'Text formatting')
  formatButton.title = 'Text formatting'

  const popover = document.createElement('div')
  popover.className = 'format-popover'

  const styleRow = document.createElement('div')
  styleRow.className = 'style-row'
  const headingButton = document.createElement('button')
  headingButton.type = 'button'
  headingButton.textContent = 'Heading'
  headingButton.addEventListener('mousedown', (event) => {
    // The editor keeps focus and selection: a toolbar press must not move the
    // caret before the command runs against it.
    event.preventDefault()
    options.onCommand('heading')
  })
  const orderedButton = commandButton(
    '',
    'Numbered list',
    '1. List',
    'orderedList',
    options.onCommand,
  )
  styleRow.append(headingButton, orderedButton)

  const inlineRow = document.createElement('div')
  inlineRow.className = 'inline-row'
  inlineRow.append(
    commandButton('', 'Bold', '<b>B</b>', 'bold', options.onCommand),
    commandButton('', 'Italic', '<i>I</i>', 'italic', options.onCommand),
    commandButton('', 'Strikethrough', '<s>S</s>', 'strikethrough', options.onCommand),
    commandButton('', 'Bullet list', '\u2022', 'bulletList', options.onCommand),
  )

  // ---- reader typography (D6) ----
  let preferences = options.preferences
  const emitPreferences = (next: ReaderPreferences): void => {
    preferences = next
    paintPreferenceUi()
    options.onPreferences(next)
  }

  const themeRow = document.createElement('div')
  themeRow.className = 'theme-row'
  const themeButtons = READER_THEMES.map((theme) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `swatch swatch-${theme}`
    button.dataset['theme'] = theme
    button.setAttribute('aria-label', `${theme} background`)
    button.title = `${theme[0]!.toUpperCase()}${theme.slice(1)} background`
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      emitPreferences({ ...preferences, theme })
    })
    themeRow.append(button)
    return button
  })

  const sizeRow = document.createElement('div')
  sizeRow.className = 'size-row'
  for (const [label, direction, cls, title] of [
    ['A', 'down', 'size-smaller', 'Smaller text'],
    ['A', 'up', 'size-larger', 'Larger text'],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.className = cls
    button.setAttribute('aria-label', title)
    button.title = title
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      emitPreferences({ ...preferences, scale: nextScale(preferences.scale, direction) })
    })
    sizeRow.append(button)
  }

  const familyRow = document.createElement('div')
  familyRow.className = 'family-row'
  const familyButtons = FONT_FAMILIES.map((family) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = family.label
    button.dataset['family'] = family.id
    button.style.fontFamily = family.stack
    button.setAttribute('aria-label', `${family.label} typeface`)
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      emitPreferences({ ...preferences, family: family.id })
    })
    familyRow.append(button)
    return button
  })

  function paintPreferenceUi(): void {
    for (const button of themeButtons) {
      button.classList.toggle('selected', button.dataset['theme'] === preferences.theme)
    }
    for (const button of familyButtons) {
      button.classList.toggle('selected', button.dataset['family'] === preferences.family)
    }
  }
  paintPreferenceUi()

  popover.append(styleRow, inlineRow, familyRow, themeRow, sizeRow)
  // Suppress mousedown so opening the popover cannot move focus away from the
  // editor. Every command inside it acts on the live selection, and a toolbar
  // that quietly collapses your selection before running a command on it is a
  // command that silently does nothing.
  formatButton.addEventListener('mousedown', (event) => event.preventDefault())
  formatButton.addEventListener('click', () => {
    const open = popover.classList.toggle('open')
    formatButton.classList.toggle('active', open)
  })

  editTools.append(formatButton)
  for (const entry of TOOL_COMMANDS) {
    editTools.append(
      commandButton(
        'edit-tool',
        entry.label,
        `<svg viewBox="0 0 24 24" aria-hidden="true">${entry.icon}</svg>`,
        entry.command,
        options.onCommand,
      ),
    )
  }
  for (const entry of DEFERRED) {
    editTools.append(
      svgButton('edit-tool', entry.label, entry.icon, { disabled: true, owner: entry.owner }),
    )
  }
  editTools.append(popover)

  // ---- right side ----
  const right = document.createElement('div')
  right.className = 'right'
  const status = document.createElement('span')
  status.className = 'status'
  status.dataset['state'] = 'saved'
  status.textContent = 'Saved'
  right.append(status)

  const workWithAi = document.createElement('button')
  workWithAi.className = 'join'
  workWithAi.type = 'button'
  workWithAi.textContent = 'Work with AI'
  workWithAi.disabled = true
  workWithAi.title = 'Work with AI — not in this build; the live-agent deliverable delivers it'
  right.append(workWithAi)
  for (const entry of TRAILING) {
    right.append(svgButton('tool', entry.label, entry.icon, { disabled: true, owner: entry.owner }))
  }

  titlebar.append(left, filename, editTools, right)

  // ---- editor host ----
  const editorSection = document.createElement('section')
  editorSection.className = 'editor'
  const page = document.createElement('article')
  page.className = 'page'
  editorSection.append(page)

  windowEl.append(titlebar, editorSection)
  stage.append(windowEl)

  return {
    element: stage,
    editorHost: page,
    setStatus(state, message) {
      status.dataset['state'] = state
      status.textContent =
        message ?? (state === 'saved' ? 'Saved' : state === 'dirty' ? 'Unsaved changes' : 'Error')
    },
  }
}
