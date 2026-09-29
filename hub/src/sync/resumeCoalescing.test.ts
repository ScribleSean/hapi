import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

type SpawnResult = { type: 'success'; sessionId: string } | { type: 'error'; message: string }

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

async function flush(): Promise<void> {
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function fixture(namespace = 'default') {
    const store = new Store(':memory:')
    const engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never)
    const session = engine.getOrCreateSession(
        'resume-coalescing-source',
        { path: '/tmp/project', host: 'localhost', machineId: 'machine-1', flavor: 'codex', codexSessionId: 'native-thread' },
        null,
        namespace,
        'test-model'
    )
    engine.getOrCreateMachine('machine-1', { host: 'localhost', platform: 'linux', happyCliVersion: 'test' }, null, namespace)
    engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })
    ;(engine as any).waitForSessionActive = async () => true
    return { store, engine, session }
}

function installSpawn(engine: SyncEngine, work: () => Promise<SpawnResult>): () => number {
    let calls = 0
    ;(engine as any).rpcGateway.spawnSession = async () => {
        calls += 1
        return work()
    }
    return () => calls
}

describe('ordinary resume coalescing', () => {
    it('coalesces concurrent ordinary resumes into one spawn and returns the same session id', async () => {
        const { engine, session } = fixture()
        const gate = deferred<SpawnResult>()
        const calls = installSpawn(engine, () => gate.promise)
        try {
            const first = engine.resumeSession(session.id, 'default')
            await flush()
            const second = engine.resumeSession(session.id, 'default')
            await flush()
            expect(calls()).toBe(1)
            gate.resolve({ type: 'success', sessionId: session.id })
            await expect(first).resolves.toEqual({ type: 'success', sessionId: session.id })
            await expect(second).resolves.toEqual({ type: 'success', sessionId: session.id })
        } finally {
            engine.stop()
        }
    })

    it('propagates a merged replacement id to every concurrent ordinary resume', async () => {
        const { engine, session } = fixture()
        const replacementId = 'resume-coalescing-replacement'
        const gate = deferred<SpawnResult>()
        const calls = installSpawn(engine, async () => {
            engine.getOrCreateSession(
                replacementId,
                { path: '/tmp/project', host: 'localhost', machineId: 'machine-1', flavor: 'codex', codexSessionId: 'replacement-native-thread' },
                null,
                'default',
                'test-model',
                undefined,
                undefined,
                replacementId
            )
            return gate.promise
        })
        try {
            const first = engine.resumeSession(session.id, 'default')
            await flush()
            const second = engine.resumeSession(session.id, 'default')
            await flush()
            expect(calls()).toBe(1)
            gate.resolve({ type: 'success', sessionId: replacementId })
            await expect(first).resolves.toEqual({ type: 'success', sessionId: replacementId })
            await expect(second).resolves.toEqual({ type: 'success', sessionId: replacementId })
        } finally {
            engine.stop()
        }
    })

    it('does not serialize resumes for different ordinary sessions', async () => {
        const { engine, session } = fixture()
        const other = engine.getOrCreateSession(
            'resume-coalescing-other',
            { path: '/tmp/other', host: 'localhost', machineId: 'machine-1', flavor: 'codex', codexSessionId: 'other-native-thread' },
            null,
            'default',
            'test-model'
        )
        const gate = deferred<void>()
        let spawnCalls = 0
        ;(engine as any).rpcGateway.spawnSession = async (...args: unknown[]) => {
            spawnCalls += 1
            await gate.promise
            return { type: 'success', sessionId: args[12] as string }
        }
        ;(engine as any).waitForSessionActive = async () => true
        try {
            const first = engine.resumeSession(session.id, 'default')
            const second = engine.resumeSession(other.id, 'default')
            await flush()
            expect(spawnCalls).toBe(2)
            gate.resolve()
            await expect(first).resolves.toEqual({ type: 'success', sessionId: session.id })
            await expect(second).resolves.toEqual({ type: 'success', sessionId: other.id })
        } finally {
            engine.stop()
        }
    })
    it('releases a failed coalesced attempt so a later resume can retry', async () => {
        const { engine, session } = fixture()
        const firstAttempt = deferred<SpawnResult>()
        let attempt = 0
        const calls = installSpawn(engine, () => {
            attempt += 1
            return attempt === 1 ? firstAttempt.promise : Promise.resolve({ type: 'success', sessionId: session.id })
        })
        try {
            const first = engine.resumeSession(session.id, 'default')
            await flush()
            const second = engine.resumeSession(session.id, 'default')
            await flush()
            expect(calls()).toBe(1)
            firstAttempt.resolve({ type: 'error', message: 'runner rejected resume' })
            await expect(first).resolves.toMatchObject({ type: 'error', code: 'resume_failed' })
            await expect(second).resolves.toMatchObject({ type: 'error', code: 'resume_failed' })
            await expect(engine.resumeSession(session.id, 'default')).resolves.toEqual({ type: 'success', sessionId: session.id })
            expect(calls()).toBe(2)
        } finally {
            engine.stop()
        }
    })

    it('rejects a denied namespace without joining its matching in-flight resume', async () => {
        const { engine, session } = fixture()
        const gate = deferred<SpawnResult>()
        const calls = installSpawn(engine, () => gate.promise)
        try {
            const allowed = engine.resumeSession(session.id, 'default')
            await flush()
            await expect(engine.resumeSession(session.id, 'other-namespace')).resolves.toEqual({
                type: 'error', message: 'Session access denied', code: 'access_denied'
            })
            expect(calls()).toBe(1)
            gate.resolve({ type: 'success', sessionId: session.id })
            await expect(allowed).resolves.toEqual({ type: 'success', sessionId: session.id })
        } finally {
            engine.stop()
        }
    })
})



