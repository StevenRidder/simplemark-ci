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
  | 'strikethrough'
  | 'highlight'
  | 'inlineCode'
  | 'link'
  // Lists
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
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
  | 'find'
  | 'contents'
  | 'toggleStylesBar'
  | 'showAllPanes'
  | 'showNotesAndEditor'
  | 'showEditorOnly'
  | 'togglePinned'

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
  strikethrough: {
    id: 'strikethrough',
    label: 'Strikethrough',
    target: 'editor',
    accelerator: 'CmdOrCtrl+Shift+X',
  },
  highlight: { id: 'highlight', label: 'Highlight', target: 'editor', accelerator: 'CmdOrCtrl+Shift+H' },
  inlineCode: { id: 'inlineCode', label: 'Inline Code', target: 'editor', accelerator: 'CmdOrCtrl+E' },
  link: { id: 'link', label: 'Link…', target: 'editor', accelerator: 'CmdOrCtrl+K' },

  bulletList: { id: 'bulletList', label: 'Bulleted List', target: 'editor', accelerator: 'CmdOrCtrl+Shift+8' },
  orderedList: { id: 'orderedList', label: 'Numbered List', target: 'editor', accelerator: 'CmdOrCtrl+Shift+9' },
  taskList: { id: 'taskList', label: 'Todo', target: 'editor', accelerator: 'CmdOrCtrl+Shift+T' },

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
  find: { id: 'find', label: 'Find in Document…', target: 'shell', accelerator: 'CmdOrCtrl+F' },
  contents: { id: 'contents', label: 'Contents', target: 'shell', accelerator: 'CmdOrCtrl+Shift+O' },
  toggleStylesBar: {
    id: 'toggleStylesBar',
    label: 'Styles Bar',
    target: 'shell',
    checkable: true,
  },
  showAllPanes: { id: 'showAllPanes', label: 'Library, Notes, and Editor', target: 'shell', checkable: true },
  showNotesAndEditor: { id: 'showNotesAndEditor', label: 'Notes and Editor', target: 'shell', checkable: true },
  showEditorOnly: { id: 'showEditorOnly', label: 'Editor Only', target: 'shell', checkable: true },
  togglePinned: { id: 'togglePinned', label: 'Pin to Top', target: 'shell', checkable: true },
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
    sections: [['newNote'], ['openFolder', 'openFile'], ['save']],
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
        'strikethrough',
        'highlight',
        'inlineCode',
        'link',
      ],
      [
        { label: 'List', items: ['bulletList', 'orderedList', 'taskList'] },
        'table',
        'quote',
        'codeBlock',
        'divider',
      ],
      ['insertAsset', 'convertToDiagram'],
      ['moveBlockUp', 'moveBlockDown'],
    ],
  },
  {
    label: 'View',
    sections: [
      [{ label: 'Layout', items: ['showAllPanes', 'showNotesAndEditor', 'showEditorOnly'] }],
      ['contents'],
      ['toggleStylesBar'],
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
