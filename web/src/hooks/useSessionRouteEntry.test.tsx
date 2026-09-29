import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCallback } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionRouteEntry } from './useSessionRouteEntry'
import { useSendMessage } from './mutations/useSendMessage'
import type { ApiClient } from '@/api/client'

vi.mock('@/lib/message-window-store', () => ({
    appendOptimisticMessage: vi.fn(),
    getMessageWindowState: vi.fn(() => ({ messages: [] })),
    updateMessageStatus: vi.fn(),
    removeOptimisticMessage: vi.fn(),
}))
vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ haptic: { notification: vi.fn() } }) }))
vi.mock('@/lib/messages', () => ({ makeClientSideId: vi.fn(() => 'local-id') }))

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
    return { promise, resolve }
}

function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('useSessionRouteEntry', () => {
    it('rejects a late first A entry after A to B to A', () => {
        const { result, rerender } = renderHook(({ id }) => useSessionRouteEntry(id), {
            initialProps: { id: 'A' },
        })
        const firstA = result.current.entry

        rerender({ id: 'B' })
        rerender({ id: 'A' })

        expect(result.current.entry).not.toBe(firstA)
        expect(result.current.isCurrent(firstA)).toBe(false)
        expect(result.current.isCurrent(result.current.entry)).toBe(true)
    })

    it('rejects a continuation after unmount', () => {
        const { result, unmount } = renderHook(() => useSessionRouteEntry('A'))
        const entry = result.current.entry

        act(() => unmount())

        expect(result.current.isCurrent(entry)).toBe(false)
    })

    it('keeps a deferred send handoff but suppresses its first-A navigation after A to B to A', async () => {
        const resume = deferred<{ sessionId: string; resumed: true }>()
        const handoff = vi.fn()
        const navigate = vi.fn()
        const api = { sendMessage: vi.fn(async () => {}), steerMessage: vi.fn() } as unknown as ApiClient
        const { result, rerender } = renderHook(({ id }) => {
            const { entry, isCurrent } = useSessionRouteEntry(id)
            const onSessionResolved = useCallback(async (_target: string, context: { text: string }) => {
                handoff(context.text)
                if (isCurrent(entry)) navigate()
            }, [entry, isCurrent])
            return useSendMessage(api, id, {
                resolveSessionId: () => resume.promise,
                onSessionResolved,
            })
        }, { initialProps: { id: 'A' }, wrapper })

        let send: Promise<unknown> | undefined
        act(() => { send = result.current.sendMessage('keep this draft') })
        rerender({ id: 'B' })
        rerender({ id: 'A' })
        await act(async () => { resume.resolve({ sessionId: 'A-resumed', resumed: true }) })
        await send

        expect(handoff).toHaveBeenCalledWith('keep this draft')
        expect(navigate).not.toHaveBeenCalled()
        expect(api.sendMessage).toHaveBeenCalled()
    })
})
