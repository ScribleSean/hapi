import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionStatusPanel } from './SessionStatusPanel'

vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('SessionStatusPanel goal visibility', () => {
    it('names the goal status before expansion and exposes objective and budget inside', () => {
        render(<SessionStatusPanel data={{
            goal: { threadId: 'fixture', objective: 'Finish the fixture task', status: 'active', tokensUsed: 250, tokenBudget: 1000, timeUsedSeconds: 60, createdAt: 1, updatedAt: 2 },
            tasks: [], subagents: [], terminals: [], undiscoveredTerminalCount: 0, possibleTerminalCommands: []
        }} />)
        const summary = screen.getByText(/\/goal · session.status.goal.active/).closest('summary')!
        expect(summary.closest('details')).not.toHaveAttribute('open')
        expect(summary).toBeVisible()
        fireEvent.click(summary)
        expect(screen.getByText('Finish the fixture task')).toBeVisible()
        expect(screen.getByText('250 tokens / 1,000 budget')).toBeVisible()
    })
})
