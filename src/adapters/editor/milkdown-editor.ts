import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import {
  codeBlockSchema,
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  columnResizingPlugin,
  gfm,
  insertTableCommand,
  setAlignCommand,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import { $useKeymap, $view, callCommand, getMarkdown } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Selection } from '@milkdown/kit/prose/state'
import {
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  moveTableColumn,
  moveTableRow,
} from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer } from '../../application/index.js'
import { looksLikeMermaid, looksLikeSvg } from '../../domain/index.js'
import { DiagramNodeView } from './diagram-node-view.js'
import {
  highlightInputRule,
  highlightRemark,
  highlightSchema,
  toggleHighlightCommand,
} from './highlight-mark.js'
import { pasteSniffers } from './paste-sniffers.js'

/**
 * The candidate editor: Milkdown on ProseMirror and remark.
 *
 * This is the real D3 candidate, not a demo. Markdown is the model — remark
 * parses it into a ProseMirror document and serialises it back — which is D1
 * expressed as a library. FIDELITY-1 decides whether it can be pushed to satisfy
 * the D7 source-preservation contract or whether the document model has to be
 * rebuilt on raw ProseMirror with an explicit source map. Nothing here presumes
 * that answer; if the bridge is replaced, the schema, NodeViews, UI, and
 * application modules survive it.
 *
 * The adapter owns ProseMirror translation and nothing else. It never writes a
 * file, never renders a diagram itself, and never mutates the document behind
 * the application's back: every change leaves through `onMarkdownChanged`, and
 * the composition root is what turns that into a DocumentSession transaction.
 */

export type EditorCommandName =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'highlight'
  | 'inlineCode'
  | 'quote'
  | 'codeBlock'
  | 'divider'
  | 'link'
  | 'moveBlockUp'
  | 'moveBlockDown'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'table'
  | 'undo'
  | 'redo'

export interface MilkdownEditorOptions {
  readonly mount: HTMLElement
  readonly initialMarkdown: string
  readonly renderer: DiagramRenderer
  /** Called after every user edit, with the serialised document. */
  readonly onMarkdownChanged: (markdown: string) => void
}

export class MilkdownEditor {
  #blockDrag: { pointerId: number; source: number } | undefined
  #tableControls: HTMLElement | undefined
  #tableControlsOpen = false
  #activeTable: HTMLTableElement | undefined
  #activeTableCell: HTMLTableCellElement | undefined

  private constructor(
    private readonly editor: Editor,
    private readonly renderer: DiagramRenderer,
  ) {}

