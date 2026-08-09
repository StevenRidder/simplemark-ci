import { describe, expect, it } from 'vitest'
import type { WorkspaceCatalog } from '../src/application/index.js'
import { applySummariesToCatalog } from '../src/app/note-summary-overlay.js'
import { applyPreviewsToCatalog } from '../src/app/note-preview-overlay.js'

const catalog: WorkspaceCatalog = {
  handle: '/notes',
  name: 'Notes',
  notes: [{
    handle: '/notes/first.md',
    name: 'first.md',
    modifiedMs: 2,
    createdMs: 1,
  }],
}

describe('applyPreviewsToCatalog', () => {
  it('fills only the matching filename-first row when its preview arrives', () => {
    const result = applyPreviewsToCatalog(catalog, new Map([
      ['/notes/first.md', 'The first local sentence.'],
    ]))

    expect(result.notes[0]?.preview).toBe('The first local sentence.')
  })

  it('leaves an AI summary above a later extracted preview', () => {
    const withPreview = applyPreviewsToCatalog(catalog, new Map([
      ['/notes/first.md', 'The extracted sentence.'],
    ]))
    const result = applySummariesToCatalog(withPreview, new Map([
      ['/notes/first.md', 'The AI summary.'],
    ]))

    expect(result.notes[0]?.preview).toBe('The AI summary.')
  })
})
