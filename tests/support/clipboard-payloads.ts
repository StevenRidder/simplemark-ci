/**
 * Real clipboard payloads, captured verbatim.
 *
 * Issue #149: every false positive `htmlCarriesDocumentStructure` has had so
 * far came from what a real source actually emits, not from what hand-written
 * HTML looks like. So these are recordings, not illustrations.
 *
 * **How they were captured.** A page was rendered in a real browser (Playwright
 * Chromium 1.62 and WebKit 1.62), a range was selected, a genuine copy was run,
 * and the result was pasted into a `contenteditable` — the strings below are
 * what `event.clipboardData.getData('text/plain' | 'text/html')` returned in
 * that paste handler, which is the exact input `handlePaste` receives. Nothing
 * was tidied afterwards, which is why the inline `style` soup, the
 * `<span> </span>` word joiners and the engine-specific prologues are all still
 * here: those are the bytes the predicate actually sees.
 *
 * **What is a reconstruction and what is not.** The browser's serialization is
 * real. The *page* it serialized is a faithful rebuild of a Markdown-rendered
 * assistant message (`<p>`, `<strong>`, `<h2>`, `<ul>`, a table, a link),
 * because scraping a logged-in product's DOM is not something this suite can do
 * offline. Payloads that could not be captured at all are declared as such at
 * their definition — see `tests/adapters/paste-source-routing.test.ts` — rather
 * than being invented in a clean form here.
 *
 * The browser payloads are written as escaped one-line string literals on
 * purpose: that is the verbatim recording, and reflowing it for readability
 * would quietly turn it back into a hand-written fixture.
 *
 * Sources further down are terminal and editor output rather than clipboard
 * flavours — a terminal publishes `text/plain` only. Each says at its own
 * definition how it was produced, and the two that could not be produced on
 * this machine at all say that instead of pretending.
 */

/** The two clipboard flavours the paste triage reads. */
export interface ClipboardPayload {
  /** `text/plain`. */
  readonly text: string
  /** `text/html`, empty when the source published no HTML flavour. */
  readonly html: string
}

/**
 * The case issue #149 calls the most important, captured in Chromium.
 *
 * An LLM chat UI in a browser that installs its own `copy` handler: the
 * rendered message goes to `text/html`, and the **Markdown source** goes to
 * `text/plain`. Both flavours are therefore complete documents, and the triage
 * has to pick one. This is the shape behind BUG-1.
 */
export const BROWSER_CHAT_MARKDOWN_COPY: ClipboardPayload = {
  text: "Short answer: decide **once**, at triage, and never guess twice.\n\n## What the clipboard actually carries\n\nEvery copy puts *two* flavours on the clipboard. The `text/html` flavour keeps the rendering; `text/plain` keeps the source.\n\n- Prefer **HTML** when it carries real structure.\n- Prefer **Markdown** when the plain text is the source of truth.\n\n| Flavour | Wins when |\n| --- | --- |\n| text/html | Headings, marks, tables |\n| text/plain | Markdown source |\n\nAsk for the [full ruling table](https://example.test/spec) if you want it.",
  html: "<p>Short answer: decide <strong>once</strong>, at triage, and never guess twice.</p><h2>What the clipboard actually carries</h2><p>Every copy puts <em>two</em> flavours on the clipboard. The <code>text/html</code> flavour keeps the rendering; <code>text/plain</code> keeps the source.</p><ul><li>Prefer <strong>HTML</strong> when it carries real structure.</li><li>Prefer <strong>Markdown</strong> when the plain text is the source of truth.</li></ul><table><thead><tr><th>Flavour</th><th>Wins when</th></tr></thead><tbody><tr><td>text/html</td><td>Headings, marks, tables</td></tr><tr><td>text/plain</td><td>Markdown source</td></tr></tbody></table><p>Ask for the <a href=\"https://example.test/spec\">full ruling table</a> if you want it.</p>",
}

/**
 * The same chat message, but copied by plain selection + ⌘C, in Chromium.
 *
 * With no copy handler in the way the browser's own serializer runs, so
 * `text/plain` is the *rendered* text — no Markdown markers at all — and
 * `text/html` carries every computed style inline. Losing the HTML path here
 * would lose the document outright, because the plain flavour no longer
 * describes it.
 */
