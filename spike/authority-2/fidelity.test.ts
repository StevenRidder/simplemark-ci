import { Buffer } from 'node:buffer'

import { describe, expect, test } from 'vitest'

import { FIDELITY_FIXTURES, readFixture } from '../../tests/support/fixtures.js'
import { runFixtureScenario } from './harness.js'

describe('authority fixture corpus', () => {
  test.each(FIDELITY_FIXTURES)('$id: clients converge after concurrent edits', async (fixture) => {
    const source = Buffer.from(readFixture(fixture)).toString('utf8')
    const result = await runFixtureScenario(source)

    expect(result).toMatchObject({ converged: true, appliedFromJson: true, rebased: true })
    expect(result.serialized).toContain(result.editedMarker)
    expect(result.untouchedRawBaseline).toEqual(readFixture(fixture))
  })
})
