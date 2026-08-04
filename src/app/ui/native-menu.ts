import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'

import { COMMANDS, MENUS } from '../../application/index.js'
import type { DocumentCommandId, MenuEntry, MenuSpec } from '../../application/index.js'
import { buildNumber, describeBuild } from '../build-provenance.js'
import type { BuildProvenance } from '../build-provenance.js'

/**
 * The macOS menubar, built from the shared command registry (APP-2).
 *
 * Native-first: this is the reliable, complete command surface, and the styles
 * bar is an optional shortcut layer above it. Nothing here decides what a
 * command does — every item dispatches an id into the composition root's one
 * router, the same one the web toolbar uses. That is the whole reason the menu
 * is generated rather than hand-written: a menubar transcribed by hand is a
 * second command list, and second lists drift.
 *
 * Only the menus SimpleMark owns are built here. The application menu, Window,
 * Edit's clipboard items, and Help are the system's, supplied by Tauri's
 * predefined items so they behave exactly as macOS users expect.
 */

export interface NativeMenuOptions {
  /** Runs a registry command — the composition root's shared router. */
  readonly run: (command: DocumentCommandId) => void
  /** Current application-owned state, read at build and after every action. */
  readonly state: (command: DocumentCommandId) => { readonly enabled: boolean; readonly checked: boolean }
  readonly appName?: string
  /**
   * Which commit this build came from (APP-22), shown in About.
   *
   * About is where a Mac user already looks for what an app is, so provenance
   * goes there rather than into a new surface the document would have to make
   * room for. Absent means the shell could not read it — the panel then says so
   * instead of quietly omitting the line.
   */
  readonly provenance?: BuildProvenance
}

/**
 * Repaints every built item from current shell state.
 *
 * One command can change another's answer: choosing a theme clears the other
 * two, opening the statistics panel closes the contents view, and hiding the
 * library disables the note-list commands. Refreshing only the item that was
 * clicked — the obvious thing, and what this did before — leaves a menu that
 * accumulates checkmarks and stops describing the application. Repainting the
 * whole menubar after every action costs a few dozen property writes and makes
 * the checkmark state correct by construction instead of by bookkeeping.
 */
type Repaint = () => void

async function buildEntry(
  entry: MenuEntry,
  options: NativeMenuOptions,
  repaints: Repaint[],
): Promise<Submenu | CheckMenuItem | MenuItem> {
  if (typeof entry !== 'string') {
    const items = []
    for (const id of entry.items) items.push(await buildEntry(id, options, repaints))
    return Submenu.new({ text: entry.label, items })
  }

  const definition = COMMANDS[entry]
  const state = options.state(definition.id)
  const shared = {
    id: definition.id,
    text: definition.label,
    ...(definition.accelerator === undefined ? {} : { accelerator: definition.accelerator }),
    enabled: state.enabled,
  }
  const activate = (): void => {
    options.run(definition.id)
    for (const repaint of repaints) repaint()
  }

  if (definition.checkable === true) {
    const item: CheckMenuItem = await CheckMenuItem.new({
      ...shared,
      checked: state.checked,
      action: activate,
    })
    repaints.push(() => {
      const next = options.state(definition.id)
      void item.setEnabled(next.enabled)
      void item.setChecked(next.checked)
    })
    return item
  }

  const item = await MenuItem.new({ ...shared, action: activate })
  repaints.push(() => void item.setEnabled(options.state(definition.id).enabled))
  return item
}

async function buildMenu(
  spec: MenuSpec,
  options: NativeMenuOptions,
  repaints: Repaint[],
): Promise<Submenu> {
  const items = []
  for (const [index, section] of spec.sections.entries()) {
    // A separator between sections, never leading or trailing: macOS menus put
    // rules between groups, and a stray rule reads as a missing item.
    if (index > 0) items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
    for (const entry of section) items.push(await buildEntry(entry, options, repaints))
  }
  return Submenu.new({ text: spec.label, items })
}

/** Builds the menubar and installs it as the application menu. */
export async function installNativeMenu(options: NativeMenuOptions): Promise<Menu> {
  const appName = options.appName ?? 'SimpleMark'

  const appMenu = await Submenu.new({
    text: appName,
    items: [
      // About carries metadata rather than a plain tag in Tauri's menu API,
      // which is what lets the build's own commit ride along.
      //
      // Tauri's `shortVersion` is what macOS renders in parentheses after the
      // version, so the commit goes there: `Version 0.1.0 (252f942)`, the build
      // number convention every Mac app already follows. `version` is left to
      // the configured 0.1.0. The two fields read backwards from their Apple
      // namesakes, which is worth stating because swapping them silently
      // produces `Version 252f942 (0.1.0)` and looks like a versioning bug.
      //
      // `credits` carries the fuller line. Not `comments` — that is a GTK field
      // the macOS standard About panel drops without a word, which is exactly
      // how the first attempt here produced a panel with no provenance at all.
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: appName,
            shortVersion: buildNumber(options.provenance),
            credits: describeBuild(options.provenance),
          },
        },
        text: `About ${appName}`,
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Services' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Hide', text: `Hide ${appName}` }),
      await PredefinedMenuItem.new({ item: 'HideOthers' }),
      await PredefinedMenuItem.new({ item: 'ShowAll' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Quit', text: `Quit ${appName}` }),
    ],
  })

  const repaints: Repaint[] = []
  const owned = []
  for (const spec of MENUS) owned.push(await buildMenu(spec, options, repaints))

  // The clipboard belongs to the system, not to us: Cut/Copy/Paste/Select All
  // must be the real ones or every text field in the app feels broken.
  const edit = owned.find((submenu, index) => MENUS[index]?.label === 'Edit')
  if (edit !== undefined) {
    await edit.append([
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Cut' }),
      await PredefinedMenuItem.new({ item: 'Copy' }),
      await PredefinedMenuItem.new({ item: 'Paste' }),
      await PredefinedMenuItem.new({ item: 'SelectAll' }),
    ])
  }

  const windowMenu = await Submenu.new({
    text: 'Window',
    items: [
      await PredefinedMenuItem.new({ item: 'Minimize' }),
      await PredefinedMenuItem.new({ item: 'Maximize' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'CloseWindow' }),
    ],
  })

  const menu = await Menu.new({ items: [appMenu, ...owned, windowMenu] })
  await menu.setAsAppMenu()
  return menu
}
