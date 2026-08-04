import { CompositeRenderer } from '../adapters/renderers/composite-renderer.js'
import { MermaidRenderer } from '../adapters/renderers/mermaid-renderer.js'
import { SvgRenderer } from '../adapters/renderers/svg-renderer.js'
import { TextCardRenderer } from '../adapters/renderers/text-card-renderer.js'
import { GraphvizRenderer } from '../adapters/renderers/graphviz-renderer.js'
import { KatexRenderer } from '../adapters/renderers/katex-renderer.js'
import { BrowserFilePort } from '../adapters/filesystem/browser-file-port.js'
import { BrowserAssetReferencePort } from '../adapters/filesystem/browser-asset-reference-port.js'
import { BrowserDocumentLinkPort } from '../adapters/filesystem/browser-document-link-port.js'
import { BrowserUploadFilePort } from '../adapters/filesystem/browser-upload-file-port.js'
import { FixtureFilePort } from '../adapters/filesystem/fixture-file-port.js'
import type { FilePort } from '../application/index.js'
import { composeApp } from './bootstrap.js'
import type { AppComposition } from './bootstrap.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'

import './styles/tokens.css'
import './styles/app.css'
import './styles/print.css'

/**
 * The browser development entrypoint (ADR-0001 §Browser development shell).
 *
 * A real product entrypoint, not a throwaway prototype — it is where the browser
 * implementations of the application ports get wired to the same modules the
 * Tauri build will load. It contains platform wiring only: no Markdown parsing,
 * no ProseMirror, no diagram rendering, no serialisation.
 *
 * The file port is deliberately the in-memory fixture port. Opening an arbitrary
 * real file is gated on the FIDELITY-1 verdict and lands in APP-1, so nothing
 * here can damage a document a person cares about.
 */

/** The note the harness opens — real prose, so the canvas is judged with real content. */
const FIXTURE_NAME = 'architecture.md'
const FIXTURE_MARKDOWN = `# The first useful proof

SimpleMark is a quiet local notebook for technical work. It opens ordinary
Markdown and makes source-shaped ideas legible without turning the file into an
application database.

## The live document boundary

While this note is open, the human and agent share one local document session.
The file remains the durable result; the session supplies presence,
interruption, scoped edits, and separate undo.

\`\`\`mermaid
flowchart LR
  FILE[Markdown file] --> SESSION[Live session]
  SESSION --> BOTH[You + Codex]
\`\`\`

![SimpleMark asset](assets/simplemark-asset.svg)

Stop is immediate control, not a message. It cancels the active request and
rejects anything that arrives late. The rest should feel exactly like writing a
note.

---

Nothing else is required for the proof: one file, one window, Mermaid, and one
visible agent whose work can be interrupted and reversed.
`

interface DemoNote {
  readonly id: string
  readonly name: string
  readonly preview: string
  readonly markdown: string
  readonly updatedLabel: string
  /**
   * Hours ago, resolved to real stamps at start-up.
   *
   * The demo catalog is explicitly in-memory, but its timestamps are honest
   * ones: the View menu's date sorts stay disabled for any catalog that cannot
   * report them, so a demo without stamps would leave three menu items greyed
   * out with nothing to try. Modification and creation order deliberately
   * disagree, or the two sorts would be indistinguishable.
   */
  readonly modifiedHoursAgo: number
  readonly createdHoursAgo: number
  pinned: boolean
}

const HOUR = 60 * 60 * 1000

const DEMO_NOTES: DemoNote[] = [
  { id: 'architecture', name: FIXTURE_NAME, preview: 'A local document boundary for you and Codex.', markdown: FIXTURE_MARKDOWN, updatedLabel: 'Now', modifiedHoursAgo: 0, createdHoursAgo: 52, pinned: true },
  { id: 'field-notes', name: 'field-notes.md', preview: 'Small observations worth keeping close.', markdown: '# Field notes\n\nA quiet notebook should disappear while you think.\n', updatedLabel: 'Today', modifiedHoursAgo: 3, createdHoursAgo: 6, pinned: false },
  { id: 'ideas', name: 'ideas.md', preview: 'Paste technical material; keep the source portable.', markdown: '# Ideas\n\n- Markdown is the durable result\n- Render the useful parts\n', updatedLabel: 'Yesterday', modifiedHoursAgo: 30, createdHoursAgo: 30, pinned: false },
]

/** One clock reading for the session, so a sort cannot shuffle mid-render. */
const DEMO_EPOCH = Date.now()

