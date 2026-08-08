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
 * The same copy mode, but a **rich** answer: code fences, math and a task list.
 *
 * `BROWSER_CHAT_MARKDOWN_COPY` is prose, marks, a list and a table — the part
 * of an assistant answer that survives almost anything. This is the rest of a
 * real one: two fenced blocks that name their language, a nested ordered list
 * with an unordered list inside it, a GFM task list, inline math and display
 * math. Those are the constructs whose survival through the HTML path is not
 * obvious, and `tests/ui/paste-chat-answer-fidelity.spec.ts` measures what each
 * one costs.
 *
 * **How it was captured.** The same recording procedure as the payloads above:
 * a page rendered in Chromium 1.62, a range selected, a genuine copy, and the
 * strings below are what `getData('text/plain' | 'text/html')` returned in a
 * real paste handler. The copy handler is the one a chat UI installs — the
 * rendering to `text/html`, the Markdown source to `text/plain`.
 *
 * **What is a reconstruction and what is not.** The prose, heading, list, table
 * and `<pre><code class="language-…">` markup is the shape a Markdown-to-HTML
 * renderer emits, rebuilt here because a logged-in product's DOM cannot be
 * scraped offline; the `hljs-` spans stand in for whichever highlighter the UI
 * runs. The math is not a rebuild: it is KaTeX's own output at the library's
 * default settings, which is why the hidden `<span class="katex-mathml">`
 * branch, its `<annotation encoding="application/x-tex">`, and the visible
 * glyph spans are all present. That duplication is not an artifact of the
 * capture — it is what every KaTeX-rendering chat UI puts on the clipboard, and
 * it is the reason a pasted formula arrives the way it does.
 */
