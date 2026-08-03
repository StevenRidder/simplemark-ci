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

import type { DocumentCommandId } from '../../application/index.js'

/**
 * The shell's command vocabulary is the shared registry's, not its own.
 *
 * Every surface here — toolbar, popovers, styles bar — emits an id the macOS
 * menubar also emits, so the two shells cannot drift apart. A command exists in
 * `application/commands.ts` or it does not exist (native-first: the menubar is
 * the complete surface, these are shortcuts over the same ids).
 */
export type EditorCommand = DocumentCommandId

import {
  FONT_FAMILIES,
  LINE_HEIGHTS,
  PARAGRAPH_SPACINGS,
  READER_THEMES,
  READING_WIDTHS,
  nextScale,
} from '../reader-preferences.js'
import type { ReaderPreferences } from '../reader-preferences.js'

export type SaveState = 'saved' | 'dirty' | 'error'

export interface WindowChromeOptions {
  /** macOS supplies the app menu and window furniture; web supplies neither. */
  readonly chromeMode: 'web' | 'macos'
  readonly fileName: string
  readonly filePath: string
  readonly onCommand: (command: EditorCommand) => void
  readonly preferences: ReaderPreferences
  readonly onPreferences: (next: ReaderPreferences) => void
  /** Creates a paragraph after a terminal rendered block on explicit request. */
  readonly onContinueWriting: () => void
  /**
   * Opens a real file (APP-1). Absent when the platform cannot: the control
   * then renders visibly disabled with the reason — never fake, never hidden.
   */
  readonly onOpenFile?: (() => void) | undefined
  /** Why onOpenFile is absent, shown on the disabled control. */
  readonly openFileUnavailableReason?: string | undefined
  /** Saves the current document without moving focus away from the canvas. */
  readonly onSave: () => void
  /**
   * The document's headings, read fresh each time the temporary contents
   * popover opens (EDITOR-3). The chrome never touches the editor itself.
   */
  readonly getOutline?: () => ReadonlyArray<{ level: number; text: string; pos: number }>
  /** Navigates the document to a heading picked in the contents popover. */
  readonly onNavigate?: (pos: number) => void
  /** Inserts an ordinary Markdown image or file link through a platform port. */
  readonly onInsertAsset?: (() => void) | undefined
  /** Whether the quiet, single-row editing strip is shown. This is shell state. */
  readonly stylesBarVisible: boolean
  /** Persists the shell-only styles-bar preference in the composition root. */
  readonly onStylesBarVisibleChange: (visible: boolean) => void
  /** Optional shared workspace navigation. Native and browser shells supply the same intent. */
  readonly workspace?: WorkspaceOptions | undefined
}

/** A compact, derived note index entry. Markdown remains the only durable source. */
export interface WorkspaceNote {
  readonly id: string
  readonly title: string
  readonly preview: string
  readonly updatedLabel: string
  readonly pinned: boolean
}

/** Shell-only navigation intent; it never reads or writes a document itself. */
export interface WorkspaceOptions {
  readonly name: string
  readonly notes: readonly WorkspaceNote[]
  readonly activeNoteId: string
  readonly onSelectNote?: (id: string) => void
  readonly onCreateNote?: () => void
  readonly onTogglePinned?: (id: string) => void
}

export type WorkspaceMode = 'all' | 'notes' | 'editor'

