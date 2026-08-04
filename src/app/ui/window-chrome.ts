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
import { tablerIcon, tablerIconPaths } from './tabler-icons.js'
import type { TablerIconName } from './tabler-icons.js'

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
import type { DocumentStatistics } from '../document-statistics.js'

export type SaveState = 'saved' | 'dirty' | 'error'

/** A palette centre expressed inside the document pane, so window resizing is safe. */
export interface StylesBarPosition {
  readonly x: number
  readonly y: number
}

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
  /** Navigates the document to a heading picked in the contents view. */
  readonly onNavigate?: (pos: number) => void
  /**
   * Reading measurements for the statistics view and the word-count pill, read
   * fresh on every paint so neither surface caches a stale document.
   */
  readonly getStatistics?: () => DocumentStatistics
  /** Inserts an ordinary Markdown image or file link through a platform port. */
  readonly onInsertAsset?: (() => void) | undefined
  /** Whether the quiet, single-row editing strip is shown. This is shell state. */
  readonly stylesBarVisible: boolean
  /** Persists the shell-only styles-bar preference in the composition root. */
  readonly onStylesBarVisibleChange: (visible: boolean) => void
  /** A missing position means the approved bottom-centre wireframe default. */
  readonly stylesBarPosition?: StylesBarPosition | undefined
  /** Persists a user-placed palette without putting layout into Markdown. */
  readonly onStylesBarPositionChange: (position: StylesBarPosition | undefined) => void
  /** Optional shared workspace navigation. Native and browser shells supply the same intent. */
  readonly workspace?: WorkspaceOptions | undefined
}

/** A compact, derived note index entry. Markdown remains the only durable source. */
export interface WorkspaceNote {
  readonly id: string
  /** File name or another shell-defined identity safe to expose to a person. */
  readonly identifier?: string
  /** Portable document-relative link; native shells must never put an absolute path here. */
  readonly portableLink?: string
  readonly title: string
  readonly preview: string
  readonly updatedLabel: string
  readonly pinned: boolean
  /**
   * Epoch milliseconds, when the catalog knows them.
   *
   * Absent for a catalog that only derived a display label, and the date sorts
   * stay disabled in that case rather than silently degrading to some other
   * order — a sort that quietly does nothing is worse than one you can see is
   * unavailable.
   */
  readonly updatedAt?: number
  readonly createdAt?: number
}

/** One explicitly adopted local folder shown in the library sidebar. */
export interface WorkspaceFolder {
  readonly id: string
  readonly name: string
  readonly count: number
}

/** Shell-only navigation intent; it never reads or writes a document itself. */
export interface WorkspaceOptions {
  readonly name: string
  /** Label for the catalog currently shown in the middle pane. */
  readonly collectionLabel?: string
  /** Persistent history of files explicitly opened by any route. */
  readonly recentNotesCount?: number
  readonly folders?: readonly WorkspaceFolder[]
  /** `recent` or the handle of the selected folder collection. */
  readonly activeCollectionId?: string
  readonly notes: readonly WorkspaceNote[]
  readonly activeNoteId: string
  readonly onSelectNote?: (id: string) => void
  readonly onCreateNote?: () => void
  readonly onAddFolder?: () => void
  /** `open` selects only explicitly opened files; any other id selects that folder. */
  readonly onSelectCollection?: (id: string) => void
  /** Persists the toggle and returns the authoritative next state. */
  readonly onTogglePinned?: (id: string) => boolean
  readonly onCopyText?: (text: string) => Promise<void>
  readonly onCopyMarkdown?: (id: string) => Promise<void>
  readonly onDuplicateNote?: (id: string) => Promise<void>
  readonly onExportNote?: (id: string) => Promise<void>
  /** Removes a note from Recent Notes without touching its file. */
  readonly onCloseNote?: (id: string) => Promise<void>
  readonly onTrashNote?: (id: string) => Promise<void>
}

export type WorkspaceMode = 'all' | 'notes' | 'editor'

/**
 * The three views of the one document-information panel.
 *
 * Bear presents statistics, contents, and backlinks as tabs of a single panel
 * rather than three inspectors, and the reason is the product's: only one of
 * them is ever the question being asked, and stacking them down the edge would
 * cost the document the width it exists to have.
 */
export type InfoTab = 'statistics' | 'contents' | 'backlinks'

export type PreviewDensity = 'small' | 'medium' | 'large'
export type NotesSort = 'modified' | 'created' | 'title'
export type FoldersSort = 'title' | 'count'

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
  /** Bear's model: the same tab closes the panel, a different tab switches it. */
  toggleInfoTab(tab: InfoTab): void
  infoTab(): InfoTab | null
  openContents(): void
  toggleWordCount(): void
  wordCountVisible(): boolean
  /**
   * Repaints anything that counts the document — the word-count pill and an
   * open statistics view. Called when the document changes, so neither surface
   * has to poll and neither can show yesterday's number.
   */
  refreshStatistics(): void
  /**
   * Accepts a preference change made elsewhere — the View menu — and repaints
   * the "Aa" popover to match. It deliberately does not call back into
   * `onPreferences`: the caller has already applied and persisted it, and
   * echoing would be a loop.
   */
  setPreferences(next: ReaderPreferences): void
  toggleHistoryNavigation(): void
  historyNavigationVisible(): boolean
  setWorkspaceMode(mode: WorkspaceMode): void
  workspaceMode(): WorkspaceMode
  /**
   * Note-list view state. Present even without a workspace so the menubar can
   * ask one question rather than branching on which shell it is running in;
   * the composition root decides whether the commands are enabled.
   */
  setPreviewDensity(density: PreviewDensity): void
  previewDensity(): PreviewDensity
  setNotesSort(sort: NotesSort): void
  notesSort(): NotesSort
  toggleNewestOnTop(): void
  newestOnTop(): boolean
  setFoldersSort(sort: FoldersSort): void
  foldersSort(): FoldersSort
  toggleFoldersAtoZ(): void
  foldersAtoZ(): boolean
  togglePinned(id: string): void
  isPinned(id: string): boolean
  /** Releases observers owned by this detached presentation tree. */
  dispose(): void
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

interface InfoPanel {
  readonly element: HTMLElement
  toggle(tab: InfoTab): void
  open(tab: InfoTab): void
  close(): void
  tab(): InfoTab | null
  /** Repaints the open view against the current document. */
  refresh(): void
}

