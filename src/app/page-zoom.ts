export const PAGE_ZOOM_KEY = 'simplemark.page-zoom'
export const MIN_PAGE_ZOOM = 0.2
export const MAX_PAGE_ZOOM = 5

export interface PageZoomController {
  readonly current: () => number
  readonly set: (zoom: number) => void
}

interface ZoomStyleTarget {
  readonly style: Pick<CSSStyleDeclaration, 'setProperty'>
}

export function clampPageZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.round(Math.max(MIN_PAGE_ZOOM, Math.min(MAX_PAGE_ZOOM, value)) * 100) / 100
}

export function loadPageZoom(storage: Pick<Storage, 'getItem'>): number {
  const raw = storage.getItem(PAGE_ZOOM_KEY)
  return raw === null ? 1 : clampPageZoom(Number(raw))
}

export function savePageZoom(storage: Pick<Storage, 'setItem'>, zoom: number): void {
  try {
    storage.setItem(PAGE_ZOOM_KEY, String(clampPageZoom(zoom)))
  } catch {
    // The current zoom still works when embedded storage is unavailable.
  }
}

/**
 * Browser-style whole-page magnification shared by the web and Tauri shells.
 *
 * Keep this inside the webview compositor instead of sending every trackpad
 * sample over Tauri IPC or asking CSS to reflow a newly narrowed viewport. The
 * latest sample is painted once per animation frame, so images, diagrams,
 * chrome, and text magnify together without a staircase of native calls.
 */
export function createPageZoomController(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  target: ZoomStyleTarget,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): PageZoomController {
  let current = loadPageZoom(storage)
  let frame: number | undefined

  const paint = (): void => {
    frame = undefined
    target.style.setProperty('--page-zoom', String(current))
  }

  target.style.setProperty('--page-zoom', String(current))

  return {
    current: () => current,
    set: (zoom) => {
      current = clampPageZoom(zoom)
      savePageZoom(storage, current)
      if (frame === undefined) frame = schedule(paint)
    },
  }
}
