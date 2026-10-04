import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import { ExternalSessionError, EXTERNAL_SESSION_TIMEOUT_MS } from '../../sync/externalSessionService'

type ExternalEnv = { Variables: { namespace: string } }
const identifier = z.string().min(1).max(512)
const registrationSchema = z.object({
    machineId: identifier,
    host: z.string().min(1).max(1024),
    directory: z.string().min(1).max(8192),
    title: z.string().min(1).max(1024),
    claudeSessionId: identifier,
    platform: z.string().min(1).max(128).optional()
}).strict()
const heartbeatSchema = z.object({ active: z.boolean().default(true), thinking: z.boolean().default(false) }).strict()
const appendSchema = z.object({ messages: z.array(z.object({
    clientMessageId: identifier,
    createdAt: z.number().int().nonnegative(),
    content: z.object({
        role: z.enum(['user', 'agent']),
        content: z.unknown().refine(value => value !== undefined),
        meta: z.record(z.string(), z.unknown()).optional()
    }).strict()
}).strict()).min(1).max(200) }).strict()
const pollSchema = z.object({
    waitMs: z.coerce.number().int().min(0).max(25_000).default(20_000),
    limit: z.coerce.number().int().min(1).max(200).default(100)
}).strict()
const ackSchema = z.object({ localIds: z.array(identifier).min(1).max(200) }).strict()

export function createExternalSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<ExternalEnv> {
    const app = new Hono<ExternalEnv>()
    app.use('*', async (context, next) => {
        if (!getSyncEngine()) return context.json({ error: 'Not ready' }, 503)
        context.header('Cache-Control', 'no-store')
        return await next()
    })
    app.onError((error, context) => {
        if (error instanceof ExternalSessionError) {
            return context.json({ error: error.message, code: error.code }, error.status)
        }
        throw error
    })
    app.post('/', async context => {
        const parsed = registrationSchema.safeParse(await context.req.json().catch(() => null))
        if (!parsed.success) return context.json({ error: 'Invalid body' }, 400)
        const session = getSyncEngine()!.externalSessions.register(context.get('namespace'), parsed.data)
        return context.json({ session, heartbeatTimeoutMs: EXTERNAL_SESSION_TIMEOUT_MS })
    })
    app.post('/:id/heartbeat', async context => {
        const parsed = heartbeatSchema.safeParse(await context.req.json().catch(() => null))
        if (!parsed.success) return context.json({ error: 'Invalid body' }, 400)
        const session = getSyncEngine()!.externalSessions.heartbeat(
            context.req.param('id'), context.get('namespace'), parsed.data.active, parsed.data.thinking
        )
        return context.json({ session, heartbeatTimeoutMs: EXTERNAL_SESSION_TIMEOUT_MS })
    })
    app.post('/:id/messages', async context => {
        const parsed = appendSchema.safeParse(await context.req.json().catch(() => null))
        if (!parsed.success) return context.json({ error: 'Invalid body' }, 400)
        const messages = getSyncEngine()!.externalSessions.append(context.req.param('id'), context.get('namespace'), parsed.data.messages)
        return context.json({ messages })
    })
    app.post('/:id/end', async context => {
        const parsed = z.object({}).strict().safeParse(await context.req.json().catch(() => null))
        if (!parsed.success) return context.json({ error: 'Invalid body' }, 400)
        getSyncEngine()!.externalSessions.end(context.req.param('id'), context.get('namespace'))
        return context.json({ ok: true })
    })
    app.get('/:id/inbound', async context => {
        const parsed = pollSchema.safeParse(context.req.query())
        if (!parsed.success) return context.json({ error: 'Invalid query' }, 400)
        const messages = await getSyncEngine()!.externalSessions.inbound(
            context.req.param('id'), context.get('namespace'), parsed.data.waitMs, parsed.data.limit, context.req.raw.signal
        )
        return context.json({ messages })
    })
    app.post('/:id/inbound/ack', async context => {
        const parsed = ackSchema.safeParse(await context.req.json().catch(() => null))
        if (!parsed.success) return context.json({ error: 'Invalid body' }, 400)
        const invokedAt = getSyncEngine()!.externalSessions.acknowledge(context.req.param('id'), context.get('namespace'), parsed.data.localIds)
        return context.json({ ok: true, invokedAt })
    })
    return app
}
