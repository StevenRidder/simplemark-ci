import { describe, expect, it } from 'vitest'

import { planDiagramSurface, shouldPaintLiveDrawing } from '../../src/domain/index.js'

describe('planDiagramSurface', () => {
  it('keeps a visible chart as a live drawing', () => {
    expect(
      planDiagramSurface({ visible: true, hasLiveDrawing: true, hasSnapshot: true }),
    ).toBe('live')
  })

  it('asks for a live drawing when a visible chart has not been drawn yet', () => {
    expect(
      planDiagramSurface({ visible: true, hasLiveDrawing: false, hasSnapshot: false }),
    ).toBe('live')
  })

  it('swaps an off-screen chart to its still frame once one exists', () => {
    expect(
      planDiagramSurface({ visible: false, hasLiveDrawing: true, hasSnapshot: true }),
    ).toBe('snapshot')
  })

  it('keeps the live drawing off-screen until a still frame exists', () => {
    expect(
      planDiagramSurface({ visible: false, hasLiveDrawing: true, hasSnapshot: false }),
    ).toBe('live')
  })

  it('does not draw an off-screen chart that has no still frame yet', () => {
    expect(
      planDiagramSurface({ visible: false, hasLiveDrawing: false, hasSnapshot: false }),
    ).toBe('placeholder')
  })
})

describe('shouldPaintLiveDrawing', () => {
  it('does not start a render for an off-screen chart', () => {
    expect(
      shouldPaintLiveDrawing({ visible: false, sourceChanged: false, hasLiveDrawing: false }),
    ).toBe(false)
  })

  it('paints a visible chart that has no drawing yet', () => {
    expect(
      shouldPaintLiveDrawing({ visible: true, sourceChanged: false, hasLiveDrawing: false }),
    ).toBe(true)
  })

  it('does not repaint a visible chart whose source did not change', () => {
    expect(
      shouldPaintLiveDrawing({ visible: true, sourceChanged: false, hasLiveDrawing: true }),
    ).toBe(false)
  })

  it('repaints a visible chart when the source changed', () => {
    expect(
      shouldPaintLiveDrawing({ visible: true, sourceChanged: true, hasLiveDrawing: true }),
    ).toBe(true)
  })
})