const INFO_TABS: ReadonlyArray<{ id: InfoTab; label: string; icon: string }> = [
  {
    id: 'statistics',
    label: 'Statistics',
    icon: '<path d="M5 20V12M10 20V5M15 20v-6M20 20v-9"/>',
  },
  {
    id: 'contents',
    label: 'Table of Contents',
    icon: '<path d="M4 6h1M4 12h1M4 18h1M9 6h11M9 12h11M9 18h11"/>',
  },
  {
    id: 'backlinks',
    label: 'Backlinks',
    icon: '<path d="M11 17H7a5 5 0 0 1 0-10h4"/><path d="m9 12h7"/><path d="m14 8-4 4 4 4"/>',
  },
]

/**
 * The document-information panel: statistics, contents, and backlinks.
 *
 * It floats over the right edge of the page rather than taking a column, so
 * turning it on never reflows the sentence a person is reading. That is the
 * same reason EDITOR-3 made contents a popover; the panel keeps the property
 * and adds the two views the popover had nowhere to put.
 *
 * Every view is rebuilt on open and on tab change, never cached — this panel
 * holds no document state, it only asks for the numbers and the outline.
 */
function createInfoPanel(options: WindowChromeOptions): InfoPanel {
  const element = document.createElement('aside')
  element.className = 'info-panel'
  element.hidden = true
  element.setAttribute('aria-label', 'Document information')

  const heading = document.createElement('div')
  heading.className = 'info-panel-title'

  const tabs = document.createElement('div')
  tabs.className = 'info-panel-tabs'
  tabs.setAttribute('role', 'tablist')

  const body = document.createElement('div')
  body.className = 'info-panel-body'
  body.setAttribute('role', 'tabpanel')
  element.append(heading, tabs, body)

  let current: InfoTab | null = null

  const statistic = (value: string, label: string): HTMLElement => {
    const cell = document.createElement('div')
    cell.className = 'info-statistic'
    const amount = document.createElement('strong')
    amount.textContent = value
    const name = document.createElement('span')
    name.textContent = label
    cell.append(amount, name)
    return cell
  }

  const unavailable = (label: string, reason: string): HTMLElement => {
    // Named and visibly unavailable, never blank: an empty row would read as a
    // document with no history rather than a shell with no timestamp port.
    const row = document.createElement('div')
    row.className = 'info-statistic wide unavailable'
    const amount = document.createElement('strong')
    amount.textContent = '—'
    const name = document.createElement('span')
    name.textContent = label
    row.title = reason
    row.append(amount, name)
    return row
  }

  const paintStatistics = (): void => {
    const stats = options.getStatistics?.()
    if (stats === undefined) {
      body.append(emptyState('Statistics are not available in this shell'))
      return
    }
    const grid = document.createElement('div')
    grid.className = 'info-statistics'
    grid.append(
      statistic(stats.words.toLocaleString(), stats.words === 1 ? 'Word' : 'Words'),
      statistic(stats.characters.toLocaleString(), 'Characters'),
      statistic(stats.paragraphs.toLocaleString(), stats.paragraphs === 1 ? 'Paragraph' : 'Paragraphs'),
      statistic(`${stats.readMinutes}m`, 'Read Time'),
      unavailable('Modified', 'Modified — available when the file port reports timestamps'),
      unavailable('Created', 'Created — available when the file port reports timestamps'),
    )
    body.append(grid)
  }

  const paintContents = (): void => {
    const outline = options.getOutline?.()
    if (outline === undefined || options.onNavigate === undefined) {
      body.append(emptyState('Contents are not available in this shell'))
      return
    }
    if (outline.length === 0) {
      body.append(emptyState('No headings in this document'))
      return
    }
    const list = document.createElement('div')
    list.className = 'info-outline'
    for (const entry of outline) {
      const item = document.createElement('button')
      item.type = 'button'
      item.textContent = entry.text === '' ? '(untitled heading)' : entry.text
      item.dataset['level'] = String(entry.level)
      item.addEventListener('mousedown', (event) => {
        // mousedown so the editor keeps focus; navigation sets the caret.
        event.preventDefault()
        options.onNavigate?.(entry.pos)
      })
      list.append(item)
    }
    body.append(list)
  }

  const paintBacklinks = (): void => {
    // Backlinks need every note's text. The workspace index carries a title and
    // a preview, never a body, so this shell genuinely cannot answer the
    // question — and "No notes link to this one" would be a claim to have
    // looked. Naming the missing capability is the honest empty state.
    body.append(emptyState('Backlinks arrive when a folder catalog can be searched'))
  }

  const paint = (): void => {
    body.replaceChildren()
    heading.textContent = INFO_TABS.find((entry) => entry.id === current)?.label ?? ''
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = button.dataset['tab'] === current
      button.classList.toggle('selected', selected)
      button.setAttribute('aria-selected', String(selected))
    }
    if (current === 'statistics') paintStatistics()
    else if (current === 'contents') paintContents()
    else if (current === 'backlinks') paintBacklinks()
  }

  for (const entry of INFO_TABS) {
    const button = svgButton('info-panel-tab', entry.label, entry.icon)
    button.dataset['tab'] = entry.id
    button.setAttribute('role', 'tab')
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => open(entry.id))
    tabs.append(button)
  }

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }

  function open(tab: InfoTab): void {
    current = tab
    element.hidden = false
    paint()
    // Escape dismisses it. Clicking away does not: this is a panel a person
    // reads *while* editing, so stealing it on the next keystroke in the
    // document would make it useless for the job it exists to do.
    document.addEventListener('keydown', onEscape, true)
  }

  function close(): void {
    current = null
    element.hidden = true
    body.replaceChildren()
    document.removeEventListener('keydown', onEscape, true)
  }

  return {
    element,
    open,
    close,
    tab: () => current,
    refresh: () => {
      if (current !== null) paint()
    },
    // Bear's exact behaviour: the shortcut for the tab you are already looking
    // at closes the panel; any other tab switches to it without closing.
    toggle: (tab) => (current === tab ? close() : open(tab)),
  }
}

