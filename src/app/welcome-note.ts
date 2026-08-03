/**
 * The note both shells open before you pick a real file.
 *
 * Shared rather than duplicated per entrypoint: the browser and native shells
 * are the same product (ADR-0001 §Web and native shells), so the first thing a
 * person sees must be the same document in both, judged with real prose rather
 * than lorem placeholder.
 */

export const WELCOME_NAME = 'architecture.md'

export const WELCOME_MARKDOWN = `# The first useful proof

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
