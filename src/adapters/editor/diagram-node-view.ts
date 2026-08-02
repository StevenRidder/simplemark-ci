import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Selection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer } from '../../application/index.js'

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
    this.#sheetHeader.textContent = 'Mermaid source'

    this.#textarea = document.createElement('textarea')
    this.#textarea.className = 'diagram-source'
    this.#textarea.spellcheck = false
    this.#textarea.value = node.textContent
    this.#textarea.addEventListener('input', () => this.#commitSource())
    this.#textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.#setShowingSource(false)
      }
    })

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

    void this.#paint()
  }

  readonly #scheme: MediaQueryList | undefined
  readonly #onSchemeChange: () => void

  #setShowingSource(showing: boolean): void {
    this.#showingSource = showing
    this.#sheet.hidden = !showing
    this.#toggle.textContent = showing ? 'Done' : 'Edit source'
    if (showing) {
      this.#placeSheet()
      this.#textarea.focus()
      return
    }
    this.#focusAfterBlock()
  }

  readonly #beginDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return
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

  async #paint(): Promise<void> {
    const token = (this.#renderToken += 1)
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const result = await this.renderer.render(language, this.#node.textContent)
    if (token !== this.#renderToken) return

    if (result.ok) {
      this.#render.innerHTML = result.svg
      this.#error.hidden = true
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
    this.#sheet.remove()
  }
}