export const BROWSER_CHAT_SELECTION_COPY: ClipboardPayload = {
  text: "Short answer: decide once, at triage, and never guess twice.\n\nWhat the clipboard actually carries\nEvery copy puts two flavours on the clipboard. The text/html flavour keeps the rendering; text/plain keeps the source.\n\nPrefer HTML when it carries real structure.\nPrefer Markdown when the plain text is the source of truth.\nFlavour\tWins when\ntext/html\tHeadings, marks, tables\ntext/plain\tMarkdown source\nAsk for the full ruling table if you want it.",
  html: "<p style=\"margin: 0px 0px 1em; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">Short answer: decide<span> </span><strong>once</strong>, at triage, and never guess twice.</p><h2 style=\"font-size: 1.25em; font-weight: 600; margin: 1.4em 0px 0.6em; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">What the clipboard actually carries</h2><p style=\"margin: 0px 0px 1em; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">Every copy puts<span> </span><em>two</em><span> </span>flavours on the clipboard. The<span> </span><code style=\"font-family: ui-monospace, monospace; background: rgb(243, 243, 243); border-radius: 4px; padding: 0.1em 0.3em;\">text/html</code><span> </span>flavour keeps the rendering;<span> </span><code style=\"font-family: ui-monospace, monospace; background: rgb(243, 243, 243); border-radius: 4px; padding: 0.1em 0.3em;\">text/plain</code><span> </span>keeps the source.</p><ul style=\"padding-left: 1.4em; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\"><li>Prefer<span> </span><strong>HTML</strong><span> </span>when it carries real structure.</li><li>Prefer<span> </span><strong>Markdown</strong><span> </span>when the plain text is the source of truth.</li></ul><table style=\"border-collapse: collapse; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\"><thead><tr><th style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Flavour</th><th style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Wins when</th></tr></thead><tbody><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">text/html</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Headings, marks, tables</td></tr><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">text/plain</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Markdown source</td></tr></tbody></table><p style=\"margin: 0px 0px 1em; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">Ask for the<span> </span><a href=\"https://example.test/spec\">full ruling table</a><span> </span>if you want it.</p>",
}

/**
 * The same selection copy in WebKit — Safari, and the WKWebView the macOS
 * shell itself runs in.
 *
 * Kept because the engines disagree about the prologue: WebKit writes
 * `<!DOCTYPE html><head><meta charset="UTF-8"></head>` in front of the
 * fragment and Chromium writes nothing. A predicate that ever keyed on that
 * prologue would pass on one engine and fail on the other.
 */
export const SAFARI_CHAT_SELECTION_COPY: ClipboardPayload = {
  text: "Short answer: decide once, at triage, and never guess twice.\n\nWhat the clipboard actually carries\n\nEvery copy puts two flavours on the clipboard. The text/html flavour keeps the rendering; text/plain keeps the source.\n\nPrefer HTML when it carries real structure.\nPrefer Markdown when the plain text is the source of truth.\nFlavour\tWins when\ntext/html\tHeadings, marks, tables\ntext/plain\tMarkdown source\nAsk for the full ruling table if you want it.",
  html: "<!DOCTYPE html><head><meta charset=\"UTF-8\"></head><p style=\"margin: 0px 0px 1em; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: -apple-system, Segoe UI, sans-serif; font-size: 16px; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\">Short answer: decide<span class=\"Apple-converted-space\"> </span><strong>once</strong>, at triage, and never guess twice.</p><h2 style=\"font-size: 1.25em; font-weight: 600; margin: 1.4em 0px 0.6em; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: -apple-system, Segoe UI, sans-serif; font-style: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\">What the clipboard actually carries</h2><p style=\"margin: 0px 0px 1em; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: -apple-system, Segoe UI, sans-serif; font-size: 16px; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\">Every copy puts<span class=\"Apple-converted-space\"> </span><em>two</em><span class=\"Apple-converted-space\"> </span>flavours on the clipboard. The<span class=\"Apple-converted-space\"> </span><code style=\"font-family: ui-monospace, monospace; background: rgb(243, 243, 243); border-radius: 4px; padding: 0.1em 0.3em;\">text/html</code><span class=\"Apple-converted-space\"> </span>flavour keeps the rendering;<span class=\"Apple-converted-space\"> </span><code style=\"font-family: ui-monospace, monospace; background: rgb(243, 243, 243); border-radius: 4px; padding: 0.1em 0.3em;\">text/plain</code><span class=\"Apple-converted-space\"> </span>keeps the source.</p><ul style=\"padding-left: 1.4em; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: -apple-system, Segoe UI, sans-serif; font-size: 16px; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\"><li>Prefer<span class=\"Apple-converted-space\"> </span><strong>HTML</strong><span class=\"Apple-converted-space\"> </span>when it carries real structure.</li><li>Prefer<span class=\"Apple-converted-space\"> </span><strong>Markdown</strong><span class=\"Apple-converted-space\"> </span>when the plain text is the source of truth.</li></ul><table style=\"border-collapse: collapse; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: -apple-system, Segoe UI, sans-serif; font-size: 16px; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\"><thead><tr><th style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Flavour</th><th style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Wins when</th></tr></thead><tbody><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">text/html</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Headings, marks, tables</td></tr><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">text/plain</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Markdown source</td></tr></tbody></table><p style=\"margin: 0px 0px 1em; caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: -apple-system, Segoe UI, sans-serif; font-size: 16px; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\">Ask for the<span class=\"Apple-converted-space\"> </span><a href=\"https://example.test/spec\">full ruling table</a><span class=\"Apple-converted-space\"> </span>if you want it.</p>",
}

