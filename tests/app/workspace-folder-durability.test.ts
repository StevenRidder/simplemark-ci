import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { retainedFolderHandles } from '../../src/app/workspace-collections.js'

/**
 * A folder the person adopted must survive a launch that could not list it.
 *
 * The shell re-lists every persisted folder at launch and then writes back what
 * it managed to assemble. That is fine until a listing fails: the handle is
 * absent from the collection, the write-back is authoritative, and the folder is
 * gone for good — no message, no undo, and nothing on disk changed. iCloud makes
 * this ordinary rather than rare, because a directory being materialised answers
 * with an error for a moment after launch.
 *
 * The behaviour is proved on `retainedFolderHandles`. The wiring cannot be
 * proved here — the native entrypoint self-starts on import and talks to AppKit
 * — so the source guards below stand in for it, in the same spirit as
 * tests/app/native-session-freshness.test.ts.
 */

const TAURI = readFileSync('src/app/tauri.ts', 'utf8')
const BOOTSTRAP = readFileSync('src/app/bootstrap.ts', 'utf8')
const IOS_WORKSPACE_PICKER = readFileSync('src-tauri/swift/SimpleMarkWorkspacePicker.swift', 'utf8')

describe('folders that could not be listed this launch', () => {
  it('stay in the store rather than being erased', () => {
    expect(retainedFolderHandles(['/reachable'], ['/icloud/still-downloading']))
      .toEqual(['/reachable', '/icloud/still-downloading'])
  })

  it('are not duplicated once they list again', () => {
    expect(retainedFolderHandles(['/a', '/b'], ['/b'])).toEqual(['/a', '/b'])
  })

  it('leave the adopted order alone, since that is the sidebar order', () => {
    expect(retainedFolderHandles(['/c', '/a', '/b'], [])).toEqual(['/c', '/a', '/b'])
  })

  it('are still nothing when everything listed', () => {
    expect(retainedFolderHandles([], [])).toEqual([])
  })
})

describe('the shell restoring folders at launch', () => {
  /**
   * The catch that swallows a failed listing is the exact place the handle is
   * lost. If it ever stops recording the handle, every folder in iCloud is one
   * slow launch away from disappearing.
   */
  it('records a handle it could not list instead of dropping it', () => {
    const restore = TAURI.slice(
      TAURI.indexOf('for (const handle of folderStore.load()) {'),
    )
    const firstCatch = restore.slice(restore.indexOf('} catch {'), restore.indexOf('\n  }\n'))
    expect(
      firstCatch,
      'a folder that failed to list must be remembered, not silently discarded',
    ).toContain('unreachableFolders.push(handle)')
  })

  it('writes those handles back out with the adopted ones', () => {
    const persist = TAURI.slice(
      TAURI.indexOf('const persistFolders = '),
      TAURI.indexOf('const persistRecentNotes = '),
    )
    expect(persist).toContain('retainedFolderHandles(')
    expect(persist).toContain('unreachableFolders')
  })

  /**
   * The app's own iCloud folders are not folders anybody should have to find.
   * Gating their adoption on having no other folders is what left a Mac with
   * three folders of its own unable to see a note written on the phone.
   */
  it('adopts the platform folders even when the person has folders of their own', () => {
    const call = "invoke<readonly WorkspaceCatalog[]>('default_workspaces')"
    expect(TAURI, 'the shell should ask the platform for its folders').toContain(call)
    const adoption = TAURI.slice(TAURI.indexOf(call) - 700, TAURI.indexOf(call))
    expect(
      adoption,
      'the default workspaces must not be gated on having adopted nothing',
    ).not.toContain('collections.folders().length === 0')
  })

  /** Every folder the platform names, not just the first one. */
  it('adopts every folder the platform names', () => {
    const call = "invoke<readonly WorkspaceCatalog[]>('default_workspaces')"
    const adoption = TAURI.slice(TAURI.indexOf(call), TAURI.indexOf(call) + 700)
    expect(adoption).toContain('for (const catalog of supplied)')
  })
})

