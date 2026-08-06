import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const ICON_IDS = [
  'original',
  'live-layers',
  'movable-blocks',
  'midnight',
  'blue-page',
] as const

const alternate = (path: string): string =>
  resolve(process.cwd(), 'src-tauri', 'icons', 'alternates', path)

describe('alternate app icon assets', () => {
  test('ships a vector master and generated PNG for every offered icon', () => {
    for (const id of ICON_IDS) {
      const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
      expect(svg, `${id} must stay fully vector`).not.toMatch(/<image\b|data:image|<text\b/i)
      expect(statSync(alternate(`png/${id}.png`)).size, `${id} PNG must not be empty`)
        .toBeGreaterThan(0)
    }
  })

  test.each(['live-layers', 'blue-page'])(
    '%s uses the approved pure-white tile instead of warm white',
    (id) => {
      const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
      expect(svg).toContain('data-tile-background="#FFFFFF"')
    },
  )
})
