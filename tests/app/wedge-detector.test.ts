import { describe, expect, test } from 'vitest'

import { createWedgeDetector } from '../../src/app/wedge-detector.js'

/**
 * BUG-13. The thresholds are the product decision here: what reads as "the
 * renderer is starved" versus ordinary life — a GC pause, a resize, a giant
 * paste, a backgrounded tab. Each case below is one of those lives.
 */

describe('wedge detector', () => {
  test('healthy frames never wedge', () => {
    const detector = createWedgeDetector()
    let now = 0
    for (let i = 0; i < 2_000; i += 1) {
      now += 16
      expect(detector.observeFrame(now, true)).toBe(false)
    }
  })

  test('a drumbeat of multi-second stalls on an idle page is a wedge', () => {
    const detector = createWedgeDetector()
    let now = 0
    detector.observeFrame(now, true)
    for (let i = 0; i < 3; i += 1) {
      now += 3_000 // the storm: seconds between frames
      detector.observeFrame(now, true)
      now += 16
      detector.observeFrame(now, true)
    }
    expect(detector.isWedged()).toBe(true)
  })

  test('one long pause is a GC or a resize, not a wedge', () => {
    const detector = createWedgeDetector()
    detector.observeFrame(0, true)
    detector.observeFrame(4_000, true)
    let now = 4_000
    for (let i = 0; i < 100; i += 1) {
      now += 16
      detector.observeFrame(now, true)
    }
    expect(detector.isWedged()).toBe(false)
  })

  test('stalls right after input are excused — heavy work the user asked for', () => {
    const detector = createWedgeDetector()
    let now = 0
    detector.observeFrame(now, true)
    for (let i = 0; i < 5; i += 1) {
      detector.observeInput(now + 10) // paste lands, then the frame stalls
      now += 3_000
      detector.observeFrame(now, true)
    }
    expect(detector.isWedged()).toBe(false)
  })

  test('a background tab throttling rAF never wedges', () => {
    const detector = createWedgeDetector()
    let now = 0
    detector.observeFrame(now, true)
    for (let i = 0; i < 10; i += 1) {
      now += 5_000
      detector.observeFrame(now, false) // hidden: rAF throttled by the browser
    }
    expect(detector.isWedged()).toBe(false)
    // And the first frame after unhiding does not count the hidden gap.
    now += 5_000
    expect(detector.observeFrame(now, true)).toBe(false)
    now += 16
    expect(detector.observeFrame(now, true)).toBe(false)
  })

  test('stalls must cluster — three spread over minutes are three hiccups', () => {
    const detector = createWedgeDetector()
    let now = 0
    detector.observeFrame(now, true)
    for (let i = 0; i < 3; i += 1) {
      now += 3_000
      detector.observeFrame(now, true)
      now += 60_000 // a minute of health between stalls
      let t = now
      for (let f = 0; f < 10; f += 1) {
        t += 16
        detector.observeFrame(t, true)
      }
      now = t
    }
    expect(detector.isWedged()).toBe(false)
  })

  test('reset clears a wedge after recovery', () => {
    const detector = createWedgeDetector()
    let now = 0
    detector.observeFrame(now, true)
    for (let i = 0; i < 3; i += 1) {
      now += 2_000
      detector.observeFrame(now, true)
    }
    expect(detector.isWedged()).toBe(true)
    detector.reset()
    expect(detector.isWedged()).toBe(false)
  })
})
