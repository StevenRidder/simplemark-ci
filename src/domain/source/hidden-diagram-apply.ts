/**
 * Splices a model's correction back into the document, and refuses it if the
 * diagram still is not there.
 *
 * The diagram "Fix it" loop does not trust the model either — it re-renders and
 * inspects the result before keeping the answer. This is the same discipline
 * with the check this bug allows: re-run the detector over the corrected span
 * and require both that nothing is swallowed any more and that a real fence for
 * the language now exists. A reply that returns the span untouched, or that
 * "fixes" it by deleting the diagram, fails here rather than silently landing.
 */

import { findHiddenDiagramFences } from './hidden-diagram-fence.js'
import type { HiddenDiagramFence, HiddenDiagramScanOptions } from './hidden-diagram-fence.js'

export type HiddenDiagramFixResult =
  | { readonly ok: true; readonly markdown: string }
  | { readonly ok: false; readonly message: string }

/** Whether the corrected span now opens a real fence for the language. */
function opensDiagram(span: string, language: string): boolean {
  return span
    .split('\n')
    .some((line) => new RegExp(`^ {0,3}(\`{3,}|~{3,})${language}\\s*$`, 'i').test(line))
}

/** Whether the span carries content between its fences — a body, not an empty shell. */
function hasBody(span: string): boolean {
  const lines = span.split('\n').filter((line) => line.trim() !== '')
  return lines.length > 2
}

export function applyHiddenDiagramFix(
  markdown: string,
  fence: HiddenDiagramFence,
  corrected: string,
  options: HiddenDiagramScanOptions = {},
): HiddenDiagramFixResult {
  const stillHidden = findHiddenDiagramFences(corrected, options).length > 0
  if (stillHidden || !opensDiagram(corrected, fence.language) || !hasBody(corrected)) {
    return { ok: false, message: `The correction still does not parse as a ${fence.language} diagram.` }
  }

  const lines = markdown.split('\n')
  const spliced = [
    ...lines.slice(0, fence.startLine - 1),
    ...corrected.split('\n'),
    ...lines.slice(fence.endLine),
  ]
  return { ok: true, markdown: spliced.join('\n') }
}