function emptyState(message: string): HTMLElement {
  const empty = document.createElement('div')
  empty.className = 'info-empty'
  empty.textContent = message
  return empty
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
  bar.setAttribute('aria-description', 'Drag the palette background to move it. Double-click the background to reset it.')
  bar.hidden = !options.stylesBarVisible

  const closePanels = (): void => {
    for (const panel of bar.querySelectorAll<HTMLElement>('.styles-menu.open')) {
      panel.classList.remove('open')
      panel.previousElementSibling?.setAttribute('aria-expanded', 'false')
    }
  }
  bar.addEventListener('simplemark-close-menus', closePanels)
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const openTrigger = bar.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
    closePanels()
    openTrigger?.focus()
    event.preventDefault()
  })
  const menu = (
    label: string,
    glyph: string,
    content: (panel: HTMLDivElement) => void,
  ): HTMLDivElement => {
    const group = document.createElement('div')
    group.className = 'styles-menu-group'
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'styles-control styles-menu-trigger'
    trigger.innerHTML = glyph
    // Keep the visual chevron out of the command name. It is decoration, not
    // a different action, and keyboard/screen-reader users need a stable name.
    trigger.setAttribute('aria-label', label)
    trigger.title = label
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.addEventListener('mousedown', (event) => event.preventDefault())
    const panel = document.createElement('div')
    panel.className = 'styles-menu'
    panel.setAttribute('role', 'menu')
    content(panel)
    trigger.addEventListener('click', () => {
      const open = !panel.classList.contains('open')
      closePanels()
      panel.classList.toggle('open', open)
      trigger.setAttribute('aria-expanded', String(open))
    })
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      closePanels()
      panel.classList.add('open')
      trigger.setAttribute('aria-expanded', 'true')
      const items = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const item = event.key === 'ArrowDown' ? items[0] : items.at(-1)
      item?.focus()
      event.preventDefault()
    })
    panel.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        .filter((item) => item.offsetParent !== null)
      if (items.length === 0) return
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const index = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length
      items[index]?.focus()
      event.preventDefault()
    })
    group.append(trigger, panel)
    return group
  }
  const command = (
    label: string,
    editorCommand: EditorCommand,
    className = 'styles-control',
    glyph = label,
  ): HTMLButtonElement => {
    const button = commandButton(className, label, glyph, editorCommand, options.onCommand)
    button.addEventListener('click', closePanels)
    return button
  }
  const unavailable = (label: string, reason: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'styles-control styles-menu-unavailable'
    button.textContent = label
    button.disabled = true
    button.title = `${label} — ${reason}`
    return button
  }
  const separator = (): HTMLHRElement => {
    const rule = document.createElement('hr')
    rule.className = 'styles-menu-separator'
    return rule
  }
  const nestedMenu = (
    label: string,
    content: (panel: HTMLDivElement) => void,
  ): HTMLDivElement => {
    const group = document.createElement('div')
    group.className = 'styles-nested-group'
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'styles-control styles-nested-trigger'
    trigger.innerHTML = `<span>${label}</span><span aria-hidden="true">›</span>`
    trigger.setAttribute('aria-label', label)
    trigger.setAttribute('aria-haspopup', 'menu')
    const panel = document.createElement('div')
    panel.className = 'styles-nested-menu'
    panel.setAttribute('role', 'menu')
    content(panel)
    group.append(trigger, panel)
    return group
  }

  const disclosureGlyph = '<svg class="styles-disclosure" viewBox="0 0 8 8" aria-hidden="true"><path d="m1.5 2.5 2.5 2.5 2.5-2.5"/></svg>'
  const headerGlyph = `${tablerIcon('heading', 'styles-glyph-heading')}${disclosureGlyph}`
  const listGlyph = `${tablerIcon('list', 'styles-glyph-list')}${disclosureGlyph}`
  const todoGlyph = tablerIcon('checkbox', 'styles-glyph-todo')
  const linkGlyph = tablerIcon('link', 'styles-glyph-link')
  const tableGlyph = tablerIcon('table', 'styles-glyph-table')
  const highlightGlyph = `${tablerIcon('highlight', 'styles-glyph-highlight')}${disclosureGlyph}`
  const assetGlyph = tablerIcon('photo', 'styles-glyph-asset')
  const moreGlyph = tablerIcon('dots-vertical', 'styles-glyph-more')
  const dragHandle = document.createElement('button')
  dragHandle.type = 'button'
  dragHandle.className = 'styles-drag-handle'
  dragHandle.innerHTML = tablerIcon('grip-vertical')
  dragHandle.setAttribute('aria-label', 'Move formatting palette')
  dragHandle.title = 'Drag to move · double-click to reset'
  dragHandle.addEventListener('click', (event) => event.preventDefault())

  const headers = menu('Headers', headerGlyph, (panel) => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      panel.append(command(`Heading ${level}`, `heading${level}`))
    }
  })
  headers.classList.add('styles-menu-wide', 'styles-menu-headers')
  const lists = menu('Lists', listGlyph, (panel) => {
    panel.append(
      command('List', 'bulletList'),
      command('Ordered List', 'orderedList'),
      command('Block Quote', 'quote'),
      nestedMenu('Todo', (todo) => {
        todo.append(
          command('Todo', 'taskList'),
          command('Toggle', 'toggleTask'),
          command('Mark as Completed', 'completeTask'),
          command('Mark as Incomplete', 'incompleteTask'),
          command('Move Completed to Bottom', 'moveCompletedTasks'),
        )
      }),
      nestedMenu('Callout', (callout) => {
        callout.append(
          command('Note', 'calloutNote'),
          command('Tip', 'calloutTip'),
          command('Important', 'calloutImportant'),
          command('Warning', 'calloutWarning'),
          command('Caution', 'calloutCaution'),
        )
      }),
      command('Separator', 'divider'),
    )
  })
  lists.classList.add('styles-menu-wide', 'styles-menu-lists')
  const highlight = menu('Highlight', highlightGlyph, (panel) => {
    panel.append(command('Default', 'highlight'))
    panel.append(
      command('Green', 'highlightGreen'),
      command('Red', 'highlightRed'),
      command('Blue', 'highlightBlue'),
      command('Yellow', 'highlightYellow'),
      command('Purple', 'highlightPurple'),
    )
  })
  highlight.classList.add('styles-menu-wide', 'styles-menu-highlight')
  const more = menu('More', moreGlyph, (panel) => {
    // Bear's exact primary menu. Every visible item routes through the shared
    // command registry; there are no decorative or web-only controls.
    panel.append(
      command('Underline', 'underline'),
      command('Strikethrough', 'strikethrough'),
      command('Footnote', 'footnote'),
      command('Code', 'inlineCode'),
      command('Code Block', 'codeBlock'),
      command('Math', 'inlineMath'),
      command('Math Block', 'mathBlock'),
      command('Wiki Link', 'wikiLink'),
      separator(),
    )
    // When space collapses these are the controls removed from the main row.
    panel.append(
      command('Todo', 'taskList', 'styles-control styles-overflow-menu-item'),
      command('Bold', 'bold', 'styles-control styles-overflow-menu-item'),
      command('Italic', 'italic', 'styles-control styles-overflow-menu-item'),
      command('Highlight', 'highlight', 'styles-control styles-overflow-menu-item'),
      command('Link', 'link', 'styles-control styles-overflow-menu-item'),
      command('Tables', 'table', 'styles-control styles-overflow-menu-item'),
    )
    const overflowFile = document.createElement('button')
    overflowFile.type = 'button'
    overflowFile.className = 'styles-control styles-overflow-menu-item'
    overflowFile.textContent = 'Image/File'
    if (options.onInsertAsset === undefined) {
      overflowFile.disabled = true
      overflowFile.title = 'Image/File — portable file links are not available on this platform'
    } else {
      overflowFile.addEventListener('mousedown', (event) => event.preventDefault())
      overflowFile.addEventListener('click', () => {
        closePanels()
        options.onInsertAsset?.()
      })
    }
    panel.append(overflowFile)
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
  asset.innerHTML = assetGlyph
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
    dragHandle,
    headers,
    command('Todo', 'taskList', 'styles-control styles-bar-overflow styles-todo', todoGlyph),
    lists,
    command('Bold', 'bold', 'styles-control styles-bar-overflow styles-strong', tablerIcon('bold')),
    command('Italic', 'italic', 'styles-control styles-bar-overflow styles-emphasis', tablerIcon('italic')),
    highlight,
    command('Link', 'link', 'styles-control styles-bar-overflow styles-link', linkGlyph),
    command('Tables', 'table', 'styles-control styles-bar-overflow styles-table', tableGlyph),
    asset,
    more,
  )

  return bar
}

