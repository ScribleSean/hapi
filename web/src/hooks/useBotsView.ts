import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_BOTS_VIEW = true

function getBotsViewStorageKey(): string {
    return 'hapi-bots-view'
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) {
        return null
    }
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseBotsView(raw: string | null): boolean {
    if (raw === 'true' || raw === 'false') return raw === 'true'
    return DEFAULT_BOTS_VIEW
}

export function getInitialBotsView(): boolean {
    return parseBotsView(safeGetItem(getBotsViewStorageKey()))
}

export function useBotsView(): {
    botsView: boolean
    setBotsView: (value: boolean) => void
} {
    const [botsView, setBotsViewState] = useState<boolean>(getInitialBotsView)

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getBotsViewStorageKey()) {
                return
            }
            setBotsViewState(parseBotsView(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setBotsView = useCallback((value: boolean) => {
        setBotsViewState(value)

        if (value === DEFAULT_BOTS_VIEW) {
            safeRemoveItem(getBotsViewStorageKey())
        } else {
            safeSetItem(getBotsViewStorageKey(), String(value))
        }
    }, [])

    return { botsView, setBotsView }
}