/**
 * BUG-1: a plain-text copy of Markdown source out of a browser.
 *
 * A `.md` file served as text, a raw view, a docs page showing source — the
 * browser renders it in a `<pre>` and the copy carries that `<pre>` in
 * `text/html`. `text/plain` is the real Markdown, and it must keep taking the
 * Markdown path or pasted source stops being parsed.
 */
export const BROWSER_MARKDOWN_SOURCE_COPY: ClipboardPayload = {
  text: "## Not a heading yet\n\nSome **bold** prose and a [link](https://example.test/).\n\n- one\n- two",
  html: "<pre id=\"raw-markdown\" style=\"color: rgb(0, 0, 0); font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">## Not a heading yet\n\nSome **bold** prose and a [link](https://example.test/).\n\n- one\n- two</pre>",
}

/**
 * The BUG-1 plain-text copy again, in WebKit.
 */
export const SAFARI_MARKDOWN_SOURCE_COPY: ClipboardPayload = {
  text: "## Not a heading yet\n\nSome **bold** prose and a [link](https://example.test/).\n\n- one\n- two",
  html: "<!DOCTYPE html><pre id=\"raw-markdown\" style=\"caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-size: 16px; font-style: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-stroke-width: 0px; text-decoration: none;\">## Not a heading yet\n\nSome **bold** prose and a [link](https://example.test/).\n\n- one\n- two</pre>",
}

/**
 * BUG-2: a code editor's clipboard — a `<pre>` of syntax-highlighting
 * `<span>`s wrapped around the same plain text.
 *
 * The `mtk1` class name is Monaco's, the editor VS Code is built on. This is a
 * highlighted wrapper rather than a document, and treating it as one sent a
 * pasted Markdown source file through the HTML path where it landed as a single
 * unparsed block.
 */
export const EDITOR_SOURCE_COPY: ClipboardPayload = {
  text: "## Not a heading yet\nSome **bold** prose.",
  html: "<pre id=\"editor-source\" style=\"color: rgb(0, 0, 0); font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\"><span class=\"mtk1\">## Not a heading yet</span>\n<span class=\"mtk1\">Some **bold** prose.</span></pre>",
}

/**
 * A table copied out of a rendered web page.
 *
 * Not a spreadsheet: the browser serializes the `<table>` into `text/html` and
 * flattens it to tab-separated text — with a leading and a trailing newline that
 * a spreadsheet's own clipboard does not have. That detail decides which path it
 * takes, which is exactly why it is recorded rather than typed out.
 */
export const WEB_TABLE_COPY: ClipboardPayload = {
  text: "\nRegion\tQ3\tQ4\nNorth\t1200\t1500\nSouth\t900\t1100\n",
  html: "<table id=\"sheet\" style=\"border-collapse: collapse; color: rgb(0, 0, 0); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\"><tbody><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Region</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Q3</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">Q4</td></tr><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">North</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">1200</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">1500</td></tr><tr><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">South</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">900</td><td style=\"border: 1px solid rgb(221, 221, 221); padding: 6px 10px; text-align: left;\">1100</td></tr></tbody></table>",
}

