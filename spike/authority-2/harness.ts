import {
  config,
  init,
  parser,
  parserCtx,
  schema,
  schemaCtx,
  serializer,
  serializerCtx,
} from '@milkdown/kit/core'
import { Clock, Container, Ctx, type MilkdownPlugin } from '@milkdown/kit/ctx'
import { gfm } from '@milkdown/kit/preset/gfm'
import { commonmark, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model'
import { Mapping, Step, Transform } from '@milkdown/kit/prose/transform'
import type { Editor } from '@milkdown/kit/core'

import { calloutRemark, calloutSchema } from '../../src/adapters/editor/callout.js'
import { codeBlockMetaSchema } from '../../src/adapters/editor/code-fence-meta.js'
import { highlightRemark, highlightSchema } from '../../src/adapters/editor/highlight-mark.js'
import { inlineMathSchema } from '../../src/adapters/editor/inline-math.js'
import { largeTableRemark, largeTableSchema } from '../../src/adapters/editor/large-table.js'
import { mathBlockSchema, mathRemark } from '../../src/adapters/editor/math-block.js'
import { wikiLinkSchema, wikiRemark } from '../../src/adapters/editor/wiki-link.js'

export type ApplyResult =
  | { readonly ok: true; readonly doc: ProseNode; readonly stepsJson: readonly unknown[] }
  | { readonly ok: false; readonly kind: 'invalid_step' | 'invalid_schema' | 'rebase_failed' }

export type RebaseResult = ApplyResult

export interface AuthorityHarness {
  parse(markdown: string): ProseNode
  serialize(doc: ProseNode): string
  apply(doc: ProseNode, stepsJson: readonly unknown[]): ApplyResult
  rebase(base: ProseNode, local: readonly unknown[], committed: readonly unknown[]): RebaseResult
  destroy(): Promise<void>
}

export interface FixtureScenarioResult {
  readonly converged: boolean
  readonly appliedFromJson: boolean
  readonly rebased: boolean
  readonly serialized: string
  readonly editedMarker: string
  /**
   * The original decoded input, re-encoded without ever passing through the
   * Markdown serializer. Callers compare this to their raw fixture bytes; the
   * serializer's output is deliberately not a preservation claim.
   */
  readonly untouchedRawBaseline: Uint8Array
}

interface HeadlessMilkdown {
  readonly ctx: Ctx
  readonly schema: Schema
  readonly destroy: () => Promise<void>
}

/**
 * The locked preset bundles also publish commands, keymaps, input rules, paste
 * rules, and view plugins. This spike needs only their schema and remark
 * entries; retaining precisely those slices keeps the parser real but avoids
 * creating interaction contexts.
 */
const commonmarkParserPlugins = [
  ...commonmark.slice(0, 48),
  ...commonmark.slice(111, 123),
]

const gfmParserPlugins = [
  ...gfm.slice(0, 19),
  ...gfm.slice(45, 47),
]

/**
 * Milkdown's stock paragraph serializer reads editorViewCtx solely to decide
 * whether a non-final empty paragraph needs an HTML line break. A headless
 * parser intentionally has no editor-view context, so retain ordinary
 * paragraph serialisation without that view-only empty-line preservation.
 */
const headlessParagraphSchema = paragraphSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx)
  return {
    ...base,
    toMarkdown: {
      match: (node) => node.type.name === 'paragraph',
      runner: (state, node) => {
        state.openNode('paragraph')
        state.next(node.content)
        state.closeNode()
      },
    },
  }
})

/**
 * Milkdown's timer clock signals through browser-style global events. Node has
 * EventTarget but no global dispatchEvent, so provide only that event surface;
 * this does not create a document, element, selection, or editor view.
 */
const CLOCK_EVENT_KEYS = ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const
type ClockEventKey = (typeof CLOCK_EVENT_KEYS)[number]

let clockEvents: {
  readonly descriptors: ReadonlyMap<ClockEventKey, PropertyDescriptor | undefined>
  owners: number
} | undefined

function installClockEventTarget(): () => void {
  if (clockEvents === undefined) {
    if (typeof globalThis.dispatchEvent === 'function') return () => undefined

    const target = new EventTarget()
    const descriptors = new Map<ClockEventKey, PropertyDescriptor | undefined>(
      CLOCK_EVENT_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    )
    globalThis.addEventListener = target.addEventListener.bind(target)
    globalThis.removeEventListener = target.removeEventListener.bind(target)
    globalThis.dispatchEvent = target.dispatchEvent.bind(target)
    clockEvents = { descriptors, owners: 0 }
  }

  clockEvents.owners += 1
  let released = false
  return () => {
    if (released || clockEvents === undefined) return
    released = true
    clockEvents.owners -= 1
    if (clockEvents.owners !== 0) return

    for (const key of CLOCK_EVENT_KEYS) {
      const descriptor = clockEvents.descriptors.get(key)
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
      else Object.defineProperty(globalThis, key, descriptor)
    }
    clockEvents = undefined
  }
}

/**
 * Runs Milkdown's public parser/schema/serializer lifecycle without its editor
 * state or editor view plugins. The real adapter's schema extensions are used
 * directly, so the spike does not approximate the production Markdown shape.
 */