export async function start(root: HTMLElement): Promise<AppComposition> {
  const ports = new Map(DEMO_NOTES.map((note) => [note.id, new FixtureFilePort(note.name, note.markdown)]))
  let activeId = DEMO_NOTES[0]!.id
  let current: AppComposition | undefined

  const openDemoNote = async (id: string, force = false): Promise<void> => {
    const note = DEMO_NOTES.find((candidate) => candidate.id === id)
    const port = ports.get(id)
    if (note === undefined || port === undefined || (id === activeId && current !== undefined && !force)) return
    if (current !== undefined) {
      await current.save()
      await current.destroy()
    }
    activeId = id
    current = await mount(root, port, {
      filePath: 'Demo workspace · open a file to work with your own Markdown',
      workspace: workspaceSnapshot(),
    })
  }

  const createDemoNote = (): void => {
    const id = `note-${DEMO_NOTES.length + 1}`
    const name = `new-note-${DEMO_NOTES.length + 1}.md`
    DEMO_NOTES.push({
      id,
      name,
      preview: 'A new local note — start writing.',
      markdown: '# New note\n\n',
      updatedLabel: 'Now',
      modifiedHoursAgo: 0,
      createdHoursAgo: 0,
      pinned: false,
    })
    ports.set(id, new FixtureFilePort(name, '# New note\n\n'))
    void openDemoNote(id)
  }

  const togglePinned = (id: string): boolean => {
    const note = DEMO_NOTES.find((candidate) => candidate.id === id)
    if (note === undefined) return false
    note.pinned = !note.pinned
    return note.pinned
  }

  const closeDemoNote = async (id: string): Promise<void> => {
    const index = DEMO_NOTES.findIndex((candidate) => candidate.id === id)
    if (index < 0) return
    const wasActive = id === activeId
    DEMO_NOTES.splice(index, 1)
    if (!wasActive) {
      current?.reconcileWorkspace(workspaceSnapshot())
      current?.setStatus('saved', 'Closed note — file remains on disk')
      return
    }

    const next = DEMO_NOTES[Math.min(index, DEMO_NOTES.length - 1)]
    if (next !== undefined) {
      await openDemoNote(next.id)
      current?.setStatus('saved', 'Closed note — file remains on disk')
      return
    }

    await current?.save()
    await current?.destroy()
    activeId = ''
    current = await mount(root, new FixtureFilePort('No note selected.md', ''), {
      filePath: 'No note selected',
      workspace: workspaceSnapshot(),
    })
    current.setStatus('saved', 'Closed note — file remains on disk')
  }

  const workspaceSnapshot = (): WorkspaceOptions => workspaceOptions(
    activeId,
    openDemoNote,
    createDemoNote,
    togglePinned,
    (text) => navigator.clipboard.writeText(text),
    async (id) => {
      const markdown = DEMO_NOTES.find((candidate) => candidate.id === id)?.markdown
      if (markdown !== undefined) await navigator.clipboard.writeText(markdown)
    },
    closeDemoNote,
  )

  await openDemoNote(activeId)
  return current!
}

function workspaceOptions(
  activeNoteId: string,
  onSelectNote: (id: string) => void,
  onCreateNote: () => void,
  onTogglePinned: (id: string) => boolean,
  onCopyText: (text: string) => Promise<void>,
  onCopyMarkdown: (id: string) => Promise<void>,
  onCloseNote: (id: string) => Promise<void>,
): WorkspaceOptions {
  return {
    name: 'SimpleMark',
    activeNoteId,
    onSelectNote,
    onCreateNote,
    onTogglePinned,
    onCopyText,
    onCopyMarkdown,
    onCloseNote,
    notes: DEMO_NOTES.map((note) => ({
      id: note.id,
      identifier: note.name,
      portableLink: `./${note.name}`,
      title: note.name.replace(/\.md$/, ''),
      preview: note.preview,
      updatedLabel: note.updatedLabel,
      updatedAt: DEMO_EPOCH - note.modifiedHoursAgo * HOUR,
      createdAt: DEMO_EPOCH - note.createdHoursAgo * HOUR,
      pinned: note.pinned,
    })),
  }
}

/**
 * Composes the app around one file port and installs the open-file wiring.
 *
 * Opening a real note (APP-1) re-runs this with a BrowserFilePort: the old
 * composition is flushed and destroyed, and the same shared modules are
 * rebuilt around the picked file. All platform decisions — which picker, what
 * happens on an unsupported browser, teardown order — live here and nowhere
 * inward (ADR-0001 §Browser development shell).
 */