/**
 * Makes the optional palette movable without turning its command buttons into
 * drag handles. The persisted value is a ratio of the document pane, not a
 * screen coordinate, so it remains useful after a window resize.
 */
function installStylesBarDragging(
  bar: HTMLElement,
  surface: HTMLElement,
  initial: StylesBarPosition | undefined,
  onChange: (position: StylesBarPosition | undefined) => void,
): void {
  const margin = 8
  let position = initial
  let drag: {
    pointerId: number
    offsetX: number
    offsetY: number
    startX: number
    startY: number
    moved: boolean
  } | undefined

  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

  const paint = (): void => {
    bar.classList.toggle('is-placed', position !== undefined)
    bar.classList.toggle('menus-below', position !== undefined && position.y < 0.5)
    if (position === undefined) {
      bar.style.removeProperty('--styles-bar-x')
      bar.style.removeProperty('--styles-bar-y')
      return
    }
    bar.style.setProperty('--styles-bar-x', `${position.x * 100}%`)
    bar.style.setProperty('--styles-bar-y', `${position.y * 100}%`)
  }

  const positionFromPointer = (clientX: number, clientY: number): StylesBarPosition => {
    const bounds = surface.getBoundingClientRect()
    const barBounds = bar.getBoundingClientRect()
    const centreX = clamp(
      clientX - bounds.left - (drag?.offsetX ?? barBounds.width / 2) + barBounds.width / 2,
      margin + barBounds.width / 2,
      bounds.width - margin - barBounds.width / 2,
    )
    const centreY = clamp(
      clientY - bounds.top - (drag?.offsetY ?? barBounds.height / 2) + barBounds.height / 2,
      margin + barBounds.height / 2,
      bounds.height - margin - barBounds.height / 2,
    )
    return {
      x: bounds.width === 0 ? 0.5 : centreX / bounds.width,
      y: bounds.height === 0 ? 0.9 : centreY / bounds.height,
    }
  }

  bar.addEventListener('pointerdown', (event) => {
    // A real grip replaces the two-pixel background sliver that was
    // technically draggable but impossible to discover or reliably grab.
    const target = event.target instanceof Element ? event.target.closest('.styles-drag-handle') : null
    if (event.button !== 0 || target === null) return
    if (event.detail >= 2) {
      position = undefined
      paint()
      onChange(undefined)
      event.preventDefault()
      return
    }
    const bounds = bar.getBoundingClientRect()
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    bar.setPointerCapture(event.pointerId)
    bar.classList.add('is-dragging')
    event.preventDefault()
  })

  bar.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    drag.moved = true
    position = positionFromPointer(event.clientX, event.clientY)
    paint()
  })

  const finish = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return
    const moved = drag.moved
    if (moved) position = positionFromPointer(event.clientX, event.clientY)
    bar.releasePointerCapture(event.pointerId)
    drag = undefined
    bar.classList.remove('is-dragging')
    if (moved) {
      paint()
      onChange(position)
    }
  }
  bar.addEventListener('pointerup', finish)
  bar.addEventListener('pointercancel', finish)

  const reset = (event: Event): void => {
    position = undefined
    paint()
    onChange(undefined)
    event.preventDefault()
    event.stopPropagation()
  }
  // Pointer capture can retarget the second click to the palette itself, so
  // listen in capture phase rather than depending on the SVG child target.
  bar.addEventListener('dblclick', reset, true)

  // A restored ratio may be outside the usable centre range after the side
  // panes or window size change. Repaint converts it through CSS; the next
  // drag clamps it precisely to the current surface.
  paint()
}

/**
 * Keeps a quiet, always-legible document position indicator in sync with the
 * actual editor scroller. macOS overlay scrollbars can disappear completely,
 * which removes both the document-length cue and the reader's current place.
 * This is presentation only: the browser's scroll position remains authority.
 */
