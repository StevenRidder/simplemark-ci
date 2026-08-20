/**
 * Detects a starved renderer (BUG-13).
 *
 * The failure this exists for: the WebContent process pinned at 100% CPU
 * answering an external accessibility client's queries, starving every
 * interaction — cursor, selection, right-click — for as long as the app
 * lived. Nothing on screen said anything; the only recovery was folklore
 * ("quit and reopen"). Failures must be visible and local, and a wedge only a
 * diagnostician can even see fails that rule.
 *
 * The observable from inside the page is `requestAnimationFrame` starvation:
 * an idle, visible document whose frame callbacks arrive seconds apart. The
 * detector is a pure state machine over timestamps so the thresholds are
 * testable without an animation loop:
 *
 * - A **stall** is a frame gap over `stallMs` while the page was visible and
 *   no input arrived just before it — input can legitimately buy work, and a
 *   giant paste must not read as a wedge.
 * - **Wedged** is `stallCount` stalls inside `windowMs`. One stall is a GC
 *   pause or a window resize; a drumbeat of multi-second stalls on an idle
 *   page is the storm.
 */

export interface WedgeDetectorOptions {
  /** A frame gap this long is a stall. Ordinary frames are 6–33ms. */
  readonly stallMs?: number
  /** Input within this window before a stall excuses it. */
  readonly inputGraceMs?: number
  /** Stalls must cluster inside this window to count as a wedge. */
  readonly windowMs?: number
  /** How many clustered stalls make a wedge. */
  readonly stallCount?: number
}

export interface WedgeDetector {
  /** Feed every animation frame's timestamp. Returns true when wedged. */
  observeFrame(nowMs: number, visible: boolean): boolean
  /** Feed user input timestamps (keys, pointer). */
  observeInput(nowMs: number): void
  /** True once the wedge threshold has been crossed. */
  isWedged(): boolean
  /** Clears state — after recovery, or when the page is hidden. */
  reset(): void
}

export function createWedgeDetector(options: WedgeDetectorOptions = {}): WedgeDetector {
  const stallMs = options.stallMs ?? 1_000
  const inputGraceMs = options.inputGraceMs ?? 500
  const windowMs = options.windowMs ?? 20_000
  const stallCount = options.stallCount ?? 3

  let lastFrame: number | undefined
  let lastInput = Number.NEGATIVE_INFINITY
  let stalls: number[] = []
  let wedged = false

  return {
    observeFrame(nowMs, visible) {
      const previous = lastFrame
      lastFrame = nowMs
      // A hidden page throttles rAF legitimately — a background tab must never
      // read as a wedge, and the first frame after unhiding starts fresh.
      if (!visible) {
        stalls = []
        lastFrame = undefined
        return wedged
      }
      if (previous === undefined) return wedged

      const gap = nowMs - previous
      const inputExcused = previous - lastInput <= inputGraceMs
      if (gap >= stallMs && !inputExcused) {
        stalls.push(nowMs)
        stalls = stalls.filter((at) => nowMs - at <= windowMs)
        if (stalls.length >= stallCount) wedged = true
      }
      return wedged
    },
    observeInput(nowMs) {
      lastInput = nowMs
    },
    isWedged: () => wedged,
    reset() {
      wedged = false
      stalls = []
      lastFrame = undefined
    },
  }
}
