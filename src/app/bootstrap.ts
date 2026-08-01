import type { DiagramRenderer, FilePort } from '../application/index.js'
import { DocumentSession } from '../application/index.js'
import { MilkdownEditor } from '../adapters/editor/milkdown-editor.js'
import { createWindowChrome } from './ui/window-chrome.js'
import type { EditorCommand } from './ui/window-chrome.js'

/**
 * The composition root shared by every shell (ADR-0001).
 *
 * This is the only place that knows both a concrete adapter and the application.
 * `browser.ts` and, later, `tauri.ts` supply platform ports and call
 * `composeApp`; neither contains a document or editor rule, so a feature cannot
 * work in one shell and not the other.
 *
 * The wiring below is the architectural claim of EDITOR-1: an editor keystroke
 * becomes a serialised document, which becomes a named DocumentTransaction
 * carrying the revision it was built against, which the session accepts or
 * refuses. The editor never reaches a file, and the UI never reaches the
 * document.
 */

export interface AppPorts {
  readonly file: FilePort
  readonly diagrams: DiagramRenderer
}

export interface AppComposition {
  readonly element: HTMLElement
  readonly session: DocumentSession
  readonly editor: MilkdownEditor
  /** Flushes any pending debounced save. */
  save(): Promise<void>
}

export interface ComposeOptions {
  readonly ports: AppPorts
  readonly filePath: string
  /** Debounce for save-on-pause. Zero disables the timer so tests drive save directly. */
  readonly autosaveMs?: number
}

export async function composeApp(options: ComposeOptions): Promise<AppComposition> {
  const { ports } = options
  const session = await DocumentSession.open(ports.file)

  let editor: MilkdownEditor | undefined
  const chrome = createWindowChrome({
    fileName: session.name,
    filePath: options.filePath,
    onCommand: (command: EditorCommand) => editor?.runCommand(command),
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const autosaveMs = options.autosaveMs ?? 900

  const save = async (): Promise<void> => {
    clearTimeout(saveTimer)
    const result = await session.save()
    if (result.ok) {
      chrome.setStatus('saved')
      return
    }
    // A failed write is never allowed to look like a successful one.
    chrome.setStatus('error', `Not saved — ${result.reason}`)
  }

  editor = await MilkdownEditor.mount({
    mount: chrome.editorHost,
    initialMarkdown: session.snapshot().markdown,
    renderer: ports.diagrams,
    onMarkdownChanged: (markdown) => {
      const before = session.snapshot()
      const result = session.apply({
        actorId: 'human',
        name: 'Edit',
        expectedRevision: before.revision,
        markdown,
      })

      if (!result.ok) {
        // The editor raced the session. Say so rather than pretending the edit
        // landed; the live-agent deliverable is what makes this recoverable.
        chrome.setStatus('error', 'Edit refused — document moved underneath the editor')
        return
      }

      chrome.setStatus('dirty')
      if (autosaveMs > 0) {
        // Debounced save on pause, never per keystroke (DESIGN.md §8).
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void save(), autosaveMs)
      }
    },
  })

  return { element: chrome.element, session, editor, save }
}
