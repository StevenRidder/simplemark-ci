import { describe, expect, it } from 'vitest'

import { clampScale, gestureScale, wheelZoomScale } from '../../src/adapters/editor/figure-viewer.js'

describe('clampScale', () => {
  it('clamps to the 50-400% range shared with the zoom chip buttons', () => {
    expect(clampScale(0.1)).toBe(0.5)
    expect(clampScale(10)).toBe(4)
    expect(clampScale(2)).toBe(2)
  })

  it('snaps float-error-near-1 back to exactly 1, same as the block chip zoom', () => {
    expect(clampScale(0.8 * 1.25)).toBe(1)
  })
})

describe('gestureScale (WKWebView gesturestart/gesturechange)', () => {
  it('multiplies the scale at gesture start by the platform-reported relative scale', () => {
    expect(gestureScale(1, 1.5)).toBe(1.5)
    expect(gestureScale(2, 1.5)).toBe(3)
  })

  it('clamps the result the same way a wheel/button zoom does', () => {
    expect(gestureScale(1, 100)).toBe(4)
    expect(gestureScale(1, 0.01)).toBe(0.5)
  })
})

describe('wheelZoomScale (Chromium ctrl+wheel trackpad pinch)', () => {
  it('zooms in for negative deltaY (pinch out / scroll up)', () => {
    expect(wheelZoomScale(1, -50)).toBeGreaterThan(1)
  })

  it('zooms out for positive deltaY (pinch in / scroll down)', () => {
    expect(wheelZoomScale(1, 50)).toBeLessThan(1)
  })

  it('is a no-op for deltaY 0', () => {
    expect(wheelZoomScale(1.5, 0)).toBe(1.5)
  })

  it('clamps at both ends', () => {
    expect(wheelZoomScale(1, -10000)).toBe(4)
    expect(wheelZoomScale(1, 10000)).toBe(0.5)
  })
})
