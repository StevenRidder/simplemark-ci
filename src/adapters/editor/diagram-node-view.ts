import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Selection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer } from '../../application/index.js'

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

  readonly #render: HTMLElement
  readonly #sheet: HTMLElement
  readonly #sheetHeader: HTMLElement
  readonly #textarea: HTMLTextAreaElement
  readonly #error: HTMLElement
  readonly #toggle: HTMLButtonElement
  readonly #close: HTMLButtonElement

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: DiagramRenderer,
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

    this.#sheet.append(this.#sheetHeader, this.#textarea)
    document.body.append(this.#sheet)
    this.dom.append(label, this.#toggle, this.#render, this.#error)
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

  /** Writes the textarea's content back through ProseMirror, never into the DOM. */
  #commitSource(): void {
    const pos = this.getPos()
    if (pos === undefined) return

    const { state, dispatch } = this.view
    const from = pos + 1
    const to = pos + this.#node.nodeSize - 1
    const text = this.#textarea.value

    const transaction = state.tr.replaceWith(
      from,
      to,
      text === '' ? [] : state.schema.text(text),
    )
    dispatch(transaction)
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

  async #paint(): Promise<void> {
    const token = (this.#renderToken += 1)
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const result = await this.renderer.render(language, this.#node.textContent)
    if (token !== this.#renderToken) return

    if (result.ok) {
      this.#render.innerHTML = result.markup
      this.#error.hidden = true
      this.#fitDiagram()
      return
    }

    // Fail visibly and locally: keep the source reachable and show the parser's
    // own message rather than an empty frame.
    this.#render.replaceChildren()
    this.#error.hidden = false
    this.#error.textContent = result.message
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

  /** Inner control activity is ours, not ProseMirror's. */
  stopEvent(event: Event): boolean {
    return event.target === this.#toggle || this.#sheet.contains(event.target as Node)
  }

  /** The rendered SVG is ours too; ProseMirror must not try to reconcile it. */
  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.#renderToken += 1
    this.#scheme?.removeEventListener('change', this.#onSchemeChange)
    this.#sheetHeader.removeEventListener('pointerdown', this.#beginDrag)
    // The sheet lives on <body>, so this listener would outlive the block that
    // owns it if the node is destroyed while the sheet is open.
    document.removeEventListener('keydown', this.#onEscape)
    this.#resize.disconnect()
    this.#sheet.remove()
  }
}
