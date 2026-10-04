import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Machine, SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { SessionList } from './SessionList'

beforeEach(() => localStorage.setItem('hapi-bots-view', 'false'))

const SEARCH_LABEL = 'Search sessions (title, path, Agent, machine name, ID, and more)'
const SEARCH_PLACEHOLDER = 'Search title/path/Agent/machine/ID…'

afterEach(() => cleanup())

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides
    }
}

function renderWithProviders(children: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        }
    })

    return render(
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <I18nProvider>
                    {children}
                </I18nProvider>
            </ToastProvider>
        </QueryClientProvider>
    )
}

function renderSessionList(sessions: SessionSummary[], machinesById: Record<string, Machine> = {}, machineLabelsById: Record<string, string> = { 'machine-1': 'Mint', 'machine-2': 'Teemo' }) {
    return renderWithProviders(
        <SessionList
            sessions={sessions}
            selectedSessionId={null}
            onSelect={vi.fn()}
            onNewSession={vi.fn()}
            onRefresh={vi.fn()}
            isLoading={false}
            renderHeader={false}
            api={null}
            machineLabelsById={machineLabelsById}
            machinesById={machinesById}
        />
    )
}

const multiMachineSessions = [
    makeSession({
        id: 'session-m1',
        updatedAt: 100,
        metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1' }
    }),
    makeSession({
        id: 'session-m2',
        updatedAt: 90,
        metadata: { path: '/work/docs', machineId: 'machine-2', agentSessionId: 'thread-2' }
    })
]