export const BROWSER_CHAT_RICH_ANSWER_COPY: ClipboardPayload = {
  text: "Here's the one-pass version in **Python**, plus why the naive form is *numerically unstable*.\n\n## Welford’s method\n\nIt keeps `count`, `mean` and `m2` in step, so the cost is $O(n \\log n)$ only if you sort first.\n\n$$\n\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^{N}(x_i - \\mu)^2}\n$$\n\n### Steps\n\n1. Seed the accumulators.\n   - `count` starts at zero\n   - `mean` starts at zero\n2. For each sample:\n   1. update the count\n   2. update the mean\n3. Take the square root at the end.\n\n- [x] Handles streaming input\n- [ ] Handles removing a sample\n\n```python\ndef welford(samples):\n    count, mean, m2 = 0, 0.0, 0.0\n    for x in samples:\n        count += 1\n        delta = x - mean\n        mean += delta / count\n        m2 += delta * (x - mean)\n    return (m2 / count) ** 0.5\n```\n\nThe TypeScript port is a one-liner:\n\n```ts\nexport const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length\n```\n\n| Approach | Passes | Stable |\n| --- | --- | --- |\n| Naive sum of squares | 2 | no |\n| *Welford* | 1 | **yes** |\n\nSee the [original paper](https://example.test/welford) for the derivation.",
  html: "<p>Here's the one-pass version in <strong>Python</strong>, plus why the naive form is <em>numerically unstable</em>.</p>\n<h2>Welford’s method</h2>\n<p>It keeps <code>count</code>, <code>mean</code> and <code>m2</code> in step, so the cost is <span class=\"katex\"><span class=\"katex-mathml\"><math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow><mi>O</mi><mo stretchy=\"false\">(</mo><mi>n</mi><mi>log</mi><mo>⁡</mo><mi>n</mi><mo stretchy=\"false\">)</mo></mrow><annotation encoding=\"application/x-tex\">O(n \\log n)</annotation></semantics></math></span><span class=\"katex-html\" aria-hidden=\"true\"><span class=\"katex-base\"><span class=\"katex-strut\" style=\"height:1em;vertical-align:-0.25em;\"></span><span class=\"mord mathnormal\" style=\"margin-right:0.0278em;\">O</span><span class=\"mopen\">(</span><span class=\"mord mathnormal\">n</span><span class=\"mspace\" style=\"margin-right:0.1667em;\"></span><span class=\"mop\">lo<span style=\"margin-right:0.0139em;\">g</span></span><span class=\"mspace\" style=\"margin-right:0.1667em;\"></span><span class=\"mord mathnormal\">n</span><span class=\"mclose\">)</span></span></span></span> only if you sort first.</p>\n<span class=\"katex-display\"><span class=\"katex\"><span class=\"katex-mathml\"><math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mrow><mi>σ</mi><mo>=</mo><msqrt><mrow><mfrac><mn>1</mn><mi>N</mi></mfrac><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover><mo stretchy=\"false\">(</mo><msub><mi>x</mi><mi>i</mi></msub><mo>−</mo><mi>μ</mi><msup><mo stretchy=\"false\">)</mo><mn>2</mn></msup></mrow></msqrt></mrow><annotation encoding=\"application/x-tex\">\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^{N}(x_i - \\mu)^2}</annotation></semantics></math></span><span class=\"katex-html\" aria-hidden=\"true\"><span class=\"katex-base\"><span class=\"katex-strut\" style=\"height:0.4306em;\"></span><span class=\"mord mathnormal\" style=\"margin-right:0.0359em;\">σ</span><span class=\"mspace\" style=\"margin-right:0.2778em;\"></span><span class=\"mrel\">=</span><span class=\"mspace\" style=\"margin-right:0.2778em;\"></span></span><span class=\"katex-base\"><span class=\"katex-strut\" style=\"height:3.3338em;vertical-align:-1.2777em;\"></span><span class=\"mord sqrt\"><span class=\"vlist-t vlist-t2\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:2.0561em;\"><span class=\"svg-align\" style=\"top:-5.2938em;\"><span class=\"pstrut\" style=\"height:5.2938em;\"></span><span class=\"mord\" style=\"padding-left:1.056em;\"><span class=\"mord\"><span class=\"mopen nulldelimiter\"></span><span class=\"mfrac\"><span class=\"vlist-t vlist-t2\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:1.3214em;\"><span style=\"top:-2.314em;\"><span class=\"pstrut\" style=\"height:3em;\"></span><span class=\"mord\"><span class=\"mord mathnormal\" style=\"margin-right:0.109em;\">N</span></span></span><span style=\"top:-3.23em;\"><span class=\"pstrut\" style=\"height:3em;\"></span><span class=\"frac-line\" style=\"border-bottom-width:0.04em;\"></span></span><span style=\"top:-3.677em;\"><span class=\"pstrut\" style=\"height:3em;\"></span><span class=\"mord\"><span class=\"mord\">1</span></span></span></span><span class=\"vlist-s\">​</span></span><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.686em;\"><span></span></span></span></span></span><span class=\"mclose nulldelimiter\"></span></span><span class=\"mspace\" style=\"margin-right:0.1667em;\"></span><span class=\"mop op-limits\"><span class=\"vlist-t vlist-t2\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:1.8283em;\"><span style=\"top:-1.8723em;margin-left:0em;\"><span class=\"pstrut\" style=\"height:3.05em;\"></span><span class=\"katex-sizing reset-size6 size3 mtight\"><span class=\"mord mtight\"><span class=\"mord mathnormal mtight\">i</span><span class=\"mrel mtight\">=</span><span class=\"mord mtight\">1</span></span></span></span><span style=\"top:-3.05em;\"><span class=\"pstrut\" style=\"height:3.05em;\"></span><span><span class=\"mop op-symbol large-op\">∑</span></span></span><span style=\"top:-4.3em;margin-left:0em;\"><span class=\"pstrut\" style=\"height:3.05em;\"></span><span class=\"katex-sizing reset-size6 size3 mtight\"><span class=\"mord mtight\"><span class=\"mord mathnormal mtight\" style=\"margin-right:0.109em;\">N</span></span></span></span></span><span class=\"vlist-s\">​</span></span><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:1.2777em;\"><span></span></span></span></span></span><span class=\"mopen\">(</span><span class=\"mord\"><span class=\"mord mathnormal\">x</span><span class=\"msupsub\"><span class=\"vlist-t vlist-t2\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.3117em;\"><span style=\"top:-2.55em;margin-left:0em;margin-right:0.05em;\"><span class=\"pstrut\" style=\"height:2.7em;\"></span><span class=\"katex-sizing reset-size6 size3 mtight\"><span class=\"mord mathnormal mtight\">i</span></span></span></span><span class=\"vlist-s\">​</span></span><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.15em;\"><span></span></span></span></span></span></span><span class=\"mspace\" style=\"margin-right:0.2222em;\"></span><span class=\"mbin\">−</span><span class=\"mspace\" style=\"margin-right:0.2222em;\"></span><span class=\"mord mathnormal\">μ</span><span class=\"mclose\"><span class=\"mclose\">)</span><span class=\"msupsub\"><span class=\"vlist-t\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.7401em;\"><span style=\"top:-2.989em;margin-right:0.05em;\"><span class=\"pstrut\" style=\"height:2.7em;\"></span><span class=\"katex-sizing reset-size6 size3 mtight\"><span class=\"mord mtight\">2</span></span></span></span></span></span></span></span></span></span><span style=\"top:-4.0161em;\"><span class=\"pstrut\" style=\"height:5.2938em;\"></span><span class=\"hide-tail\" style=\"min-width:0.742em;height:3.3738em;\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400em\" height=\"3.3738em\" viewBox=\"0 0 400000 3373\" preserveAspectRatio=\"xMinYMin slice\"><path d=\"M702 80H40000040\nH742v3239l-4 4-4 4c-.667.7 -2 1.5-4 2.5s-4.167 1.833-6.5 2.5-5.5 1-9.5 1\nh-12l-28-84c-16.667-52-96.667 -294.333-240-727l-212 -643 -85 170\nc-4-3.333-8.333-7.667-13 -13l-13-13l77-155 77-156c66 199.333 139 419.667\n219 661 l218 661zM702 80H400000v40H742z\"></path></svg></span></span></span><span class=\"vlist-s\">​</span></span><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:1.2777em;\"><span></span></span></span></span></span></span></span></span></span>\n<h3>Steps</h3>\n<ol>\n<li>Seed the accumulators.\n<ul>\n<li><code>count</code> starts at zero</li>\n<li><code>mean</code> starts at zero</li>\n</ul>\n</li>\n<li>For each sample:\n<ol>\n<li>update the count</li>\n<li>update the mean</li>\n</ol>\n</li>\n<li>Take the square root at the end.</li>\n</ol>\n<ul class=\"contains-task-list\">\n<li class=\"task-list-item\"><input type=\"checkbox\" checked=\"\" disabled=\"\"> Handles streaming input</li>\n<li class=\"task-list-item\"><input type=\"checkbox\" disabled=\"\"> Handles removing a sample</li>\n</ul>\n<pre><code class=\"language-python\"><span class=\"hljs-keyword\">def</span> <span class=\"hljs-title function_\">welford</span>(<span class=\"hljs-params\">samples</span>):\n    count, mean, m2 = <span class=\"hljs-number\">0</span>, <span class=\"hljs-number\">0.0</span>, <span class=\"hljs-number\">0.0</span>\n    <span class=\"hljs-keyword\">for</span> x <span class=\"hljs-keyword\">in</span> samples:\n        count += <span class=\"hljs-number\">1</span>\n        delta = x - mean\n        mean += delta / count\n        m2 += delta * (x - mean)\n    <span class=\"hljs-keyword\">return</span> (m2 / count) ** <span class=\"hljs-number\">0.5</span>\n</code></pre>\n<p>The TypeScript port is a one-liner:</p>\n<pre><code class=\"language-ts\"><span class=\"hljs-keyword\">export</span> <span class=\"hljs-keyword\">const</span> mean = (<span class=\"hljs-params\">xs: number[]</span>): <span class=\"hljs-built_in\">number</span> =&gt; xs.<span class=\"hljs-title function_\">reduce</span>((<span class=\"hljs-params\">a, b</span>) =&gt; a + b, <span class=\"hljs-number\">0</span>) / xs.<span class=\"hljs-property\">length</span>\n</code></pre>\n<table>\n<thead><tr><th>Approach</th><th>Passes</th><th>Stable</th></tr></thead>\n<tbody>\n<tr><td>Naive sum of squares</td><td>2</td><td>no</td></tr>\n<tr><td><em>Welford</em></td><td>1</td><td><strong>yes</strong></td></tr>\n</tbody>\n</table>\n<p>See the <a href=\"https://example.test/welford\">original paper</a> for the derivation.</p>",
}

