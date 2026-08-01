import { MermaidRenderer } from '../adapters/renderers/mermaid-renderer.js'
import { FixtureFilePort } from '../adapters/filesystem/fixture-file-port.js'
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
  const app = await composeApp({
    ports: {
      file: new FixtureFilePort(FIXTURE_NAME, FIXTURE_MARKDOWN),
      diagrams: new MermaidRenderer(),
    },
    filePath: 'in-memory fixture · not a real file',
  })

  root.replaceChildren(app.element)
  return app
}

declare global {
  interface Window {
    /** Exposed so the UI suite can assert against the real composition. */
    simplemark?: AppComposition
  }
}

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  void start(root).then((app) => {
    window.simplemark = app
  })
}
