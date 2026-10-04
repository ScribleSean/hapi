import { describe, expect, it } from 'vitest'
import {
    consumeComposerSendIntent,
    getRestoredComposerSendIntent,
    getRetryDeliveryMode,
    resolveMessageDeliveryMode,
} from './messageDelivery'

describe('consumeComposerSendIntent', () => {
    it('consumes an explicit queue request exactly once', () => {
        const ref = { current: 'queue' as const }

        expect(consumeComposerSendIntent(ref)).toBe('queue')
        expect(ref.current).toBe('default')
        expect(consumeComposerSendIntent(ref)).toBe('default')
    })

    it('defaults safely when no composer ref is present', () => {
        expect(consumeComposerSendIntent()).toBe('default')
    })
})

describe('retry delivery safety', () => {
    it('preserves queue and downgrades steer or missing legacy provenance to queue', () => {
        expect(getRetryDeliveryMode('queue')).toBe('queue')
        expect(getRetryDeliveryMode('steer')).toBe('queue')
        expect(getRetryDeliveryMode(undefined)).toBe('queue')
        expect(getRestoredComposerSendIntent('queue')).toBe('queue')
        expect(getRestoredComposerSendIntent('steer')).toBe('queue')
        expect(getRestoredComposerSendIntent(undefined)).toBe('queue')
    })
})

describe('resolveMessageDeliveryMode', () => {
    const base = {
        agentFlavor: 'pi',
        isSessionThinking: true,
        intent: 'default' as const,
    }

    // Every composer submission queues — mid-turn delivery happens only via
    // the explicit per-queued-message Steer action (issue #1466). The old Pi
    // automatic steer while thinking was removed.
    it.each([
        { name: 'thinking Pi (previously auto-steered)', input: base },
        { name: 'thinking Pi with explicit queue intent', input: { ...base, intent: 'queue' as const } },
        { name: 'idle Pi', input: { ...base, isSessionThinking: false } },
        { name: 'non-Pi flavor', input: { ...base, agentFlavor: 'codex' } },
        { name: 'scheduled message', input: { ...base, scheduledAt: Date.now() + 60_000 } },
        { name: 'scratchlist route', input: { ...base, routesToScratchlist: true } },
    ])('queues $name', ({ input }) => {
        expect(resolveMessageDeliveryMode(input)).toBe('queue')
    })

    it('keeps the retry-restore contract: a failed steer retry restores as queue', () => {
        const ref = { current: getRestoredComposerSendIntent('steer') }
        const retryIntent = consumeComposerSendIntent(ref)

        expect(retryIntent).toBe('queue')
        expect(ref.current).toBe('default')
        expect(resolveMessageDeliveryMode({ ...base, intent: retryIntent })).toBe('queue')
    })
})


describe('default steering', () => {
    it('lets HTTP Claude decide at arrival while preserving explicit queue, schedules and scratchlist', () => {
        const http = { agentFlavor: 'claude', isSessionThinking: false, automaticallySteers: true, intent: 'default' as const }
        expect(resolveMessageDeliveryMode(http)).toBe('steer')
        expect(resolveMessageDeliveryMode({ ...http, isSessionThinking: true })).toBe('steer')
        expect(resolveMessageDeliveryMode({ ...http, intent: 'queue' })).toBe('queue')
        expect(resolveMessageDeliveryMode({ ...http, scheduledAt: 123 })).toBe('queue')
        expect(resolveMessageDeliveryMode({ ...http, routesToScratchlist: true })).toBe('queue')
    })
    const active = { agentFlavor: 'codex', isSessionThinking: true, canSteer: true, intent: 'default' as const }
    it('steers a normal send to an active capable session', () => {
        expect(resolveMessageDeliveryMode(active)).toBe('steer')
    })
    it.each([
        { ...active, canSteer: false },
        { ...active, isSessionThinking: false },
        { ...active, intent: 'queue' as const },
        { ...active, scheduledAt: 123 },
        { ...active, routesToScratchlist: true },
    ])('queues when steering is not appropriate', (input) => {
        expect(resolveMessageDeliveryMode(input)).toBe('queue')
    })
})
