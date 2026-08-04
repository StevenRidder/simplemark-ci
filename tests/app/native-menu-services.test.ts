import { describe, expect, it } from 'vitest'

import { MACOS_TEXT_SERVICE_MENUS } from '../../src/app/ui/native-menu.js'

describe('native macOS service menu contract', () => {
  it('routes language and speech features to named platform services', () => {
    expect(MACOS_TEXT_SERVICE_MENUS.map((menu) => menu.label)).toEqual([
      'Spelling and Grammar',
      'Substitutions',
      'Speech',
    ])
    const ids = MACOS_TEXT_SERVICE_MENUS.flatMap((menu) => menu.items.map((item) => item.id))
    expect(ids).toEqual([
      'show_spelling_and_grammar',
      'check_spelling',
      'toggle_continuous_spell_checking',
      'toggle_grammar_checking',
      'show_substitutions',
      'toggle_smart_quotes',
      'toggle_smart_dashes',
      'toggle_text_replacement',
      'start_speaking',
      'stop_speaking',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
