import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSessionRouteEntry } from './useSessionRouteEntry'

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
})
