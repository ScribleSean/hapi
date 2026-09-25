import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Machine, SessionSummary } from '@/types/api'
import { ProjectHome, newProjectPath } from './ProjectHome'

afterEach(cleanup)
const machines = [
    { id: 'windows', metadata: { host: 'Desktop', workspaceRoots: ['C:\\Users\\Sean\\Documents'] } },
    { id: 'mac', metadata: { host: 'MacBook', workspaceRoots: ['/Users/sean/Documents'] } },
] as Machine[]

describe('Project home', () => {
    it('suggests safe new locations without changing or creating directories', () => {
        expect(newProjectPath('C:\\Users\\Sean\\Documents', 'codex', 'My Website')).toBe('C:\\Users\\Sean\\Documents\\AI-Projects\\codex\\my-website')
        expect(newProjectPath('/Users/sean/Documents', 'claude', '../portfolio')).toBe('/Users/sean/Documents/AI-Projects/claude/portfolio')
        expect(newProjectPath('/work', 'claude', '..')).toBeNull()
        expect(newProjectPath('/work', 'claude', 'CON')).toBeNull()
    })

    it('opens existing projects at their original paths and scopes them by machine', () => {
        const open = vi.fn()
        const sessions = [
            { id: 'one', updatedAt: 2, metadata: { machineId: 'windows', path: 'C:\\old\\project', name: 'Professor Bot', flavor: 'codex' } },
            { id: 'two', updatedAt: 1, metadata: { machineId: 'mac', path: '/old/project', name: 'Mac Bot', flavor: 'codex' } },
        ] as SessionSummary[]
        render(<ProjectHome machines={machines} sessions={sessions} onStartSession={open} />)
        fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
        expect(screen.queryByText('Mac Bot')).toBeNull()
        fireEvent.click(screen.getByText('Professor Bot'))
        expect(open).toHaveBeenCalledWith('windows', 'C:\\old\\project', 'codex')
        fireEvent.change(screen.getByLabelText('Project computer'), { target: { value: 'mac' } })
        expect(screen.getByText('Mac Bot')).toBeTruthy()
        expect(screen.queryByText('Professor Bot')).toBeNull()
    })

    it('passes a named new project and selected agent to the existing setup flow', () => {
        const open = vi.fn()
        render(<ProjectHome machines={machines} sessions={[]} onStartSession={open} />)
        fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
        fireEvent.change(screen.getByLabelText('New project name'), { target: { value: 'Study Planner' } })
        expect(open).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Continue to setup' }))
        expect(open).toHaveBeenCalledWith('windows', 'C:\\Users\\Sean\\Documents\\AI-Projects\\claude\\study-planner', 'claude')
    })
})