async function createHeadlessMilkdown(): Promise<HeadlessMilkdown> {
  const releaseClockEvents = installClockEventTarget()
  const ctx = new Ctx(new Container(), new Clock())
  const plugins = [
    config(() => undefined),
    init({} as Editor),
    schema,
    parser,
    serializer,
    commonmarkParserPlugins,
    headlessParagraphSchema,
    highlightRemark,
    highlightSchema,
    gfmParserPlugins,
    mathRemark,
    inlineMathSchema,
    mathBlockSchema,
    largeTableRemark,
    largeTableSchema,
    wikiRemark,
    wikiLinkSchema,
    calloutRemark,
    calloutSchema,
    codeBlockMetaSchema,
  ].flat(2) as readonly MilkdownPlugin[]

  const cleanups = await Promise.all(
    plugins.map(async (plugin) => plugin(ctx)()),
  )

  return {
    ctx,
    schema: ctx.get(schemaCtx),
    destroy: async () => {
      try {
        await Promise.all(cleanups.reverse().map(async (cleanup) => cleanup?.()))
      } finally {
        releaseClockEvents()
      }
    },
  }
}

function hasValidContent(doc: ProseNode): boolean {
  return doc.type.validContent(doc.content)
}

function decodeSteps(schema: Schema, stepsJson: readonly unknown[]): Step[] | null {
  try {
    return stepsJson.map((stepJson) => Step.fromJSON(schema, stepJson))
  } catch {
    return null
  }
}

function applySteps(doc: ProseNode, steps: readonly Step[]): ProseNode | null {
  let next = doc
  for (const step of steps) {
    const result = step.apply(next)
    if (result.failed !== null || result.doc === null) return null
    next = result.doc
  }
  return next
}

function editableTextEnds(doc: ProseNode): readonly number[] {
  const ends: number[] = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text?.trim().length) ends.push(pos + node.nodeSize)
    return true
  })
  return ends
}

function insertionStepJson(doc: ProseNode, position: number, marker: string): readonly unknown[] {
  return new Transform(doc).insert(position, doc.type.schema.text(marker)).steps.map((step) => step.toJSON())
}

/**
 * Exercises the headless public authority API with two logical clients. The
 * raw baseline is a separate record only: Milkdown serialization is expected
 * to normalize Markdown and is never compared for byte equality here.
 */
export async function runFixtureScenario(source: string): Promise<FixtureScenarioResult> {
  const harness = await createAuthorityHarness()
  const editedMarker = ' authority-2-step'
  const untouchedRawBaseline = new TextEncoder().encode(source)

  try {
    const base = harness.parse(source)
    const ends = editableTextEnds(base)
    const first = ends[0]
    const last = ends.at(-1)
    if (first === undefined || last === undefined) {
      throw new Error('Fixture has no editable text locations')
    }

    const local = insertionStepJson(base, first, editedMarker)
    const committed = insertionStepJson(base, last, editedMarker)
    const localApplied = harness.apply(base, local)
    const committedApplied = harness.apply(base, committed)
    const committedThenLocal = harness.rebase(base, local, committed)
    const localThenCommitted = harness.rebase(base, committed, local)

    const rebased = committedThenLocal.ok && localThenCommitted.ok
    const converged = rebased
      && committedThenLocal.doc.eq(localThenCommitted.doc)

    return {
      converged,
      appliedFromJson: localApplied.ok && committedApplied.ok,
      rebased,
      serialized: committedThenLocal.ok ? harness.serialize(committedThenLocal.doc) : '',
      editedMarker,
      untouchedRawBaseline,
    }
  } finally {
    await harness.destroy()
  }
}

export async function createAuthorityHarness(): Promise<AuthorityHarness> {
  const milkdown = await createHeadlessMilkdown()
  const parseMarkdown = milkdown.ctx.get(parserCtx)
  const serializeMarkdown = milkdown.ctx.get(serializerCtx)

  let destroyed = false
  return {
    parse: (markdown) => parseMarkdown(markdown),
    serialize: (doc) => serializeMarkdown(doc),
    apply: (doc, stepsJson) => {
      if (!hasValidContent(doc)) return { ok: false, kind: 'invalid_schema' }

      const steps = decodeSteps(milkdown.schema, stepsJson)
      if (steps === null) return { ok: false, kind: 'invalid_step' }

      const next = applySteps(doc, steps)
      if (next === null) return { ok: false, kind: 'invalid_step' }

      if (!hasValidContent(next)) return { ok: false, kind: 'invalid_schema' }
      return { ok: true, doc: next, stepsJson }
    },
    rebase: (base, local, committed) => {
      if (!hasValidContent(base)) return { ok: false, kind: 'invalid_schema' }

      const localSteps = decodeSteps(milkdown.schema, local)
      const committedSteps = decodeSteps(milkdown.schema, committed)
      if (localSteps === null || committedSteps === null) return { ok: false, kind: 'invalid_step' }

      const committedDoc = applySteps(base, committedSteps)
      if (committedDoc === null) return { ok: false, kind: 'invalid_step' }
      if (!hasValidContent(committedDoc)) return { ok: false, kind: 'invalid_schema' }

      const mapping = new Mapping()
      for (const step of committedSteps) mapping.appendMap(step.getMap())
      const mappedSteps: Step[] = []
      for (const step of localSteps) {
        const mapped = step.map(mapping)
        if (mapped === null) return { ok: false, kind: 'rebase_failed' }
        mappedSteps.push(mapped)
      }

      const rebasedDoc = applySteps(committedDoc, mappedSteps)
      if (rebasedDoc === null) return { ok: false, kind: 'rebase_failed' }
      if (!hasValidContent(rebasedDoc)) return { ok: false, kind: 'invalid_schema' }
      return { ok: true, doc: rebasedDoc, stepsJson: mappedSteps.map((step) => step.toJSON()) }
    },
    destroy: async () => {
      if (destroyed) return
      destroyed = true
      await milkdown.destroy()
    },
  }
}
