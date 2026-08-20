/**
 * Public entry point for `application` — use cases and the ports adapters
 * implement. Imports `domain` only.
 *
 * `DocumentSession` (open, save, invoke agent, apply transaction, leave note,
 * redirect, stop, revert) lands here in the local-editor and live-agent
 * deliverables. Today the module publishes its port contracts.
 */
export type {
  FilePort,
  OpenedDocument,
  WorkspaceCatalogEntry,
  WorkspaceCatalog,
  WorkspaceCatalogPort,
  AssetKind,
  AssetReference,
  AssetReferencePort,
  DocumentLinkPort,
  ChartDataReader,
  StoredImage,
  LoadedImage,
  ImageStorePort,
  NoteImageStore,
  DiagramRenderer,
  RenderedDiagram,
  ClipboardPayload,
  ClipboardPort,
  NoteSummary,
  NoteSummaryPort,
  DiagramFixResult,
  DiagramFixPort,
  AiSettings,
  BlockBoundaryPort,
  StepJson,
  StepBatch,
  StepDocumentRange,
  StepDocumentError,
  StepApplicationResult,
  MarkdownStepResult,
  StepDocumentPort,
  NoteIdentity,
  ThreadStore,
  AgentConnection,
  AgentReasoning,
  AgentMayOpenNotes,
  AgentToolSpec,
  AgentMessage,
  AgentProviderInput,
  AgentProviderTurn,
  AgentProviderPort,
} from './ports.js'
export { isAiConfigured, isAgentConfigured, AGENT_REASONING_LEVELS } from './ports.js'
export { DocumentSession } from './document-session.js'
export { runAgentLoop } from './agent-loop.js'
export type {
  AgentActivity,
  AgentLoopInput,
  AgentLoopResult,
  AgentRunControl,
  AgentRunStatus,
  TextTargetResolver,
} from './agent-loop.js'
export { resolveInstructionTarget } from './instruction-target.js'
export type { InstructionTarget, InstructionTargetInput } from './instruction-target.js'
export { dirtyBlocks } from './dirty-blocks.js'
export type {
  AcceptedChange,
  AcceptedChangeListener,
  DocumentSnapshot,
  DocumentTransaction,
  ApplyResult,
  StepTransaction,
  EditorStepTransaction,
  StepTransactionError,
  StepTransactionApplyResult,
  SaveResult,
  RevertResult,
} from './document-session.js'
export { COMMANDS, MENUS, menuCommandIds } from './commands.js'
export type {
  DocumentCommandId,
  CommandDefinition,
  CommandTarget,
  CommandSubmenu,
  MenuEntry,
  MenuSpec,
} from './commands.js'
export { MAX_HIDDEN_DIAGRAM_FIX_ATTEMPTS, repairHiddenDiagram } from './repair-hidden-diagram.js'
