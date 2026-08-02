# SimpleMark — Rendered-document proof of concept

**Status:** the next executable target  
**Scope:** one AI-generated local Markdown file, one document window, one human reader, no in-app
agent, no collaboration, no CRDT

## The question

Can SimpleMark make an AI-generated Markdown file feel like a beautiful, living technical document
while leaving the file trustworthy and fully owned by the user?

The first product proof is not whether SimpleMark can operate an agent. Codex, Claude, or another
tool already writes the file. SimpleMark must be the best place to read and judge the result outside
the coding environment.

```text
Codex / Claude / tool ─→ local plan.md ─→ watched import ─┐
                                                          ├─→ rendered document
Small human correction ───────────────→ DocumentSession ──┘
                                         │
                                         └─→ atomic Markdown save
```

[`PRODUCT.md`](PRODUCT.md) defines the job and [`ADR-0005`](decisions/0005-rendered-document-before-agent-participation.md)
records why agent participation follows rather than leads this proof.

## In

- Open one arbitrary local `.md` file directly, without importing it into a vault or library.
- One calm document window that opens to rendered content rather than an empty editor or file tree.
- The source-preservation gate from `DESIGN.md` §12.
- Excellent document typography, spacing, hierarchy, code treatment, tables, and links.
- Mermaid, SVG, math, and fenced code rendered inline from representative AI-generated input.
- A file watcher that recognizes a complete external write and imports the changed document through
  the application boundary.
- Incremental or stable refresh that preserves reading position and does not flash, jump, steal
  focus, or expose source.
- A quiet, temporary indication of externally changed content; no mandatory diff or review flow.
- Click one sentence or rendered block to make a small correction in place.
- Reveal source only for the exact block that requires it; return to the rendered state on commit or
  escape.
- Atomic save to the same file.
- Close and reopen to ordinary, readable Markdown.

## Out

- An MCP server, in-app agent participant, agent name, scope, status, cursor, chat, activity feed,
  Stop, Redirect, attribution, or agent-transaction revert.
- Model or provider selection, prompting, context management, tool calls, or agent session history.
- Yjs, another human, another device, remote collaboration, presence, comments, or offline merge.
- Vault creation, folder scanning, tags, backlinks, knowledge graphs, project navigation, or a
  permanent file tree.
- Broad formatting chrome or a separate source editor.
- Multiple documents, search, attachment management, PDF/DOCX/PPTX conversion, renderer acquisition,
  and public plugins.

These features are not rejected forever. They are excluded because none is necessary to prove the
install reason.

## External-change contract

An external agent changing the file is normal product behavior, not an exceptional conflict path.

The watcher must:

1. ignore SimpleMark's own atomic-save event;
2. wait until the external write is complete rather than parsing a partial file;
3. rebuild source mappings from the new bytes;
4. calculate the smallest safe document update;
5. preserve viewport position using a stable visible anchor;
6. preserve selection if the selected block did not change;
7. refuse to overwrite an unsaved human correction silently; and
8. surface parse or renderer failure locally without blanking the rest of the document.

If the external file changes while the human has an unsaved correction, the POC may present a small
conflict choice for the affected block. It may not replace the entire document, silently discard
either change, or open a cockpit-sized review experience.

## Source baseline rule

Each clean block keeps an immutable `originalSource` plus the revision it came from. Dirty is
monotonic until save. Once touched, the block is serialized from the structured document and its
old source is ignored. Only a successful atomic save creates a new clean baseline.

Watched external bytes create a new baseline only after the external update has been accepted.
`originalSource` is preservation metadata, never independently editable or mergeable content.

## Visual acceptance

The POC is unsuccessful if it merely looks like a competent GitHub or IDE preview.

Representative input must prove:

- readable long-form prose with strong heading hierarchy and comfortable measure;
- tables that remain legible without collapsing the page or forcing unnecessary horizontal scroll;
- code with excellent syntax color, line wrapping/scrolling, copy behavior, and dark/light contrast;
- Mermaid and SVG that size naturally, remain crisp, and expose quiet block controls only on hover
  or focus;
- math aligned cleanly with surrounding prose;
- links, blockquotes, lists, task lists, footnotes, and callouts with coherent visual rhythm;
- no visible Markdown punctuation in the reading state; and
- no file-tree, agent, session, provider, chat, history, or collaboration chrome competing with the
  document.

The visual target is a technical document someone wants to keep open all day, not a parser demo.

## Ten-step acceptance test

1. Have an external agent or script write a representative `plan.md` containing prose, a table,
   code, Mermaid, SVG, math, lists, links, and a blockquote.
2. Open that exact file in SimpleMark and reach the rendered document directly, with no import,
   vault, workspace, account, provider, or editor-mode step.
3. Compare the page against the visual acceptance list and confirm no raw Markdown is visible.
4. Save without editing and prove the file is byte-identical.
5. Scroll to the middle of the document, then have the external tool change a block below the
   viewport; confirm the page updates without moving the reader.
6. Have the external tool change the visible block; confirm the update is legible, local, and does
   not flash the page, expose source, or steal focus.
7. Click one prose sentence, correct it, commit, and confirm the canvas returns to the rendered
   state.
8. Click one Mermaid block, reveal and correct only its source, commit, and confirm the diagram
   updates without recreating or destabilizing the surrounding document.
9. Diff the saved file: only the two intentionally edited blocks may differ; all unrelated bytes
   remain identical.
10. Reopen the file in a plain-text editor and in SimpleMark; confirm it remains portable Markdown
    and renders to the same living document.

## Decision after one day of real use

Use SimpleMark as the reading surface for real agent-generated documents for one day. Record:

- whether the user leaves the coding environment to read in SimpleMark;
- whether the rendered result is materially better than the IDE or GitHub preview;
- whether external updates preserve reading flow;
- how often a human makes a small correction directly versus returning instructions to the agent;
- any time raw Markdown or product machinery intrudes on reading; and
- whether the saved files remain trusted.

If the document is not worth keeping open, improve the reader before adding scope. If it is useful,
expand renderer breadth and daily-use file handling. Test in-app agent participation only when real
use identifies a correction or direction workflow that external file updates cannot serve well.
