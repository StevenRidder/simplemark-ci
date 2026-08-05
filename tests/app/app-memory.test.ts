import { describe, expect, test } from 'vitest'

import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  normaliseUiPreferences,
  saveUiPreferences,
} from '../../src/app/ui-preferences.js'
import { clampPageZoom, loadPageZoom, savePageZoom } from '../../src/app/page-zoom.js'
import {
  loadWindowGeometry,
  normaliseWindowGeometry,
  saveWindowGeometry,
} from '../../src/app/window-geometry.js'
import { loadActiveCollection, saveActiveCollection } from '../../src/app/workspace-selection.js'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('stable app memory', () => {
  test('round-trips every deliberate shared UI choice as one record', () => {
    const storage = new MemoryStorage()
    const chosen = {
      ...DEFAULT_UI_PREFERENCES,
      previewDensity: 'large' as const,
      notesSort: 'title' as const,
      newestOnTop: false,
      foldersSort: 'count' as const,
      foldersAtoZ: true,
      noteFilter: 'pinned' as const,
      historyNavigationVisible: true,
      wordCountVisible: true,
      infoTab: 'contents' as const,
      libraryColumnWidth: 312,
      notesColumnWidth: 401,
    }
    saveUiPreferences(storage, chosen)
    expect(loadUiPreferences(storage)).toEqual(chosen)
  })

  test('repairs corrupt and out-of-range UI values field by field', () => {
    expect(normaliseUiPreferences({
      previewDensity: 'huge',
      notesSort: 'title',
      libraryColumnWidth: 999,
      notesColumnWidth: 1,
    })).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      notesSort: 'title',
      libraryColumnWidth: 360,
      notesColumnWidth: 205,
    })
  })

  test('keeps page magnification independent and browser-sized', () => {
    const storage = new MemoryStorage()
    savePageZoom(storage, 1.75)
    expect(loadPageZoom(storage)).toBe(1.75)
    expect(clampPageZoom(99)).toBe(5)
    expect(clampPageZoom(0)).toBe(0.2)
  })

  test('restores safe native window geometry and rejects unusable frames', () => {
    const storage = new MemoryStorage()
    const frame = { x: 84, y: 72, width: 1280, height: 900, maximized: false }
    saveWindowGeometry(storage, frame)
    expect(loadWindowGeometry(storage)).toEqual(frame)
    expect(normaliseWindowGeometry({ ...frame, width: 100 })).toBeNull()
  })

  test('round-trips the active collection without interpreting its opaque handle', () => {
    const storage = new MemoryStorage()
    saveActiveCollection(storage, '/opaque/folder-handle')
    expect(loadActiveCollection(storage)).toBe('/opaque/folder-handle')
  })
})
