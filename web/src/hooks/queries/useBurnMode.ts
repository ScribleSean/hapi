import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BurnModeState } from '@hapi/protocol/burnMode'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

function burnModeError(error: unknown): string | null {
    if (!error) return null
    return error instanceof Error ? error.message : 'Could not update Burn mode'
}

/** The hub owns this state, so the UI only updates after an acknowledged response. */
export function useBurnMode(api: ApiClient | null) {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: queryKeys.burnMode,
        queryFn: async () => {
            if (!api) throw new Error('Burn mode is unavailable')
            return await api.getBurnMode()
        },
        enabled: Boolean(api),
        retry: false,
        refetchInterval: 5_000,
        refetchOnWindowFocus: true,
    })
    const store = (state: BurnModeState) => queryClient.setQueryData(queryKeys.burnMode, state)
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.burnMode })
    const update = useMutation({
        mutationFn: async (enabled: boolean) => {
            if (!api) throw new Error('Burn mode is unavailable')
            const current = queryClient.getQueryData<BurnModeState>(queryKeys.burnMode) ?? query.data
            if (!current) throw new Error('Burn mode has not loaded yet')
            return await api.updateBurnMode(enabled, current.revision)
        },
        onSuccess: store,
        // A stale compare-and-swap response means another client won. Refresh
        // from the hub rather than guessing whether the fleet was changed.
        onError: () => { void refresh() },
    })
    const retry = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('Burn mode is unavailable')
            return await api.retryBurnMode()
        },
        onSuccess: store,
    })
    return {
        state: query.data,
        isLoading: query.isLoading,
        readError: burnModeError(query.error),
        updateError: burnModeError(update.error),
        retryError: burnModeError(retry.error),
        isUpdating: update.isPending,
        isRetrying: retry.isPending,
        setEnabled: update.mutate,
        retryFailed: retry.mutate,
        refetch: query.refetch,
    }
}
