import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const IOS_INFO = readFileSync('src-tauri/Info.ios.plist', 'utf8')

describe('iOS Markdown type ownership', () => {
  it('exports Markdown as a public plain-text document type', () => {
    expect(IOS_INFO).toContain('<key>UTExportedTypeDeclarations</key>')
    expect(IOS_INFO).toContain('<string>net.daringfireball.markdown</string>')
    expect(IOS_INFO).toContain('<string>public.plain-text</string>')
    expect(IOS_INFO).toContain('<string>md</string>')
    expect(IOS_INFO).toContain('<string>markdown</string>')
  })
})
