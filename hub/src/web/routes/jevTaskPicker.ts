import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { WebAppEnv } from '../middleware/auth'
import { loadPickPolicy, PickRequestSchema, reservePickCall, selectTaskModel } from '../../services/jevTaskPicker'

export function createJevTaskPickerRoutes(dataDir: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('/experimental/task-picker/*', async (c, next) => {
        c.header('Cache-Control', 'no-store')
        if (c.get('namespace') !== 'default') return c.json({ error: 'Only the hub owner can use this experiment.' }, 403)
        return await next()
    })
    app.get('/experimental/task-picker/status', async (c) => {
        try {
            const policy = await loadPickPolicy(dataDir)
            if (!process.env.TYPESAFE_API_KEY) throw Error('Set TYPESAFE_API_KEY on the hub host.')
            if (Date.parse(policy.creditWindow.expiresAt) <= Date.now()) throw Error('Jev free-credit authorization expired.')
            return c.json({ ready: true, reason: null })
        } catch (error) {
            return c.json({ ready: false, reason: error instanceof Error ? error.message : 'Jev is unavailable.' })
        }
    })
    app.post('/experimental/task-picker/choose', bodyLimit({ maxSize: 65536 }), async (c) => {
        const body = await c.req.json().catch((error: unknown) => {
            // Preserve stream/body-limit errors for Hono's 413 middleware.
            if (error instanceof SyntaxError) return null
            throw error
        })
        const parsed = PickRequestSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid task-picker request.' }, 400)
        try {
            const policy = await loadPickPolicy(dataDir)
            const result = await selectTaskModel({
                policy, request: parsed.data, apiKey: process.env.TYPESAFE_API_KEY ?? '',
                reserve: () => reservePickCall(dataDir, policy),
            })
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Jev is unavailable. No settings changed.' }, 409)
        }
    })
    return app
}
