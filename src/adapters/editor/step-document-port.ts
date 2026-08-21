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
import { Mapping, ReplaceStep, Step, Transform } from '@milkdown/kit/prose/transform'
import type { Editor } from '@milkdown/kit/core'

import type {
  MarkdownStepResult,
  StepApplicationResult,
  StepBatch,
  StepDocumentPort,
  StepDocumentRange,
  StepJson,
} from '../../application/index.js'
import { splitClosedFrontMatter } from '../../domain/index.js'
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

  /**
   * Parses in the editor's coordinate space (BUG-23).
   *
   * The live editor strips closed front matter before it parses
   * (`prepareMarkdownForEditor`), so every document position it hands over —
   * a selection, a located passage, a section — counts from the first body
   * node. This port used to parse the whole file, which put the front matter
   * into the document as a thematic break and a heading ahead of the body:
   * every positioned agent edit on an annotated note landed inside the `id:`
   * line, and the serialized result carried the front matter as body. The
   * matter is split off here and put back on serialization, exactly as the
   * editor's `restoreMarkdown` does, so both parses describe one document.
   */
  #parseBody(markdown: string): { readonly matter: string; readonly doc: ProseNode } {
    const split = splitClosedFrontMatter(markdown)
    return { matter: split.matter, doc: this.#parse(split.body) }
  }

  #serializeWith(matter: string, doc: ProseNode): string {
    return matter + this.#serialize(doc)
  }

  applySteps(markdown: string, stepsJson: StepBatch): StepApplicationResult {
    const { matter, doc } = this.#parseBody(markdown)
    if (!validDocument(doc)) return { ok: false, kind: 'invalid_schema' }

    const steps = decodeSteps(this.milkdown.schema, stepsJson)
    if (steps === null) return { ok: false, kind: 'invalid_step' }

    const applied = applySteps(doc, steps)
    if (!applied.ok) return applied
    if (!validDocument(applied.doc)) return { ok: false, kind: 'invalid_schema' }

    return { ok: true, markdown: this.#serializeWith(matter, applied.doc), steps: toStepBatch(steps) }
  }

  rebaseSteps(
    baseMarkdown: string,
    localJson: StepBatch,
    committedBatches: readonly StepBatch[],
  ): StepApplicationResult {
    const { matter, doc: base } = this.#parseBody(baseMarkdown)
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
      markdown: this.#serializeWith(matter, transform.doc),
      steps: toStepBatch(rebased),
    }
  }

  revertSteps(
    currentMarkdown: string,
    inverseJson: StepBatch,
    laterBatches: readonly StepBatch[],
  ): StepApplicationResult {
    const { matter, doc: current } = this.#parseBody(currentMarkdown)
    if (!validDocument(current)) return { ok: false, kind: 'invalid_schema' }

    const inverse = decodeSteps(this.milkdown.schema, inverseJson)
    const later = decodeBatches(this.milkdown.schema, laterBatches)
    if (inverse === null || later === null) return { ok: false, kind: 'invalid_step' }

    // The mapping from the document the inverse was computed against to the
    // current one, from positional maps only. Replaying the later batches
    // instead is the original BUG-9 corruption: a live editor batch does not
    // reproduce its recorded markdown under a headless replay, so the rebase
    // computed against a document that never existed and dropped what the
    // batch added.
    const mapping = new Mapping()
    for (const step of later) mapping.appendMap(step.getMap())

    const only = inverse.length === 1 ? inverse[0] : undefined
    if (only instanceof ReplaceStep) {
      const applied = this.#revertReplace(current, only, mapping)
      if (applied === null) return { ok: false, kind: 'rebase_failed' }
      if (!validDocument(applied.doc)) return { ok: false, kind: 'invalid_schema' }
      return {
        ok: true,
        markdown: this.#serializeWith(matter, applied.doc),
        steps: toStepBatch(applied.steps),
      }
    }

    // A multi-step inverse is mapped step by step — exact for changes the
    // later batches did not write inside of, refused when a position has no
    // home. Agent transactions arrive as a single replace, so this path is
    // the uncommon one.
    const transform = new Transform(current)
    for (let index = 0; index < inverse.length; index += 1) {
      const step = inverse[index]
      if (step === undefined) return { ok: false, kind: 'invalid_step' }
      const own = new Mapping()
      for (let undo = index - 1; undo >= 0; undo -= 1) {
        const preceding = inverse[undo]
        if (preceding === undefined) return { ok: false, kind: 'invalid_step' }
        own.appendMap(preceding.getMap().invert())
      }
      own.appendMapping(mapping)
      for (const done of transform.steps) own.appendMap(done.getMap())
      const mapped = step.map(own)
      if (mapped === null) return { ok: false, kind: 'rebase_failed' }
      if (transform.maybeStep(mapped).failed !== null) return { ok: false, kind: 'rebase_failed' }
    }

    if (!validDocument(transform.doc)) return { ok: false, kind: 'invalid_schema' }

    return {
      ok: true,
      markdown: this.#serializeWith(matter, transform.doc),
      steps: toStepBatch(transform.steps),
    }
  }

  /**
   * Applies one inverse replace to the current document, excluding what later
   * batches inserted inside its span (BUG-9).
   *
   * Mapping the step whole is wrong in exactly the way people type: pressing
   * Enter at the end of the agent's paragraph splits the agent's node, so the
   * paragraph typed next lives positionally inside the span the inverse
   * replaces — a plainly-mapped `to` expands over it and the revert eats it.
   *
   * Instead the span is walked token by token: a token survives when its two
   * boundaries still map one token apart. Surviving runs are the agent content
   * still present; the gaps between runs are later insertions and are kept.
   * The restored content replaces the first run; later runs still holding text
   * are deleted; token-only runs — structure now owned by later content, like
   * the split-off paragraph end — stay where they are.
   */
  #revertReplace(
    current: ProseNode,
    step: ReplaceStep,
    mapping: Mapping,
  ): { readonly doc: ProseNode; readonly steps: readonly Step[] } | null {
    const segments: { start: number; end: number }[] = []
    let open: { start: number; end: number } | undefined
    for (let position = step.from; position < step.to; position += 1) {
      const left = mapping.map(position, 1)
      const right = mapping.map(position + 1, -1)
      if (right - left !== 1) {
        open = undefined
        continue
      }
      if (open !== undefined && open.end === left) {
        open.end = right
      } else {
        open = { start: left, end: right }
        segments.push(open)
      }
    }
    // The restored content needs a home: the first run still holding the
    // agent's text. All-structural crumbs mean later edits consumed the
    // content itself, and a revert with nowhere to put things back refuses.
    const restoreInto = segments.find(
      (segment) => current.textBetween(segment.start, segment.end).length > 0,
    )
    if (restoreInto === undefined) return null

    let doc = current
    const steps: Step[] = []
    const attempt = (build: (transform: Transform) => void): boolean => {
      const transform = new Transform(doc)
      try {
        build(transform)
      } catch {
        return false
      }
      if (!validDocument(transform.doc)) return false
      doc = transform.doc
      steps.push(...transform.steps)
      return true
    }

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]
      if (segment === undefined || segment === restoreInto) continue
      // Token-only runs are structure that later content now owns.
      if (doc.textBetween(segment.start, segment.end).length === 0) continue
      attempt((transform) => transform.deleteRange(segment.start, segment.end))
    }
    if (!attempt((transform) => transform.replaceRange(restoreInto.start, restoreInto.end, step.slice))) {
      return null
    }
    return { doc, steps }
  }

  invertSteps(markdown: string, stepsJson: StepBatch): StepBatch | null {
    const { doc } = this.#parseBody(markdown)
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

  replaceAllSteps(markdown: string, replacement: string): MarkdownStepResult {
    const { doc } = this.#parseBody(markdown)
    if (!validDocument(doc)) return { ok: false, kind: 'invalid_schema' }
    return this.markdownToSteps(markdown, replacement, { from: 0, to: doc.content.size })
  }

  markdownToSteps(
    markdown: string,
    replacement: string,
    range?: StepDocumentRange,
  ): MarkdownStepResult {
    const { doc } = this.#parseBody(markdown)
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
