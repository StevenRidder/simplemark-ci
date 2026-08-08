import { describe, expect, it } from 'vitest'

import {
  htmlCarriesDocumentStructure,
  isStandaloneBlockPaste,
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeTsv,
} from '../../src/domain/index.js'
import { claimPaste } from '../../src/adapters/editor/paste-sniffers.js'
import {
  BROWSER_CHAT_DIAGRAM_ANSWER_COPY,
  BROWSER_CHAT_MARKDOWN_COPY,
  BROWSER_CHAT_RICH_ANSWER_COPY,
  BROWSER_CHAT_SELECTION_COPY,
  BROWSER_MARKDOWN_SOURCE_COPY,
  DESKTOP_CHAT_COPY_BUTTON,
  EDITOR_SOURCE_COPY,
  JSON_OBJECT,
  SAFARI_CHAT_SELECTION_COPY,
  SAFARI_MARKDOWN_SOURCE_COPY,
  SPREADSHEET_TSV,
  SPREADSHEET_TSV_WITH_TABLE_HTML,
  TERMINAL_ANSI_DIFF,
  TERMINAL_DIFF,
  TERMINAL_FILE_TREE,
  TERMINAL_STACK_TRACE,
  VEGA_LITE_SPEC,
  WEB_TABLE_COPY,
  type ClipboardPayload,
} from '../support/clipboard-payloads.js'

/**
 * Which path does each clipboard source take? (issue #149)
 *
 * `htmlCarriesDocumentStructure` decides, for every paste, whether the
 * formatting survives or the `text/plain` Markdown is parsed instead. It has
 * been retuned twice already — once for the wrapper a plain-text copy carries,
 * once for BUG-2's `<pre>` of `<span>`s — and each retune can change the answer
 * for a source that used to work. `paste-html-structure.test.ts` tests the
 * predicate; this file tests the *consequence*, one assertion per real source.
 *
 * These are characterization tests. They record what today's code does, so a
 * future retune has to change a written-down expectation rather than a user's
 * paste. Where today's answer looks wrong it is pinned anyway, with the
 * argument written beside it — see the BUG-1 block below.
 *
 * The payloads are recordings of what real sources emit; see
 * `tests/support/clipboard-payloads.ts`, including the three that could not be
 * recorded and say so.
 */

/**
 * The paths a paste can take, in the order `handlePaste` considers them.
 *
 * `sniffer:<language>` means the paste-exhaust or diagram tier claimed it and
 * it will render as that block, subject to the renderer validating it
 * (§4.2 condition 3, which needs a live renderer and is not modelled here — a
 * validation failure falls back to `markdown`).
 */
type PasteRoute = `sniffer:${string}` | 'tsv' | 'html' | 'markdown' | 'declined'

/**
 * The §4.2 triage, in the order `handlePaste` runs it.
 *
 * This mirrors `pasteSniffers`' `handlePaste` in
 * `src/adapters/editor/paste-sniffers.ts`. It calls the real predicates and the
 * real sniffer chain — those cannot drift from production without this suite
 * noticing, which is the point. What it restates is the *ordering* of the four
 * checks, because that ordering lives inside a ProseMirror plugin and a plugin
 * needs an editor. Change the order in `handlePaste` and this mirror must move
 * with it; the end-to-end proof that the order is honoured at all lives in
 * `tests/ui/editor-harness.spec.ts` and `tests/ui/paste-document.spec.ts`.
 *
 * Two guards in `handlePaste` are deliberately outside the model, because
 * neither depends on the payload: a caret inside a code block declines every
 * paste, and `⌘⇧V` bypasses sniffing entirely.
 */
function routePaste(
  payload: ClipboardPayload,
  { atBlockBoundary = true }: { atBlockBoundary?: boolean } = {},
): PasteRoute {
  const { text, html } = payload
  if (text.trim() === '' && html.trim() === '') return 'declined'

  const standalone = isStandaloneBlockPaste({ text, atBlockBoundary })

  // 1. The sniffer chain, standalone pastes only.
  const claimed = standalone ? claimPaste(text, html) : null
  if (claimed !== null) return `sniffer:${claimed.language}`

  // 2. A spreadsheet grid becomes a real GFM table, ahead of any HTML flavour.
  if (standalone && looksLikeTsv(text)) return 'tsv'

  // 3. HTML that carries document structure keeps its formatting. Note this
  //    runs whether or not the caret is at a block boundary.
  if (htmlCarriesDocumentStructure(html)) return 'html'

  // 4. Otherwise `text/plain`, parsed as Markdown (BUG-1).
  if (text.trim() === '') return 'declined'
  return 'markdown'
}

