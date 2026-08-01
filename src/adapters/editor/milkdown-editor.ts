import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import {
  codeBlockSchema,
  commonmark,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { $view, callCommand } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer } from '../../application/index.js'
import { DiagramNodeView } from './diagram-node-view.js'
import { plainTextPaste } from './plain-text-paste.js'

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

export type EditorCommandName = 'heading' | 'bold' | 'bulletList'

export interface MilkdownEditorOptions {
  readonly mount: HTMLElement
  readonly initialMarkdown: string
  readonly renderer: DiagramRenderer
  /** Called after every user edit, with the serialised document. */
  readonly onMarkdownChanged: (markdown: string) => void
}

export class MilkdownEditor {
  private constructor(private readonly editor: Editor) {}

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
      // Parses text/plain clipboard content as Markdown. Without it
      // ProseMirror inserts the payload verbatim and remark then escapes the
      // syntax on the way out, so a pasted document comes back as hundreds of
      // paragraphs full of \\# and \\*\\* (BUG-1).
      // Registered BEFORE clipboard. ProseMirror runs handlePaste in plugin
      // order and the first handler to return true wins, so this must precede
      // the clipboard plugin to take the text/plain branch §4.2 requires.
      .use(plainTextPaste)
      .use(clipboard)
      .use(listener)
      .use(diagramView)
      .create()

    return new MilkdownEditor(editor)
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
      case 'heading':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 2))
        return
      case 'bulletList':
        this.editor.action(callCommand(wrapInBulletListCommand.key))
        return
    }
  }

  async destroy(): Promise<void> {
    await this.editor.destroy()
  }
}