function installDocumentScrollIndicator(
  scroller: HTMLElement,
  surface: HTMLElement,
  content: HTMLElement,
): () => void {
  const track = document.createElement('div')
  track.className = 'document-scroll-track'
  track.setAttribute('aria-hidden', 'true')
  const thumb = document.createElement('div')
  thumb.className = 'document-scroll-thumb'
  track.append(thumb)
  surface.append(track)

  let frame: number | undefined
  let drag: { pointerId: number; startY: number; startScrollTop: number } | undefined
  let disposed = false

  const paint = (): void => {
    frame = undefined
    const viewport = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const scrollRange = Math.max(0, contentHeight - viewport)
    const visibleRatio = contentHeight === 0 ? 1 : Math.min(1, viewport / contentHeight)
    const thumbHeight = Math.min(trackHeight, Math.max(34, trackHeight * visibleRatio))
    const travel = Math.max(0, trackHeight - thumbHeight)
    const progress = scrollRange === 0 ? 0 : scroller.scrollTop / scrollRange

    track.classList.toggle('is-scrollable', scrollRange > 1)
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${travel * progress}px)`
  }

  const schedulePaint = (): void => {
    if (disposed || frame !== undefined) return
    frame = window.requestAnimationFrame(paint)
  }

  scroller.addEventListener('scroll', schedulePaint, { passive: true })
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver(schedulePaint)
  resizeObserver?.observe(scroller)
  resizeObserver?.observe(content)
  const mutationObserver = new MutationObserver(schedulePaint)
  mutationObserver.observe(content, { childList: true, subtree: true, characterData: true })

  thumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !track.classList.contains('is-scrollable')) return
    drag = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: scroller.scrollTop }
    thumb.setPointerCapture(event.pointerId)
    thumb.classList.add('is-dragging')
    event.preventDefault()
  })
  thumb.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return
    const travel = track.clientHeight - thumb.clientHeight
    const scrollRange = scroller.scrollHeight - scroller.clientHeight
    if (travel > 0) scroller.scrollTop = drag.startScrollTop + ((event.clientY - drag.startY) / travel) * scrollRange
  })
  const finishDrag = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return
    thumb.releasePointerCapture(event.pointerId)
    drag = undefined
    thumb.classList.remove('is-dragging')
  }
  thumb.addEventListener('pointerup', finishDrag)
  thumb.addEventListener('pointercancel', finishDrag)

  schedulePaint()
  return () => {
    disposed = true
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    resizeObserver?.disconnect()
    mutationObserver.disconnect()
  }
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

  // Back and forward through visited notes, hidden by default exactly as Bear
  // hides them. They stay disabled until a catalog can be navigated: a stub
  // with one note has nowhere to go back to, and an enabled arrow that does
  // nothing is the fake control this shell refuses to ship.
  const historyNavigation = document.createElement('div')
  historyNavigation.className = 'history-navigation'
  historyNavigation.hidden = true
  historyNavigation.append(
    svgButton('tool', 'Back', '<path d="m14 6-6 6 6 6"/>', {
      disabled: true,
      owner: 'a real folder catalog',
    }),
    svgButton('tool', 'Forward', '<path d="m10 6 6 6-6 6"/>', {
      disabled: true,
      owner: 'a real folder catalog',
    }),
  )
  const toggleHistoryNavigation = (): void => {
    historyNavigation.hidden = !historyNavigation.hidden
  }

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

  // ---- document information (EDITOR-3, widened for APP-2) ----
  // The contents view was a popover when it was the only one. Statistics and
  // backlinks are the same question about the same document, so all three share
  // one panel rather than each growing a surface of its own.
  const infoPanel = createInfoPanel(options)
  const contentsAvailable = options.getOutline !== undefined && options.onNavigate !== undefined

  const contentsButton = document.createElement('button')
  contentsButton.type = 'button'
  contentsButton.className = 'tool contents'
  contentsButton.setAttribute('aria-label', 'Contents')
  contentsButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12M4 12h16M7 18h13"/></svg>'
  if (contentsAvailable) {
    contentsButton.title = 'Contents'
    contentsButton.addEventListener('click', () => infoPanel.toggle('contents'))
  } else {
    contentsButton.disabled = true
    contentsButton.title = 'Contents — not available in this shell'
  }
  left.append(contentsButton)

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
  // Bear's pair at the window's trailing edge: styles bar, then the document
  // information panel. The native shell shows them because its titlebar has no
  // other editing furniture; the web shell keeps the same two in `left`.
  // No styles-bar switch in the titlebar. Bear needs one because its bar is
  // pinned out of the way at the bottom of the editor; ours is a movable
  // palette that is already where the person put it, and View › Toggle Styles
  // Bar (⇧⌘Y) covers hiding it. A second control would be titlebar furniture
  // competing with the document, which is what the titlebar rule forbids.
  const infoButton = svgButton(
    'tool document-information',
    'Document information',
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  )
  infoButton.addEventListener('click', () => infoPanel.toggle('statistics'))
  if (isMacOS) right.append(infoButton)

  const stylesBar = createStylesBar(options)

  // The word count rides *inside* the palette rather than beside it.
  //
  // Bear can put its count in a separate pill because Bear's styles bar is
  // pinned to the bottom of the editor. Ours is draggable, and a second element
  // that had to chase it would either lag behind or need the drag code to know
  // about it. Living in the bar, it simply moves.
  const wordCount = document.createElement('div')
  wordCount.className = 'word-count'
  wordCount.hidden = true
  wordCount.setAttribute('aria-label', 'Word count')
  stylesBar.append(wordCount)
  const paintWordCount = (): void => {
    if (wordCount.hidden) return
    const words = options.getStatistics?.().words ?? 0
    wordCount.textContent = `${words.toLocaleString()} ${words === 1 ? 'Word' : 'Words'}`
  }
  const toggleWordCount = (): void => {
    wordCount.hidden = !wordCount.hidden
    paintWordCount()
  }

  const stylesBarToggle = document.createElement('button')
  stylesBarToggle.type = 'button'
  stylesBarToggle.className = 'styles-bar-menu-toggle'
  const paintStylesBarToggle = (): void => {
    stylesBarToggle.textContent = stylesBar.hidden ? 'Show styles bar' : 'Hide styles bar'
  }
  const toggleStylesBar = (): void => {
    const visible = stylesBar.hidden
    stylesBar.hidden = !visible
    options.onStylesBarVisibleChange(visible)
    paintStylesBarToggle()
  }
  paintStylesBarToggle()
  stylesBarToggle.addEventListener('mousedown', (event) => event.preventDefault())
  stylesBarToggle.addEventListener('click', toggleStylesBar)
  // The same tiny View/Format affordance restores a deliberately hidden bar;
  // hiding it can never strand the user without a way back.
  popover.append(stylesBarToggle)

  // Bear keeps the history arrows at the window's leading edge in both cases:
  // beside the native traffic lights, or at the head of the web toolbar.
  if (isMacOS) titlebar.append(historyNavigation, filename, right)
  else {
    left.insertBefore(historyNavigation, documentListButton.nextSibling)
    titlebar.append(left, filename, editTools, right)
  }

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
  documentSurface.append(stylesBar, editorSection, infoPanel.element)
  const disposeDocumentScrollIndicator = installDocumentScrollIndicator(editorSection, documentSurface, page)
  windowEl.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !stylesBar.contains(event.target)) {
      stylesBar.dispatchEvent(new Event('simplemark-close-menus'))
    }
  })
  installStylesBarDragging(
    stylesBar,
    documentSurface,
    options.stylesBarPosition,
    options.onStylesBarPositionChange,
  )

  let setWorkspaceMode = (_mode: WorkspaceMode): void => {}
  let getWorkspaceMode = (): WorkspaceMode => 'editor'
  let toggleWorkspacePin = (_id: string): void => {}
  let workspacePinState = (_id: string): boolean => false

  // Note-list view state lives out here so the chrome answers the same
  // questions with or without a workspace. Without one these hold the defaults
  // and nothing reads them — the composition root disables the commands.
  let previewDensity: PreviewDensity = 'medium'
  let notesSort: NotesSort = 'modified'
  let newestOnTop = true
  let foldersSort: FoldersSort = 'title'
  let foldersAtoZ = false
  let repaintNoteList = (): void => {}

  if (options.workspace === undefined) {
    windowEl.append(titlebar, documentSurface)
  } else {
    const workspace = options.workspace
    const workspaceNotes = workspace.notes.map((note) => ({ ...note }))
    const modifiedOrder = new Map(workspaceNotes.map((note, index) => [note.id, index]))
    const pinOrder = new Map(workspaceNotes.filter((note) => note.pinned).map((note) => [note.id, 0]))
    let pinSequence = 0
    const workspaceBody = document.createElement('div')
    workspaceBody.className = 'workspace-body'

    const folders = document.createElement('aside')
    folders.className = 'workspace-folders'
    folders.setAttribute('aria-label', 'Library')
    const workspaceHeader = document.createElement('div')
    workspaceHeader.className = 'workspace-library-head'

    let noteFilter: 'all' | 'pinned' = 'all'

    const libraryRows = document.createElement('div')
    libraryRows.className = 'library-rows'
    const makeLibraryRow = (
      label: string,
      icon: TablerIconName,
      count: string,
      filter?: 'all' | 'pinned',
    ): HTMLButtonElement => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'folder-row'
      row.innerHTML = `<span class="library-icon" aria-hidden="true">${tablerIcon(icon)}</span><span>${label}</span><span class="folder-count">${count}</span>`
      if (filter === undefined) {
        row.disabled = true
        row.title = `${label} — available when a real folder catalog is connected`
      } else {
        row.dataset['filter'] = filter
      }
      return row
    }
    const allNotes = makeLibraryRow(
      'Recent Notes',
      'notes',
      String(workspace.recentNotesCount ?? workspaceNotes.length),
      'all',
    )
    const untagged = makeLibraryRow(
      'Untagged',
      'archive',
      '—',
    )
    const todo = makeLibraryRow('Todo', 'square', '—')
    const today = makeLibraryRow(
      'Today',
      'calendar',
      '—',
    )
    const pinned = makeLibraryRow(
      'Pinned',
      'pin',
      String(workspaceNotes.filter((note) => note.pinned).length),
      'pinned',
    )
    const trash = makeLibraryRow(
      'Trash',
      'trash',
      '',
    )
    const folderHead = document.createElement('div')
    folderHead.className = 'library-section-head'
    const folderLabel = document.createElement('div')
    folderLabel.className = 'library-section-label'
    folderLabel.textContent = 'Folders'
    const addFolder = document.createElement('button')
    addFolder.type = 'button'
    addFolder.className = 'library-section-action'
    addFolder.setAttribute('aria-label', 'Add folder')
    addFolder.title = 'Add a Markdown folder'
    addFolder.innerHTML = tablerIcon('folder-plus')
    if (workspace.onAddFolder === undefined) {
      addFolder.disabled = true
      addFolder.title = 'Add Folder — available in the Mac app'
    } else addFolder.addEventListener('click', () => workspace.onAddFolder?.())
    folderHead.append(folderLabel, addFolder)

    const folderRows = (workspace.folders ?? []).map((folder) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'folder-row folder-root'
      row.dataset['folderId'] = folder.id
      row.innerHTML = `<span class="library-icon" aria-hidden="true">${tablerIcon('folder')}</span><span>${folder.name}</span><span class="folder-count">${folder.count}</span>`
      if (workspace.onSelectCollection === undefined) row.disabled = true
      else row.addEventListener('click', () => workspace.onSelectCollection?.(folder.id))
      return row
    })
    libraryRows.append(allNotes, untagged, todo, today, pinned, trash, folderHead, ...folderRows)
    const libraryFooter = document.createElement('div')
    libraryFooter.className = 'workspace-library-footer'
    const sync = document.createElement('button')
    sync.type = 'button'
    sync.setAttribute('aria-label', 'Folder sync status')
    sync.innerHTML = tablerIcon('refresh')
    sync.disabled = true
    sync.title = 'Folder sync — available when a real folder catalog is connected'
    const settings = document.createElement('button')
    settings.type = 'button'
    settings.setAttribute('aria-label', 'Settings')
    settings.innerHTML = tablerIcon('settings')
    settings.title = 'Reader settings'
    settings.addEventListener('click', () => {
      const open = popover.classList.toggle('open')
      settings.classList.toggle('active', open)
    })
    libraryFooter.append(sync, settings)
    if (isMacOS) {
      popover.classList.add('sidebar-settings-popover')
      folders.append(workspaceHeader, libraryRows, libraryFooter, popover)
    } else {
      folders.append(workspaceHeader, libraryRows, libraryFooter)
    }

    const installColumnResizer = (
      column: HTMLElement,
      property: '--library-column-width' | '--notes-column-width',
      minimum: number,
      maximum: number,
      label: string,
    ): void => {
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'column-resizer'
      handle.setAttribute('aria-label', label)
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = column.getBoundingClientRect().width
        handle.classList.add('dragging')
        handle.setPointerCapture(event.pointerId)
        const move = (moveEvent: PointerEvent): void => {
          const width = Math.max(minimum, Math.min(maximum, startWidth + moveEvent.clientX - startX))
          workspaceBody.style.setProperty(property, `${Math.round(width)}px`)
        }
        const finish = (): void => {
          handle.classList.remove('dragging')
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', finish)
          handle.removeEventListener('pointercancel', finish)
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', finish)
        handle.addEventListener('pointercancel', finish)
      })
      column.append(handle)
    }
    installColumnResizer(folders, '--library-column-width', 160, 360, 'Resize navigation column')

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
      tablerIconPaths('search'),
    )
    const newNoteButton = svgButton(
      'notes-action',
      'New note',
      tablerIconPaths('pencil-plus'),
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
    countRow.textContent = `${workspaceNotes.length} notes`
    const datesKnown = workspaceNotes.every((note) => note.updatedAt !== undefined)
    const createdKnown = workspaceNotes.every((note) => note.createdAt !== undefined)
    const sortModified = menuRow('Sort by modification date')
    const sortCreated = menuRow('Sort by creation date')
    if (!createdKnown) {
      sortCreated.disabled = true
      sortCreated.title = 'Creation date — available when the catalog reports timestamps'
    }
    const sortTitle = menuRow('Sort by title')
    const newestOnTopRow = menuRow('Newest on top')
    const previewSmall = menuRow('Small preview')
    const previewMedium = menuRow('Medium preview')
    const previewLarge = menuRow('Large preview')
    const exportNotes = menuRow('Export…')
    exportNotes.disabled = true
    exportNotes.title = 'Export — available when a real folder catalog is connected'
    const showAll = menuRow('Recent Notes')
    const showPinned = menuRow('Pinned')
    notesMenu.append(
      countRow,
      sortModified,
      sortCreated,
      sortTitle,
      newestOnTopRow,
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

    const noteContextMenu = document.createElement('div')
    noteContextMenu.className = 'note-context-menu'
    noteContextMenu.hidden = true
    noteContextMenu.setAttribute('role', 'menu')
    let contextNote: WorkspaceNote | undefined
    const contextRow = (
      label: string,
      action: () => void | Promise<void>,
    ): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'note-context-row'
      button.textContent = label
      button.setAttribute('role', 'menuitem')
      button.addEventListener('click', () => {
        void action()
        noteContextMenu.hidden = true
      })
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        button.click()
      })
      return button
    }
    const contextPin = contextRow('Pin To Top', () => {
      if (contextNote !== undefined) toggleWorkspacePin(contextNote.id)
    })
    const contextOpen = contextRow('Open', () => {
      if (contextNote !== undefined) workspace.onSelectNote?.(contextNote.id)
    })
    const contextCopyMarkdown = contextRow('Copy Markdown', async () => {
      if (contextNote !== undefined) await workspace.onCopyMarkdown?.(contextNote.id)
    })
    const contextCopyLink = contextRow('Copy Link', async () => {
      if (contextNote?.portableLink !== undefined) {
        await workspace.onCopyText?.(contextNote.portableLink)
      }
    })
    const contextCopyIdentifier = contextRow(
      'Copy Identifier',
      async () => {
        const identifier = contextNote?.identifier ?? contextNote?.title
        if (identifier !== undefined) await workspace.onCopyText?.(identifier)
      },
    )
    const contextExport = contextRow('Export As…', async () => {
      if (contextNote !== undefined) await workspace.onExportNote?.(contextNote.id)
    })
    const contextDelete = contextRow('Move to Trash', async () => {
      if (contextNote !== undefined) await workspace.onTrashNote?.(contextNote.id)
    })
    const contextDuplicate = contextRow('Duplicate', async () => {
      if (contextNote !== undefined) await workspace.onDuplicateNote?.(contextNote.id)
    })
    // Every visible note gets the same close affordance. Recent Notes delegates
    // to the application model; folder browsing and the native welcome row
    // hide locally because closing a view must never delete or trash a file.
    const canCloseNote = true
    const closeWorkspaceNote = async (note: WorkspaceNote): Promise<void> => {
      if (workspace.onCloseNote !== undefined) {
        await workspace.onCloseNote(note.id)
        return
      }
      const index = workspaceNotes.findIndex((candidate) => candidate.id === note.id)
      if (index < 0) return
      workspaceNotes.splice(index, 1)
      paintLibrary()
      paintNotes()
    }
    const contextClose = contextRow('Close Note', async () => {
      if (contextNote !== undefined) await closeWorkspaceNote(contextNote)
    })
    const contextDivider = (): HTMLHRElement => document.createElement('hr')
    noteContextMenu.append(
      contextPin,
      contextDivider(),
      contextOpen,
      ...(workspace.onCopyMarkdown === undefined ? [] : [contextCopyMarkdown]),
      ...(workspace.onCopyText === undefined ? [] : [contextCopyLink, contextCopyIdentifier]),
      ...(workspace.onExportNote === undefined ? [] : [contextDivider(), contextExport]),
      ...(workspace.onDuplicateNote === undefined ? [] : [contextDuplicate]),
      ...(canCloseNote ? [contextDivider(), contextClose] : []),
      ...(workspace.onTrashNote === undefined ? [] : [contextDivider(), contextDelete]),
    )

    const paintLibrary = (): void => {
      for (const row of [allNotes, pinned]) {
        const allIsActive = workspace.activeCollectionId === undefined || workspace.activeCollectionId === 'recent'
        row.classList.toggle(
          'selected',
          row === pinned ? noteFilter === 'pinned' : noteFilter === 'all' && allIsActive,
        )
      }
      for (const row of folderRows) {
        row.classList.toggle('selected', row.dataset['folderId'] === workspace.activeCollectionId)
      }
      allNotes.querySelector('.folder-count')!.textContent = String(
        workspace.recentNotesCount ?? workspaceNotes.length,
      )
      pinned.querySelector('.folder-count')!.textContent = String(
        workspaceNotes.filter((note) => note.pinned).length,
      )
    }

    const paintMenuState = (): void => {
      // The title is built rather than interpolated: `collectionLabel` is a
      // folder name off the disk, and innerHTML would let a folder called
      // `<img onerror=…>` write markup into the chrome.
      const tick = (on: boolean): string => (on ? '✓  ' : '')
      const label = document.createElement('span')
      label.textContent = noteFilter === 'pinned' ? 'Pinned' : (workspace.collectionLabel ?? 'Recent Notes')
      const disclosure = document.createElement('span')
      disclosure.setAttribute('aria-hidden', 'true')
      disclosure.innerHTML = tablerIcon('chevron-down')
      notesTitle.replaceChildren(label, disclosure)
      sortModified.textContent = `${tick(notesSort === 'modified')}Sort by modification date`
      sortCreated.textContent = `${tick(notesSort === 'created')}Sort by creation date`
      sortTitle.textContent = `${tick(notesSort === 'title')}Sort by title`
      newestOnTopRow.textContent = `${tick(newestOnTop)}Newest on top`
      previewSmall.textContent = `${tick(previewDensity === 'small')}Small preview`
      previewMedium.textContent = `${tick(previewDensity === 'medium')}Medium preview`
      previewLarge.textContent = `${tick(previewDensity === 'large')}Large preview`
      showAll.textContent = `${tick(noteFilter === 'all')}Recent Notes`
      showPinned.textContent = `${tick(noteFilter === 'pinned')}Pinned`
      noteList.dataset['preview'] = previewDensity
      paintLibrary()
    }

    const paintNotes = (): void => {
      const query = search.value.trim().toLocaleLowerCase()
      noteItems.replaceChildren()
      // Pin state leads every date order, most recently pinned first; the
      // chosen sort decides the rest. `Newest on Top` flips only the date
      // orders — reversing a title sort is what `A to Z` means, and that is
      // offered under Folders Sorting rather than here.
      //
      // Modification order comes from the catalog's own sequence rather than
      // from a timestamp, because that is the order the catalog actually knows;
      // creation date needs a real stamp, and the menu disables that sort when
      // the catalog cannot supply one.
      const visibleNotes = [...workspaceNotes]
        .filter((note) => noteFilter === 'all' || note.pinned)
        .filter((note) => query === '' || `${note.title} ${note.preview}`.toLocaleLowerCase().includes(query))
        .sort((left, right) => {
          if (notesSort === 'title') return left.title.localeCompare(right.title)
          const pinDifference = Number(right.pinned) - Number(left.pinned)
          if (pinDifference !== 0) return pinDifference
          if (left.pinned && right.pinned) {
            const recency = (pinOrder.get(right.id) ?? 0) - (pinOrder.get(left.id) ?? 0)
            if (recency !== 0) return recency
          }
          const order =
            notesSort === 'created'
              ? (right.createdAt ?? 0) - (left.createdAt ?? 0)
              : (modifiedOrder.get(left.id) ?? 0) - (modifiedOrder.get(right.id) ?? 0)
          return newestOnTop ? order : -order
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
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'note-close'
        close.setAttribute('aria-label', `Close ${note.title}`)
        close.title = 'Close note — file remains on disk'
        close.innerHTML = tablerIcon('x')
        close.addEventListener('click', () => void closeWorkspaceNote(note))
        const pin = document.createElement('button')
        pin.type = 'button'
        pin.className = 'note-pin'
        pin.setAttribute('aria-label', `${note.pinned ? 'Unpin' : 'Pin'} ${note.title}`)
        pin.title = note.pinned ? 'Unpin note' : 'Pin note'
        pin.innerHTML = tablerIcon('pin')
        pin.classList.toggle('pinned', note.pinned)
        if (workspace.onTogglePinned === undefined) {
          pin.disabled = true
          pin.title = 'Pin — available when a real folder catalog is connected'
        } else pin.addEventListener('click', () => toggleWorkspacePin(note.id))
        item.addEventListener('contextmenu', (event) => {
          event.preventDefault()
          contextNote = note
          contextPin.textContent = note.pinned ? 'Unpin' : 'Pin To Top'
          contextPin.disabled = workspace.onTogglePinned === undefined
          contextOpen.disabled = workspace.onSelectNote === undefined
          contextCopyLink.disabled = note.portableLink === undefined || workspace.onCopyText === undefined
          noteContextMenu.hidden = false
          noteContextMenu.style.left = `${event.clientX}px`
          noteContextMenu.style.top = `${event.clientY}px`
          requestAnimationFrame(() => {
            const bounds = noteContextMenu.getBoundingClientRect()
            noteContextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`
            noteContextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`
            const first = noteContextMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')
            first?.focus()
          })
        })
        item.append(select, ...(canCloseNote ? [close] : []), pin)
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
      if (!(target instanceof Node)) return
      if (!notesMenu.hidden && !notesMenu.contains(target) && !notesTitle.contains(target)) closeNotesMenu()
      if (!noteContextMenu.hidden && !noteContextMenu.contains(target)) noteContextMenu.hidden = true
    })
    windowEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (!notesMenu.hidden) {
        closeNotesMenu()
        notesTitle.focus()
      } else if (!noteContextMenu.hidden) {
        noteContextMenu.hidden = true
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
    const selectRecentNotes = (): void => {
      if (workspace.onSelectCollection !== undefined && workspace.activeCollectionId !== 'recent') {
        workspace.onSelectCollection('recent')
        return
      }
      noteFilter = 'all'
      paintMenuState()
      paintNotes()
    }
    allNotes.addEventListener('click', selectRecentNotes)
    pinned.addEventListener('click', () => {
      noteFilter = 'pinned'
      paintMenuState()
      paintNotes()
    })
    for (const [button, sort] of [
      [sortModified, 'modified'],
      [sortCreated, 'created'],
      [sortTitle, 'title'],
    ] as const) {
      button.addEventListener('click', () => {
        notesSort = sort
        paintMenuState()
        paintNotes()
        closeNotesMenu()
      })
    }
    newestOnTopRow.addEventListener('click', () => {
      newestOnTop = !newestOnTop
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
      closeNotesMenu()
      selectRecentNotes()
    })
    showPinned.addEventListener('click', () => {
      noteFilter = 'pinned'
      paintMenuState()
      paintNotes()
      closeNotesMenu()
    })
    search.addEventListener('input', paintNotes)
    toggleWorkspacePin = (id: string): void => {
      const note = workspaceNotes.find((candidate) => candidate.id === id)
      if (note === undefined || workspace.onTogglePinned === undefined) return
      note.pinned = workspace.onTogglePinned(id)
      // Bear treats a new pin as a fresh placement at the top. Unpinning
      // returns the note to modification order instead of leaving it stranded.
      if (note.pinned) pinOrder.set(note.id, ++pinSequence)
      else pinOrder.delete(note.id)
      paintMenuState()
      paintNotes()
    }
    workspacePinState = (id: string): boolean =>
      workspaceNotes.find((note) => note.id === id)?.pinned ?? false
    // The menubar mutates the same state the note-list dropdown does, so both
    // surfaces repaint through one function rather than each keeping its own.
    repaintNoteList = (): void => {
      paintMenuState()
      paintNotes()
    }
    repaintNoteList()
    noteItems.addEventListener('scroll', () => {
      noteContextMenu.hidden = true
    })
    noteList.append(notesHeader, notesMenu, noteItems, noteContextMenu)
    installColumnResizer(noteList, '--notes-column-width', 205, 440, 'Resize note list column')

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
    toggleInfoTab: (tab) => infoPanel.toggle(tab),
    infoTab: () => infoPanel.tab(),
    openContents: () => infoPanel.open('contents'),
    toggleWordCount,
    wordCountVisible: () => !wordCount.hidden,
    refreshStatistics() {
      paintWordCount()
      infoPanel.refresh()
    },
    setPreferences(next) {
      preferences = next
      paintPreferenceUi()
    },
    toggleHistoryNavigation,
    historyNavigationVisible: () => !historyNavigation.hidden,
    setWorkspaceMode: (mode) => setWorkspaceMode(mode),
    workspaceMode: () => getWorkspaceMode(),
    setPreviewDensity(density) {
      previewDensity = density
      repaintNoteList()
    },
    previewDensity: () => previewDensity,
    setNotesSort(sort) {
      notesSort = sort
      repaintNoteList()
    },
    notesSort: () => notesSort,
    toggleNewestOnTop() {
      newestOnTop = !newestOnTop
      repaintNoteList()
    },
    newestOnTop: () => newestOnTop,
    setFoldersSort(sort) {
      foldersSort = sort
    },
    foldersSort: () => foldersSort,
    toggleFoldersAtoZ() {
      foldersAtoZ = !foldersAtoZ
    },
    foldersAtoZ: () => foldersAtoZ,
    togglePinned: (id) => toggleWorkspacePin(id),
    isPinned: (id) => workspacePinState(id),
    dispose: disposeDocumentScrollIndicator,
    setStatus(state, message) {
      status.dataset['state'] = state
      status.textContent =
        message ?? (state === 'saved' ? 'Saved' : state === 'dirty' ? 'Unsaved changes' : 'Error')
    },
  }
}
