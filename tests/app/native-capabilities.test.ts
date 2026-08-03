import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface NativeCapability {
  windows: string[]
  permissions: string[]
}

const capability = JSON.parse(
  readFileSync(join(process.cwd(), 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
) as NativeCapability

describe('native window capabilities', () => {
  it('authorises the explicit title-bar operations used by the macOS shell', () => {
    expect(capability.windows).toContain('main')
    expect(capability.permissions).toContain('core:window:allow-start-dragging')
    expect(capability.permissions).toContain('core:window:allow-toggle-maximize')
    expect(capability.permissions).toContain('dialog:allow-save')
    expect(capability.permissions).toContain('clipboard-manager:allow-write-text')
  })
})