/**
 * An assistant answer whose diagram is a **rendered** Mermaid chart.
 *
 * `text/plain` holds the `\`\`\`mermaid` fence — four lines of source. The
 * `text/html` holds what the reader was looking at: ~15 kB of laid-out SVG
 * geometry with mermaid's theme `<style>` inlined. The SVG is not a drawing of
 * a diagram written for this file; it is the output of this repository's own
 * Mermaid renderer for exactly that source, read back out of the running app,
 * so the size and shape are the real ones.
 *
 * Captured the same way as the payload above. It exists because the two
 * flavours here are not two encodings of the same thing: one is source a person
 * can edit and the other is a picture of it, and `svgToCodeFenceHtml` turns the
 * picture into an `svg` fence. Which one lands is measured in
 * `tests/ui/paste-chat-answer-fidelity.spec.ts`.
 */
export const BROWSER_CHAT_DIAGRAM_ANSWER_COPY: ClipboardPayload = {
  text: "The routing is **one** decision, made once at triage:\n\n```mermaid\nflowchart TD\n  A[Clipboard] --> B{HTML has structure?}\n  B -- yes --> C[HTML path]\n  B -- no --> D[Markdown path]\n```\n\nBoth branches end in the same document.",
  html: "<p>The routing is <strong>one</strong> decision, made once at triage:</p>\n<div class=\"diagram\"><svg id=\"simplemark-diagram-2\" width=\"100%\" xmlns=\"http://www.w3.org/2000/svg\" class=\"flowchart\" style=\"\" viewBox=\"0 0 371.265625 445.5\" role=\"graphics-document document\" aria-roledescription=\"flowchart-v2\"><style>#simplemark-diagram-2{font-family:\"trebuchet ms\",verdana,arial,sans-serif;font-size:16px;fill:#000000;}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#simplemark-diagram-2 .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#simplemark-diagram-2 .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#simplemark-diagram-2 .error-icon{fill:#552222;}#simplemark-diagram-2 .error-text{fill:#552222;stroke:#552222;}#simplemark-diagram-2 .edge-thickness-normal{stroke-width:1px;}#simplemark-diagram-2 .edge-thickness-thick{stroke-width:3.5px;}#simplemark-diagram-2 .edge-pattern-solid{stroke-dasharray:0;}#simplemark-diagram-2 .edge-thickness-invisible{stroke-width:0;fill:none;}#simplemark-diagram-2 .edge-pattern-dashed{stroke-dasharray:3;}#simplemark-diagram-2 .edge-pattern-dotted{stroke-dasharray:2;}#simplemark-diagram-2 .marker{fill:#666;stroke:#666;}#simplemark-diagram-2 .marker.cross{stroke:#666;}#simplemark-diagram-2 svg{font-family:\"trebuchet ms\",verdana,arial,sans-serif;font-size:16px;}#simplemark-diagram-2 p{margin:0;}#simplemark-diagram-2 .label{font-family:\"trebuchet ms\",verdana,arial,sans-serif;color:#000000;}#simplemark-diagram-2 .cluster-label text{fill:#333;}#simplemark-diagram-2 .cluster-label span{color:#333;}#simplemark-diagram-2 .cluster-label span p{background-color:transparent;}#simplemark-diagram-2 .label text,#simplemark-diagram-2 span{fill:#000000;color:#000000;}#simplemark-diagram-2 .node rect,#simplemark-diagram-2 .node circle,#simplemark-diagram-2 .node ellipse,#simplemark-diagram-2 .node polygon,#simplemark-diagram-2 .node path{fill:#eee;stroke:#999;stroke-width:1px;}#simplemark-diagram-2 .rough-node .label text,#simplemark-diagram-2 .node .label text,#simplemark-diagram-2 .image-shape .label,#simplemark-diagram-2 .icon-shape .label{text-anchor:middle;}#simplemark-diagram-2 .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#simplemark-diagram-2 .rough-node .label,#simplemark-diagram-2 .node .label,#simplemark-diagram-2 .image-shape .label,#simplemark-diagram-2 .icon-shape .label{text-align:center;}#simplemark-diagram-2 .node.clickable{cursor:pointer;}#simplemark-diagram-2 .root .anchor path{fill:#666!important;stroke-width:0;stroke:#666;}#simplemark-diagram-2 .arrowheadPath{fill:#333333;}#simplemark-diagram-2 .edgePath .path{stroke:#666;stroke-width:1px;}#simplemark-diagram-2 .flowchart-link{stroke:#666;fill:none;}#simplemark-diagram-2 .edgeLabel{background-color:white;text-align:center;}#simplemark-diagram-2 .edgeLabel p{background-color:white;}#simplemark-diagram-2 .edgeLabel rect{opacity:0.5;background-color:white;fill:white;}#simplemark-diagram-2 .labelBkg{background-color:rgba(255, 255, 255, 0.5);}#simplemark-diagram-2 .cluster rect{fill:hsl(0, 0%, 98.9215686275%);stroke:#707070;stroke-width:1px;}#simplemark-diagram-2 .cluster text{fill:#333;}#simplemark-diagram-2 .cluster span{color:#333;}#simplemark-diagram-2 div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:\"trebuchet ms\",verdana,arial,sans-serif;font-size:12px;background:hsl(-160, 0%, 93.3333333333%);border:1px solid #707070;border-radius:2px;pointer-events:none;z-index:100;}#simplemark-diagram-2 .flowchartTitleText{text-anchor:middle;font-size:18px;fill:#000000;}#simplemark-diagram-2 rect.text{fill:none;stroke-width:0;}#simplemark-diagram-2 .icon-shape,#simplemark-diagram-2 .image-shape{background-color:white;text-align:center;}#simplemark-diagram-2 .icon-shape p,#simplemark-diagram-2 .image-shape p{background-color:white;padding:2px;}#simplemark-diagram-2 .icon-shape .label rect,#simplemark-diagram-2 .image-shape .label rect{opacity:0.5;background-color:white;fill:white;}#simplemark-diagram-2 .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#simplemark-diagram-2 .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#simplemark-diagram-2 .node .neo-node{stroke:#999;}#simplemark-diagram-2 [data-look=\"neo\"].node rect,#simplemark-diagram-2 [data-look=\"neo\"].cluster rect,#simplemark-diagram-2 [data-look=\"neo\"].node polygon{stroke:url(#simplemark-diagram-2-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#simplemark-diagram-2 [data-look=\"neo\"].swimlane.cluster rect{filter:none;}#simplemark-diagram-2 [data-look=\"neo\"].node path{stroke:url(#simplemark-diagram-2-gradient);stroke-width:1px;}#simplemark-diagram-2 [data-look=\"neo\"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#simplemark-diagram-2 [data-look=\"neo\"].node .neo-line path{stroke:#999;filter:none;}#simplemark-diagram-2 [data-look=\"neo\"].node circle{stroke:url(#simplemark-diagram-2-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#simplemark-diagram-2 [data-look=\"neo\"].node circle .state-start{fill:#000000;}#simplemark-diagram-2 [data-look=\"neo\"].icon-shape .icon{fill:url(#simplemark-diagram-2-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#simplemark-diagram-2 [data-look=\"neo\"].icon-shape .icon-neo path{stroke:url(#simplemark-diagram-2-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#simplemark-diagram-2 :root{--mermaid-font-family:\"trebuchet ms\",verdana,arial,sans-serif;}</style><g><marker id=\"simplemark-diagram-2_flowchart-v2-pointEnd\" class=\"marker flowchart-v2\" viewBox=\"0 0 10 10\" refX=\"5\" refY=\"5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"8\" markerHeight=\"8\" orient=\"auto\"><path d=\"M 0 0 L 10 5 L 0 10 z\" class=\"arrowMarkerPath\" style=\"stroke-width: 1; stroke-dasharray: 1, 0;\"></path></marker><marker id=\"simplemark-diagram-2_flowchart-v2-pointStart\" class=\"marker flowchart-v2\" viewBox=\"0 0 10 10\" refX=\"4.5\" refY=\"5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"8\" markerHeight=\"8\" orient=\"auto\"><path d=\"M 0 5 L 10 10 L 10 0 z\" class=\"arrowMarkerPath\" style=\"stroke-width: 1; stroke-dasharray: 1, 0;\"></path></marker><marker id=\"simplemark-diagram-2_flowchart-v2-pointEnd-margin\" class=\"marker flowchart-v2\" viewBox=\"0 0 11.5 14\" refX=\"11.5\" refY=\"7\" markerUnits=\"userSpaceOnUse\" markerWidth=\"10.5\" markerHeight=\"14\" orient=\"auto\"><path d=\"M 0 0 L 11.5 7 L 0 14 z\" class=\"arrowMarkerPath\" style=\"stroke-width: 0; stroke-dasharray: 1, 0;\"></path></marker><marker id=\"simplemark-diagram-2_flowchart-v2-pointStart-margin\" class=\"marker flowchart-v2\" viewBox=\"0 0 11.5 14\" refX=\"1\" refY=\"7\" markerUnits=\"userSpaceOnUse\" markerWidth=\"11.5\" markerHeight=\"14\" orient=\"auto\"><polygon points=\"0,7 11.5,14 11.5,0\" class=\"arrowMarkerPath\" style=\"stroke-width: 0; stroke-dasharray: 1, 0;\"></polygon></marker><marker id=\"simplemark-diagram-2_flowchart-v2-circleEnd\" class=\"marker flowchart-v2\" viewBox=\"0 0 10 10\" refX=\"11\" refY=\"5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"11\" markerHeight=\"11\" orient=\"auto\"><circle cx=\"5\" cy=\"5\" r=\"5\" class=\"arrowMarkerPath\" style=\"stroke-width: 1; stroke-dasharray: 1, 0;\"></circle></marker><marker id=\"simplemark-diagram-2_flowchart-v2-circleStart\" class=\"marker flowchart-v2\" viewBox=\"0 0 10 10\" refX=\"-1\" refY=\"5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"11\" markerHeight=\"11\" orient=\"auto\"><circle cx=\"5\" cy=\"5\" r=\"5\" class=\"arrowMarkerPath\" style=\"stroke-width: 1; stroke-dasharray: 1, 0;\"></circle></marker><marker id=\"simplemark-diagram-2_flowchart-v2-circleEnd-margin\" class=\"marker flowchart-v2\" viewBox=\"0 0 10 10\" refY=\"5\" refX=\"12.25\" markerUnits=\"userSpaceOnUse\" markerWidth=\"14\" markerHeight=\"14\" orient=\"auto\"><circle cx=\"5\" cy=\"5\" r=\"5\" class=\"arrowMarkerPath\" style=\"stroke-width: 0; stroke-dasharray: 1, 0;\"></circle></marker><marker id=\"simplemark-diagram-2_flowchart-v2-circleStart-margin\" class=\"marker flowchart-v2\" viewBox=\"0 0 10 10\" refX=\"-2\" refY=\"5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"14\" markerHeight=\"14\" orient=\"auto\"><circle cx=\"5\" cy=\"5\" r=\"5\" class=\"arrowMarkerPath\" style=\"stroke-width: 0; stroke-dasharray: 1, 0;\"></circle></marker><marker id=\"simplemark-diagram-2_flowchart-v2-crossEnd\" class=\"marker cross flowchart-v2\" viewBox=\"0 0 11 11\" refX=\"12\" refY=\"5.2\" markerUnits=\"userSpaceOnUse\" markerWidth=\"11\" markerHeight=\"11\" orient=\"auto\"><path d=\"M 1,1 l 9,9 M 10,1 l -9,9\" class=\"arrowMarkerPath\" style=\"stroke-width: 2; stroke-dasharray: 1, 0;\"></path></marker><marker id=\"simplemark-diagram-2_flowchart-v2-crossStart\" class=\"marker cross flowchart-v2\" viewBox=\"0 0 11 11\" refX=\"-1\" refY=\"5.2\" markerUnits=\"userSpaceOnUse\" markerWidth=\"11\" markerHeight=\"11\" orient=\"auto\"><path d=\"M 1,1 l 9,9 M 10,1 l -9,9\" class=\"arrowMarkerPath\" style=\"stroke-width: 2; stroke-dasharray: 1, 0;\"></path></marker><marker id=\"simplemark-diagram-2_flowchart-v2-crossEnd-margin\" class=\"marker cross flowchart-v2\" viewBox=\"0 0 15 15\" refX=\"17.7\" refY=\"7.5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"12\" markerHeight=\"12\" orient=\"auto\"><path d=\"M 1,1 L 14,14 M 1,14 L 14,1\" class=\"arrowMarkerPath\" style=\"stroke-width: 2.5;\"></path></marker><marker id=\"simplemark-diagram-2_flowchart-v2-crossStart-margin\" class=\"marker cross flowchart-v2\" viewBox=\"0 0 15 15\" refX=\"-3.5\" refY=\"7.5\" markerUnits=\"userSpaceOnUse\" markerWidth=\"12\" markerHeight=\"12\" orient=\"auto\"><path d=\"M 1,1 L 14,14 M 1,14 L 14,1\" class=\"arrowMarkerPath\" style=\"stroke-width: 2.5; stroke-dasharray: 1, 0;\"></path></marker><g class=\"root\"><g class=\"clusters\"></g><g class=\"edgePaths\"><path d=\"M177.238,62L177.238,66.167C177.238,70.333,177.238,78.667,177.238,86.333C177.238,94,177.238,101,177.238,104.5L177.238,108\" id=\"simplemark-diagram-2-L_A_B_0\" class=\"edge-thickness-normal edge-pattern-solid edge-thickness-normal edge-pattern-solid flowchart-link\" style=\";\" data-edge=\"true\" data-et=\"edge\" data-id=\"L_A_B_0\" data-points=\"W3sieCI6MTc3LjIzODI4MTI1LCJ5Ijo2Mn0seyJ4IjoxNzcuMjM4MjgxMjUsInkiOjg3fSx7IngiOjE3Ny4yMzgyODEyNSwieSI6MTEyfV0=\" data-look=\"classic\" marker-end=\"url(#simplemark-diagram-2_flowchart-v2-pointEnd)\"></path><path d=\"M135.035,267.297L125.183,280.497C115.331,293.698,95.626,320.099,85.774,338.799C75.922,357.5,75.922,368.5,75.922,374L75.922,379.5\" id=\"simplemark-diagram-2-L_B_C_0\" class=\"edge-thickness-normal edge-pattern-solid edge-thickness-normal edge-pattern-solid flowchart-link\" style=\";\" data-edge=\"true\" data-et=\"edge\" data-id=\"L_B_C_0\" data-points=\"W3sieCI6MTM1LjAzNDkzNzE1MTM5ODk0LCJ5IjoyNjcuMjk2NjU1OTAxMzk4OTR9LHsieCI6NzUuOTIxODc1LCJ5IjozNDYuNX0seyJ4Ijo3NS45MjE4NzUsInkiOjM4My41fV0=\" data-look=\"classic\" marker-end=\"url(#simplemark-diagram-2_flowchart-v2-pointEnd)\"></path><path d=\"M219.442,267.297L229.294,280.497C239.146,293.698,258.85,320.099,268.703,338.799C278.555,357.5,278.555,368.5,278.555,374L278.555,379.5\" id=\"simplemark-diagram-2-L_B_D_0\" class=\"edge-thickness-normal edge-pattern-solid edge-thickness-normal edge-pattern-solid flowchart-link\" style=\";\" data-edge=\"true\" data-et=\"edge\" data-id=\"L_B_D_0\" data-points=\"W3sieCI6MjE5LjQ0MTYyNTM0ODYwMTA2LCJ5IjoyNjcuMjk2NjU1OTAxMzk4OTR9LHsieCI6Mjc4LjU1NDY4NzUsInkiOjM0Ni41fSx7IngiOjI3OC41NTQ2ODc1LCJ5IjozODMuNX1d\" data-look=\"classic\" marker-end=\"url(#simplemark-diagram-2_flowchart-v2-pointEnd)\"></path></g><g class=\"edgeLabels\"><g class=\"edgeLabel\"><g class=\"label\" data-id=\"L_A_B_0\" transform=\"translate(0, 0)\"><foreignObject width=\"0\" height=\"0\"><div xmlns=\"http://www.w3.org/1999/xhtml\" class=\"labelBkg\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"edgeLabel\"></span></div></foreignObject></g></g><g class=\"edgeLabel\" transform=\"translate(75.921875, 346.5)\"><g class=\"label\" data-id=\"L_B_C_0\" transform=\"translate(-11.546875, -12)\"><foreignObject width=\"23.09375\" height=\"24\"><div xmlns=\"http://www.w3.org/1999/xhtml\" class=\"labelBkg\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"edgeLabel\"><p>yes</p></span></div></foreignObject></g></g><g class=\"edgeLabel\" transform=\"translate(278.5546875, 346.5)\"><g class=\"label\" data-id=\"L_B_D_0\" transform=\"translate(-8.6640625, -12)\"><foreignObject width=\"17.328125\" height=\"24\"><div xmlns=\"http://www.w3.org/1999/xhtml\" class=\"labelBkg\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"edgeLabel\"><p>no</p></span></div></foreignObject></g></g></g><g class=\"nodes\"><g class=\"node default\" id=\"simplemark-diagram-2-flowchart-A-0\" data-look=\"classic\" transform=\"translate(177.23828125, 35)\"><rect class=\"basic label-container\" style=\"\" x=\"-64.40625\" y=\"-27\" width=\"128.8125\" height=\"54\"></rect><g class=\"label\" style=\"\" transform=\"translate(-34.40625, -12)\"><rect></rect><foreignObject width=\"68.8125\" height=\"24\"><div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"nodeLabel\"><p>Clipboard</p></span></div></foreignObject></g></g><g class=\"node default\" id=\"simplemark-diagram-2-flowchart-B-1\" data-look=\"classic\" transform=\"translate(177.23828125, 210.75)\"><polygon points=\"98.75,0 197.5,-98.75 98.75,-197.5 0,-98.75\" class=\"label-container\" transform=\"translate(-98.25, 98.75)\"></polygon><g class=\"label\" style=\"\" transform=\"translate(-71.75, -12)\"><rect></rect><foreignObject width=\"143.5\" height=\"24\"><div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"nodeLabel\"><p>HTML has structure?</p></span></div></foreignObject></g></g><g class=\"node default\" id=\"simplemark-diagram-2-flowchart-C-3\" data-look=\"classic\" transform=\"translate(75.921875, 410.5)\"><rect class=\"basic label-container\" style=\"\" x=\"-67.921875\" y=\"-27\" width=\"135.84375\" height=\"54\"></rect><g class=\"label\" style=\"\" transform=\"translate(-37.921875, -12)\"><rect></rect><foreignObject width=\"75.84375\" height=\"24\"><div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"nodeLabel\"><p>HTML path</p></span></div></foreignObject></g></g><g class=\"node default\" id=\"simplemark-diagram-2-flowchart-D-5\" data-look=\"classic\" transform=\"translate(278.5546875, 410.5)\"><rect class=\"basic label-container\" style=\"\" x=\"-84.7109375\" y=\"-27\" width=\"169.421875\" height=\"54\"></rect><g class=\"label\" style=\"\" transform=\"translate(-54.7109375, -12)\"><rect></rect><foreignObject width=\"109.421875\" height=\"24\"><div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;\"><span class=\"nodeLabel\"><p>Markdown path</p></span></div></foreignObject></g></g></g></g></g><defs><filter id=\"simplemark-diagram-2-drop-shadow\" height=\"130%\" width=\"130%\"><feDropShadow dx=\"4\" dy=\"4\" stdDeviation=\"0\" flood-opacity=\"0.06\" flood-color=\"#000000\"></feDropShadow></filter></defs><defs><filter id=\"simplemark-diagram-2-drop-shadow-small\" height=\"150%\" width=\"150%\"><feDropShadow dx=\"2\" dy=\"2\" stdDeviation=\"0\" flood-opacity=\"0.06\" flood-color=\"#000000\"></feDropShadow></filter></defs><linearGradient id=\"simplemark-diagram-2-gradient\" gradientUnits=\"objectBoundingBox\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"0%\"><stop offset=\"0%\" stop-color=\"hsl(0, 0%, 83.3333333333%)\" stop-opacity=\"1\"></stop><stop offset=\"100%\" stop-color=\"hsl(0, 0%, 88.9215686275%)\" stop-opacity=\"1\"></stop></linearGradient></svg></div>\n<p>Both branches end in the same document.</p>",
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