async function mount(
  root: HTMLElement,
  file: FilePort,
  options: {
    filePath: string
    autosaveMs?: number
    saveSuccessMessage?: string
    workspace?: WorkspaceOptions
  },
): Promise<AppComposition> {
  const canWriteOriginal = BrowserFilePort.isSupported()
  let app: AppComposition

  app = await composeApp({
    ports: {
      file,
      assets: new BrowserAssetReferencePort(pickDocumentAsset, window),
      links: new BrowserDocumentLinkPort(window),
      // One port, several renderers. DOT, KaTeX, Vega-Lite and Markmap join here.
      diagrams: new CompositeRenderer([
        new MermaidRenderer(),
        new SvgRenderer(),
        new GraphvizRenderer(),
        new KatexRenderer(),
        new TextCardRenderer(),
      ]),
    },
    filePath: options.filePath,
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    ...(options.autosaveMs === undefined ? {} : { autosaveMs: options.autosaveMs }),
    ...(options.saveSuccessMessage === undefined ? {} : { saveSuccessMessage: options.saveSuccessMessage }),
    // Every modern browser can read an ordinary file. Chrome and Edge retain
    // its handle for in-place save; Safari opens the same file but downloads a
    // replacement on explicit Save because the web platform never exposes the
    // original path for writing.
    onOpenFile: () => void openRealFile(root, app, canWriteOriginal),
    onPrint: () => window.print(),
  })

  root.replaceChildren(app.element)
  window.simplemark = app
  return app
}

/** Picks a real Markdown file and rebuilds the composition around it. */
async function openRealFile(
  root: HTMLElement,
  previous: AppComposition,
  canWriteOriginal: boolean,
): Promise<void> {
  const port: FilePort = canWriteOriginal
    ? new BrowserFilePort(() => window.showOpenFilePicker!({
      types: [
        {
          description: 'Markdown',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        },
      ],
      excludeAcceptAllOption: false,
      multiple: false,
    }).then((handles) => handles[0]!))
    : new BrowserUploadFilePort(pickMarkdownUpload, downloadMarkdown)

  let name: string
  try {
    // Prompt before tearing anything down: a cancelled picker must leave the
    // current document exactly as it was, unsaved edits included.
    name = (await port.open()).name
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    throw error
  }

  await previous.save()
  await previous.destroy()
  await mount(root, port, canWriteOriginal
    ? { filePath: name }
    : {
        filePath: 'Safari/browser copy · Save downloads a replacement',
        autosaveMs: 0,
        saveSuccessMessage: `Downloaded ${name} — replace the original file when ready`,
      })
}

/** Safari and Firefox can pick a local Markdown file even without file handles. */
function pickMarkdownUpload(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,text/markdown,text/plain'
    input.className = 'browser-file-picker'
    input.tabIndex = -1
    document.body.append(input)

    const finish = (result: File | DOMException): void => {
      input.remove()
      if (result instanceof File) resolve(result)
      else reject(result)
    }
    input.addEventListener('change', () => {
      const file = input.files?.item(0)
      finish(file ?? new DOMException('The user aborted a request.', 'AbortError'))
    }, { once: true })
    input.addEventListener('cancel', () => {
      finish(new DOMException('The user aborted a request.', 'AbortError'))
    }, { once: true })
    input.click()
  })
}

/**
 * Browser-only selection. The `BrowserAssetReferencePort` turns this into a
 * relative Markdown reference and says plainly that browsers cannot copy the
 * picked file into the note's directory. Native APP-2 owns that explicit copy.
 */
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
    input.addEventListener('change', () => {
      const file = input.files?.item(0)
      finish(file ?? new DOMException('The user aborted a request.', 'AbortError'))
    }, { once: true })
    input.addEventListener('cancel', () => {
      finish(new DOMException('The user aborted a request.', 'AbortError'))
    }, { once: true })
    input.click()
  })
}

/** A Safari save is explicitly a downloaded portable `.md` copy, never a fake write. */
function downloadMarkdown(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes) as Uint8Array<ArrayBuffer>], {
    type: 'text/markdown;charset=utf-8',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

declare global {
  interface Window {
    /** Exposed so the UI suite can assert against the real composition. */
    simplemark?: AppComposition
    /**
     * File System Access API (WICG, not yet in lib.dom). Declared optional:
     * its absence is a legitimate runtime state this entrypoint handles.
     */
    showOpenFilePicker?: (options?: {
      types?: ReadonlyArray<{
        description?: string
        accept: Record<string, readonly string[]>
      }>
      excludeAcceptAllOption?: boolean
      multiple?: boolean
    }) => Promise<FileSystemFileHandle[]>
  }
}

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  void start(root).then((app) => {
    window.simplemark = app
  })
}
