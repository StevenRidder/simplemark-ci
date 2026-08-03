import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'

import { COMMANDS, MENUS } from '../../application/index.js'
import type { DocumentCommandId, MenuEntry, MenuSpec } from '../../application/index.js'

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
}

async function buildEntry(
  entry: MenuEntry,
  options: NativeMenuOptions,
): Promise<Submenu | CheckMenuItem | MenuItem> {
  if (typeof entry !== 'string') {
    return Submenu.new({
      text: entry.label,
      items: await Promise.all(entry.items.map((id) => buildEntry(id, options))),
    })
  }

  const definition = COMMANDS[entry]
  const state = options.state(definition.id)
  const shared = {
    id: definition.id,
    text: definition.label,
    ...(definition.accelerator === undefined ? {} : { accelerator: definition.accelerator }),
    enabled: state.enabled,
  }

  if (definition.checkable === true) {
    let item: CheckMenuItem
    item = await CheckMenuItem.new({
      ...shared,
      checked: state.checked,
      action: () => {
        options.run(definition.id)
        const next = options.state(definition.id)
        void item.setEnabled(next.enabled)
        void item.setChecked(next.checked)
      },
    })
    return item
  }

  return MenuItem.new({ ...shared, action: () => options.run(definition.id) })
}

async function buildMenu(spec: MenuSpec, options: NativeMenuOptions): Promise<Submenu> {
  const items = []
  for (const [index, section] of spec.sections.entries()) {
    // A separator between sections, never leading or trailing: macOS menus put
    // rules between groups, and a stray rule reads as a missing item.
    if (index > 0) items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
    for (const entry of section) items.push(await buildEntry(entry, options))
  }
  return Submenu.new({ text: spec.label, items })
}

/** Builds the menubar and installs it as the application menu. */
export async function installNativeMenu(options: NativeMenuOptions): Promise<Menu> {
  const appName = options.appName ?? 'SimpleMark'

  const appMenu = await Submenu.new({
    text: appName,
    items: [
      // About carries metadata rather than a plain tag in Tauri's menu API.
      await PredefinedMenuItem.new({ item: { About: null }, text: `About ${appName}` }),
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

  const owned = await Promise.all(MENUS.map((spec) => buildMenu(spec, options)))

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
