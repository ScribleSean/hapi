import { useCallback, useEffect, useRef, useState } from 'react'

export type SessionAutoConnectStatus = {
    state: 'connecting' | 'unavailable'
    message: string
} | null

type Options = {
    routeKey: string
    sessionAvailable: boolean
    /** A route opened live must never reconnect after it is explicitly archived. */
    sessionActive: boolean
    machineAvailabilityKnown: boolean
    eligible: boolean
    unavailableMessage: string
    resolveSessionId: (sessionId: string) => Promise<{ sessionId: string }>
    onResolved: (sessionId: string) => void | Promise<void>
}

type RouteEntry = { routeKey: string; initialized: boolean; attempted: boolean }

/** Attempts one reconnect only while the selected route first opens. */
export function useSessionAutoConnect(options: Options): {
    status: SessionAutoConnectStatus
    retry: () => void
} {
    const entryRef = useRef<RouteEntry>({ routeKey: options.routeKey, initialized: false, attempted: false })
    const mountedRef = useRef(false)
    const [retryToken, setRetryToken] = useState(0)
    const [status, setStatus] = useState<SessionAutoConnectStatus>(null)

    if (entryRef.current.routeKey !== options.routeKey) {
        entryRef.current = { routeKey: options.routeKey, initialized: false, attempted: false }
    }

    const retry = useCallback(() => {
        const entry = entryRef.current
        if (!entry.initialized) return
        entry.attempted = false
        setStatus(null)
        setRetryToken((token) => token + 1)
    }, [])

    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])

    // Effects run in declaration order, so this cannot erase Connecting.
    useEffect(() => { setStatus(null) }, [options.routeKey])

    useEffect(() => {
        const entry = entryRef.current
        if (!options.sessionAvailable) return
        if (options.sessionActive) {
            entry.initialized = true
            entry.attempted = true
            return
        }
        if (!options.machineAvailabilityKnown) return
        if (entry.initialized && entry.attempted) return

        entry.initialized = true
        if (!options.eligible) {
            // No resume request happened. Keep this entry eligible for its
            // single first attempt if its owner comes online later.
            setStatus({ state: 'unavailable', message: options.unavailableMessage })
            return
        }

        entry.attempted = true
        setStatus({ state: 'connecting', message: 'Connecting...' })
        void options.resolveSessionId(options.routeKey).then(({ sessionId }) => {
            if (!mountedRef.current || entryRef.current !== entry) return
            setStatus(null)
            return options.onResolved(sessionId)
        }).catch((error: unknown) => {
            if (!mountedRef.current || entryRef.current !== entry) return
            const message = error instanceof Error && error.message ? error.message : options.unavailableMessage
            setStatus({ state: 'unavailable', message })
        })
    }, [
        options.sessionAvailable,
        options.sessionActive,
        options.machineAvailabilityKnown,
        options.eligible,
        options.unavailableMessage,
        options.routeKey,
        options.resolveSessionId,
        options.onResolved,
        retryToken,
    ])

    return { status, retry }
}
