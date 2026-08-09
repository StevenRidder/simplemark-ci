/**
 * The "before and after" turn sent to the model for a swallowed diagram fence.
 *
 * The diagram "Fix it" button passes a renderer error, because it has one. Here
 * nothing failed — the Markdown is legal and parsed cleanly into the wrong
 * thing. So the evidence has to be the mismatch itself: the source as written,
 * the structure it actually produced, and the structure it was meant to produce.
 * Shown both, a model can see that a stray delimiter is the only edit
 * explaining the difference, without being told which one to blame.
 */

import type { HiddenDiagramFence } from './hidden-diagram-fence.js'

/** Reads back the block the detector flagged, closing fence included. */
export function hiddenDiagramSpan(markdown: string, fence: HiddenDiagramFence): string {
  return markdown.split('\n').slice(fence.startLine - 1, fence.endLine).join('\n')
}

export function describeHiddenDiagramFence(markdown: string, fence: HiddenDiagramFence): string {
  const span = hiddenDiagramSpan(markdown, fence)
  const swallowed = span
    .split('\n')
    .slice(1, -1)
    .join('\n')

  return [
    `This Markdown was written to contain a ${fence.language} diagram, but it did not parse as one.`,
    '',
    'Intended structure:',
    `  code block with info string "${fence.language}"`,
    '',
    'Actual structure:',
    '  code block with no info string, holding this as literal text:',
    ...swallowed.split('\n').map((line) => `    ${line}`),
    '',
    'Source as written:',
    span,
    '',
    'Return the corrected Markdown for this span only. Change as little as possible —',
    'do not reword prose, rename anything, or reformat the diagram body.',
  ].join('\n')
}