/**
 * LLM output copied out of a **desktop** app with its Copy button.
 *
 * NOT CAPTURED. A desktop chat app is not scriptable from this suite, so this
 * one is asserted rather than recorded: a Copy button writes a single flavour
 * with `clipboard.writeText`, so `text/html` is absent entirely and
 * `text/plain` is the Markdown source. The text below is the same message as
 * `BROWSER_CHAT_MARKDOWN_COPY`, so the two differ only in the way the issue
 * says they differ — whether an HTML flavour exists at all.
 *
 * Selecting the message and pressing ⌘C inside such an app is a different
 * gesture with a different answer: those apps are web views, so that copy is
 * `BROWSER_CHAT_SELECTION_COPY`.
 */
export const DESKTOP_CHAT_COPY_BUTTON: ClipboardPayload = {
  text: BROWSER_CHAT_MARKDOWN_COPY.text,
  html: '',
}

/**
 * A spreadsheet range copied out of Excel or Google Sheets.
 *
 * NOT CAPTURED — neither app is drivable from this suite. What is claimed is
 * narrow and long-documented: the grid arrives in `text/plain` as rows of
 * tab-separated cells, with no leading blank line. Compare `WEB_TABLE_COPY`,
 * which *is* a recording and does have one; that difference is the whole reason
 * this is worth pinning separately.
 */
export const SPREADSHEET_TSV: ClipboardPayload = {
  text: 'Region\tQ3\tQ4\nNorth\t1200\t1500\nSouth\t900\t1100',
  html: '',
}

/**
 * The same spreadsheet grid, but carrying an HTML table flavour as well.
 *
 * COMPOSED, and labelled as such: the `text/plain` is `SPREADSHEET_TSV` and the
 * `text/html` is the recorded table from `WEB_TABLE_COPY`. Excel and Sheets
 * both publish an HTML table beside their TSV, and this pairing is what decides
 * which of the two flavours the triage listens to.
 */
export const SPREADSHEET_TSV_WITH_TABLE_HTML: ClipboardPayload = {
  text: SPREADSHEET_TSV.text,
  html: WEB_TABLE_COPY.html,
}

/**
 * A unified diff, from a real `git diff` against a scratch repository.
 *
 * A terminal publishes `text/plain` only, so every payload from here down has
 * an empty HTML flavour — which is itself the thing being pinned.
 */
export const TERMINAL_DIFF: ClipboardPayload = {
  text: "diff --git a/route.js b/route.js\nindex 96358cb..fe2c829 100644\n--- a/route.js\n+++ b/route.js\n@@ -1,3 +1,5 @@\n export function route(html) {\n   return carriesStructure(html) ? \"html\" : \"markdown\"\n }\n+\n+export const PATHS = [\"html\", \"markdown\", \"tsv\"]\n",
  html: '',
}

/**
 * The same diff with colour on: `git -c color.ui=always diff`, verbatim,
 * escape bytes included.
 *
 * It carries both signatures — real SGR sequences *and* `diff --git` — which is
 * why the sniffer chain gives ANSI the higher priority. Recorded rather than
 * typed out because the escapes are exactly the part nobody writes correctly by
 * hand.
 */
export const TERMINAL_ANSI_DIFF: ClipboardPayload = {
  text: "\u001b[1mdiff --git a/route.js b/route.js\u001b[m\n\u001b[1mindex 96358cb..fe2c829 100644\u001b[m\n\u001b[1m--- a/route.js\u001b[m\n\u001b[1m+++ b/route.js\u001b[m\n\u001b[36m@@ -1,3 +1,5 @@\u001b[m\n export function route(html) {\u001b[m\n   return carriesStructure(html) ? \"html\" : \"markdown\"\u001b[m\n }\u001b[m\n\u001b[32m+\u001b[m\n\u001b[32m+\u001b[m\u001b[32mexport const PATHS = [\"html\", \"markdown\", \"tsv\"]\u001b[m\n",
  html: '',
}

