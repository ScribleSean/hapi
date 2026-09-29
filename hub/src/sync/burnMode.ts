import type { BurnModeState, BurnSessionStatus } from '@hapi/protocol/burnMode'
import type { Session } from '@hapi/protocol/types'
import type { Store } from '../store'

type Catalog = { success: boolean, models?: Array<{ id: string, isDefault: boolean, supportedReasoningEfforts?: string[], serviceTiers?: string[] }> }
type Dependencies = {
    sessions(namespace: string): Session[]
    catalog(sessionId: string): Promise<Catalog>
    apply(sessionId: string, config: { modelReasoningEffort: string | null, serviceTier: string | null }): Promise<void>
}

function supportsUltraAndFast(session: Session, catalog: Catalog): boolean {
    if (!catalog.success) return false
    const model = session.model?.trim().toLowerCase()
    const active = catalog.models?.find(item => item.id.trim().toLowerCase() === model) ?? catalog.models?.find(item => item.isDefault)
    return Boolean(active?.supportedReasoningEfforts?.some(value => value.toLowerCase() === 'ultra')
        && active?.serviceTiers?.some(value => /^(fast|priority)$/i.test(value.trim())))
}

/** Durable, hub-owned policy. It never resumes a bot or changes its model. */
export class BurnModeService {
    private readonly tails = new Map<string, Promise<void>>()
    private readonly scheduled = new Set<string>()
    constructor(private readonly store: Store, private readonly deps: Dependencies) {}

    state(namespace: string): BurnModeState { return this.store.burnMode.get(namespace) }

    controls(namespace: string, sessionId: string): boolean {
        const state = this.state(namespace)
        const session = state.sessions.find(item => item.sessionId === sessionId)
        return state.enabled && Boolean(session && session.status !== 'unsupported')
    }

    set(namespace: string, enabled: boolean, expectedRevision: number): BurnModeState | null {
        const state = this.store.burnMode.updatePolicy(namespace, enabled, expectedRevision)
        if (state) this.schedule(namespace)
        return state
    }

    retry(namespace: string): BurnModeState {
        this.store.burnMode.retryFailed(namespace)
        this.schedule(namespace)
        return this.state(namespace)
    }

    schedule(namespace: string): void {
        if (this.scheduled.has(namespace)) return
        this.scheduled.add(namespace)
        queueMicrotask(() => {
            this.scheduled.delete(namespace)
            const previous = this.tails.get(namespace) ?? Promise.resolve()
            const next = previous.catch(() => {}).then(() => this.reconcile(namespace)).catch(() => {})
            this.tails.set(namespace, next)
        })
    }

    private async reconcile(namespace: string): Promise<void> {
        const before = this.state(namespace)
        const sessions = this.deps.sessions(namespace)
        for (let index = 0; index < sessions.length; index += 4) {
            await Promise.all(sessions.slice(index, index + 4).map(session => this.reconcileSession(namespace, session, before)))
        }
        if (!before.enabled) this.store.burnMode.finishRestoreWhenComplete(namespace)
    }

    private async reconcileSession(namespace: string, session: Session, observed: BurnModeState): Promise<void> {
        const current = this.state(namespace)
        if (current.revision !== observed.revision || current.enabled !== observed.enabled) return
        const flavor = session.metadata?.flavor ?? 'claude'
        const snapshot = this.store.burnMode.snapshotFor(namespace, session.id)
        // RPC failures are explicit retry only. Heartbeats must not hammer a
        // rejected model/account configuration forever.
        if (snapshot?.status === 'failed') return
        if (current.enabled) {
            if (!snapshot) this.store.burnMode.snapshot(namespace, session.id, current.revision, session.modelReasoningEffort ?? null, session.serviceTier ?? null)
            if (!session.active) { this.store.burnMode.setResult(namespace, session.id, 'pending', 'Offline. Will check when this bot reconnects.'); return }
            if (flavor !== 'codex') { this.store.burnMode.setResult(namespace, session.id, 'unsupported', 'Ultra plus Fast is only exposed for capable Codex sessions.'); return }
            if (session.agentState?.controlledByUser && !session.metadata?.capabilities?.concurrentClients) {
                this.store.burnMode.setResult(namespace, session.id, 'blocked', 'Controlled in its terminal. Switch to remote control first.'); return
            }
            let catalog: Catalog
            try { catalog = await this.deps.catalog(session.id) } catch { this.store.burnMode.setResult(namespace, session.id, 'failed', 'Could not read the live model catalog.'); return }
            if (!supportsUltraAndFast(session, catalog)) { this.store.burnMode.setResult(namespace, session.id, 'unsupported', 'Ultra and Fast are not both advertised for this model and account.'); return }
            const latest = this.state(namespace)
            if (!latest.enabled || latest.revision !== current.revision) return this.schedule(namespace)
            try {
                await this.deps.apply(session.id, { modelReasoningEffort: 'ultra', serviceTier: 'fast' })
                this.store.burnMode.setResult(namespace, session.id, 'applied', 'Ultra reasoning and Fast tier confirmed.')
            } catch (error) { this.store.burnMode.setResult(namespace, session.id, 'failed', error instanceof Error ? error.message : 'Burn settings were not confirmed.') }
            return
        }
        if (!snapshot) return
        if (!session.active) { this.store.burnMode.setResult(namespace, session.id, 'pending', 'Offline. Original settings will restore when this bot reconnects.'); return }
        if (flavor !== 'codex') { this.store.burnMode.setResult(namespace, session.id, 'restored', 'No Burn settings were applied.'); return }
        const latest = this.state(namespace)
        if (latest.enabled || latest.revision !== current.revision) return this.schedule(namespace)
        try {
            await this.deps.apply(session.id, snapshot.previous!)
            this.store.burnMode.setResult(namespace, session.id, 'restored', 'Original reasoning and tier restored.')
        } catch (error) { this.store.burnMode.setResult(namespace, session.id, 'failed', error instanceof Error ? error.message : 'Original settings were not confirmed.') }
    }
}
