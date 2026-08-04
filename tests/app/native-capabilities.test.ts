import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface NativeCapability {
  windows: string[]
  permissions: string[]
}

interface NativeConfig {
  app: { windows: Array<{ trafficLightPosition?: { x: number; y: number } }> }
}

const capability = JSON.parse(
  readFileSync(join(process.cwd(), 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
) as NativeCapability
const config = JSON.parse(
  readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
) as NativeConfig

describe('native window capabilities', () => {
  it('authorises the explicit title-bar operations used by the macOS shell', () => {
    expect(capability.windows).toContain('main')
    expect(capability.permissions).toContain('core:window:allow-start-dragging')
    expect(capability.permissions).toContain('core:window:allow-toggle-maximize')
    expect(capability.permissions).toContain('dialog:allow-save')
    expect(capability.permissions).toContain('clipboard-manager:allow-write-text')
  })

  it('centres the macOS traffic lights in the 58px pane header', () => {
    expect(config.app.windows[0]?.trafficLightPosition).toEqual({ x: 18, y: 32 })
  })
})
