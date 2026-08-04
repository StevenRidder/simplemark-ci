/**
 * The one command vocabulary both shells speak.
 *
 * Native-first: the macOS menubar is the reliable, complete command surface,
 * and the web toolbar, popovers, and styles bar are shortcut layers over the
 * same ids. Neither shell owns the list — a command exists here or it does not
 * exist, and a shell that cannot show one is missing a surface rather than
 * missing a feature.
 *
 * This is deliberately data, not behaviour. It names commands, groups them into
 * menus, and gives them accelerators; it does not know what `bold` does. The
 * composition root routes an id to the editor or to the shell, which is what
 * keeps the menubar from growing its own copy of the editing rules — the exact
 * mistake "port the web menu" would have made.
 */

export type DocumentCommandId =
  // Block structure
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'quote'
  | 'codeBlock'
  | 'divider'
  // Inline emphasis
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'highlight'
  | 'highlightGreen'
  | 'highlightRed'
  | 'highlightBlue'
  | 'highlightYellow'
  | 'highlightPurple'
  | 'inlineCode'
  | 'footnote'
  | 'inlineMath'
  | 'mathBlock'
  | 'link'
  | 'wikiLink'
  // Lists
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'toggleTask'
  | 'completeTask'
  | 'incompleteTask'
  | 'moveCompletedTasks'
  | 'calloutNote'
  | 'calloutTip'
  | 'calloutImportant'
  | 'calloutWarning'
  | 'calloutCaution'
  // Blocks and objects
  | 'table'
  | 'insertAsset'
  | 'convertToDiagram'
  | 'moveBlockUp'
  | 'moveBlockDown'
  // History
  | 'undo'
  | 'redo'
  // Shell
  | 'openFile'
  | 'openFolder'
  | 'newNote'
  | 'save'
  | 'print'
  | 'find'
  | 'togglePinned'
  // View — reading size
  | 'zoomIn'
  | 'zoomOut'
  | 'actualSize'
  // View — reader typography
  | 'themeWhite'
  | 'themeTan'
  | 'themeNight'
  | 'fontIowan'
  | 'fontGeorgia'
  | 'fontSystem'
  | 'fontMono'
  | 'widthNarrow'
  | 'widthNormal'
  | 'widthWide'
  | 'leadingTight'
  | 'leadingNormal'
  | 'leadingOpen'
  | 'spacingCompact'
  | 'spacingNormal'
  | 'spacingAiry'
  | 'toggleFirstLineIndent'
  // View — note list
  | 'previewSmall'
  | 'previewMedium'
  | 'previewLarge'
  | 'hideAttachments'
  | 'sortByModified'
  | 'sortByCreated'
  | 'sortByTitle'
  | 'toggleNewestOnTop'
  | 'sortFoldersByTitle'
  | 'sortFoldersByCount'
  | 'toggleFoldersAtoZ'
  // View — panes
  | 'showAllPanes'
  | 'showNotesAndEditor'
  | 'showEditorOnly'
  // View — document information
  | 'toggleStatistics'
  | 'contents'
  | 'toggleBacklinks'
  // View — chrome
  | 'toggleWordCount'
  | 'toggleStylesBar'
  | 'toggleHistoryNavigation'

/**
 * Where an id is executed.
 *
 * `editor` ids are forwarded to the editor adapter untranslated; `shell` ids
 * are handled by the composition root. The split lives with the command so no
 * surface has to guess.
 */
export type CommandTarget = 'editor' | 'shell'

export interface CommandDefinition {
  readonly id: DocumentCommandId
  readonly label: string
  readonly target: CommandTarget
  /**
   * Tauri accelerator syntax, which the web surfaces also render as a hint.
   * Absent means the command is reachable but has no shortcut.
   */
  readonly accelerator?: string
  /** Shown with a checkmark in menus; its state comes from the shell. */
  readonly checkable?: boolean
  /**
   * Names a set of mutually exclusive choices, like the three reader themes.
   *
   * macOS has no radio menu item, so a group is still built from checkables —
   * what the name buys is the guarantee that picking one clears the others.
   * Without it a menu accumulates checkmarks and stops describing the app.
   */
  readonly group?: string
}

