import { CompositeRenderer } from '../adapters/renderers/composite-renderer.js'
import { MermaidRenderer } from '../adapters/renderers/mermaid-renderer.js'
import { SvgRenderer } from '../adapters/renderers/svg-renderer.js'
import { BrowserFilePort } from '../adapters/filesystem/browser-file-port.js'
import { FixtureFilePort } from '../adapters/filesystem/fixture-file-port.js'
import type { FilePort } from '../application/index.js'
import { composeApp } from './bootstrap.js'
import type { AppComposition } from './bootstrap.js'

import './styles/tokens.css'
import './styles/app.css'

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

Stop is immediate control, not a message. It cancels the active request and
rejects anything that arrives late. The rest should feel exactly like writing a
note.

---

Nothing else is required for the proof: one file, one window, Mermaid, and one
visible agent whose work can be interrupted and reversed.
`

export async function start(root: HTMLElement): Promise<AppComposition> {
  return mount(root, new FixtureFilePort(FIXTURE_NAME, FIXTURE_MARKDOWN), {
    filePath: 'in-memory fixture · not a real file',
  })
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
  options: { filePath: string },
): Promise<AppComposition> {
  const supported = BrowserFilePort.isSupported()

  const app = await composeApp({
    ports: {
      file,
      // One port, several renderers. DOT, KaTeX, Vega-Lite and Markmap join here.
      diagrams: new CompositeRenderer([new MermaidRenderer(), new SvgRenderer()]),
    },
    filePath: options.filePath,
    ...(supported
      ? {
          onOpenFile: () => void openRealFile(root, app),
        }
      : {
          openFileUnavailableReason:
            'Open file — this browser has no File System Access API; use Chrome, Edge, or the macOS app',
        }),
  })

  root.replaceChildren(app.element)
  window.simplemark = app
  return app
}

/** Picks a real Markdown file and rebuilds the composition around it. */
async function openRealFile(root: HTMLElement, previous: AppComposition): Promise<void> {
  const port = new BrowserFilePort(() =>
    window.showOpenFilePicker!({
      types: [
        {
          description: 'Markdown',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        },
      ],
      excludeAcceptAllOption: false,
      multiple: false,
    }).then((handles) => handles[0]!),
  )

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
  await previous.editor.destroy()
  await mount(root, port, { filePath: name })
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