describe('LLM output copied from a browser chat UI', () => {
  /**
   * BUG-1, and the case issue #149 singles out.
   *
   * A chat UI that overrides `copy` puts real Markdown source in `text/plain`
   * *and* the rendered message in `text/html`. Both flavours describe the whole
   * document, so the triage is choosing between two good answers rather than
   * rescuing one from a wrapper — and it chooses HTML, because a `<h2>` and a
   * `<strong>` are exactly what `htmlCarriesDocumentStructure` looks for.
   *
   * That is worth writing down rather than assuming, for two reasons.
   *
   * It is not obviously the better answer. The `text/plain` flavour here is
   * authored Markdown — the source of truth, and what SimpleMark saves to disk
   * — while the HTML is a rendering of it that has to be parsed back out. That
   * round trip is a lossy step in principle: a fence's language, a list's
   * nesting and a table's alignment all have to survive ProseMirror's DOM
   * parser, where the Markdown path would not have to survive anything.
   *
   * How much is lost is now measured, in `tests/ui/paste-chat-answer-fidelity.
   * spec.ts` — a live editor, which this suite is not. The short version: marks,
   * links, headings, nested lists, tables and both fence languages come through
   * intact; a task list loses its checkboxes; a formula loses its `$$` and lands
   * as flattened glyphs; and a rendered Mermaid chart lands as a kilobytes-long
   * `svg` fence with its four lines of source nowhere in the document.
   *
   * And it is fragile in the other direction. Anything that narrows the
   * predicate far enough to send this payload down the Markdown path would also
   * send `BROWSER_CHAT_SELECTION_COPY` there — the same message copied without
   * a copy handler, whose `text/plain` is stripped prose with no Markdown in
   * it at all. That paste would arrive as flat text. The two cases are
   * indistinguishable from the HTML alone, which is why the predicate cannot be
   * the place that separates them.
   *
   * So: pinned as `html`, deliberately, with the reservation recorded. If this
   * assertion ever fails, the question to answer first is which of those two
   * payloads the change was aimed at.
   */
  it('takes the HTML path when the UI puts Markdown source in text/plain (BUG-1)', () => {
    expect(routePaste(BROWSER_CHAT_MARKDOWN_COPY)).toBe('html')
  })

  it('takes the HTML path for an ordinary selection copy, where text/plain is only prose', () => {
    expect(routePaste(BROWSER_CHAT_SELECTION_COPY)).toBe('html')
  })

  // Safari, and the WKWebView the macOS shell itself runs in. WebKit prefixes
  // the fragment with `<!DOCTYPE html><head><meta charset="UTF-8"></head>` and
  // Chromium does not; the routing must not notice.
  it('routes the same in WebKit as in Chromium', () => {
    expect(routePaste(SAFARI_CHAT_SELECTION_COPY)).toBe(
      routePaste(BROWSER_CHAT_SELECTION_COPY),
    )
  })

  // The HTML check is not gated on the standalone-block test, so a rich paste
  // into the middle of a sentence still keeps its formatting.
  it('still takes the HTML path with the caret mid-sentence', () => {
    expect(routePaste(BROWSER_CHAT_MARKDOWN_COPY, { atBlockBoundary: false })).toBe('html')
  })

  // An answer with fences, math and a task list in it takes the same path.
  // What that costs is measured in tests/ui/paste-chat-answer-fidelity.spec.ts.
  it('takes the HTML path for a rich answer as well', () => {
    expect(routePaste(BROWSER_CHAT_RICH_ANSWER_COPY)).toBe('html')
  })

  /**
   * An answer whose diagram arrives already rendered takes it too.
   *
   * Worth its own assertion because a reader would expect `svg-in-html` to
   * claim a payload with a whole `<svg>` in it. It declines: BUG-5's rule says
   * a document that contains a chart is not a chart, and the surrounding
   * `<p>`/`<strong>` make this a document. So the `<svg>` is kept in place as
   * an `svg` fence by the HTML path — and the Mermaid source sitting in
   * `text/plain` is not consulted.
   */
  it('takes the HTML path for an answer whose diagram arrives rendered', () => {
    expect(routePaste(BROWSER_CHAT_DIAGRAM_ANSWER_COPY)).toBe('html')
  })
})

describe('LLM output copied from a desktop app', () => {
  // The Copy button writes one flavour. With no HTML at all there is nothing to
  // choose between: the Markdown source is parsed as Markdown, which is the
  // answer BUG-1 wants and the one the browser case does not get.
  it('takes the Markdown path — the Copy button publishes no HTML flavour', () => {
    expect(routePaste(DESKTOP_CHAT_COPY_BUTTON)).toBe('markdown')
  })

  // The same message, the same words, two paths. This is the routing fact the
  // issue is really about, so it is asserted rather than left to be inferred
  // from the two tests above.
  it('routes differently from the same message copied in a browser', () => {
    expect(routePaste(DESKTOP_CHAT_COPY_BUTTON)).not.toBe(routePaste(BROWSER_CHAT_MARKDOWN_COPY))
  })
})

