/**
 * EDITOR-17 step one: does Vega draw under the packaged CSP?
 *
 * Vega compiles spec expressions with the `Function` constructor. The packaged
 * policy is `default-src 'self'` with no `'unsafe-eval'`, so the default path
 * should fail here. Vega's documented answer is to parse expressions to an AST
 * and evaluate them with `vega-interpreter` instead.
 *
 * This page runs BOTH paths and prints a verdict, because "the fix works" is
 * only half the evidence — we also want to see the unfixed path fail, or we
 * have not actually tested anything.
 *
 * The spec carries a `calculate` transform on purpose: that is what forces
 * expression evaluation. A spec of pure marks and encodings would pass even
 * with codegen broken, and prove nothing.
 */
import { compile } from 'vega-lite'
import { parse, View } from 'vega'
import { expressionInterpreter } from 'vega-interpreter'

const SPEC = {
  $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
  data: {
    values: [
      { slot: 1, hit: 0.94 },
      { slot: 2, hit: 0.91 },
      { slot: 3, hit: 0.88 },
      { slot: 4, hit: 0.72 },
    ],
  },
  transform: [{ calculate: 'datum.hit * 100', as: 'percent' }],
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'slot', type: 'ordinal' },
    y: { field: 'percent', type: 'quantitative' },
  },
}

type Outcome = { ok: true; svg: string } | { ok: false; error: string }

async function render(useInterpreter: boolean): Promise<Outcome> {
  try {
    const vega = compile(SPEC as Parameters<typeof compile>[0]).spec
    const runtime = parse(vega, {}, useInterpreter ? { ast: true } : {})
    const view = new View(runtime, {
      renderer: 'none',
      ...(useInterpreter ? { expr: expressionInterpreter } : {}),
    })
    const svg = await view.toSVG()
    return { ok: true, svg }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const verdict = document.querySelector('#verdict')
const chart = document.querySelector('#chart')

const codegen = await render(false)
const interpreted = await render(true)

/** The bar heights differ per datum, so identical output means both really ran. */
const summary = {
  codegen: codegen.ok ? `rendered ${codegen.svg.length} bytes` : `FAILED: ${codegen.error}`,
  interpreter: interpreted.ok
    ? `rendered ${interpreted.svg.length} bytes`
    : `FAILED: ${interpreted.error}`,
  sameOutput: codegen.ok && interpreted.ok ? codegen.svg === interpreted.svg : null,
  barsDrawn: interpreted.ok ? (interpreted.svg.match(/<path/g) ?? []).length : 0,
}

if (verdict) verdict.textContent = JSON.stringify(summary, null, 2)
if (chart && interpreted.ok) chart.innerHTML = interpreted.svg

console.log('VEGA_CSP_VERDICT', JSON.stringify(summary))
