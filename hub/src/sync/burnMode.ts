import { CLAUDE_EFFORT_LEVELS } from '@hapi/protocol'
import type { BurnModeState } from '@hapi/protocol/burnMode'
import type { Session } from '@hapi/protocol/types'
import type { Store } from '../store'

export type BurnConfig = { modelReasoningEffort?: string | null, serviceTier?: string | null, effort?: string | null }
export type BurnControls = { modelReasoningEffort: boolean, serviceTier: boolean, effort: boolean }
export type BurnTarget = { config: BurnConfig, controls: BurnControls, description: string }
export type BurnCatalog = { target?: BurnTarget, unavailable?: string }
type LegacyCodexCatalog = { success: boolean, models?: Array<{ id: string, isDefault: boolean, supportedReasoningEfforts?: string[], serviceTiers?: string[] }> }
type Dependencies = { sessions(namespace: string): Session[], session(sessionId: string): Session | undefined, catalog(session: Session): Promise<BurnCatalog | LegacyCodexCatalog>, apply(sessionId: string, config: BurnConfig): Promise<void>, ready?(session: Session): boolean }
const offline = 'Offline. Will check when this bot reconnects.'
function ownsRemote(session: Session): boolean { return !(session.agentState?.controlledByUser && !session.metadata?.capabilities?.concurrentClients) }
function fingerprint(session: Session): string {
    return JSON.stringify([
        session.namespace,
        session.active,
        session.model ?? null,
        session.metadata?.flavor ?? 'claude',
        ownsRemote(session),
        session.metadata?.piSelectedModel ?? null,
        session.modelReasoningEffort ?? null,
        session.serviceTier ?? null,
        session.effort ?? null,
    ])
}
const ranks = new Map(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((v, i) => [v, i]))

/** Never guess provider-specific labels: only documented ordinal values qualify. */
export function highestAdvertisedEffort(values: readonly string[] | undefined): string | null {
    let selected: string | null = null
    let rank = -1
    for (const raw of values ?? []) {
        const value = raw.trim()
        const next = ranks.get(value.toLowerCase())
        if (next !== undefined && next > rank) {
            selected = value
            rank = next
        }
    }
    return selected
}
export function codexBurnCatalog(session: Session, response: { success: boolean, models?: Array<{ id: string, isDefault: boolean, supportedReasoningEfforts?: string[], serviceTiers?: string[] }> }): BurnCatalog {
    if (!response.success) return { unavailable: 'Codex capability catalog is unavailable.' }
    const raw = session.model?.trim()
    const provider = session.metadata?.codexModelProvider?.trim().toLowerCase()
    // `auto` is resolved by the native OpenAI catalog. A local provider can
    // share the label, but must never inherit a cloud catalog default.
    const canUseOpenAiDefault = !provider || provider === 'openai'
    const model = raw && raw.toLowerCase() !== 'auto'
        ? response.models?.find(item => item.id.trim().toLowerCase() === raw.toLowerCase())
        : canUseOpenAiDefault ? response.models?.find(item => item.isDefault) : undefined
    if (!model) return { unavailable: 'The current Codex model is not in its live catalog.' }
    const reasoning = highestAdvertisedEffort(model.supportedReasoningEfforts)
    const tier = model.serviceTiers?.find(value => value.trim().toLowerCase() === 'fast')
        ?? model.serviceTiers?.find(value => value.trim().toLowerCase() === 'priority')
    if (!reasoning && !tier) return { unavailable: 'No supported reasoning or speed control is advertised for this exact Codex model and account.' }
    // HAPI's canonical `fast` maps to Codex app-server's advertised
    // `priority` request value (cli/codex/utils/appServerConfig.ts).
    return { target: { config: { ...(reasoning ? { modelReasoningEffort: reasoning } : {}), ...(tier ? { serviceTier: 'fast' } : {}) }, controls: { modelReasoningEffort: Boolean(reasoning), serviceTier: Boolean(tier), effort: false }, description: [reasoning && `${reasoning} reasoning`, tier && 'Fast tier'].filter(Boolean).join(' and ') } }
}
function normalizeCatalog(session: Session, catalog: BurnCatalog | LegacyCodexCatalog): BurnCatalog {
    return 'success' in catalog ? codexBurnCatalog(session, catalog) : catalog
}
export function piBurnCatalog(session: Session, response: { success: boolean, availableModels?: Array<{ provider: string, modelId: string, reasoning?: boolean, thinkingLevelMap?: Partial<Record<string, string | null>> }> }): BurnCatalog {
    if (!response.success) return { unavailable: 'Pi capability catalog is unavailable.' }
    const selected = session.metadata?.piSelectedModel
    const models = response.availableModels?.filter(model => model.modelId === session.model && (!selected || model.provider === selected.provider)) ?? []
    const model = models.length === 1 ? models[0] : undefined
    const effort = model?.reasoning ? highestAdvertisedEffort(Object.entries(model.thinkingLevelMap ?? {}).filter(([, mapped]) => mapped != null).map(([level]) => level)) : null
    return effort ? { target: { config: { effort }, controls: { modelReasoningEffort: false, serviceTier: false, effort: true }, description: `${effort} thinking` } } : { unavailable: 'No supported Pi thinking level is advertised for this exact model.' }
}
export function grokBurnCatalog(response: { success: boolean, options?: Array<{ value: string }> }): BurnCatalog {
    const effort = response.success ? highestAdvertisedEffort(response.options?.map(option => option.value)) : null
    return effort ? { target: { config: { effort }, controls: { modelReasoningEffort: false, serviceTier: false, effort: true }, description: `${effort} reasoning` } } : { unavailable: response.success ? 'No ordered Grok reasoning option is advertised for this session.' : 'Grok reasoning options are unavailable.' }
}
/** Claude's maintained protocol validator exposes these accepted --effort values.
 * Unlike provider model catalogs, they are a harness capability and apply without
 * selecting or changing a model. */
