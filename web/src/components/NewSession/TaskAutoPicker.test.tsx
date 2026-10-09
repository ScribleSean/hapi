import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { TaskAutoPicker } from './TaskAutoPicker'

describe('TaskAutoPicker', () => {
    const option = { model: 'fixture-model', effort: 'high', effortKind: 'reasoning' as const }
    function fixture() {
        const api = {
            getTaskPickerStatus: vi.fn().mockResolvedValue({ ready: true, reason: null }),
            chooseTaskModel: vi.fn().mockResolvedValue({ option, label: 'Fixture', confidence: 0.9 }),
        }
        const props = { api: api as unknown as ApiClient, machineId: 'pc', harness: 'codex', directory: 'project',
            selection: 'old-model', options: [option], disabled: false, onPick: vi.fn(), onBusyChange: vi.fn() }
        return { api, props }
    }
    async function open() {
        fireEvent.click(screen.getByText('Auto choose with Jev').closest('summary')!)
        fireEvent.change(screen.getByLabelText('Task brief for automatic model selection'), { target: { value: 'Write unit tests for a parser' } })
        await waitFor(() => expect(screen.getByRole('button', { name: 'Auto choose' })).toBeEnabled())
    }
    it('applies the returned choice without a second confirmation or task launch', async () => {
        const { api, props } = fixture(); render(<TaskAutoPicker {...props} />)
        await open()
        fireEvent.click(screen.getByRole('button', { name: 'Auto choose' }))
        await waitFor(() => expect(props.onPick).toHaveBeenCalledWith(option))
        expect(api.chooseTaskModel).toHaveBeenCalledTimes(1)
        expect(api.chooseTaskModel.mock.calls[0]![0]).toEqual({ machineId: 'pc', harness: 'codex', brief: 'Write unit tests for a parser', options: [option] })
    })
    it('does not overwrite a manual choice made while Jev was running', async () => {
        const { api, props } = fixture()
        let resolve!: (value: unknown) => void
        api.chooseTaskModel.mockImplementation(() => new Promise(r => { resolve = r }))
        const view = render(<TaskAutoPicker {...props} />); await open()
        fireEvent.click(screen.getByRole('button', { name: 'Auto choose' }))
        view.rerender(<TaskAutoPicker {...props} selection="manual-change" />)
        await act(async () => resolve({ option, confidence: 0.9 }))
        expect(props.onPick).not.toHaveBeenCalled()
        expect(screen.getByRole('status')).toHaveTextContent('No selection applied')
    })
    it('keeps manual controls usable when the hub has no credential/policy', async () => {
        const { api, props } = fixture(); api.getTaskPickerStatus.mockResolvedValue({ ready: false, reason: 'Missing setup' })
        render(<TaskAutoPicker {...props} />)
        fireEvent.click(screen.getByText('Auto choose with Jev').closest('summary')!)
        await waitFor(() => expect(screen.getByText('Missing setup')).toBeVisible())
        expect(screen.getByRole('button', { name: 'Auto choose' })).toBeDisabled()
        expect(props.onPick).not.toHaveBeenCalled()
        expect(api.chooseTaskModel).not.toHaveBeenCalled()
    })
})
