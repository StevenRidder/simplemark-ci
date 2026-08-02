import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import {
  codeBlockSchema,
  commonmark,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  gfm,
  insertTableCommand,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import { $useKeymap, $view, callCommand, getMarkdown } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer } from '../../application/index.js'
import { looksLikeMermaid, looksLikeSvg } from '../../domain/index.js'
import { DiagramNodeView } from './diagram-node-view.js'
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

export interface MilkdownEditorOptions {
  readonly mount: HTMLElement
  readonly initialMarkdown: string
  readonly renderer: DiagramRenderer
  /** Called after every user edit, with the serialised document. */
  readonly onMarkdownChanged: (markdown: string) => void
}

export class MilkdownEditor {
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
      // Tables, task lists, strikethrough, autolinks. DESIGN.md §6 specifies
      // commonmark + gfm, and §5 puts tables and task lists in portability
      // tier 1 — without this preset they have no schema at all (BUG-2).
      .use(gfm)
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

    return new MilkdownEditor(editor, options.renderer)
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
      case 'heading':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 2))
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
    await this.editor.destroy()
  }
}
