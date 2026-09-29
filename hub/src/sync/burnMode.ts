import type { BurnModeState, BurnSessionStatus } from '@hapi/protocol/burnMode'
import type { Session } from '@hapi/protocol/types'
import type { Store } from '../store'

type Catalog = { success: boolean, models?: Array<{ id: string, isDefault: boolean, supportedReasoningEfforts?: string[], serviceTiers?: string[] }> }
type Dependencies = { sessions(namespace: string): Session[], session(sessionId: string): Session | undefined, catalog(sessionId: string): Promise<Catalog>, apply(sessionId: string, config: { modelReasoningEffort: string | null, serviceTier: string | null }): Promise<void> }
const offline = 'Offline. Will check when this bot reconnects.'

function flavorOf(session: Session): string { return session.metadata?.flavor ?? 'claude' }
function ownsRemote(session: Session): boolean { return !(session.agentState?.controlledByUser && !session.metadata?.capabilities?.concurrentClients) }
function supportsUltraAndFast(session: Session, catalog: Catalog): boolean {
    if (!catalog.success) return false
    const raw = session.model?.trim()
    const active = raw && raw.toLowerCase() !== 'auto'
        ? catalog.models?.find(item => item.id.trim().toLowerCase() === raw.toLowerCase())
        : catalog.models?.find(item => item.isDefault)
    return Boolean(active?.supportedReasoningEfforts?.some(value => value.toLowerCase() === 'ultra') && active?.serviceTiers?.some(value => /^(fast|priority)$/i.test(value.trim())))
}
function isBurnConfig(session: Session): boolean { return session.modelReasoningEffort?.toLowerCase() === 'ultra' && /^(fast|priority)$/i.test(session.serviceTier?.trim() ?? '') }
function sameIdentity(before: Session, after: Session): boolean { return before.active === after.active && before.model === after.model && flavorOf(before) === flavorOf(after) && ownsRemote(before) === ownsRemote(after) }
function fingerprint(session: Session): string { return JSON.stringify([session.active, session.model ?? null, flavorOf(session), ownsRemote(session)]) }

/** Durable, hub-owned policy. It never resumes a bot or changes its model. */
export class BurnModeService {
    private readonly tails = new Map<string, Promise<void>>()
    private readonly scheduled = new Set<string>()
    private readonly running = new Set<string>()
    private readonly dirty = new Set<string>()
    constructor(private readonly store: Store, private readonly deps: Dependencies) {}
    state(namespace: string): BurnModeState { return this.store.burnMode.get(namespace) }
    controls(namespace: string, sessionId: string): boolean {
        const state = this.state(namespace)
        const row = state.sessions.find(item => item.sessionId === sessionId)
        const session = this.deps.session(sessionId)
        return state.enabled && flavorOf(session ?? ({ metadata: null } as Session)) === 'codex' && row?.status !== 'unsupported'
    }
    set(namespace: string, enabled: boolean, expectedRevision: number): BurnModeState | null { const state = this.store.burnMode.updatePolicy(namespace, enabled, expectedRevision); if (state) this.schedule(namespace); return state }
    retry(namespace: string): BurnModeState { this.store.burnMode.retryFailed(namespace); this.schedule(namespace); return this.state(namespace) }
    schedule(namespace: string): void {
        if (this.running.has(namespace)) { this.dirty.add(namespace); return }
        if (this.scheduled.has(namespace)) return
        this.scheduled.add(namespace)
        queueMicrotask(() => {
            this.scheduled.delete(namespace)
            this.running.add(namespace)
            const next = this.reconcile(namespace)
            next.catch(error => console.error('[burn mode] reconciliation failed', error))
            this.tails.set(namespace, next)
            void next.finally(() => {
                this.running.delete(namespace)
                if (this.dirty.delete(namespace)) this.schedule(namespace)
            })
        })
    }