/**
 * A real Node stack trace: an actual thrown `Error`, printed and copied out of
 * the terminal — internal frames and all, because that is what a person pastes.
 */
export const TERMINAL_STACK_TRACE: ClipboardPayload = {
  text: "Error: spec did not validate\n    at inner ([eval]:2:25)\n    at outer ([eval]:3:19)\n    at [eval]:4:7\n    at runScriptInThisContext (node:internal/vm:219:10)\n    at node:internal/process/execution:451:12\n    at [eval]-wrapper:6:24\n    at runScriptInContext (node:internal/process/execution:449:60)\n    at evalFunction (node:internal/process/execution:283:30)\n    at evalTypeScript (node:internal/process/execution:295:3)\n    at node:internal/main/eval_string:71:3",
  html: '',
}

/**
 * A box-drawing file tree.
 *
 * NOT CAPTURED from `tree(1)` — the tool is not installed on the capture
 * machine. This is the listing from the BUG-5 report, which was a real paste
 * from a coding agent, reused here rather than a tidier one being invented.
 */
export const TERMINAL_FILE_TREE: ClipboardPayload = {
  text: "src\n├── domain\n│   └── paste\n└── adapters\n    └── renderers",
  html: '',
}

/**
 * A JSON object: the head of this repository's own `package.json`.
 */
export const JSON_OBJECT: ClipboardPayload = {
  text: "{\n  \"name\": \"simplemark\",\n  \"version\": \"0.1.0\",\n  \"private\": true,\n  \"type\": \"module\",\n  \"engines\": {\n    \"node\": \">=20\"\n  }\n}",
  html: '',
}

/**
 * A Vega-Lite chart spec, read out of the `vega-lite` fence in
 * `docs/showcase/welcome-to-simplemark.md` — a spec the product ships and
 * renders, rather than a four-line schema stub.
 */
export const VEGA_LITE_SPEC: ClipboardPayload = {
  text: "{\n  \"$schema\": \"https://vega.github.io/schema/vega-lite/v6.json\",\n  \"description\": \"Illustrative anatomy of a strong AI document\",\n  \"title\": {\n    \"text\": \"A strong AI document has more than words\",\n    \"subtitle\": \"Illustrative share of attention · hover the block to inspect its data\",\n    \"anchor\": \"start\"\n  },\n  \"width\": 560,\n  \"height\": 350,\n  \"data\": {\n    \"values\": [\n      {\"category\":\"Prose\",\"value\":34},\n      {\"category\":\"Decisions\",\"value\":18},\n      {\"category\":\"Data\",\"value\":16},\n      {\"category\":\"Diagrams\",\"value\":14},\n      {\"category\":\"Evidence\",\"value\":18}\n    ]\n  },\n  \"transform\": [\n    {\"calculate\": \"datum.category + ' · ' + datum.value + '%'\", \"as\": \"label\"}\n  ],\n  \"encoding\": {\n    \"theta\": {\"field\": \"value\", \"type\": \"quantitative\", \"stack\": true},\n    \"color\": {\n      \"field\": \"category\",\n      \"type\": \"nominal\",\n      \"scale\": {\"range\": [\"#4d8f7e\", \"#ffb15c\", \"#7bb9aa\", \"#ef7f6d\", \"#315f65\"]},\n      \"legend\": null\n    },\n    \"order\": {\"field\": \"value\", \"sort\": \"descending\"}\n  },\n  \"layer\": [\n    {\n      \"mark\": {\n        \"type\": \"arc\",\n        \"innerRadius\": 88,\n        \"outerRadius\": 145,\n        \"cornerRadius\": 7,\n        \"padAngle\": 0.02,\n        \"stroke\": \"#fffdf8\",\n        \"strokeWidth\": 3\n      }\n    },\n    {\n      \"mark\": {\n        \"type\": \"text\",\n        \"radius\": 180,\n        \"fontSize\": 13,\n        \"fontWeight\": 700\n      },\n      \"encoding\": {\n        \"text\": {\"field\": \"label\"},\n        \"color\": {\"value\": \"#29443f\"}\n      }\n    }\n  ],\n  \"config\": {\n    \"view\": {\"stroke\": null},\n    \"background\": \"transparent\"\n  }\n}",
  html: '',
}