  static async mount(options: MilkdownEditorOptions): Promise<MilkdownEditor> {
    const diagramView = $view(codeBlockSchema.node, () => {
      return (node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
        const language = (node.attrs['language'] as string | undefined) ?? ''
        // Only claim fences this renderer actually handles. Every other code
        // block stays an ordinary editable fence.
        if (!options.renderer.languages.includes(language)) {
          return null as unknown as DiagramNodeView
        }
        return new DiagramNodeView(node, view, getPos, options.renderer)
      }
    })

    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, options.mount)
        ctx.set(defaultValueCtx, options.initialMarkdown)
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previous) => {
          if (markdown !== previous) options.onMarkdownChanged(markdown)
        })
      })
      .use(commonmark)
      // A visual-only mark would disappear after reopen. `==highlight==` is a
      // small portable extension whose parser and serializer travel together.
      .use(highlightRemark)
      .use(highlightSchema)
      .use(toggleHighlightCommand)
      .use(highlightInputRule)
      // Tables, task lists, strikethrough, autolinks. DESIGN.md §6 specifies
      // commonmark + gfm, and §5 puts tables and task lists in portability
      // tier 1 — without this preset they have no schema at all (BUG-2).
      .use(gfm)
      // Width handles write only ProseMirror's in-memory table layout. GFM has
      // no column-width syntax, so the Markdown serializer deliberately emits
      // no width metadata (EDITOR-5's portability boundary).
      .use(columnResizingPlugin)
      // Undo/redo. Neither the commonmark nor the gfm preset bundles history,
      // so without this Cmd+Z did nothing at all — POC.md requires it, and
      // DESIGN.md §4.3 requires undo immediately after a paste conversion to
      // restore the raw pasted text.
      .use(history)
      // Cmd/Ctrl+Y for redo alongside the standard Cmd+Shift+Z. It is what many
      // people reach for, and the history keymap does not bind it by default.
      .use($useKeymap('simplemarkRedoKeymap', { Redo: { shortcuts: ['Mod-y'], command: (ctx) => { const call = callCommand(redoCommand.key); return () => { call(ctx); return true } } } }))
      // Parses text/plain clipboard content as Markdown. Without it
      // ProseMirror inserts the payload verbatim and remark then escapes the
      // syntax on the way out, so a pasted document comes back as hundreds of
      // paragraphs full of \\# and \\*\\* (BUG-1).
      // Registered BEFORE clipboard. ProseMirror runs handlePaste in plugin
      // order and the first handler to return true wins, so the sniffer chain
      // must precede the clipboard plugin to see the payload at all.
      .use(pasteSniffers({ renderer: options.renderer }))
      .use(clipboard)
      .use(listener)
      .use(diagramView)
      .create()

    const instance = new MilkdownEditor(editor, options.renderer)
    instance.installBlockReordering()
    instance.installTableControls()
    return instance
  }

  /**
   * Runs a formatting command against the live selection.
   *
   * Toolbar presses suppress mousedown so focus and selection survive the click;
   * this only has to re-assert focus for keyboard-driven callers.
   */
  runCommand(command: EditorCommandName): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
    })

    switch (command) {
      case 'bold':
        this.editor.action(callCommand(toggleStrongCommand.key))
        return
      case 'italic':
        this.editor.action(callCommand(toggleEmphasisCommand.key))
        return
      case 'strikethrough':
        this.editor.action(callCommand(toggleStrikethroughCommand.key))
        return
      case 'highlight':
        this.editor.action(callCommand(toggleHighlightCommand.key))
        return
      case 'inlineCode':
        this.editor.action(callCommand(toggleInlineCodeCommand.key))
        return
      case 'quote':
        this.editor.action(callCommand(wrapInBlockquoteCommand.key))
        return
      case 'codeBlock':
        this.editor.action(callCommand(createCodeBlockCommand.key))
        return
      case 'divider':
        this.editor.action(callCommand(insertHrCommand.key))
        return
      case 'link':
        this.editLink()
        return
      case 'moveBlockUp':
        this.moveCurrentBlock('up')
        return
      case 'moveBlockDown':
        this.moveCurrentBlock('down')
        return
      case 'heading1':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 1))
        return
      case 'heading2':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 2))
        return
      case 'heading3':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 3))
        return
      case 'heading4':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 4))
        return
      case 'heading5':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 5))
        return
      case 'heading6':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 6))
        return
      case 'bulletList':
        this.editor.action(callCommand(wrapInBulletListCommand.key))
        return
      case 'orderedList':
        this.editor.action(callCommand(wrapInOrderedListCommand.key))
        return
      case 'taskList':
        this.toggleTaskList()
        return
      case 'table':
        this.editor.action(callCommand(insertTableCommand.key))
        return
      case 'undo':
        this.editor.action(callCommand(undoCommand.key))
        return
      case 'redo':
        this.editor.action(callCommand(redoCommand.key))
        return
    }
  }

  /**
   * Focuses the editor with the caret at the end of the document.
   *
   * What a shell wants after opening a note. Also the only reliable way to get
   * there: End stops at the end of a wrapped visual line, and clicking the
   * canvas can land on a NodeView and take a node selection instead of a text
   * one.
   */
  focusEnd(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc, tr } = view.state
      view.dispatch(tr.setSelection(Selection.atEnd(doc)).scrollIntoView())
      view.focus()
    })
  }

  /**
   * Starts a new paragraph after the final block only when the reader asks to
   * continue. This avoids both a terminal diagram trapping the caret and an
   * unsolicited source change merely from opening the document.
   */
  continueAfterLastBlock(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc, schema } = view.state
      const paragraph = schema.nodes['paragraph']
      if (paragraph === undefined) return
      const insertAt = doc.content.size
      const transaction = view.state.tr.insert(insertAt, paragraph.create())
      view.dispatch(
        transaction
          .setSelection(Selection.near(transaction.doc.resolve(insertAt + 1)))
          .scrollIntoView(),
      )
      view.focus()
    })
  }

  /** A quiet gutter drag becomes one ordinary ProseMirror transaction. */
  private installBlockReordering(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dom.addEventListener('pointerdown', (event) => {
        const block = this.blockAtY(view, event.clientY)
        if (block === undefined) return
        const rect = block.getBoundingClientRect()
        // The narrow inside gutter is deliberately the only drag affordance.
        // Keeping normal prose drags untouched preserves native text selection.
        if (event.clientX < rect.left - 26 || event.clientX > rect.left - 6) return
        event.preventDefault()
        this.#blockDrag = { pointerId: event.pointerId, source: this.topLevelPosition(view, block) }
        view.dom.setPointerCapture(event.pointerId)
      })

      view.dom.addEventListener('pointerup', (event) => {
        const drag = this.#blockDrag
        this.#blockDrag = undefined
        if (drag === undefined || drag.pointerId !== event.pointerId) return
        const target = this.blockAtY(view, event.clientY)
        if (target === undefined) return
        event.preventDefault()
        const source = drag.source
        const targetRect = target.getBoundingClientRect()
        const insertBefore = event.clientY < targetRect.top + targetRect.height / 2
        this.moveBlock(view, source, this.topLevelPosition(view, target), insertBefore)
      })
    })
  }

  /**
   * A selected table earns one quiet entry point, not a second toolbar. The
   * full correction menu appears only after a reader asks for it.
   */
  private installTableControls(): void {
    const controls = document.createElement('div')
    controls.className = 'table-controls'
    controls.hidden = true
    controls.setAttribute('aria-label', 'Table controls')

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'table-controls-trigger'
    trigger.textContent = 'Table'
    trigger.setAttribute('aria-label', 'Table options')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.addEventListener('mousedown', (event) => event.preventDefault())
    trigger.addEventListener('click', () => this.setTableControlsOpen(!this.#tableControlsOpen))
    controls.append(trigger)

    const menu = document.createElement('div')
    menu.className = 'table-controls-menu'
    menu.hidden = true
    menu.setAttribute('aria-label', 'Table options')

    const groups: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
      ['Rows', [
        ['rowBefore', 'Row above'], ['rowAfter', 'Row below'],
        ['moveRowUp', 'Shift row up'], ['moveRowDown', 'Shift row down'],
        ['sortAscending', 'Sort selected column ascending'],
        ['sortDescending', 'Sort selected column descending'],
        ['deleteRow', 'Delete row'],
      ]],
      ['Columns', [
        ['colBefore', 'Column left'], ['colAfter', 'Column right'],
        ['moveColumnLeft', 'Move left'], ['moveColumnRight', 'Move right'],
        ['deleteColumn', 'Delete column'],
      ]],
      ['Column', [['alignLeft', 'Align left'], ['alignCenter', 'Align center'], ['alignRight', 'Align right']]],
      ['Table', [
        ['fitColumns', 'Fit content'],
        ['equalColumns', 'Equal columns'],
        ['deleteTable', 'Delete table'],
      ]],
    ]
    for (const [label, actions] of groups) {
      const group = document.createElement('div')
      group.className = 'table-control-group'
      group.setAttribute('aria-label', label)
      const groupLabel = document.createElement('span')
      groupLabel.className = 'table-control-group-label'
      groupLabel.textContent = label
      group.append(groupLabel)
      for (const [action, title] of actions) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset['tableAction'] = action
        button.textContent = title
        button.setAttribute('aria-label', title)
        button.title = title
        button.addEventListener('mousedown', (event) => {
          event.preventDefault()
          this.setTableControlsOpen(false)
          this.runTableAction(action)
        })
        group.append(button)
      }
      menu.append(group)
    }
    controls.append(menu)
    document.body.append(controls)
    this.#tableControls = controls

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const reveal = (event: Event): void => {
        const target = event.target
        if (!(target instanceof Element)) return
        const table = target.closest('table')
        if (!(table instanceof HTMLTableElement) || !view.dom.contains(table)) return
        const cell = target.closest('th, td')
        requestAnimationFrame(() => this.showTableControls(
          view,
          table,
          cell instanceof HTMLTableCellElement ? cell : undefined,
        ))
      }
      view.dom.addEventListener('pointerup', reveal)
      // A parsed table may move the ProseMirror selection during its click
      // handler, after pointerup. Run once more at click time so existing
      // files get the same controls as a newly inserted table.
      view.dom.addEventListener('click', reveal)
      view.dom.addEventListener('focusin', reveal)
      view.dom.addEventListener('keydown', () => {
        requestAnimationFrame(() => this.refreshTableControls(view))
      })
      view.dom.addEventListener('keydown', (event) => {
        // The stock GFM keymap correctly advances within a table, but stops at
        // its final cell. Capture that one dead end before ProseMirror consumes
        // the key: append a row, then continue into it.
        if (event.key !== 'Tab' || event.shiftKey || !isInTable(view.state)) return
        const selectedCell = this.selectedTableCell(view)
        const table = selectedCell?.closest('table')
        const cells = table?.querySelectorAll('th, td')
        if (selectedCell === undefined || cells === undefined || selectedCell !== cells[cells.length - 1]) return
        const dispatch = view.dispatch.bind(view)
        event.preventDefault()
        event.stopImmediatePropagation()
        if (addRowAfter(view.state, dispatch)) goToNextCell(1)(view.state, dispatch)
      }, true)
    })
  }

  private showTableControls(
    view: EditorView,
    table: HTMLTableElement,
    cell: HTMLTableCellElement | undefined = undefined,
  ): void {
    if (this.#tableControls === undefined) return
    this.#activeTable = table
    if (cell !== undefined) this.#activeTableCell = cell
    const controls = this.#tableControls
    const deleteRow = controls.querySelector<HTMLButtonElement>('[data-table-action="deleteRow"]')
    if (deleteRow !== null) {
      // A pipe table's first row is always its header. Deleting it would make
      // a malformed GFM table, so retain the user-visible data rows only.
      deleteRow.disabled = this.#activeTableCell?.tagName === 'TH'
      deleteRow.title = deleteRow.disabled ? 'The first GFM row is the required header' : 'Delete row'
    }
    const activeRow = this.#activeTableCell?.parentElement
    const rowIndex = activeRow instanceof HTMLTableRowElement ? activeRow.rowIndex : undefined
    const lastRow = table.rows.length - 1
    this.setTableControlEnabled('moveRowUp', rowIndex !== undefined && rowIndex > 1)
    this.setTableControlEnabled('moveRowDown', rowIndex !== undefined && rowIndex > 0 && rowIndex < lastRow)
    const columnIndex = this.#activeTableCell?.cellIndex
    this.setTableControlEnabled('moveColumnLeft', columnIndex !== undefined && columnIndex > 0)
    this.setTableControlEnabled('moveColumnRight', columnIndex !== undefined && columnIndex < table.rows[0]!.cells.length - 1)
    controls.hidden = false
    this.positionTableControls()
  }

  private setTableControlsOpen(open: boolean): void {
    if (this.#tableControls === undefined) return
    this.#tableControlsOpen = open
    const trigger = this.#tableControls.querySelector<HTMLButtonElement>('.table-controls-trigger')
    const menu = this.#tableControls.querySelector<HTMLElement>('.table-controls-menu')
    if (trigger !== null) trigger.setAttribute('aria-expanded', String(open))
    if (menu !== null) menu.hidden = !open
    this.positionTableControls()
  }

  private positionTableControls(): void {
    if (this.#tableControls === undefined || this.#activeTable === undefined) return
    const tableRect = this.#activeTable.getBoundingClientRect()
    const controlsRect = this.#tableControls.getBoundingClientRect()
    const menu = this.#tableControls.querySelector<HTMLElement>('.table-controls-menu')
    // The menu is absolutely positioned, so it does not contribute to its
    // trigger's bounding box. Clamp against whichever of the two is visible.
    const visibleWidth = Math.max(controlsRect.width, menu?.hidden ? 0 : (menu?.getBoundingClientRect().width ?? 0))
    this.#tableControls.style.left = `${Math.max(12, Math.min(tableRect.left, window.innerWidth - visibleWidth - 12))}px`
    this.#tableControls.style.top = `${Math.max(12, tableRect.top - controlsRect.height - 8)}px`
    if (menu === null || menu.hidden) return

    // Prefer opening into the table, but never make a control unreachable at
    // the bottom of a short viewport. In that case it becomes a true popover
    // above the trigger instead of a clipped strip below it.
    menu.style.top = 'calc(100% + 7px)'
    menu.style.bottom = 'auto'
    const openedMenuRect = menu.getBoundingClientRect()
    if (openedMenuRect.bottom > window.innerHeight - 12 && controlsRect.top - openedMenuRect.height - 7 >= 12) {
      menu.style.top = 'auto'
      menu.style.bottom = 'calc(100% + 7px)'
    }
  }

  private refreshTableControls(view: EditorView): void {
    if (!isInTable(view.state)) {
      if (this.#tableControls !== undefined) this.#tableControls.hidden = true
      this.#tableControlsOpen = false
      this.#activeTable = undefined
      this.#activeTableCell = undefined
      return
    }
    if (this.#activeTable !== undefined) this.showTableControls(view, this.#activeTable)
  }

  private selectedTableCell(view: EditorView): HTMLTableCellElement | undefined {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    const cell = element?.closest('th, td')
    return cell instanceof HTMLTableCellElement && view.dom.contains(cell) ? cell : undefined
  }

  private setTableControlEnabled(action: string, enabled: boolean): void {
    const button = this.#tableControls?.querySelector<HTMLButtonElement>(`[data-table-action="${action}"]`)
    if (button !== undefined && button !== null) button.disabled = !enabled
  }

  private moveActiveRow(view: EditorView, direction: -1 | 1): void {
    const row = this.#activeTableCell?.parentElement
    if (!(row instanceof HTMLTableRowElement)) return
    const from = row.rowIndex
    const to = from + direction
    // The first GFM row is the header and never moves into the data range.
    if (from < 1 || to < 1 || this.#activeTable === undefined || to >= this.#activeTable.rows.length) return
    moveTableRow({ from, to })(view.state, view.dispatch.bind(view))
  }

  private moveActiveColumn(view: EditorView, direction: -1 | 1): void {
    const from = this.#activeTableCell?.cellIndex
    if (from === undefined || this.#activeTable === undefined) return
    const to = from + direction
    if (to < 0 || to >= this.#activeTable.rows[0]!.cells.length) return
    moveTableColumn({ from, to })(view.state, view.dispatch.bind(view))
  }

  private sortRowsByActiveColumn(view: EditorView, direction: 1 | -1): void {
    if (this.#activeTable === undefined || this.#activeTableCell === undefined) return
    const column = this.#activeTableCell.cellIndex
    const sourceRows = Array.from(this.#activeTable.rows).slice(1)
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const desired = sourceRows
      .map((row, index) => ({ index, value: row.cells[column]?.textContent?.trim() ?? '' }))
      .sort((left, right) => direction * collator.compare(left.value, right.value))
      .map(({ index }) => index)
    const current = sourceRows.map((_row, index) => index)
    for (let target = 0; target < desired.length; target += 1) {
      const from = current.indexOf(desired[target]!)
      if (from === target) continue
      if (!moveTableRow({ from: from + 1, to: target + 1 })(view.state, view.dispatch.bind(view))) return
      const [moved] = current.splice(from, 1)
      current.splice(target, 0, moved!)
    }
  }

  private runTableAction(action: string): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (!isInTable(view.state)) return
      switch (action) {
        case 'rowBefore':
          this.editor.action(callCommand(addRowBeforeCommand.key))
          break
        case 'rowAfter':
          this.editor.action(callCommand(addRowAfterCommand.key))
          break
        case 'colBefore':
          this.editor.action(callCommand(addColBeforeCommand.key))
          break
        case 'colAfter':
          this.editor.action(callCommand(addColAfterCommand.key))
          break
        case 'deleteRow':
          if (this.#activeTableCell?.tagName === 'TH') return
          deleteRow(view.state, view.dispatch.bind(view))
          break
        case 'deleteColumn':
          deleteColumn(view.state, view.dispatch.bind(view))
          break
        case 'moveRowUp':
          this.moveActiveRow(view, -1)
          break
        case 'moveRowDown':
          this.moveActiveRow(view, 1)
          break
        case 'moveColumnLeft':
          this.moveActiveColumn(view, -1)
          break
        case 'moveColumnRight':
          this.moveActiveColumn(view, 1)
          break
        case 'sortAscending':
          this.sortRowsByActiveColumn(view, 1)
          break
        case 'sortDescending':
          this.sortRowsByActiveColumn(view, -1)
          break
        case 'alignLeft':
          this.editor.action(callCommand(setAlignCommand.key, 'left'))
          break
        case 'alignCenter':
          this.editor.action(callCommand(setAlignCommand.key, 'center'))
          break
        case 'alignRight':
          this.editor.action(callCommand(setAlignCommand.key, 'right'))
          break
        // GFM has no width syntax. These are deliberately local display
        // preferences, alongside the drag handles from columnResizingPlugin;
        // they never enter the Markdown document or its save transaction.
        case 'fitColumns':
          if (this.#activeTable !== undefined) this.#activeTable.style.tableLayout = 'auto'
          break
        case 'equalColumns':
          if (this.#activeTable !== undefined) this.#activeTable.style.tableLayout = 'fixed'
          break
        case 'deleteTable':
          deleteTable(view.state, view.dispatch.bind(view))
          if (this.#tableControls !== undefined) this.#tableControls.hidden = true
          this.#tableControlsOpen = false
          this.#activeTable = undefined
          break
        default:
          return
      }
      view.focus()
      requestAnimationFrame(() => this.refreshTableControls(view))
    })
  }

  private blockAtY(view: EditorView, y: number): HTMLElement | undefined {
    const blocks = Array.from(view.dom.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    )
    return blocks.find((block) => {
      const rect = block.getBoundingClientRect()
      return y >= rect.top && y <= rect.bottom
    })
  }

  /** `posAtDOM` in a text block points inside it; moves need its top-level edge. */
  private topLevelPosition(view: EditorView, block: HTMLElement): number {
    const position = view.posAtDOM(block, 0)
    const resolved = view.state.doc.resolve(position)
    return resolved.depth > 0 ? resolved.before(1) : position
  }

  private moveCurrentBlock(direction: 'up' | 'down'): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const source = view.state.selection.$from.depth > 0
        ? view.state.selection.$from.before(1)
        : view.state.selection.from
      let previous: number | undefined
      let next: number | undefined
      let afterSource = false
      view.state.doc.forEach((_node, offset) => {
        if (offset === source) {
          afterSource = true
          return
        }
        if (!afterSource) previous = offset
        else if (next === undefined) next = offset
      })
      const target = direction === 'up' ? previous : next
      if (target === undefined) return
      this.moveBlock(view, source, target, direction === 'up')
    })
  }

  private moveBlock(view: EditorView, source: number, target: number, insertBefore: boolean): void {
    if (source === target) return
    const sourceNode = view.state.doc.nodeAt(source)
    const targetNode = view.state.doc.nodeAt(target)
    if (sourceNode === null || targetNode === null) return
    const requestedPosition = insertBefore ? target : target + targetNode.nodeSize
    const transaction = view.state.tr.delete(source, source + sourceNode.nodeSize)
    const insertionPosition = transaction.mapping.map(
      requestedPosition,
      source < requestedPosition ? -1 : 1,
    )
    view.dispatch(transaction.insert(insertionPosition, sourceNode).scrollIntoView())
  }

  /** A deliberate link correction path: selection creates, replaces, or removes. */
  private editLink(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from, to } = view.state.selection
      if (from === to) {
        window.alert('Select text first, then choose Link.')
        return
      }

      const href = window.prompt('Link address (leave blank to remove the link)', '')
      if (href === null) return
      if (href.trim() === '') {
        const link = view.state.schema.marks['link']
        if (link !== undefined) view.dispatch(view.state.tr.removeMark(from, to, link))
        return
      }
      this.editor.action(callCommand(toggleLinkCommand.key, { href: href.trim() }))
    })
  }

  /**
   * Converts the current block to a diagram (DESIGN.md §4.3).
   *
   * > "Convert to diagram" is always available as a slash command and
   * > context-menu action on any code block or paragraph — so a missed
   * > conversion is one command away, not a re-paste.
   *
   * Uses the same recognition rules and the same validation gate as the paste
   * sniffer: the block must look like a diagram *and* actually render, or
   * nothing changes and the caller is told why.
   */
  async convertBlockToDiagram(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const found = this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { $from } = view.state.selection
      // The textblock containing the caret — $from.parent, not a walk up to the
      // doc. Walking found the document node and handed Mermaid the entire
      // note, which then failed to parse for a completely misleading reason.
      const node = $from.parent
      if (!node.isTextblock) return null
      return { view, node, pos: $from.before($from.depth) }
    })

    if (found === null) return { ok: false, reason: 'Put the cursor in a paragraph first' }

    // Hard breaks are line breaks to a diagram engine. node.textContent drops
    // them, which turns multi-line Mermaid into one unparseable line.
    let source = ''
    found.node.forEach((child) => {
      source += child.type.name === 'hardbreak' || child.type.isText === false ? '\n' : child.text
    })
    source = source.trim()
    if (source === '') return { ok: false, reason: 'The block is empty' }

    const language = looksLikeSvg(source) ? 'svg' : looksLikeMermaid(source) ? 'mermaid' : null
    if (language === null) {
      return { ok: false, reason: 'This block does not look like Mermaid or SVG' }
    }

    // Same validation gate as the paste sniffer: never guess silently wrong.
    const rendered = await this.renderer.render(language, source)
    if (!rendered.ok) return { ok: false, reason: rendered.message }

    const { view, node, pos } = found
    const { schema } = view.state
    const codeBlock = schema.nodes['code_block']
    if (codeBlock === undefined) return { ok: false, reason: 'No code block in the schema' }

    view.dispatch(
      view.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        codeBlock.create({ language }, schema.text(source)),
      ),
    )
    return { ok: true }
  }

  /**
   * Toggles the current list item between task and plain.
   *
   * GFM has no toggle command: a task item is an ordinary list item carrying
   * `checked`, so the list is created first if needed and the attribute is set
   * directly. Done as one transaction so a single undo reverses the whole
   * gesture rather than leaving a half-converted list.
   */
  private toggleTaskList(): void {
    // Three sequential top-level actions, never nested. An earlier version
    // called editor.action() from inside another and then recursed, so the
    // inner call read a stale view.state and the toggle raced its own list
    // creation — intermittently doing nothing.
    const listItemDepth = (): number =>
      this.editor.action((ctx) => {
        const { $from } = ctx.get(editorViewCtx).state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'list_item') return depth
        }
        return -1
      })

    if (listItemDepth() === -1) {
      this.editor.action(callCommand(wrapInBulletListCommand.key))
    }

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { $from } = view.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name !== 'list_item') continue
        const checked = node.attrs['checked']
        view.dispatch(
          view.state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            // null means "not a task"; false means "an unchecked task".
            checked: checked === null || checked === undefined ? false : null,
          }),
        )
        return
      }
    })
  }

  /**
   * Serialises the current document to Markdown through the bridge under test.
   *
   * This is the exact path the fidelity spike measures, which is why it is
   * product API rather than something the harness reimplements — a harness with
   * its own serialiser would prove nothing about the real one.
   */
  serialize(): string {
    return this.editor.action(getMarkdown())
  }

  async destroy(): Promise<void> {
    // The editor root is replaced when a reader opens another file. Table
    // controls deliberately live above that root so they can sit beside the
    // table; remove that one detached element with the editor itself.
    this.#tableControls?.remove()
    this.#tableControls = undefined
    this.#tableControlsOpen = false
    this.#activeTable = undefined
    this.#activeTableCell = undefined
    await this.editor.destroy()
  }
}
