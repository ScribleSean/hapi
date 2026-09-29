import { Hono } from 'hono'
import { UpdateBurnModeRequestSchema } from '@hapi/protocol/burnMode'
import type { WebAppEnv } from '../middleware/auth'
import type { SyncEngine } from '../../sync/syncEngine'
import { requireSyncEngine } from './guards'

export function createBurnModeRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.get('/burn-mode', c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        return engine instanceof Response ? engine : c.json(engine.getBurnMode(c.get('namespace')))
    })
    app.put('/burn-mode', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = UpdateBurnModeRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const state = engine.setBurnMode(c.get('namespace'), parsed.data.enabled, parsed.data.expectedRevision)
        if (!state) return c.json({ error: 'Burn mode was changed by another client', state: engine.getBurnMode(c.get('namespace')) }, 409)
        return c.json(state)
    })
    app.post('/burn-mode/retry', c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        return engine instanceof Response ? engine : c.json(engine.retryBurnMode(c.get('namespace')))
    })
    return app
}
