/**
 * A rendered figure, opened full screen and put under a thumb.
 *
 * A chart authored at 760px on a 402pt phone is not a layout problem that
 * better CSS solves — squeezing it to the column makes its labels unreadable,
 * and letting it scroll inside its own box hides most of it behind an edge with
 * nothing to say more is there. Notes and Bear both answer this the same way:
 * the figure stays small in the document and opens to the whole screen when you
 * ask, where zoom and pan are gestures rather than controls.
 *
 * The viewer shows a *clone*. It never borrows the live node, so dismissing it
 * cannot leave the document short of a diagram, and nothing here can edit —
 * this is a reading surface, and correction stays in the source sheet where the
 * bytes are.
 *
 * The drawing renders at its own natural size (not squeezed to the viewport
 * like a screenshot) inside a container that scrolls in both axes once that
 * exceeds the screen — the same "scroll beats shrink" rule the in-document
 * `.diagram-render.is-wide` box already follows. A mouse/keyboard reader gets
 * the scrollbars and the `.figure-viewer-zoom` chip row (same −/%/+ pattern as
 * the block's own chips); a touch reader gets pinch-to-zoom and drag-to-pan on
 * top of the same underlying `scale`.
 */

/** CSS absolute lengths, in px — the units an svg's `width`/`height` attribute may carry. */
const CSS_UNITS: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}

function parseLength(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const match = /^([\d.]+)\s*([a-z]*)$/i.exec(raw.trim())
  if (match === null) return undefined
  const value = Number(match[1])
  const scale = CSS_UNITS[(match[2] ?? '').toLowerCase() || 'px']
  return Number.isFinite(value) && value > 0 && scale !== undefined ? value * scale : undefined
}

/**
 * The drawing's own authored size, in CSS pixels — not the size the document
 * happens to be rendering it at right now (a fill width, a committed
 * `width=`, the block's own zoom). Read from `figure` (the live node) before
 * it is cloned and stripped, the same two sources `naturalWidth()` in
 * `diagram-node-view.ts` reads, kept local here to avoid a viewer ⇄
 * node-view import cycle.
 */
function naturalSize(svg: SVGElement): { width: number; height: number } | undefined {
  const width = parseLength(svg.getAttribute('width'))
  const height = parseLength(svg.getAttribute('height'))
  if (width !== undefined && height !== undefined) return { width, height }

  const viewBox = svg.getAttribute('viewBox')
  if (viewBox === null) return undefined
  const parts = viewBox.split(/[\s,]+/).map(Number)
  const vbWidth = parts[2] ?? NaN
  const vbHeight = parts[3] ?? NaN
  if (!(Number.isFinite(vbWidth) && vbWidth > 0 && Number.isFinite(vbHeight) && vbHeight > 0)) return undefined
  // A `width` attribute in non-px units (Graphviz writes pt) scales the
  // aspect-correct viewBox instead of trusting its raw user units as px.
  if (width !== undefined) return { width, height: width * (vbHeight / vbWidth) }
  return { width: vbWidth, height: vbHeight }
}

/** Beyond this the drawing is bigger than any use for it. Mirrors the block's own chip zoom (§2 chip-chrome). */
const MAX_SCALE = 4

/** Below this the figure is smaller than its thumbnail in the document. Mirrors the block's own chip zoom. */
const MIN_SCALE = 0.5

/** Same ×1.25-per-click step as the block's own Zoom in/out chips. */
const ZOOM_STEP = 1.25

/** What a double tap jumps to when the figure is already fitted. */
const DOUBLE_TAP_SCALE = 2.5

/** Two taps further apart in time than this are two separate taps. */
const DOUBLE_TAP_MS = 300

