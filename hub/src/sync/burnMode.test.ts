import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { Store } from '../store'
import { BurnModeService } from './burnMode'

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
    const apply = mock(async (id: string, config: { modelReasoningEffort: string | null, serviceTier: string | null }) => {
        const target = items.find(item => item.id === id)!; target.modelReasoningEffort = config.modelReasoningEffort; target.serviceTier = config.serviceTier
    })
    const service = new BurnModeService(store, {
        sessions: namespace => items.filter(item => item.namespace === namespace),
        catalog: async () => ({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['ultra'], serviceTiers: ['priority'] }] }),
        apply
    })
    return { store, items, apply, service }
}

describe('BurnModeService', () => {
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

    it('restores the exact null baseline and does not call unsupported or offline bots', async () => {
        const offline = session('offline', 'a', false)
        const unsupported = session('other', 'a', true, 'claude')
        const f = fixture([session('one', 'a'), offline, unsupported])
        f.service.set('a', true, 0)
        await settle(); expect(f.apply).toHaveBeenCalledTimes(1)
        expect(f.service.state('a').sessions.find(item => item.sessionId === 'offline')).toMatchObject({ status: 'pending' })
        expect(f.service.state('a').sessions.find(item => item.sessionId === 'other')).toMatchObject({ status: 'unsupported' })
        f.service.set('a', false, 1)
        await settle(); expect(f.apply).toHaveBeenLastCalledWith('one', { modelReasoningEffort: null, serviceTier: null })
    })

    it('applies an offline session only after an explicit later reconciliation', async () => {
        const target = session('one', 'a', false); const f = fixture([target])
        f.service.set('a', true, 0)
        await settle(); expect(f.service.state('a').sessions[0]?.status).toBe('pending')
        expect(f.apply).not.toHaveBeenCalled()
        target.active = true; f.service.schedule('a')
        await settle(); expect(f.apply).toHaveBeenCalledTimes(1)
    })
})