describe('SessionList header controls', () => {
    it('keeps Models & connections available beside the Burn status control', () => {
        renderSessionList([makeSession({ id: 'session-1', metadata: { path: '/work/hapi' } })])

        expect(screen.getByRole('button', { name: 'Burn status: Unavailable. View details' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Models & connections' })).toBeInTheDocument()
    })
})

describe('SessionList machine filter', () => {
    beforeEach(() => {
        window.localStorage.clear()
        localStorage.setItem('hapi-bots-view', 'false')
    })

    it('shows All and the machine when only one machine is known', () => {
        renderSessionList([
            makeSession({
                id: 'session-1',
                updatedAt: 100,
                metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1' }
            })
        ], {}, { 'machine-1': 'Mint' })

        expect(screen.getByRole('group', { name: 'Filter sessions by machine' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /All \(1\)/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Mint \(1\)/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Filter sessions by machine' })).toBeNull()
        expect(screen.getByTitle('/work/hapi')).toBeTruthy()
    })

    it('shows the filter bar and machine-suffixed group titles with multiple machines', () => {
        renderSessionList(multiMachineSessions)

        expect(screen.getByRole('group', { name: 'Filter sessions by machine' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Filter sessions by machine' })).toBeNull()
        expect(screen.getByRole('button', { name: /All \(2\)/ })).toBeTruthy()
        expect(screen.getByText('work/hapi · Mint')).toBeTruthy()
        expect(screen.getByText('work/docs · Teemo')).toBeTruthy()
    })

    it('filters directory groups when a machine chip is selected', () => {
        renderSessionList(multiMachineSessions)

        fireEvent.click(screen.getByRole('button', { name: /Teemo \(1\)/ }))

        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.getByTitle('/work/docs')).toBeTruthy()
        // Suffix disappears once a single machine is selected
        expect(screen.getByText('work/docs')).toBeTruthy()
        expect(window.localStorage.getItem('hapi-session-list-machine-filter')).toBe('machine-2')
    })

    it('falls back to All when the persisted machine is no longer known', () => {
        window.localStorage.setItem('hapi-session-list-machine-filter', 'gone-machine')
        renderSessionList(multiMachineSessions)

        expect(screen.getByTitle('/work/hapi')).toBeTruthy()
        expect(screen.getByTitle('/work/docs')).toBeTruthy()
        expect(screen.getByRole('button', { name: /All \(2\)/ }).getAttribute('aria-pressed')).toBe('true')
    })

    it('keeps known zero-session machines selectable, including a persisted empty selection', () => {
        window.localStorage.setItem('hapi-session-list-machine-filter', 'machine-2')
        renderSessionList([multiMachineSessions[0]])

        const emptyMachine = screen.getByRole('button', { name: /Teemo \(0\)/ })
        expect(emptyMachine).toHaveAttribute('aria-pressed', 'true')
        expect(emptyMachine).not.toBeDisabled()
        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.getByText('No sessions match your filters.')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /All \(1\)/ }))
        expect(screen.getByTitle('/work/hapi')).toBeInTheDocument()
    })

    it('lists machines from API data even with no sessions or cached labels', () => {
        const machine: Machine = {
            id: 'machine-1', namespace: 'test', seq: 0, createdAt: 0, updatedAt: 0,
            active: true, activeAt: 100, metadata: { displayName: 'Mac', host: 'mac', platform: 'darwin', homeDir: '/home', happyHomeDir: '/home/.hapi', happyCliVersion: 'test' },
            metadataVersion: 0, runnerState: null, runnerStateVersion: 0
        }
        renderSessionList([], { [machine.id]: machine }, {})
        expect(screen.getByRole('button', { name: /All \(0\)/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Mac \(0\)/ })).toBeInTheDocument()
    })

    it('shows offline state and last-seen time without hiding that machine sessions', () => {
        const activeAt = Date.UTC(2026, 9, 4, 12, 30)
        const machine: Machine = {
            id: 'machine-2', namespace: 'test', seq: 0, createdAt: 0, updatedAt: 0,
            active: false, activeAt, metadata: null, metadataVersion: 0,
            runnerState: null, runnerStateVersion: 0
        }
        renderSessionList(multiMachineSessions, { [machine.id]: machine })
        const chip = screen.getByRole('button', { name: /Teemo \(1\).*offline.*last seen/ })
        expect(chip).not.toBeDisabled()
        expect(chip).toHaveClass('text-[var(--app-hint)]')
        expect(chip.querySelector('time')).toHaveAttribute('dateTime', new Date(activeAt).toISOString())
        fireEvent.click(chip)
        expect(screen.getByTitle('/work/docs')).toBeInTheDocument()
        expect(screen.queryByTitle('/work/hapi')).toBeNull()
    })

    it.each(['claude', 'codex'])('shows a readable %s provider badge on session rows', flavor => {
        renderSessionList([makeSession({ id: flavor, pinned: true, metadata: { path: '/work/hapi', name: 'Task', flavor, machineId: 'machine-1' } })])
        const badge = screen.getByText(flavor === 'claude' ? 'Claude' : 'Codex', { selector: 'span' })
        expect(badge.parentElement).toHaveClass('shrink-0')
        expect(badge.parentElement?.className).not.toContain('hidden')
    })

    it('keeps external Claude sessions readable without a runner machine record', () => {
        renderSessionList([makeSession({
            id: 'external-claude', active: true, pinned: true,
            metadata: { path: '/work/external', name: 'HTTP Claude task', flavor: 'claude', machineId: 'external-host', agentSessionId: 'external-thread' }
        })], {}, {})
        expect(screen.getByText('HTTP Claude task')).toBeInTheDocument()
        expect(screen.getByText('Claude', { selector: 'span' })).toBeInTheDocument()
        const chip = screen.getByRole('button', { name: /external \(1\)/ })
        expect(chip).not.toHaveTextContent('offline')
        fireEvent.click(chip)
        expect(screen.getByText('HTTP Claude task')).toBeInTheDocument()
    })

    it('shows an empty state when the search only matches sessions on another machine', () => {
        renderSessionList([
            makeSession({
                id: 'session-alpha',
                updatedAt: 100,
                metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1', name: 'Alpha task' }
            }),
            makeSession({
                id: 'session-beta',
                updatedAt: 90,
                metadata: { path: '/work/docs', machineId: 'machine-2', agentSessionId: 'thread-2', name: 'Beta task' }
            })
        ])

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'alpha' } })
        fireEvent.click(screen.getByRole('button', { name: /Teemo \(1\)/ }))

        expect(screen.getByText('No sessions match your filters.')).toBeTruthy()
        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.queryByTitle('/work/docs')).toBeNull()
    })
})


describe('Bots view', () => {
    it('defaults to named bots, pinned first, with working machine filters', () => {
        localStorage.clear()
        renderSessionList([
            makeSession({ id: 'recent', updatedAt: 900, metadata: { path: '/work/recent', name: 'Research Bot', machineId: 'machine-1' } }),
            makeSession({ id: 'pinned', pinned: true, updatedAt: 1, metadata: { path: '/work/pinned', name: 'Professor Bot', machineId: 'machine-2' } }),
        ])
        const pinned = screen.getByText('Professor Bot')
        const recent = screen.getByText('Research Bot')
        expect(pinned.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.queryByText('work/recent')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /Teemo \(1\)/ }))
        expect(screen.queryByText('Research Bot')).toBeNull()
        expect(screen.getByText('Professor Bot')).toBeTruthy()
    })
})
