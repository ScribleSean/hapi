import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Machine } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { useMachines } from './useMachines'

describe('useMachines', () => {
    it('exposes offline records only to callers requesting the device inventory', () => {
        const online: Machine = {
            id: 'mac', namespace: 'test', seq: 0, createdAt: 0, updatedAt: 0,
            active: true, activeAt: 100, metadata: null, metadataVersion: 0,
            runnerState: null, runnerStateVersion: 0,
        }
        const offline = { ...online, id: 'windows', active: false }
        const queryClient = new QueryClient()
        queryClient.setQueryData(queryKeys.machines, { machines: [online, offline] })
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )
        const { result, rerender } = renderHook(({ includeOffline }) => useMachines(null, false, includeOffline), {
            wrapper, initialProps: { includeOffline: false },
        })
        expect(result.current.machines).toEqual([online])
        rerender({ includeOffline: true })
        expect(result.current.machines).toEqual([online, offline])
    })
})
