import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SHARE = readFileSync('src-tauri/apple-extensions/Share/ShareViewController.swift', 'utf8')

describe('Share text intake', () => {
  it('decodes the provider text data representation before offering a draft', () => {
    expect(SHARE).toContain('loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier)')
    expect(SHARE).toContain('String(data: $0, encoding: .utf8)')
    expect(SHARE).toContain('Save as SimpleMark draft')
    expect(SHARE).toContain('Saved for SimpleMark. Open SimpleMark to choose where to place it.')
  })
})
