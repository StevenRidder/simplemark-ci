import { describe, expect, test } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  FONT_FAMILIES,
  READER_THEMES,
  TEXT_SCALES,
  nextScale,
  normalisePreferences,
} from '../../src/app/reader-preferences.js'

/**
 * D6: "font family, size, line height, line width, and theme are preferences."
 * Document-level, never per selection, because per-selection typography cannot
 * be expressed in Markdown.
 *
 * Pure rules only — clamping, defaults, and validating whatever was persisted.
 * Reading and writing storage is the shell's job.
 */

describe('reader preferences', () => {
  test('defaults to the approved warm-paper look', () => {
    // §10.4: warm paper and restrained amber, serif body. The default must be
    // what the wireframe shows, not a browser default.
    expect(DEFAULT_PREFERENCES.theme).toBe('tan')
    expect(DEFAULT_PREFERENCES.family).toBe('serif')
    expect(DEFAULT_PREFERENCES.scale).toBe(1)
  })

  test('offers the three Safari-Reader backgrounds', () => {
    expect(READER_THEMES).toEqual(['white', 'tan', 'black'])
  })

  test('offers a curated set of faces, not a system font dump', () => {
    // §6: "a curated set of text faces rather than a system font dump."
    expect(FONT_FAMILIES.length).toBeGreaterThan(1)
    expect(FONT_FAMILIES.length).toBeLessThanOrEqual(6)
    expect(FONT_FAMILIES.map((f) => f.id)).toContain('serif')
  })
})

describe('nextScale', () => {
  test('steps up and down through the allowed sizes', () => {
    expect(nextScale(1, 'up')).toBeGreaterThan(1)
    expect(nextScale(1, 'down')).toBeLessThan(1)
  })

  test('clamps at both ends rather than running away', () => {
    const smallest = TEXT_SCALES[0]!
    const largest = TEXT_SCALES[TEXT_SCALES.length - 1]!
    expect(nextScale(smallest, 'down')).toBe(smallest)
    expect(nextScale(largest, 'up')).toBe(largest)
  })

  test('snaps an unrecognised scale onto the nearest allowed step', () => {
    expect(TEXT_SCALES).toContain(nextScale(1.234, 'up'))
  })
})

describe('normalisePreferences', () => {
  test('accepts a well-formed stored value', () => {
    const stored = { theme: 'black', family: 'mono', scale: TEXT_SCALES[0] }
    expect(normalisePreferences(stored)).toEqual(stored)
  })

  // Persisted preferences are untrusted input: a stale build, a hand-edited
  // localStorage, or a future version can all produce nonsense. Falling back to
  // defaults beats rendering an unreadable page.
  test.each([
    ['null', null],
    ['a string', 'tan'],
    ['an unknown theme', { theme: 'neon', family: 'serif', scale: 1 }],
    ['an unknown family', { theme: 'tan', family: 'comic', scale: 1 }],
    ['a scale outside the allowed steps', { theme: 'tan', family: 'serif', scale: 99 }],
    ['a missing field', { theme: 'tan' }],
  ])('falls back to defaults for %s', (_label, value) => {
    expect(normalisePreferences(value)).toEqual(DEFAULT_PREFERENCES)
  })
})
