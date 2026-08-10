import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TAO_SCENE = readFileSync('src-tauri/vendor/tao/src/platform_impl/ios/app_state.rs', 'utf8')

describe('iOS document open during cold launch', () => {
  it('forwards the first scene connection URL to the runtime open event', () => {
    const connectScene = TAO_SCENE.slice(
      TAO_SCENE.indexOf('pub unsafe fn connect_scene'),
      TAO_SCENE.indexOf('\npub unsafe fn register_window_for_scene'),
    )

    expect(connectScene).toMatch(/options\s*\.URLContexts\(\)/u)
    expect(connectScene).toContain('Event::Opened { urls }')
  })
})