    async flush(namespace: string): Promise<void> { await Promise.resolve(); await (this.tails.get(namespace) ?? Promise.resolve()); await Promise.resolve() }
    reconcilePersisted(): void { for (const namespace of this.store.burnMode.namespacesNeedingReconcile()) this.schedule(namespace) }
    private async reconcile(namespace: string): Promise<void> {
        const policy = this.state(namespace); const sessions = this.deps.sessions(namespace)
        for (let i = 0; i < sessions.length; i += 4) await Promise.all(sessions.slice(i, i + 4).map(session => this.reconcileSession(namespace, session, policy)))
        const current = this.state(namespace); if (!current.enabled) { this.store.burnMode.markMissingBaselines(namespace, new Set(sessions.map(session => session.id))); this.store.burnMode.finishRestoreWhenComplete(namespace) }
    }
    private currentPolicy(namespace: string, observed: BurnModeState): boolean { const current = this.state(namespace); return current.enabled === observed.enabled && current.revision === observed.revision }
    private async reconcileSession(namespace: string, initial: Session, policy: BurnModeState): Promise<void> {
        if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
        let session = this.deps.session(initial.id) ?? initial
        let row = this.store.burnMode.snapshotFor(namespace, session.id)
        if (policy.enabled) {
            if (row?.status === 'failed' && row.attemptRevision === policy.revision) return
            if (row?.status === 'applied' && isBurnConfig(session)) return
            if (row?.status === 'unsupported' && row.fingerprint === fingerprint(session)) return
            if (!session.active) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'pending', offline)
            if (flavorOf(session) !== 'codex') return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'unsupported', 'Ultra plus Fast is only exposed for capable Codex sessions.')
            if (!ownsRemote(session)) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'blocked', 'Controlled in its terminal. Switch to remote control first.')
            let catalog: Catalog
            try { catalog = await this.deps.catalog(session.id) } catch (error) { return this.fail(namespace, session.id, policy.revision, error, 'Could not read the live model catalog.') }
            const fresh = this.deps.session(session.id) ?? session
            if (!this.currentPolicy(namespace, policy) || !sameIdentity(session, fresh)) return this.schedule(namespace)
            session = fresh
            if (!supportsUltraAndFast(session, catalog)) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'unsupported', 'Ultra and Fast are not both advertised for this exact model and account.', fingerprint(session))
            // Only a verified, live, eligible bot gets a restoration baseline.
            this.store.burnMode.captureBaseline(namespace, session.id, session.seq, session.modelReasoningEffort ?? null, session.serviceTier ?? null)
            if (isBurnConfig(session)) return this.store.burnMode.setResult(namespace, session.id, 'applied', 'Ultra reasoning and Fast tier already active.')
            if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
            try { await this.deps.apply(session.id, { modelReasoningEffort: 'ultra', serviceTier: 'fast' }) } catch (error) { return this.fail(namespace, session.id, policy.revision, error, 'Burn settings were not confirmed.') }
            if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
            this.store.burnMode.setResult(namespace, session.id, 'applied', 'Ultra reasoning and Fast tier confirmed.')
            return
        }
        if (!row?.hasBaseline) { if (row && row.status !== 'restored') this.store.burnMode.setResult(namespace, session.id, 'restored', 'No Burn settings were applied.'); return }
        if (row.status === 'restored') return
        // An ON failure can be ambiguous: a provider might have applied before disconnecting. A new OFF revision gets one restore attempt.
        if (row.status === 'failed' && row.attemptRevision === policy.revision) return
        if (!session.active) return this.store.burnMode.setResult(namespace, session.id, 'pending', 'Offline. Original settings will restore when this bot reconnects.')
        if (flavorOf(session) !== 'codex') return this.store.burnMode.setResult(namespace, session.id, 'failed', 'Original settings await the original Codex session.', policy.revision)
        if (!ownsRemote(session)) return this.store.burnMode.setResult(namespace, session.id, 'blocked', 'Original settings await remote control.')
        if (session.modelReasoningEffort === row.previous!.modelReasoningEffort && session.serviceTier === row.previous!.serviceTier) return this.store.burnMode.setResult(namespace, session.id, 'restored', 'Original reasoning and tier already active.')
        if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
        try { await this.deps.apply(session.id, row.previous!) } catch (error) { return this.fail(namespace, session.id, policy.revision, error, 'Original settings were not confirmed.') }
        if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
        this.store.burnMode.setResult(namespace, session.id, 'restored', 'Original reasoning and tier restored.')
    }
    private fail(namespace: string, sessionId: string, revision: number, error: unknown, fallback: string): void { this.store.burnMode.ensureStatus(namespace, sessionId, 0, 'failed', error instanceof Error ? error.message : fallback); this.store.burnMode.setResult(namespace, sessionId, 'failed', error instanceof Error ? error.message : fallback, revision) }
}
