import { describe, expect, it } from 'vitest'

import { COMMANDS, MENUS, menuCommandIds } from '../../src/application/index.js'
import type { DocumentCommandId } from '../../src/application/index.js'

/**
 * The registry is the contract between the two shells, so these are the rules
 * that keep them from drifting rather than a restatement of the data.
 *
 * The load-bearing one is completeness: native-first means the macOS menubar is
 * the reliable, complete command surface. A command that exists but has no menu
 * home is reachable only from the optional styles bar — which is precisely the
 * authority inversion this design rejects.
 */

const ids = Object.keys(COMMANDS) as DocumentCommandId[]

describe('the command registry', () => {
  it('gives every command a menu home, so the menubar is the complete surface', () => {
    const inMenus = new Set(menuCommandIds())
    const orphans = ids.filter((id) => !inMenus.has(id))
    expect(orphans).toEqual([])
  })

  it('never shows the same command in two places', () => {
    const placed = menuCommandIds()
    const duplicates = placed.filter((id, index) => placed.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })

  it('only references commands that exist', () => {
    for (const id of menuCommandIds()) {
      expect(COMMANDS[id], `menu references unknown command ${id}`).toBeDefined()
    }
  })

  it('keys every definition by its own id', () => {
    // A mismatch here would dispatch the wrong command from a correct-looking
    // menu item, which is the least debuggable failure this file can have.
    for (const id of ids) expect(COMMANDS[id].id).toBe(id)
  })

  it('gives every command a label a person could read in a menu', () => {
    for (const id of ids) {
      expect(COMMANDS[id].label.length, `${id} has no label`).toBeGreaterThan(0)
      expect(COMMANDS[id].label).not.toMatch(/^[a-z]+[A-Z]/)
    }
  })

  it('never binds one accelerator to two commands', () => {
    const bound = ids.map((id) => COMMANDS[id].accelerator).filter((a): a is string => a !== undefined)
    const clashes = bound.filter((accel, index) => bound.indexOf(accel) !== index)
    expect(clashes).toEqual([])
  })

  it('routes each command to exactly one executor', () => {
    for (const id of ids) expect(['editor', 'shell']).toContain(COMMANDS[id].target)
  })

  it('keeps the wireframe Format menu order: heading, emphasis, then blocks', () => {
    const format = MENUS.find((menu) => menu.label === 'Format')
    expect(format).toBeDefined()
    const first = format!.sections[0]!
    expect(typeof first[0]).toBe('object')
    expect((first[0] as { label: string }).label).toBe('Heading')
    expect(first).toContain('bold')
    expect(first).toContain('italic')
    expect(first).toContain('link')
  })

  it('keeps the optional styles bar in View, not Format', () => {
    // It is a view preference, not a formatting authority.
    const view = MENUS.find((menu) => menu.label === 'View')
    expect(menuCommandIds([view!])).toContain('toggleStylesBar')
    expect(COMMANDS.toggleStylesBar.checkable).toBe(true)
  })

  it('puts the shared pane layouts in View and note state in Note', () => {
    const view = MENUS.find((menu) => menu.label === 'View')
    const note = MENUS.find((menu) => menu.label === 'Note')
    expect(menuCommandIds([view!])).toEqual(expect.arrayContaining([
      'showAllPanes',
      'showNotesAndEditor',
      'showEditorOnly',
    ]))
    expect(menuCommandIds([note!])).toEqual(['togglePinned'])
    expect(COMMANDS.showAllPanes.checkable).toBe(true)
    expect(COMMANDS.togglePinned.checkable).toBe(true)
  })

  it('keeps unavailable folder actions in the shared vocabulary for honest disabling', () => {
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(menuCommandIds([file!])).toEqual(expect.arrayContaining(['newNote', 'openFolder', 'openFile', 'save']))
  })

  it('ends File with Print alone, where macOS puts it', () => {
    // Its own section, so the menu renders a rule above it. Print grouped with
    // Save reads as a second way to keep the file rather than a way out of it.
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(file!.sections.at(-1)).toEqual(['print'])
    expect(COMMANDS.print.accelerator).toBe('CmdOrCtrl+P')
    // The shell owns it: printing is an OS service, not an editor transaction,
    // and nothing about it may reach the document.
    expect(COMMANDS.print.target).toBe('shell')
  })
})
