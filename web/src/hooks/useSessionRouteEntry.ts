import { useCallback, useEffect, useRef } from 'react'

export type SessionRouteEntry = {
    sessionId: string
    generation: number
}

/**
 * Identifies one visit to a session route. A to B to A creates a new entry,
 * so a late continuation from the first A cannot navigate over the second.
 */
export function useSessionRouteEntry(sessionId: string): {
    entry: SessionRouteEntry
    isCurrent: (entry: SessionRouteEntry) => boolean
} {
    const entryRef = useRef<SessionRouteEntry>({ sessionId, generation: 0 })
    const mountedRef = useRef(false)

    if (entryRef.current.sessionId !== sessionId) {
        entryRef.current = {
            sessionId,
            generation: entryRef.current.generation + 1,
        }
    }

    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])

    const isCurrent = useCallback((entry: SessionRouteEntry) => (
        mountedRef.current && entryRef.current === entry
    ), [])

    return { entry: entryRef.current, isCurrent }
}
