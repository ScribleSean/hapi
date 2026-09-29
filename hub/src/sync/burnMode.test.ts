import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../store'
import { BurnModeService, claudeBurnCatalog, codexBurnCatalog, grokBurnCatalog, piBurnCatalog } from './burnMode'

const stores: Store[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

function session(id: string, namespace: string, active = true, flavor = 'codex'): Session {
    return { id, namespace, active, activeAt: 1, seq: 1, createdAt: 1, updatedAt: 1, pinned: false, globalPinned: false,
        hasConversationContent: false, thinking: false, thinkingAt: 0, activeTurnStartedAt: null, backgroundTaskCount: 0,
        metadata: { flavor }, metadataVersion: 1, agentState: null, agentStateVersion: 1, model: 'm',
        modelReasoningEffort: null, effort: null, serviceTier: null } as Session
}

function fixture(items = [session('one', 'a')]) {
    const store = new Store(':memory:'); stores.push(store)
    const apply = mock(async (id: string, config: { modelReasoningEffort?: string | null, serviceTier?: string | null, effort?: string | null }) => {
        const target = items.find(item => item.id === id)!; target.modelReasoningEffort = config.modelReasoningEffort ?? null; target.serviceTier = config.serviceTier ?? null
    })
    const catalog = mock(async () => ({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['priority'] }] }))
    const service = new BurnModeService(store, {
        sessions: namespace => items.filter(item => item.namespace === namespace),
        session: id => items.find(item => item.id === id),
        catalog,
        apply
    })
    return { store, items, apply, catalog, service }
}