interface Point {
  readonly x: number
  readonly y: number
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Opens `figure` full screen until dismissed.
 *
 * Returns a function that closes it, so a caller tearing down its own node view
 * can take the viewer with it rather than leaving an overlay above a document
 * that no longer exists.
 */
export function openFigureViewer(figure: SVGElement, title: string): () => void {
  const overlay = document.createElement('div')
  overlay.className = 'figure-viewer'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', title)

  // Scrolls in both axes once the (natural-size) drawing exceeds the
  // viewport — a mouse wheel, trackpad, dragged scrollbar, or a touch swipe
  // all just work here, no gesture handling required. Panning via the pinch
  // handlers below rides on top of this rather than replacing it.
  const scroll = document.createElement('div')
  scroll.className = 'figure-viewer-scroll'

  const stage = document.createElement('div')
  stage.className = 'figure-viewer-stage'

  const clone = figure.cloneNode(true) as SVGElement
  const size = naturalSize(figure)
  // The document sizes its figures to a column; here the only constraint is
  // scroll, so whatever inline width the fit logic left behind has to go —
  // replaced with the drawing's own authored size, scaled by `scale` below.
  clone.style.removeProperty('width')
  clone.style.removeProperty('max-width')
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  if (size !== undefined) {
    clone.style.width = `${size.width}px`
    clone.style.height = `${size.height}px`
  }
  stage.append(clone)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'figure-viewer-close'
  close.textContent = 'Done'
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close figure viewer')

  const zoomBar = document.createElement('div')
  zoomBar.className = 'figure-viewer-zoom'

  const zoomButton = (label: string, text: string, extra?: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `figure-viewer-zoom-btn${extra === undefined ? '' : ` ${extra}`}`
    button.setAttribute('aria-label', label)
    button.title = label
    button.textContent = text
    return button
  }

  const zoomOut = zoomButton('Zoom out', '−')
  const zoomLevel = zoomButton('Reset zoom', '100%', 'figure-viewer-zoom-level')
  const zoomIn = zoomButton('Zoom in', '+')
  zoomBar.append(zoomOut, zoomLevel, zoomIn)

  const hint = document.createElement('p')
  hint.className = 'figure-viewer-hint'
  hint.textContent = 'Pinch to zoom · drag to move · double-tap to fit'

  overlay.append(scroll, close, zoomBar, hint)
  scroll.append(stage)
  document.body.append(overlay)

  let scale = 1
  const paint = (): void => {
    stage.style.transform = `scale(${scale})`
    zoomLevel.textContent = `${Math.round(scale * 100)}%`
  }

  const setScale = (next: number): void => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    // Repeated in/out steps accumulate float error the same way the block's
    // own `#setZoom` guards against — close enough to read "100%" but never
    // `=== 1`.
    scale = Math.abs(clamped - 1) < 0.001 ? 1 : clamped
    paint()
  }

  const fit = (): void => setScale(1)

  zoomOut.addEventListener('click', (event) => {
    event.stopPropagation()
    setScale(scale / ZOOM_STEP)
  })
  zoomIn.addEventListener('click', (event) => {
    event.stopPropagation()
    setScale(scale * ZOOM_STEP)
  })
  zoomLevel.addEventListener('click', (event) => {
    event.stopPropagation()
    fit()
  })

  /** Live pointers, so a second finger turns a drag into a pinch mid-gesture. */
  const pointers = new Map<number, Point>()
  let pinchDistance = 0
  let pinchScale = 1
  let lastTapAt = 0

  const isChrome = (target: EventTarget | null): boolean =>
    close.contains(target as Node) || zoomBar.contains(target as Node)

  const onPointerDown = (event: PointerEvent): void => {
    if (isChrome(event.target)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      if (a !== undefined && b !== undefined) {
        pinchDistance = distance(a, b)
        pinchScale = scale
      }
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      if (a === undefined || b === undefined || pinchDistance === 0) return
      setScale(pinchScale * (distance(a, b) / pinchDistance))
    }
    // A single pointer pans via the scroll container's own native scrolling
    // (mouse drag on a scrollbar, or a touch swipe) — nothing to do here.
  }

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinchDistance = 0
  }

  // A tap that neither zoomed nor panned is a request to leave, which is how
  // every full-screen photo on this platform behaves. A double tap is the
  // shortcut between fitted and close-up.
  const onClick = (event: MouseEvent): void => {
    if (isChrome(event.target)) return
    const now = event.timeStamp
    if (now - lastTapAt < DOUBLE_TAP_MS) {
      lastTapAt = 0
      if (scale === 1) setScale(DOUBLE_TAP_SCALE)
      else fit()
      return
    }
    lastTapAt = now
    if (stage.contains(event.target as Node)) return
    dismiss()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss()
  }

  let dismissed = false
  function dismiss(): void {
    if (dismissed) return
    dismissed = true
    overlay.removeEventListener('pointerdown', onPointerDown)
    overlay.removeEventListener('pointermove', onPointerMove)
    overlay.removeEventListener('pointerup', onPointerUp)
    overlay.removeEventListener('pointercancel', onPointerUp)
    overlay.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKeyDown)
    overlay.remove()
  }

  overlay.addEventListener('pointerdown', onPointerDown)
  overlay.addEventListener('pointermove', onPointerMove)
  overlay.addEventListener('pointerup', onPointerUp)
  overlay.addEventListener('pointercancel', onPointerUp)
  overlay.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeyDown)
  close.addEventListener('click', dismiss)

  paint()
  close.focus()
  return dismiss
}