/** Every command, exactly once. */
export const COMMANDS: Readonly<Record<DocumentCommandId, CommandDefinition>> = {
  heading1: { id: 'heading1', label: 'Heading 1', target: 'editor', accelerator: 'CmdOrCtrl+1' },
  heading2: { id: 'heading2', label: 'Heading 2', target: 'editor', accelerator: 'CmdOrCtrl+2' },
  heading3: { id: 'heading3', label: 'Heading 3', target: 'editor', accelerator: 'CmdOrCtrl+3' },
  heading4: { id: 'heading4', label: 'Heading 4', target: 'editor', accelerator: 'CmdOrCtrl+4' },
  heading5: { id: 'heading5', label: 'Heading 5', target: 'editor', accelerator: 'CmdOrCtrl+5' },
  heading6: { id: 'heading6', label: 'Heading 6', target: 'editor', accelerator: 'CmdOrCtrl+6' },
  quote: { id: 'quote', label: 'Quote', target: 'editor', accelerator: "CmdOrCtrl+Shift+'" },
  codeBlock: { id: 'codeBlock', label: 'Code Block', target: 'editor', accelerator: 'CmdOrCtrl+Shift+C' },
  divider: { id: 'divider', label: 'Divider', target: 'editor' },

  bold: { id: 'bold', label: 'Bold', target: 'editor', accelerator: 'CmdOrCtrl+B' },
  italic: { id: 'italic', label: 'Italic', target: 'editor', accelerator: 'CmdOrCtrl+I' },
  underline: { id: 'underline', label: 'Underline', target: 'editor', accelerator: 'CmdOrCtrl+U' },
  strikethrough: {
    id: 'strikethrough',
    label: 'Strikethrough',
    target: 'editor',
    accelerator: 'CmdOrCtrl+Shift+X',
  },
  highlight: { id: 'highlight', label: 'Highlight', target: 'editor', accelerator: 'CmdOrCtrl+Shift+H' },
  highlightGreen: { id: 'highlightGreen', label: 'Green', target: 'editor' },
  highlightRed: { id: 'highlightRed', label: 'Red', target: 'editor' },
  highlightBlue: { id: 'highlightBlue', label: 'Blue', target: 'editor' },
  highlightYellow: { id: 'highlightYellow', label: 'Yellow', target: 'editor' },
  highlightPurple: { id: 'highlightPurple', label: 'Purple', target: 'editor' },
  inlineCode: { id: 'inlineCode', label: 'Inline Code', target: 'editor', accelerator: 'CmdOrCtrl+E' },
  footnote: { id: 'footnote', label: 'Footnote', target: 'editor' },
  inlineMath: { id: 'inlineMath', label: 'Math', target: 'editor' },
  mathBlock: { id: 'mathBlock', label: 'Math Block', target: 'editor' },
  link: { id: 'link', label: 'Link…', target: 'editor', accelerator: 'CmdOrCtrl+K' },
  wikiLink: { id: 'wikiLink', label: 'Wiki Link', target: 'editor' },

  bulletList: { id: 'bulletList', label: 'Bulleted List', target: 'editor', accelerator: 'CmdOrCtrl+Shift+8' },
  orderedList: { id: 'orderedList', label: 'Numbered List', target: 'editor', accelerator: 'CmdOrCtrl+Shift+9' },
  taskList: { id: 'taskList', label: 'Todo', target: 'editor', accelerator: 'CmdOrCtrl+Shift+T' },
  toggleTask: { id: 'toggleTask', label: 'Toggle', target: 'editor' },
  completeTask: { id: 'completeTask', label: 'Mark as Completed', target: 'editor' },
  incompleteTask: { id: 'incompleteTask', label: 'Mark as Incomplete', target: 'editor' },
  moveCompletedTasks: { id: 'moveCompletedTasks', label: 'Move Completed to Bottom', target: 'editor' },
  calloutNote: { id: 'calloutNote', label: 'Note', target: 'editor' },
  calloutTip: { id: 'calloutTip', label: 'Tip', target: 'editor' },
  calloutImportant: { id: 'calloutImportant', label: 'Important', target: 'editor' },
  calloutWarning: { id: 'calloutWarning', label: 'Warning', target: 'editor' },
  calloutCaution: { id: 'calloutCaution', label: 'Caution', target: 'editor' },

  table: { id: 'table', label: 'Table', target: 'editor' },
  insertAsset: { id: 'insertAsset', label: 'Insert Image…', target: 'shell' },
  convertToDiagram: { id: 'convertToDiagram', label: 'Convert to Diagram', target: 'editor' },
  moveBlockUp: { id: 'moveBlockUp', label: 'Move Block Up', target: 'editor', accelerator: 'CmdOrCtrl+Shift+Up' },
  moveBlockDown: {
    id: 'moveBlockDown',
    label: 'Move Block Down',
    target: 'editor',
    accelerator: 'CmdOrCtrl+Shift+Down',
  },

  undo: { id: 'undo', label: 'Undo', target: 'editor', accelerator: 'CmdOrCtrl+Z' },
  redo: { id: 'redo', label: 'Redo', target: 'editor', accelerator: 'CmdOrCtrl+Shift+Z' },

  openFile: { id: 'openFile', label: 'Open…', target: 'shell', accelerator: 'CmdOrCtrl+O' },
  openFolder: { id: 'openFolder', label: 'Open Folder…', target: 'shell' },
  newNote: { id: 'newNote', label: 'New Note', target: 'shell', accelerator: 'CmdOrCtrl+N' },
  save: { id: 'save', label: 'Save', target: 'shell', accelerator: 'CmdOrCtrl+S' },
  print: { id: 'print', label: 'Print…', target: 'shell', accelerator: 'CmdOrCtrl+P' },
  find: { id: 'find', label: 'Find in Document…', target: 'shell', accelerator: 'CmdOrCtrl+F' },
  togglePinned: { id: 'togglePinned', label: 'Pin to Top', target: 'shell', checkable: true },

  // Reading size. One multiplier over the whole document, never a selection
  // (D6) — which is why these are shell commands rather than editor ones.
  // `Equal`, not `Plus`: macOS renders ⌘= as "⌘+" in the menu, and the native
  // accelerator grammar has no main-keyboard Plus at all — only NumpadPlus. A
  // key it cannot parse does not degrade to an unbound item, it throws and
  // takes the entire menubar down with it.
  zoomIn: { id: 'zoomIn', label: 'Zoom In', target: 'shell', accelerator: 'CmdOrCtrl+Equal' },
  zoomOut: { id: 'zoomOut', label: 'Zoom Out', target: 'shell', accelerator: 'CmdOrCtrl+Minus' },
  actualSize: { id: 'actualSize', label: 'Actual Size', target: 'shell', accelerator: 'CmdOrCtrl+0' },

  themeWhite: { id: 'themeWhite', label: 'White', target: 'shell', checkable: true, group: 'readerTheme' },
  themeTan: { id: 'themeTan', label: 'Tan', target: 'shell', checkable: true, group: 'readerTheme' },
  themeNight: { id: 'themeNight', label: 'Night', target: 'shell', checkable: true, group: 'readerTheme' },

  fontIowan: { id: 'fontIowan', label: 'Iowan', target: 'shell', checkable: true, group: 'readerFamily' },
  fontGeorgia: { id: 'fontGeorgia', label: 'Georgia', target: 'shell', checkable: true, group: 'readerFamily' },
  fontSystem: { id: 'fontSystem', label: 'System', target: 'shell', checkable: true, group: 'readerFamily' },
  fontMono: { id: 'fontMono', label: 'Mono', target: 'shell', checkable: true, group: 'readerFamily' },

  widthNarrow: { id: 'widthNarrow', label: 'Narrow', target: 'shell', checkable: true, group: 'readerWidth' },
  widthNormal: { id: 'widthNormal', label: 'Normal', target: 'shell', checkable: true, group: 'readerWidth' },
  widthWide: { id: 'widthWide', label: 'Wide', target: 'shell', checkable: true, group: 'readerWidth' },

  leadingTight: { id: 'leadingTight', label: 'Tight', target: 'shell', checkable: true, group: 'readerLeading' },
  leadingNormal: { id: 'leadingNormal', label: 'Normal', target: 'shell', checkable: true, group: 'readerLeading' },
  leadingOpen: { id: 'leadingOpen', label: 'Open', target: 'shell', checkable: true, group: 'readerLeading' },

  spacingCompact: {
    id: 'spacingCompact',
    label: 'Compact',
    target: 'shell',
    checkable: true,
    group: 'readerSpacing',
  },
  spacingNormal: {
    id: 'spacingNormal',
    label: 'Normal',
    target: 'shell',
    checkable: true,
    group: 'readerSpacing',
  },
  spacingAiry: { id: 'spacingAiry', label: 'Airy', target: 'shell', checkable: true, group: 'readerSpacing' },
  toggleFirstLineIndent: {
    id: 'toggleFirstLineIndent',
    label: 'First-line Indent',
    target: 'shell',
    checkable: true,
  },

  previewSmall: { id: 'previewSmall', label: 'Small', target: 'shell', checkable: true, group: 'previewStyle' },
  previewMedium: {
    id: 'previewMedium',
    label: 'Medium',
    target: 'shell',
    checkable: true,
    group: 'previewStyle',
  },
  previewLarge: { id: 'previewLarge', label: 'Large', target: 'shell', checkable: true, group: 'previewStyle' },
  hideAttachments: { id: 'hideAttachments', label: 'Hide Attachments', target: 'shell', checkable: true },

  sortByModified: {
    id: 'sortByModified',
    label: 'Modification Date',
    target: 'shell',
    checkable: true,
    group: 'notesSort',
  },
  sortByCreated: {
    id: 'sortByCreated',
    label: 'Creation Date',
    target: 'shell',
    checkable: true,
    group: 'notesSort',
  },
  sortByTitle: { id: 'sortByTitle', label: 'Title', target: 'shell', checkable: true, group: 'notesSort' },
  toggleNewestOnTop: { id: 'toggleNewestOnTop', label: 'Newest on Top', target: 'shell', checkable: true },

  sortFoldersByTitle: {
    id: 'sortFoldersByTitle',
    label: 'Title',
    target: 'shell',
    checkable: true,
    group: 'foldersSort',
  },
  sortFoldersByCount: {
    id: 'sortFoldersByCount',
    label: 'Number of Notes',
    target: 'shell',
    checkable: true,
    group: 'foldersSort',
  },
  toggleFoldersAtoZ: { id: 'toggleFoldersAtoZ', label: 'A to Z', target: 'shell', checkable: true },

  // Bear's ⌃1/⌃2/⌃3, narrowest pane set first, so the shortcut number and the
  // number of visible panes agree.
  showEditorOnly: {
    id: 'showEditorOnly',
    label: 'Show Editor Only',
    target: 'shell',
    accelerator: 'Control+1',
    checkable: true,
    group: 'workspaceLayout',
  },
  showNotesAndEditor: {
    id: 'showNotesAndEditor',
    label: 'Show Notes and Editor',
    target: 'shell',
    accelerator: 'Control+2',
    checkable: true,
    group: 'workspaceLayout',
  },
  showAllPanes: {
    id: 'showAllPanes',
    label: 'Show Library, Notes and Editor',
    target: 'shell',
    accelerator: 'Control+3',
    checkable: true,
    group: 'workspaceLayout',
  },

  // Three views of one panel, so opening any of them closes the other two
  // rather than stacking inspectors down the edge of the document.
  toggleStatistics: {
    id: 'toggleStatistics',
    label: 'Toggle Statistics Panel',
    target: 'shell',
    accelerator: 'CmdOrCtrl+Shift+I',
    checkable: true,
    group: 'infoPanel',
  },
  contents: {
    id: 'contents',
    label: 'Toggle Table of Contents',
    target: 'shell',
    accelerator: 'CmdOrCtrl+Shift+A',
    checkable: true,
    group: 'infoPanel',
  },
  toggleBacklinks: {
    id: 'toggleBacklinks',
    label: 'Toggle Backlinks',
    target: 'shell',
    accelerator: 'CmdOrCtrl+Shift+B',
    checkable: true,
    group: 'infoPanel',
  },

  toggleWordCount: {
    id: 'toggleWordCount',
    label: 'Toggle Word Count',
    target: 'shell',
    accelerator: 'CmdOrCtrl+Shift+W',
    checkable: true,
  },
  toggleStylesBar: {
    id: 'toggleStylesBar',
    label: 'Toggle Styles Bar',
    target: 'shell',
    accelerator: 'CmdOrCtrl+Shift+Y',
    checkable: true,
  },
  toggleHistoryNavigation: {
    id: 'toggleHistoryNavigation',
    label: 'Toggle History Navigation',
    target: 'shell',
    checkable: true,
  },
}

