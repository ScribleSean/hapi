import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEvent } from '@hapi/protocol/types'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { createConfiguration } from '../../configuration'
import { createCliRoutes } from './cli'
import { createMessagesRoutes } from './messages'
import type { WebAppEnv } from '../middleware/auth'

const input = {
    machineId: 'windows-device', host: 'windows-host', directory: 'C:/projects/demo',
    title: 'Claude on Windows', claudeSessionId: 'native-claude-123', platform: 'win32'
}
const transcript = {
    clientMessageId: 'transcript-uuid-1', createdAt: 1000,
    content: { role: 'agent', content: { type: 'output', data: {
        type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }
    } }, meta: { sentFrom: 'cli' } }
}
const stores: Store[] = []
const engines: SyncEngine[] = []

function makeEngine(store: Store, events: SyncEvent[]) {
    const room = { emit() {}, timeout() { return this } }
    const engine = new SyncEngine(store, {
        of: () => ({ to: () => room, adapter: { rooms: new Map() }, sockets: new Map() })
    } as never, new RpcRegistry(), { broadcast: (event: SyncEvent) => events.push(event) } as never)
    engine.stop()
    engines.push(engine)
    return engine
}

function setup() {
    const store = new Store(':memory:')
    stores.push(store)
    const events: SyncEvent[] = []
    const engine = makeEngine(store, events)
    const app = new Hono()
    app.route('/cli', createCliRoutes(() => engine))
    const web = new Hono<WebAppEnv>()
    web.use('*', async (context, next) => {
        context.set('namespace', 'default')
        await next()
    })
    web.route('/', createMessagesRoutes(() => engine))
    app.route('/api', web)
    const request = (path: string, body?: unknown, token = 'test-token', signal?: AbortSignal) => app.request(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal
    })
    const register = async (body = input, token = 'test-token') => {
        const response = await request('/cli/external-sessions', body, token)
        expect(response.status).toBe(200)
        return (await response.json() as { session: Session }).session
    }
    return { app, store, engine, events, request, register }
}

beforeAll(async () => {
    const configuration = await createConfiguration()
    configuration._setCliApiToken('test-token', 'env', false)
})

afterEach(() => {
    for (const engine of engines.splice(0)) engine.stop()
    for (const store of stores.splice(0)) store.close()
})