export interface WindowChrome {
  readonly element: HTMLElement
  /** The node the editor mounts into. */
  readonly editorHost: HTMLElement
  setStatus(state: SaveState, message?: string): void
  /**
   * Shell-level commands the registry routes here, so the macOS menubar drives
   * the same surfaces the toolbar does rather than reimplementing them.
   */
  toggleStylesBar(): void
  stylesBarVisible(): boolean
  openContents(): void
  setWorkspaceMode(mode: WorkspaceMode): void
  workspaceMode(): WorkspaceMode
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

const TRAILING: ReadonlyArray<{ label: string; icon: string; owner: string }> = [
  {
    label: 'Share',
    owner: 'a later release',
    icon: '<path d="M12 16V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>',
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

/**
 * Bear's compact styles bar, expressed entirely as existing editor commands.
 *
 * It deliberately owns no formatting logic. The browser shell and a future
 * native View/Format menu both pass the same `EditorCommand` values through
 * WindowChromeOptions.onCommand, so there is no second rich-text path.
 */
function createStylesBar(options: WindowChromeOptions): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'styles-bar'
  bar.setAttribute('aria-label', 'Styles bar')
  bar.hidden = !options.stylesBarVisible

  const closePanels = (): void => {
    for (const panel of bar.querySelectorAll<HTMLElement>('.styles-menu.open')) {
      panel.classList.remove('open')
      panel.previousElementSibling?.setAttribute('aria-expanded', 'false')
    }
  }
  const menu = (label: string, content: (panel: HTMLDivElement) => void): HTMLDivElement => {
    const group = document.createElement('div')
    group.className = 'styles-menu-group'
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'styles-control styles-menu-trigger'
    trigger.textContent = label
    // Keep the visual chevron out of the command name. It is decoration, not
    // a different action, and keyboard/screen-reader users need a stable name.
    trigger.setAttribute('aria-label', label)
    trigger.setAttribute('aria-expanded', 'false')
    trigger.addEventListener('mousedown', (event) => event.preventDefault())
    const panel = document.createElement('div')
    panel.className = 'styles-menu'
    content(panel)
    trigger.addEventListener('click', () => {
      const open = !panel.classList.contains('open')
      closePanels()
      panel.classList.toggle('open', open)
      trigger.setAttribute('aria-expanded', String(open))
    })
    group.append(trigger, panel)
    return group
  }
  const command = (label: string, editorCommand: EditorCommand, className = 'styles-control'): HTMLButtonElement =>
    commandButton(className, label, label, editorCommand, options.onCommand)

  const headers = menu('Headers', (panel) => {
    for (const level of [1, 2, 3] as const) {
      panel.append(command(`Heading ${level}`, `heading${level}`))
    }
  })
  const lists = menu('Lists', (panel) => {
    panel.append(
      command('Bullet list', 'bulletList'),
      command('Numbered list', 'orderedList'),
      command('Quote', 'quote'),
    )
  })
  const more = menu('More', (panel) => {
    // On a narrow window these mirror the low-frequency hidden row controls.
    // They still call the same command union; More is overflow, not a second
    // formatting implementation.
    panel.append(
      command('Todo', 'taskList'),
      command('Bullet list', 'bulletList'),
      command('Numbered list', 'orderedList'),
      command('Bold', 'bold'),
      command('Italic', 'italic'),
      command('Link', 'link'),
      command('Tables', 'table'),
    )
    for (const level of [4, 5, 6] as const) {
      panel.append(command(`Heading ${level}`, `heading${level}`))
    }
    panel.append(
      command('Strikethrough', 'strikethrough'),
      command('Highlight', 'highlight'),
      command('Inline code', 'inlineCode'),
      command('Code block', 'codeBlock'),
      command('Divider', 'divider'),
      command('Move block up', 'moveBlockUp'),
      command('Move block down', 'moveBlockDown'),
    )
    const file = document.createElement('button')
    file.type = 'button'
    file.className = 'styles-control'
    file.textContent = 'Image/File'
    if (options.onInsertAsset === undefined) {
      file.disabled = true
      file.title = 'Image/File — portable file links are not available on this platform'
    } else {
      file.addEventListener('mousedown', (event) => event.preventDefault())
      file.addEventListener('click', () => options.onInsertAsset?.())
    }
    panel.append(file)
    const visibility = document.createElement('button')
    visibility.type = 'button'
    visibility.className = 'styles-control styles-bar-toggle'
    visibility.textContent = 'Hide styles bar'
    visibility.addEventListener('mousedown', (event) => event.preventDefault())
    visibility.addEventListener('click', () => {
      options.onStylesBarVisibleChange(false)
      bar.hidden = true
      closePanels()
    })
    panel.append(visibility)
  })

  const asset = document.createElement('button')
  asset.type = 'button'
  asset.className = 'styles-control styles-asset'
  asset.textContent = 'Image/File'
  asset.setAttribute('aria-label', 'Insert image or link file')
  if (options.onInsertAsset === undefined) {
    asset.disabled = true
    asset.title = 'Image/File — portable file links are not available on this platform'
  } else {
    asset.title = 'Insert image or link file'
    asset.addEventListener('mousedown', (event) => event.preventDefault())
    asset.addEventListener('click', () => options.onInsertAsset?.())
  }

  // Exact product order: the visual hierarchy stays stable even while narrow
  // windows move the low-frequency end of the row into More.
  bar.append(
    headers,
    command('Todo', 'taskList', 'styles-control styles-bar-overflow'),
    lists,
    command('Bold', 'bold', 'styles-control styles-bar-overflow'),
    command('Italic', 'italic', 'styles-control styles-bar-overflow'),
    command('Link', 'link', 'styles-control styles-bar-overflow'),
    command('Tables', 'table', 'styles-control styles-bar-overflow'),
    asset,
    more,
  )

  return bar
}

export function createWindowChrome(options: WindowChromeOptions): WindowChrome {
  const isMacOS = options.chromeMode === 'macos'
  const stage = document.createElement('div')
  stage.className = 'stage'

  const windowEl = document.createElement('main')
  windowEl.className = 'window'
  windowEl.setAttribute('aria-label', 'SimpleMark document')

  // ---- title bar ----
  const titlebar = document.createElement('header')
  titlebar.className = 'titlebar'
  titlebar.classList.toggle('native-editor-head', isMacOS)

  const left = document.createElement('div')
  left.className = 'left'
  left.append(
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
  )

  const documentListButton = svgButton('tool path-hide', 'Document list', '<path d="M4 6h16M4 12h16M4 18h10"/>',
    options.workspace === undefined ? { disabled: true, owner: 'the Bear-parity shell' } : {})
  left.append(documentListButton)

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

  const saveButton = document.createElement('button')
  saveButton.type = 'button'
  saveButton.className = 'tool save-file'
  saveButton.setAttribute('aria-label', 'Save file')
  saveButton.title = 'Save file'
  saveButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l3 3v13H5Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>'
  saveButton.addEventListener('mousedown', (event) => {
    event.preventDefault()
    options.onSave()
  })
  left.append(saveButton)

  // ---- temporary contents (EDITOR-3) ----
  // A popover, deliberately not a sidebar: it opens over the page, lists the
  // headings, navigates, and closes. There is no persistent outline surface.
  const contentsButton = document.createElement('button')
  contentsButton.type = 'button'
  contentsButton.className = 'tool contents'
  contentsButton.setAttribute('aria-label', 'Contents')
  contentsButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12M4 12h16M7 18h13"/></svg>'

  const contentsPopover = document.createElement('div')
  contentsPopover.className = 'contents-popover'
  contentsPopover.setAttribute('aria-label', 'Table of contents')

  if (options.getOutline !== undefined && options.onNavigate !== undefined) {
    const getOutline = options.getOutline
    const onNavigate = options.onNavigate
    contentsButton.title = 'Contents'

    const closeContents = (): void => {
      contentsPopover.classList.remove('open')
      document.removeEventListener('mousedown', onOutsidePress, true)
      document.removeEventListener('keydown', onEscape, true)
    }
    const onOutsidePress = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && (contentsPopover.contains(target) || contentsButton.contains(target)))
        return
      closeContents()
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeContents()
    }

    contentsButton.addEventListener('click', () => {
      if (contentsPopover.classList.contains('open')) {
        closeContents()
        return
      }
      // Built fresh on every open: the popover is temporary, so it never holds
      // a stale copy of the document's structure.
      contentsPopover.replaceChildren()
      const outline = getOutline()
      if (outline.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'contents-empty'
        empty.textContent = 'No headings in this document'
        contentsPopover.append(empty)
      }
      for (const entry of outline) {
        const item = document.createElement('button')
        item.type = 'button'
        item.textContent = entry.text === '' ? '(untitled heading)' : entry.text
        item.dataset['level'] = String(entry.level)
        item.addEventListener('mousedown', (event) => {
          // mousedown so the editor keeps focus; navigation sets the caret.
          event.preventDefault()
          closeContents()
          onNavigate(entry.pos)
        })
        contentsPopover.append(item)
      }
      contentsPopover.classList.add('open')
      document.addEventListener('mousedown', onOutsidePress, true)
      document.addEventListener('keydown', onEscape, true)
    })
  } else {
    contentsButton.disabled = true
    contentsButton.title = 'Contents — not available in this shell'
  }
  left.append(contentsButton, contentsPopover)

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

