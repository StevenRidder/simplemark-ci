import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Selection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

import type { ClipboardPort, DiagramFixPort, DiagramRenderer, RenderedDiagram } from '../../application/index.js'

/** CSS absolute lengths, in px. The relative ones cannot be resolved here. */
const CSS_UNITS: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}

/**
 * The drawing's natural width **in CSS pixels**.
 *
 * The unit is the whole point: this gets compared against a container's
 * `clientWidth` and written back as a pixel length, so anything else silently
 * scales the answer. Graphviz reports `width="445pt"` — 593px, not 445 — so
 * reading the viewBox alone made its diagrams cross the "too wide" line a third
 * too early and then draw at three-quarters of their intended size. Mermaid and
 * Vega happen to speak px, which is what made that easy to miss.
 *
 * The `width` attribute wins when it carries an absolute length. A percentage
 * (Mermaid writes `width="100%"`) describes the container rather than the
 * drawing, so the viewBox answers instead — its user units are px by
 * construction once no other scaling applies.
 */
export function naturalWidth(svg: SVGElement): number | undefined {
  const attribute = svg.getAttribute('width')?.trim() ?? ''
  const match = /^([\d.]+)\s*([a-z]*)$/i.exec(attribute)
  if (match !== null) {
    const value = Number(match[1])
    const scale = CSS_UNITS[(match[2] ?? '').toLowerCase() || 'px']
    if (Number.isFinite(value) && value > 0 && scale !== undefined) return value * scale
  }

  const viewBox = svg.getAttribute('viewBox')
  if (viewBox !== null) {
    const width = Number(viewBox.split(/[\s,]+/)[2])
    if (Number.isFinite(width) && width > 0) return width
  }
  return undefined
}

/** One pasteable block: language, error, and source together (diagram-error Copy button). */
export function formatDiagramErrorForCopy(language: string, source: string, errorMessage: string): string {
  return `Diagram type: ${language}\nError: ${errorMessage}\n\nSource:\n\`\`\`${language}\n${source}\n\`\`\`\n`
}

/**
 * NodeView for a fenced code block whose language this renderer claims.
 *
 * The block renders as a picture and reveals its source on click — one frame,
 * shared by every extension-rendered block, so a future third-party block is
 * indistinguishable from a built-in (DESIGN.md §10.2).
 *
 * The source is a plain textarea, deliberately. DESIGN.md §4.5 makes CodeMirror
 * an optimisation only *after* the editing behaviour passes, not a prerequisite:
 * a nested editor brings its own selection, focus, and undo problems that
 * ProseMirror cannot infer.
 *
 * `stopEvent` and `ignoreMutation` are the load-bearing pair. Without them,
 * typing in the textarea churns the outer selection and ProseMirror tries to
 * reconcile DOM it does not own.
 */
export class DiagramNodeView implements NodeView {
  readonly dom: HTMLElement
  #node: ProseNode
  #showingSource = false
  /** Guards against an out-of-order async render overwriting a newer one. */
  #renderToken = 0
  /**
   * The diagram's own last render failure, kept separate from whatever text
   * `#errorMessage` happens to be showing. A transport/auth failure overwrites
   * that DOM element with its own message, and `#runFix` must not re-seed a
   * later retry's prompt from that stale API-error text.
   */
  #lastRenderError: string | undefined = undefined
  /** The block's own context menu, while it is open. */
  #menu: HTMLElement | undefined

