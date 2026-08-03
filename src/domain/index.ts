/**
 * Public entry point for `domain` — pure document, source, transaction, and
 * fence rules. Imports no SimpleMark module and no framework, DOM, Tauri,
 * CRDT, MCP, or filesystem API.
 *
 * Transactions and fences join this surface with the live-agent deliverable;
 * source baselines and dirty-block serialization with FIDELITY-1.
 */
export { firstByteDifference } from './source/byte-diff.js'
export { buildSourceMap, emitDocument } from './source/source-map.js'
export {
  MERMAID_SIGNATURE,
  isStandaloneBlockPaste,
  looksLikeMermaid,
  looksLikeSvg,
  svgInHtml,
} from './paste/recognition.js'
export type { ByteDifference } from './source/byte-diff.js'
export type { SourceBlock, SourceMap } from './source/source-map.js'
export type { PasteCandidate } from './paste/recognition.js'
export {
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeFileTree,
  looksLikeJson,
  looksLikeStackTrace,
  looksLikeTsv,
  tsvToMarkdownTable,
} from './paste/exhaust.js'
export { looksLikeDot, looksLikeMath, stripMathDelimiters } from './paste/formal.js'
