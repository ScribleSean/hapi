import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { BurnModeState } from '@hapi/protocol/burnMode'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { ApiError } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { BurnModeControl, getBurnModeSummary } from './BurnModeControl'

function state(overrides: Partial<BurnModeState> = {}): BurnModeState {
    return {
        enabled: false,
        revision: 2,
        updatedAt: 1,
        restoring: false,
        sessions: [],
        ...overrides,
    }
}

function session(id: string, title: string): SessionSummary {
    return {
        id, active: false, thinking: false, activeAt: 0, updatedAt: 0, metadata: { path: '/work', name: title }, metadataVersion: 0,
        agentStateVersion: 0, todosUpdatedAt: 0, todoProgress: null, pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [],
        backgroundTaskCount: 0, futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null,
    }
}

function renderControl(api: ApiClient, sessions: SessionSummary[] = [session('one', 'First bot')], copies: number = 1) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const Wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}><I18nProvider>{children}</I18nProvider></QueryClientProvider>
    return render(<>{Array.from({ length: copies }, (_, index) => <BurnModeControl key={index} api={api} sessions={sessions} />)}</>, { wrapper: Wrapper })
}

describe('BurnModeControl', () => {
    it('starts off, then sends the current revision and only shows enabled after the hub acknowledges', async () => {
        const getBurnMode = vi.fn().mockResolvedValue(state())
        const updateBurnMode = vi.fn().mockResolvedValue(state({ enabled: true, revision: 3, sessions: [{ sessionId: 'one', status: 'pending', detail: 'Waiting for runner', previous: { modelReasoningEffort: null, serviceTier: null } }] }))
        renderControl({ getBurnMode, updateBurnMode, retryBurnMode: vi.fn() } as unknown as ApiClient)
        await screen.findByRole('button', { name: 'Burn status: Off. View details' })
        const toggle = screen.getByRole('switch')
        expect(toggle).toHaveClass('h-11')
        expect(toggle).toHaveAttribute('aria-checked', 'false')
        fireEvent.click(toggle)
        await waitFor(() => expect(updateBurnMode).toHaveBeenCalledWith(true, 2))
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
        expect(screen.getByText('1 pending')).toBeInTheDocument()
    })

    it('allows turning off while results are still pending and reports restoring state honestly', async () => {
        const getBurnMode = vi.fn().mockResolvedValue(state({ enabled: true, revision: 5, sessions: [{ sessionId: 'one', status: 'pending', detail: 'Waiting', previous: null }] }))
        const updateBurnMode = vi.fn().mockResolvedValue(state({ revision: 6, restoring: true, sessions: [{ sessionId: 'one', status: 'pending', detail: 'Restoring', previous: { modelReasoningEffort: 'high', serviceTier: 'fast' } }] }))
        renderControl({ getBurnMode, updateBurnMode, retryBurnMode: vi.fn() } as unknown as ApiClient)
        await screen.findByRole('button', { name: 'Burn status: 1 pending. View details' })
        const toggle = screen.getByRole('switch')
        fireEvent.click(toggle)
        await waitFor(() => expect(updateBurnMode).toHaveBeenCalledWith(false, 5))
        await waitFor(() => expect(screen.getByText('Restoring 1')).toBeInTheDocument())
    })

    it('uses a reduced-motion-safe flame treatment while enabled', async () => {
        const getBurnMode = vi.fn().mockResolvedValue(state({ enabled: true }))
        renderControl({ getBurnMode, updateBurnMode: vi.fn(), retryBurnMode: vi.fn() } as unknown as ApiClient)
        const toggle = await screen.findByRole('switch', { name: /Turn Burn off/i })
        expect(toggle).toHaveClass('focus-visible:ring-orange-500')
        expect(toggle.querySelector('.motion-reduce\\:animate-none')).not.toBeNull()
        expect(screen.getByText('Burn').parentElement).toHaveClass('shadow-[0_0_20px_rgba(249,115,22,0.18)]')
    })

    it('shows unavailable separately from repair failures and keeps a mobile-safe details affordance', async () => {
        const getBurnMode = vi.fn().mockResolvedValue(state({ enabled: true, sessions: [{ sessionId: 'one', status: 'unsupported', detail: 'Codex capability unavailable', previous: { modelReasoningEffort: null, serviceTier: null } }] }))
        renderControl({ getBurnMode, updateBurnMode: vi.fn(), retryBurnMode: vi.fn() } as unknown as ApiClient)
        await screen.findByRole('button', { name: /Burn status: 1 unavailable/i })
        fireEvent.click(screen.getByRole('button', { name: /Burn status: 1 unavailable/i }))
        expect(screen.getByRole('dialog')).toHaveClass('max-h-[85dvh]')
        expect(screen.getByText('First bot')).toBeInTheDocument()
        expect(screen.getByText('Unsupported')).toBeInTheDocument()
        expect(screen.getByText(/reasoning Default.*tier Default/)).toBeInTheDocument()
    })

    it('does not loop a failed read and offers an explicit retry', async () => {
        const getBurnMode = vi.fn().mockRejectedValueOnce(new Error('Hub unavailable')).mockResolvedValue(state())
        renderControl({ getBurnMode, updateBurnMode: vi.fn(), retryBurnMode: vi.fn() } as unknown as ApiClient)
        await screen.findByText(/Unavailable/)
        expect(getBurnMode).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: /Burn status: Unavailable/i }))
        expect(screen.getByText('Hub unavailable')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await waitFor(() => expect(getBurnMode).toHaveBeenCalledTimes(2))
    })

    it('refreshes authoritative state after a stale compare-and-swap error', async () => {
        const latest = state({ enabled: true, revision: 9 })
        const getBurnMode = vi.fn().mockResolvedValueOnce(state({ revision: 8 })).mockResolvedValue(latest)
        const updateBurnMode = vi.fn().mockRejectedValue(new ApiError('Burn mode changed elsewhere', 409))
        renderControl({ getBurnMode, updateBurnMode, retryBurnMode: vi.fn() } as unknown as ApiClient)
        await screen.findByRole('button', { name: 'Burn status: Off. View details' })
        const toggle = screen.getByRole('switch')
        fireEvent.click(toggle)
        await waitFor(() => expect(getBurnMode).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    })

    it('marks a mutation failure beside the switch while retaining the exact error in details', async () => {
        renderControl({
            getBurnMode: vi.fn().mockResolvedValue(state()),
            updateBurnMode: vi.fn().mockRejectedValue(new Error('Revision is stale')),
            retryBurnMode: vi.fn(),
        } as unknown as ApiClient)
        await screen.findByRole('button', { name: 'Burn status: Off. View details' })
        fireEvent.click(screen.getByRole('switch'))
        await screen.findByRole('alert')
        expect(screen.getByRole('alert')).toHaveTextContent('Update failed')
        fireEvent.click(screen.getByRole('button', { name: 'Burn status: Off. View details' }))
        expect(screen.getByText('Revision is stale')).toBeInTheDocument()
    })

    it('shares an acknowledged update through the Burn query cache', async () => {
        const getBurnMode = vi.fn().mockResolvedValue(state())
        const updateBurnMode = vi.fn().mockResolvedValue(state({ enabled: true, revision: 3 }))
        renderControl({ getBurnMode, updateBurnMode, retryBurnMode: vi.fn() } as unknown as ApiClient, undefined, 2)
        await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2))
        await screen.findAllByRole('button', { name: 'Burn status: Off. View details' })
        await waitFor(() => expect(getBurnMode).toHaveBeenCalledTimes(1))
        fireEvent.click(screen.getAllByRole('switch')[0])
        await waitFor(() => expect(screen.getAllByRole('switch').every((toggle) => toggle.getAttribute('aria-checked') === 'true')).toBe(true))
    })

    it('keeps the off switch available while a retry RPC is pending', async () => {
        let resolveRetry: ((value: BurnModeState) => void) | undefined
        const retryBurnMode = vi.fn(() => new Promise<BurnModeState>((resolve) => { resolveRetry = resolve }))
        renderControl({
            getBurnMode: vi.fn().mockResolvedValue(state({ enabled: true, sessions: [{ sessionId: 'one', status: 'failed', detail: 'Offline', previous: null }] })),
            updateBurnMode: vi.fn().mockResolvedValue(state()), retryBurnMode,
        } as unknown as ApiClient)
        await screen.findByRole('button', { name: 'Burn status: 1 needs attention. View details' })
        const toggle = screen.getByRole('switch')
        fireEvent.click(screen.getByRole('button', { name: 'Burn status: 1 needs attention. View details' }))
        fireEvent.click(screen.getByRole('button', { name: 'Retry failed updates' }))
        expect(toggle).not.toBeDisabled()
        resolveRetry?.(state({ enabled: true }))
    })
})

describe('getBurnModeSummary', () => {
    it('reports unsupported bots as unavailable rather than needing repair', () => {
        expect(getBurnModeSummary(state({ enabled: true, sessions: [
            { sessionId: 'one', status: 'applied', detail: '', previous: null },
            { sessionId: 'two', status: 'unsupported', detail: '', previous: null },
        ] }))).toBe('1 unavailable')
    })

    it('does not report an unsuccessful restore as merely zero pending', () => {
        expect(getBurnModeSummary(state({ restoring: true, sessions: [
            { sessionId: 'one', status: 'failed', detail: '', previous: null },
        ] }))).toBe('Restore needs attention: 1')
    })
})