describe('an empty folder selected from the add-folder action', () => {
  /**
   * An empty iCloud folder is still the actual folder the person chose. It
   * must become the selected collection, showing its empty note list, rather
   * than being rejected as though it were an invalid import.
   */
  it('adopts and selects the folder instead of rejecting it for having no notes', () => {
    const start = TAURI.indexOf('const addFolder = (): void => {')
    const addFolder = TAURI.slice(start, TAURI.indexOf('\n  /**\n   * Where a just-saved new note belongs.', start))
    expect(start, 'the native shell should expose the add-folder action').toBeGreaterThan(-1)
    expect(addFolder).not.toContain('contains no Markdown notes')
    expect(addFolder).toContain('collections.addFolder(catalog)')
    expect(addFolder).toContain('activeCollectionId = catalog.handle')
    expect(addFolder).toContain("reconcileWorkspace('', catalog.handle)")
    expect(addFolder.indexOf("reconcileWorkspace('', catalog.handle)")).toBeLessThan(
      addFolder.indexOf('const opened = await port.openAt(next.handle)'),
    )
    expect(addFolder).not.toContain('await watchFolder(')
    expect(addFolder).toContain('void watchFolder(catalog.handle).catch')
  })

  it('routes the shared Open Folder command to the native folder action', () => {
    const openFolder = BOOTSTRAP.slice(
      BOOTSTRAP.indexOf("case 'openFolder':"),
      BOOTSTRAP.indexOf("case 'newNote':"),
    )
    expect(openFolder).toContain('options.onOpenFolder?.()')
    expect(BOOTSTRAP).toContain(
      "if (id === 'openFolder') return { enabled: options.onOpenFolder !== undefined, checked: false }",
    )
  })

  it('gives every native mount the same folder action as the plus-folder button', () => {
    const mounts = TAURI.match(/onOpenFolder: addFolder/g) ?? []
    expect(mounts).toHaveLength(4)
  })

  it('uses the native Files folder picker instead of reopening the app container', () => {
    expect(IOS_WORKSPACE_PICKER).toContain('UIDocumentPickerViewController(')
    expect(IOS_WORKSPACE_PICKER).toContain('forOpeningContentTypes: [.folder]')
    expect(IOS_WORKSPACE_PICKER).toContain('asCopy: false')
    expect(IOS_WORKSPACE_PICKER).toContain('startAccessingSecurityScopedResource()')
  })
})

/**
 * An edited note must repaint, not just an added or removed one.
 *
 * `membershipChanged` answers "are these the same notes", which is the right
 * question for persistence and for noticing that the open note went missing. It
 * is the wrong question for the list: every row carries a preview, a modified
 * time, and a position in an order sorted by that time, and an edit changes all
 * three while leaving membership identical. Returning early on that meant an
 * edited note looked frozen in every folder — the one symptom that is not about
 * iCloud at all, since it happens the same way on a local disk.
 */
describe('a note edited underneath an open folder', () => {
  const handler = (): string => {
    const start = TAURI.indexOf("await listen<string>('workspace-folder-changed'")
    expect(start, 'the shell should listen for folder changes').toBeGreaterThan(-1)
    return TAURI.slice(start, TAURI.indexOf('\n  })\n', start))
  }

  it('repaints the list when membership did not change', () => {
    const unchanged = handler()
    const branch = unchanged.slice(
      unchanged.indexOf('if (!refresh.membershipChanged)'),
      unchanged.indexOf('persistFolders()'),
    )
    expect(
      branch,
      'a content-only change still has to repaint: preview, time and sort order are stale',
    ).toContain('reconcileWorkspace()')
  })

  /**
   * This fires on our own saves too — the folder watcher has no write ledger to
   * tell them apart — so reopening here would reload the document out from
   * under whoever is typing into it.
   */
  it('does not reopen the active note on a content-only change', () => {
    const unchanged = handler()
    const branch = unchanged.slice(
      unchanged.indexOf('if (!refresh.membershipChanged)'),
      unchanged.indexOf('persistFolders()'),
    )
    expect(branch).not.toContain('port.openAt(')
    expect(branch).not.toContain('install(')
  })
})
