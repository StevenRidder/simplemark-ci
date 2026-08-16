/**
 * Which surface a diagram block should show.
 *
 * A live Mermaid or Vega drawing is an SVG tree. Ten of those in one note
 * keep hundreds of thousands of SVG and accessibility nodes on the page
 * after the reader has scrolled past them. This planner is the document
 * rule for that cost: a chart that is on screen stays a live drawing; a
 * chart that has left the screen becomes a still frame of the same size;
 * a chart that has never been on screen is not drawn yet.
 *
 * Pure: visibility and what already exists in, a surface out. No DOM, no
 * renderer, no observer.
 */

export type DiagramSurface = 'placeholder' | 'snapshot' | 'live'

export function planDiagramSurface(input: {
  readonly visible: boolean
  readonly hasLiveDrawing: boolean
  readonly hasSnapshot: boolean
}): DiagramSurface {
  if (input.visible) return 'live'
  if (input.hasSnapshot) return 'snapshot'
  if (input.hasLiveDrawing) return 'live'
  return 'placeholder'
}

/**
 * Whether the adapter should start a renderer pass for a live drawing.
 *
 * Off-screen charts do not render. A visible chart renders when its source
 * changed or when it has no drawing yet. An unchanged visible drawing is
 * left alone — ProseMirror `update()` used to repaint on every transaction.
 */
export function shouldPaintLiveDrawing(input: {
  readonly visible: boolean
  readonly sourceChanged: boolean
  readonly hasLiveDrawing: boolean
}): boolean {
  if (!input.visible) return false
  if (input.sourceChanged) return true
  return !input.hasLiveDrawing
}
