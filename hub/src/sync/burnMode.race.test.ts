import { afterEach, describe, expect, it } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../store'
import { BurnModeService } from './burnMode'

const stores: Store[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))

function makeSession(): Session {
    return { id: 'one', namespace: 'n', active: true, activeAt: 1, seq: 1, createdAt: 1, updatedAt: 1, pinned: false, globalPinned: false, hasConversationContent: false, thinking: false, thinkingAt: 0, activeTurnStartedAt: null, backgroundTaskCount: 0, metadata: { flavor: 'codex' }, metadataVersion: 1, agentState: null, agentStateVersion: 1, model: 'm', modelReasoningEffort: 'low', effort: null, serviceTier: 'standard' } as Session
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function setup(apply: (config: { modelReasoningEffort: string | null, serviceTier: string | null }) => Promise<void>) {
    const store = new Store(':memory:'); stores.push(store); const session = makeSession()
    const service = new BurnModeService(store, { sessions: () => [session], session: () => session, catalog: async () => ({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['fast'] }] }), apply: async (_id, config) => apply(config), ready: () => true })
    return { store, session, service }
}

describe('BurnModeService races', () => {
    it('does not mark a stale ON write applied after OFF while the write is pending', async () => {
        const gate = deferred<void>(); const f = setup(async config => { f.session.modelReasoningEffort = config.modelReasoningEffort; f.session.serviceTier = config.serviceTier; await gate.promise })
        f.service.set('n', true, 0); await Promise.resolve(); f.service.set('n', false, 1); gate.resolve(); await f.service.flush('n')
        expect(f.service.state('n').enabled).toBe(false)
        expect(f.service.state('n').sessions[0]?.status).not.toBe('applied')
    })
    it('does not mark a stale restore complete after ON while restore is pending', async () => {
        const gate = deferred<void>(); let calls = 0; const f = setup(async config => { calls++; f.session.modelReasoningEffort = config.modelReasoningEffort; f.session.serviceTier = config.serviceTier; if (calls > 1) await gate.promise })
        f.service.set('n', true, 0); await f.service.flush('n'); f.service.set('n', false, 1); await Promise.resolve(); f.service.set('n', true, 2); gate.resolve(); await f.service.flush('n')
        expect(f.service.state('n').enabled).toBe(true)
        expect(f.service.state('n').sessions[0]?.status).not.toBe('restored')
    })
    it('does not apply after a same-object model mutation during catalog lookup', async () => {
        const catalog = deferred<{ success: boolean, models: Array<{ id: string, isDefault: boolean, supportedReasoningEfforts: string[], serviceTiers: string[] }> }>(); const catalogStarted = deferred<void>(); const store = new Store(':memory:'); stores.push(store); const session = makeSession(); let writes = 0
        const service = new BurnModeService(store, { sessions: () => [session], session: () => session, catalog: async () => { catalogStarted.resolve(); return await catalog.promise }, apply: async () => { writes++ }, ready: () => true })
        service.set('n', true, 0); await catalogStarted.promise; session.model = 'changed'; catalog.resolve({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['fast'] }] }); await service.flush('n')
        expect(writes).toBe(0)
    })
    it('retains a missing cached-session baseline until that session reconnects and restores it', async () => {
        const store = new Store(':memory:'); stores.push(store); const session = makeSession(); let present = true; const calls: Array<string | null> = []
        const service = new BurnModeService(store, { sessions: () => present ? [session] : [], session: id => present && id === session.id ? session : undefined, catalog: async () => ({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['fast'] }] }), apply: async (_id, config) => { calls.push(config.modelReasoningEffort); session.modelReasoningEffort = config.modelReasoningEffort; session.serviceTier = config.serviceTier }, ready: () => true })
        service.set('n', true, 0); await service.flush('n'); present = false; service.set('n', false, 1); await service.flush('n')
        expect(service.state('n').restoring).toBe(true)
        present = true; service.schedule('n'); await service.flush('n')
        expect(calls).toEqual(['ultra', 'low'])
        expect(service.state('n')).toMatchObject({ enabled: false, restoring: false, sessions: [] })
    })

    it('waits for registered CLI RPC methods before catalog or restoration calls', async () => {
        const store = new Store(':memory:'); stores.push(store); const session = makeSession(); let ready = false; let catalogCalls = 0; let writes = 0
        const service = new BurnModeService(store, { sessions: () => [session], session: () => session, catalog: async () => { catalogCalls++; return { success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['fast'] }] } }, apply: async () => { writes++ }, ready: () => ready })
        service.set('n', true, 0); await service.flush('n')
        expect(catalogCalls).toBe(0); expect(writes).toBe(0)
        ready = true; service.schedule('n'); await service.flush('n')
        expect(writes).toBe(1)
    })
})

