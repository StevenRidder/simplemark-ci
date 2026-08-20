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
import { DOMSerializer, Slice, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import { Mapping, Step, Transform } from '@milkdown/kit/prose/transform'
import type { Editor } from '@milkdown/kit/core'

import type {
  MarkdownStepResult,
  StepApplicationResult,
  StepBatch,
  StepDocumentPort,
  StepDocumentRange,
  StepJson,
} from '../../application/index.js'
import { calloutRemark, calloutSchema } from './callout.js'
import { codeBlockMetaSchema } from './code-fence-meta.js'
import { highlightRemark, highlightSchema } from './highlight-mark.js'
import { inlineMathSchema } from './inline-math.js'
import { largeTableRemark, largeTableSchema } from './large-table.js'
import { mathBlockSchema, mathRemark } from './math-block.js'
import { underlineRemark, underlineSchema } from './underline-mark.js'
import { wikiLinkSchema, wikiRemark } from './wiki-link.js'

/** A lifecycle-owning editor adapter with the application-only port it supplies. */
export interface StepDocumentAdapter {
  readonly port: StepDocumentPort
  /**
   * Markdown as DOM, through the document's own parser and schema (ADR-0012 §5).
   *
   * Deliberately not on `StepDocumentPort`: that is an application port, and
   * application code may not touch the DOM. It is on the adapter, which the
   * composition root already holds.
   *
   * "The document's own pipeline" is meant literally — the same `parserCtx` and
   * the same schema the editor serialises through, so a table, a callout or an
   * inline maths span in a conversation message renders exactly as it would in
   * the note. A second Markdown renderer would drift from the first, and a
   * message that renders differently from the document is a lie about what the
   * agent was asked to write.
   */
  renderMarkdown(markdown: string): DocumentFragment
  destroy(): Promise<void>
}

interface HeadlessMilkdown {
  readonly ctx: Ctx
  readonly schema: Schema
  destroy(): Promise<void>
}

const commonmarkParserPlugins = [
  ...commonmark.slice(0, 48),
  ...commonmark.slice(111, 123),
]

const gfmParserPlugins = [
  ...gfm.slice(0, 19),
  ...gfm.slice(45, 47),
]

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

const CLOCK_EVENT_KEYS = ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const
type ClockEventKey = (typeof CLOCK_EVENT_KEYS)[number]
const CLOCK_TIMER_GRACE_MS = 3_100

let clockEvents: {
  readonly descriptors: ReadonlyMap<ClockEventKey, PropertyDescriptor | undefined>
  owners: number
  restoreTimer: ReturnType<typeof setTimeout> | undefined
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
    clockEvents = { descriptors, owners: 0, restoreTimer: undefined }
  }

  if (clockEvents.restoreTimer !== undefined) {
    clearTimeout(clockEvents.restoreTimer)
    clockEvents.restoreTimer = undefined
  }
  clockEvents.owners += 1
  let released = false
  return () => {
    if (released || clockEvents === undefined) return
    released = true
    clockEvents.owners -= 1
    if (clockEvents.owners !== 0) return

    const events = clockEvents
    events.restoreTimer = setTimeout(() => {
      if (clockEvents !== events || events.owners !== 0) return
      for (const key of CLOCK_EVENT_KEYS) {
        const descriptor = events.descriptors.get(key)
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
        else Object.defineProperty(globalThis, key, descriptor)
      }
      clockEvents = undefined
    }, CLOCK_TIMER_GRACE_MS)
  }
}

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
    underlineRemark,
    underlineSchema,
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

  const cleanups = await Promise.all(plugins.map(async (plugin) => plugin(ctx)()))

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

function decodeSteps(schema: Schema, stepsJson: StepBatch): Step[] | null {
  try {
    return stepsJson.map((stepJson) => Step.fromJSON(schema, stepJson))
  } catch {
    return null
  }
}

function decodeBatches(schema: Schema, batches: readonly StepBatch[]): Step[] | null {
  const decoded: Step[] = []
  for (const batch of batches) {
    const steps = decodeSteps(schema, batch)
    if (steps === null) return null
    decoded.push(...steps)
  }
  return decoded
}

type AppliedSteps =
  | { readonly ok: true; readonly doc: ProseNode }
  | { readonly ok: false; readonly kind: 'invalid_step' | 'invalid_schema' }

function applySteps(doc: ProseNode, steps: readonly Step[]): AppliedSteps {
  let next = doc
  for (const step of steps) {
    const result = step.apply(next)
    if (result.failed !== null || result.doc === null) {
      return {
        ok: false,
        kind: result.failed?.startsWith('Invalid content') === true ? 'invalid_schema' : 'invalid_step',
      }
    }
    next = result.doc
  }
  return { ok: true, doc: next }
}

function stepFailureKind(failed: string | null): 'invalid_step' | 'invalid_schema' {
  return failed?.startsWith('Invalid content') === true ? 'invalid_schema' : 'invalid_step'
}

function validDocument(doc: ProseNode): boolean {
  return doc.type.validContent(doc.content)
}

function toStepBatch(steps: readonly Step[]): StepBatch {
  return steps.map((step) => step.toJSON() as StepJson)
}

class MilkdownStepDocumentPort implements StepDocumentPort {
  readonly #parse: (markdown: string) => ProseNode
  readonly #serialize: (doc: ProseNode) => string

  constructor(private readonly milkdown: HeadlessMilkdown) {
    this.#parse = milkdown.ctx.get(parserCtx)
    this.#serialize = milkdown.ctx.get(serializerCtx)
  }

