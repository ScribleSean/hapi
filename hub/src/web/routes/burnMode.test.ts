import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import type { BurnModeState } from '@hapi/protocol/burnMode'
import type { SyncEngine } from '../../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { createBurnModeRoutes } from './burnMode'

const secret = new TextEncoder().encode('burn-mode-route-test-secret')

function state(overrides: Partial<BurnModeState> = {}): BurnModeState {
    return {
        enabled: false,
        revision: 0,
        updatedAt: 1,
        restoring: false,
        sessions: [],
        ...overrides,
    }
}

type Calls = {
    get: string[]
    set: Array<{ namespace: string, enabled: boolean, expectedRevision: number }>
    retry: string[]
}

function createEngine(states: Record<string, BurnModeState>, options: { stale?: boolean } = {}): { engine: SyncEngine, calls: Calls } {
    const calls: Calls = { get: [], set: [], retry: [] }
    return {
        calls,
        engine: {
            getBurnMode(namespace: string) {
                calls.get.push(namespace)
                return states[namespace] ?? state()
            },
            setBurnMode(namespace: string, enabled: boolean, expectedRevision: number) {
                calls.set.push({ namespace, enabled, expectedRevision })
                if (options.stale) return null
                const current = states[namespace] ?? state()
                const next = state({ ...current, enabled, revision: current.revision + 1, updatedAt: 2 })
                states[namespace] = next
                return next
            },
            retryBurnMode(namespace: string) {
                calls.retry.push(namespace)
                return states[namespace] ?? state()
            },
        } as unknown as SyncEngine,
    }
}

function createApp(engine: SyncEngine, namespace: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createBurnModeRoutes(() => engine))
    return app
}

async function authHeaders(namespace: string): Promise<Record<string, string>> {
    const token = await new SignJWT({ uid: 1, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret)
    return { authorization: `Bearer ${token}` }
}

describe('Burn mode routes', () => {
    it('returns the exact namespace-owned state without reading another namespace', async () => {
        const alpha = state({ enabled: true, revision: 3, updatedAt: 20, sessions: [{ sessionId: 'alpha-session', status: 'applied', detail: 'Applied.', previous: { modelReasoningEffort: 'high', serviceTier: 'standard' } }] })
        const beta = state({ enabled: false, revision: 9, updatedAt: 30, sessions: [{ sessionId: 'beta-session', status: 'failed', detail: 'Offline.', previous: null }] })
        const { engine, calls } = createEngine({ alpha, beta })
        const response = await createApp(engine, 'alpha').request('/api/burn-mode')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(alpha)
        expect(calls.get).toEqual(['alpha'])
    })

    it('sends a strict, namespace-bound PUT and returns the exact acknowledged state', async () => {
        const initial = state({ revision: 4, updatedAt: 10 })
        const { engine, calls } = createEngine({ tenant: initial })
        const response = await createApp(engine, 'tenant').request('/api/burn-mode', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true, expectedRevision: 4 })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(state({ enabled: true, revision: 5, updatedAt: 2 }))
        expect(calls.set).toEqual([{ namespace: 'tenant', enabled: true, expectedRevision: 4 }])
    })

    it('rejects malformed and extra PUT fields before invoking the engine', async () => {
        const { engine, calls } = createEngine({ tenant: state() })
        const app = createApp(engine, 'tenant')
        for (const body of [
            { enabled: true },
            { enabled: true, expectedRevision: 0, unexpected: true },
            { enabled: 'true', expectedRevision: 0 },
        ]) {
            const response = await app.request('/api/burn-mode', {
                method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
            })
            expect(response.status).toBe(400)
            expect(await response.json()).toEqual({ error: 'Invalid body' })
        }
        expect(calls.set).toEqual([])
    })

    it('returns the exact current namespace state on a stale compare-and-swap', async () => {
        const current = state({ enabled: true, revision: 7, updatedAt: 90, restoring: true, sessions: [{ sessionId: 'one', status: 'pending', detail: 'Restoring.', previous: { modelReasoningEffort: null, serviceTier: 'fast' } }] })
        const { engine, calls } = createEngine({ tenant: current }, { stale: true })
        const response = await createApp(engine, 'tenant').request('/api/burn-mode', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false, expectedRevision: 6 })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({ error: 'Burn mode was changed by another client', state: current })
        expect(calls.set).toEqual([{ namespace: 'tenant', enabled: false, expectedRevision: 6 }])
        expect(calls.get).toEqual(['tenant'])
    })

    it('retries only the authenticated namespace and returns its exact state', async () => {
        const tenant = state({ enabled: true, revision: 2, sessions: [{ sessionId: 'retry-me', status: 'pending', detail: 'Retry requested.', previous: null }] })
        const { engine, calls } = createEngine({ tenant, other: state({ revision: 99 }) })
        const response = await createApp(engine, 'tenant').request('/api/burn-mode/retry', { method: 'POST' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(tenant)
        expect(calls.retry).toEqual(['tenant'])
    })

    it('requires existing authentication middleware before exposing Burn state', async () => {
        const { engine } = createEngine({ tenant: state() })
        const app = new Hono<WebAppEnv>()
        app.use('*', createAuthMiddleware(secret))
        app.route('/api', createBurnModeRoutes(() => engine))

        const unauthenticated = await app.request('/api/burn-mode')
        expect(unauthenticated.status).toBe(401)
        expect(await unauthenticated.json()).toEqual({ error: 'Missing authorization token' })

        const authenticated = await app.request('/api/burn-mode', { headers: await authHeaders('tenant') })
        expect(authenticated.status).toBe(200)
    })
})