  readonly #render: HTMLElement
  readonly #sheet: HTMLElement
  readonly #sheetHeader: HTMLElement
  readonly #textarea: HTMLTextAreaElement
  readonly #error: HTMLElement
  readonly #errorMessage: HTMLElement
  readonly #copyButton: HTMLButtonElement
  readonly #fixButton: HTMLButtonElement
  readonly #toggle: HTMLButtonElement
  readonly #close: HTMLButtonElement

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: DiagramRenderer,
    /** Backs the diagram-error box's Copy button. Absent hides that button. */
    private readonly clipboard?: ClipboardPort,
    /** Backs the diagram-error box's Fix it button. Absent hides that button. */
    private readonly diagramFix?: DiagramFixPort,
  ) {
    this.#node = node

    this.dom = document.createElement('figure')
    this.dom.className = 'diagram'

    const label = document.createElement('span')
    label.className = 'diagram-label'
    label.textContent = node.attrs['language'] ?? 'diagram'

    this.#toggle = document.createElement('button')
    this.#toggle.className = 'edit-source'
    this.#toggle.type = 'button'
    this.#toggle.textContent = 'Edit source'
    this.#toggle.addEventListener('click', (event) => {
      event.preventDefault()
      this.#setShowingSource(!this.#showingSource)
    })

    this.#render = document.createElement('div')
    this.#render.className = 'diagram-render'

    this.#sheet = document.createElement('section')
    this.#sheet.className = 'diagram-source-sheet'
    this.#sheet.hidden = true
    this.#sheet.setAttribute('aria-label', 'Diagram source editor')

    this.#sheetHeader = document.createElement('header')
    this.#sheetHeader.className = 'diagram-source-header'

    const sheetTitle = document.createElement('span')
    sheetTitle.className = 'diagram-source-title'
    sheetTitle.textContent = `${label.textContent} source`

    // The sheet is `position: fixed` on <body>, so once it is dragged — or the
    // block scrolls away — the figure's own Done button is no longer anywhere
    // near it. Without this the sheet has no visible way out at all.
    this.#close = document.createElement('button')
    this.#close.className = 'diagram-source-close'
    this.#close.type = 'button'
    this.#close.textContent = '✕'
    this.#close.title = 'Close (Esc)'
    this.#close.setAttribute('aria-label', 'Close source editor')
    this.#close.addEventListener('click', (event) => {
      event.preventDefault()
      this.#setShowingSource(false)
    })

    this.#sheetHeader.append(sheetTitle, this.#close)

    this.#textarea = document.createElement('textarea')
    this.#textarea.className = 'diagram-source'
    this.#textarea.spellcheck = false
    this.#textarea.value = node.textContent
    this.#textarea.addEventListener('input', () => this.#commitSource())

    this.#error = document.createElement('div')
    this.#error.className = 'diagram-error'
    this.#error.hidden = true

    const actions = document.createElement('div')
    actions.className = 'diagram-error-actions'

    this.#copyButton = document.createElement('button')
    this.#copyButton.type = 'button'
    this.#copyButton.className = 'diagram-error-copy'
    this.#copyButton.textContent = 'Copy'
    this.#copyButton.hidden = this.clipboard === undefined
    this.#copyButton.addEventListener('click', (event) => {
      event.preventDefault()
      void this.#copyError()
    })

    this.#fixButton = document.createElement('button')
    this.#fixButton.type = 'button'
    this.#fixButton.className = 'diagram-error-fix'
    this.#fixButton.textContent = 'Fix it'
    this.#fixButton.hidden = this.diagramFix === undefined
    this.#fixButton.addEventListener('click', (event) => {
      event.preventDefault()
      void this.#runFix()
    })

    this.#errorMessage = document.createElement('div')
    this.#errorMessage.className = 'diagram-error-message'

    actions.append(this.#copyButton, this.#fixButton)
    this.#error.append(actions, this.#errorMessage)

    this.#sheet.append(this.#sheetHeader, this.#textarea)
    document.body.append(this.#sheet)
    this.dom.append(label, this.#toggle, this.#render, this.#error)

    // A click anywhere on the figure selects the block. The Edit-source button
    // and the source sheet are excluded — `stopEvent` already treats those as
    // ours, and selecting the block from them would fight the textarea.
    this.dom.addEventListener('click', (event) => {
      if (this.#toggle.contains(event.target as Node)) return
      if (this.#sheet.contains(event.target as Node)) return
      this.#selectBlock()
    })
    this.dom.addEventListener('contextmenu', this.#openMenu)
    this.#sheetHeader.addEventListener('pointerdown', this.#beginDrag)

    // A rendered diagram bakes its colours into the SVG, so it does not follow
    // the theme the way CSS does. Without this, switching the system appearance
    // leaves a light diagram stranded on dark paper.
    this.#scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
    this.#onSchemeChange = () => void this.#paint()
    this.#scheme?.addEventListener('change', this.#onSchemeChange)

    // Fit-or-scroll is a question about the column, not the diagram, so it has
    // to be answered again whenever the column changes: opening the sidebar,
    // resizing the window, changing text size. It also answers the first one —
    // the initial paint runs before layout, when there is no width to measure.
    this.#resize = new ResizeObserver(() => this.#fitDiagram())
    this.#resize.observe(this.#render)

    void this.#paint()
  }

  readonly #scheme: MediaQueryList | undefined
  readonly #onSchemeChange: () => void
  readonly #resize: ResizeObserver

  /**
   * Document-scoped, and only while the sheet is open.
   *
   * This was bound to the textarea, so dragging the header moved focus off it
   * and Escape stopped working from that moment on — precisely when it matters
   * most, since a dragged sheet has left its figure's Done button behind.
   */
  readonly #onEscape = (event: KeyboardEvent): void => {
    if (!this.#showingSource || event.key !== 'Escape') return
    event.preventDefault()
    this.#setShowingSource(false)
  }

  #setShowingSource(showing: boolean): void {
    this.#showingSource = showing
    this.#sheet.hidden = !showing
    this.#toggle.textContent = showing ? 'Done' : 'Edit source'
    if (showing) {
      document.addEventListener('keydown', this.#onEscape)
      this.#placeSheet()
      this.#textarea.focus()
      return
    }
    document.removeEventListener('keydown', this.#onEscape)
    this.#focusAfterBlock()
  }

  readonly #beginDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return
    // The close button lives in the drag handle; a press on it must close the
    // sheet, not start dragging it out from under the pointer.
    if (this.#close.contains(event.target as Node)) return
    event.preventDefault()
    const rect = this.#sheet.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    const move = (moveEvent: PointerEvent): void => {
      const next = this.#boundedSheetPosition(
        moveEvent.clientX - offsetX,
        moveEvent.clientY - offsetY,
      )
      this.#sheet.style.left = `${next.left}px`
      this.#sheet.style.top = `${next.top}px`
      this.#sheet.dataset['positioned'] = 'true'
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  #placeSheet(): void {
    if (this.#sheet.dataset['positioned'] === 'true') return
    const rect = this.#sheet.getBoundingClientRect()
    const next = this.#boundedSheetPosition((window.innerWidth - rect.width) / 2, 112)
    this.#sheet.style.left = `${next.left}px`
    this.#sheet.style.top = `${next.top}px`
    this.#sheet.dataset['positioned'] = 'true'
  }

  #boundedSheetPosition(left: number, top: number): { left: number; top: number } {
    const rect = this.#sheet.getBoundingClientRect()
    return {
      left: Math.max(12, Math.min(left, window.innerWidth - rect.width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - rect.height - 12)),
    }
  }

  #focusAfterBlock(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const after = pos + this.#node.nodeSize
    const { state } = this.view
    this.view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(after), 1)).scrollIntoView())
    this.view.focus()
  }

  /**
   * Puts a real selection on the block.
   *
   * Without it there was no way to remove a diagram at all: the NodeView has
   * no `contentDOM`, so a click landed outside the editor content and
   * Backspace had nothing to act on. A `NodeSelection` is the whole fix —
   * ProseMirror deletes one on Backspace and Delete with no keymap of ours.
   */
  readonly #selectBlock = (): boolean => {
    const pos = this.getPos()
    if (pos === undefined) return false
    const { state } = this.view
    if (state.doc.nodeAt(pos) === null) return false
    this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    this.view.focus()
    return true
  }

  /**
   * The block's own context menu.
   *
   * `.note-context-menu` is the sidebar's menu styling, reused so this looks
   * like the rest of the app rather than a second kind of menu. Both actions
   * already exist — this is an affordance for them, not new behaviour.
   */
  readonly #openMenu = (event: MouseEvent): void => {
    if (this.#sheet.contains(event.target as Node)) return
    event.preventDefault()
    if (!this.#selectBlock()) return
    this.#closeMenu()

    const menu = document.createElement('div')
    menu.className = 'note-context-menu diagram-context-menu'
    menu.style.left = `${event.clientX}px`
    menu.style.top = `${event.clientY}px`

    const item = (text: string, run: () => void): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'note-context-row'
      button.textContent = text
      button.addEventListener('click', () => {
        this.#closeMenu()
        run()
      })
      return button
    }

    menu.append(
      item('Edit source', () => this.#setShowingSource(true)),
      item('Delete', () => this.#deleteBlock()),
    )
    document.body.append(menu)
    this.#menu = menu

    // Any click or Escape outside dismisses it. Deferred by a tick so the
    // right-click that opened it does not immediately close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', this.#onOutsidePress)
      document.addEventListener('keydown', this.#onMenuEscape)
    }, 0)
  }

  readonly #closeMenu = (): void => {
    this.#menu?.remove()
    this.#menu = undefined
    document.removeEventListener('pointerdown', this.#onOutsidePress)
    document.removeEventListener('keydown', this.#onMenuEscape)
  }

  // A pointerdown on the menu's own buttons bubbles to document too, so
  // closing unconditionally there would remove the menu before its click ever
  // fires — Delete and Edit source would silently do nothing.
  readonly #onOutsidePress = (event: PointerEvent): void => {
    if (this.#menu?.contains(event.target as Node) === true) return
    this.#closeMenu()
  }

  readonly #onMenuEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.#closeMenu()
  }

  /** Selects the block, then removes it. */
  #deleteBlock(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const { state } = this.view
    const node = state.doc.nodeAt(pos)
    if (node === null) return
    this.view.dispatch(state.tr.delete(pos, pos + node.nodeSize))
    this.view.focus()
  }

  /** Writes text back through ProseMirror, never into the DOM. Does not repaint. */
  #writeSource(text: string): void {
    const pos = this.getPos()
    if (pos === undefined) return

    const { state, dispatch } = this.view
    const from = pos + 1
    const to = pos + this.#node.nodeSize - 1

    const transaction = state.tr.replaceWith(
      from,
      to,
      text === '' ? [] : state.schema.text(text),
    )
    dispatch(transaction)
  }

  /** The textarea's own edit path: write, then repaint without waiting. */
  #commitSource(): void {
    this.#writeSource(this.#textarea.value)
    void this.#paint()
  }

  /**
   * How much narrower than its natural width a diagram may be squeezed before
   * scrolling beats shrinking.
   *
   * Both engines size their text in absolute units, so scaling the SVG scales
   * the labels with it. A dense graph forced into the measure ends up with
   * unreadable type — the diagram is still "visible" and no longer says
   * anything. Past this ratio the figure keeps the diagram legible and scrolls
   * inside itself instead. The page must never scroll sideways to read a note.
   */
  static readonly #WIDEST_SQUEEZE = 1.6

  /**
   * Decides between filling the column and keeping natural size.
   *
   * Graphviz and Vega both emit a `viewBox`, which is what makes stretching
   * safe: the drawing scales rather than being cropped or letterboxed. The
   * default without this was `max-width: 100%`, which can only ever shrink — so
   * a small graph sat at its natural 445pt in a 660px column, surrounded by
   * air, and looked like a rendering bug rather than a diagram.
   */
  #fitDiagram(): void {
    const svg = this.#render.querySelector('svg')
    if (svg === null) return

    // Mermaid writes `style="max-width: 567px"` onto its own root, which is an
    // inline declaration and therefore beats the stylesheet outright. That cap
    // is the whole reason a Mermaid diagram never grew to meet its column, and
    // no amount of CSS below can answer it. Sizing belongs to one place, so the
    // renderer's opinion is removed rather than fought.
    svg.style.removeProperty('max-width')

    const available = this.#render.clientWidth
    const natural = naturalWidth(svg)
    // Before layout there is nothing to compare against. The ResizeObserver
    // below calls back the moment a width exists, so this returns rather than
    // guessing — the first paint almost always lands here.
    if (available === 0 || natural === undefined) return

    const wide = natural > available * DiagramNodeView.#WIDEST_SQUEEZE
    this.#render.classList.toggle('is-wide', wide)

    // `width: auto` is not enough to restore natural size. Mermaid writes
    // `width="100%"` as an *attribute*, which an `auto` computed width defers
    // to — so the diagram obediently shrank back into the column and the
    // scrolling had nothing to scroll. Only an explicit length overrides it.
    if (wide) {
      svg.style.width = `${natural}px`
    } else {
      svg.style.removeProperty('width')
    }
  }

  static readonly #MAX_FIX_ATTEMPTS = 3

  /** Set in `destroy()`; stops the fix-it loop from writing into a torn-down block. */
  #destroyed = false

  async #copyError(): Promise<void> {
    if (this.clipboard === undefined) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const text = formatDiagramErrorForCopy(language, this.#textarea.value, this.#errorMessage.textContent ?? '')
    const ok = await this.clipboard.write({ 'text/plain': text })
    this.#copyButton.textContent = ok ? 'Copied' : 'Copy failed'
    window.setTimeout(() => {
      if (this.#destroyed) return
      this.#copyButton.textContent = 'Copy'
    }, 1500)
  }

  async #runFix(): Promise<void> {
    if (this.diagramFix === undefined) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'

    this.#fixButton.disabled = true
    this.#copyButton.disabled = true
    let errorMessage = this.#lastRenderError ?? ''

    for (let attempt = 1; attempt <= DiagramNodeView.#MAX_FIX_ATTEMPTS; attempt += 1) {
      if (this.#destroyed) return
      this.#fixButton.textContent = `Fixing… (${attempt}/${DiagramNodeView.#MAX_FIX_ATTEMPTS})`

      const outcome = await this.diagramFix.fix(language, this.#textarea.value, errorMessage)
      if (this.#destroyed) return

      if (!outcome.ok) {
        // A transport/auth failure, not a syntax error the model could retry.
        // Stop immediately rather than spending the remaining attempts on a
        // request that cannot succeed.
        this.#errorMessage.textContent = outcome.message
        break
      }

      this.#textarea.value = outcome.source
      this.#writeSource(outcome.source)
      const rendered = await this.#paint()
      if (this.#destroyed) return

      if (rendered.ok) {
        this.#fixButton.disabled = false
        this.#copyButton.disabled = false
        this.#fixButton.textContent = 'Fix it'
        return
      }

      errorMessage = rendered.message
      if (attempt === DiagramNodeView.#MAX_FIX_ATTEMPTS) {
        this.#errorMessage.textContent =
          `Couldn't auto-fix after ${DiagramNodeView.#MAX_FIX_ATTEMPTS} attempts. Last error: ${rendered.message}`
      }
    }

    this.#fixButton.disabled = false
    this.#copyButton.disabled = false
    this.#fixButton.textContent = 'Fix it'
  }

  /** Renders the node's current content and paints the result. Returns it so callers — the fix-it loop — can inspect success without a second render. */
  async #paint(): Promise<RenderedDiagram> {
    const token = (this.#renderToken += 1)
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    // A renderer that *throws* is a crash, not the `{ok: false}` a parser
    // returns for source it can read but not draw. Every caller invokes this as
    // `void this.#paint()`, so without this the rejection went nowhere: the
    // block kept the previous picture and reported nothing.
    let result: RenderedDiagram
    try {
      result = await this.renderer.render(language, this.#node.textContent)
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    if (token !== this.#renderToken) return result

    if (result.ok) {
      this.#render.innerHTML = result.markup
      this.#error.hidden = true
      this.#fitDiagram()
      return result
    }

    // Fail visibly and locally: keep the source reachable and show the parser's
    // own message rather than an empty frame.
    this.#render.replaceChildren()
    this.#error.hidden = false
    this.#errorMessage.textContent = result.message
    this.#lastRenderError = result.message
    return result
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    if (this.#textarea.value !== node.textContent && document.activeElement !== this.#textarea) {
      // Refresh source without recreating the NodeView or stealing focus.
      this.#textarea.value = node.textContent
    }
    void this.#paint()
    return true
  }

  /** ProseMirror tells us when the block is the selection; show it. */
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }

  /** Inner control activity is ours, not ProseMirror's. */
  stopEvent(event: Event): boolean {
    return (
      event.target === this.#toggle ||
      event.target === this.#copyButton ||
      event.target === this.#fixButton ||
      this.#sheet.contains(event.target as Node)
    )
  }

  /** The rendered SVG is ours too; ProseMirror must not try to reconcile it. */
  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.#destroyed = true
    this.#renderToken += 1
    this.#scheme?.removeEventListener('change', this.#onSchemeChange)
    this.#sheetHeader.removeEventListener('pointerdown', this.#beginDrag)
    // The sheet lives on <body>, so this listener would outlive the block that
    // owns it if the node is destroyed while the sheet is open.
    document.removeEventListener('keydown', this.#onEscape)
    this.#resize.disconnect()
    this.#sheet.remove()
    // The menu lives on <body> too, so it would outlive its block just the same.
    this.#closeMenu()
    this.dom.removeEventListener('contextmenu', this.#openMenu)
  }
}