  const headingRow = document.createElement('div')
  headingRow.className = 'heading-row'
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    headingRow.append(
      commandButton('', `Heading ${level}`, `H${level}`, `heading${level}`, options.onCommand),
    )
  }

  const styleRow = document.createElement('div')
  styleRow.className = 'style-row'
  const orderedButton = commandButton(
    '',
    'Numbered list',
    '1. List',
    'orderedList',
    options.onCommand,
  )
  styleRow.append(
    orderedButton,
    commandButton('', 'Quote', 'Quote', 'quote', options.onCommand),
    commandButton('', 'Code block', 'Code block', 'codeBlock', options.onCommand),
    commandButton('', 'Divider', 'Divider', 'divider', options.onCommand),
  )

  const moveRow = document.createElement('div')
  moveRow.className = 'move-row'
  moveRow.append(
    commandButton('', 'Move block up', 'Move up', 'moveBlockUp', options.onCommand),
    commandButton('', 'Move block down', 'Move down', 'moveBlockDown', options.onCommand),
  )

  const inlineRow = document.createElement('div')
  inlineRow.className = 'inline-row'
  inlineRow.append(
    commandButton('', 'Bold', '<b>B</b>', 'bold', options.onCommand),
    commandButton('', 'Italic', '<i>I</i>', 'italic', options.onCommand),
    commandButton('', 'Strikethrough', '<s>S</s>', 'strikethrough', options.onCommand),
    commandButton('', 'Highlight', '<mark>H</mark>', 'highlight', options.onCommand),
    commandButton('', 'Inline code', '&lt;/&gt;', 'inlineCode', options.onCommand),
    commandButton('', 'Link', 'Link', 'link', options.onCommand),
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

  // ---- reader layout (EDITOR-3): width, leading, spacing, indent ----
  // Each is a labelled row of curated steps, mirroring Bear's reader panel.
  // Document-level always: these buttons never look at the selection.
  function stepRow<Id extends string>(
    label: string,
    steps: ReadonlyArray<{ id: Id; label: string }>,
    selected: () => string,
    apply: (id: Id) => ReaderPreferences,
  ): { row: HTMLDivElement; paint: () => void } {
    const row = document.createElement('div')
    row.className = 'pref-row'
    const caption = document.createElement('span')
    caption.textContent = label
    const group = document.createElement('div')
    group.className = 'steps'
    const buttons = steps.map((step) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = step.label
      button.dataset['step'] = step.id
      button.setAttribute('aria-label', `${step.label} ${label.toLowerCase()}`)
      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
        emitPreferences(apply(step.id))
      })
      group.append(button)
      return button
    })
    row.append(caption, group)
    return {
      row,
      paint: () => {
        for (const button of buttons) {
          button.classList.toggle('selected', button.dataset['step'] === selected())
        }
      },
    }
  }

  const widthRow = stepRow(
    'Width',
    READING_WIDTHS,
    () => preferences.width,
    (width) => ({ ...preferences, width }),
  )
  const leadingRow = stepRow(
    'Leading',
    LINE_HEIGHTS,
    () => preferences.leading,
    (leading) => ({ ...preferences, leading }),
  )
  const spacingRow = stepRow(
    'Spacing',
    PARAGRAPH_SPACINGS,
    () => preferences.spacing,
    (spacing) => ({ ...preferences, spacing }),
  )
  const indentRow = stepRow(
    'Indent',
    [
      { id: 'none', label: 'None' },
      { id: 'first-line', label: 'First line' },
    ] as const,
    () => preferences.indent,
    (indent) => ({ ...preferences, indent }),
  )

  function paintPreferenceUi(): void {
    for (const button of themeButtons) {
      button.classList.toggle('selected', button.dataset['theme'] === preferences.theme)
    }
    for (const button of familyButtons) {
      button.classList.toggle('selected', button.dataset['family'] === preferences.family)
    }
    widthRow.paint()
    leadingRow.paint()
    spacingRow.paint()
    indentRow.paint()
  }
  paintPreferenceUi()

  popover.append(
    headingRow,
    styleRow,
    inlineRow,
    moveRow,
    familyRow,
    widthRow.row,
    leadingRow.row,
    spacingRow.row,
    indentRow.row,
    themeRow,
    sizeRow,
  )
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
  const insertAsset = svgButton(
    'edit-tool',
    'Insert image or link file',
    '<path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.6 9.5a2 2 0 1 1-2.8-2.8l8.8-8.8"/>',
    options.onInsertAsset === undefined ? { disabled: true, owner: 'the portable file-link work' } : {},
  )
  if (options.onInsertAsset !== undefined) {
    insertAsset.addEventListener('click', () => options.onInsertAsset?.())
  }
  editTools.append(insertAsset)
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
  workWithAi.className = isMacOS ? 'tool work-with-ai' : 'join'
  workWithAi.type = 'button'
  workWithAi.textContent = isMacOS ? '✦' : 'Work with AI'
  workWithAi.setAttribute('aria-label', 'Work with AI')
  workWithAi.disabled = true
  workWithAi.title = 'Work with AI — not in this build; the live-agent deliverable delivers it'
  right.append(workWithAi)
  for (const entry of TRAILING) {
    const button = svgButton('tool', entry.label, entry.icon, { disabled: true, owner: entry.owner })
    right.append(button)
  }
  if (isMacOS) {
    right.append(
      svgButton(
        'tool',
        'Document information',
        '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
        { disabled: true, owner: 'a later release' },
      ),
    )
  }

  const stylesBar = createStylesBar(options)
  const stylesBarToggle = document.createElement('button')
  stylesBarToggle.type = 'button'
  stylesBarToggle.className = 'styles-bar-menu-toggle'
  const paintStylesBarToggle = (): void => {
    stylesBarToggle.textContent = stylesBar.hidden ? 'Show styles bar' : 'Hide styles bar'
  }
  paintStylesBarToggle()
  const toggleStylesBar = (): void => {
    const visible = stylesBar.hidden
    stylesBar.hidden = !visible
    options.onStylesBarVisibleChange(visible)
    paintStylesBarToggle()
  }
  stylesBarToggle.addEventListener('mousedown', (event) => event.preventDefault())
  stylesBarToggle.addEventListener('click', toggleStylesBar)
  // The same tiny View/Format affordance restores a deliberately hidden bar;
  // hiding it can never strand the user without a way back.
  popover.append(stylesBarToggle)

  if (isMacOS) titlebar.append(filename, right)
  else titlebar.append(left, filename, editTools, right)

  // ---- editor host ----
  const editorSection = document.createElement('section')
  editorSection.className = 'editor'
  const page = document.createElement('article')
  page.className = 'page'
  const continueWriting = document.createElement('button')
  continueWriting.type = 'button'
  continueWriting.className = 'continue-writing'
  continueWriting.textContent = 'Click to keep writing'
  continueWriting.addEventListener('mousedown', (event) => {
    event.preventDefault()
    options.onContinueWriting()
  })
  editorSection.append(page, continueWriting)

  const documentSurface = document.createElement('div')
  documentSurface.className = 'document-surface'
  documentSurface.append(stylesBar, editorSection)

  let setWorkspaceMode = (_mode: WorkspaceMode): void => {}
  let getWorkspaceMode = (): WorkspaceMode => 'editor'

  if (options.workspace === undefined) {
    windowEl.append(titlebar, documentSurface)
  } else {
    const workspace = options.workspace
    const workspaceBody = document.createElement('div')
    workspaceBody.className = 'workspace-body'

    const folders = document.createElement('aside')
    folders.className = 'workspace-folders'
    folders.setAttribute('aria-label', 'Library')
    const workspaceHeader = document.createElement('div')
    workspaceHeader.className = 'workspace-library-head'
    const workspaceName = document.createElement('div')
    workspaceName.className = 'workspace-name'
    workspaceName.textContent = workspace.name
    const libraryOptions = document.createElement('button')
    libraryOptions.type = 'button'
    libraryOptions.className = 'library-action'
    libraryOptions.setAttribute('aria-label', 'Sidebar options')
    libraryOptions.textContent = '•••'
    libraryOptions.disabled = true
    libraryOptions.title = 'Sidebar options — available when a real folder catalog is connected'
    workspaceHeader.append(workspaceName, libraryOptions)

    let noteFilter: 'all' | 'pinned' = 'all'
    let sortMode: 'modified' | 'title' = 'modified'
    let previewDensity: 'small' | 'medium' | 'large' = 'medium'

    const libraryRows = document.createElement('div')
    libraryRows.className = 'library-rows'
    const makeLibraryRow = (
      label: string,
      icon: string,
      count: string,
      filter?: 'all' | 'pinned',
    ): HTMLButtonElement => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'folder-row'
      row.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span><span class="folder-count">${count}</span>`
      if (filter === undefined) {
        row.disabled = true
        row.title = `${label} — available when a real folder catalog is connected`
      } else {
        row.dataset['filter'] = filter
      }
      return row
    }
    const allNotes = makeLibraryRow('All Notes', '▤', String(workspace.notes.length), 'all')
    const untagged = makeLibraryRow('Untagged', '◇', '—')
    const todo = makeLibraryRow('Todo', '☑', '—')
    const today = makeLibraryRow('Today', '◷', '—')
    const pinned = makeLibraryRow(
      'Pinned',
      '⌖',
      String(workspace.notes.filter((note) => note.pinned).length),
      'pinned',
    )
    const trash = makeLibraryRow('Trash', '⌫', '')
    const folderLabel = document.createElement('div')
    folderLabel.className = 'library-section-label'
    folderLabel.textContent = 'Folders'
    const folderRoot = document.createElement('button')
    folderRoot.type = 'button'
    folderRoot.className = 'folder-row folder-root'
    folderRoot.innerHTML = `<span aria-hidden="true">⌄</span><span>${workspace.name}</span><span class="folder-count">${workspace.notes.length}</span>`
    folderRoot.disabled = true
    libraryRows.append(allNotes, untagged, todo, today, pinned, trash, folderLabel, folderRoot)
    const libraryFooter = document.createElement('div')
    libraryFooter.className = 'workspace-library-footer'
    const sync = document.createElement('button')
    sync.type = 'button'
    sync.setAttribute('aria-label', 'Folder sync status')
    sync.textContent = '↻'
    sync.disabled = true
    sync.title = 'Folder sync — available when a real folder catalog is connected'
    const settings = document.createElement('button')
    settings.type = 'button'
    settings.setAttribute('aria-label', 'Settings')
    settings.textContent = '⚙'
    settings.disabled = true
    settings.title = 'Settings — not in this build'
    libraryFooter.append(sync, settings)
    folders.append(workspaceHeader, libraryRows, libraryFooter)

    const noteList = document.createElement('aside')
    noteList.className = 'workspace-notes'
    noteList.setAttribute('aria-label', 'Notes')
    const notesHeader = document.createElement('div')
    notesHeader.className = 'notes-header'

    const notesTitle = document.createElement('button')
    notesTitle.type = 'button'
    notesTitle.className = 'notes-title'
    notesTitle.setAttribute('aria-label', 'Note list options')
    notesTitle.setAttribute('aria-expanded', 'false')

    const searchButton = svgButton(
      'notes-action',
      'Search',
      '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    )
    const newNoteButton = svgButton(
      'notes-action',
      'New note',
      '<path d="M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9"/><path d="m14 14 6-6-4-4-6 6-1 5 5-1Z"/>',
    )
    if (workspace.onCreateNote === undefined) {
      newNoteButton.disabled = true
      newNoteButton.title = 'New Note — available when a real folder catalog is connected'
    } else {
      newNoteButton.addEventListener('click', () => workspace.onCreateNote?.())
    }

    const searchWrap = document.createElement('div')
    searchWrap.className = 'notes-search-wrap'
    const search = document.createElement('input')
    search.className = 'workspace-search'
    search.type = 'search'
    search.placeholder = 'Search'
    search.setAttribute('aria-label', 'Search notes')
    const closeSearch = document.createElement('button')
    closeSearch.type = 'button'
    closeSearch.className = 'notes-action close-search'
    closeSearch.setAttribute('aria-label', 'Close search')
    closeSearch.textContent = '×'
    searchWrap.append(search, closeSearch)
    notesHeader.append(notesTitle, searchButton, newNoteButton, searchWrap)

    const notesMenu = document.createElement('div')
    notesMenu.className = 'notes-menu'
    notesMenu.hidden = true
    notesMenu.setAttribute('aria-label', 'Note list options')

    const menuRow = (label: string, action?: () => void): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'notes-menu-row'
      button.textContent = label
      if (action !== undefined) button.addEventListener('click', action)
      return button
    }
    const countRow = document.createElement('div')
    countRow.className = 'notes-menu-count'
    countRow.textContent = `${workspace.notes.length} notes`
    const sortModified = menuRow('Sort by modification date')
    const sortTitle = menuRow('Sort by title')
    const previewSmall = menuRow('Small preview')
    const previewMedium = menuRow('Medium preview')
    const previewLarge = menuRow('Large preview')
    const exportNotes = menuRow('Export…')
    exportNotes.disabled = true
    exportNotes.title = 'Export — available when a real folder catalog is connected'
    const showAll = menuRow('All Notes')
    const showPinned = menuRow('Pinned')
    notesMenu.append(
      countRow,
      sortModified,
      sortTitle,
      document.createElement('hr'),
      previewSmall,
      previewMedium,
      previewLarge,
      document.createElement('hr'),
      exportNotes,
      document.createElement('hr'),
      showAll,
      showPinned,
    )

    const noteItems = document.createElement('div')
    noteItems.className = 'note-items'

    const paintLibrary = (): void => {
      for (const row of [allNotes, pinned]) {
        row.classList.toggle('selected', row.dataset['filter'] === noteFilter)
      }
    }

    const paintMenuState = (): void => {
      notesTitle.innerHTML = `${noteFilter === 'pinned' ? 'Pinned' : 'All Notes'} <span aria-hidden="true">⌄</span>`
      sortModified.textContent = `${sortMode === 'modified' ? '✓  ' : ''}Sort by modification date`
      sortTitle.textContent = `${sortMode === 'title' ? '✓  ' : ''}Sort by title`
      previewSmall.textContent = `${previewDensity === 'small' ? '✓  ' : ''}Small preview`
      previewMedium.textContent = `${previewDensity === 'medium' ? '✓  ' : ''}Medium preview`
      previewLarge.textContent = `${previewDensity === 'large' ? '✓  ' : ''}Large preview`
      showAll.textContent = `${noteFilter === 'all' ? '✓  ' : ''}All Notes`
      showPinned.textContent = `${noteFilter === 'pinned' ? '✓  ' : ''}Pinned`
      noteList.dataset['preview'] = previewDensity
      paintLibrary()
    }

    const paintNotes = (): void => {
      const query = search.value.trim().toLocaleLowerCase()
      noteItems.replaceChildren()
      const visibleNotes = [...workspace.notes]
        .filter((note) => noteFilter === 'all' || note.pinned)
        .filter((note) => query === '' || `${note.title} ${note.preview}`.toLocaleLowerCase().includes(query))
        .sort((left, right) => {
          if (sortMode === 'title') return left.title.localeCompare(right.title)
          return Number(right.pinned) - Number(left.pinned)
        })
      for (const note of visibleNotes) {
        const item = document.createElement('div')
        item.className = 'note-item'
        item.classList.toggle('selected', note.id === workspace.activeNoteId)
        const select = document.createElement('button')
        select.type = 'button'
        select.className = 'note-select'
        select.setAttribute('aria-label', note.title)
        select.setAttribute('aria-current', note.id === workspace.activeNoteId ? 'page' : 'false')
        const title = document.createElement('strong')
        title.textContent = note.title
        const preview = document.createElement('span')
        preview.textContent = note.preview
        const updated = document.createElement('time')
        updated.textContent = note.updatedLabel
        select.append(title, preview, updated)
        if (workspace.onSelectNote !== undefined) {
          select.addEventListener('click', () => workspace.onSelectNote?.(note.id))
        }
        const pin = document.createElement('button')
        pin.type = 'button'
        pin.className = 'note-pin'
        pin.setAttribute('aria-label', `${note.pinned ? 'Unpin' : 'Pin'} ${note.title}`)
        pin.title = note.pinned ? 'Unpin note' : 'Pin note'
        pin.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 4 6 6-3 1-4 4-1 5-2-2-6 2 2-6-2-2 5-1 4-4Z"/></svg>'
        pin.classList.toggle('pinned', note.pinned)
        if (workspace.onTogglePinned === undefined) {
          pin.disabled = true
          pin.title = 'Pin — available when a real folder catalog is connected'
        } else {
          pin.addEventListener('click', () => workspace.onTogglePinned?.(note.id))
        }
        item.append(select, pin)
        noteItems.append(item)
      }
    }

    const closeNotesMenu = (): void => {
      notesMenu.hidden = true
      notesTitle.setAttribute('aria-expanded', 'false')
    }
    notesTitle.addEventListener('click', () => {
      const open = notesMenu.hidden
      notesMenu.hidden = !open
      notesTitle.setAttribute('aria-expanded', String(open))
    })
    windowEl.addEventListener('mousedown', (event) => {
      const target = event.target
      if (!(target instanceof Node) || notesMenu.hidden) return
      if (!notesMenu.contains(target) && !notesTitle.contains(target)) closeNotesMenu()
    })
    windowEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (!notesMenu.hidden) {
        closeNotesMenu()
        notesTitle.focus()
      } else if (notesHeader.classList.contains('searching')) {
        closeSearch.click()
      }
    })
    searchButton.addEventListener('click', () => {
      closeNotesMenu()
      notesHeader.classList.add('searching')
      search.focus()
    })
    closeSearch.addEventListener('click', () => {
      search.value = ''
      notesHeader.classList.remove('searching')
      paintNotes()
      searchButton.focus()
    })
    allNotes.addEventListener('click', () => {
      noteFilter = 'all'
      paintMenuState()
      paintNotes()
    })
    pinned.addEventListener('click', () => {
      noteFilter = 'pinned'
      paintMenuState()
      paintNotes()
    })
    sortModified.addEventListener('click', () => {
      sortMode = 'modified'
      paintMenuState()
      paintNotes()
      closeNotesMenu()
    })
    sortTitle.addEventListener('click', () => {
      sortMode = 'title'
      paintMenuState()
      paintNotes()
      closeNotesMenu()
    })
    for (const [button, density] of [
      [previewSmall, 'small'],
      [previewMedium, 'medium'],
      [previewLarge, 'large'],
    ] as const) {
      button.addEventListener('click', () => {
        previewDensity = density
        paintMenuState()
        closeNotesMenu()
      })
    }
    showAll.addEventListener('click', () => {
      noteFilter = 'all'
      paintMenuState()
      paintNotes()
      closeNotesMenu()
    })
    showPinned.addEventListener('click', () => {
      noteFilter = 'pinned'
      paintMenuState()
      paintNotes()
      closeNotesMenu()
    })
    search.addEventListener('input', paintNotes)
    paintMenuState()
    paintNotes()
    noteList.append(notesHeader, notesMenu, noteItems)

    const applyWorkspaceMode = (mode: WorkspaceMode): void => {
      workspaceBody.dataset['layout'] = mode
      workspaceBody.classList.toggle('navigation-hidden', mode === 'editor')
      documentListButton.classList.toggle('active', mode !== 'all')
    }
    setWorkspaceMode = applyWorkspaceMode
    getWorkspaceMode = () => workspaceBody.dataset['layout'] as WorkspaceMode
    applyWorkspaceMode('all')
    documentListButton.addEventListener('click', () => {
      applyWorkspaceMode(getWorkspaceMode() === 'editor' ? 'all' : 'editor')
    })
    workspaceBody.append(folders, noteList, documentSurface)
    if (isMacOS) {
      documentSurface.prepend(titlebar)
      windowEl.append(workspaceBody)
    } else {
      windowEl.append(titlebar, workspaceBody)
    }
  }
  stage.append(windowEl)

  return {
    element: stage,
    editorHost: page,
    toggleStylesBar,
    stylesBarVisible: () => !stylesBar.hidden,
    openContents: () => contentsButton.click(),
    setWorkspaceMode: (mode) => setWorkspaceMode(mode),
    workspaceMode: () => getWorkspaceMode(),
    setStatus(state, message) {
      status.dataset['state'] = state
      status.textContent =
        message ?? (state === 'saved' ? 'Saved' : state === 'dirty' ? 'Unsaved changes' : 'Error')
    },
  }
}
