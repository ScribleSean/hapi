import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionAutoConnect } from './useSessionAutoConnect'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function options(overrides: Partial<Parameters<typeof useSessionAutoConnect>[0]> = {}) {
    return {
        routeKey: 'session-A',
        sessionAvailable: true,
        sessionActive: false,
        machineAvailabilityKnown: true,
        eligible: true,
        unavailableMessage: 'Recorded machine is unavailable',
        resolveSessionId: vi.fn(async (sessionId: string) => ({ sessionId })),
        onResolved: vi.fn(),
        ...overrides,
    }
}

describe('useSessionAutoConnect', () => {
    it('connects an initially inactive eligible route once', async () => {
        const pending = deferred<{ sessionId: string }>()
        const resolveSessionId = vi.fn(() => pending.promise)
        const onResolved = vi.fn()
        const args = options({ resolveSessionId, onResolved })
        const { result, rerender } = renderHook((next) => useSessionAutoConnect(next), { initialProps: args })

        await waitFor(() => expect(resolveSessionId).toHaveBeenCalledTimes(1))
        expect(result.current.status).toEqual({ state: 'connecting', message: 'Connecting...' })
        rerender({ ...args })
        expect(resolveSessionId).toHaveBeenCalledTimes(1)
        await act(async () => { pending.resolve({ sessionId: 'session-A' }) })
        await waitFor(() => expect(onResolved).toHaveBeenCalledWith('session-A'))
    })

    it('retains a failed error and does not loop', async () => {
        const resolveSessionId = vi.fn(async () => { throw new Error('Runner rejected resume') })
        const args = options({ resolveSessionId })
        const { result, rerender } = renderHook((next) => useSessionAutoConnect(next), { initialProps: args })

        await waitFor(() => expect(result.current.status).toEqual({
            state: 'unavailable',
            message: 'Runner rejected resume',
        }))
        rerender({ ...args })
        expect(resolveSessionId).toHaveBeenCalledTimes(1)
    })

    it('allows a draft send to join the in-flight resolver promise', async () => {
        const pending = deferred<{ sessionId: string }>()
        const resume = vi.fn(() => pending.promise)
        let inFlight: Promise<{ sessionId: string }> | null = null
        const resolveSessionId = vi.fn((_sessionId: string) => (inFlight ??= resume()))
        const args = options({ resolveSessionId })
        renderHook((next) => useSessionAutoConnect(next), { initialProps: args })

        await waitFor(() => expect(resolveSessionId).toHaveBeenCalledTimes(1))
        // SessionPage passes its existing coalescing resolver to this hook. A
        // simultaneous composer send calls that resolver and receives the
        // already-started promise instead of starting a second resume.
        expect(resolveSessionId('session-A')).toBe(pending.promise)
        expect(resume).toHaveBeenCalledOnce()
        await act(async () => { pending.resolve({ sessionId: 'session-B' }) })
    })

    it('ignores an old A outcome after A to B to A', async () => {
        const pending = deferred<{ sessionId: string }>()
        const onResolved = vi.fn()
        const args = options({ resolveSessionId: vi.fn(() => pending.promise), onResolved })
        const { rerender } = renderHook((next) => useSessionAutoConnect(next), { initialProps: args })

        await waitFor(() => expect(args.resolveSessionId).toHaveBeenCalledTimes(1))
        rerender({ ...args, routeKey: 'session-B', sessionAvailable: false })
        rerender({ ...args, routeKey: 'session-A', sessionAvailable: false })
        await act(async () => { pending.resolve({ sessionId: 'session-A-next' }) })
        expect(onResolved).not.toHaveBeenCalled()
    })

    it('does not navigate from a promise that resolves after unmount', async () => {
        const pending = deferred<{ sessionId: string }>()
        const onResolved = vi.fn()
        const args = options({ resolveSessionId: vi.fn(() => pending.promise), onResolved })
        const { unmount } = renderHook((next) => useSessionAutoConnect(next), { initialProps: args })

        unmount()
        await act(async () => { pending.resolve({ sessionId: 'session-A-next' }) })
        expect(onResolved).not.toHaveBeenCalled()
    })

    it('does not undo an explicit archive while the route remains open', async () => {
        const resolveSessionId = vi.fn(async (sessionId: string) => ({ sessionId }))
        const initiallyActive = options({ eligible: false, sessionActive: true, resolveSessionId })
        const { rerender } = renderHook((next) => useSessionAutoConnect(next), { initialProps: initiallyActive })

        rerender({ ...initiallyActive, eligible: true })
        await waitFor(() => expect(resolveSessionId).not.toHaveBeenCalled())
    })
})