describe('external Claude HTTP sessions', () => {
    it('registers and upserts one ordinary Claude session with the right machine', async () => {
        const { register, engine, events } = setup()
        const session = await register()
        expect(session.active).toBe(true)
        expect(session.metadata).toMatchObject({
            flavor: 'claude', path: input.directory, host: input.host, machineId: input.machineId,
            claudeSessionId: input.claudeSessionId, name: input.title,
            capabilities: { terminal: false, concurrentClients: false }
        })
        expect(session.agentState?.controlledByUser).toBe(false)
        expect(engine.getMachine(input.machineId)?.active).toBe(false)
        expect(engine.getMachine(input.machineId)?.metadata?.host).toBe(input.host)
        const updated = await register({ ...input, title: 'Renamed', directory: 'C:/projects/other' })
        expect(updated.id).toBe(session.id)
        expect(updated.metadata?.name).toBe('Renamed')
        expect(updated.metadata?.path).toBe('C:/projects/other')
        expect(engine.getSessionsByNamespace('default')).toHaveLength(1)
        expect(events.some(event => event.type === 'session-added')).toBe(true)
    })

    it('preserves an existing runner machine and separates the same native ID on another device', async () => {
        const { register, engine } = setup()
        engine.getOrCreateMachine(input.machineId, {
            host: 'runner-host', platform: 'win32', happyCliVersion: '0.1.0', displayName: 'Sean PC'
        }, null, 'default')
        engine.handleMachineAlive({ machineId: input.machineId, time: Date.now() })
        const windows = await register()
        const mac = await register({ ...input, machineId: 'mac-device', host: 'mac-host', platform: 'darwin' })
        expect(windows.id).not.toBe(mac.id)
        expect(engine.getMachine(input.machineId)?.active).toBe(true)
        expect(engine.getMachine(input.machineId)?.metadata?.displayName).toBe('Sean PC')
        expect(engine.getMachine(input.machineId)?.metadata?.host).toBe('runner-host')
    })

    it('uses existing CLI auth and enforces namespace and transport isolation', async () => {
        const { app, request, register, engine } = setup()
        expect((await app.request('/cli/external-sessions', { method: 'POST', body: JSON.stringify(input) })).status).toBe(401)
        expect((await request('/cli/external-sessions', input, 'wrong-token')).status).toBe(401)
        const session = await register()
        expect((await request(`/cli/external-sessions/${session.id}/heartbeat`, {}, 'test-token:other')).status).toBe(403)
        expect((await request('/cli/external-sessions', input, 'test-token:other')).status).toBe(403)
        const cli = engine.getOrCreateSession('regular-cli', { path: '/demo', host: 'host', flavor: 'claude' }, null, 'default')
        expect((await request(`/cli/external-sessions/${cli.id}/heartbeat`, {})).status).toBe(409)
        expect((await request('/cli/external-sessions/missing/heartbeat', {})).status).toBe(404)
        const other = await register({ ...input, machineId: 'mac-device' }, 'test-token:other')
        expect(other.namespace).toBe('other')
    })

    it('does not duplicate or take over a session already registered through the CLI', async () => {
        const { engine, request } = setup()
        engine.getOrCreateSession('cli', {
            path: input.directory, host: input.host, flavor: 'claude',
            machineId: input.machineId, claudeSessionId: input.claudeSessionId
        }, null, 'default')
        expect((await request('/cli/external-sessions', input)).status).toBe(409)
        expect(engine.getSessionsByNamespace('default')).toHaveLength(1)
    })

    it('appends transcript rows idempotently with timestamps and rejects changed identities', async () => {
        const { request, register, store, events, engine } = setup()
        const session = await register()
        const path = `/cli/external-sessions/${session.id}/messages`
        const first = await (await request(path, { messages: [transcript] })).json()
        const retry = await (await request(path, { messages: [transcript] })).json() as { messages: { inserted: boolean; id: string }[] }
        expect(retry.messages[0].inserted).toBe(false)
        expect((first as typeof retry).messages[0].id).toBe(retry.messages[0].id)
        expect(store.messages.countMessages(session.id)).toBe(1)
        expect(store.messages.getAllMessages(session.id)[0]).toMatchObject({ createdAt: 1000, invokedAt: 1000 })
        expect(store.messages.getUninvokedLocalMessages(session.id)).toHaveLength(0)
        expect(events.filter(event => event.type === 'message-received')).toHaveLength(1)
        expect(engine.getSession(session.id)?.hasConversationContent).toBe(true)
        expect((await request(path, { messages: [{ ...transcript, content: { role: 'user', content: { type: 'text', text: 'Changed' } } }] })).status).toBe(409)
        const reloaded = makeEngine(store, [])
        const registered = reloaded.externalSessions.register('default', input)
        expect(registered.id).toBe(session.id)
        expect(reloaded.externalSessions.append(session.id, 'default', [transcript])[0].inserted).toBe(false)
    })

    it('delivers UI messages, retries until explicitly acknowledged and publishes consumed state', async () => {
        const { request, register, events, store } = setup()
        const session = await register()
        expect((await request(`/api/sessions/${session.id}/messages`, { text: 'Please continue', localId: 'ui-1' })).status).toBe(200)
        const path = `/cli/external-sessions/${session.id}/inbound`
        const first = await (await request(path + '?waitMs=0')).json() as { messages: { localId: string; invokedAt: number | null; content: unknown }[] }
        expect(first.messages).toHaveLength(1)
        expect(first.messages[0]).toMatchObject({ localId: 'ui-1', invokedAt: null, content: { role: 'user', content: { text: 'Please continue' } } })
        expect(await (await request(path + '?waitMs=0')).json()).toEqual(first)
        const ack = await (await request(path + '/ack', { localIds: ['ui-1'] })).json() as { invokedAt: number }
        expect(store.messages.getLocalMessageStates(session.id, ['ui-1'])[0].invokedAt).toBe(ack.invokedAt)
        expect((await request(path + '/ack', { localIds: ['ui-1'] })).status).toBe(200)
        expect(await (await request(path + '?waitMs=0')).json()).toEqual({ messages: [] })
        expect(events.some(event => event.type === 'messages-consumed' && event.localIds.includes('ui-1'))).toBe(true)
    })

    it('recovers pending UI input and heartbeat liveness across a hub restart', async () => {
        const { register, engine, store } = setup()
        const session = await register()
        await engine.sendMessage(session.id, { text: 'Survive restart', localId: 'restart-prompt' })
        const reloaded = makeEngine(store, [])
        const rows = await reloaded.externalSessions.inbound(session.id, 'default', 0, 100, new AbortController().signal)
        expect(reloaded.getSession(session.id)?.active).toBe(true)
        expect(rows.map(row => row.localId)).toEqual(['restart-prompt'])
        expect(store.sessions.getSession(session.id)?.activeAt).toBe(session.activeAt)
        const clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
        try {
            const stale = makeEngine(store, [])
            await expect(stale.externalSessions.inbound(session.id, 'default', 0, 100, new AbortController().signal))
                .rejects.toMatchObject({ code: 'session_inactive' })
        } finally {
            clock.mockRestore()
        }
    })

    it('long-polls for new UI prompts, times out empty and cleans up aborted waits', async () => {
        const { request, register, engine } = setup()
        const session = await register()
        const path = `/cli/external-sessions/${session.id}/inbound`
        expect(await (await request(path + '?waitMs=1')).json()).toEqual({ messages: [] })
        const pending = request(path + '?waitMs=1000')
        await new Promise(resolve => setTimeout(resolve, 10))
        await engine.sendMessage(session.id, { text: 'New prompt', localId: 'ui-long-poll' })
        expect((await (await pending).json() as { messages: unknown[] }).messages).toHaveLength(1)
        await request(path + '/ack', { localIds: ['ui-long-poll'] })
        const controller = new AbortController()
        const aborted = request(path + '?waitMs=1000', undefined, 'test-token', controller.signal)
        controller.abort()
        expect(await (await aborted).json()).toEqual({ messages: [] })
    })

    it('does not deliver future schedules or ambiguous rows and validates acknowledgements', async () => {
        const { request, register, engine, store } = setup()
        const session = await register()
        await engine.sendMessage(session.id, { text: 'Later', localId: 'scheduled', scheduledAt: Date.now() + 60_000 })
        await engine.sendMessage(session.id, { text: 'Unknown', localId: 'ambiguous' })
        store.messages.markMessagesIndeterminate(session.id, ['ambiguous'])
        const path = `/cli/external-sessions/${session.id}/inbound`
        expect(await (await request(path + '?waitMs=0')).json()).toEqual({ messages: [] })
        expect((await request(path + '/ack', { localIds: ['scheduled'] })).status).toBe(409)
        expect((await request(path + '/ack', { localIds: ['missing'] })).status).toBe(409)
        expect((await request(path + '/ack', { localIds: ['external-transcript:fake'] })).status).toBe(409)
        const ambiguousId = store.messages.getAllMessages(session.id).find(message => message.localId === 'ambiguous')!.id
        expect((await request(path + '/ack', { localIds: [ambiguousId] })).status).toBe(409)
        expect((await request(path + '/ack', { localIds: ['ambiguous'] })).status).toBe(200)
        expect(store.messages.getLocalMessageStates(session.id, ['ambiguous'])[0].invokedAt).not.toBeNull()
    })

    it('expires offline sessions without losing prompts and revives them on heartbeat', async () => {
        const { request, register, engine, store, events } = setup()
        const session = await register()
        await engine.sendMessage(session.id, { text: 'Keep me', localId: 'durable' })
        engine.getSession(session.id)!.activeAt = Date.now() - 31_000
        const path = `/cli/external-sessions/${session.id}`
        expect((await request(path + '/inbound?waitMs=0')).status).toBe(409)
        ;(engine as unknown as { expireInactive(): void }).expireInactive()
        expect(engine.getSession(session.id)?.active).toBe(false)
        expect(store.messages.getLocalMessageStates(session.id, ['durable'])[0].invokedAt).toBeNull()
        expect((await request(path + '/heartbeat', { thinking: true })).status).toBe(200)
        expect(engine.getSession(session.id)?.thinking).toBe(true)
        expect((await (await request(path + '/inbound?waitMs=0')).json() as { messages: unknown[] }).messages).toHaveLength(1)
        expect(events.some(event => event.type === 'session-updated')).toBe(true)
        await request(path + '/heartbeat', { active: false })
        expect(engine.getSession(session.id)?.active).toBe(false)
    })

    it('wakes an outstanding inbound poll when the heartbeat expires', async () => {
        const { request, register, engine } = setup()
        const session = await register()
        const pending = request(`/cli/external-sessions/${session.id}/inbound?waitMs=1000`)
        await new Promise(resolve => setTimeout(resolve, 10))
        engine.getSession(session.id)!.activeAt = Date.now() - 31_000
        ;(engine as unknown as { expireInactive(): void }).expireInactive()
        expect((await pending).status).toBe(409)
    })

    it('ends idempotently, wakes polls, keeps unacknowledged prompts and permits explicit re-registration', async () => {
        const { request, register, engine, store } = setup()
        const session = await register()
        const path = `/cli/external-sessions/${session.id}`
        const pending = request(path + '/inbound?waitMs=1000')
        await new Promise(resolve => setTimeout(resolve, 10))
        expect((await request(path + '/end', {})).status).toBe(200)
        expect((await pending).status).toBe(410)
        expect((await request(path + '/end', {})).status).toBe(200)
        expect((await request(path + '/heartbeat', {})).status).toBe(410)
        expect((await request(path + '/messages', { messages: [transcript] })).status).toBe(410)
        expect(engine.getSession(session.id)?.active).toBe(false)
        const revived = await register()
        expect(revived.id).toBe(session.id)
        await engine.sendMessage(session.id, { text: 'Durable', localId: 'at-end' })
        await request(path + '/end', {})
        expect(store.messages.getLocalMessageStates(session.id, ['at-end'])[0].invokedAt).toBeNull()
        await register()
        expect((await (await request(path + '/inbound?waitMs=0')).json() as { messages: unknown[] }).messages).toHaveLength(1)
    })

    it('validates inputs and returns readiness errors', async () => {
        const { request, register } = setup()
        expect((await request('/cli/external-sessions', { ...input, machineId: '' })).status).toBe(400)
        const session = await register()
        const path = `/cli/external-sessions/${session.id}`
        expect((await request(path + '/messages', { messages: [] })).status).toBe(400)
        expect((await request(path + '/heartbeat', { active: 'yes' })).status).toBe(400)
        expect((await request(path + '/inbound?waitMs=25001')).status).toBe(400)
        const unready = new Hono().route('/cli', createCliRoutes(() => null))
        expect((await unready.request('/cli/external-sessions', {
            method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
            body: JSON.stringify(input)
        })).status).toBe(503)
    })
})
