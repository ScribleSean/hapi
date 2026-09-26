import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionReasoningControl } from './SessionReasoningControl'
import { SessionConnections } from './SessionConnections'

afterEach(cleanup)
const sessions = [
    { id: 'a', active: true, model: 'm', modelReasoningEffort: 'medium', effort: null, metadata: { path: '/work', name: 'Alpha', flavor: 'codex' } },
    { id: 'b', active: false, model: 'm', effort: null, metadata: { path: '/work', name: 'Offline', flavor: 'claude' } },
] as SessionSummary[]
function setup() {
    const methods = {
        getSession: vi.fn().mockResolvedValue({ session: sessions[0] }),
        getSessionCodexModels: vi.fn().mockResolvedValue({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['medium', 'ultra'] }] }),
        setModelReasoningEffort: vi.fn().mockResolvedValue(undefined),
    }
    return { methods, api: methods as unknown as ApiClient }
}
function wrapper(children: React.ReactNode) {
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider>{children}</I18nProvider></QueryClientProvider>)
}
describe('sidebar reasoning controls', () => {
    it('loads only when clicked and never selects/navigates the underlying session', async () => {
        const { api, methods } = setup()
        const parentClick = vi.fn()
        wrapper(<div onClick={parentClick}><SessionReasoningControl api={api} sessions={[sessions[0]]} /></div>)
        expect(methods.getSession).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Reasoning for Alpha' }))
        await screen.findByRole('combobox', { name: 'Reasoning level' })
        expect(parentClick).not.toHaveBeenCalled()
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ultra' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 session' }))
        await waitFor(() => expect(methods.setModelReasoningEffort).toHaveBeenCalledWith('a', 'ultra'))
        expect(await screen.findByText(/1 applied/)).toBeTruthy()
    })
    it('previews offline exclusions, supports exact bulk choices, and reports the results', async () => {
        const { api, methods } = setup()
        wrapper(<SessionReasoningControl api={api} sessions={sessions} bulk />)
        fireEvent.click(screen.getByRole('button', { name: 'Change reasoning for all sessions' }))
        await screen.findByRole('combobox')
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ultra' } })
        expect(screen.getByText('1 can accept Ultra. 1 will be skipped.')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 session' }))
        expect(await screen.findByText(/1 applied.*1 skipped/)).toBeTruthy()
        expect(methods.setModelReasoningEffort).toHaveBeenCalledTimes(1)
    })
    it('honors deselection without mutating any sessions', async () => {
        const { api, methods } = setup()
        wrapper(<SessionReasoningControl api={api} sessions={sessions} bulk />)
        fireEvent.click(screen.getByRole('button', { name: 'Change reasoning for all sessions' }))
        await screen.findByRole('combobox')
        fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
        expect(screen.getByRole('button', { name: 'Apply to 0 sessions' })).toBeDisabled()
        expect(methods.setModelReasoningEffort).not.toHaveBeenCalled()
    })
})
describe('connections overview', () => {
    it('shows models, filters sessions, and does not claim runner connectivity verifies authentication', async () => {
        const { api } = setup()
        const onSelect = vi.fn()
        wrapper(<SessionConnections api={api} sessions={sessions} machines={{}} machineLabels={{}} onSelect={onSelect} />)
        fireEvent.click(screen.getByRole('button', { name: 'Models & connections' }))
        expect(screen.getByText(/does not verify login/)).toBeTruthy()
        expect(screen.getByText('1 connected · 1 offline')).toBeTruthy()
        fireEvent.change(screen.getByRole('textbox', { name: 'Filter models and connections' }), { target: { value: 'claude' } })
        expect(screen.queryByText('Alpha')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /Offline Claude/ }))
        expect(onSelect).toHaveBeenCalledWith('b')
    })
})
