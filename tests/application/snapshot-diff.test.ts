import { describe, expect, test } from 'vitest'

import { changedBlockCount, diffBlocks } from '../../src/application/index.js'

/**
 * ADR-0014 §5: Compare is block-level. The cases are the questions a person
 * asks of a snapshot — what was added, what was removed, what merely moved.
 */

describe('diffBlocks', () => {
  test('identical texts are all kept', () => {
    const text = '# Title\n\nOne.\n\nTwo.'
    expect(diffBlocks(text, text).every((change) => change.kind === 'same')).toBe(true)
    expect(changedBlockCount(diffBlocks(text, text))).toBe(0)
  })

  test('an inserted paragraph is reported in place', () => {
    const before = 'One.\n\nThree.'
    const after = 'One.\n\nTwo.\n\nThree.'
    expect(diffBlocks(before, after)).toEqual([
      { kind: 'same', text: 'One.' },
      { kind: 'added', text: 'Two.' },
      { kind: 'same', text: 'Three.' },
    ])
  })

  test('a rewritten paragraph reads as removed then added', () => {
    const changes = diffBlocks('One.\n\nOld two.', 'One.\n\nNew two.')
    expect(changes.map((change) => change.kind)).toEqual(['same', 'removed', 'added'])
    expect(changedBlockCount(changes)).toBe(2)
  })

  test('line endings and trailing whitespace do not count as change', () => {
    expect(changedBlockCount(diffBlocks('A.\r\n\r\nB.  ', 'A.\n\nB.'))).toBe(0)
  })

  test('a deleted tail is reported as removed', () => {
    expect(diffBlocks('A.\n\nB.\n\nC.', 'A.')).toEqual([
      { kind: 'same', text: 'A.' },
      { kind: 'removed', text: 'B.' },
      { kind: 'removed', text: 'C.' },
    ])
  })
})
