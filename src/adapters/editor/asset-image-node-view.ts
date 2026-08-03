import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

/**
 * A calm rendered image with two important differences from the stock `img`:
 * a broken relative reference is named instead of becoming a mysterious broken
 * glyph, and the portable Markdown alt text stays directly editable.
 */
export class AssetImageNodeView implements NodeView {
  readonly dom: HTMLElement
  #node: ProseNode
  readonly #image: HTMLImageElement
  readonly #fallback: HTMLElement
  readonly #editAlt: HTMLButtonElement

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.#node = node
    this.dom = document.createElement('span')
    this.dom.className = 'asset-image'
    this.dom.contentEditable = 'false'

    this.#image = document.createElement('img')
    this.#image.addEventListener('error', () => this.#setMissing(true))
    this.#image.addEventListener('load', () => this.#setMissing(false))

    this.#fallback = document.createElement('span')
    this.#fallback.className = 'asset-image-missing'
    this.#fallback.hidden = true

    this.#editAlt = document.createElement('button')
    this.#editAlt.type = 'button'
    this.#editAlt.className = 'asset-image-edit-alt'
    this.#editAlt.textContent = 'Edit alt text'
    this.#editAlt.addEventListener('click', (event) => {
      event.preventDefault()
      this.#editAlternativeText()
    })

    this.dom.append(this.#image, this.#fallback, this.#editAlt)
    this.#paint()
  }

  #paint(): void {
    const src = String(this.#node.attrs['src'] ?? '')
    const alt = String(this.#node.attrs['alt'] ?? '')
    this.#image.src = src
    this.#image.alt = alt
    this.#image.title = alt
    this.#fallback.textContent = `File unavailable: ${src}`
  }

  #setMissing(missing: boolean): void {
    this.dom.classList.toggle('is-missing', missing)
    this.#fallback.hidden = !missing
    this.#image.hidden = missing
  }

  #editAlternativeText(): void {
    const next = window.prompt('Image alternative text', String(this.#node.attrs['alt'] ?? ''))
    if (next === null) return
    const pos = this.getPos()
    if (pos === undefined) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.#node.attrs,
      alt: next,
    }).scrollIntoView())
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    this.#setMissing(false)
    this.#paint()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target === this.#editAlt
  }

  ignoreMutation(): boolean {
    return true
  }
}