describe('BurnModeService', () => {
    it('selects only live-advertised controls and never substitutes a catalog default', () => {
        const target = session('local', 'a'); target.model = 'heretic-9b:latest'
        expect(codexBurnCatalog(target, { success: true, models: [{ id: 'cloud-default', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['fast'] }] }).target).toBeUndefined()
        expect(grokBurnCatalog({ success: true, options: [{ value: 'low' }, { value: 'high' }] }).target?.config).toEqual({ effort: 'high' })
        const pi = session('pi', 'a', true, 'pi'); pi.model = 'shared'; pi.metadata = { ...pi.metadata!, piSelectedModel: { provider: 'one', modelId: 'shared' } }
        expect(piBurnCatalog(pi, { success: true, availableModels: [{ provider: 'one', modelId: 'shared', reasoning: true, thinkingLevelMap: { high: 'high', max: 'max' } }] }).target?.config).toEqual({ effort: 'max' })
        expect(piBurnCatalog(pi, { success: true, availableModels: [{ provider: 'two', modelId: 'shared', reasoning: true, thinkingLevelMap: { max: 'max' } }] }).target).toBeUndefined()
    })

    it('uses the maintained Claude effort capability without selecting a model or paid tier', () => {
        expect(claudeBurnCatalog().target).toMatchObject({ config: { effort: 'max' }, controls: { effort: true, modelReasoningEffort: false, serviceTier: false } })
    })

    it('restores only the generic control it changed, including a null effort baseline', async () => {
        const target = session('claude', 'a', true, 'claude'); target.effort = null
        const store = new Store(':memory:'); stores.push(store)
        const apply = mock(async (_id: string, config: { effort?: string | null }) => { if ('effort' in config) target.effort = config.effort ?? null })
        const service = new BurnModeService(store, { sessions: () => [target], session: () => target, catalog: async () => claudeBurnCatalog(), apply, ready: () => true })
        service.set('a', true, 0); await service.flush('a')
        expect(apply).toHaveBeenCalledWith('claude', { effort: 'max' })
        service.set('a', false, 1); await service.flush('a')
        expect(apply).toHaveBeenLastCalledWith('claude', { effort: null })
    })

    it('is disabled by default, CAS isolates namespaces, and captures nullable originals once', async () => {
        const f = fixture([session('one', 'a'), session('two', 'b')])
        expect(f.service.state('a')).toMatchObject({ enabled: false, revision: 0, sessions: [] })
        expect(f.service.set('a', true, 9)).toBeNull()
        expect(f.service.set('a', true, 0)?.enabled).toBe(true)
        await settle(); expect(f.apply).toHaveBeenCalledWith('one', { modelReasoningEffort: 'ultra', serviceTier: 'fast' })
        expect(f.service.state('a').sessions[0]?.previous).toEqual({ modelReasoningEffort: null, serviceTier: null })
        expect(f.service.state('b')).toMatchObject({ enabled: false, revision: 0 })
        expect(f.service.set('a', true, 1)?.revision).toBe(1)
    })

    it('restores exact baselines and does not call offline bots', async () => {
        const offline = session('offline', 'a', false)
        const unsupported = session('other', 'a', true, 'claude')
        const f = fixture([session('one', 'a'), offline, unsupported])
        f.service.set('a', true, 0)
        await settle(); expect(f.apply).toHaveBeenCalledTimes(2)
        expect(f.service.state('a').sessions.find(item => item.sessionId === 'offline')).toMatchObject({ status: 'pending' })
        expect(f.service.state('a').sessions.find(item => item.sessionId === 'other')).toMatchObject({ status: 'applied' })
        f.service.set('a', false, 1)
        await settle(); expect(f.apply).toHaveBeenCalledWith('one', { modelReasoningEffort: null, serviceTier: null })
    })

    it('applies an offline session only after an explicit later reconciliation', async () => {
        const target = session('one', 'a', false); const f = fixture([target])
        f.service.set('a', true, 0)
        await settle(); expect(f.service.state('a').sessions[0]?.status).toBe('pending')
        expect(f.apply).not.toHaveBeenCalled()
        target.active = true; f.service.schedule('a')
        await settle(); expect(f.apply).toHaveBeenCalledTimes(1)
    })


    it('does not capture or restore an explicit unknown model', async () => {
        const target = session('unknown', 'a'); target.model = 'not-in-catalog'
        const f = fixture([target])
        f.service.set('a', true, 0); await f.service.flush('a')
        expect(f.apply).not.toHaveBeenCalled()
        expect(f.service.state('a').sessions[0]?.previous).toBeNull()
        f.service.set('a', false, 1); await f.service.flush('a')
        expect(f.apply).not.toHaveBeenCalled()
    })

    it('does not snapshot an offline bot before it becomes eligible', async () => {
        const target = session('late', 'a', false); const f = fixture([target])
        f.service.set('a', true, 0); await f.service.flush('a')
        expect(f.service.state('a').sessions[0]?.previous).toBeNull()
        target.active = true; f.service.schedule('a'); await f.service.flush('a')
        expect(f.apply).toHaveBeenCalledTimes(1)
        expect(f.service.state('a').sessions[0]?.previous).toEqual({ modelReasoningEffort: null, serviceTier: null })
    })

    it('skips a native write when Ultra and Fast are already active', async () => {
        const target = session('ready', 'a'); target.modelReasoningEffort = 'ultra'; target.serviceTier = 'fast'
        const f = fixture([target]); f.service.set('a', true, 0); await f.service.flush('a')
        expect(f.apply).not.toHaveBeenCalled()
        target.serviceTier = 'standard'; f.service.schedule('a'); await f.service.flush('a')
        expect(f.apply).toHaveBeenCalledWith('ready', { modelReasoningEffort: 'ultra', serviceTier: 'fast' })
    })

    it('reconciles an externally changed applied setting back to the selected maximum', async () => {
        const target = session('drift', 'a'); const f = fixture([target])
        f.service.set('a', true, 0); await f.service.flush('a')
        target.modelReasoningEffort = 'low'; target.serviceTier = 'standard'
        f.service.schedule('a'); await f.service.flush('a')
        expect(f.apply).toHaveBeenLastCalledWith('drift', { modelReasoningEffort: 'ultra', serviceTier: 'fast' })
    })

    it('restores after an ambiguous ON failure only once per OFF revision', async () => {
        const target = session('one', 'a'); const f = fixture([target])
        let calls = 0
        f.apply.mockImplementation(async (_id, config) => { calls++; target.modelReasoningEffort = config.modelReasoningEffort ?? null; target.serviceTier = config.serviceTier ?? null; if (calls === 1) throw new Error('disconnect after apply') })
        f.service.set('a', true, 0); await f.service.flush('a')
        expect(f.service.state('a').sessions[0]?.status).toBe('failed')
        f.service.set('a', false, 1); await f.service.flush('a')
        expect(f.apply).toHaveBeenLastCalledWith('one', { modelReasoningEffort: null, serviceTier: null })
        const restoredCalls = f.apply.mock.calls.length
        f.service.schedule('a'); await f.service.flush('a')
        expect(f.apply.mock.calls.length).toBe(restoredCalls)
    })

    it('does not repeatedly read an unchanged unsupported catalog', async () => {
        const target = session('bad', 'a'); target.model = 'other'
        const f = fixture([target]); f.service.set('a', true, 0); await f.service.flush('a')
        expect(f.catalog).toHaveBeenCalledTimes(1)
        f.service.schedule('a'); await f.service.flush('a')
        expect(f.catalog).toHaveBeenCalledTimes(1)
    })

    it('takes a fresh baseline after a completed restore and preserves unfinished peers', async () => {
        const done = session('done', 'a'); const offline = session('offline', 'a'); const f = fixture([done, offline])
        f.service.set('a', true, 0); await f.service.flush('a')
        offline.active = false
        f.service.set('a', false, 1); await f.service.flush('a')
        expect(f.service.state('a').restoring).toBe(true)
        done.modelReasoningEffort = 'medium'; done.serviceTier = 'standard'
        f.service.set('a', true, 2); await f.service.flush('a')
        expect(f.service.state('a').sessions.find(row => row.sessionId === 'done')?.previous).toEqual({ modelReasoningEffort: 'medium', serviceTier: 'standard' })
        expect(f.service.state('a').sessions.find(row => row.sessionId === 'offline')?.previous).toEqual({ modelReasoningEffort: null, serviceTier: null })
    })
})

