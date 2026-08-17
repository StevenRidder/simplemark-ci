import { describe, expect, it } from 'vitest'

import { splitClosedFrontMatter } from '../../src/domain/index.js'

describe('splitClosedFrontMatter', () => {
  it('leaves a document without a closed YAML fence alone', () => {
    expect(splitClosedFrontMatter('# Title\n')).toEqual({
      matter: '',
      body: '# Title\n',
    })
  })

  it('does not treat a thematic break as front matter', () => {
    const source = '---\n\n# Title\n'
    expect(splitClosedFrontMatter(source)).toEqual({ matter: '', body: source })
  })

  it('peels a closed id block so the living document never shows it', () => {
    expect(splitClosedFrontMatter('---\nid: abc\n---\n\n# Title\n')).toEqual({
      matter: '---\nid: abc\n---\n\n',
      body: '# Title\n',
    })
  })

  it('peels a comments link with the id block', () => {
    const source = '---\nid: abc\ncomments: .simplemark/abc.json\n---\n\nBody.\n'
    expect(splitClosedFrontMatter(source)).toEqual({
      matter: '---\nid: abc\ncomments: .simplemark/abc.json\n---\n\n',
      body: 'Body.\n',
    })
  })
})
