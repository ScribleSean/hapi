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
        setServiceTier: vi.fn().mockResolvedValue(undefined),
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
        fireEvent.click(screen.getByRole('button', { name: 'Bot settings for Alpha' }))
        await screen.findByRole('combobox', { name: 'Requested reasoning level' })
        expect(parentClick).not.toHaveBeenCalled()
        fireEvent.change(screen.getByRole('combobox', { name: 'Requested reasoning level' }), { target: { value: 'ultra' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 bot' }))
        await waitFor(() => expect(methods.setModelReasoningEffort).toHaveBeenCalledWith('a', 'ultra'))
        expect(await screen.findByText(/1 applied/)).toBeTruthy()
    })
    it('previews offline exclusions, supports exact bulk choices, and reports the results', async () => {
        const { api, methods } = setup()
        wrapper(<SessionReasoningControl api={api} sessions={sessions} bulk />)
        fireEvent.click(screen.getByRole('button', { name: 'Bot settings for 2 sessions' }))
        await screen.findByRole('combobox', { name: 'Requested reasoning level' })
        fireEvent.change(screen.getByRole('combobox', { name: 'Requested reasoning level' }), { target: { value: 'ultra' } })
        expect(screen.getByText('Requested: Ultra. Supported by 1 of 2 selected bots; 1 will be skipped.')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 bot' }))
        expect(await screen.findByText(/1 applied.*1 skipped/)).toBeTruthy()
        expect(methods.setModelReasoningEffort).toHaveBeenCalledTimes(1)
    })
    it('honors deselection without mutating any sessions', async () => {
        const { api, methods } = setup()
        wrapper(<SessionReasoningControl api={api} sessions={sessions} bulk />)
        fireEvent.click(screen.getByRole('button', { name: 'Bot settings for 2 sessions' }))
        await screen.findByRole('combobox', { name: 'Requested reasoning level' })
        fireEvent.click(screen.getByRole('button', { name: 'Deselect filtered' }))
        expect(screen.getByRole('button', { name: 'Apply to 0 bots' })).toBeDisabled()
        expect(methods.setModelReasoningEffort).not.toHaveBeenCalled()
    })
    it('shows Fast only when the native Codex catalog advertises it and reports its write', async () => {
        const { api, methods } = setup()
        methods.getSessionCodexModels.mockResolvedValue({ success: true, models: [{ id: 'm', isDefault: true, supportedReasoningEfforts: ['medium'], serviceTiers: ['priority'] }] })
        wrapper(<SessionReasoningControl api={api} sessions={[sessions[0]]} />)
        fireEvent.click(screen.getByRole('button', { name: 'Bot settings for Alpha' }))
        await screen.findByRole('tab', { name: 'Speed' })
        fireEvent.click(screen.getByRole('tab', { name: 'Speed' }))
        fireEvent.change(screen.getByRole('combobox', { name: 'Requested speed' }), { target: { value: 'fast' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 bot' }))
        await waitFor(() => expect(methods.setServiceTier).toHaveBeenCalledWith('a', 'fast'))
        expect(await screen.findByText(/1 applied/)).toBeTruthy()
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
