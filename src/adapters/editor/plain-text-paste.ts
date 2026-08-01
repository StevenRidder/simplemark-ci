import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * Implements the DESIGN.md §4.2 clipboard ruling:
 *
 *   | Clipboard has both `text/html` and `text/plain`, no SVG
 *   | → Markdown path on `text/plain` — pasted-from-browser HTML is not
 *   |   treated as a document.
 *
 * Editors and viewers put a syntax-highlighted `<pre>` on the clipboard
 * alongside the plain text. Milkdown's clipboard plugin prefers `text/html`, so
 * copying a `.md` file out of an editor and pasting it here produced one giant
 * ```markdown code block instead of a document — the whole file rendered as
 * source (BUG-2).
 *
 * Taking the plain-text branch is also the more faithful one: `text/plain` is
 * the Markdown the author actually wrote, while the HTML is one viewer's
 * rendering of it, complete with that viewer's fonts, colours, and wrappers.
 *
 * Deliberately narrow. It does not implement the §4 sniffer chain — bare
 * Mermaid or a raw `<svg>` with no fence still arrives as text, and the
 * `svg-in-html` case is explicitly deferred here rather than half-handled.
 */

export const plainTextPasteKey = new PluginKey('simplemark-plain-text-paste')

/** `<svg>` on the clipboard belongs to the sniffer chain, which does not exist yet. */
const SVG_IN_HTML = /<svg[\s>]/i

export const plainTextPaste = $prose((ctx: Ctx) => {
  return new Plugin({
    key: plainTextPasteKey,
    props: {
      handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
        const clipboard = event.clipboardData
        if (clipboard === null) return false

        const text = clipboard.getData('text/plain')
        if (text.trim() === '') return false

        // Leave the SVG case to the sniffer chain when it lands, rather than
        // silently choosing the wrong branch for it now.
        if (SVG_IN_HTML.test(clipboard.getData('text/html'))) return false

        // Inside a code block the clipboard is literal text by definition.
        // Hijacking it would rewrite what someone is deliberately quoting.
        const { $from } = view.state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.spec.code === true) return false
        }

        let parsed
        try {
          parsed = ctx.get(parserCtx)(text)
        } catch {
          // Not parseable as Markdown: fall through so the default paths run.
          return false
        }
        if (parsed === null || parsed === undefined) return false

        view.dispatch(
          view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView(),
        )
        return true
      },
    },
  })
})