export function claudeBurnCatalog(): BurnCatalog {
    const effort = CLAUDE_EFFORT_LEVELS.at(-1)
    return effort ? { target: { config: { effort }, controls: { modelReasoningEffort: false, serviceTier: false, effort: true }, description: `${effort} effort` } } : { unavailable: 'Claude does not advertise an effort control.' }
}
function matches(session: Session, target: BurnTarget): boolean {
    return (!target.controls.modelReasoningEffort || session.modelReasoningEffort === target.config.modelReasoningEffort)
        && (!target.controls.serviceTier || session.serviceTier === target.config.serviceTier)
        && (!target.controls.effort || session.effort === target.config.effort)
}
type Snapshot = NonNullable<ReturnType<Store['burnMode']['snapshotFor']>>
function restoreConfig(row: Snapshot): BurnConfig {
    const saved = row.saved!
    return {
        ...(row.controls.modelReasoningEffort ? { modelReasoningEffort: saved.modelReasoningEffort } : {}),
        ...(row.controls.serviceTier ? { serviceTier: saved.serviceTier } : {}),
        ...(row.controls.effort ? { effort: saved.effort } : {}),
    }
}
function restored(session: Session, row: Snapshot): boolean {
    const saved = row.saved!
    return (!row.controls.modelReasoningEffort || session.modelReasoningEffort === saved.modelReasoningEffort)
        && (!row.controls.serviceTier || session.serviceTier === saved.serviceTier)
        && (!row.controls.effort || session.effort === saved.effort)
}
function bounded(value: string | null | undefined): string | null {
    return typeof value === 'string' ? value.slice(0, 80) : null
}
function observed(session: Session, controls: BurnControls): string {
    return JSON.stringify({
        ...(controls.modelReasoningEffort ? { modelReasoningEffort: bounded(session.modelReasoningEffort) } : {}),
        ...(controls.serviceTier ? { serviceTier: bounded(session.serviceTier) } : {}),
        ...(controls.effort ? { effort: bounded(session.effort) } : {}),
    })
}

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
        return state.enabled && row?.status !== 'unsupported'
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
        if (this.running.has(namespace)) { this.dirty.add(namespace); return }
        if (this.scheduled.has(namespace)) return
        this.scheduled.add(namespace)
        queueMicrotask(() => {
            this.scheduled.delete(namespace)
            this.running.add(namespace)
            const next = this.reconcile(namespace)
            next.catch(error => console.error('[burn mode] reconciliation failed', error))
            this.tails.set(namespace, next)
            void next.then(
                () => { this.running.delete(namespace); if (this.dirty.delete(namespace)) this.schedule(namespace) },
                () => { this.running.delete(namespace); if (this.dirty.delete(namespace)) this.schedule(namespace) },
            )
        })
    }
    async flush(namespace: string): Promise<void> {
        await Promise.resolve()
        await (this.tails.get(namespace) ?? Promise.resolve())
        await Promise.resolve()
    }
    reconcilePersisted(): void { for (const namespace of this.store.burnMode.namespacesNeedingReconcile()) this.schedule(namespace) }
    private currentPolicy(namespace: string, observed: BurnModeState): boolean { const current = this.state(namespace); return current.enabled === observed.enabled && current.revision === observed.revision }
    private async reconcile(namespace: string): Promise<void> {
        const policy = this.state(namespace)
        if (!policy.enabled && !policy.restoring && policy.sessions.length === 0) return
        const sessions = this.deps.sessions(namespace)
        for (let i = 0; i < sessions.length; i += 4) {
            await Promise.all(sessions.slice(i, i + 4).map(session => this.reconcileSession(namespace, session, policy)))
        }
        const current = this.state(namespace)
        if (!current.enabled) {
            this.store.burnMode.markMissingBaselines(namespace, new Set(sessions.map(session => session.id)))
            this.store.burnMode.finishRestoreWhenComplete(namespace)
        }
    }
    private async reconcileSession(namespace: string, initial: Session, policy: BurnModeState): Promise<void> {
        if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
        let session = this.deps.session(initial.id) ?? initial
        const row = this.store.burnMode.snapshotFor(namespace, session.id)
        const before = fingerprint(session)
        if (policy.enabled) {
            if (row?.status === 'failed' && row.attemptRevision === policy.revision) return
            if (!session.active) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'pending', offline)
            if (!ownsRemote(session)) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'blocked', 'Controlled in its terminal. Switch to remote control first.')
            if (!(this.deps.ready?.(session) ?? true)) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'pending', 'Waiting for supported CLI RPC registration.')
            if (row?.status === 'applied' && row.fingerprint === fingerprint(session)) return
            if (row?.status === 'unsupported' && row.fingerprint === fingerprint(session)) return
            let catalog: BurnCatalog
            try {
                catalog = normalizeCatalog(session, await this.deps.catalog(session))
            } catch (error) {
                return this.fail(namespace, session.id, policy.revision, error, 'Could not read the live capability catalog.')
            }
            const fresh = this.deps.session(session.id)
            if (!fresh || fresh.namespace !== namespace || !this.currentPolicy(namespace, policy) || fingerprint(fresh) !== before) {
                return this.schedule(namespace)
            }
            session = fresh
            if (!catalog.target) return this.store.burnMode.ensureStatus(namespace, session.id, session.seq, 'unsupported', catalog.unavailable ?? 'No supported reasoning or speed control is available.', fingerprint(session))
            const target = catalog.target
            this.store.burnMode.captureBaseline(namespace, session.id, session.seq, {
                modelReasoningEffort: session.modelReasoningEffort ?? null,
                serviceTier: session.serviceTier ?? null,
                effort: session.effort ?? null,
            }, target.controls)
            if (matches(session, target)) return this.store.burnMode.setResult(namespace, session.id, 'applied', `${target.description} already active.`, 0, fingerprint(session))
            if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
            try { await this.deps.apply(session.id, target.config) } catch (error) { return this.fail(namespace, session.id, policy.revision, error, 'Burn settings were not confirmed.') }
            const confirmed = this.deps.session(session.id)
            if (!confirmed || !this.currentPolicy(namespace, policy)) return this.schedule(namespace)
            if (!matches(confirmed, target)) {
                return this.fail(namespace, session.id, policy.revision, new Error(`Burn settings were not confirmed; observed ${observed(confirmed, target.controls)}.`), 'Burn settings were not confirmed.')
            }
            this.store.burnMode.setResult(namespace, session.id, 'applied', `${target.description} confirmed.`, 0, fingerprint(confirmed)); return
        }
        if (!row?.hasBaseline) { if (row && row.status !== 'restored') this.store.burnMode.setResult(namespace, session.id, 'restored', 'No Burn settings were applied.'); return }
        if (row.status === 'restored' || (row.status === 'failed' && row.attemptRevision === policy.revision)) return
        if (!session.active) return this.store.burnMode.setResult(namespace, session.id, 'pending', 'Offline. Original settings will restore when this bot reconnects.')
        if (!ownsRemote(session)) return this.store.burnMode.setResult(namespace, session.id, 'blocked', 'Original settings await remote control.')
        if (!(this.deps.ready?.(session) ?? true)) return this.store.burnMode.setResult(namespace, session.id, 'pending', 'Waiting for supported CLI RPC registration to restore original settings.')
        if (restored(session, row)) return this.store.burnMode.setResult(namespace, session.id, 'restored', 'Original settings already active.')
        if (!this.currentPolicy(namespace, policy)) return this.schedule(namespace)
        try { await this.deps.apply(session.id, restoreConfig(row)) } catch (error) { return this.fail(namespace, session.id, policy.revision, error, 'Original settings were not confirmed.') }
        const confirmed = this.deps.session(session.id)
        if (!confirmed || !this.currentPolicy(namespace, policy)) return this.schedule(namespace)
        if (!restored(confirmed, row)) {
            return this.fail(namespace, session.id, policy.revision, new Error(`Original settings were not confirmed; observed ${observed(confirmed, row.controls)}.`), 'Original settings were not confirmed.')
        }
        this.store.burnMode.setResult(namespace, session.id, 'restored', 'Original settings restored.')
    }
    private fail(namespace: string, sessionId: string, revision: number, error: unknown, fallback: string): void { this.store.burnMode.ensureStatus(namespace, sessionId, 0, 'failed', error instanceof Error ? error.message : fallback); this.store.burnMode.setResult(namespace, sessionId, 'failed', error instanceof Error ? error.message : fallback, revision) }
}
