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

import { naturalSize } from './figure-export.js'

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

/** Clamps to the shared 50–400% range, snapping the float-error band around 1 back to exactly 1. */
export function clampScale(next: number): number {
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
  return Math.abs(clamped - 1) < 0.001 ? 1 : clamped
}

/**
 * WKWebView's native trackpad-pinch path: `gesturestart` captures `scale`
 * (the ratio the platform tracks internally, always 1 at gesture start) and
 * `baseScale` is whatever this viewer's own `scale` was at that moment —
 * multiplying the two turns the platform's *relative* pinch back into this
 * viewer's *absolute* one. Pure so it can be unit-tested without a WebKit
 * runtime (`GestureEvent` cannot be constructed in jsdom or Chromium).
 */
export function gestureScale(baseScale: number, eventScale: number): number {
  return clampScale(baseScale * eventScale)
}

/**
 * Chromium's trackpad-pinch path: delivered as a synthetic `wheel` event
 * with `ctrlKey: true` and `deltaY` carrying the pinch's magnitude/direction
 * (negative = zoom in, matching a real ctrl+wheel zoom gesture everywhere
 * else on the platform). Exponential rather than linear so a fast pinch
 * still feels proportionate near both clamp ends.
 */
export function wheelZoomScale(currentScale: number, deltaY: number, k = 0.01): number {
  return clampScale(currentScale * Math.exp(-deltaY * k))
}

/**
 * Copies fence source through the shell's clipboard boundary when a
 * `ClipboardPort` is available (`DiagramNodeView#openViewer`), or falls back
 * to the web clipboard directly — the same fallback shape
 * `deferred-tables.ts`' `copyWithWebClipboard` already uses for its own Copy
 * button, so a browser host without a shell still gets a working copy.
 */
export type FigureCopySource = (source: string) => Promise<boolean>

export interface FigureViewerOptions {
  /**
   * True for the paste-exhaust text cards (ansi/diff/json/tree/stacktrace):
   * §1 ruling 2 — the viewer becomes a reading overlay for these, at
   * readable width with native two-axis scroll, and the pinch/wheel zoom
   * chrome (built for a drawing, not text) is dropped rather than offered
   * and then not doing anything useful.
   */
  readonly isTextCard: boolean
  /** The fence's own source text — what `Copy source` places on the clipboard. */
  readonly source: string
  readonly copySource: FigureCopySource
  /**
   * §1 ruling 3: Copy image / Save image are SVG-rendered kinds only — never
   * offered for a text card, and `DiagramNodeView` only supplies these when
   * the rendered content was an `<svg>`. Absent hides both buttons.
   */
  readonly copyImage?: () => Promise<boolean>
  readonly saveImage?: () => Promise<boolean>
}

/**
 * Opens `content` full screen until dismissed.
 *
 * `content` is normally the rendered `<svg>` a diagram produced, but display
 * math and the text cards render as plain HTML (KaTeX markup, a `.text-card`
 * `<pre>`/`<div>`) — §1 ruling 1 puts "Open figure" on every rendered block,
 * so this takes any `Element` rather than assuming an svg. Natural-size
 * sizing (`naturalSize` below) only ever applies to an `SVGElement`; anything
 * else renders at whatever size its own layout gives it, scaled by the same
 * `scale` zoom the svg path uses.
 *
 * Returns a handle: `dismiss()` closes the viewer, so a caller tearing down
 * its own node view can take the viewer with it rather than leaving an
 * overlay above a document that no longer exists; `printFigure()` triggers
 * the same print flow as the toolbar button, so `DiagramController.printFigure()`
 * (a viewer-scoped app-API verb, §1 ruling 5) can print without the person
 * having clicked the button themselves.
 */
export interface FigureViewerHandle {
  dismiss(): void
  printFigure(): void
}

