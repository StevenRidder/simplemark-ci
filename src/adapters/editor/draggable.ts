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
const UNDRAGGABLE = 'button, a, input, textarea, select, [contenteditable="true"], p, blockquote, pre'

const EDGE_MARGIN = 8
/** How much of the panel must remain reachable inside the host. */
const KEEP_VISIBLE = 48

export function makeDraggable(panel: HTMLElement): void {
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
    const width = parent instanceof HTMLElement ? parent.clientWidth : window.innerWidth
    const height = parent instanceof HTMLElement ? parent.clientHeight : window.innerHeight
    const left = drag.left + (event.clientX - drag.x)
    const top = drag.top + (event.clientY - drag.y)
    panel.style.left = `${Math.min(Math.max(left, EDGE_MARGIN), Math.max(EDGE_MARGIN, width - KEEP_VISIBLE))}px`
    panel.style.top = `${Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, height - KEEP_VISIBLE))}px`
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
