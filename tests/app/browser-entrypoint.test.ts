import { describe, expect, test } from 'vitest'

import { start } from '../../src/app/browser.js'

describe('the browser entrypoint', () => {
  // FOUNDATION-1 establishes this location; APP-1 supplies the File System
  // Access port that makes it work. Until then it must fail loudly and name
  // what is missing. A stub that quietly resolves would be exactly the
  // "optimistic status" the working agreement forbids — the shell would look
  // wired while opening nothing.
  test('refuses to start until APP-1 supplies a browser file port', () => {
    expect(() => start()).toThrowError(/APP-1/)
  })
})
