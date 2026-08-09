/**
 * The document-level counterpart of the diagram block's error box.
 *
 * A swallowed diagram fence produces no node and no error, so there is nothing
 * for `DiagramNodeView` to attach a "Fix it" button to — the block the user
 * meant to write does not exist. This notice supplies the missing signal at the
 * document level and offers the same repair, so the failure stops being silent.
 *
 * Kept out of `MilkdownEditor` itself: it owns only its own element and calls
 * back to apply a repaired document, which keeps it testable without a Milkdown
 * instance and leaves the editor adapter free of repair logic.
 */

import { repairHiddenDiagram } from '../../application/index.js'
import type { DiagramFixPort } from '../../application/index.js'
import { findHiddenDiagramFences } from '../../domain/index.js'

export class HiddenDiagramNotice {
  readonly element: HTMLDivElement
  readonly #message: HTMLParagraphElement
  readonly #fixButton: HTMLButtonElement
  #busy = false

  #markdown = ''

  /**
   * Set when a paste arrived carrying an equal-length nesting.
   *
   * The editor's serializer immediately rewrites that to the longer-fence form,
   * which is indistinguishable from deliberately quoted source. This flag is the
   * evidence that survives the rewrite: the raw clipboard text proved the
   * nesting was a mistake, so the relaxed scan is safe for this document.
   */
  #armedByPaste = false

  constructor(
    private readonly applyMarkdown: (markdown: string) => void,
    private readonly diagramFix?: DiagramFixPort,
  ) {
    this.element = document.createElement('div')
    this.element.className = 'hidden-diagram-notice'
    this.element.hidden = true

    const actions = document.createElement('div')
    actions.className = 'hidden-diagram-notice-actions'

    this.#fixButton = document.createElement('button')
    this.#fixButton.type = 'button'
    this.#fixButton.textContent = 'Fix it'
    // Same rule as the diagram error box: no button at all without a configured model.
    this.#fixButton.hidden = diagramFix === undefined
    this.#fixButton.addEventListener('click', () => {
      void this.#runFix()
    })

    this.#message = document.createElement('p')
    this.#message.className = 'hidden-diagram-notice-message'

    actions.append(this.#fixButton)
    this.element.append(this.#message, actions)
  }

  /**
   * Re-examines the document and shows or hides the notice.
   *
   * Takes the Markdown rather than reading it back from the editor on purpose.
   * Milkdown's serializer renormalises the enclosing fence to four backticks,
   * which is byte-identical to deliberately quoted diagram source — so a
   * re-serialised document can no longer be told apart from a correct one. The
   * file's own bytes are the only place the mistake is still visible.
   */
  /** Records that a paste arrived already carrying the mistake. */
  armFromPaste(pastedText: string): void {
    if (findHiddenDiagramFences(pastedText).length === 0) return
    this.#armedByPaste = true
  }

  refresh(markdown: string): void {
    this.#markdown = markdown
    if (this.#busy) return
    const fence = findHiddenDiagramFences(markdown, this.#scanOptions())[0]
    if (fence === undefined) {
      this.element.hidden = true
      return
    }
    this.element.hidden = false
    this.#message.textContent =
      `Line ${fence.startLine}: this ${fence.language} diagram is inside a plain code fence, ` +
      `so it is stored as text instead of being drawn.`
  }

  async #runFix(): Promise<void> {
    if (this.diagramFix === undefined || this.#busy) return
    this.#busy = true
    this.#fixButton.disabled = true
    this.#fixButton.textContent = 'Fixing…'

    const result = await repairHiddenDiagram(this.#markdown, this.diagramFix, this.#scanOptions())

    this.#fixButton.disabled = false
    this.#fixButton.textContent = 'Fix it'
    this.#busy = false

    if (!result.ok) {
      this.#message.textContent = result.message
      return
    }
    this.applyMarkdown(result.markdown)
    this.#armedByPaste = false
    this.refresh(result.markdown)
  }

  #scanOptions(): { includeLongerOuterFence: boolean } {
    return { includeLongerOuterFence: this.#armedByPaste }
  }
}
