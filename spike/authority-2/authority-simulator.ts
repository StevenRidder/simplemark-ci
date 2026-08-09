import type { Node as ProseNode } from '@milkdown/kit/prose/model'

import type { AuthorityHarness } from './harness.js'

export interface SubmittedBatch {
  readonly clientId: string
  readonly operationId: string
  readonly baseVersion: number
  readonly stepsJson: readonly unknown[]
}

export type AuthoritySubmitResult =
  | {
    readonly ok: true
    readonly version: number
    readonly rebased: boolean
    readonly stepsJson: readonly unknown[]
  }
  | {
    readonly ok: false
    readonly kind:
      | 'invalid_step'
      | 'invalid_schema'
      | 'invalid_version'
      | 'rebase_failed'
      | 'operation_conflict'
  }

export interface AuthorityCheckpoint {
  readonly documentsJson: readonly unknown[]
  readonly commits: readonly {
    readonly version: number
    readonly stepsJson: readonly unknown[]
  }[]
  readonly operations: readonly {
    readonly operationId: string
    readonly payload: string
    readonly result: AuthoritySubmitResult
  }[]
}

export interface AuthoritySnapshot {
  readonly version: number
  readonly commitCount: number
  readonly doc: ProseNode
}

export interface AuthoritySimulator {
  submit(batch: SubmittedBatch): AuthoritySubmitResult
  snapshot(): AuthoritySnapshot
  checkpoint(): AuthorityCheckpoint
}

interface OperationRecord {
  readonly payload: string
  readonly result: AuthoritySubmitResult
}

interface CommitRecord {
  readonly version: number
  readonly stepsJson: readonly unknown[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function payloadFor(batch: SubmittedBatch): string {
  return JSON.stringify({
    clientId: batch.clientId,
    baseVersion: batch.baseVersion,
    stepsJson: batch.stepsJson,
  })
}

export function createAuthoritySimulator(
  harness: AuthorityHarness,
  initialMarkdown: string,
  checkpoint?: AuthorityCheckpoint,
): AuthoritySimulator {
  const initialDoc = harness.parse(initialMarkdown)
  const documents = checkpoint === undefined
    ? [initialDoc]
    : checkpoint.documentsJson.map((docJson) => initialDoc.type.schema.nodeFromJSON(clone(docJson)))
  const commits: CommitRecord[] = checkpoint === undefined
    ? []
    : checkpoint.commits.map((commit) => clone(commit))
  const operations = new Map<string, OperationRecord>(
    checkpoint?.operations.map((operation) => [
      operation.operationId,
      { payload: operation.payload, result: clone(operation.result) },
    ]) ?? [],
  )

  if (documents.length !== commits.length + 1) {
    throw new Error('Authority checkpoint must contain one document for version zero and every commit')
  }

  return {
    submit: (batch) => {
      const payload = payloadFor(batch)
      const prior = operations.get(batch.operationId)
      if (prior !== undefined) {
        return prior.payload === payload
          ? clone(prior.result)
          : { ok: false, kind: 'operation_conflict' }
      }

      const version = documents.length - 1
      if (!Number.isInteger(batch.baseVersion) || batch.baseVersion < 0 || batch.baseVersion > version) {
        return { ok: false, kind: 'invalid_version' }
      }

      const base = documents[batch.baseVersion]
      const current = documents[version]
      if (base === undefined || current === undefined) return { ok: false, kind: 'invalid_version' }

      const rebased = batch.baseVersion !== version
      const applied = rebased
        ? harness.rebase(
          base,
          batch.stepsJson,
          commits
            .filter((commit) => commit.version > batch.baseVersion)
            .flatMap((commit) => commit.stepsJson),
        )
        : harness.apply(current, batch.stepsJson)

      if (!applied.ok) return { ok: false, kind: applied.kind }

      const acceptedVersion = version + 1
      const acceptedSteps = clone(applied.stepsJson)
      const result: AuthoritySubmitResult = {
        ok: true,
        version: acceptedVersion,
        rebased,
        stepsJson: acceptedSteps,
      }
      documents.push(applied.doc)
      commits.push({ version: acceptedVersion, stepsJson: acceptedSteps })
      operations.set(batch.operationId, { payload, result: clone(result) })
      return clone(result)
    },
    snapshot: () => {
      const doc = documents.at(-1)
      if (doc === undefined) throw new Error('Authority has no document')
      return { version: documents.length - 1, commitCount: commits.length, doc }
    },
    checkpoint: () => ({
      documentsJson: documents.map((doc) => clone(doc.toJSON())),
      commits: clone(commits),
      operations: [...operations].map(([operationId, operation]) => ({
        operationId,
        payload: operation.payload,
        result: clone(operation.result),
      })),
    }),
  }
}