describe('a plain-text copy of Markdown source (BUG-1)', () => {
  it('takes the Markdown path from a browser', () => {
    expect(routePaste(BROWSER_MARKDOWN_SOURCE_COPY)).toBe('markdown')
  })

  it('takes the Markdown path from Safari too', () => {
    expect(routePaste(SAFARI_MARKDOWN_SOURCE_COPY)).toBe('markdown')
  })

  // BUG-2: a `<pre>` of syntax-highlighting `<span>`s is a wrapper, not a
  // document. Reading it as one put a pasted Markdown file into a single
  // unparsed block.
  it('takes the Markdown path from a code editor or a terminal', () => {
    expect(routePaste(EDITOR_SOURCE_COPY)).toBe('markdown')
  })
})

describe('spreadsheet grids', () => {
  it('takes the TSV path, becoming a real GFM table', () => {
    expect(routePaste(SPREADSHEET_TSV)).toBe('tsv')
  })

  // Excel and Sheets publish an HTML table beside the TSV. The TSV check runs
  // first, so the grid becomes editable Markdown rather than parsed HTML.
  it('prefers the TSV flavour over the HTML table the same copy carries', () => {
    expect(routePaste(SPREADSHEET_TSV_WITH_TABLE_HTML)).toBe('tsv')
  })

  /**
   * A table copied out of a *web page* is not the same source, and does not
   * take the same path.
   *
   * The browser's flattened text has a leading blank line, so `looksLikeTsv`
   * sees a first row of one column and declines; the `<table>` in `text/html`
   * then wins. The document still arrives as a real table, so this is a benign
   * difference — but it is a real one, and hand-written TSV would never have
   * shown it.
   */
  it('takes the HTML path when the grid came from a rendered page', () => {
    expect(routePaste(WEB_TABLE_COPY)).toBe('html')
  })

  // Mid-sentence, the standalone-block test blocks the TSV conversion, and
  // there is no HTML flavour to fall back to.
  it('inserts as Markdown text when the caret is mid-sentence', () => {
    expect(routePaste(SPREADSHEET_TSV, { atBlockBoundary: false })).toBe('markdown')
  })
})

describe('the paste-exhaust tier', () => {
  it('claims a unified diff', () => {
    expect(routePaste(TERMINAL_DIFF)).toBe('sniffer:diff')
  })

  it('claims a coloured diff as ANSI', () => {
    expect(routePaste(TERMINAL_ANSI_DIFF)).toBe('sniffer:ansi')
  })

  /**
   * ...but not for the reason the sniffer chain gives.
   *
   * `paste-sniffers.ts` explains ANSI's higher priority with "coloured git
   * output carries both signatures". A real `git -c color.ui=always diff` does
   * not: git emits the SGR escape *before* the line content, so the line begins
   * `\x1b[1mdiff --git` and `\x1b[36m@@ …`, and both diff signatures are
   * anchored with `^`. `looksLikeDiff` therefore declines outright and the
   * priority contest never happens.
   *
   * The routing is right either way, and this is a comment being wrong rather
   * than code being wrong — so nothing in `src/` is changed for it. It is
   * asserted here because it is the kind of belief that gets relied on later:
   * anyone reordering these sniffers should know this payload does not test the
   * order.
   */
  it('does not match the diff signature at all, because the escape precedes the anchor', () => {
    expect(looksLikeAnsi(TERMINAL_ANSI_DIFF.text)).toBe(true)
    expect(looksLikeDiff(TERMINAL_ANSI_DIFF.text)).toBe(false)
  })

  it('claims a file tree', () => {
    expect(routePaste(TERMINAL_FILE_TREE)).toBe('sniffer:tree')
  })

  it('claims a stack trace', () => {
    expect(routePaste(TERMINAL_STACK_TRACE)).toBe('sniffer:stacktrace')
  })

  it('claims a JSON object', () => {
    expect(routePaste(JSON_OBJECT)).toBe('sniffer:json')
  })

  // A chart spec is JSON that says so, and has to outrank the JSON sniffer or
  // every pasted chart lands as a collapsible object dump.
  it('claims a Vega-Lite spec as a chart, not as JSON', () => {
    expect(routePaste(VEGA_LITE_SPEC)).toBe('sniffer:vega-lite')
  })

  // §4.2 condition 1. Every one of these is exhaust only when it is the whole
  // paste at a block boundary; mid-sentence they are text.
  it.each([
    ['diff', TERMINAL_DIFF],
    ['coloured diff', TERMINAL_ANSI_DIFF],
    ['file tree', TERMINAL_FILE_TREE],
    ['stack trace', TERMINAL_STACK_TRACE],
    ['JSON', JSON_OBJECT],
    ['Vega-Lite spec', VEGA_LITE_SPEC],
  ])('leaves a %s alone when the caret is mid-sentence', (_name, payload) => {
    expect(routePaste(payload, { atBlockBoundary: false })).toBe('markdown')
  })
})

describe('an empty clipboard', () => {
  it('is declined, so the browser keeps its own default', () => {
    expect(routePaste({ text: '', html: '' })).toBe('declined')
    expect(routePaste({ text: '   \n ', html: '  ' })).toBe('declined')
  })
})
