import { describe, expect, it } from 'vitest'

import type { WorkspaceCatalog, WorkspaceCatalogEntry } from '../../src/application/index.js'
import { WorkspaceCollections } from '../../src/app/workspace-collections.js'

const note = (handle: string): WorkspaceCatalogEntry => ({
  handle,
  name: handle.split('/').pop()!,
  modifiedMs: 1,
  createdMs: 1,
})

const folder = (handle: string, ...names: string[]): WorkspaceCatalog => ({
  handle,
  name: handle.split('/').pop()!,
  notes: names.map((name) => note(`${handle}/${name}`)),
})

describe('WorkspaceCollections', () => {
  it('keeps Open Notes isolated from every adopted folder', () => {
    const collections = new WorkspaceCollections()
    collections.rememberOpened(note('/one/a.md'))
    collections.rememberOpened(note('/two/b.md'))
    collections.addFolder(folder('/project-a', 'a.md', 'b.md', 'c.md'))
    collections.addFolder(folder('/research', 'x.md', 'y.md'))

    expect(collections.openNotes('/two').notes.map((entry) => entry.handle)).toEqual([
      '/two/b.md',
      '/one/a.md',
    ])
    expect(collections.folder('/project-a')?.notes).toHaveLength(3)
    expect(collections.folders().map((entry) => entry.name)).toEqual(['project-a', 'research'])
  })

  it('reopening a file makes it recent without duplicating it', () => {
    const collections = new WorkspaceCollections()
    collections.rememberOpened(note('/one/a.md'))
    collections.rememberOpened(note('/two/b.md'))
    collections.rememberOpened(note('/one/a.md'))

    expect(collections.openedCount()).toBe(2)
    expect(collections.openNotes('/one').notes.map((entry) => entry.handle)).toEqual([
      '/one/a.md',
      '/two/b.md',
    ])
  })

  it('switches collections without copying folder notes into Open Notes', () => {
    const collections = new WorkspaceCollections()
    collections.rememberOpened(note('/loose.md'))
    collections.addFolder(folder('/project-a', 'one.md', 'two.md'))

    expect(collections.collection('/project-a', '/').notes).toHaveLength(2)
    expect(collections.collection('open', '/').notes.map((entry) => entry.handle)).toEqual([
      '/loose.md',
    ])
  })
})
