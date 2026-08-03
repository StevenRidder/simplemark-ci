import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { CompositeRenderer } from '../adapters/renderers/composite-renderer.js'
import { MermaidRenderer } from '../adapters/renderers/mermaid-renderer.js'
import { SvgRenderer } from '../adapters/renderers/svg-renderer.js'
import { TextCardRenderer } from '../adapters/renderers/text-card-renderer.js'
import { GraphvizRenderer } from '../adapters/renderers/graphviz-renderer.js'
import { KatexRenderer } from '../adapters/renderers/katex-renderer.js'
import { BrowserAssetReferencePort } from '../adapters/filesystem/browser-asset-reference-port.js'
import { FixtureFilePort } from '../adapters/filesystem/fixture-file-port.js'
import { OpenCancelled, TauriFilePort } from '../adapters/filesystem/tauri-file-port.js'
import type { FilePort } from '../application/index.js'
import { installNativeMenu } from './ui/native-menu.js'
import { composeApp } from './bootstrap.js'
import type { AppComposition } from './bootstrap.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'
import { WELCOME_MARKDOWN, WELCOME_NAME } from './welcome-note.js'

import './styles/tokens.css'
import './styles/app.css'

/**
 * The macOS entrypoint (ADR-0001 §Web and native shells).
 *
 * Platform wiring only, and deliberately the same shape as `browser.ts`: pick
 * a file, rebuild the composition around it, tear the old one down. Every
 * document rule — parsing, source preservation, transactions, rendering,
 * toolbar commands — is the identical module the browser shell loads. If a
 * behaviour existed only here, that would be the bug this ADR exists to
 * prevent.
 *
 * What the native shell adds is exactly two capabilities the web platform
 * cannot give: writing the original file in place with a real atomic rename,
 * and being told when something else changes that file.
 */

export async function start(root: HTMLElement): Promise<AppComposition> {
  return mount(root, new FixtureFilePort(WELCOME_NAME, WELCOME_MARKDOWN), {
    filePath: 'Demo workspace · open a file to work with your own Markdown',
    fileName: WELCOME_NAME,
  })
}

async function mount(
  root: HTMLElement,
  file: FilePort,
  options: { filePath: string; fileName: string },
): Promise<AppComposition> {
  let app: AppComposition

  app = await composeApp({
    ports: {
      file,
      // The picker is an ordinary file input inside the webview. Copying an
      // asset into the note's own directory is a native capability APP-2 does
      // not claim; the port says so rather than pretending.
      assets: new BrowserAssetReferencePort(pickDocumentAsset, window),
      diagrams: new CompositeRenderer([
        new MermaidRenderer(),
        new SvgRenderer(),
        new GraphvizRenderer(),
        new KatexRenderer(),
        new TextCardRenderer(),
      ]),
    },
    filePath: options.filePath,
    workspace: nativeWorkspace(options.fileName),
    chromeMode: 'macos',
    // The native menubar is the complete command surface. The small floating
    // palette is the fast, Apple Notes-style reach shown in the approved
    // interactive wireframe; it is not a second menu row.
    stylesBarDefault: true,
    onOpenFile: () => void openRealFile(root, app),
  })

  root.replaceChildren(app.element)
  window.simplemark = app
  installWindowDragging(app.element)

  // Native-first: the menubar is the complete command surface, generated from
  // the same registry the toolbar uses. Rebuilt with each composition so the
  // View checkmarks match the shell that is actually on screen.
  await installNativeMenu({
    run: (command) => app.run(command),
    state: (command) => app.commandState(command),
  })

  return app
}

/**
 * APP-2 shows the shared workspace around the one file it actually owns.
 *
 * It deliberately does not copy the browser's demo catalog or pretend that a
 * folder was scanned. New Note and Pin stay disabled until SHELL-2 provides a
 * real catalog; the selected local file and all three shared panes are real.
 */
function nativeWorkspace(fileName: string): WorkspaceOptions {
  return {
    name: 'SimpleMark',
    activeNoteId: fileName,
    notes: [
      {
        id: fileName,
        title: fileName.replace(/\.(md|markdown)$/i, ''),
        preview: 'Current local Markdown file',
        updatedLabel: 'Open',
        pinned: false,
      },
    ],
  }
}

/**
 * Lets the title bar move and zoom the window, like every other macOS app.
 *
 * Driven explicitly rather than declaratively. Electron's
 * `-webkit-app-region: drag` does nothing here — WKWebView never implemented
 * it — and Tauri's `data-tauri-drag-region` attribute did not take either, so
 * the shell asks the window to drag itself and the behaviour stops depending
 * on which mechanism a given webview happens to support.
 *
 * Wired from the native entrypoint, never inside `window-chrome.ts`: that
 * module is shared with the browser shell and must not import a Tauri API
 * (ADR-0001 — platform decisions live at the composition root).
 */
function installWindowDragging(element: HTMLElement): void {
  const dragRegions = element.querySelectorAll<HTMLElement>(
    '.titlebar, .workspace-library-head, .notes-header',
  )

  /** Presses on a control or an input are not drags. */
  const isChrome = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    target.closest('button, input, textarea, select, a, [contenteditable]') !== null

  for (const region of dragRegions) {
    region.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || isChrome(event.target)) return
      // Left to itself the webview would start a text selection instead.
      event.preventDefault()
      void getCurrentWindow().startDragging()
    })

    // Double-clicking any empty pane header zooms, which is the macOS
    // convention people reach for without thinking about it.
    region.addEventListener('dblclick', (event) => {
      if (isChrome(event.target)) return
      void getCurrentWindow().toggleMaximize()
    })
  }
}

/** Picks a real note through the native dialog and rebuilds around it. */
async function openRealFile(root: HTMLElement, previous: AppComposition): Promise<void> {
  const port = new TauriFilePort(invoke)

  let opened
  try {
    // Prompt before tearing anything down: a cancelled dialog must leave the
    // current document exactly as it was, unsaved edits included.
    opened = await port.open()
  } catch (error) {
    if (error instanceof OpenCancelled) return
    throw error
  }

  await previous.save()
  await previous.editor.destroy()
  const app = await mount(root, port, { filePath: opened.handle, fileName: opened.name })

  // Ask the native side to report other writers, and say so visibly when it
  // happens. Reloading the document underneath a reader is a decision the
  // shared session will own; announcing it honestly is this shell's job today.
  await port.watch(opened.handle)
  void listen<string>('note-changed-externally', (event) => {
    app.setStatus(
      'error',
      `Changed on disk by another program — ${event.payload.split('/').pop() ?? 'this note'}`,
    )
  })
}

/** Same ordinary file input the browser shell uses; the webview supports it. */
function pickDocumentAsset(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.className = 'browser-file-picker'
    input.tabIndex = -1
    document.body.append(input)

    const finish = (result: File | DOMException): void => {
      input.remove()
      if (result instanceof File) resolve(result)
      else reject(result)
    }
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.item(0)
        finish(file ?? new DOMException('The user aborted a request.', 'AbortError'))
      },
      { once: true },
    )
    input.addEventListener(
      'cancel',
      () => finish(new DOMException('The user aborted a request.', 'AbortError')),
      { once: true },
    )
    input.click()
  })
}

declare global {
  interface Window {
    simplemark?: AppComposition
  }
}

document.documentElement.dataset['shell'] = 'native'

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  void start(root).then((app) => {
    window.simplemark = app
  })
}
