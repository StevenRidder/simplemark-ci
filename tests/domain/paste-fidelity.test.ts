import { describe, expect, it } from 'vitest'

import { pastedTextIsComplete } from '../../src/domain/index.js'

describe('rich paste text fidelity', () => {
  it('accepts formatting-only whitespace differences', () => {
    expect(
      pastedTextIsComplete(
        'The complete\nselection has two paragraphs.',
        'The complete\u00a0selection\n\nhas two paragraphs.',
      ),
    ).toBe(true)
  })

  it('ignores host-only zero-width layout characters', () => {
    expect(pastedTextIsComplete('onetwo', 'one\u200btwo')).toBe(true)
  })

  it('rejects the BUG-8 middle-paragraph collapse', () => {
    expect(
      pastedTextIsComplete(
        'BEGIN first paragraph One active MIDMARK registration SOURCES final paragraph',
        'One active MIDMARK registration',
      ),
    ).toBe(false)
  })

  it('rejects extra visible text as a lossy rich interpretation', () => {
    expect(pastedTextIsComplete('editable source', 'editable source rendered duplicate')).toBe(false)
  })
})