  applySteps(markdown: string, stepsJson: StepBatch): StepApplicationResult {
    const doc = this.#parse(markdown)
    if (!validDocument(doc)) return { ok: false, kind: 'invalid_schema' }

    const steps = decodeSteps(this.milkdown.schema, stepsJson)
    if (steps === null) return { ok: false, kind: 'invalid_step' }

    const applied = applySteps(doc, steps)
    if (!applied.ok) return applied
    if (!validDocument(applied.doc)) return { ok: false, kind: 'invalid_schema' }

    return { ok: true, markdown: this.#serialize(applied.doc), steps: toStepBatch(steps) }
  }

  rebaseSteps(
    baseMarkdown: string,
    localJson: StepBatch,
    committedBatches: readonly StepBatch[],
  ): StepApplicationResult {
    const base = this.#parse(baseMarkdown)
    if (!validDocument(base)) return { ok: false, kind: 'invalid_schema' }

    const local = decodeSteps(this.milkdown.schema, localJson)
    const committed = decodeBatches(this.milkdown.schema, committedBatches)
    if (local === null || committed === null) {
      return { ok: false, kind: 'invalid_step' }
    }

    const locallyApplied = new Transform(base)
    const inverted: Step[] = []
    for (const step of local) {
      const before = locallyApplied.doc
      const result = locallyApplied.maybeStep(step)
      if (result.failed !== null) return { ok: false, kind: stepFailureKind(result.failed) }
      inverted.push(step.invert(before))
    }

    const transform = new Transform(locallyApplied.doc)
    const mapping = new Mapping()
    for (let index = inverted.length - 1; index >= 0; index -= 1) {
      const inverse = inverted[index]
      if (inverse === undefined || transform.maybeStep(inverse).failed !== null) {
        return { ok: false, kind: 'rebase_failed' }
      }
      mapping.appendMap(inverse.getMap())
    }
    for (const step of committed) {
      const result = transform.maybeStep(step)
      if (result.failed !== null) return { ok: false, kind: stepFailureKind(result.failed) }
      mapping.appendMap(step.getMap())
    }

    const rebased: Step[] = []
    let mapFrom = local.length
    for (const step of local) {
      const mapped = step.map(mapping.slice(mapFrom))
      mapFrom -= 1
      if (mapped === null) return { ok: false, kind: 'rebase_failed' }

      if (transform.maybeStep(mapped).failed !== null) return { ok: false, kind: 'rebase_failed' }
      mapping.appendMap(mapped.getMap(), mapFrom)
      rebased.push(mapped)
    }

    if (!validDocument(transform.doc)) return { ok: false, kind: 'invalid_schema' }

    return {
      ok: true,
      markdown: this.#serialize(transform.doc),
      steps: toStepBatch(rebased),
    }
  }

  invertSteps(markdown: string, stepsJson: StepBatch): StepBatch | null {
    const doc = this.#parse(markdown)
    if (!validDocument(doc)) return null

    const steps = decodeSteps(this.milkdown.schema, stepsJson)
    if (steps === null) return null

    try {
      let current = doc
      const inverse: Step[] = []
      for (const step of steps) {
        const result = step.apply(current)
        if (result.failed !== null || result.doc === null) return null
        inverse.unshift(step.invert(current))
        current = result.doc
      }
      return validDocument(current) ? toStepBatch(inverse) : null
    } catch {
      return null
    }
  }

  markdownToSteps(
    markdown: string,
    replacement: string,
    range?: StepDocumentRange,
  ): MarkdownStepResult {
    const doc = this.#parse(markdown)
    const replacementDoc = this.#parse(replacement)
    if (!validDocument(doc) || !validDocument(replacementDoc)) {
      return { ok: false, kind: 'invalid_schema' }
    }

    try {
      const transform = new Transform(doc)
      const from = range?.from ?? doc.content.size
      const to = range?.to ?? from
      transform.replaceRange(from, to, new Slice(replacementDoc.content, 0, 0))
      const next = transform.doc
      if (!validDocument(next)) return { ok: false, kind: 'invalid_schema' }
      return { ok: true, steps: toStepBatch(transform.steps) }
    } catch {
      return { ok: false, kind: 'invalid_step' }
    }
  }
}

/**
 * Creates the application port over the exact editor schema without creating
 * an editor view. The caller owns this resource for its composition lifetime.
 */
export async function createStepDocumentPort(): Promise<StepDocumentAdapter> {
  const milkdown = await createHeadlessMilkdown()
  const parse = milkdown.ctx.get(parserCtx)
  const serializer = DOMSerializer.fromSchema(milkdown.schema)
  return {
    port: new MilkdownStepDocumentPort(milkdown),
    renderMarkdown: (markdown) => {
      const doc = parse(markdown)
      // An unparseable body still has to appear. Showing the raw Markdown is
      // honest and readable; showing nothing loses the message.
      if (!validDocument(doc)) {
        const fallback = document.createDocumentFragment()
        const paragraph = document.createElement('p')
        paragraph.textContent = markdown
        fallback.append(paragraph)
        return fallback
      }
      // serializeFragment can return an element when a `toDOM` asks for one;
      // the caller only ever appends, so normalise to a fragment.
      const rendered = serializer.serializeFragment(doc.content)
      if (rendered instanceof DocumentFragment) return rendered
      const wrapped = document.createDocumentFragment()
      wrapped.append(rendered)
      return wrapped
    },
    destroy: () => milkdown.destroy(),
  }
}
