import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { applyReasoningTargets, cursorReasoningOptions, loadReasoningTarget } from './sessionReasoning'

const summary = (flavor = 'codex', extra = {}) => ({ id: 'one', active: true, model: 'm', effort: null, modelReasoningEffort: 'medium', metadata: { path: '/work', name: 'Bot', flavor }, ...extra }) as SessionSummary
function setup(flavor = 'codex', extra = {}) {
    const session = { ...summary(flavor, extra), agentState: null }
    const methods = {
        getSession: vi.fn().mockImplementation(async () => ({ session })),
        getSessionCodexModels: vi.fn().mockResolvedValue({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['low', 'medium', 'ultra'] }] }),
        getSessionGrokReasoningEffortOptions: vi.fn().mockResolvedValue({ success: true, options: [{ value: 'low' }, { value: 'high' }] }),
        getSessionOpencodeReasoningEffortOptions: vi.fn().mockResolvedValue({ success: true, currentModelId: 'm', options: [{ value: 'high' }] }),
        getSessionCursorModels: vi.fn(),
        callPiEndpoint: vi.fn(),
        setModelReasoningEffort: vi.fn().mockResolvedValue(undefined),
        setEffort: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn().mockResolvedValue(undefined),
    }
    return { session, methods, api: methods as unknown as ApiClient }
}
describe('reasoning capability preflight', () => {
    it('does not contact offline sessions or unsupported harnesses', async () => {
        const { api, methods } = setup()
        expect((await loadReasoningTarget(api, summary('codex', { active: false }))).unavailable).toContain('Offline')
        for (const flavor of ['agy', 'gemini', 'kimi', 'copilot', 'dsh']) {
            expect((await loadReasoningTarget(api, summary(flavor))).options).toEqual([])
        }
        expect(methods.getSession).not.toHaveBeenCalled()
    })
    it('uses exact model capabilities, with no Ultra fallback for local/unknown models', async () => {
        const { api } = setup('codex', { model: 'ollama-model' })
        expect((await loadReasoningTarget(api, summary())).options).toEqual([])
    })
    it('keeps discovery failure separate from unsupported', async () => {
        const { api, methods } = setup()
        methods.getSessionCodexModels.mockRejectedValue(Error('Runner timeout'))
        expect((await loadReasoningTarget(api, summary())).unavailable).toBe('Runner timeout')
    })
    it('blocks terminal-owned Codex but permits concurrent clients', async () => {
        const { api, session } = setup()
        Object.assign(session, { agentState: { controlledByUser: true } })
        expect((await loadReasoningTarget(api, summary())).unavailable).toContain('terminal')
        Object.assign(session.metadata!, { capabilities: { concurrentClients: true } })
        expect((await loadReasoningTarget(api, summary())).options.map(o => o.value)).toContain('ultra')
    })
    it('rejects stale OpenCode options during a model switch', async () => {
        const { api } = setup('opencode', { model: 'next-model' })
        expect((await loadReasoningTarget(api, summary('opencode'))).unavailable).toContain('pending')
    })
    it('uses Grok advertised efforts', async () => {
        const { api } = setup('grok')
        expect((await loadReasoningTarget(api, summary('grok'))).options.map(o => o.value)).toEqual([null, 'low', 'high'])
    })
    it('disambiguates Pi model IDs by provider and respects thinking maps', async () => {
        const { api, session, methods } = setup('pi')
        Object.assign(session.metadata!, { piSelectedModel: { provider: 'b', modelId: 'm' } })
        methods.callPiEndpoint.mockResolvedValue({ success: true, availableModels: [
            { provider: 'a', modelId: 'm', reasoning: false },
            { provider: 'b', modelId: 'm', reasoning: true, thinkingLevelMap: { high: null, max: 'max' } },
        ] })
        const values = (await loadReasoningTarget(api, summary('pi'))).options.map(o => o.value)
        expect(values).toContain('max')
        expect(values).not.toContain('high')
        expect(values).not.toContain('ultra')
    })
})
describe('bulk reasoning writes', () => {
    it('dispatches through each native endpoint, skips unsupported levels, and never starts a turn', async () => {
        const codex = setup()
        const target = await loadReasoningTarget(codex.api, summary())
        expect((await applyReasoningTargets(codex.api, [target], 'ultra'))[0].status).toBe('applied')
        expect(codex.methods.setModelReasoningEffort).toHaveBeenCalledWith('one', 'ultra')
        const claude = setup('claude')
        const ct = await loadReasoningTarget(claude.api, summary('claude'))
        expect((await applyReasoningTargets(claude.api, [ct], 'ultra'))[0].status).toBe('skipped')
        expect(claude.methods.setEffort).not.toHaveBeenCalled()
        expect((await applyReasoningTargets(claude.api, [ct], 'high'))[0].status).toBe('applied')
        expect(claude.methods.setEffort).toHaveBeenCalledWith('one', 'high')
    })
    it('skips a session that disconnects or changes model after preview', async () => {
        const { api, session, methods } = setup()
        const target = await loadReasoningTarget(api, summary())
        session.active = false
        expect((await applyReasoningTargets(api, [target], 'ultra'))[0].status).toBe('skipped')
        session.active = true
        session.model = 'new-model'
        expect((await applyReasoningTargets(api, [target], 'ultra'))[0].status).toBe('skipped')
        expect(methods.setModelReasoningEffort).not.toHaveBeenCalled()
    })
    it('reports partial failure and does not retry an ambiguous write', async () => {
        const { api, methods } = setup()
        const target = await loadReasoningTarget(api, summary())
        methods.setModelReasoningEffort.mockRejectedValueOnce(Error('Timeout'))
        const results = await applyReasoningTargets(api, [target, { ...target, id: 'two' }], 'ultra')
        expect(results.map(result => result.status)).toEqual(['failed', 'applied'])
        expect(methods.setModelReasoningEffort).toHaveBeenCalledTimes(2)
        expect(results[0].detail).toContain('Not retried')
    })
    it('reports already selected without writing', async () => {
        const { api, methods } = setup()
        const target = await loadReasoningTarget(api, summary())
        expect((await applyReasoningTargets(api, [target], 'medium'))[0].status).toBe('unchanged')
        expect(methods.setModelReasoningEffort).not.toHaveBeenCalled()
    })
})
describe('Cursor effort variants', () => {
    const current = 'opus[effort=medium,fast=false,context=300k]'
    const models = [current, 'opus[effort=high,fast=false,context=300k]', 'opus[effort=high,fast=true,context=300k]', 'opus[effort=max,fast=false,context=1m]', 'other[effort=high]'].map(modelId => ({ modelId }))
    it('preserves base model, speed and context', () => {
        expect(cursorReasoningOptions(current, models).map(option => option.modelId)).toEqual([current, models[1].modelId])
    })
    it('sets only the advertised matching wire ID', async () => {
        const { api, methods } = setup('cursor', { model: current })
        methods.getSessionCursorModels.mockResolvedValue({ success: true, availableModels: models })
        const target = await loadReasoningTarget(api, summary('cursor'))
        expect((await applyReasoningTargets(api, [target], 'high'))[0].status).toBe('applied')
        expect(methods.setModel).toHaveBeenCalledWith('one', models[1].modelId)
        expect(methods.setEffort).not.toHaveBeenCalled()
    })
})
