import { createHash } from 'node:crypto'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { isObject } from '@hapi/protocol'
import type { Metadata, Session } from '@hapi/protocol/types'
import type { Store } from '../store'
import { ImportedMessageConflictError } from '../store/messages'
import type { SessionCache } from './sessionCache'
import type { SyncEngine } from './syncEngine'
import { shouldRecordSessionActivity } from './sessionActivity'
import { extractTodoWriteTodosFromMessageContent } from './todos'

const TAG_PREFIX = 'external-claude-http:'
const MESSAGE_PREFIX = 'external-transcript:'
export const EXTERNAL_SESSION_TIMEOUT_MS = 30_000

export class ExternalSessionError extends Error {
    constructor(readonly status: 403 | 404 | 409 | 410, readonly code: string) {
        super(code)
    }
}

export type ExternalSessionRegistration = {
    machineId: string
    host: string
    directory: string
    title: string
    claudeSessionId: string
    platform?: string
}

export type ExternalTranscriptMessage = {
    clientMessageId: string
    createdAt: number
    content: unknown
}

export class ExternalSessionService {
    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine,
        private readonly cache: SessionCache
    ) {}

    register(namespace: string, input: ExternalSessionRegistration): Session {
        const existingMachine = this.engine.getMachine(input.machineId)
        if (existingMachine && existingMachine.namespace !== namespace) {
            throw new ExternalSessionError(403, 'machine_access_denied')
        }
        const tag = TAG_PREFIX + createHash('sha256')
            .update(JSON.stringify([input.machineId, input.claudeSessionId])).digest('hex')
        for (const session of this.engine.getSessionsByNamespace(namespace)) {
            if (session.metadata?.claudeSessionId === input.claudeSessionId
                && session.metadata.machineId === input.machineId
                && this.store.sessions.getSession(session.id)?.tag !== tag) {
                throw new ExternalSessionError(409, 'session_already_registered_by_cli')
            }
        }
        this.engine.getOrCreateMachine(input.machineId, existingMachine?.metadata ?? {
            host: input.host,
            platform: input.platform ?? 'unknown',
            happyCliVersion: 'external-claude-http'
        }, existingMachine?.runnerState ?? null, namespace)
        const metadata: Metadata = {
            path: input.directory,
            host: input.host,
            name: input.title,
            machineId: input.machineId,
            claudeSessionId: input.claudeSessionId,
            flavor: 'claude',
            version: 'claude-http-v1',
            startingMode: 'remote',
            lifecycleState: 'running',
            capabilities: { terminal: false, concurrentClients: false }
        }
        const session = this.engine.getOrCreateSession(tag, metadata, {
            controlledByUser: false, requests: {}, completedRequests: {}
        }, namespace)
        const next = { ...session.metadata, ...metadata }
        delete next.archivedBy
        delete next.archiveReason
        delete next.lifecycleStateSince
        this.updateMetadata(session, next)
        this.heartbeat(session.id, namespace, true, false)
        return this.engine.getSession(session.id)!
    }

    resolve(sessionId: string, namespace: string, allowEnded = false): Session {
        const stored = this.store.sessions.getSession(sessionId)
        if (!stored) throw new ExternalSessionError(404, 'session_not_found')
        if (stored.namespace !== namespace) throw new ExternalSessionError(403, 'session_access_denied')
        if (!stored.tag?.startsWith(TAG_PREFIX)) throw new ExternalSessionError(409, 'not_external_session')
        const session = this.engine.getSession(sessionId)
        if (!session) throw new ExternalSessionError(404, 'session_not_found')
        if (!allowEnded && session.metadata?.lifecycleState === 'archived') {
            throw new ExternalSessionError(410, 'session_ended')
        }
        return session
    }

    heartbeat(sessionId: string, namespace: string, active: boolean, thinking: boolean): Session {
        this.resolve(sessionId, namespace)
        if (active) {
            const now = Date.now()
            this.store.sessions.setSessionActive(sessionId, true, now, namespace)
            this.cache.handleSessionAlive({ sid: sessionId, time: now, thinking, mode: 'remote' })
        } else {
            this.cache.handleSessionEnd({ sid: sessionId, time: Date.now() })
        }
        return this.engine.getSession(sessionId)!
    }

    append(sessionId: string, namespace: string, rows: ExternalTranscriptMessage[]) {
        const session = this.resolve(sessionId, namespace)
        return rows.map(row => {
            let inserted
            try {
                inserted = this.store.messages.addImportedMessage(
                    sessionId, row.content, MESSAGE_PREFIX + row.clientMessageId, row.createdAt
                )
            } catch (error) {
                if (error instanceof ImportedMessageConflictError) {
                    throw new ExternalSessionError(409, 'client_message_id_conflict')
                }
                throw error
            }
            const { message } = inserted
            if (inserted.inserted) {
                this.engine.recordAgentProgress(sessionId, Date.now())
                if (shouldRecordSessionActivity(message.content)) {
                    this.engine.recordSessionActivity(sessionId, Date.now())
                }
                const todos = extractTodoWriteTodosFromMessageContent(message.content)
                if (todos && this.store.sessions.setSessionTodos(sessionId, todos, message.createdAt, namespace)) {
                    this.engine.handleRealtimeEvent({ type: 'session-updated', sessionId })
                }
                this.engine.handleRealtimeEvent({ type: 'message-received', sessionId, namespace: session.namespace, message })
            }
            return { clientMessageId: row.clientMessageId, id: message.id, seq: message.seq, inserted: inserted.inserted }
        })
    }

    end(sessionId: string, namespace: string): void {
        const session = this.resolve(sessionId, namespace, true)
        if (session.metadata?.lifecycleState === 'archived') return
        this.updateMetadata(session, {
            ...session.metadata!, lifecycleState: 'archived', lifecycleStateSince: Date.now(),
            archiveReason: 'External Claude session ended'
        })
        this.cache.handleSessionEnd({ sid: sessionId, time: Date.now() })
        this.engine.handleRealtimeEvent({ type: 'session-ended', sessionId, reason: 'completed' })
    }

    async inbound(sessionId: string, namespace: string, waitMs: number, limit: number, signal: AbortSignal) {
        const read = () => {
            const session = this.resolve(sessionId, namespace)
            if (!session.active || Date.now() - session.activeAt > EXTERNAL_SESSION_TIMEOUT_MS) {
                throw new ExternalSessionError(409, 'session_inactive')
            }
            return this.store.messages.getUninvokedLocalMessages(sessionId, { deliverableOnly: true })
                .filter(message => message.scheduledAt === null || message.scheduledAt <= Date.now())
                .slice(0, limit)
                .map(message => {
                    const meta = unwrapRoleWrappedRecordEnvelope(message.content)?.meta
                    return {
                        ...message,
                        deliveryMode: message.scheduledAt == null && isObject(meta) && meta.deliveryMode === 'steer'
                            ? 'steer' as const : 'queue' as const
                    }
                })
        }
        const messages = read()
        if (messages.length > 0 || waitMs === 0 || signal.aborted) return messages
        await new Promise<void>(resolve => {
            const finish = () => {
                clearTimeout(timer)
                unsubscribe()
                signal.removeEventListener('abort', finish)
                resolve()
            }
            const timer = setTimeout(finish, waitMs)
            const unsubscribe = this.engine.subscribe(event => {
                if ('sessionId' in event && event.sessionId === sessionId
                    && (event.type === 'message-received' || event.type === 'scheduled-matured'
                        || event.type === 'session-ended' || event.type === 'session-removed'
                        || event.type === 'session-updated')) finish()
            })
            signal.addEventListener('abort', finish, { once: true })
            if (signal.aborted) finish()
        })
        return read()
    }

    acknowledge(sessionId: string, namespace: string, localIds: string[]): number {
        this.resolve(sessionId, namespace)
        const now = Date.now()
        const pendingIds: string[] = []
        for (const localId of new Set(localIds)) {
            if (localId.startsWith(MESSAGE_PREFIX)) throw new ExternalSessionError(409, 'not_inbound_message')
            const lookup = this.store.messages.lookupQueuedMessage(sessionId, localId)
            if (lookup.status === 'absent' || ('scheduledAt' in lookup && lookup.scheduledAt !== null && lookup.scheduledAt > now)) {
                throw new ExternalSessionError(409, 'not_deliverable_message')
            }
            const storedLocalId = lookup.status === 'invoked' ? lookup.message.localId : lookup.localId
            if (storedLocalId !== localId) throw new ExternalSessionError(409, 'not_inbound_message')
            if (lookup.status !== 'invoked') pendingIds.push(localId)
        }
        this.store.messages.markMessagesInvoked(sessionId, pendingIds, now)
        if (pendingIds.length > 0) {
            this.cache.clearQueuedThinkingGrace(sessionId)
            this.engine.recordAgentProgress(sessionId, now)
            this.engine.handleRealtimeEvent({ type: 'messages-consumed', sessionId, localIds: pendingIds, invokedAt: now })
        }
        return now
    }

    private updateMetadata(session: Session, metadata: Metadata): void {
        const result = this.store.sessions.updateSessionMetadata(session.id, metadata, session.metadataVersion, session.namespace)
        if (result.result !== 'success') throw new ExternalSessionError(409, 'metadata_conflict')
        this.cache.refreshSession(session.id)
    }
}
