import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Anchored notes on iOS (spec 2026-08-18). `bootstrap.ts` and `tauri.ts`
 * compose a real editor, so these are source guards, per
 * tests/app/native-new-note.test.ts.
 */
const TAURI = readFileSync('src/app/tauri.ts', 'utf8')
const CHROME = readFileSync('src/app/ui/window-chrome.ts', 'utf8')
const RUST = readFileSync('src-tauri/src/lib.rs', 'utf8')
const BOOTSTRAP = readFileSync('src/app/bootstrap.ts', 'utf8')

describe('the platform signal', () => {
  it('is a Rust command that answers from cfg!, not a user-agent guess', () => {
    expect(RUST).toMatch(/fn host_platform\(\) -> &'static str/)
    expect(RUST).toMatch(/cfg!\(target_os = "ios"\)/)
    expect(RUST).toMatch(/host_platform,/)
  })

  it('is read once in start() and defaults to macos when the binary predates it', () => {
    const start = TAURI.slice(TAURI.indexOf('export async function start('), TAURI.indexOf('async function startNative('))
    expect(start).toMatch(/invoke<string>\('host_platform'\)/)
    expect(start).toMatch(/hostChromeMode = platform === 'ios' \? 'ios' : 'macos'/)
    expect(start).toMatch(/catch[\s\S]*hostChromeMode = 'macos'/)
    expect(TAURI).toMatch(/chromeMode: hostChromeMode,/)
    expect(TAURI).not.toMatch(/chromeMode: 'macos',/)
  })
})

describe('the chrome split', () => {
  it('names two capabilities instead of one platform', () => {
    expect(CHROME).toMatch(/const hasNativeTitlebar = options\.chromeMode !== 'web'/)
    expect(CHROME).toMatch(/const hasNativeContextMenu = options\.chromeMode === 'macos'/)
    expect(CHROME).not.toMatch(/const isMacOS = /)
  })

  it('offers the in-webview selection menu wherever there is no native one', () => {
    const contextmenu = CHROME.slice(CHROME.indexOf("page.addEventListener('contextmenu'"))
    expect(contextmenu.slice(0, 400)).toMatch(/if \(hasNativeContextMenu && options\.onNativeContextMenu !== undefined\)/)
  })
})

describe('the styles bar on a phone', () => {
  it('defaults to visible on iOS when nothing is stored yet, since there is no View menu to reach it from', () => {
    expect(BOOTSTRAP).toMatch(/options\.chromeMode === 'ios' \? true : \(options\.stylesBarDefault \?\? true\)/)
  })
})

describe('the styles bar Add Note repaint', () => {
  /**
   * A DOM `selectionchange` races ProseMirror's own deferred flush of the
   * DOM selection into `view.state` (prosemirror-view's DOMObserver,
   * `flushSoon` — see task-7-fix-report.md), so painting Add Note from that
   * browser event reads a stale, empty PM selection and never repaints
   * again. The fix is a single mechanism: repaint from the PM plugin
   * `update` (which runs after `view.state` has already caught up),
   * reached through `stylesBarSelectionChanged`.
   */
  it('does not repaint from the DOM selectionchange event', () => {
    expect(CHROME).not.toMatch(/addEventListener\('selectionchange'/)
  })

  it('exposes stylesBarSelectionChanged, and bootstrap always wires it into the editor onSelectionChange', () => {
    expect(CHROME).toMatch(/stylesBarSelectionChanged\(\): void/)
    expect(CHROME).toMatch(/stylesBarSelectionChanged: \(\) => stylesBar\.dispatchEvent\(new Event\('simplemark-selection-changed'\)\)/)
    const mount = BOOTSTRAP.slice(BOOTSTRAP.indexOf('editor = await MilkdownEditor.mount('), BOOTSTRAP.indexOf('onMarkdownChanged:'))
    expect(mount).toMatch(/onSelectionChange: \(\) => \{\s*chrome\.stylesBarSelectionChanged\(\)/)
  })
})

describe('freshness', () => {
  it('the mobile watcher hashes the threads file and names its own event', () => {
    const mobileWatch = RUST.slice(RUST.indexOf('#[cfg(mobile)]\n#[tauri::command]\nfn watch_note('))
    expect(mobileWatch.slice(0, 4000)).toMatch(/notes::threads_file_for_document/)
    expect(mobileWatch.slice(0, 4000)).toMatch(/"note-threads-changed-externally"/)
  })

  it('the shell reloads notes on that event, guarded', () => {
    expect(TAURI).toMatch(/listen<string>\('note-threads-changed-externally'/)
    expect(TAURI).toMatch(/notes\.reload\(\)/)
  })
})
