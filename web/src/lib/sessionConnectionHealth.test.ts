import { describe, expect, it } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import { latestReportedAuthIssue } from './sessionConnectionHealth'

const message = (role: string, text: string, createdAt = 1) => ({
    id: String(createdAt), createdAt, content: { role, content: role === 'user' ? { type: 'text', text } : { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text }] } } } },
}) as DecryptedMessage
describe('connection error evidence', () => {
    it('surfaces the last agent authentication failure', () => {
        expect(latestReportedAuthIssue([message('agent', 'Failed to authenticate: OAuth session expired and could not be refreshed')])).toContain('sign-in failure')
    })
    it('ignores user claims and later clears on a normal agent reply', () => {
        expect(latestReportedAuthIssue([message('user', 'Failed to authenticate')])).toBeNull()
        expect(latestReportedAuthIssue([message('agent', 'Failed to authenticate'), message('agent', 'Hello', 2)])).toBeNull()
    })
    it('does not treat discussion of errors as a reported authentication failure', () => {
        expect(latestReportedAuthIssue([message('agent', 'If you see failed to authenticate, log in again.')])).toBeNull()
    })
})
