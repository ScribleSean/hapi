import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CompactActivity } from './CompactActivity'
import { needsToolAttention } from './ToolMessage'
import type { ToolCallBlock } from '@/chat/types'

afterEach(cleanup)

describe('compact chat activity', () => {
    it('starts folded with an action count and retains inspectable details', () => {
        const { container } = render(
            <CompactActivity count={4} running={false} failed={false} needsAttention={false}>
                <p>Detailed tool output</p>
            </CompactActivity>
        )
        expect(container.querySelector('details')?.open).toBe(false)
        expect(screen.getByText('Tool activity · 4 actions')).toBeTruthy()
        expect(screen.getByText('Detailed tool output')).toBeTruthy()
    })

    it('keeps failures visible in the summary', () => {
        render(<CompactActivity count={1} running={false} failed needsAttention={false}>Output</CompactActivity>)
        expect(screen.getByText('Error').closest('summary')).toBeTruthy()
    })

    it('never folds a required user interaction', () => {
        const { container } = render(
            <CompactActivity count={1} running failed={false} needsAttention>
                <button>Approve command</button>
            </CompactActivity>
        )
        expect(container.querySelector('details')).toBeNull()
        expect(screen.getByRole('button', { name: 'Approve command' })).toBeVisible()
    })

    it('detects permission requests nested under a completed parent', () => {
        const pending = { kind: 'tool-call', id: 'child', localId: null, createdAt: 1, tool: { name: 'Bash', input: {}, description: null, state: 'running', permission: { status: 'pending' } }, children: [] } as unknown as ToolCallBlock
        const parent = { ...pending, tool: { ...pending.tool, state: 'completed', permission: undefined }, children: [pending] } as ToolCallBlock
        expect(needsToolAttention(parent)).toBe(true)
        expect(needsToolAttention({ ...parent, children: [] })).toBe(false)
    })
})
