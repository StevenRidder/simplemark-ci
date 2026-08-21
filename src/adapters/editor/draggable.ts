/**
 * Makes a floating panel movable by pointer.
 *
 * Every popup over the document accepts a drag: from the grip strip this adds,
 * or from any part of the panel that is neither an interactive control nor
 * selectable text. The panel must be absolutely positioned with `top`/`left`
 * against its offset parent — the drag adjusts exactly those, clamped so a
 * grabbable corner always remains inside the host and a popup cannot be lost
 * off-screen.
 *
 * Lives beside the editor adapters so both they and the app layer may use it:
 * adapters must not reach up into `app/`, and a drag behavior duplicated per
 * popup would drift per popup.
 */

/** Where a drag must not start: controls keep working, text stays selectable. */
const UNDRAGGABLE = 'button, a, input, textarea, select, [contenteditable="true"], p, blockquote, pre, ul, ol, li, h1, h2, h3, h4, h5, h6, table, code'

const EDGE_MARGIN = 8
/** The square at the bottom-right corner a CSS `resize` handle occupies. */
const RESIZE_CORNER = 18
/** How much of the panel must remain reachable inside the host. */
const KEEP_VISIBLE = 48

export interface DraggableOptions {
  /**
   * The box the drag is clamped to, when it is wider than the offset parent.
   * A margin card's offset parent is its 280px column; clamping to that would
   * let it move up and down but never aside, over the document (BUG-26).
   */
  readonly bounds?: HTMLElement
}

export function makeDraggable(panel: HTMLElement, options: DraggableOptions = {}): void {
  const grip = document.createElement('div')
  grip.className = 'sm-drag-grip'
  grip.setAttribute('aria-hidden', 'true')
  panel.prepend(grip)
  panel.classList.add('sm-draggable')

  let drag: { pointerId: number; x: number; y: number; top: number; left: number } | undefined

  panel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target !== grip && target.closest(UNDRAGGABLE) !== null) return
    // The bottom-right corner belongs to the CSS resize handle (APP-53): a
    // press there sizes the panel, and a drag that claimed it would make the
    // panel move instead — the handle never gets the pointer.
    const box = panel.getBoundingClientRect()
    if (event.clientX > box.right - RESIZE_CORNER && event.clientY > box.bottom - RESIZE_CORNER) return
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      top: panel.offsetTop,
      left: panel.offsetLeft,
    }
    panel.setPointerCapture(event.pointerId)
    panel.classList.add('sm-dragging')
    // A drag must not also start a text selection underneath it.
    event.preventDefault()
  })

  panel.addEventListener('pointermove', (event) => {
    if (drag === undefined || event.pointerId !== drag.pointerId) return
    const parent = panel.offsetParent
    // The allowed range, in the offset parent's coordinates. With `bounds`
    // given, the range is that box's, shifted by where the parent sits in it.
    let minLeft = EDGE_MARGIN
    let minTop = EDGE_MARGIN
    let maxLeft = (parent instanceof HTMLElement ? parent.clientWidth : window.innerWidth) - KEEP_VISIBLE
    let maxTop = (parent instanceof HTMLElement ? parent.clientHeight : window.innerHeight) - KEEP_VISIBLE
    if (options.bounds !== undefined && parent instanceof HTMLElement) {
      const box = options.bounds.getBoundingClientRect()
      const origin = parent.getBoundingClientRect()
      minLeft = box.left - origin.left + EDGE_MARGIN
      minTop = box.top - origin.top + EDGE_MARGIN
      maxLeft = box.right - origin.left - KEEP_VISIBLE
      maxTop = box.bottom - origin.top - KEEP_VISIBLE
    }
    const left = drag.left + (event.clientX - drag.x)
    const top = drag.top + (event.clientY - drag.y)
    panel.style.left = `${Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft))}px`
    panel.style.top = `${Math.min(Math.max(top, minTop), Math.max(minTop, maxTop))}px`
    // The popup is now where the person put it; placement heuristics that
    // reposition on repaint would fight the hand that moved it.
    panel.dataset['moved'] = 'true'
  })

  const release = (event: PointerEvent): void => {
    if (drag === undefined || event.pointerId !== drag.pointerId) return
    drag = undefined
    panel.classList.remove('sm-dragging')
  }
  panel.addEventListener('pointerup', release)
  panel.addEventListener('pointercancel', release)
}
