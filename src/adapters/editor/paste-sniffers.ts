import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

import {
  isStandaloneBlockPaste,
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeFileTree,
  looksLikeJson,
  looksLikeDot,
  looksLikeMath,
  looksLikeMermaid,
  looksLikeStackTrace,
  looksLikeSvg,
  looksLikeTsv,
  stripMathDelimiters,
  svgInHtml,
  tsvToMarkdownTable,
} from '../../domain/index.js'
import type { DiagramRenderer } from '../../application/index.js'

/**
 * The DESIGN.md §4 paste pipeline.
 *
 * "The defining behavior: you paste raw Mermaid source or a raw `<svg>` tag with
 * no code fence, and it becomes a picture. No mode switch, no menu, no plugin
 * install."
 *
 * ```
 * ⌘V
 *  ├─ 1. Clipboard triage        collect {text, html}
 *  ├─ 2. Sniffer chain           svg-in-html · svg · mermaid
 *  │      first to MATCH, VALIDATE and pass the standalone-block test wins
 *  ├─ 3. No hit → Markdown path (§4.2 ruling: text/plain, not the HTML)
 *  └─ 4. Insert → NodeViews render; ⌘Z restores the raw pasted text
 * ```
 *
 * Validation is asynchronous — `mermaid.parse()` returns a promise — but
 * `handlePaste` must answer synchronously. So a signature hit claims the event
 * immediately and the real decision happens a tick later. That ordering is what
 * lets §4.4 hold: conversion still *requires* a successful parse, and a payload
 * that fails validation falls back to the ordinary Markdown path rather than
 * producing a broken block.
 */

export const pasteSnifferKey = new PluginKey('simplemark-paste-sniffers')

/** §4.2 fixed priority order. Image (5) arrives with attachment support. */
interface Sniffer {
  readonly id: string
  readonly priority: number
  /** Returns the diagram language and source to convert to, or null to decline. */
  claim(text: string, html: string): { language: string; source: string } | null
}

const SNIFFERS: readonly Sniffer[] = [
  {
    id: 'svg-in-html',
    priority: 30,
    claim: (_text: string, html: string) => {
      const svg = svgInHtml(html)
      return svg === null ? null : { language: 'svg', source: svg }
    },
  },
  {
    id: 'svg',
    priority: 20,
    claim: (text: string) => (looksLikeSvg(text) ? { language: 'svg', source: text.trim() } : null),
  },
  // Formal notation. DOT outranks Mermaid because `graph {` matches both
  // keywords and the brace is the more specific claim; math sits beside them
  // because `$$` collides with nothing else.
  {
    id: 'dot',
    priority: 11,
    claim: (text: string) => (looksLikeDot(text) ? { language: 'dot', source: text.trim() } : null),
  },
  {
    id: 'math',
    priority: 9,
    claim: (text: string) =>
      looksLikeMath(text) ? { language: 'math', source: stripMathDelimiters(text) } : null,
  },
  {
    id: 'mermaid',
    priority: 10,
    claim: (text: string) => (looksLikeMermaid(text) ? { language: 'mermaid', source: text.trim() } : null),
  },
  // The paste-exhaust tier: the output formats of AI and terminal work.
  // ANSI outranks diff because coloured git output carries both signatures,
  // and the escape codes are the more specific claim.
  {
    id: 'ansi',
    priority: 19,
    claim: (text: string) => (looksLikeAnsi(text) ? { language: 'ansi', source: text } : null),
  },
  {
    id: 'diff',
    priority: 18,
    claim: (text: string) => (looksLikeDiff(text) ? { language: 'diff', source: text } : null),
  },
  {
    id: 'file-tree',
    priority: 14,
    claim: (text: string) => (looksLikeFileTree(text) ? { language: 'tree', source: text } : null),
  },
  {
    id: 'stack-trace',
    priority: 12,
    claim: (text: string) =>
      looksLikeStackTrace(text) ? { language: 'stacktrace', source: text } : null,
  },
  // Below Mermaid: anything both parseable as JSON and claimed by a more
  // specific sniffer should never reach here.
  {
    id: 'json',
    priority: 8,
    claim: (text: string) => (looksLikeJson(text) ? { language: 'json', source: text.trim() } : null),
  },
].sort((a, b) => b.priority - a.priority)

export interface PasteSnifferOptions {
  readonly renderer: DiagramRenderer
}

export const pasteSniffers = (options: PasteSnifferOptions) =>
  $prose((ctx: Ctx) => {
    /** Replaces the current selection with a fenced code block. */
    const insertFence = (view: EditorView, language: string, source: string): void => {
      const { schema } = view.state
      const codeBlock = schema.nodes['code_block']
      if (codeBlock === undefined) return

      // Two transactions on purpose (§4.3): the first inserts the raw pasted
      // text, the second converts it. `closeHistory` stops prosemirror-history
      // from grouping them, so one ⌘Z lands on the raw text rather than
      // undoing the paste entirely.
      const raw = view.state.tr.replaceSelectionWith(
        schema.nodes['paragraph']!.create(null, schema.text(source)),
      )
      view.dispatch(raw)

      const to = view.state.selection.from
      const from = to - source.length - 1
      const convert = view.state.tr.replaceWith(
        Math.max(0, from),
        to,
        codeBlock.create({ language }, schema.text(source)),
      )
      view.dispatch(closeHistory(convert))
    }

    /** §4.2 step 3: no sniffer claimed it, so the Markdown path runs on text/plain. */
    const insertMarkdown = (view: EditorView, text: string): void => {
      let parsed
      try {
        parsed = ctx.get(parserCtx)(text)
      } catch {
        return
      }
      if (parsed === null || parsed === undefined) return
      view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView())
    }

    return new Plugin({
      key: pasteSnifferKey,
      props: {
        handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
          const clipboard = event.clipboardData
          if (clipboard === null) return false

          const text = clipboard.getData('text/plain')
          const html = clipboard.getData('text/html')
          if (text.trim() === '' && html.trim() === '') return false

          // Inside a code block the clipboard is literal by definition.
          const { $from, empty } = view.state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.spec.code === true) return false
          }

          // §4.2 condition 1. A selection replacement still counts as a block
          // boundary when the whole block is selected; a caret mid-sentence
          // does not.
          const atBlockBoundary =
            (empty && $from.parent.content.size === 0) ||
            (empty && $from.parentOffset === 0) ||
            !empty
          const standalone = isStandaloneBlockPaste({ text, atBlockBoundary })

          const claimed = standalone
            ? (SNIFFERS.map((sniffer) => sniffer.claim(text, html)).find(
                (result) => result !== null,
              ) ?? null)
            : null

          if (claimed === null) {
            if (text.trim() === '') return false
            // The Excel/Sheets clipboard is TSV in text/plain. It becomes a
            // real GFM table — content, not a card — so it goes through the
            // Markdown path rather than a renderer.
            if (standalone && looksLikeTsv(text)) {
              insertMarkdown(view, tsvToMarkdownTable(text))
              return true
            }
            // §4.2: prefer text/plain over the HTML flavour.
            insertMarkdown(view, text)
            return true
          }

          // §4.2 condition 3: convert only if it actually validates.
          void options.renderer.render(claimed.language, claimed.source).then((result) => {
            if (result.ok) {
              insertFence(view, claimed.language, claimed.source)
            } else {
              // Never guess silently wrong (§4.4) — fall back to the text path.
              insertMarkdown(view, text)
            }
          })
          return true
        },
      },
    })
  })