/** A nested group inside a menu — the `Heading ›` and `List ›` of the wireframe. */
export interface CommandSubmenu {
  readonly label: string
  readonly items: readonly DocumentCommandId[]
}

/** Items between separators. Sections are how a menu gets rules without noise. */
export type MenuEntry = DocumentCommandId | CommandSubmenu

export interface MenuSpec {
  readonly label: string
  readonly sections: ReadonlyArray<readonly MenuEntry[]>
}

/**
 * The macOS menubar, as data.
 *
 * The application, Window, and Help menus are the system's own and are added by
 * the native shell from Tauri's predefined items — this describes only the
 * menus SimpleMark actually owns.
 */
export const MENUS: readonly MenuSpec[] = [
  {
    label: 'File',
    // Print sits alone at the bottom, the place every macOS File menu puts it.
    sections: [['newNote'], ['openFolder', 'openFile'], ['save'], ['print']],
  },
  {
    label: 'Edit',
    sections: [['undo', 'redo'], ['find']],
  },
  {
    label: 'Format',
    sections: [
      [
        {
          label: 'Heading',
          items: ['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'],
        },
        'bold',
        'italic',
        'underline',
        'strikethrough',
        { label: 'Highlighter', items: ['highlight', 'highlightGreen', 'highlightRed', 'highlightBlue', 'highlightYellow', 'highlightPurple'] },
        'inlineCode',
        'footnote',
        'inlineMath',
        'link',
        'wikiLink',
      ],
      [
        { label: 'List', items: ['bulletList', 'orderedList', 'taskList', 'toggleTask', 'completeTask', 'incompleteTask', 'moveCompletedTasks'] },
        { label: 'Callout', items: ['calloutNote', 'calloutTip', 'calloutImportant', 'calloutWarning', 'calloutCaution'] },
        'table',
        'quote',
        'codeBlock',
        'mathBlock',
        'divider',
      ],
      ['insertAsset', 'convertToDiagram'],
      ['moveBlockUp', 'moveBlockDown'],
    ],
  },
  {
    /**
     * Bear's View menu, section for section, with the reader block slotted in
     * where Bear keeps nothing — its theme and typography live in Preferences,
     * ours are document-level view state and belong beside zoom (D6).
     */
    label: 'View',
    sections: [
      ['zoomIn', 'zoomOut', 'actualSize'],
      [
        { label: 'Theme', items: ['themeWhite', 'themeTan', 'themeNight'] },
        { label: 'Font', items: ['fontIowan', 'fontGeorgia', 'fontSystem', 'fontMono'] },
        { label: 'Reading Width', items: ['widthNarrow', 'widthNormal', 'widthWide'] },
        { label: 'Line Height', items: ['leadingTight', 'leadingNormal', 'leadingOpen'] },
        { label: 'Paragraph Spacing', items: ['spacingCompact', 'spacingNormal', 'spacingAiry'] },
        'toggleFirstLineIndent',
      ],
      [
        {
          label: 'Preview Style',
          items: ['previewSmall', 'previewMedium', 'previewLarge', 'hideAttachments'],
        },
        {
          label: 'Notes Sorting',
          items: ['sortByModified', 'sortByCreated', 'sortByTitle', 'toggleNewestOnTop'],
        },
        {
          label: 'Folders Sorting',
          items: ['sortFoldersByTitle', 'sortFoldersByCount', 'toggleFoldersAtoZ'],
        },
      ],
      ['showEditorOnly', 'showNotesAndEditor', 'showAllPanes'],
      ['toggleStatistics', 'contents', 'toggleBacklinks'],
      ['toggleWordCount', 'toggleStylesBar', 'toggleHistoryNavigation'],
    ],
  },
  {
    label: 'Note',
    sections: [['togglePinned']],
  },
]

/** Every id a menu references, flattened — used to prove the menu is complete. */
export function menuCommandIds(menus: readonly MenuSpec[] = MENUS): DocumentCommandId[] {
  return menus.flatMap((menu) =>
    menu.sections.flatMap((section) =>
      section.flatMap((entry) => (typeof entry === 'string' ? [entry] : [...entry.items])),
    ),
  )
}
