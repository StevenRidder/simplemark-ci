/**
 * Public entry point for `application` — use cases and the ports adapters
 * implement. Imports `domain` only.
 *
 * `DocumentSession` (open, save, invoke agent, apply transaction, leave note,
 * redirect, stop, revert) lands here in the local-editor and live-agent
 * deliverables. Today the module publishes its port contracts.
 */
export type { FilePort, OpenedDocument, DiagramRenderer, RenderedDiagram } from './ports.js'
export { DocumentSession } from './document-session.js'
export type {
  DocumentSnapshot,
  DocumentTransaction,
  ApplyResult,
  SaveResult,
} from './document-session.js'
