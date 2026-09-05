import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const ICON_IDS = [
  'original',
  'live-layers',
  'movable-blocks',
  'blue-trio',
  'electric-blocks',
  'midnight',
  'blue-page',
] as const

const alternate = (path: string): string =>
  resolve(process.cwd(), 'src-tauri', 'icons', 'alternates', path)

const native = (path: string): string => resolve(process.cwd(), 'src-tauri', 'icons', path)

describe('alternate app icon assets', () => {
  test('ships a vector master and generated PNG for every offered icon', () => {
    for (const id of ICON_IDS) {
      const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
      expect(svg, `${id} must stay fully vector`).not.toMatch(/<image\b|data:image|<text\b/i)
      expect(statSync(alternate(`png/${id}.png`)).size, `${id} PNG must not be empty`)
        .toBeGreaterThan(0)
    }
  })

  test.each(['live-layers', 'blue-trio', 'electric-blocks', 'blue-page'])(
    '%s uses the approved pure-white tile instead of warm white',
    (id) => {
      const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
      expect(svg).toContain('data-tile-background="#FFFFFF"')
    },
  )

  test('uses the approved palettes for both blue block treatments', () => {
    const trio = readFileSync(alternate('blue-trio.svg'), 'utf8')
    const electric = readFileSync(alternate('electric-blocks.svg'), 'utf8')

    expect(trio).toContain('data-block-palette="royal-sky-cyan"')
    expect(electric).toContain('data-block-palette="clear-azure-charcoal-charcoal"')
  })

  test('keeps the Clear Azure palette on the chooser alternate', () => {
    const svg = readFileSync(alternate('electric-blocks.svg'), 'utf8')
    expect(svg, 'electric-blocks must use the approved light endpoint').toContain('#168CFF')
    expect(svg, 'electric-blocks must use the approved deep endpoint').toContain('#0064E8')
    expect(svg, 'electric-blocks must not retain the violet endpoint').not.toContain('#1548E7')
  })

  test('keeps the glass Movable Blocks palette aligned across desktop and iOS masters', () => {
    for (const source of [native('icon.svg'), native('ios-icon.svg')]) {
      const svg = readFileSync(source, 'utf8')
      expect(svg, `${source} must start on the ocean light endpoint`).toContain('#38B6FF')
      expect(svg, `${source} must pass through the ocean mid stop`).toContain('#1A6DFF')
      expect(svg, `${source} must end on the ocean deep endpoint`).toContain('#3D2BFF')
      expect(svg, `${source} must stay fully vector`).not.toMatch(/<image\b|data:image|<text\b/i)
    }
    const desktop = readFileSync(native('icon.svg'), 'utf8')
    const ios = readFileSync(native('ios-icon.svg'), 'utf8')
    expect(desktop, 'the desktop master draws its own rounded tile').toContain('rx="206"')
    expect(ios, 'the iOS master runs full-bleed for the platform mask').toContain('<rect width="1024" height="1024"')
  })

  test('centres the Live Layers MDown mark on its front panel', () => {
    const svg = readFileSync(alternate('live-layers.svg'), 'utf8')

    expect(svg).toContain('data-mark-offset-x="-24"')
    expect(svg).toContain('transform="translate(-24 0)"')
  })
})
