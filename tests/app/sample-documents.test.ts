import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SAMPLE_DOCUMENTS,
  WELCOME_SAMPLE,
  sampleDocument,
} from '../../src/app/sample-documents.js'

describe('default sample documents', () => {
  it('publishes the approved pair in landing order', () => {
    expect(SAMPLE_DOCUMENTS.map(({ id, name, title }) => ({ id, name, title }))).toEqual([
      {
        id: 'welcome-to-simplemark',
        name: 'welcome-to-simplemark.md',
        title: 'Welcome to SimpleMark',
      },
      {
        id: 'project-tanoa',
        name: 'project-tanoa.md',
        title: 'Project Tanoa',
      },
    ])
    expect(WELCOME_SAMPLE).toBe(SAMPLE_DOCUMENTS[0])
  })

  it('serves the exact canonical Markdown bytes', () => {
    for (const sample of SAMPLE_DOCUMENTS) {
      expect(sample.markdown).toBe(readFileSync(resolve('docs/showcase', sample.name), 'utf8'))
      expect(sample.updatedLabel).toBe('Sample')
    }
  })

  it('looks up known samples without inventing a fallback', () => {
    expect(sampleDocument('project-tanoa')?.title).toBe('Project Tanoa')
    expect(sampleDocument('missing')).toBeUndefined()
  })
})