export function openFigureViewer(content: Element, title: string, options: FigureViewerOptions): FigureViewerHandle {
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
  stage.className = `figure-viewer-stage${options.isTextCard ? ' is-text-card' : ''}`

  const clone = content.cloneNode(true) as HTMLElement | SVGElement
  if (content instanceof SVGElement && clone instanceof SVGElement) {
    const size = naturalSize(content)
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
  }
  stage.append(clone)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'figure-viewer-close'
  close.textContent = 'Done'
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close figure viewer')

  const toolbar = document.createElement('div')
  toolbar.className = 'figure-viewer-toolbar'

  const toolbarButton = (label: string, text: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'figure-viewer-toolbar-btn'
    button.setAttribute('aria-label', label)
    button.title = label
    button.textContent = text
    return button
  }

  const copyButton = toolbarButton('Copy source', 'Copy source')
  const printButton = toolbarButton('Print figure', 'Print figure')
  toolbar.append(copyButton, printButton)

  let copyResetTimer: number | undefined
  copyButton.addEventListener('click', (event) => {
    event.stopPropagation()
    window.clearTimeout(copyResetTimer)
    copyButton.textContent = 'Copying…'
    void options.copySource(options.source).then((ok) => {
      copyButton.textContent = ok ? 'Copied' : 'Copy failed'
      copyResetTimer = window.setTimeout(() => {
        copyButton.textContent = 'Copy source'
      }, 1500)
    })
  })

  // §1 ruling 3: SVG-rendered kinds only — `options.copyImage`/`saveImage`
  // are absent for a text card (and for math, which has no `<svg>`), so
  // these buttons simply do not appear rather than appearing disabled.
  let copyImageResetTimer: number | undefined
  let copyImageButton: HTMLButtonElement | undefined
  if (options.copyImage !== undefined) {
    copyImageButton = toolbarButton('Copy image', 'Copy image')
    toolbar.append(copyImageButton)
    copyImageButton.addEventListener('click', (event) => {
      event.stopPropagation()
      const button = copyImageButton
      if (button === undefined) return
      window.clearTimeout(copyImageResetTimer)
      button.textContent = 'Copying…'
      // §4.4: a refusal is never a silent no-op — the button's own text is
      // the visible status message, the same shape `copyButton` above uses.
      void options.copyImage?.().then((ok) => {
        button.textContent = ok ? 'Copied' : 'Copy failed'
        copyImageResetTimer = window.setTimeout(() => {
          button.textContent = 'Copy image'
        }, 1500)
      })
    })
  }

  let saveImageResetTimer: number | undefined
  let saveImageButton: HTMLButtonElement | undefined
  if (options.saveImage !== undefined) {
    saveImageButton = toolbarButton('Save image', 'Save image')
    toolbar.append(saveImageButton)
    saveImageButton.addEventListener('click', (event) => {
      event.stopPropagation()
      const button = saveImageButton
      if (button === undefined) return
      window.clearTimeout(saveImageResetTimer)
      button.textContent = 'Saving…'
      void options.saveImage?.().then((ok) => {
        button.textContent = ok ? 'Saved' : 'Save failed'
        saveImageResetTimer = window.setTimeout(() => {
          button.textContent = 'Save image'
        }, 1500)
      })
    })
  }

  // §1 ruling 3: a body class plus viewer-scoped `@media print` rules
  // (print.css) hide everything else, so `window.print()` — an OS service,
  // not something this code can control the output of — prints only the
  // figure that is currently open.
  const onAfterPrint = (): void => document.body.classList.remove('is-printing-figure')
  const triggerPrint = (): void => {
    document.body.classList.add('is-printing-figure')
    window.addEventListener('afterprint', onAfterPrint, { once: true })
    window.print()
  }
  printButton.addEventListener('click', (event) => {
    event.stopPropagation()
    triggerPrint()
  })

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

  overlay.append(scroll, close, toolbar)
  // §1 ruling 2: font scaling for a text card is not free (`transform: scale`
  // on an html block would blur/reflow text unpredictably rather than a
  // drawing's crisp vector zoom), so the zoom chip row and its touch hint —
  // built for a drawing — are dropped for a text card. Scrolling is the point.
  if (!options.isTextCard) overlay.append(zoomBar, hint)
  scroll.append(stage)
  document.body.append(overlay)

  let scale = 1

  // Bug 3 (zoom hides the top of the drawing): `transform: scale()` is
  // purely visual — it never changes the layout box `.figure-viewer-scroll`
  // measures for its scrollable overflow, so a zoomed-in drawing grew
  // visually past the viewport on every side while the scroll container
  // still thought it only needed room for the *unscaled* box. Combined with
  // centering the stage via flex `align-items`/`justify-content`, the
  // "extra" content above/left of center had nowhere in the scrollable
  // range to go — no scrollTop could ever reach it. The fix sizes `stage`
  // itself to the actual scaled footprint (`content*scale`) so the
  // scrollable region always covers the full zoomed drawing in both axes,
  // and centers it in the flow via `margin: auto` (app.css) instead of flex
  // centering, which is the one centering method that does not clip
  // overflow on the start side.
  //
  // Measured once, from the clone's own natural (unscaled, untransformed)
  // layout box — this covers every kind uniformly: the svg path already sets
  // an explicit natural width/height above, and math/text-card markup gets
  // whatever size its own layout gives it, exactly the box that needs to
  // grow when scaled.
  const contentRect = clone.getBoundingClientRect()
  const contentWidth = contentRect.width
  const contentHeight = contentRect.height

  const paint = (): void => {
    clone.style.transformOrigin = 'top left'
    clone.style.transform = `scale(${scale})`
    if (!options.isTextCard && contentWidth > 0 && contentHeight > 0) {
      stage.style.width = `${contentWidth * scale}px`
      stage.style.height = `${contentHeight * scale}px`
    }
    zoomLevel.textContent = `${Math.round(scale * 100)}%`
  }

  const setScale = (next: number): void => {
    scale = clampScale(next)
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
    close.contains(target as Node) || zoomBar.contains(target as Node) || toolbar.contains(target as Node)

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

  /**
   * Bug 2 (trackpad pinch does nothing): the two-pointer handlers above
   * track touchscreen semantics — a real touch pinch delivers two
   * `PointerEvent`s. A macOS trackpad pinch never does; WKWebView (the
   * packaged app) delivers it as native `gesturestart`/`gesturechange`
   * events carrying an absolute `scale`, while Chromium (dev environment,
   * Playwright) delivers the same gesture as a synthetic `wheel` event with
   * `ctrlKey: true`. Both paths drive the same `setScale`/clamp the zoom
   * buttons use; neither replaces the touch-pointer path above.
   */
  let gestureBaseScale = 1

  const onGestureStart = (event: Event): void => {
    if (isChrome(event.target)) return
    event.preventDefault()
    gestureBaseScale = scale
  }

  const onGestureChange = (event: Event): void => {
    if (isChrome(event.target)) return
    event.preventDefault()
    const eventScale = (event as unknown as { scale: number }).scale
    setScale(gestureScale(gestureBaseScale, eventScale))
  }

  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey) return
    if (isChrome(event.target)) return
    event.preventDefault()
    setScale(wheelZoomScale(scale, event.deltaY))
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
    overlay.removeEventListener('wheel', onWheel)
    overlay.removeEventListener('gesturestart', onGestureStart)
    overlay.removeEventListener('gesturechange', onGestureChange)
    document.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('afterprint', onAfterPrint)
    window.clearTimeout(copyResetTimer)
    window.clearTimeout(copyImageResetTimer)
    window.clearTimeout(saveImageResetTimer)
    document.body.classList.remove('is-printing-figure')
    overlay.remove()
  }

  overlay.addEventListener('pointerdown', onPointerDown)
  overlay.addEventListener('pointermove', onPointerMove)
  overlay.addEventListener('pointerup', onPointerUp)
  overlay.addEventListener('pointercancel', onPointerUp)
  overlay.addEventListener('click', onClick)
  overlay.addEventListener('wheel', onWheel, { passive: false })
  // Not in TypeScript's DOM lib (WebKit-only): cast the event name/handler
  // rather than widening the handler's own parameter type.
  overlay.addEventListener('gesturestart', onGestureStart as EventListener)
  overlay.addEventListener('gesturechange', onGestureChange as EventListener)
  document.addEventListener('keydown', onKeyDown)
  close.addEventListener('click', dismiss)

  paint()
  close.focus()
  return { dismiss, printFigure: triggerPrint }
}
