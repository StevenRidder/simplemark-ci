export const PAGE_ZOOM_KEY = 'simplemark.page-zoom'
export const MIN_PAGE_ZOOM = 0.2
export const MAX_PAGE_ZOOM = 5

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
