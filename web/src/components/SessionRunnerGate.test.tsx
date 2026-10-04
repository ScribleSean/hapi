import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionRunnerGate } from './SessionRunnerGate'

describe('SessionRunnerGate', () => {
    it('does not mount RPC-backed children for external-session deep links', () => {
        const mountRunnerPage = vi.fn()
        const onBack = vi.fn()
        function RunnerPage() {
            mountRunnerPage()
            return <div>Runner page</div>
        }
        const session = { metadata: { flavor: 'claude', version: 'claude-http-v1' } } as Session
        render(<I18nProvider><SessionRunnerGate session={session} onBack={onBack}><RunnerPage /></SessionRunnerGate></I18nProvider>)
        expect(mountRunnerPage).not.toHaveBeenCalled()
        expect(screen.getByText(/HTTP Claude session: messaging only/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
        expect(onBack).toHaveBeenCalledOnce()
    })

    it('preserves native runner pages', () => {
        const session = { metadata: { flavor: 'claude', version: 'native' } } as Session
        render(<I18nProvider><SessionRunnerGate session={session} onBack={vi.fn()}><div>Runner page</div></SessionRunnerGate></I18nProvider>)
        expect(screen.getByText('Runner page')).toBeInTheDocument()
    })
})
